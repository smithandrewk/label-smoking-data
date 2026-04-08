"""ML model loading, scoring, and bout extraction."""
from __future__ import annotations
import importlib.util
import json
import sys
import threading
import time
import uuid
from pathlib import Path
import numpy as np
import pandas as pd
import torch
import pyarrow.parquet as pq
from .. import config, database


# In-memory scoring status tracker
_scoring_status: dict[str, dict] = {}


def list_models() -> list[dict]:
    conn = database.get_connection()
    try:
        rows = conn.execute("SELECT * FROM models WHERE is_active = 1 ORDER BY name").fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d['settings'] = json.loads(d['settings']) if d['settings'] else {}
            result.append(d)
        return result
    finally:
        conn.close()


def get_model(model_id: int) -> dict | None:
    conn = database.get_connection()
    try:
        row = conn.execute("SELECT * FROM models WHERE id = ? AND is_active = 1", (model_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        d['settings'] = json.loads(d['settings']) if d['settings'] else {}
        return d
    finally:
        conn.close()


def register_model(name: str, py_path: str, weights_path: str, class_name: str,
                    settings: dict | None = None) -> dict:
    """Register a model. py_path and weights_path are relative to MODEL_DIR."""
    py_full = config.MODEL_DIR / py_path
    weights_full = config.MODEL_DIR / weights_path

    if not py_full.exists():
        raise FileNotFoundError(f"Python file not found: {py_full}")
    if not weights_full.exists():
        raise FileNotFoundError(f"Weights file not found: {weights_full}")

    # Validate the model interface
    instance = _load_model_instance(py_path, weights_path, class_name, device='cpu')
    for method in ['preprocess', 'run', 'postprocess']:
        if not hasattr(instance, method) or not callable(getattr(instance, method)):
            raise ValueError(f"Model class '{class_name}' missing required method: {method}")

    conn = database.get_connection()
    try:
        cur = conn.execute(
            "INSERT INTO models (name, py_path, weights_path, class_name, settings) VALUES (?, ?, ?, ?, ?)",
            (name, py_path, weights_path, class_name, json.dumps(settings or {})),
        )
        conn.commit()
        return {'id': cur.lastrowid, 'name': name}
    finally:
        conn.close()


def _load_model_instance(py_path: str, weights_path: str, class_name: str, device: str = 'cpu'):
    """Dynamically load a model from its .py and .pt files."""
    py_full = config.MODEL_DIR / py_path
    weights_full = config.MODEL_DIR / weights_path

    module_name = f"label_model_{device}_{py_full.stem}"
    spec = importlib.util.spec_from_file_location(module_name, str(py_full))
    if spec is None:
        raise ImportError(f"Could not load module from {py_full}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)
    except Exception as e:
        del sys.modules[module_name]
        raise ImportError(f"Error loading {py_full}: {e}")

    if not hasattr(module, class_name):
        available = [n for n in dir(module) if not n.startswith('_')]
        raise ValueError(f"Class '{class_name}' not found in {py_full}. Available: {available}")

    ModelClass = getattr(module, class_name)

    # Try instantiation
    try:
        model = ModelClass()
    except TypeError:
        try:
            model = ModelClass(window_size=3000, num_features=3)
        except TypeError as e:
            raise ValueError(f"Could not instantiate {class_name}: {e}")

    # Load weights
    device_obj = torch.device(device)
    state_dict = torch.load(str(weights_full), map_location='cpu', weights_only=True)
    model.load_state_dict(state_dict)
    model = model.to(device_obj)
    model.eval()

    return model


def score_recording(recording_id: int, model_id: int, project_id: int,
                    label_name: str = 'model_prediction', device: str = 'cpu') -> dict:
    """Start async scoring of a recording. Returns scoring_id for status polling."""
    model = get_model(model_id)
    if not model:
        raise ValueError(f"Model {model_id} not found")

    conn = database.get_connection()
    try:
        rec = conn.execute("SELECT * FROM recordings WHERE id = ?", (recording_id,)).fetchone()
        if not rec:
            raise ValueError(f"Recording {recording_id} not found")
        rec = dict(rec)
    finally:
        conn.close()

    scoring_id = str(uuid.uuid4())[:8]
    _scoring_status[scoring_id] = {
        'status': 'running',
        'recording_id': recording_id,
        'model_name': model['name'],
        'started_at': time.time(),
        'error': None,
        'annotations_created': 0,
    }

    thread = threading.Thread(
        target=_scoring_worker,
        args=(scoring_id, rec, model, project_id, label_name, device),
        daemon=True,
    )
    thread.start()

    return {'scoring_id': scoring_id}


def _scoring_worker(scoring_id: str, rec: dict, model_config: dict,
                    project_id: int, label_name: str, device: str):
    """Background worker that loads model, runs inference, extracts bouts, saves annotations."""
    try:
        # Load recording data
        parquet_path = config.DATA_ROOT / rec['data_path']
        table = pq.read_table(parquet_path)
        df = table.to_pandas()

        timestamps = df['timestamp_ns'].values
        channel_cols = [c for c in df.columns if c.startswith('channel_')]

        # Build data DataFrame in the format models expect
        data_df = pd.DataFrame({
            'ns_since_reboot': timestamps,
            'accel_x': df[channel_cols[0]].values if len(channel_cols) > 0 else np.zeros(len(df)),
            'accel_y': df[channel_cols[1]].values if len(channel_cols) > 1 else np.zeros(len(df)),
            'accel_z': df[channel_cols[2]].values if len(channel_cols) > 2 else np.zeros(len(df)),
        })

        # Load model
        instance = _load_model_instance(
            model_config['py_path'], model_config['weights_path'],
            model_config['class_name'], device,
        )

        # Run through the model pipeline: preprocess -> run -> postprocess
        settings = model_config.get('settings', {})
        threshold = settings.get('threshold')

        preprocessed = instance.preprocess(data_df)
        raw_predictions = instance.run(preprocessed, device)
        if threshold is not None:
            predictions = instance.postprocess(raw_predictions, data_df, threshold=threshold)
        else:
            predictions = instance.postprocess(raw_predictions, data_df)

        # Extract bouts from binary predictions
        min_duration_sec = settings.get('min_bout_duration_sec', 0.25)
        bouts = _extract_bouts(predictions, timestamps, label_name, min_duration_sec)

        # Save as annotations
        conn = database.get_connection()
        try:
            for bout in bouts:
                conn.execute(
                    """INSERT INTO annotations (recording_id, project_id, label_name,
                       start_ns, end_ns, source) VALUES (?, ?, ?, ?, ?, ?)""",
                    (rec['id'], project_id, bout['label'], bout['start_ns'], bout['end_ns'],
                     f"model:{model_config['name']}"),
                )
            conn.commit()
        finally:
            conn.close()

        _scoring_status[scoring_id].update({
            'status': 'completed',
            'annotations_created': len(bouts),
            'completed_at': time.time(),
        })

    except Exception as e:
        _scoring_status[scoring_id].update({
            'status': 'failed',
            'error': str(e),
            'completed_at': time.time(),
        })
    finally:
        # Clean up dynamic module
        for key in list(sys.modules.keys()):
            if key.startswith('label_model_'):
                del sys.modules[key]


def _extract_bouts(predictions: np.ndarray, timestamps: np.ndarray,
                   label_name: str, min_duration_sec: float = 0.25) -> list[dict]:
    """Convert binary prediction array to list of bout intervals."""
    if len(predictions) < len(timestamps):
        predictions = np.concatenate([predictions, np.zeros(len(timestamps) - len(predictions))])
    elif len(predictions) > len(timestamps):
        predictions = predictions[:len(timestamps)]

    binary = (np.array(predictions) > 0.5).astype(int)
    diff = np.diff(binary, prepend=0, append=0)
    starts = np.where(diff == 1)[0]
    ends = np.where(diff == -1)[0]

    min_duration_ns = min_duration_sec * 1e9
    bouts = []
    for s, e in zip(starts, ends):
        start_ns = int(timestamps[s])
        end_ns = int(timestamps[min(e - 1, len(timestamps) - 1)])
        if (end_ns - start_ns) >= min_duration_ns:
            bouts.append({
                'start_ns': start_ns,
                'end_ns': end_ns,
                'label': label_name,
            })
    return bouts


def get_scoring_status(scoring_id: str) -> dict:
    return _scoring_status.get(scoring_id, {'status': 'not_found'})


def is_gpu_available() -> bool:
    try:
        return torch.cuda.is_available()
    except Exception:
        return False
