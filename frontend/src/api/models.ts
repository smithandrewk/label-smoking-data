import api from './client';

export interface Model {
  id: number;
  name: string;
  py_path: string;
  weights_path: string;
  class_name: string;
  settings: Record<string, unknown>;
  is_active: number;
  created_at: string;
}

export const listModels = () =>
  api.get<Model[]>('/models').then((r) => r.data);

export const getModel = (id: number) =>
  api.get<Model>(`/models/${id}`).then((r) => r.data);

export const registerModel = (data: {
  name: string;
  py_path: string;
  weights_path: string;
  class_name: string;
  settings?: Record<string, unknown>;
}) => api.post<{ id: number; name: string }>('/models', data).then((r) => r.data);

export const scoreRecording = (modelId: number, recordingId: number, data: {
  project_id: number;
  label_name?: string;
  device?: string;
}) => api.post<{ scoring_id: string }>(`/models/${modelId}/score/${recordingId}`, data).then((r) => r.data);

export const getScoringStatus = (scoringId: string) =>
  api.get<{
    status: string;
    annotations_created?: number;
    error?: string;
  }>(`/models/score-status/${scoringId}`).then((r) => r.data);

export const getGpuStatus = () =>
  api.get<{ gpu_available: boolean }>('/models/gpu-status').then((r) => r.data);
