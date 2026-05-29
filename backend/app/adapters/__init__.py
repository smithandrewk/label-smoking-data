from .base import DataAdapter, ImportedRecording, AdapterRegistry
from .legacy_csv import LegacyCsvAdapter
from .m5_smoking import M5SmokingAdapter
from .m3_listerine_raw import M3ListerineRawAdapter
from .m3_listerine_pt import M3ListerinePtAdapter
from .nesso_pg import NessoPgAdapter


def get_default_registry() -> AdapterRegistry:
    registry = AdapterRegistry()
    registry.register(M5SmokingAdapter())
    registry.register(M3ListerinePtAdapter())
    registry.register(M3ListerineRawAdapter())
    registry.register(LegacyCsvAdapter())
    registry.register(NessoPgAdapter())
    return registry
