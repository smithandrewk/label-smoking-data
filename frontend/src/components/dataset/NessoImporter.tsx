import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { importNessoWindow, listNessoDevices, type NessoDevice } from '../../api/datasets';
import { useAppStore } from '../../store';

function defaultIsoLocal(d: Date): string {
  // input[type=datetime-local] expects "YYYY-MM-DDTHH:MM" in local time.
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function localToUtcIso(local: string): string {
  // Treat as local time, return UTC ISO with Z.
  return new Date(local).toISOString();
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export function NessoImporter() {
  const { setSelectedDataset, setSelectedRecording, setSidebarView } = useAppStore();
  const queryClient = useQueryClient();

  const { data: devices, isLoading: devicesLoading, isError: devicesError } = useQuery({
    queryKey: ['nesso-devices'],
    queryFn: listNessoDevices,
  });

  const [deviceId, setDeviceId] = useState<string>('');
  const [since, setSince] = useState<string>(() => {
    const d = new Date();
    d.setHours(d.getHours() - 1);
    return defaultIsoLocal(d);
  });
  const [until, setUntil] = useState<string>(() => defaultIsoLocal(new Date()));
  const [name, setName] = useState<string>('');

  const selectedDevice: NessoDevice | undefined = useMemo(
    () => devices?.find((d) => d.id === deviceId),
    [devices, deviceId],
  );

  const importMutation = useMutation({
    mutationFn: () =>
      importNessoWindow({
        device_id: deviceId,
        since: localToUtcIso(since),
        until: localToUtcIso(until),
        name: name || `${shortId(deviceId)}_${since}_${until}`,
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['datasets'] });
      queryClient.invalidateQueries({ queryKey: ['recordings'] });
      setSelectedDataset(result.dataset_id);
      setSelectedRecording(null);
      setSidebarView('datasets');
      setName('');
    },
  });

  const minutesBetween =
    since && until ? Math.round((new Date(until).getTime() - new Date(since).getTime()) / 60_000) : 0;

  return (
    <div className="import-step" style={{ marginBottom: 12 }}>
      <h3>Import from nesso</h3>
      <p style={{ fontSize: 12, color: '#888', marginTop: 0 }}>
        Pull a raw IMU window from a nesso device as a new dataset.
        The recording materializes as parquet on the label-app volume.
      </p>

      <div className="form-group">
        <label htmlFor="nesso-device" style={{ fontSize: 12, color: '#aaa' }}>Device</label>
        <select
          id="nesso-device"
          data-testid="nesso-device-select"
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          disabled={devicesLoading || devicesError}
        >
          <option value="">
            {devicesLoading ? 'Loading…' : devicesError ? 'Error fetching devices' : 'Select a device…'}
          </option>
          {devices?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.friendly_name || shortId(d.id)} — {formatCount(d.imu_sample_count)} samples
            </option>
          ))}
        </select>
        {selectedDevice && (
          <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
            coverage:{' '}
            {selectedDevice.imu_earliest?.slice(0, 16).replace('T', ' ') || '—'} →{' '}
            {selectedDevice.imu_latest?.slice(0, 16).replace('T', ' ') || '—'}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <div className="form-group" style={{ flex: 1 }}>
          <label htmlFor="nesso-since" style={{ fontSize: 12, color: '#aaa' }}>Since (local)</label>
          <input
            id="nesso-since"
            data-testid="nesso-since"
            type="datetime-local"
            value={since}
            onChange={(e) => setSince(e.target.value)}
          />
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label htmlFor="nesso-until" style={{ fontSize: 12, color: '#aaa' }}>Until (local)</label>
          <input
            id="nesso-until"
            data-testid="nesso-until"
            type="datetime-local"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
          />
        </div>
      </div>
      {minutesBetween > 0 && (
        <div style={{ fontSize: 11, color: '#666' }}>
          window: {minutesBetween} min
        </div>
      )}

      <div className="form-group">
        <label htmlFor="nesso-name" style={{ fontSize: 12, color: '#aaa' }}>Dataset name (optional)</label>
        <input
          id="nesso-name"
          data-testid="nesso-name"
          type="text"
          placeholder="e.g. breville-tuesday"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <button
        className="btn btn-primary"
        data-testid="nesso-import-submit"
        disabled={!deviceId || !since || !until || importMutation.isPending || minutesBetween <= 0}
        onClick={() => importMutation.mutate()}
      >
        {importMutation.isPending ? 'Importing…' : 'Import window'}
      </button>

      {importMutation.isError && (
        <div style={{ fontSize: 12, color: '#ff6b6b', marginTop: 8 }}>
          {(importMutation.error as Error).message}
        </div>
      )}
      {importMutation.isSuccess && (
        <div style={{ fontSize: 12, color: '#50c878', marginTop: 8 }} data-testid="nesso-import-success">
          {importMutation.data.duplicate
            ? `Already imported as "${importMutation.data.dataset_name}".`
            : `Imported ${importMutation.data.recordings_imported} recording as "${importMutation.data.dataset_name}".`}
        </div>
      )}
    </div>
  );
}
