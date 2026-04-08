"""Adapter for M3 Listerine raw CSV data with JSON labels.

Raw format:
- acceleration.csv / gyroscope.csv with header "File Start Time: <unix_ms>"
- Columns: timestamp,x,y,z at 100Hz
- Labels: labels/{pid}/{rid}.json with {left: {water: [...], listerine: [...]}, right: {...}}
"""
from __future__ import annotations
import json
from pathlib import Path
from typing import Iterator
import numpy as np
import pandas as pd
from .base import DataAdapter, ImportedRecording

SAMPLE_RATE_HZ = 100.0


class M3ListerineRawAdapter:
    @property
    def format_name(self) -> str:
        return "m3_listerine_raw"

    def detect(self, path: str) -> bool:
        p = Path(path)
        if not p.is_dir():
            return False
        # Look for raw/ subdirectory or direct participant dirs with acceleration.csv
        raw_dir = p / 'raw'
        search_dir = raw_dir if raw_dir.is_dir() else p
        for sub in search_dir.iterdir():
            if sub.is_dir():
                for rec_dir in sub.iterdir():
                    if rec_dir.is_dir() and (rec_dir / 'acceleration.csv').exists():
                        return self._check_csv_header(rec_dir / 'acceleration.csv')
        return False

    def _check_csv_header(self, csv_path: Path) -> bool:
        try:
            with open(csv_path) as f:
                first_line = f.readline().strip()
            return first_line.startswith('"File Start Time:') or first_line.startswith('File Start Time:')
        except Exception:
            return False

    def scan(self, path: str) -> list[str]:
        p = Path(path)
        raw_dir = p / 'raw'
        search_dir = raw_dir if raw_dir.is_dir() else p
        recordings = []
        for pid_dir in sorted(search_dir.iterdir()):
            if not pid_dir.is_dir():
                continue
            for rec_dir in sorted(pid_dir.iterdir()):
                if rec_dir.is_dir() and (rec_dir / 'acceleration.csv').exists():
                    recordings.append(f"{pid_dir.name}/{rec_dir.name}")
        return recordings

    def _read_sensor_csv(self, csv_path: Path) -> pd.DataFrame:
        """Read a sensor CSV that has a header line 'File Start Time: ...'."""
        df = pd.read_csv(csv_path, skiprows=1)
        df.columns = [c.strip() for c in df.columns]
        return df

    def load(self, path: str, recording_id: str) -> ImportedRecording:
        p = Path(path)
        raw_dir = p / 'raw'
        base = raw_dir if raw_dir.is_dir() else p

        rec_path = base / recording_id
        accel_path = rec_path / 'acceleration.csv'
        gyro_path = rec_path / 'gyroscope.csv'

        accel_df = self._read_sensor_csv(accel_path)
        has_gyro = gyro_path.exists()

        if has_gyro:
            gyro_df = self._read_sensor_csv(gyro_path)
            # Merge on nearest timestamp
            n = min(len(accel_df), len(gyro_df))
            data = pd.DataFrame({
                'timestamp_ns': accel_df['timestamp'].values[:n].astype(np.int64),
                'channel_0': accel_df['x'].values[:n].astype(np.float32),
                'channel_1': accel_df['y'].values[:n].astype(np.float32),
                'channel_2': accel_df['z'].values[:n].astype(np.float32),
                'channel_3': gyro_df['x'].values[:n].astype(np.float32),
                'channel_4': gyro_df['y'].values[:n].astype(np.float32),
                'channel_5': gyro_df['z'].values[:n].astype(np.float32),
            })
            channel_names = ['accel_x', 'accel_y', 'accel_z', 'gyro_x', 'gyro_y', 'gyro_z']
            channel_units = ['m/s^2'] * 3 + ['rad/s'] * 3
        else:
            data = pd.DataFrame({
                'timestamp_ns': accel_df['timestamp'].values.astype(np.int64),
                'channel_0': accel_df['x'].values.astype(np.float32),
                'channel_1': accel_df['y'].values.astype(np.float32),
                'channel_2': accel_df['z'].values.astype(np.float32),
            })
            channel_names = ['accel_x', 'accel_y', 'accel_z']
            channel_units = ['m/s^2'] * 3

        # Load labels
        pid, rid = recording_id.split('/')
        labels_path = p / 'labels' / pid / f'{rid}.json'
        labels = self._parse_labels(labels_path, data['timestamp_ns'].values) if labels_path.exists() else None

        return ImportedRecording(
            name=recording_id,
            participant_code=pid,
            data=data,
            sample_rate_hz=SAMPLE_RATE_HZ,
            channel_names=channel_names,
            channel_units=channel_units,
            labels=labels,
            metadata={'source_dir': str(rec_path), 'has_gyroscope': has_gyro},
        )

    def _parse_labels(self, labels_path: Path, timestamps: np.ndarray) -> list[dict]:
        """Parse JSON labels with {left: {water: [...], listerine: [...]}, right: {...}}."""
        try:
            with open(labels_path) as f:
                raw = json.load(f)
        except Exception:
            return []

        labels = []
        start_ns = int(timestamps[0])

        for hand in ['left', 'right']:
            if hand not in raw:
                continue
            for gesture, intervals in raw[hand].items():
                for interval in intervals:
                    # Times are in seconds relative to recording start
                    s_ns = start_ns + int(interval['start'] * 1e9)
                    e_ns = start_ns + int(interval['end'] * 1e9)
                    labels.append({
                        'start_ns': s_ns,
                        'end_ns': e_ns,
                        'label': f'{gesture}_{hand}',
                    })
        return labels

    def load_all(self, path: str) -> Iterator[ImportedRecording]:
        for rid in self.scan(path):
            yield self.load(path, rid)
