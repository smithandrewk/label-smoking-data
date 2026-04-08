from flask import Blueprint, request, jsonify, Response
from ..services import export_service

bp = Blueprint('exports', __name__, url_prefix='/api/export')


@bp.route('/project/<int:project_id>', methods=['GET'])
def export_project(project_id):
    fmt = request.args.get('format', 'json')
    label = request.args.get('label')
    try:
        result = export_service.export_project_annotations(project_id, fmt, label)
        if fmt == 'csv':
            return Response(
                result,
                mimetype='text/csv',
                headers={'Content-Disposition': f'attachment; filename=project_{project_id}_annotations.csv'},
            )
        return jsonify(result)
    except ValueError as e:
        return jsonify({'error': str(e)}), 404


@bp.route('/recording/<int:recording_id>', methods=['GET'])
def export_recording(recording_id):
    fmt = request.args.get('format', 'json')
    project_id = request.args.get('project_id', type=int)
    try:
        result = export_service.export_recording_annotations(recording_id, project_id, fmt)
        if fmt == 'csv':
            return Response(
                result,
                mimetype='text/csv',
                headers={'Content-Disposition': f'attachment; filename=recording_{recording_id}_annotations.csv'},
            )
        return jsonify(result)
    except ValueError as e:
        return jsonify({'error': str(e)}), 404
