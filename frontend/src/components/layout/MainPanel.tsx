import { useAppStore } from '../../store';
import { RecordingTable } from '../recording/RecordingTable';
import { RecordingView } from '../recording/RecordingView';

export function MainPanel() {
  const { selectedRecordingId, selectedDatasetId } = useAppStore();

  if (selectedRecordingId) {
    return (
      <div className="main-panel">
        <RecordingView recordingId={selectedRecordingId} />
      </div>
    );
  }

  if (selectedDatasetId) {
    return (
      <div className="main-panel">
        <div className="main-header">
          <h2 style={{ margin: 0, fontSize: 16 }}>Recordings</h2>
        </div>
        <div className="main-content">
          <RecordingTable datasetId={selectedDatasetId} />
        </div>
      </div>
    );
  }

  return (
    <div className="main-panel">
      <div className="empty-state">
        <h2>Label Tool v2</h2>
        <p>Select a dataset or import data to get started.</p>
      </div>
    </div>
  );
}
