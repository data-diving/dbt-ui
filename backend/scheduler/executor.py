"""Runs a dbt command as an isolated subprocess.

Safeguards that keep the API process healthy while dbt runs in the same container:
- dbt runs in its own process group, so cancel/timeout signals reach dbt and its children only
- oom_score_adj=1000 makes the kernel OOM killer pick dbt before the API (Linux only)
- optional address-space limit (RLIMIT_AS) turns runaway memory into a MemoryError (Linux only)
- lowered CPU priority so parsing large projects doesn't starve API requests
"""
import asyncio
import os
import signal
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

import psutil

from scheduler.db import utcnow

NICE_INCREMENT = 10
MEMORY_SAMPLE_SECONDS = 1.0
MEMORY_PROFILE_POINTS = 30
# How long dbt gets to cancel its warehouse queries after SIGINT before escalating
CANCEL_GRACE_SECONDS = 20
TERMINATE_GRACE_SECONDS = 10


def memory_profile(samples: List[int], max_points: int = MEMORY_PROFILE_POINTS) -> List[List[int]]:
    """Downsample per-second memory samples to at most max_points [seconds, bytes] pairs, keeping peaks."""
    if not samples:
        return []
    bucket = max(1, -(-len(samples) // max_points))  # ceil
    return [
        [round(i * MEMORY_SAMPLE_SECONDS), max(samples[i:i + bucket])]
        for i in range(0, len(samples), bucket)
    ]


@dataclass
class ExecutionResult:
    returncode: Optional[int]
    stdout: str
    stderr: str
    started_at: datetime
    finished_at: datetime
    timed_out: bool = False
    cancelled: bool = False
    peak_memory_bytes: Optional[int] = None
    avg_memory_bytes: Optional[int] = None
    # [[seconds since start, bytes], ...] downsampled for charts
    memory_profile: List[List[int]] = field(default_factory=list)

    @property
    def success(self) -> bool:
        return self.returncode == 0 and not self.timed_out and not self.cancelled

    @property
    def killed_by_oom(self) -> bool:
        """SIGKILL that we didn't send ourselves - almost always the kernel OOM killer."""
        return self.returncode == -signal.SIGKILL and not self.timed_out and not self.cancelled


def _apply_safeguards(pid: int, max_memory_bytes: Optional[int]) -> None:
    """Best-effort resource limits on the freshly started dbt process."""
    if sys.platform.startswith("linux"):
        try:
            Path(f"/proc/{pid}/oom_score_adj").write_text("1000")
        except OSError as e:
            print(f"[scheduler] Could not set oom_score_adj for {pid}: {e}")
        if max_memory_bytes:
            try:
                import resource
                resource.prlimit(pid, resource.RLIMIT_AS, (max_memory_bytes, max_memory_bytes))
            except (OSError, ValueError, AttributeError) as e:
                print(f"[scheduler] Could not set memory limit for {pid}: {e}")
    try:
        os.setpriority(os.PRIO_PROCESS, pid, NICE_INCREMENT)
    except (OSError, AttributeError) as e:
        print(f"[scheduler] Could not lower priority for {pid}: {e}")


class DbtProcess:
    """A single dbt subprocess with live log file, memory sampling, timeout and cancel."""

    def __init__(
        self,
        cmd: List[str],
        cwd: Path,
        env: Dict[str, str],
        log_path: Path,
        timeout_seconds: Optional[int],
        max_memory_bytes: Optional[int] = None,
    ):
        self.cmd = cmd
        self.cwd = cwd
        self.env = env
        self.log_path = log_path
        self.timeout_seconds = timeout_seconds
        self.max_memory_bytes = max_memory_bytes
        self._process: Optional[asyncio.subprocess.Process] = None
        self._cancel_requested = False
        self._stop_task: Optional[asyncio.Task] = None
        self._memory_samples: List[int] = []

    def live_memory_profile(self) -> List[List[int]]:
        """Memory profile so far, for runs in progress."""
        return memory_profile(list(self._memory_samples))

    @property
    def pid(self) -> Optional[int]:
        return self._process.pid if self._process else None

    async def run(self) -> ExecutionResult:
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        started_at = utcnow()
        stdout_chunks: List[str] = []
        stderr_chunks: List[str] = []
        timed_out = False

        # Append: scheduled runs write checkout/venv preparation output before dbt starts
        with open(self.log_path, "a", encoding="utf-8") as log_file:
            self._process = await asyncio.create_subprocess_exec(
                *self.cmd,
                cwd=str(self.cwd),
                env=self.env,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                start_new_session=True,
            )
            _apply_safeguards(self._process.pid, self.max_memory_bytes)

            if self._cancel_requested:
                self._begin_stop()

            sampler = asyncio.create_task(self._sample_memory())
            readers = [
                asyncio.create_task(self._pump(self._process.stdout, stdout_chunks, log_file)),
                asyncio.create_task(self._pump(self._process.stderr, stderr_chunks, log_file)),
            ]
            try:
                await asyncio.wait_for(self._process.wait(), timeout=self.timeout_seconds)
            except asyncio.TimeoutError:
                timed_out = True
                log_file.write(f"\n[dbt-ui] Timed out after {self.timeout_seconds}s, stopping dbt...\n")
                log_file.flush()
                self._begin_stop()
                await self._process.wait()
            finally:
                await asyncio.gather(*readers, return_exceptions=True)
                sampler.cancel()
                await asyncio.gather(sampler, return_exceptions=True)
                if self._stop_task:
                    self._stop_task.cancel()

            if self._cancel_requested and not timed_out:
                log_file.write("\n[dbt-ui] Run cancelled.\n")

        samples = self._memory_samples
        return ExecutionResult(
            returncode=self._process.returncode,
            stdout="".join(stdout_chunks),
            stderr="".join(stderr_chunks),
            started_at=started_at,
            finished_at=utcnow(),
            timed_out=timed_out,
            cancelled=self._cancel_requested and not timed_out,
            peak_memory_bytes=max(samples) if samples else None,
            avg_memory_bytes=int(sum(samples) / len(samples)) if samples else None,
            memory_profile=memory_profile(samples),
        )

    def cancel(self) -> None:
        """Ask dbt to stop: SIGINT (dbt cancels running queries), then SIGTERM, then SIGKILL."""
        self._cancel_requested = True
        if self._process and self._process.returncode is None:
            self._begin_stop()

    def kill(self) -> None:
        """Immediately SIGKILL the whole process group."""
        if self._process and self._process.returncode is None:
            try:
                os.killpg(self._process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

    def _begin_stop(self) -> None:
        if self._stop_task is None or self._stop_task.done():
            self._stop_task = asyncio.create_task(self._stop_sequence())

    async def _stop_sequence(self) -> None:
        process = self._process
        if process is None:
            return
        for sig, grace in (
            (signal.SIGINT, CANCEL_GRACE_SECONDS),
            (signal.SIGTERM, TERMINATE_GRACE_SECONDS),
            (signal.SIGKILL, None),
        ):
            if process.returncode is not None:
                return
            try:
                os.killpg(process.pid, sig)
            except ProcessLookupError:
                return
            if grace is None:
                return
            try:
                await asyncio.wait_for(asyncio.shield(process.wait()), timeout=grace)
                return
            except asyncio.TimeoutError:
                continue

    async def _pump(self, stream: asyncio.StreamReader, chunks: List[str], log_file) -> None:
        while True:
            data = await stream.read(8192)
            if not data:
                return
            text = data.decode("utf-8", errors="replace")
            chunks.append(text)
            log_file.write(text)
            log_file.flush()

    async def _sample_memory(self) -> None:
        try:
            proc = psutil.Process(self._process.pid)
        except psutil.Error:
            return
        while True:
            try:
                total = proc.memory_info().rss
                for child in proc.children(recursive=True):
                    try:
                        total += child.memory_info().rss
                    except psutil.Error:
                        pass
                self._memory_samples.append(total)
            except psutil.Error:
                return
            await asyncio.sleep(MEMORY_SAMPLE_SECONDS)
