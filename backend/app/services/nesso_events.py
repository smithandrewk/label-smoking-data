"""Write-through bridge: label annotations → nesso `events` rows.

When a recording was imported from nesso (via NessoPgAdapter), every
write to label's `annotations` table also creates/updates/deletes a
corresponding row in nesso's `events` table so the nesso dashboard,
nightly trainer, and webhook consumers see the label immediately.

Connection uses the same NESSO_PG_* env vars as NessoPgAdapter — see
backend/app/adapters/nesso_pg.py.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone

import psycopg


_LABEL_TYPE_PREFIX = "label."


def _conn_kwargs() -> dict:
    return dict(
        host=os.getenv("NESSO_PG_HOST", "nesso-postgres"),
        port=int(os.getenv("NESSO_PG_PORT", "5432")),
        dbname=os.getenv("NESSO_PG_DB", "nesso"),
        user=os.getenv("NESSO_PG_USER", "nesso"),
        password=os.getenv("NESSO_PG_PASSWORD", "nesso"),
    )


def _ns_to_dt(ns: int) -> datetime:
    return datetime.fromtimestamp(ns / 1e9, tz=timezone.utc)


def insert_label(
    *,
    device_id: str,
    label_name: str,
    start_ns: int,
    end_ns: int,
    confidence: float | None = None,
    source: str = "manual",
    annotation_id: int | None = None,
    project_name: str | None = None,
    recording_name: str | None = None,
) -> str:
    """Mirror a label annotation into nesso events. Returns the new event UUID.

    `attributes` shape:
        labeler:        always 'label-app'
        source:         the annotation's `source` field (manual/imported/model)
        confidence:     if non-null
        label_app_annotation_id: forensic backlink so a future repair
                                  job can rebuild from either side
        project, recording: human-readable context
    """
    ts_start = _ns_to_dt(start_ns)
    ts_end = _ns_to_dt(end_ns) if end_ns != start_ns else ts_start
    attrs: dict = {"labeler": "label-app", "source": source}
    if confidence is not None:
        attrs["confidence"] = confidence
    if annotation_id is not None:
        attrs["label_app_annotation_id"] = annotation_id
    if project_name:
        attrs["project"] = project_name
    if recording_name:
        attrs["recording"] = recording_name

    with psycopg.connect(**_conn_kwargs()) as conn:
        row = conn.execute(
            """
            INSERT INTO events (device_id, ts_start, ts_end, type, attributes)
            VALUES (%s, %s, %s, %s, %s::jsonb)
            RETURNING id
            """,
            (
                device_id,
                ts_start,
                ts_end,
                f"{_LABEL_TYPE_PREFIX}{label_name}",
                json.dumps(attrs),
            ),
        ).fetchone()
        if row is None:
            raise RuntimeError("nesso events insert returned no id")
        return str(row[0])


def update_label(
    *,
    event_id: str,
    label_name: str | None = None,
    start_ns: int | None = None,
    end_ns: int | None = None,
    confidence: float | None = None,
    source: str | None = None,
) -> None:
    """Update a mirrored event. Only the fields passed are touched.

    `attributes` is merged (jsonb `||`) so other attributes (e.g.
    label_app_annotation_id) survive the update.
    """
    sets: list[str] = []
    params: list = []
    if label_name is not None:
        sets.append("type = %s")
        params.append(f"{_LABEL_TYPE_PREFIX}{label_name}")
    if start_ns is not None:
        sets.append("ts_start = %s")
        params.append(_ns_to_dt(start_ns))
    if end_ns is not None:
        sets.append("ts_end = %s")
        params.append(_ns_to_dt(end_ns))

    attr_patch: dict = {}
    if confidence is not None:
        attr_patch["confidence"] = confidence
    if source is not None:
        attr_patch["source"] = source
    if attr_patch:
        sets.append("attributes = attributes || %s::jsonb")
        params.append(json.dumps(attr_patch))

    if not sets:
        return

    params.append(event_id)
    with psycopg.connect(**_conn_kwargs()) as conn:
        conn.execute(
            f"UPDATE events SET {', '.join(sets)} WHERE id = %s",
            tuple(params),
        )


def delete_label(*, event_id: str) -> None:
    with psycopg.connect(**_conn_kwargs()) as conn:
        conn.execute("DELETE FROM events WHERE id = %s", (event_id,))


def list_devices() -> list[dict]:
    """Catalog of nesso devices available for import. Surfaces friendly
    name + IMU coverage span so the UI can show useful chips."""
    with psycopg.connect(**_conn_kwargs()) as conn:
        rows = conn.execute(
            """
            SELECT d.id,
                   d.friendly_name,
                   COUNT(r.*) AS imu_sample_count,
                   MIN(r.ts) AS imu_earliest,
                   MAX(r.ts) AS imu_latest
            FROM devices d
            LEFT JOIN raw_imu r ON r.device_id = d.id
            GROUP BY d.id, d.friendly_name
            ORDER BY MAX(r.ts) DESC NULLS LAST
            """
        ).fetchall()
    out: list[dict] = []
    for row in rows:
        id_, name, n, earliest, latest = row
        out.append({
            "id": str(id_),
            "friendly_name": name,
            "imu_sample_count": int(n) if n is not None else 0,
            "imu_earliest": earliest.isoformat() if earliest else None,
            "imu_latest": latest.isoformat() if latest else None,
        })
    return out


def list_labels_in_window(
    *,
    device_id: str,
    start_ns: int,
    end_ns: int,
) -> list[dict]:
    """Pull existing label.* events from nesso for the (device, window).

    Used by label-app's sync endpoint to surface cogsworth, firmware-tap,
    and manual-UI labels inside label-app. Returns a list of dicts
    suitable for INSERT into label's annotations table.
    """
    ts_start = _ns_to_dt(start_ns)
    ts_end = _ns_to_dt(end_ns)
    with psycopg.connect(**_conn_kwargs()) as conn:
        rows = conn.execute(
            """
            SELECT id, ts_start, ts_end, type, attributes
            FROM events
            WHERE device_id = %s
              AND type LIKE 'label.%%'
              AND ts_start <= %s
              AND COALESCE(ts_end, ts_start) >= %s
            ORDER BY ts_start ASC
            """,
            (device_id, ts_end, ts_start),
        ).fetchall()

    out: list[dict] = []
    for row in rows:
        event_id, ts_s, ts_e, type_, attrs = row
        attrs = attrs or {}
        # Point events (ts_end NULL or == ts_start) stay zero-length; the
        # API's labels endpoint already normalizes NULL → ts_start.
        if ts_e is None:
            ts_e = ts_s
        kind = type_[len("label."):] if type_.startswith("label.") else type_
        out.append({
            "nesso_event_id": str(event_id),
            "label_name": kind,
            "start_ns": int(ts_s.timestamp() * 1e9),
            "end_ns": int(ts_e.timestamp() * 1e9),
            "labeler": attrs.get("labeler", "unknown"),
            "source": f"nesso-{attrs.get('labeler', 'unknown')}",
            "confidence": attrs.get("confidence"),
        })
    return out
