import json
import logging
import sqlite3

from flask import Blueprint, request, jsonify
from .. import database
from ..services import nesso_events, recording_service

bp = Blueprint('recordings', __name__, url_prefix='/api/recordings')
log = logging.getLogger(__name__)


def _nesso_context_full(conn: sqlite3.Connection, recording_id: int) -> dict | None:
    """For a nesso-imported recording: (device_id, start_ns, end_ns).

    Mirrors _nesso_context in routes/annotations.py but also returns the
    time window — needed for the pull-sync to filter nesso events.
    """
    row = conn.execute(
        """
        SELECT r.name AS recording_name,
               r.start_ns AS start_ns,
               r.end_ns AS end_ns,
               r.metadata AS recording_metadata,
               d.source_format AS source_format
        FROM recordings r
        JOIN datasets d ON d.id = r.dataset_id
        WHERE r.id = ?
        """,
        (recording_id,),
    ).fetchone()
    if row is None or row["source_format"] != "nesso_pg":
        return None
    try:
        meta = json.loads(row["recording_metadata"] or "{}")
    except (TypeError, ValueError):
        meta = {}
    device_id = meta.get("device_id")
    if not device_id:
        return None
    return {
        "device_id": device_id,
        "recording_name": row["recording_name"],
        "start_ns": row["start_ns"],
        "end_ns": row["end_ns"],
    }


@bp.route('', methods=['GET'])
def list_recordings():
    dataset_id = request.args.get('dataset_id', type=int)
    project_id = request.args.get('project_id', type=int)
    recordings = recording_service.list_recordings(dataset_id, project_id)
    return jsonify(recordings)


@bp.route('/<int:recording_id>', methods=['GET'])
def get_recording(recording_id):
    rec = recording_service.get_recording(recording_id)
    if not rec:
        return jsonify({'error': 'Not found'}), 404
    return jsonify(rec)


@bp.route('/<int:recording_id>/sync_nesso_labels', methods=['POST'])
def sync_nesso_labels(recording_id):
    """Pull existing label.* events from nesso into label-app for a
    nesso-imported recording. Idempotent — rows with a matching
    `nesso_event_id` are skipped (partial unique index enforces this).

    Body: {"project_id": <int>}. Pulled annotations land in that
    project so they show up alongside locally-drawn ones for the same
    labeling task.

    Returns: {"inserted": N, "skipped_existing": M, "details": [...]}.
    """
    body = request.get_json() or {}
    project_id = body.get("project_id")
    if not isinstance(project_id, int):
        return jsonify({"error": "project_id (int) is required"}), 400

    conn = database.get_connection()
    try:
        ctx = _nesso_context_full(conn, recording_id)
        if ctx is None:
            return jsonify({
                "error": "recording is not nesso-imported",
                "recording_id": recording_id,
            }), 400

        try:
            events = nesso_events.list_labels_in_window(
                device_id=ctx["device_id"],
                start_ns=ctx["start_ns"],
                end_ns=ctx["end_ns"],
            )
        except Exception as e:
            log.warning("nesso pull-sync failed for recording %s: %s",
                        recording_id, e)
            return jsonify({"error": f"nesso pull failed: {e}"}), 502

        inserted = 0
        skipped = 0
        details: list[dict] = []
        for ev in events:
            try:
                cur = conn.execute(
                    """INSERT INTO annotations
                       (recording_id, project_id, label_name,
                        start_ns, end_ns, confidence, source, nesso_event_id)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        recording_id, project_id,
                        ev["label_name"],
                        ev["start_ns"], ev["end_ns"],
                        ev["confidence"], ev["source"],
                        ev["nesso_event_id"],
                    ),
                )
                inserted += 1
                details.append({
                    "annotation_id": cur.lastrowid,
                    "nesso_event_id": ev["nesso_event_id"],
                    "label_name": ev["label_name"],
                    "labeler": ev["labeler"],
                    "action": "inserted",
                })
            except sqlite3.IntegrityError:
                # Unique index on nesso_event_id — already imported.
                skipped += 1
                details.append({
                    "nesso_event_id": ev["nesso_event_id"],
                    "action": "skipped_existing",
                })
        conn.commit()
        return jsonify({
            "inserted": inserted,
            "skipped_existing": skipped,
            "details": details,
        })
    finally:
        conn.close()


@bp.route('/<int:recording_id>/data', methods=['GET'])
def get_recording_data(recording_id):
    start_ns = request.args.get('start_ns', type=int)
    end_ns = request.args.get('end_ns', type=int)
    max_points = request.args.get('max_points', default=5000, type=int)

    try:
        data = recording_service.get_recording_data(
            recording_id, start_ns, end_ns, max_points
        )
        return jsonify(data)
    except ValueError as e:
        return jsonify({'error': str(e)}), 404
