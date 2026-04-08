import api from './client';

export const exportProjectAnnotations = (projectId: number, format: string = 'json', label?: string) => {
  const params: Record<string, string> = { format };
  if (label) params.label = label;
  return api.get(`/export/project/${projectId}`, { params, responseType: format === 'csv' ? 'blob' : 'json' })
    .then((r) => r.data);
};

export const exportRecordingAnnotations = (recordingId: number, format: string = 'json', projectId?: number) => {
  const params: Record<string, string | number> = { format };
  if (projectId) params.project_id = projectId;
  return api.get(`/export/recording/${recordingId}`, { params, responseType: format === 'csv' ? 'blob' : 'json' })
    .then((r) => r.data);
};
