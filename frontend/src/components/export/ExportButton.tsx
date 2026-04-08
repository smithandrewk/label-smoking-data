import { useState } from 'react';
import { exportProjectAnnotations, exportRecordingAnnotations } from '../../api/exports';

interface Props {
  projectId?: number;
  recordingId?: number;
}

export function ExportButton({ projectId, recordingId }: Props) {
  const [exporting, setExporting] = useState(false);

  const handleExport = async (format: 'json' | 'csv') => {
    setExporting(true);
    try {
      let data: any;
      let filename: string;

      if (projectId) {
        data = await exportProjectAnnotations(projectId, format);
        filename = `project_${projectId}_annotations.${format}`;
      } else if (recordingId) {
        data = await exportRecordingAnnotations(recordingId, format, projectId || undefined);
        filename = `recording_${recordingId}_annotations.${format}`;
      } else {
        return;
      }

      // Create download
      const blob = format === 'csv'
        ? new Blob([data], { type: 'text/csv' })
        : new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export failed:', e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ display: 'inline-flex', gap: 4 }}>
      <button
        className="btn btn-sm"
        disabled={exporting}
        onClick={() => handleExport('json')}
      >
        Export JSON
      </button>
      <button
        className="btn btn-sm"
        disabled={exporting}
        onClick={() => handleExport('csv')}
      >
        Export CSV
      </button>
    </div>
  );
}
