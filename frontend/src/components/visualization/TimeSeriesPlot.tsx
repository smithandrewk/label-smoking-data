import { useCallback, useRef } from 'react';
// react-plotly.js 2.6's auto-bundled entry pulls plotly.js source tree
// (which references `self` + `buffer/` and crashes under React 19 + Vite).
// We use the factory + the pre-built dist-min Plotly bundle instead.
//
// Subtle: Rolldown's CJS-interop has been observed to swap the two
// imports' bundle slots in this exact pattern, emitting
// `Plotly(createPlotlyComponent)` instead of `createPlotlyComponent(Plotly)`.
// To stay correct regardless, we identify the factory vs the Plotly
// namespace at runtime — the factory is a function, the namespace is
// an object with `.newPlot`.
import * as factoryModule from 'react-plotly.js/factory';
// @ts-expect-error - plotly.js-dist-min ships no types; prebuilt browser bundle
import * as plotlyModule from 'plotly.js-dist-min';
import type { RecordingData, Annotation, LabelDef } from '../../types';
import { useAppStore } from '../../store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _unwrap(m: any): any {
  return m && typeof m === 'object' && 'default' in m ? m.default : m;
}
const _a = _unwrap(factoryModule);
const _b = _unwrap(plotlyModule);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _factory: any = typeof _a === 'function' ? _a : _b;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _plotly: any = typeof _a === 'function' ? _b : _a;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Plot = _factory(_plotly) as any;

interface Props {
  data: RecordingData;
  annotations: Annotation[];
  labelSchema: LabelDef[];
  selectedAnnotationId: number | null;
  onSelectAnnotation: (id: number | null) => void;
  onAddAnnotation: (startSec: number, endSec: number) => void;
}

const CHANNEL_COLORS = ['#4a9eff', '#ff6b6b', '#50c878', '#ffb347', '#da70d6', '#40e0d0'];

function getLabelColor(labelName: string, labelSchema: LabelDef[]): string {
  const def = labelSchema.find((l) => l.name === labelName);
  return def?.color || '#ffc864';
}

export function TimeSeriesPlot({
  data,
  annotations,
  labelSchema,
  selectedAnnotationId,
  onSelectAnnotation,
  onAddAnnotation,
}: Props) {
  const { activeLabel, pendingAnnotation, setPendingAnnotation } = useAppStore();
  const plotRef = useRef<any>(null);

  const t0 = data.timestamps[0] || 0;
  const timeSeconds = data.timestamps.map((t) => (t - t0) / 1e9);

  const traces = Object.entries(data.channels).map(([name, values], i) => ({
    x: timeSeconds,
    y: values,
    type: 'scattergl' as const,
    mode: 'lines' as const,
    name,
    line: { color: CHANNEL_COLORS[i % CHANNEL_COLORS.length], width: 1 },
  }));

  // Build shapes from annotations
  const shapes: any[] = annotations.map((ann) => {
    const color = getLabelColor(ann.label_name, labelSchema);
    const isSelected = ann.id === selectedAnnotationId;
    return {
      type: 'rect',
      xref: 'x',
      yref: 'paper',
      x0: (ann.start_ns - t0) / 1e9,
      x1: (ann.end_ns - t0) / 1e9,
      y0: 0,
      y1: 1,
      fillcolor: color + (isSelected ? '55' : '33'),
      line: {
        width: isSelected ? 2 : 1,
        color: isSelected ? '#fff' : color + '99',
      },
    };
  });

  // Show pending annotation marker
  if (pendingAnnotation) {
    shapes.push({
      type: 'line',
      xref: 'x',
      yref: 'paper',
      x0: pendingAnnotation.startSec,
      x1: pendingAnnotation.startSec,
      y0: 0,
      y1: 1,
      line: { width: 2, color: '#4a9eff', dash: 'dash' },
    });
  }

  const handleClick = useCallback(
    (event: any) => {
      if (!activeLabel) return;
      if (!event.points || event.points.length === 0) return;

      const clickedSec = event.points[0].x as number;

      if (!pendingAnnotation) {
        // First click: set start
        setPendingAnnotation({ startSec: clickedSec });
      } else {
        // Second click: set end, create annotation
        const startSec = Math.min(pendingAnnotation.startSec, clickedSec);
        const endSec = Math.max(pendingAnnotation.startSec, clickedSec);
        if (endSec - startSec > 0.01) {
          onAddAnnotation(startSec, endSec);
        }
        setPendingAnnotation(null);
      }
    },
    [activeLabel, pendingAnnotation, setPendingAnnotation, onAddAnnotation]
  );

  // Click on annotation shape to select it
  const handleShapeClick = useCallback(
    (event: any) => {
      if (activeLabel) return; // Don't select in add mode
      if (!event.points || event.points.length === 0) return;

      const clickedSec = event.points[0].x as number;
      const clickedNs = clickedSec * 1e9 + t0;

      // Find annotation containing this point
      const hit = annotations.find(
        (ann) => clickedNs >= ann.start_ns && clickedNs <= ann.end_ns
      );
      onSelectAnnotation(hit?.id ?? null);
    },
    [activeLabel, annotations, t0, onSelectAnnotation]
  );

  return (
    <div
      className="plot-container"
      style={{ cursor: activeLabel ? 'crosshair' : 'default' }}
    >
      <Plot
        ref={plotRef}
        data={traces}
        layout={{
          autosize: true,
          height: 400,
          margin: { l: 50, r: 20, t: 10, b: 40 },
          paper_bgcolor: '#111',
          plot_bgcolor: '#111',
          font: { color: '#888' },
          xaxis: {
            title: { text: 'Time (s)' },
            color: '#666',
            gridcolor: '#1a1a1a',
            zerolinecolor: '#2a2a2a',
          },
          yaxis: {
            color: '#666',
            gridcolor: '#1a1a1a',
            zerolinecolor: '#2a2a2a',
          },
          legend: {
            orientation: 'h',
            y: 1.1,
            font: { size: 11 },
          },
          shapes,
          dragmode: activeLabel ? false : 'zoom',
        }}
        config={{
          responsive: true,
          displayModeBar: true,
          displaylogo: false,
          modeBarButtonsToRemove: ['lasso2d', 'select2d'],
        }}
        style={{ width: '100%' }}
        useResizeHandler
        onClick={activeLabel ? handleClick : handleShapeClick}
      />
    </div>
  );
}
