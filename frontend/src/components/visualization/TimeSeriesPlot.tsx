import { useCallback, useEffect, useRef } from 'react';
import type { RecordingData, Annotation, LabelDef } from '../../types';
import { useAppStore } from '../../store';

// Plotly is loaded as a global from a <script> tag in index.html.
// We tried react-plotly.js three times and Rolldown mangled it three
// times — so we wrap window.Plotly ourselves. Plotly.react does an
// efficient in-place diff/update so this is functionally equivalent
// to react-plotly.js for our use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare global { interface Window { Plotly: any } }

interface PlotProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  layout: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config?: any;
  style?: React.CSSProperties;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onClick?: (event: any) => void;
}

function Plot({ data, layout, config, style, onClick }: PlotProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;

  useEffect(() => {
    const el = divRef.current;
    if (!el || !window.Plotly) return;
    window.Plotly.react(el, data, layout, config);
    // Plotly's plotly_click event delivers a similar event shape to
    // react-plotly.js's onClick (with .points). We re-attach on every
    // render so the latest handler closure runs.
    // Plotly augments the host div with .on / .removeAllListeners.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const elx = el as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (e: any) => onClickRef.current?.(e);
    elx.on?.('plotly_click', handler);
    return () => {
      elx.removeAllListeners?.('plotly_click');
    };
  }, [data, layout, config]);

  useEffect(() => {
    const el = divRef.current;
    return () => {
      if (el && window.Plotly) window.Plotly.purge(el);
    };
  }, []);

  return <div ref={divRef} style={style} />;
}

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
        color: isSelected ? '#1f2937' : color + '99',
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
        data={traces}
        layout={{
          autosize: true,
          height: 400,
          margin: { l: 50, r: 20, t: 10, b: 40 },
          paper_bgcolor: '#ffffff',
          plot_bgcolor: '#ffffff',
          font: { color: '#4b5563' },
          xaxis: {
            title: { text: 'Time (s)' },
            color: '#6b7280',
            gridcolor: '#e5e7eb',
            zerolinecolor: '#d1d5db',
          },
          yaxis: {
            color: '#6b7280',
            gridcolor: '#e5e7eb',
            zerolinecolor: '#d1d5db',
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
        onClick={activeLabel ? handleClick : handleShapeClick}
      />
    </div>
  );
}
