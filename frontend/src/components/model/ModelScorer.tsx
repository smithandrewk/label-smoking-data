import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listModels, scoreRecording, getScoringStatus } from '../../api/models';

interface Props {
  recordingId: number;
  projectId: number;
}

export function ModelScorer({ recordingId, projectId }: Props) {
  const [scoringId, setScoringId] = useState<string | null>(null);
  const [labelName, setLabelName] = useState('model_prediction');
  const queryClient = useQueryClient();

  const { data: models } = useQuery({
    queryKey: ['models'],
    queryFn: listModels,
  });

  const { data: status } = useQuery({
    queryKey: ['scoring-status', scoringId],
    queryFn: () => getScoringStatus(scoringId!),
    enabled: !!scoringId,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.status === 'running' ? 1000 : false;
    },
  });

  // When scoring completes, refresh annotations
  useEffect(() => {
    if (status?.status === 'completed') {
      queryClient.invalidateQueries({ queryKey: ['annotations'] });
    }
  }, [status?.status]);

  const scoreMutation = useMutation({
    mutationFn: (modelId: number) =>
      scoreRecording(modelId, recordingId, {
        project_id: projectId,
        label_name: labelName,
      }),
    onSuccess: (data) => {
      setScoringId(data.scoring_id);
    },
  });

  if (!models?.length) {
    return (
      <div style={{ fontSize: 13, color: '#9ca3af', padding: '8px 0' }}>
        No models registered. Add model files to the models directory and register via API.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: '#9ca3af' }}>Score with:</span>
      {models.map((model) => (
        <button
          key={model.id}
          className="btn btn-sm"
          disabled={scoringId !== null && status?.status === 'running'}
          onClick={() => scoreMutation.mutate(model.id)}
        >
          {model.name}
        </button>
      ))}
      <input
        type="text"
        placeholder="Label name"
        value={labelName}
        onChange={(e) => setLabelName(e.target.value)}
        style={{
          padding: '3px 8px', fontSize: 12, background: '#1a1a1a',
          border: '1px solid #333', borderRadius: 4, color: '#e0e0e0', width: 130,
        }}
      />

      {status?.status === 'running' && (
        <span style={{ fontSize: 12, color: '#4a9eff' }}>Scoring...</span>
      )}
      {status?.status === 'completed' && (
        <span style={{ fontSize: 12, color: '#50c878' }}>
          Done: {status.annotations_created} annotations
        </span>
      )}
      {status?.status === 'failed' && (
        <span style={{ fontSize: 12, color: '#ff6b6b' }}>
          Failed: {status.error}
        </span>
      )}
    </div>
  );
}
