import api from './client';
import type { Annotation } from '../types';

export const listAnnotations = (params?: {
  recording_id?: number;
  project_id?: number;
  label?: string;
}) => api.get<Annotation[]>('/annotations', { params }).then((r) => r.data);

export const createAnnotation = (data: {
  recording_id: number;
  project_id: number;
  label_name: string;
  start_ns: number;
  end_ns: number;
  source?: string;
}) => api.post<{ id: number }>('/annotations', data).then((r) => r.data);

export const updateAnnotation = (id: number, data: Partial<Annotation>) =>
  api.put(`/annotations/${id}`, data).then((r) => r.data);

export const deleteAnnotation = (id: number) =>
  api.delete(`/annotations/${id}`).then((r) => r.data);
