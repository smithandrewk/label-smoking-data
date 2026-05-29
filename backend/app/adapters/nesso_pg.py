"""Adapter for nesso IoT devices.

Unlike the file-based adapters, this one pulls raw IMU samples from
nesso's Postgres `raw_imu` table for a (device_id, time window) pair
and materializes them as a parquet recording. No filesystem source.

Source-path syntax used by the standard adapter protocol:

    nesso://<device_id>?since=<iso8601>&until=<iso8601>

`device_id` is the device UUID. `since`/`until` are ISO-8601 timestamps
(UTC, e.g. `2026-05-28T18:00:00Z`).

Connection is read from NESSO_PG_* env vars at construction time so
the adapter can run in-container next to nesso-postgres or be tunneled
to from a laptop.
"""
from __future__ import annotations

import hashlib
import os
import re
from datetime import datetime, timezone
from typing import Iterator
from urllib.parse import parse_qs, urlparse

import numpy as np
import pandas as pd
import psycopg
from psycopg.rows import dict_row

from .base import ImportedRecording


_URI_PREFIX = "nesso://"


def _parse_iso(s: str) -> datetime:
    # Accept trailing Z (postgres-friendly). datetime.fromisoformat handles +00:00 natively.
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _parse_uri(path: str) -> tuple[str, datetime, datetime]:
    """Return (device_id, since, until) parsed from a nesso:// URI."""
    if not path.startswith(_URI_PREFIX):
        raise ValueError(f"nesso adapter URI must start with {_URI_PREFIX!r}, got {path!r}")
    parsed = urlparse(path)
    device_id = parsed.netloc or parsed.path.lstrip("/")
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", device_id):
        raise ValueError(f"nesso adapter expected a UUID, got device_id={device_id!r}")
    qs = parse_qs(parsed.query)
    since_raw = qs.get("since", [None])[0]
    until_raw = qs.get("until", [None])[0]
    if not since_raw or not until_raw:
        raise ValueError(
            "nesso adapter URI requires `since` and `until` query params (ISO-8601 UTC)"
        )
    return device_id, _parse_iso(since_raw), _parse_iso(until_raw)


def _conn_kwargs() -> dict:
    """Postgres connection params from env. Defaults point at nesso-postgres
    on the docker network — override with NESSO_PG_* when running locally."""
    return dict(
        host=os.getenv("NESSO_PG_HOST", "nesso-postgres"),
        port=int(os.getenv("NESSO_PG_PORT", "5432")),
        dbname=os.getenv("NESSO_PG_DB", "nesso"),
        user=os.getenv("NESSO_PG_USER", "nesso"),
        password=os.getenv("NESSO_PG_PASSWORD", "nesso"),
    )


class NessoPgAdapter:
    @property
    def format_name(self) -> str:
        return "nesso_pg"

    def detect(self, path: str) -> bool:
        return path.startswith(_URI_PREFIX)

    def scan(self, path: str) -> list[str]:
        # One nesso:// URI = one recording (a single time window). The
        # recording id is the device_id, which is unique-enough for the
        # `recordings.name` UNIQUE(dataset_id, name) constraint.
        device_id, _, _ = _parse_uri(path)
        return [device_id]

    def load(self, path: str, recording_id: str) -> ImportedRecording:
        device_id, since, until = _parse_uri(path)
        if recording_id != device_id:
            raise ValueError(
                f"nesso adapter: recording_id {recording_id!r} doesn't match URI device {device_id!r}"
            )

        # Pull raw IMU samples. Columns mirror nesso's `raw_imu` schema:
        # ts (timestamptz), ax/ay/az (linear accel, m/s^2), gx/gy/gz (gyro, rad/s).
        with psycopg.connect(**_conn_kwargs(), row_factory=dict_row) as conn:
            cur = conn.execute(
                """
                SELECT ts, ax, ay, az, gx, gy, gz
                FROM raw_imu
                WHERE device_id = %s AND ts >= %s AND ts < %s
                ORDER BY ts ASC
                """,
                (device_id, since, until),
            )
            rows = cur.fetchall()

        if not rows:
            raise ValueError(
                f"nesso adapter: no raw_imu samples for device {device_id} "
                f"between {since.isoformat()} and {until.isoformat()}"
            )

        # Convert to label's standard ImportedRecording shape: timestamp_ns
        # + channel_N columns. We keep all 6 channels (3 accel + 3 gyro).
        ts_ns = np.array([int(r["ts"].timestamp() * 1e9) for r in rows], dtype=np.int64)
        data = pd.DataFrame({
            "timestamp_ns": ts_ns,
            "channel_0": np.array([r["ax"] for r in rows], dtype=np.float32),
            "channel_1": np.array([r["ay"] for r in rows], dtype=np.float32),
            "channel_2": np.array([r["az"] for r in rows], dtype=np.float32),
            "channel_3": np.array([r["gx"] for r in rows], dtype=np.float32),
            "channel_4": np.array([r["gy"] for r in rows], dtype=np.float32),
            "channel_5": np.array([r["gz"] for r in rows], dtype=np.float32),
        })

        if len(data) > 1:
            dt = np.median(np.diff(data["timestamp_ns"].values[:1000]))
            sample_rate = float(1e9 / dt) if dt > 0 else 50.0
        else:
            sample_rate = 50.0

        short_id = device_id[:8]
        name = f"{short_id}_{since.strftime('%Y%m%dT%H%M%SZ')}_{until.strftime('%Y%m%dT%H%M%SZ')}"

        return ImportedRecording(
            name=name,
            participant_code=None,
            data=data,
            sample_rate_hz=round(sample_rate, 1),
            channel_names=["accel_x", "accel_y", "accel_z", "gyro_x", "gyro_y", "gyro_z"],
            channel_units=["m/s^2", "m/s^2", "m/s^2", "rad/s", "rad/s", "rad/s"],
            labels=None,
            metadata={
                "source": "nesso_pg",
                "device_id": device_id,
                "since": since.isoformat(),
                "until": until.isoformat(),
                "sample_count": len(data),
            },
        )

    def load_all(self, path: str) -> Iterator[ImportedRecording]:
        # One URI = one recording.
        yield self.load(path, _parse_uri(path)[0])

    def content_hash(self, path: str) -> str:
        """Deterministic dedup key from (device, window) instead of dir contents.

        Used by import_service when the source path is not a filesystem
        path. See import_service.compute_dir_hash for the filesystem case.
        """
        device_id, since, until = _parse_uri(path)
        h = hashlib.sha256()
        h.update(device_id.encode())
        h.update(since.isoformat().encode())
        h.update(until.isoformat().encode())
        return h.hexdigest()[:16]
