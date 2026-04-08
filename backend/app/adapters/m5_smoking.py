"""Adapter for M5 smoking .pt files: {X: [N,3], y: [N]} at 50Hz."""
from __future__ import annotations
from pathlib import Path
from typing import Iterator
import numpy as np
import pandas as pd
from .base import DataAdapter, ImportedRecording

SAMPLE_RATE_HZ = 50.0


class M5SmokingAdapter:
    @property
    def format_name(self) -> str:
        return "m5_smoking_pt"

    def detect(self, path: str) -> bool:
        p = Path(path)
        if not p.is_dir():
            return False
        # Look for participant directories (P00, P01, etc.) containing .pt files
        for sub in p.iterdir():
            if sub.is_dir() and sub.name.startswith('P'):
                pt_files = list(sub.glob('*.pt'))
                if pt_files:
                    return self._check_pt_format(pt_files[0])
        return False

    def _check_pt_format(self, pt_path: Path) -> bool:
        try:
            import torch
            data = torch.load(pt_path, map_location='cpu', weights_only=False)
            return isinstance(data, dict) and 'X' in data and 'y' in data
        except Exception:
            return False

    def scan(self, path: str) -> list[str]:
        p = Path(path)
        recordings = []
        for participant_dir in sorted(p.iterdir()):
            if participant_dir.is_dir() and participant_dir.name.startswith('P'):
                for pt_file in sorted(participant_dir.glob('*.pt')):
                    recordings.append(f"{participant_dir.name}/{pt_file.stem}")
        return recordings

    def load(self, path: str, recording_id: str) -> ImportedRecording:
        import torch

        p = Path(path) / f"{recording_id}.pt"
        raw = torch.load(p, map_location='cpu', weights_only=False)

        X = raw['X'].numpy() if hasattr(raw['X'], 'numpy') else np.array(raw['X'])
        y = raw['y'].numpy() if hasattr(raw['y'], 'numpy') else np.array(raw['y'])

        n_samples = len(X)
        # Generate synthetic timestamps at 50Hz (20ms intervals)
        timestamp_ns = np.arange(n_samples, dtype=np.int64) * int(1e9 / SAMPLE_RATE_HZ)

        data = pd.DataFrame({
            'timestamp_ns': timestamp_ns,
            'channel_0': X[:, 0].astype(np.float32),
            'channel_1': X[:, 1].astype(np.float32),
            'channel_2': X[:, 2].astype(np.float32),
        })

        # Convert binary labels to intervals
        labels = self._binary_to_intervals(y, timestamp_ns)

        participant_code = recording_id.split('/')[0]
        rec_name = recording_id.split('/')[-1]

        return ImportedRecording(
            name=recording_id,
            participant_code=participant_code,
            data=data,
            sample_rate_hz=SAMPLE_RATE_HZ,
            channel_names=['accel_x', 'accel_y', 'accel_z'],
            channel_units=['m/s^2', 'm/s^2', 'm/s^2'],
            labels=labels,
            metadata={'source_file': str(p), 'recording_index': rec_name},
        )

    def _binary_to_intervals(self, y: np.ndarray, timestamps: np.ndarray) -> list[dict]:
        """Convert binary label array to list of interval dicts."""
        if y is None or len(y) == 0:
            return []

        labels = []
        y_binary = (y > 0.5).astype(int)
        diff = np.diff(y_binary, prepend=0, append=0)
        starts = np.where(diff == 1)[0]
        ends = np.where(diff == -1)[0]

        for s, e in zip(starts, ends):
            labels.append({
                'start_ns': int(timestamps[s]),
                'end_ns': int(timestamps[min(e, len(timestamps) - 1)]),
                'label': 'smoking',
            })
        return labels

    def load_all(self, path: str) -> Iterator[ImportedRecording]:
        for rid in self.scan(path):
            yield self.load(path, rid)
