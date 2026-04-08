import api from './client';
import type { Project, LabelDef } from '../types';

export const listProjects = () =>
  api.get<Project[]>('/projects').then((r) => r.data);

export const getProject = (id: number) =>
  api.get<Project>(`/projects/${id}`).then((r) => r.data);

export const createProject = (name: string, description?: string, label_schema?: LabelDef[]) =>
  api.post<{ id: number; name: string }>('/projects', { name, description, label_schema }).then((r) => r.data);

export const updateProject = (id: number, data: Partial<Project>) =>
  api.put(`/projects/${id}`, data).then((r) => r.data);

export const addRecordingsToProject = (projectId: number, recordingIds: number[]) =>
  api.post(`/projects/${projectId}/recordings`, { recording_ids: recordingIds }).then((r) => r.data);

export const deleteProject = (id: number) =>
  api.delete(`/projects/${id}`).then((r) => r.data);
