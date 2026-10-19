"""Entry point used by the existing manual dbt command flow.

When the scheduler is enabled and ready, manual runs execute through the run manager
(history, metrics, safeguards). Otherwise the original subprocess call is used unchanged.
"""
import asyncio
import subprocess
from pathlib import Path
from typing import Dict, List

from scheduler import config
from scheduler.service import scheduler_is_ready
from utils.subprocess_utils import CommandResult, run_command


def run_dbt_command(
    cmd: List[str], path: Path, timeout: int, env: Dict[str, str],
    command: str, selector: str, target: str, full_refresh: bool,
) -> CommandResult:
    """Drop-in replacement for run_command() in the manual dbt task (called from a worker thread)."""
    if not scheduler_is_ready():
        return run_command(cmd, path, timeout=timeout, env=env)

    from scheduler.manager import run_manager

    future = asyncio.run_coroutine_threadsafe(
        run_manager.run_manual(cmd, path, env, command, selector, target, full_refresh),
        run_manager.loop,
    )
    result = future.result()
    if result.timed_out:
        # Same exception the original path raises, so the caller reports it identically
        raise subprocess.TimeoutExpired(cmd, config.settings.manual_timeout)
    returncode = result.returncode if result.returncode is not None else -1
    return CommandResult(returncode, result.stdout, result.stderr)
