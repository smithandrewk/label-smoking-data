export interface Dataset {
  id: number;
  name: string;
  source_format: string;
  source_path: string | null;
  sample_rate_hz: number;
  channel_count: number;
  channel_names: string;
  channel_units: string | null;
  content_hash: string | null;
  metadata: string | null;
  created_at: string;
}

export interface Recording {
  id: number;
  dataset_id: number;
  participant_id: number | null;
  name: string;
  data_path: string;
  sample_count: number;
  start_ns: number;
  end_ns: number;
  duration_seconds: number;
  participant_code: string | null;
  dataset_name: string | null;
  channel_names?: string;
  sample_rate_hz?: number;
  metadata: string | null;
  created_at: string;
}

export interface RecordingData {
  recording_id: number;
  timestamps: number[];
  channels: Record<string, number[]>;
  channel_names: string[];
  sample_rate_hz: number;
  total_samples: number;
  returned_samples: number;
}

export interface Annotation {
  id: number;
  recording_id: number;
  project_id: number;
  label_name: string;
  start_ns: number;
  end_ns: number;
  confidence: number | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface LabelDef {
  name: string;
  color: string;
}

export interface Project {
  id: number;
  name: string;
  description: string | null;
  label_schema: LabelDef[];
  recording_count?: number;
  created_at: string;
}

export interface DetectResult {
  format: string | null;
  recordings_found?: number;
  recording_ids?: string[];
  available_formats?: string[];
  message?: string;
}

export interface ImportResult {
  dataset_id: number;
  dataset_name: string;
  recordings_imported: number;
  format?: string;
  duplicate: boolean;
  message?: string;
}
