from flask import Blueprint, request, jsonify
from .. import database

bp = Blueprint('annotations', __name__, url_prefix='/api/annotations')


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
        conn.commit()
        return jsonify({'id': cur.lastrowid}), 201
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
        return jsonify({'updated': True})
    finally:
        conn.close()


@bp.route('/<int:annotation_id>', methods=['DELETE'])
def delete_annotation(annotation_id):
    conn = database.get_connection()
    try:
        conn.execute("DELETE FROM annotations WHERE id = ?", (annotation_id,))
        conn.commit()
        return jsonify({'deleted': True})
    finally:
        conn.close()


@bp.route('/bulk', methods=['POST'])
def bulk_create_annotations():
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
