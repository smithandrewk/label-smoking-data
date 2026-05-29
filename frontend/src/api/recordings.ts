import api from './client';
import type { Recording, RecordingData } from '../types';

export const listRecordings = (params?: { dataset_id?: number; project_id?: number }) =>
  api.get<Recording[]>('/recordings', { params }).then((r) => r.data);

export const getRecording = (id: number) =>
  api.get<Recording>(`/recordings/${id}`).then((r) => r.data);

export const getRecordingData = (
  id: number,
  params?: { start_ns?: number; end_ns?: number; max_points?: number }
) =>
  api.get<RecordingData>(`/recordings/${id}/data`, { params }).then((r) => r.data);

export interface NessoSyncResult {
  inserted: number;
  skipped_existing: number;
  details: Array<{
    action: 'inserted' | 'skipped_existing';
    annotation_id?: number;
    nesso_event_id: string;
    label_name?: string;
    labeler?: string;
  }>;
}

export const syncNessoLabels = (id: number, projectId: number) =>
  api
    .post<NessoSyncResult>(`/recordings/${id}/sync_nesso_labels`, { project_id: projectId })
    .then((r) => r.data);
