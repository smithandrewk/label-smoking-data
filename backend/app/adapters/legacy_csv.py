"""Adapter for legacy CSV format: ns_since_reboot,x,y,z with optional labels.json."""
from __future__ import annotations
import json
from pathlib import Path
from typing import Iterator
import pandas as pd
import numpy as np
from .base import DataAdapter, ImportedRecording


class LegacyCsvAdapter:
    @property
    def format_name(self) -> str:
        return "legacy_csv"

    def detect(self, path: str) -> bool:
        p = Path(path)
        if p.is_file() and p.suffix == '.csv':
            return self._check_csv_header(p)
        if p.is_dir():
            # Check for subdirectories containing accelerometer_data.csv
            for sub in p.iterdir():
                if sub.is_dir():
                    csv = sub / 'accelerometer_data.csv'
                    if csv.exists() and self._check_csv_header(csv):
                        return True
            # Or direct CSV files
            for csv in p.glob('*.csv'):
                if self._check_csv_header(csv):
                    return True
        return False

    def _check_csv_header(self, csv_path: Path) -> bool:
        try:
            with open(csv_path) as f:
                header = f.readline().strip()
            cols = [c.strip() for c in header.split(',')]
            return 'ns_since_reboot' in cols and 'x' in cols and 'y' in cols and 'z' in cols
        except Exception:
            return False

    def scan(self, path: str) -> list[str]:
        p = Path(path)
        recordings = []
        if p.is_file():
            recordings.append(p.stem)
        elif p.is_dir():
            # Subdirectories with accelerometer_data.csv
            for sub in sorted(p.iterdir()):
                if sub.is_dir() and (sub / 'accelerometer_data.csv').exists():
                    recordings.append(sub.name)
            # Or direct CSV files
            if not recordings:
                for csv in sorted(p.glob('*.csv')):
                    if self._check_csv_header(csv):
                        recordings.append(csv.stem)
        return recordings

    def load(self, path: str, recording_id: str) -> ImportedRecording:
        p = Path(path)
        if p.is_file():
            csv_path = p
            labels_path = p.parent / 'labels.json'
        else:
            sub = p / recording_id
            if sub.is_dir():
                csv_path = sub / 'accelerometer_data.csv'
                labels_path = sub / 'labels.json'
            else:
                csv_path = p / f'{recording_id}.csv'
                labels_path = p / f'{recording_id}_labels.json'

        df = pd.read_csv(csv_path)
        # Standardize columns
        data = pd.DataFrame({
            'timestamp_ns': df['ns_since_reboot'].values.astype(np.int64),
            'channel_0': df['x'].values.astype(np.float32),
            'channel_1': df['y'].values.astype(np.float32),
            'channel_2': df['z'].values.astype(np.float32),
        })

        # Estimate sample rate from timestamps
        if len(data) > 1:
            dt = np.median(np.diff(data['timestamp_ns'].values[:1000]))
            sample_rate = 1e9 / dt if dt > 0 else 50.0
        else:
            sample_rate = 50.0

        # Load labels if present
        labels = None
        if labels_path.exists():
            try:
                with open(labels_path) as f:
                    raw = json.load(f)
                if isinstance(raw, list):
                    labels = [
                        {'start_ns': b.get('start_ns', b.get('start')),
                         'end_ns': b.get('stop_ns', b.get('stop', b.get('end'))),
                         'label': b.get('label', 'unlabeled')}
                        for b in raw
                    ]
            except Exception:
                pass

        return ImportedRecording(
            name=recording_id,
            participant_code=None,
            data=data,
            sample_rate_hz=round(sample_rate, 1),
            channel_names=['accel_x', 'accel_y', 'accel_z'],
            channel_units=['m/s^2', 'm/s^2', 'm/s^2'],
            labels=labels,
            metadata={'source_file': str(csv_path)},
        )

    def load_all(self, path: str) -> Iterator[ImportedRecording]:
        for rid in self.scan(path):
            yield self.load(path, rid)
