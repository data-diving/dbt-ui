"""Scheduler settings read from DBT_UI__SCHEDULER_* environment variables."""
import os
import re
from pathlib import Path
from typing import Optional


def _env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        return default
    return value.strip().lower() in ("true", "1", "yes")


def _env_int(name: str, default: int) -> int:
    value = os.environ.get(name, "").strip()
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        print(f"[scheduler] Invalid integer for {name}: {value!r}, using {default}")
        return default


def parse_memory_size(value: str) -> Optional[int]:
    """Parse sizes like '512m', '2g', '1073741824' into bytes. Empty means no limit."""
    value = (value or "").strip().lower()
    if not value:
        return None
    match = re.fullmatch(r"(\d+(?:\.\d+)?)\s*([kmgt]?)b?", value)
    if not match:
        raise ValueError(f"Invalid memory size: {value!r}")
    number, unit = match.groups()
    multiplier = {"": 1, "k": 1024, "m": 1024 ** 2, "g": 1024 ** 3, "t": 1024 ** 4}[unit]
    return int(float(number) * multiplier)


class SchedulerSettings:
    """Snapshot of scheduler configuration. Re-read via load_settings() in tests."""

    def __init__(self):
        self.enabled = _env_bool("DBT_UI__SCHEDULER_ENABLED", False)
        self.data_dir = Path(
            os.environ.get("DBT_UI__SCHEDULER_DATA_DIR", "").strip() or (Path.home() / ".dbt-ui")
        ).expanduser()
        self.db_url = (
            os.environ.get("DBT_UI__SCHEDULER_DB_URL", "").strip()
            or f"sqlite:///{self.data_dir / 'dbt-ui.db'}"
        )
        self.encryption_key = os.environ.get("DBT_UI__SCHEDULER_ENCRYPTION_KEY", "").strip()
        self.max_concurrent = max(1, _env_int("DBT_UI__SCHEDULER_MAX_CONCURRENT", 2))
        self.max_memory_raw = os.environ.get("DBT_UI__SCHEDULER_MAX_MEMORY", "").strip()
        self.retention_days = max(1, _env_int("DBT_UI__SCHEDULER_RETENTION_DAYS", 30))
        self.manual_timeout = max(1, _env_int("DBT_UI__SCHEDULER_MANUAL_TIMEOUT", 300))
        self.tick_seconds = max(1, _env_int("DBT_UI__SCHEDULER_TICK_SECONDS", 15))
        self.max_catchup_runs = max(1, _env_int("DBT_UI__SCHEDULER_MAX_CATCHUP_RUNS", 100))
        self.catchup_scan_seconds = max(1, _env_int("DBT_UI__SCHEDULER_CATCHUP_SCAN_SECONDS", 600))
        # Address of the dbt UI (also allowed for CORS), for links to runs in failure notifications
        self.ui_url = os.environ.get("DBT_UI__FRONTEND_URL", "").strip().rstrip("/")

    @property
    def max_memory_bytes(self) -> Optional[int]:
        return parse_memory_size(self.max_memory_raw)

    @property
    def runs_dir(self) -> Path:
        return self.data_dir / "runs"

    @property
    def checkouts_dir(self) -> Path:
        return self.data_dir / "checkouts"


settings = SchedulerSettings()


def load_settings() -> SchedulerSettings:
    """Re-read settings from the environment (used by tests)."""
    global settings
    settings = SchedulerSettings()
    return settings
