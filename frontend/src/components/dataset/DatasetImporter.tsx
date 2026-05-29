import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { detectFormat, importDataset } from '../../api/datasets';
import type { DetectResult } from '../../types';
import { NessoImporter } from './NessoImporter';

export function DatasetImporter() {
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [detected, setDetected] = useState<DetectResult | null>(null);
  const queryClient = useQueryClient();

  const detectMutation = useMutation({
    mutationFn: () => detectFormat(path),
    onSuccess: (result) => {
      setDetected(result);
      if (!name && path) {
        const parts = path.split('/');
        setName(parts[parts.length - 1] || parts[parts.length - 2] || 'dataset');
      }
    },
  });

  const importMutation = useMutation({
    mutationFn: () => importDataset(path, name, detected?.format || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['datasets'] });
      setPath('');
      setName('');
      setDetected(null);
    },
  });

  return (
    <div className="import-wizard">
      <NessoImporter />
      <div style={{ height: 1, background: '#222', margin: '12px 0' }} />
      <div className="import-step">
        <h3>1. Source Path</h3>
        <div className="form-group">
          <input
            type="text"
            placeholder="/path/to/data"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
        </div>
        <button
          className="btn btn-primary"
          onClick={() => detectMutation.mutate()}
          disabled={!path || detectMutation.isPending}
        >
          {detectMutation.isPending ? 'Detecting...' : 'Detect Format'}
        </button>
      </div>

      {detected && (
        <div className="import-step">
          <h3>2. Detected Format</h3>
          {detected.format ? (
            <div className="detect-result">
              <strong>{detected.format}</strong>
              <br />
              {detected.recordings_found} recordings found
            </div>
          ) : (
            <div className="detect-result error">
              No format detected. Available: {detected.available_formats?.join(', ')}
            </div>
          )}
        </div>
      )}

      {detected?.format && (
        <div className="import-step">
          <h3>3. Dataset Name</h3>
          <div className="form-group">
            <input
              type="text"
              placeholder="My Dataset"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={() => importMutation.mutate()}
            disabled={!name || importMutation.isPending}
          >
            {importMutation.isPending ? 'Importing...' : 'Import Dataset'}
          </button>
          {importMutation.isSuccess && (
            <div className="detect-result" style={{ marginTop: 8 }}>
              Imported {importMutation.data.recordings_imported} recordings
              {importMutation.data.duplicate && ' (duplicate detected)'}
            </div>
          )}
          {importMutation.isError && (
            <div className="detect-result error" style={{ marginTop: 8 }}>
              Error: {(importMutation.error as Error).message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
