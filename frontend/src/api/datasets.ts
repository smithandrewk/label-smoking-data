import api from './client';
import type { Dataset, DetectResult, ImportResult } from '../types';

export const listDatasets = () =>
  api.get<Dataset[]>('/datasets').then((r) => r.data);

export const getDataset = (id: number) =>
  api.get<Dataset>(`/datasets/${id}`).then((r) => r.data);

export const detectFormat = (path: string) =>
  api.post<DetectResult>('/datasets/detect', { path }).then((r) => r.data);

export const importDataset = (path: string, name: string, format?: string) =>
  api.post<ImportResult>('/datasets/import', { path, name, format }).then((r) => r.data);

export const deleteDataset = (id: number) =>
  api.delete(`/datasets/${id}`).then((r) => r.data);

export interface NessoDevice {
  id: string;
  friendly_name: string | null;
  imu_sample_count: number;
  imu_earliest: string | null;
  imu_latest: string | null;
}

export const listNessoDevices = () =>
  api.get<NessoDevice[]>('/nesso/devices').then((r) => r.data);

export const importNessoWindow = (params: {
  device_id: string;
  since: string;
  until: string;
  name: string;
}) =>
  api.post<ImportResult>('/datasets/import_nesso', params).then((r) => r.data);
