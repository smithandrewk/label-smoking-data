import { useQuery } from '@tanstack/react-query';
import { listDatasets } from '../../api/datasets';
import { useAppStore } from '../../store';

export function DatasetList() {
  const { selectedDatasetId, setSelectedDataset, setSelectedRecording } = useAppStore();
  const { data: datasets, isLoading } = useQuery({
    queryKey: ['datasets'],
    queryFn: listDatasets,
  });

  if (isLoading) return <div style={{ padding: 12, color: '#666' }}>Loading...</div>;

  if (!datasets?.length) {
    return (
      <div style={{ padding: 12, color: '#666', fontSize: 13 }}>
        No datasets imported yet. Use the Import tab to add data.
      </div>
    );
  }

  return (
    <div>
      {datasets.map((ds) => (
        <div
          key={ds.id}
          className={`list-item ${selectedDatasetId === ds.id ? 'selected' : ''}`}
          onClick={() => {
            setSelectedDataset(ds.id);
            setSelectedRecording(null);
          }}
        >
          <div className="list-item-title">{ds.name}</div>
          <div className="list-item-meta">
            {ds.source_format} &middot; {ds.channel_count}ch &middot; {ds.sample_rate_hz}Hz
          </div>
        </div>
      ))}
    </div>
  );
}
