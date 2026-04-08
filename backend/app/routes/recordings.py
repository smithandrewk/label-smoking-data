from flask import Blueprint, request, jsonify
from ..services import recording_service

bp = Blueprint('recordings', __name__, url_prefix='/api/recordings')


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
