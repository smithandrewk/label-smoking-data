import { useAppStore } from '../../store';
import { DatasetList } from '../dataset/DatasetList';
import { ProjectList } from '../project/ProjectList';
import { DatasetImporter } from '../dataset/DatasetImporter';

export function Sidebar() {
  const { sidebarView, setSidebarView } = useAppStore();

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h1>Label Tool</h1>
      </div>
      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab ${sidebarView === 'datasets' ? 'active' : ''}`}
          onClick={() => setSidebarView('datasets')}
        >
          Datasets
        </button>
        <button
          className={`sidebar-tab ${sidebarView === 'projects' ? 'active' : ''}`}
          onClick={() => setSidebarView('projects')}
        >
          Projects
        </button>
        <button
          className={`sidebar-tab ${sidebarView === 'import' ? 'active' : ''}`}
          onClick={() => setSidebarView('import')}
        >
          Import
        </button>
      </div>
      <div className="sidebar-content">
        {sidebarView === 'datasets' && <DatasetList />}
        {sidebarView === 'projects' && <ProjectList />}
        {sidebarView === 'import' && <DatasetImporter />}
      </div>
    </div>
  );
}
