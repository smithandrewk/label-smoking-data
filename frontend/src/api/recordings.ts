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
