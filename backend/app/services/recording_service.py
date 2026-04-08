"""Recording data loading with level-of-detail downsampling."""
from __future__ import annotations
import json
from pathlib import Path
import pyarrow.parquet as pq
import numpy as np
from .. import config, database


def get_recording_data(
    recording_id: int,
    start_ns: int | None = None,
    end_ns: int | None = None,
    max_points: int = 5000,
) -> dict:
    """Load recording data with LOD downsampling.

    Returns dict with timestamps and channel arrays ready for JSON serialization.
    """
    conn = database.get_connection()
    try:
        rec = conn.execute(
            "SELECT * FROM recordings WHERE id = ?", (recording_id,)
        ).fetchone()
        if not rec:
            raise ValueError(f"Recording {recording_id} not found")

        ds = conn.execute(
            "SELECT * FROM datasets WHERE id = ?", (rec['dataset_id'],)
        ).fetchone()
    finally:
        conn.close()

    parquet_path = config.DATA_ROOT / rec['data_path']
    table = pq.read_table(parquet_path)
    df = table.to_pandas()

    # Apply time range filter
    if start_ns is not None:
        df = df[df['timestamp_ns'] >= start_ns]
    if end_ns is not None:
        df = df[df['timestamp_ns'] <= end_ns]

    # Downsample if needed
    n = len(df)
    if n > max_points:
        step = n // max_points
        df = df.iloc[::step]

    channel_names = json.loads(ds['channel_names'])
    channel_cols = [c for c in df.columns if c.startswith('channel_')]

    result = {
        'recording_id': recording_id,
        'timestamps': df['timestamp_ns'].tolist(),
        'channels': {},
        'channel_names': channel_names,
        'sample_rate_hz': ds['sample_rate_hz'],
        'total_samples': n,
        'returned_samples': len(df),
    }

    for i, col in enumerate(channel_cols):
        name = channel_names[i] if i < len(channel_names) else col
        result['channels'][name] = df[col].tolist()

    return result


def list_recordings(dataset_id: int | None = None, project_id: int | None = None) -> list[dict]:
    conn = database.get_connection()
    try:
        if project_id is not None:
            rows = conn.execute(
                """SELECT r.*, p.code as participant_code, d.name as dataset_name
                   FROM recordings r
                   JOIN project_recordings pr ON r.id = pr.recording_id
                   LEFT JOIN participants p ON r.participant_id = p.id
                   LEFT JOIN datasets d ON r.dataset_id = d.id
                   WHERE pr.project_id = ?
                   ORDER BY r.name""",
                (project_id,),
            ).fetchall()
        elif dataset_id is not None:
            rows = conn.execute(
                """SELECT r.*, p.code as participant_code, d.name as dataset_name
                   FROM recordings r
                   LEFT JOIN participants p ON r.participant_id = p.id
                   LEFT JOIN datasets d ON r.dataset_id = d.id
                   WHERE r.dataset_id = ?
                   ORDER BY r.name""",
                (dataset_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT r.*, p.code as participant_code, d.name as dataset_name
                   FROM recordings r
                   LEFT JOIN participants p ON r.participant_id = p.id
                   LEFT JOIN datasets d ON r.dataset_id = d.id
                   ORDER BY r.name""",
            ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_recording(recording_id: int) -> dict | None:
    conn = database.get_connection()
    try:
        row = conn.execute(
            """SELECT r.*, p.code as participant_code, d.name as dataset_name,
                      d.channel_names, d.sample_rate_hz
               FROM recordings r
               LEFT JOIN participants p ON r.participant_id = p.id
               LEFT JOIN datasets d ON r.dataset_id = d.id
               WHERE r.id = ?""",
            (recording_id,),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()
