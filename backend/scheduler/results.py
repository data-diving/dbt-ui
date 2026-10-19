"""Parse dbt's run_results.json into per-model timings, statuses and rows affected."""
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

SUCCESS_STATUSES = {"success", "pass", "warn"}
ERROR_STATUSES = {"error", "fail", "runtime error"}
SKIPPED_STATUSES = {"skipped"}


@dataclass
class ModelResult:
    unique_id: str
    name: str
    resource_type: str
    status: str
    thread_id: str
    started_at: Optional[datetime]
    finished_at: Optional[datetime]
    execution_time: Optional[float]
    rows_affected: Optional[int]
    message: str
    adapter_response: str


def _parse_ts(value: Optional[str]) -> Optional[datetime]:
    """Parse dbt timestamps ('2026-10-09T10:00:00.123456Z') into naive UTC datetimes."""
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _rows_affected(adapter_response: dict) -> Optional[int]:
    value = adapter_response.get("rows_affected")
    if isinstance(value, bool) or value is None:
        return None
    try:
        rows = int(value)
    except (TypeError, ValueError):
        return None
    # Some adapters report -1 for statements without a row count (e.g. views)
    return rows if rows >= 0 else None


def node_name(unique_id: str) -> str:
    """Display name from a unique_id; generic tests end in a hash, so their name is the part before it."""
    parts = unique_id.split(".")
    if parts[0] == "test" and len(parts) == 4:
        return parts[2]
    return parts[-1]


def parse_run_results(path: Path, not_before: Optional[datetime] = None) -> List[ModelResult]:
    """Read run_results.json. Returns [] if the file is missing, unreadable, or older than not_before."""
    if not path.exists():
        return []
    if not_before is not None:
        modified = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).replace(tzinfo=None)
        # Allow a little clock slack between the filesystem and the run start time
        if (not_before - modified).total_seconds() > 2:
            return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        print(f"[scheduler] Could not read {path}: {e}")
        return []

    results: List[ModelResult] = []
    for item in data.get("results", []) or []:
        unique_id = item.get("unique_id") or ""
        parts = unique_id.split(".")
        timings = item.get("timing") or []
        starts = [_parse_ts(t.get("started_at")) for t in timings]
        ends = [_parse_ts(t.get("completed_at")) for t in timings]
        starts = [s for s in starts if s]
        ends = [e for e in ends if e]
        adapter_response = item.get("adapter_response") or {}
        results.append(ModelResult(
            unique_id=unique_id,
            name=node_name(unique_id),
            resource_type=parts[0] if len(parts) > 1 else "",
            status=str(item.get("status") or ""),
            thread_id=str(item.get("thread_id") or ""),
            started_at=min(starts) if starts else None,
            finished_at=max(ends) if ends else None,
            execution_time=item.get("execution_time"),
            rows_affected=_rows_affected(adapter_response),
            message=str(item.get("message") or ""),
            adapter_response=json.dumps(adapter_response) if adapter_response else "",
        ))
    return results


def summarize(results: List[ModelResult]) -> dict:
    """Aggregate counts and total rows affected for the run row."""
    rows = [r.rows_affected for r in results if r.rows_affected is not None]
    return {
        "models_success": sum(1 for r in results if r.status in SUCCESS_STATUSES),
        "models_error": sum(1 for r in results if r.status in ERROR_STATUSES),
        "models_skipped": sum(1 for r in results if r.status in SKIPPED_STATUSES),
        "rows_affected": sum(rows) if rows else None,
    }
