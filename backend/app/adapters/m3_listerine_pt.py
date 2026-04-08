"""Adapter for M3 Listerine processed .pt files: (X:[N,6], y:[N,1], gestures)."""
from __future__ import annotations
from pathlib import Path
from typing import Iterator
import numpy as np
import pandas as pd
from .base import DataAdapter, ImportedRecording

SAMPLE_RATE_HZ = 100.0


class M3ListerinePtAdapter:
    @property
    def format_name(self) -> str:
        return "m3_listerine_pt"

    def detect(self, path: str) -> bool:
        p = Path(path)
        if not p.is_dir():
            return False
        # Look for directories containing .pt files with 6-column X
        for sub in p.iterdir():
            if sub.is_dir():
                pt_files = list(sub.glob('*.pt'))
                if pt_files and self._check_pt_format(pt_files[0]):
                    return True
        return False

    def _check_pt_format(self, pt_path: Path) -> bool:
        try:
            import torch
            data = torch.load(pt_path, map_location='cpu', weights_only=False)
            if isinstance(data, (tuple, list)) and len(data) >= 2:
                X = data[0]
                return hasattr(X, 'shape') and len(X.shape) == 2 and X.shape[1] == 6
            return False
        except Exception:
            return False

    def scan(self, path: str) -> list[str]:
        p = Path(path)
        recordings = []
        for sub in sorted(p.iterdir()):
            if sub.is_dir():
                for pt_file in sorted(sub.glob('*.pt')):
                    recordings.append(f"{sub.name}/{pt_file.stem}")
        return recordings

    def load(self, path: str, recording_id: str) -> ImportedRecording:
        import torch

        p = Path(path) / f"{recording_id}.pt"
        raw = torch.load(p, map_location='cpu', weights_only=False)

        if isinstance(raw, (tuple, list)):
            X = raw[0].numpy() if hasattr(raw[0], 'numpy') else np.array(raw[0])
            y = raw[1].numpy() if hasattr(raw[1], 'numpy') else np.array(raw[1])
            gestures = raw[2] if len(raw) > 2 else []
        else:
            raise ValueError(f"Unexpected format in {p}")

        n_samples = len(X)
        timestamp_ns = np.arange(n_samples, dtype=np.int64) * int(1e9 / SAMPLE_RATE_HZ)

        data = pd.DataFrame({
            'timestamp_ns': timestamp_ns,
            'channel_0': X[:, 0].astype(np.float32),
            'channel_1': X[:, 1].astype(np.float32),
            'channel_2': X[:, 2].astype(np.float32),
            'channel_3': X[:, 3].astype(np.float32),
            'channel_4': X[:, 4].astype(np.float32),
            'channel_5': X[:, 5].astype(np.float32),
        })

        # Convert gestures to label intervals
        labels = []
        if isinstance(gestures, list):
            for g in gestures:
                start_idx = g.get('start', 0)
                end_idx = g.get('end', 0)
                label = g.get('label', 'unknown')
                hand = g.get('hand', '')
                full_label = f"{label}_{hand}" if hand else label
                labels.append({
                    'start_ns': int(timestamp_ns[start_idx]),
                    'end_ns': int(timestamp_ns[min(end_idx, n_samples - 1)]),
                    'label': full_label,
                })

        participant_code = recording_id.split('/')[0]

        return ImportedRecording(
            name=recording_id,
            participant_code=participant_code,
            data=data,
            sample_rate_hz=SAMPLE_RATE_HZ,
            channel_names=['accel_x', 'accel_y', 'accel_z', 'gyro_x', 'gyro_y', 'gyro_z'],
            channel_units=['m/s^2'] * 3 + ['rad/s'] * 3,
            labels=labels,
            metadata={'source_file': str(p)},
        )

    def load_all(self, path: str) -> Iterator[ImportedRecording]:
        for rid in self.scan(path):
            yield self.load(path, rid)
