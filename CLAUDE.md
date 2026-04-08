# Label Tool v2

Physiological time-series annotation tool with pluggable data adapters.
Potential dissertation software contribution chapter.

## Quick Start
```bash
# Backend (port 5001)
cd backend && source venv/bin/activate && python3 run.py

# Frontend (port 3000, proxies API to 5001)
cd frontend && npm run dev
```

## Architecture
- **Backend**: Flask + SQLite + Parquet (no MySQL, no server dependencies)
- **Frontend**: React + Vite + TypeScript + ShadCN + Tailwind + Plotly.js
- **Design**: Light/dark mode, purple accent (Linear/Obsidian-inspired)
- **Data flow**: Import via adapters -> stored as Parquet -> served with LOD downsampling

## Key Directories
```
backend/
  app/
    adapters/       # DataAdapter protocol + 4 concrete adapters (core contribution)
    services/       # import, recording, annotation, model, export
    routes/         # REST API endpoints
    database.py     # SQLite schema + migrations
    config.py       # DATA_ROOT, DB_PATH, MODEL_DIR from env
  run.py            # Flask entry point
  venv/             # Python virtual environment
frontend/
  src/
    api/            # API client layer (axios)
    components/     # React components (ShadCN-based)
      ui/           # ShadCN primitives
      layout/       # Sidebar, MainPanel
      dataset/      # DatasetList, DatasetImporter
      recording/    # RecordingTable, RecordingView
      visualization/# TimeSeriesPlot, AnnotationToolbar
      model/        # ModelScorer
      export/       # ExportButton
    store/          # Zustand state management
    types/          # TypeScript interfaces
data/               # gitignored
  recordings/       # Parquet files (created on import)
  models/           # ML model .py + .pt files
```

## Data Adapters
| Adapter | Format | Channels | Rate |
|---------|--------|----------|------|
| `LegacyCsvAdapter` | CSV: ns_since_reboot,x,y,z | 3 | 50Hz |
| `M5SmokingAdapter` | .pt {X:[N,3], y:[N]} | 3 | 50Hz |
| `M3ListerineRawAdapter` | CSV + JSON labels | 6 | 100Hz |
| `M3ListerinePtAdapter` | .pt (X,y,gestures) | 6 | 100Hz |

Adding a new adapter: implement the `DataAdapter` protocol in `backend/app/adapters/base.py`, register in `__init__.py`.

## ML Models
Models must implement: `preprocess(df)`, `run(data, device)`, `postprocess(preds, df, threshold=None)`
Place .py + .pt files in `data/models/`, register via POST `/api/models`.

## SQLite Schema (key tables)
- `datasets` -- imported data sources with format, sample rate, channel info
- `recordings` -- individual time-series files (relative Parquet paths)
- `participants` -- participant codes
- `projects` -- labeling projects with label_schema JSON
- `annotations` -- first-class annotation rows (not JSON blobs)
- `models` -- registered ML models
- `recording_lineage` -- virtual split tracking

## API Endpoints
- `GET/POST /api/datasets` -- list, import
- `POST /api/datasets/detect` -- auto-detect format
- `GET /api/recordings` -- list (filterable by dataset_id, project_id)
- `GET /api/recordings/:id/data` -- LOD data serving (?max_points=5000)
- `GET/POST /api/projects` -- CRUD + label schema
- `GET/POST/PUT/DELETE /api/annotations` -- annotation CRUD
- `POST /api/annotations/bulk` -- batch create
- `GET/POST /api/models` -- model registration
- `POST /api/models/:id/score/:recording_id` -- async ML scoring
- `GET /api/export/project/:id` -- JSON/CSV export

## GitHub
- Repo: `smithandrewk/label`
- Branch: `v2` (old tool on `main`)

## Python
- Always use `python3` (not `python`)
- Backend venv at `backend/venv/`

## Status
- Phases 1-5 complete (foundation, labeling, adapters, ML scoring, export)
- Design system: ShadCN + Tailwind, light/dark mode
- Not yet implemented: recording splitting (virtual splits)
- Not yet started: dissertation chapter (Phase 6)
