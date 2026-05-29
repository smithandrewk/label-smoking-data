"""Import pipeline: adapter -> Parquet -> SQLite."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import pyarrow as pa
import pyarrow.parquet as pq
from .. import config, database
from ..adapters.base import ImportedRecording, AdapterRegistry


def compute_dir_hash(path: str) -> str:
    """Compute a hash of directory contents for dedup.

    Non-filesystem source paths (e.g. `nesso://...` URIs) hash the
    string itself, since the adapter encodes its dedup-relevant params
    directly in the path.
    """
    p = Path(path)
    if not p.exists():
        return hashlib.sha256(path.encode()).hexdigest()[:16]
    h = hashlib.sha256()
    for f in sorted(p.rglob('*')):
        if f.is_file():
            h.update(str(f.relative_to(p)).encode())
            h.update(f.stat().st_size.to_bytes(8, 'big'))
    return h.hexdigest()[:16]


def import_dataset(
    source_path: str,
    dataset_name: str,
    registry: AdapterRegistry,
    format_hint: str | None = None,
) -> dict:
    """Import a dataset from source_path using the appropriate adapter.

    Returns dict with dataset_id and count of imported recordings.
    """
    adapter = None
    if format_hint:
        adapter = registry.get(format_hint)
    if adapter is None:
        adapter = registry.detect(source_path)
    if adapter is None:
        raise ValueError(f"No adapter found for {source_path}. Available: {registry.list_formats()}")

    content_hash = compute_dir_hash(source_path)

    conn = database.get_connection()
    try:
        # Check for duplicate
        existing = conn.execute(
            "SELECT id, name FROM datasets WHERE content_hash = ?", (content_hash,)
        ).fetchone()
        if existing:
            return {
                'dataset_id': existing['id'],
                'dataset_name': existing['name'],
                'recordings_imported': 0,
                'message': f"Dataset already imported as '{existing['name']}'",
                'duplicate': True,
            }

        recordings_list = adapter.scan(source_path)

        # Load first recording to get metadata
        first = adapter.load(source_path, recordings_list[0])

        # Create dataset record
        cur = conn.execute(
            """INSERT INTO datasets (name, source_format, source_path, sample_rate_hz,
               channel_count, channel_names, channel_units, content_hash)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                dataset_name,
                adapter.format_name,
                source_path,
                first.sample_rate_hz,
                len(first.channel_names),
                json.dumps(first.channel_names),
                json.dumps(first.channel_units) if first.channel_units else None,
                content_hash,
            ),
        )
        dataset_id = cur.lastrowid

        # Import each recording
        count = 0
        for rec in adapter.load_all(source_path):
            _import_recording(conn, dataset_id, rec)
            count += 1

        conn.commit()
        return {
            'dataset_id': dataset_id,
            'dataset_name': dataset_name,
            'recordings_imported': count,
            'format': adapter.format_name,
            'duplicate': False,
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _import_recording(conn, dataset_id: int, rec: ImportedRecording):
    """Save a single recording: write Parquet + insert DB rows."""
    # Create participant if needed
    participant_id = None
    if rec.participant_code:
        existing = conn.execute(
            "SELECT id FROM participants WHERE code = ?", (rec.participant_code,)
        ).fetchone()
        if existing:
            participant_id = existing['id']
        else:
            cur = conn.execute(
                "INSERT INTO participants (code) VALUES (?)", (rec.participant_code,)
            )
            participant_id = cur.lastrowid

    # Write Parquet file
    safe_name = rec.name.replace('/', '_')
    parquet_dir = config.RECORDINGS_DIR / str(dataset_id)
    parquet_dir.mkdir(parents=True, exist_ok=True)
    parquet_path = parquet_dir / f"{safe_name}.parquet"

    table = pa.Table.from_pandas(rec.data, preserve_index=False)
    pq.write_table(table, parquet_path)

    # Store relative path from DATA_ROOT
    rel_path = str(parquet_path.relative_to(config.DATA_ROOT))

    # Insert recording
    start_ns = int(rec.data['timestamp_ns'].iloc[0])
    end_ns = int(rec.data['timestamp_ns'].iloc[-1])

    cur = conn.execute(
        """INSERT INTO recordings (dataset_id, participant_id, name, data_path,
           sample_count, start_ns, end_ns, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            dataset_id,
            participant_id,
            rec.name,
            rel_path,
            len(rec.data),
            start_ns,
            end_ns,
            json.dumps(rec.metadata) if rec.metadata else None,
        ),
    )
    recording_id = cur.lastrowid

    # Import labels as annotations (no project yet — use project_id=0 as "imported")
    if rec.labels:
        # Create a default project for imported labels if it doesn't exist
        default_project = conn.execute(
            "SELECT id FROM projects WHERE name = '__imported__'"
        ).fetchone()
        if not default_project:
            c = conn.execute(
                "INSERT INTO projects (name, description, label_schema) VALUES (?, ?, ?)",
                ('__imported__', 'Auto-created for imported labels', '[]'),
            )
            project_id = c.lastrowid
        else:
            project_id = default_project['id']

        for label in rec.labels:
            conn.execute(
                """INSERT INTO annotations (recording_id, project_id, label_name,
                   start_ns, end_ns, source) VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    recording_id,
                    project_id,
                    label.get('label', 'unlabeled'),
                    label['start_ns'],
                    label['end_ns'],
                    'imported',
                ),
            )
