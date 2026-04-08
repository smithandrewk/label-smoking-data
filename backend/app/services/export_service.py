"""Export annotations and recording data in various formats."""
from __future__ import annotations
import csv
import io
import json
from .. import database


def export_project_annotations(project_id: int, format: str = 'json',
                                label_filter: str | None = None) -> str | dict:
    """Export all annotations for a project.

    Returns JSON string or CSV string depending on format.
    """
    conn = database.get_connection()
    try:
        project = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not project:
            raise ValueError(f"Project {project_id} not found")

        query = """
            SELECT a.*, r.name as recording_name, r.sample_count, r.start_ns as rec_start_ns,
                   r.end_ns as rec_end_ns, p.code as participant_code, d.name as dataset_name
            FROM annotations a
            JOIN recordings r ON a.recording_id = r.id
            LEFT JOIN participants p ON r.participant_id = p.id
            LEFT JOIN datasets d ON r.dataset_id = d.id
            WHERE a.project_id = ?
        """
        params = [project_id]
        if label_filter:
            query += " AND a.label_name = ?"
            params.append(label_filter)
        query += " ORDER BY r.name, a.start_ns"

        rows = conn.execute(query, params).fetchall()
        annotations = [dict(r) for r in rows]
    finally:
        conn.close()

    if format == 'csv':
        return _to_csv(annotations)
    else:
        return _to_json(annotations, project)


def export_recording_annotations(recording_id: int, project_id: int | None = None,
                                  format: str = 'json') -> str | dict:
    """Export annotations for a single recording."""
    conn = database.get_connection()
    try:
        rec = conn.execute(
            """SELECT r.*, p.code as participant_code, d.name as dataset_name
               FROM recordings r
               LEFT JOIN participants p ON r.participant_id = p.id
               LEFT JOIN datasets d ON r.dataset_id = d.id
               WHERE r.id = ?""",
            (recording_id,),
        ).fetchone()
        if not rec:
            raise ValueError(f"Recording {recording_id} not found")

        query = "SELECT * FROM annotations WHERE recording_id = ?"
        params = [recording_id]
        if project_id:
            query += " AND project_id = ?"
            params.append(project_id)
        query += " ORDER BY start_ns"

        rows = conn.execute(query, params).fetchall()
        annotations = [dict(r) for r in rows]
    finally:
        conn.close()

    if format == 'csv':
        return _to_csv(annotations)
    else:
        return {
            'recording': {
                'id': rec['id'],
                'name': rec['name'],
                'participant': rec['participant_code'],
                'dataset': rec['dataset_name'],
                'sample_count': rec['sample_count'],
                'start_ns': rec['start_ns'],
                'end_ns': rec['end_ns'],
            },
            'annotations': [
                {
                    'label': a['label_name'],
                    'start_ns': a['start_ns'],
                    'end_ns': a['end_ns'],
                    'duration_s': round((a['end_ns'] - a['start_ns']) / 1e9, 3),
                    'source': a['source'],
                }
                for a in annotations
            ],
        }


def _to_json(annotations: list[dict], project) -> dict:
    """Format annotations as a structured JSON export."""
    # Group by recording
    by_recording: dict[str, list] = {}
    for a in annotations:
        key = a['recording_name']
        if key not in by_recording:
            by_recording[key] = {
                'recording_name': a['recording_name'],
                'participant': a.get('participant_code'),
                'dataset': a.get('dataset_name'),
                'annotations': [],
            }
        by_recording[key]['annotations'].append({
            'label': a['label_name'],
            'start_ns': a['start_ns'],
            'end_ns': a['end_ns'],
            'duration_s': round((a['end_ns'] - a['start_ns']) / 1e9, 3),
            'source': a['source'],
        })

    return {
        'project': project['name'] if project else None,
        'total_annotations': len(annotations),
        'recordings': list(by_recording.values()),
    }


def _to_csv(annotations: list[dict]) -> str:
    """Format annotations as CSV string."""
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        'recording_name', 'participant', 'dataset', 'label',
        'start_ns', 'end_ns', 'duration_s', 'source',
    ])
    for a in annotations:
        writer.writerow([
            a.get('recording_name', ''),
            a.get('participant_code', ''),
            a.get('dataset_name', ''),
            a['label_name'],
            a['start_ns'],
            a['end_ns'],
            round((a['end_ns'] - a['start_ns']) / 1e9, 3),
            a['source'],
        ])
    return output.getvalue()
