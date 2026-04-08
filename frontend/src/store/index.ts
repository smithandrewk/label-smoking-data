import { create } from 'zustand';
import type { LabelDef } from '../types';

interface AppState {
  // Navigation
  selectedProjectId: number | null;
  selectedRecordingId: number | null;
  selectedDatasetId: number | null;
  sidebarView: 'projects' | 'datasets' | 'import';
  setSelectedProject: (id: number | null) => void;
  setSelectedRecording: (id: number | null) => void;
  setSelectedDataset: (id: number | null) => void;
  setSidebarView: (view: 'projects' | 'datasets' | 'import') => void;

  // Annotation mode
  activeLabel: LabelDef | null;
  annotationMode: 'select' | 'add';
  setActiveLabel: (label: LabelDef | null) => void;
  setAnnotationMode: (mode: 'select' | 'add') => void;

  // Pending annotation (click start, drag end)
  pendingAnnotation: { startSec: number } | null;
  setPendingAnnotation: (pending: { startSec: number } | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedProjectId: null,
  selectedRecordingId: null,
  selectedDatasetId: null,
  sidebarView: 'datasets',
  setSelectedProject: (id) => set({ selectedProjectId: id }),
  setSelectedRecording: (id) => set({ selectedRecordingId: id }),
  setSelectedDataset: (id) => set({ selectedDatasetId: id }),
  setSidebarView: (view) => set({ sidebarView: view }),

  activeLabel: null,
  annotationMode: 'select',
  setActiveLabel: (label) => set({ activeLabel: label, annotationMode: label ? 'add' : 'select' }),
  setAnnotationMode: (mode) => set({ annotationMode: mode }),

  pendingAnnotation: null,
  setPendingAnnotation: (pending) => set({ pendingAnnotation: pending }),
}));
