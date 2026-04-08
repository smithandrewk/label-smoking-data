from flask import Blueprint, request, jsonify
from ..services import model_service

bp = Blueprint('models', __name__, url_prefix='/api/models')


@bp.route('', methods=['GET'])
def list_models():
    return jsonify(model_service.list_models())


@bp.route('/<int:model_id>', methods=['GET'])
def get_model(model_id):
    model = model_service.get_model(model_id)
    if not model:
        return jsonify({'error': 'Not found'}), 404
    return jsonify(model)


@bp.route('', methods=['POST'])
def register_model():
    data = request.get_json()
    required = ['name', 'py_path', 'weights_path', 'class_name']
    for field in required:
        if field not in data:
            return jsonify({'error': f'{field} is required'}), 400
    try:
        result = model_service.register_model(
            name=data['name'],
            py_path=data['py_path'],
            weights_path=data['weights_path'],
            class_name=data['class_name'],
            settings=data.get('settings'),
        )
        return jsonify(result), 201
    except (FileNotFoundError, ValueError) as e:
        return jsonify({'error': str(e)}), 400


@bp.route('/<int:model_id>/score/<int:recording_id>', methods=['POST'])
def score_recording(model_id, recording_id):
    data = request.get_json() or {}
    project_id = data.get('project_id')
    if not project_id:
        return jsonify({'error': 'project_id is required'}), 400
    try:
        result = model_service.score_recording(
            recording_id=recording_id,
            model_id=model_id,
            project_id=project_id,
            label_name=data.get('label_name', 'model_prediction'),
            device=data.get('device', 'cpu'),
        )
        return jsonify(result)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400


@bp.route('/score-status/<scoring_id>', methods=['GET'])
def scoring_status(scoring_id):
    return jsonify(model_service.get_scoring_status(scoring_id))


@bp.route('/gpu-status', methods=['GET'])
def gpu_status():
    return jsonify({'gpu_available': model_service.is_gpu_available()})
