import { useQuery } from '@tanstack/react-query';
import { listRecordings } from '../../api/recordings';
import { useAppStore } from '../../store';

interface Props {
  datasetId?: number;
  projectId?: number;
}

export function RecordingTable({ datasetId, projectId }: Props) {
  const { selectedRecordingId, setSelectedRecording } = useAppStore();
  const { data: recordings, isLoading } = useQuery({
    queryKey: ['recordings', { datasetId, projectId }],
    queryFn: () => listRecordings({ dataset_id: datasetId, project_id: projectId }),
  });

  if (isLoading) return <div style={{ color: '#9ca3af' }}>Loading recordings...</div>;
  if (!recordings?.length) return <div style={{ color: '#9ca3af' }}>No recordings found.</div>;

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
    return `${(seconds / 3600).toFixed(1)}h`;
  };

  return (
    <table className="recording-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Participant</th>
          <th>Samples</th>
          <th>Duration</th>
        </tr>
      </thead>
      <tbody>
        {recordings.map((rec) => (
          <tr
            key={rec.id}
            className={selectedRecordingId === rec.id ? 'selected' : ''}
            onClick={() => setSelectedRecording(rec.id)}
          >
            <td>{rec.name}</td>
            <td>{rec.participant_code || '-'}</td>
            <td>{rec.sample_count.toLocaleString()}</td>
            <td>{formatDuration(rec.duration_seconds)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
