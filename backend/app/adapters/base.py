from __future__ import annotations
from dataclasses import dataclass, field
from typing import Protocol, Iterator, runtime_checkable
import pandas as pd


@dataclass
class ImportedRecording:
    """Standard output of any adapter."""
    name: str
    participant_code: str | None
    data: pd.DataFrame  # columns: timestamp_ns, channel_0, channel_1, ...
    sample_rate_hz: float
    channel_names: list[str]  # e.g., ["accel_x", "accel_y", "accel_z"]
    channel_units: list[str] | None = None
    labels: list[dict] | None = None  # [{"start_ns":..., "end_ns":..., "label":...}]
    metadata: dict = field(default_factory=dict)


@runtime_checkable
class DataAdapter(Protocol):
    """Protocol that all format adapters must implement."""

    @property
    def format_name(self) -> str: ...

    def detect(self, path: str) -> bool: ...

    def scan(self, path: str) -> list[str]: ...

    def load(self, path: str, recording_id: str) -> ImportedRecording: ...

    def load_all(self, path: str) -> Iterator[ImportedRecording]: ...


class AdapterRegistry:
    """Discovers and manages available format adapters."""

    def __init__(self):
        self._adapters: list[DataAdapter] = []

    def register(self, adapter: DataAdapter) -> None:
        self._adapters.append(adapter)

    def detect(self, path: str) -> DataAdapter | None:
        for adapter in self._adapters:
            if adapter.detect(path):
                return adapter
        return None

    def get(self, format_name: str) -> DataAdapter | None:
        for adapter in self._adapters:
            if adapter.format_name == format_name:
                return adapter
        return None

    def list_formats(self) -> list[str]:
        return [a.format_name for a in self._adapters]
