import { useState, useCallback, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRecording, getRecordingData, listRecordings, syncNessoLabels } from '../../api/recordings';
import { listAnnotations, createAnnotation, deleteAnnotation } from '../../api/annotations';
import { getProject, updateProject } from '../../api/projects';
import { useAppStore } from '../../store';
import { TimeSeriesPlot } from '../visualization/TimeSeriesPlot';
import { AnnotationToolbar } from '../visualization/AnnotationToolbar';
import { ModelScorer } from '../model/ModelScorer';
import { ExportButton } from '../export/ExportButton';
import type { LabelDef } from '../../types';

interface Props {
  recordingId: number;
}

export function RecordingView({ recordingId }: Props) {
  const { setSelectedRecording, selectedProjectId, selectedDatasetId, activeLabel, setPendingAnnotation } = useAppStore();
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  // Get the project to use — default to __imported__ if no project selected
  const projectId = selectedProjectId;

  const { data: recording } = useQuery({
    queryKey: ['recording', recordingId],
    queryFn: () => getRecording(recordingId),
  });

  const { data: recordingData, isLoading: dataLoading } = useQuery({
    queryKey: ['recordingData', recordingId],
    queryFn: () => getRecordingData(recordingId, { max_points: 5000 }),
  });

  const { data: annotations } = useQuery({
    queryKey: ['annotations', { recording_id: recordingId, project_id: projectId }],
    queryFn: () => listAnnotations({ recording_id: recordingId, ...(projectId ? { project_id: projectId } : {}) }),
  });

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: !!projectId,
  });

  // Recording navigation: get sibling recordings
  const { data: siblingRecordings } = useQuery({
    queryKey: ['recordings', { datasetId: selectedDatasetId || recording?.dataset_id }],
    queryFn: () => listRecordings({ dataset_id: selectedDatasetId || recording?.dataset_id || undefined }),
    enabled: !!(selectedDatasetId || recording?.dataset_id),
  });

  const currentIndex = siblingRecordings?.findIndex((r) => r.id === recordingId) ?? -1;
  const prevRecording = currentIndex > 0 ? siblingRecordings![currentIndex - 1] : null;
  const nextRecording = currentIndex >= 0 && siblingRecordings && currentIndex < siblingRecordings.length - 1
    ? siblingRecordings[currentIndex + 1] : null;

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft' && prevRecording) {
        setSelectedRecording(prevRecording.id);
      } else if (e.key === 'ArrowRight' && nextRecording) {
        setSelectedRecording(nextRecording.id);
      } else if (e.key === 'Escape') {
        setSelectedAnnotationId(null);
        setPendingAnnotation(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAnnotationId) {
        deleteMutation.mutate(selectedAnnotationId);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [prevRecording, nextRecording, selectedAnnotationId]);

  const labelSchema: LabelDef[] = project?.label_schema || [];

  const createMutation = useMutation({
    mutationFn: createAnnotation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['annotations'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAnnotation,
    onSuccess: () => {
      setSelectedAnnotationId(null);
      queryClient.invalidateQueries({ queryKey: ['annotations'] });
    },
  });

  const updateProjectMutation = useMutation({
    mutationFn: (data: { label_schema: LabelDef[] }) => updateProject(projectId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });

  // Nesso-imported recordings expose their origin in metadata. We show
  // the "Sync from nesso" button only for those — non-nesso datasets
  // (smoking-detection etc.) don't have a device_id to pull from.
  const isNessoRecording = useMemo(() => {
    if (!recording?.metadata) return false;
    try {
      const m = JSON.parse(recording.metadata);
      return m?.source === 'nesso_pg' && typeof m?.device_id === 'string';
    } catch {
      return false;
    }
  }, [recording?.metadata]);

  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const syncNessoMutation = useMutation({
    mutationFn: () => syncNessoLabels(recordingId, projectId!),
    onSuccess: (result) => {
      const { inserted, skipped_existing } = result;
      setSyncStatus(
        inserted === 0
          ? `Up to date — ${skipped_existing} already imported.`
          : `Pulled ${inserted} new label${inserted === 1 ? '' : 's'} from nesso` +
            (skipped_existing > 0 ? ` (${skipped_existing} already present).` : '.'),
      );
      queryClient.invalidateQueries({ queryKey: ['annotations'] });
      window.setTimeout(() => setSyncStatus(null), 6000);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      setSyncStatus(`Sync failed: ${msg}`);
      window.setTimeout(() => setSyncStatus(null), 8000);
    },
  });

  const handleAddAnnotation = useCallback(
    (startSec: number, endSec: number) => {
      if (!activeLabel || !recordingData || !projectId) return;
      const t0 = recordingData.timestamps[0] || 0;
      createMutation.mutate({
        recording_id: recordingId,
        project_id: projectId,
        label_name: activeLabel.name,
        start_ns: Math.round(startSec * 1e9 + t0),
        end_ns: Math.round(endSec * 1e9 + t0),
        source: 'manual',
      });
    },
    [activeLabel, recordingData, projectId, recordingId]
  );

  const handleAddLabel = (label: LabelDef) => {
    if (!projectId) return;
    const newSchema = [...labelSchema, label];
    updateProjectMutation.mutate({ label_schema: newSchema });
  };

  const handleRemoveLabel = (name: string) => {
    if (!projectId) return;
    const newSchema = labelSchema.filter((l) => l.name !== name);
    updateProjectMutation.mutate({ label_schema: newSchema });
  };

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  return (
    <>
      <div className="main-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-sm" onClick={() => setSelectedRecording(null)}>
            &larr; Back
          </button>
          <button
            className="btn btn-sm"
            disabled={!prevRecording}
            onClick={() => prevRecording && setSelectedRecording(prevRecording.id)}
            title="Previous recording (Left arrow)"
          >
            &lsaquo;
          </button>
          <h2 style={{ margin: 0, fontSize: 16 }}>
            {recording?.name || `Recording #${recordingId}`}
          </h2>
          <button
            className="btn btn-sm"
            disabled={!nextRecording}
            onClick={() => nextRecording && setSelectedRecording(nextRecording.id)}
            title="Next recording (Right arrow)"
          >
            &rsaquo;
          </button>
          {recording?.participant_code && (
            <span className="badge">{recording.participant_code}</span>
          )}
          {siblingRecordings && currentIndex >= 0 && (
            <span style={{ fontSize: 12, color: '#555' }}>
              {currentIndex + 1} / {siblingRecordings.length}
            </span>
          )}
        </div>
        {recording && (
          <div style={{ fontSize: 13, color: '#888' }}>
            {recording.sample_count.toLocaleString()} samples
            &middot; {formatDuration(recording.duration_seconds)}
            &middot; {recording.sample_rate_hz}Hz
          </div>
        )}
      </div>
      <div className="main-content">
        {!projectId && (
          <div className="info-banner" style={{ background: '#2a2a1a', borderColor: '#4a4a2a' }}>
            Select a project in the sidebar to enable annotation editing.
            Showing all annotations from all projects.
          </div>
        )}

        {projectId && (
          <>
            <AnnotationToolbar
              labelSchema={labelSchema}
              annotations={annotations || []}
              onAddLabel={handleAddLabel}
              onRemoveLabel={handleRemoveLabel}
              onDeleteAnnotation={(id) => deleteMutation.mutate(id)}
              selectedAnnotationId={selectedAnnotationId}
            />
            <div className="annotation-toolbar" style={{ justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <ModelScorer recordingId={recordingId} projectId={projectId} />
                {isNessoRecording && (
                  <button
                    className="btn btn-sm"
                    data-testid="sync-nesso"
                    disabled={syncNessoMutation.isPending}
                    title="Pull existing label.* events from nesso for this recording's window"
                    onClick={() => syncNessoMutation.mutate()}
                  >
                    {syncNessoMutation.isPending ? 'Syncing…' : '⇣ Sync from nesso'}
                  </button>
                )}
                {syncStatus && (
                  <span
                    data-testid="sync-status"
                    style={{ fontSize: 12, color: '#888' }}
                  >
                    {syncStatus}
                  </span>
                )}
              </div>
              <ExportButton recordingId={recordingId} projectId={projectId} />
            </div>
          </>
        )}

        {dataLoading ? (
          <div style={{ color: '#666', padding: 40, textAlign: 'center' }}>
            Loading signal data...
          </div>
        ) : recordingData ? (
          <TimeSeriesPlot
            data={recordingData}
            annotations={annotations || []}
            labelSchema={labelSchema}
            selectedAnnotationId={selectedAnnotationId}
            onSelectAnnotation={setSelectedAnnotationId}
            onAddAnnotation={handleAddAnnotation}
          />
        ) : null}

        {annotations && annotations.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <table className="recording-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Start</th>
                  <th>End</th>
                  <th>Duration</th>
                  <th>Source</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {annotations.map((ann) => {
                  const t0 = recordingData?.timestamps[0] || 0;
                  const startSec = (ann.start_ns - t0) / 1e9;
                  const endSec = (ann.end_ns - t0) / 1e9;
                  const durSec = endSec - startSec;
                  const color = getLabelColor(ann.label_name, labelSchema);
                  return (
                    <tr
                      key={ann.id}
                      className={selectedAnnotationId === ann.id ? 'selected' : ''}
                      onClick={() => setSelectedAnnotationId(
                        selectedAnnotationId === ann.id ? null : ann.id
                      )}
                    >
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span className="label-dot" style={{ background: color }} />
                          {ann.label_name}
                        </span>
                      </td>
                      <td>{startSec.toFixed(2)}s</td>
                      <td>{endSec.toFixed(2)}s</td>
                      <td>{durSec.toFixed(2)}s</td>
                      <td><span className="badge">{ann.source}</span></td>
                      <td>
                        {projectId && (
                          <button
                            className="btn btn-sm"
                            style={{ color: '#ff6b6b', padding: '2px 6px' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteMutation.mutate(ann.id);
                            }}
                          >
                            &times;
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function getLabelColor(labelName: string, labelSchema: LabelDef[]): string {
  const def = labelSchema.find((l) => l.name === labelName);
  return def?.color || '#ffc864';
}
