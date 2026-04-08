# Label Tool v2

Physiological time-series annotation tool with pluggable data adapters.

## Quick Start
```bash
# Backend
cd backend && source venv/bin/activate && python3 run.py

# Frontend (separate terminal)
cd frontend && npm run dev
```

## Architecture
- **Backend**: Flask + SQLite + Parquet (no MySQL, no server dependencies)
- **Frontend**: React + Vite + TypeScript + Plotly.js
- **Data**: Imported via adapters → stored as Parquet → served with LOD downsampling

## Key Directories
- `backend/app/adapters/` — Data format adapters (the core contribution)
- `backend/app/services/` — Business logic (import, recording, annotation, model, export)
- `backend/app/routes/` — REST API endpoints
- `frontend/src/components/` — React components
- `data/recordings/` — Parquet files (gitignored)
- `data/models/` — ML model .py and .pt files

## Data Adapters
| Adapter | Format | Channels | Rate |
|---------|--------|----------|------|
| `LegacyCsvAdapter` | CSV: ns_since_reboot,x,y,z | 3 | 50Hz |
| `M5SmokingAdapter` | .pt {X:[N,3], y:[N]} | 3 | 50Hz |
| `M3ListerineRawAdapter` | CSV + JSON labels | 6 | 100Hz |
| `M3ListerinePtAdapter` | .pt (X,y,gestures) | 6 | 100Hz |

## ML Models
Models must implement: `preprocess(df)`, `run(data, device)`, `postprocess(preds, df, threshold=None)`
Place .py + .pt files in `data/models/`, register via API.

## Python
- Always use `python3`
- Backend venv at `backend/venv/`
