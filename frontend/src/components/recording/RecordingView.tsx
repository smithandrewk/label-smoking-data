import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRecording, getRecordingData, listRecordings, syncNessoLabels } from '../../api/recordings';
import { listAnnotations, createAnnotation, deleteAnnotation, updateAnnotation } from '../../api/annotations';
import { getProject, updateProject } from '../../api/projects';
import { useAppStore } from '../../store';
import { TimeSeriesPlot } from '../visualization/TimeSeriesPlot';
import { AnnotationToolbar } from '../visualization/AnnotationToolbar';
import { ModelScorer } from '../model/ModelScorer';
import { ExportButton } from '../export/ExportButton';
import { KeyboardHelp } from '../layout/KeyboardHelp';
import type { Annotation, LabelDef } from '../../types';

interface Props {
  recordingId: number;
}

export function RecordingView({ recordingId }: Props) {
  const { setSelectedRecording, setActiveLabel, selectedProjectId, selectedDatasetId, activeLabel, setPendingAnnotation } = useAppStore();
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<number | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [plotFullscreen, setPlotFullscreen] = useState(false);
  // Vim-style two-press confirm for `d` delete.
  const [pendingDelete, setPendingDelete] = useState(false);
  // Current chart x-axis viewport (seconds since recording start), updated
  // by TimeSeriesPlot on zoom/pan. Used to compute the bulk-relabel target.
  const [viewport, setViewport] = useState<{ start: number; end: number } | null>(null);
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

  // Keyboard navigation + shortcuts. See KeyboardHelp for the canonical list.
  const labelSchemaRef = useRef<LabelDef[]>([]);
  labelSchemaRef.current = project?.label_schema || [];
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      // Modifier-only presses, no-op
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Help modal toggle
      if (e.key === '?') {
        setHelpOpen((v) => !v);
        return;
      }

      // Navigation: arrows + n/p aliases
      if ((e.key === 'ArrowLeft' || e.key === 'p') && prevRecording) {
        setSelectedRecording(prevRecording.id);
        return;
      }
      if ((e.key === 'ArrowRight' || e.key === 'n') && nextRecording) {
        setSelectedRecording(nextRecording.id);
        return;
      }

      // Escape: clear modal/selection/pending
      if (e.key === 'Escape') {
        setHelpOpen(false);
        setSelectedAnnotationId(null);
        setPendingAnnotation(null);
        setPendingDelete(false);
        return;
      }

      // Fullscreen toggle for the plot
      if (e.key === 'f') {
        setPlotFullscreen((v) => !v);
        return;
      }

      // 1-9: activate label chip by index. 0: deactivate.
      if (/^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        const chip = labelSchemaRef.current[idx];
        if (chip) setActiveLabel(activeLabel?.name === chip.name ? null : chip);
        return;
      }
      if (e.key === '0') {
        setActiveLabel(null);
        return;
      }

      // Delete: Backspace/Delete immediate; `d` is vim-style two-press confirm
      if (selectedAnnotationId !== null) {
        if (e.key === 'Backspace' || e.key === 'Delete') {
          deleteMutation.mutate(selectedAnnotationId);
          setPendingDelete(false);
          return;
        }
        if (e.key === 'd') {
          if (pendingDelete) {
            deleteMutation.mutate(selectedAnnotationId);
            setPendingDelete(false);
          } else {
            setPendingDelete(true);
            window.setTimeout(() => setPendingDelete(false), 1500);
          }
          return;
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [prevRecording, nextRecording, selectedAnnotationId, activeLabel, pendingDelete, setActiveLabel, setSelectedRecording, setPendingAnnotation]);

  const labelSchema: LabelDef[] = project?.label_schema || [];

  // Toast for mutation failures. Cleared on next success.
  const [mutationError, setMutationError] = useState<string | null>(null);

  const annotationsKey = useMemo(
    () => ['annotations', { recording_id: recordingId, project_id: projectId }] as const,
    [recordingId, projectId],
  );

  type CreateInput = Parameters<typeof createAnnotation>[0];
  const createMutation = useMutation({
    mutationFn: createAnnotation,
    // Optimistic: insert a temp row with negative id, swap on success.
    onMutate: async (vars: CreateInput) => {
      await queryClient.cancelQueries({ queryKey: ['annotations'] });
      const prev = queryClient.getQueryData<Annotation[]>(annotationsKey);
      const tempId = -Math.floor(Math.random() * 1e9);
      const optimistic: Annotation = {
        id: tempId,
        recording_id: vars.recording_id,
        project_id: vars.project_id,
        label_name: vars.label_name,
        start_ns: vars.start_ns,
        end_ns: vars.end_ns,
        confidence: null,
        source: vars.source || 'manual',
        nesso_event_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      queryClient.setQueryData<Annotation[]>(annotationsKey, (old) => [
        ...(old || []),
        optimistic,
      ]);
      return { prev, tempId };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(annotationsKey, ctx.prev);
      setMutationError(`Save failed: ${(err as Error).message}`);
    },
    onSuccess: () => {
      setMutationError(null);
      queryClient.invalidateQueries({ queryKey: ['annotations'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAnnotation,
    // Optimistic remove with rollback on failure.
    onMutate: async (id: number) => {
      await queryClient.cancelQueries({ queryKey: ['annotations'] });
      const prev = queryClient.getQueryData<Annotation[]>(annotationsKey);
      queryClient.setQueryData<Annotation[]>(annotationsKey, (old) =>
        (old || []).filter((a) => a.id !== id),
      );
      return { prev };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(annotationsKey, ctx.prev);
      setMutationError(`Delete failed: ${(err as Error).message}`);
    },
    onSuccess: () => {
      setSelectedAnnotationId(null);
      setMutationError(null);
      queryClient.invalidateQueries({ queryKey: ['annotations'] });
    },
  });

  const updateProjectMutation = useMutation({
    mutationFn: (data: { label_schema: LabelDef[] }) => updateProject(projectId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });

  // Annotations whose midpoint falls in the current viewport AND whose
  // label_name is not the active label (the targets of a bulk relabel).
  const t0 = recordingData?.timestamps[0] || 0;
  const visibleRelabelTargets = useMemo(() => {
    if (!viewport || !activeLabel || !annotations) return [] as Annotation[];
    return annotations.filter((a) => {
      const midSec = ((a.start_ns + a.end_ns) / 2 - t0) / 1e9;
      return (
        midSec >= viewport.start &&
        midSec <= viewport.end &&
        a.label_name !== activeLabel.name
      );
    });
  }, [annotations, viewport, activeLabel, t0]);

  const bulkRelabelMutation = useMutation({
    mutationFn: async ({ ids, label }: { ids: number[]; label: string }) => {
      await Promise.all(
        ids.map((id) => updateAnnotation(id, { label_name: label })),
      );
      return ids.length;
    },
    onSuccess: () => {
      setMutationError(null);
      queryClient.invalidateQueries({ queryKey: ['annotations'] });
    },
    onError: (err) => {
      setMutationError(`Bulk relabel failed: ${(err as Error).message}`);
    },
  });

  const handleBulkRelabel = useCallback(() => {
    if (!activeLabel || visibleRelabelTargets.length === 0) return;
    const n = visibleRelabelTargets.length;
    const confirmed = window.confirm(
      `Relabel ${n} visible bout${n === 1 ? '' : 's'} to "${activeLabel.name}"?\n\nMirrors to nesso for any nesso-imported recording.`,
    );
    if (!confirmed) return;
    bulkRelabelMutation.mutate({
      ids: visibleRelabelTargets.map((a) => a.id),
      label: activeLabel.name,
    });
  }, [activeLabel, visibleRelabelTargets, bulkRelabelMutation]);

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
            <span style={{ fontSize: 12, color: '#9ca3af' }}>
              {currentIndex + 1} / {siblingRecordings.length}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {recording && (
            <div style={{ fontSize: 13, color: '#6b7280' }}>
              {recording.sample_count.toLocaleString()} samples
              &middot; {formatDuration(recording.duration_seconds)}
              &middot; {recording.sample_rate_hz}Hz
            </div>
          )}
          {annotations && (
            <span
              className="badge"
              data-testid="annotation-count"
              title="Annotations on this recording (current project)"
              style={{
                background: '#dbeafe', color: '#1d4ed8',
                fontWeight: 500,
              }}
            >
              {annotations.length} label{annotations.length === 1 ? '' : 's'}
              {(createMutation.isPending || deleteMutation.isPending) && ' · saving…'}
            </span>
          )}
          <button
            className="btn btn-sm"
            title="Keyboard shortcuts (?)"
            data-testid="open-keyboard-help"
            onClick={() => setHelpOpen(true)}
          >
            ?
          </button>
        </div>
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
                {activeLabel && visibleRelabelTargets.length > 0 && (
                  <button
                    className="btn btn-sm"
                    data-testid="bulk-relabel"
                    disabled={bulkRelabelMutation.isPending}
                    style={{
                      background: activeLabel.color + '22',
                      borderColor: activeLabel.color,
                      color: '#1f2937',
                    }}
                    title={`Relabel ${visibleRelabelTargets.length} visible bouts to "${activeLabel.name}"`}
                    onClick={handleBulkRelabel}
                  >
                    {bulkRelabelMutation.isPending
                      ? `Relabeling ${visibleRelabelTargets.length}…`
                      : `Relabel ${visibleRelabelTargets.length} visible → ${activeLabel.name}`}
                  </button>
                )}
                {syncStatus && (
                  <span
                    data-testid="sync-status"
                    style={{ fontSize: 12, color: '#6b7280' }}
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
          <div style={{ color: '#9ca3af', padding: 40, textAlign: 'center' }}>
            Loading signal data...
          </div>
        ) : recordingData ? (
          <div
            data-testid="plot-fullscreen-wrap"
            style={
              plotFullscreen
                ? {
                    position: 'fixed', inset: 0, zIndex: 900,
                    background: '#ffffff', padding: 20, overflow: 'auto',
                  }
                : undefined
            }
          >
            {plotFullscreen && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <button
                  className="btn btn-sm"
                  onClick={() => setPlotFullscreen(false)}
                  title="Exit fullscreen (f)"
                >
                  ⤡ Exit fullscreen
                </button>
              </div>
            )}
            <TimeSeriesPlot
              data={recordingData}
              annotations={annotations || []}
              labelSchema={labelSchema}
              selectedAnnotationId={selectedAnnotationId}
              onSelectAnnotation={setSelectedAnnotationId}
              onAddAnnotation={handleAddAnnotation}
              onViewportChange={(start, end) => setViewport({ start, end })}
            />
          </div>
        ) : null}

        {pendingDelete && selectedAnnotationId !== null && (
          <div
            data-testid="pending-delete-hint"
            style={{
              position: 'fixed', bottom: 20, right: 20, zIndex: 800,
              background: '#1f2937', color: '#fde68a',
              padding: '8px 14px', borderRadius: 6, fontSize: 13,
              boxShadow: '0 6px 16px rgba(15,23,42,0.18)',
            }}
          >
            Press <code>d</code> again to delete · Esc to cancel
          </div>
        )}

        {mutationError && (
          <div
            data-testid="mutation-error"
            role="alert"
            style={{
              position: 'fixed', bottom: 20, left: 20, zIndex: 800,
              background: '#fef2f2', color: '#991b1b',
              border: '1px solid #fecaca', borderRadius: 6,
              padding: '8px 14px', fontSize: 13,
              boxShadow: '0 6px 16px rgba(15,23,42,0.18)',
              maxWidth: 460,
            }}
          >
            {mutationError}
            <button
              className="btn btn-sm"
              style={{ marginLeft: 12 }}
              onClick={() => setMutationError(null)}
            >
              dismiss
            </button>
          </div>
        )}

        <KeyboardHelp open={helpOpen} onClose={() => setHelpOpen(false)} />

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
                            style={{ color: '#dc2626', padding: '2px 6px' }}
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
