import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listProjects, createProject } from '../../api/projects';
import { useAppStore } from '../../store';

export function ProjectList() {
  const { selectedProjectId, setSelectedProject } = useAppStore();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const queryClient = useQueryClient();

  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: listProjects,
  });

  const createMutation = useMutation({
    mutationFn: () => createProject(newName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setNewName('');
      setShowCreate(false);
    },
  });

  if (isLoading) return <div style={{ padding: 12, color: '#9ca3af' }}>Loading...</div>;

  return (
    <div>
      <div style={{ padding: '4px 8px', marginBottom: 8 }}>
        <button className="btn btn-sm btn-primary" onClick={() => setShowCreate(!showCreate)}>
          + New Project
        </button>
      </div>

      {showCreate && (
        <div style={{ padding: '0 8px', marginBottom: 12 }}>
          <div className="form-group">
            <input
              type="text"
              placeholder="Project name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && newName && createMutation.mutate()}
            />
          </div>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => createMutation.mutate()}
            disabled={!newName}
          >
            Create
          </button>
        </div>
      )}

      {projects?.filter(p => p.name !== '__imported__').map((project) => (
        <div
          key={project.id}
          className={`list-item ${selectedProjectId === project.id ? 'selected' : ''}`}
          onClick={() => setSelectedProject(project.id)}
        >
          <div className="list-item-title">{project.name}</div>
          <div className="list-item-meta">
            {project.label_schema.length} labels
            {project.recording_count !== undefined && ` \u00B7 ${project.recording_count} recordings`}
          </div>
        </div>
      ))}

      {!projects?.filter(p => p.name !== '__imported__').length && !showCreate && (
        <div style={{ padding: 12, color: '#9ca3af', fontSize: 13 }}>
          No projects yet.
        </div>
      )}
    </div>
  );
}
