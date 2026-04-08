from flask import Blueprint, request, jsonify
from .. import database
import json

bp = Blueprint('projects', __name__, url_prefix='/api/projects')


@bp.route('', methods=['GET'])
def list_projects():
    conn = database.get_connection()
    try:
        rows = conn.execute("SELECT * FROM projects ORDER BY created_at DESC").fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d['label_schema'] = json.loads(d['label_schema']) if d['label_schema'] else []
            result.append(d)
        return jsonify(result)
    finally:
        conn.close()


@bp.route('', methods=['POST'])
def create_project():
    data = request.get_json()
    name = data.get('name')
    description = data.get('description', '')
    label_schema = data.get('label_schema', [])

    if not name:
        return jsonify({'error': 'name is required'}), 400

    conn = database.get_connection()
    try:
        cur = conn.execute(
            "INSERT INTO projects (name, description, label_schema) VALUES (?, ?, ?)",
            (name, description, json.dumps(label_schema)),
        )
        conn.commit()
        return jsonify({'id': cur.lastrowid, 'name': name}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 400
    finally:
        conn.close()


@bp.route('/<int:project_id>', methods=['GET'])
def get_project(project_id):
    conn = database.get_connection()
    try:
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not row:
            return jsonify({'error': 'Not found'}), 404
        d = dict(row)
        d['label_schema'] = json.loads(d['label_schema']) if d['label_schema'] else []
        # Get recording count
        count = conn.execute(
            "SELECT COUNT(*) as c FROM project_recordings WHERE project_id = ?",
            (project_id,),
        ).fetchone()['c']
        d['recording_count'] = count
        return jsonify(d)
    finally:
        conn.close()


@bp.route('/<int:project_id>', methods=['PUT'])
def update_project(project_id):
    data = request.get_json()
    conn = database.get_connection()
    try:
        updates = []
        params = []
        if 'name' in data:
            updates.append('name = ?')
            params.append(data['name'])
        if 'description' in data:
            updates.append('description = ?')
            params.append(data['description'])
        if 'label_schema' in data:
            updates.append('label_schema = ?')
            params.append(json.dumps(data['label_schema']))
        if not updates:
            return jsonify({'error': 'No fields to update'}), 400
        params.append(project_id)
        conn.execute(f"UPDATE projects SET {', '.join(updates)} WHERE id = ?", params)
        conn.commit()
        return jsonify({'updated': True})
    finally:
        conn.close()


@bp.route('/<int:project_id>/recordings', methods=['POST'])
def add_recordings_to_project(project_id):
    data = request.get_json()
    recording_ids = data.get('recording_ids', [])
    conn = database.get_connection()
    try:
        for rid in recording_ids:
            conn.execute(
                "INSERT OR IGNORE INTO project_recordings (project_id, recording_id) VALUES (?, ?)",
                (project_id, rid),
            )
        conn.commit()
        return jsonify({'added': len(recording_ids)})
    finally:
        conn.close()


@bp.route('/<int:project_id>', methods=['DELETE'])
def delete_project(project_id):
    conn = database.get_connection()
    try:
        conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()
        return jsonify({'deleted': True})
    finally:
        conn.close()
