import { useState } from 'react';
import { useAppStore } from '../../store';
import type { LabelDef, Annotation } from '../../types';

const DEFAULT_COLORS = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f7dc6f', '#b39ddb', '#f06292', '#81c784', '#ffb74d'];

interface Props {
  labelSchema: LabelDef[];
  annotations: Annotation[];
  onAddLabel: (label: LabelDef) => void;
  onRemoveLabel: (name: string) => void;
  onDeleteAnnotation: (id: number) => void;
  selectedAnnotationId: number | null;
}

export function AnnotationToolbar({
  labelSchema,
  annotations,
  onAddLabel,
  onDeleteAnnotation,
  selectedAnnotationId,
}: Props) {
  const { activeLabel, setActiveLabel, annotationMode } = useAppStore();
  const [showAddLabel, setShowAddLabel] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');

  const handleAddLabel = () => {
    if (!newLabelName.trim()) return;
    const colorIdx = labelSchema.length % DEFAULT_COLORS.length;
    onAddLabel({ name: newLabelName.trim(), color: DEFAULT_COLORS[colorIdx] });
    setNewLabelName('');
    setShowAddLabel(false);
  };

  const annotationCounts: Record<string, number> = {};
  for (const ann of annotations) {
    annotationCounts[ann.label_name] = (annotationCounts[ann.label_name] || 0) + 1;
  }

  return (
    <div className="annotation-toolbar">
      <span style={{ fontSize: 12, color: '#6b7280', marginRight: 4 }}>Labels:</span>

      {labelSchema.map((label) => (
        <div
          key={label.name}
          className={`label-chip ${activeLabel?.name === label.name ? 'active' : ''}`}
          style={{ background: label.color + '33' }}
          onClick={() => setActiveLabel(activeLabel?.name === label.name ? null : label)}
        >
          <span className="label-dot" style={{ background: label.color }} />
          <span>{label.name}</span>
          {annotationCounts[label.name] && (
            <span style={{ opacity: 0.6 }}>({annotationCounts[label.name]})</span>
          )}
        </div>
      ))}

      {showAddLabel ? (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Label name"
            value={newLabelName}
            onChange={(e) => setNewLabelName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddLabel()}
            style={{
              padding: '3px 8px', fontSize: 12, background: '#ffffff',
              border: '1px solid #d1d5db', borderRadius: 4, color: '#1f2937', width: 120,
            }}
            autoFocus
          />
          <button className="btn btn-sm btn-primary" onClick={handleAddLabel}>Add</button>
          <button className="btn btn-sm" onClick={() => setShowAddLabel(false)}>Cancel</button>
        </div>
      ) : (
        <button className="btn btn-sm" onClick={() => setShowAddLabel(true)}>+ Label</button>
      )}

      <div style={{ flex: 1 }} />

      {annotationMode === 'add' && activeLabel && (
        <span style={{ fontSize: 12, color: '#2563eb' }}>
          Click plot to place annotation start, click again for end
        </span>
      )}

      {selectedAnnotationId && (
        <button
          className="btn btn-sm"
          style={{ color: '#dc2626', borderColor: '#fca5a5' }}
          onClick={() => onDeleteAnnotation(selectedAnnotationId)}
        >
          Delete Selected
        </button>
      )}

      <span style={{ fontSize: 11, color: '#9ca3af' }}>
        {annotations.length} annotation{annotations.length !== 1 ? 's' : ''}
      </span>
    </div>
  );
}
