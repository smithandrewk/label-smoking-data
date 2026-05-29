from flask import Blueprint, request, jsonify
from ..services import import_service
from ..adapters import get_default_registry
from .. import database
import json

bp = Blueprint('datasets', __name__, url_prefix='/api/datasets')
registry = get_default_registry()


@bp.route('', methods=['GET'])
def list_datasets():
    conn = database.get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM datasets ORDER BY created_at DESC"
        ).fetchall()
        return jsonify([dict(r) for r in rows])
    finally:
        conn.close()


@bp.route('/<int:dataset_id>', methods=['GET'])
def get_dataset(dataset_id):
    conn = database.get_connection()
    try:
        row = conn.execute("SELECT * FROM datasets WHERE id = ?", (dataset_id,)).fetchone()
        if not row:
            return jsonify({'error': 'Not found'}), 404
        return jsonify(dict(row))
    finally:
        conn.close()


@bp.route('/detect', methods=['POST'])
def detect_format():
    data = request.get_json()
    path = data.get('path', '')
    adapter = registry.detect(path)
    if adapter:
        recordings = adapter.scan(path)
        return jsonify({
            'format': adapter.format_name,
            'recordings_found': len(recordings),
            'recording_ids': recordings[:50],  # Cap preview at 50
        })
    return jsonify({
        'format': None,
        'available_formats': registry.list_formats(),
        'message': 'No adapter could detect the format. Please specify manually.',
    })


@bp.route('/import', methods=['POST'])
def import_dataset():
    data = request.get_json()
    path = data.get('path')
    name = data.get('name')
    format_hint = data.get('format')

    if not path or not name:
        return jsonify({'error': 'path and name are required'}), 400

    try:
        result = import_service.import_dataset(path, name, registry, format_hint)
        return jsonify(result), 201 if not result['duplicate'] else 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/import_nesso', methods=['POST'])
def import_nesso():
    """Import a (device_id, time window) slice from nesso's Postgres.

    Body: {"device_id": "<uuid>", "since": "<iso8601>", "until": "<iso8601>", "name": "..."}
    Builds the nesso:// URI for NessoPgAdapter and reuses the standard
    import pipeline.
    """
    data = request.get_json() or {}
    device_id = data.get('device_id')
    since = data.get('since')
    until = data.get('until')
    name = data.get('name')
    if not all([device_id, since, until, name]):
        return jsonify({'error': 'device_id, since, until, name are required'}), 400
    uri = f"nesso://{device_id}?since={since}&until={until}"
    try:
        result = import_service.import_dataset(uri, name, registry, format_hint='nesso_pg')
        return jsonify(result), 201 if not result['duplicate'] else 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/<int:dataset_id>', methods=['DELETE'])
def delete_dataset(dataset_id):
    conn = database.get_connection()
    try:
        conn.execute("DELETE FROM datasets WHERE id = ?", (dataset_id,))
        conn.commit()
        return jsonify({'deleted': True})
    finally:
        conn.close()
