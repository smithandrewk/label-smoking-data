import json
import logging
import sqlite3

from flask import Blueprint, request, jsonify
from .. import database
from ..services import nesso_events

bp = Blueprint('annotations', __name__, url_prefix='/api/annotations')
log = logging.getLogger(__name__)


def _nesso_context(conn: sqlite3.Connection, recording_id: int) -> dict | None:
    """If the recording came from a nesso_pg dataset, return dict with
    device_id + project_name + recording_name. Else None (non-nesso →
    no mirror)."""
    row = conn.execute(
        """
        SELECT r.name AS recording_name,
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
    }


def _project_name(conn: sqlite3.Connection, project_id: int) -> str | None:
    row = conn.execute(
        "SELECT name FROM projects WHERE id = ?", (project_id,)
    ).fetchone()
    return row["name"] if row else None


@bp.route('', methods=['GET'])
def list_annotations():
    recording_id = request.args.get('recording_id', type=int)
    project_id = request.args.get('project_id', type=int)
    label = request.args.get('label')

    conn = database.get_connection()
    try:
        query = "SELECT * FROM annotations WHERE 1=1"
        params = []
        if recording_id:
            query += " AND recording_id = ?"
            params.append(recording_id)
        if project_id:
            query += " AND project_id = ?"
            params.append(project_id)
        if label:
            query += " AND label_name = ?"
            params.append(label)
        query += " ORDER BY start_ns"

        rows = conn.execute(query, params).fetchall()
        return jsonify([dict(r) for r in rows])
    finally:
        conn.close()


@bp.route('', methods=['POST'])
def create_annotation():
    data = request.get_json()
    required = ['recording_id', 'project_id', 'label_name', 'start_ns', 'end_ns']
    for field in required:
        if field not in data:
            return jsonify({'error': f'{field} is required'}), 400

    conn = database.get_connection()
    try:
        cur = conn.execute(
            """INSERT INTO annotations (recording_id, project_id, label_name,
               start_ns, end_ns, confidence, source)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                data['recording_id'],
                data['project_id'],
                data['label_name'],
                data['start_ns'],
                data['end_ns'],
                data.get('confidence'),
                data.get('source', 'manual'),
            ),
        )
        annotation_id = cur.lastrowid
        conn.commit()

        # Mirror to nesso events if the recording came from nesso_pg.
        # Failure here is logged but doesn't fail the local write — UI
        # state should never break because of an upstream-DB hiccup.
        ctx = _nesso_context(conn, data['recording_id'])
        nesso_event_id = None
        if ctx is not None:
            try:
                nesso_event_id = nesso_events.insert_label(
                    device_id=ctx['device_id'],
                    label_name=data['label_name'],
                    start_ns=data['start_ns'],
                    end_ns=data['end_ns'],
                    confidence=data.get('confidence'),
                    source=data.get('source', 'manual'),
                    annotation_id=annotation_id,
                    project_name=_project_name(conn, data['project_id']),
                    recording_name=ctx['recording_name'],
                )
                conn.execute(
                    "UPDATE annotations SET nesso_event_id = ? WHERE id = ?",
                    (nesso_event_id, annotation_id),
                )
                conn.commit()
            except Exception as e:
                log.warning("nesso mirror insert failed for annotation %s: %s",
                            annotation_id, e)

        return jsonify({'id': annotation_id, 'nesso_event_id': nesso_event_id}), 201
    finally:
        conn.close()


@bp.route('/<int:annotation_id>', methods=['PUT'])
def update_annotation(annotation_id):
    data = request.get_json()
    conn = database.get_connection()
    try:
        updates = []
        params = []
        for field in ['label_name', 'start_ns', 'end_ns', 'confidence', 'source']:
            if field in data:
                updates.append(f'{field} = ?')
                params.append(data[field])
        if not updates:
            return jsonify({'error': 'No fields to update'}), 400
        updates.append("updated_at = datetime('now')")
        params.append(annotation_id)
        conn.execute(
            f"UPDATE annotations SET {', '.join(updates)} WHERE id = ?", params
        )
        conn.commit()

        # Mirror the update to nesso if we have a stamped event id.
        nesso_event_id = conn.execute(
            "SELECT nesso_event_id FROM annotations WHERE id = ?", (annotation_id,)
        ).fetchone()
        if nesso_event_id and nesso_event_id["nesso_event_id"]:
            try:
                nesso_events.update_label(
                    event_id=nesso_event_id["nesso_event_id"],
                    label_name=data.get('label_name'),
                    start_ns=data.get('start_ns'),
                    end_ns=data.get('end_ns'),
                    confidence=data.get('confidence'),
                    source=data.get('source'),
                )
            except Exception as e:
                log.warning("nesso mirror update failed for annotation %s: %s",
                            annotation_id, e)
        return jsonify({'updated': True})
    finally:
        conn.close()


@bp.route('/<int:annotation_id>', methods=['DELETE'])
def delete_annotation(annotation_id):
    conn = database.get_connection()
    try:
        # Grab nesso_event_id BEFORE the local delete so we can mirror after.
        row = conn.execute(
            "SELECT nesso_event_id FROM annotations WHERE id = ?", (annotation_id,)
        ).fetchone()
        conn.execute("DELETE FROM annotations WHERE id = ?", (annotation_id,))
        conn.commit()
        if row and row["nesso_event_id"]:
            try:
                nesso_events.delete_label(event_id=row["nesso_event_id"])
            except Exception as e:
                log.warning("nesso mirror delete failed for annotation %s: %s",
                            annotation_id, e)
        return jsonify({'deleted': True})
    finally:
        conn.close()


@bp.route('/bulk', methods=['POST'])
def bulk_create_annotations():
    # Note: bulk insert path is currently for model-produced predictions
    # (source='model'), so we deliberately do NOT mirror these to nesso —
    # nesso's training corpus would echo model output back as ground
    # truth. If/when we need model predictions in nesso, add a sync.

    data = request.get_json()
    annotations = data.get('annotations', [])
    conn = database.get_connection()
    try:
        ids = []
        for a in annotations:
            cur = conn.execute(
                """INSERT INTO annotations (recording_id, project_id, label_name,
                   start_ns, end_ns, confidence, source)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    a['recording_id'],
                    a['project_id'],
                    a['label_name'],
                    a['start_ns'],
                    a['end_ns'],
                    a.get('confidence'),
                    a.get('source', 'model'),
                ),
            )
            ids.append(cur.lastrowid)
        conn.commit()
        return jsonify({'ids': ids, 'count': len(ids)}), 201
    finally:
        conn.close()
