"""Run manager: executes manual and scheduled dbt runs and records them in the database."""
import asyncio
import json
import shutil
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

from sqlalchemy import delete, select, update

from scheduler import checkout, config
from scheduler.crypto import decrypt_dict
from scheduler.db import Job, ProjectCredentials, Run, RunModelResult, session_scope, utcnow
from scheduler.executor import DbtProcess, ExecutionResult
from scheduler.notify import notify_run_failure
from scheduler.results import parse_run_results, summarize
from utils.dbt_utils import get_dbt_env
from utils.venv_utils import get_venv_dbt_path

ACTIVE_STATUSES = ("queued", "running")
SKIPPABLE_STATUSES = ("scheduled",) + ACTIVE_STATUSES
ERROR_TAIL_CHARS = 4000
SKIPPED_BY_USER = "Skipped by user"


def run_dir(run_id: int) -> Path:
    return config.settings.runs_dir / str(run_id)


def build_dbt_command(
    dbt_executable: str, command: str, project_dir: Path,
    selector: str = "", target: str = "", full_refresh: bool = False, dbt_vars: Optional[dict] = None,
) -> List[str]:
    """Same command shape as the existing manual run path."""
    cmd = [dbt_executable, command, "--project-dir", str(project_dir), "--profiles-dir", str(project_dir)]
    if selector:
        cmd.extend(["--select", selector])
    if target:
        cmd.extend(["--target", target])
    if full_refresh and command in ("run", "seed", "build"):
        cmd.append("--full-refresh")
    if dbt_vars:
        cmd.extend(["--vars", json.dumps(dbt_vars)])
    return cmd


def schedule_vars(scheduled_for: datetime, cron: str) -> Dict[str, object]:
    """dbt vars describing the cron slot a job run is for (the original slot for catch-ups and reruns)."""
    slot = scheduled_for.replace(tzinfo=timezone.utc)
    return {
        "dbt_ui_run_timestamp": int(slot.timestamp()),
        "dbt_ui_run_datetime": slot.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "dbt_ui_cron": cron,
    }


@dataclass
class RunRequest:
    """One run of a job to start. Fields left as None take the job's current settings."""
    scheduled_for: datetime
    trigger: str
    rerun_of_id: Optional[int] = None
    command: Optional[str] = None
    selector: Optional[str] = None
    target: Optional[str] = None
    full_refresh: Optional[bool] = None
    dbt_vars: Optional[dict] = None
    commit_sha: str = ""  # run exactly this commit instead of the job's code source
    run_id: Optional[int] = None  # start this existing run (the job's scheduled run) instead of a new one


def job_run_fields(job: Job) -> dict:
    """Run columns shared by every run of a job."""
    root = checkout.checkout_root(job.id)
    return dict(
        job_id=job.id, job_name=job.name, project_key=job.project_key,
        project_path=str(root / job.subdirectory if job.subdirectory else root),
    )


def skipped_slot_run(job: Job, slot: datetime, reason: str) -> Run:
    """A run that records a slot the job did not run for (paused, or missed and not caught up)."""
    return Run(
        **job_run_fields(job), trigger="schedule", triggered_by=job.created_by, command=job.command,
        selector=job.selector, target=job.target, full_refresh=job.full_refresh, status="skipped",
        error=f"Skipped: {reason}", queued_at=slot, finished_at=utcnow(), scheduled_for=slot,
        dbt_vars=json.dumps(schedule_vars(slot, job.cron)),
    )


def sync_scheduled_run(session, job: Job) -> None:
    """Keep one 'scheduled' run per enabled job, for its next slot and with its current settings.

    Scheduled runs that no longer apply (the job was paused, its schedule changed) never ran,
    so they are removed rather than kept in the history.
    """
    rows = session.execute(
        select(Run).where(Run.job_id == job.id, Run.status == "scheduled")
    ).scalars().all()
    current = None
    for row in rows:
        if current is None and job.enabled and job.next_run_at is not None and row.scheduled_for == job.next_run_at:
            current = row
        else:
            session.delete(row)
    if not job.enabled or job.next_run_at is None:
        return
    if current is None:
        current = Run(**job_run_fields(job), trigger="schedule", status="scheduled",
                      scheduled_for=job.next_run_at, queued_at=job.next_run_at)
        session.add(current)
    current.job_name = job.name
    current.triggered_by = job.created_by
    current.command, current.selector, current.target = job.command, job.selector, job.target
    current.full_refresh = job.full_refresh
    current.dbt_vars = json.dumps(schedule_vars(job.next_run_at, job.cron))


def _failure_message(result: ExecutionResult, timeout_seconds: Optional[int]) -> str:
    if result.timed_out:
        return f"Timed out after {timeout_seconds}s"
    if result.killed_by_oom:
        return "dbt was killed by the system, most likely out of memory"
    tail = (result.stderr or result.stdout or "").strip()[-ERROR_TAIL_CHARS:]
    return f"dbt exited with code {result.returncode}" + (f"\n{tail}" if tail else "")


def _final_status(result: ExecutionResult, interrupted: bool = False) -> str:
    if result.success:
        return "success"
    if interrupted:
        return "interrupted"
    if result.cancelled:
        return "cancelled"
    return "failed"


def _create_run(run_id: Optional[int] = None, **fields) -> int:
    """Create a run, or start an existing one (a job's scheduled run) with these fields."""
    with session_scope() as session:
        run = session.get(Run, run_id) if run_id else None
        if run is None:
            run = Run(**fields)
            session.add(run)
            session.flush()
        else:
            for key, value in fields.items():
                setattr(run, key, value)
            run.queued_at = utcnow()
        run.log_path = str(run_dir(run.id) / "output.log")
        return run.id


def _update_run(run_id: int, **fields) -> None:
    with session_scope() as session:
        session.execute(update(Run).where(Run.id == run_id).values(**fields))


def _record_result(
    run_id: int, result: ExecutionResult, results_file: Path, timeout_seconds: Optional[int], interrupted: bool = False,
    skipped: bool = False,
) -> None:
    models = parse_run_results(results_file, not_before=result.started_at)
    if models and results_file.exists():
        try:
            shutil.copy2(results_file, run_dir(run_id) / "run_results.json")
        except OSError:
            pass
    status = "skipped" if skipped else _final_status(result, interrupted)
    with session_scope() as session:
        run = session.get(Run, run_id)
        if run is None:
            return
        run.status = status
        run.exit_code = result.returncode
        run.started_at = result.started_at
        run.finished_at = result.finished_at
        run.peak_memory_bytes = result.peak_memory_bytes
        run.avg_memory_bytes = result.avg_memory_bytes
        run.memory_profile = json.dumps(result.memory_profile) if result.memory_profile else ""
        run.error = {
            "success": "",
            "cancelled": "Cancelled by user",
            "interrupted": "Backend stopped while the run was in progress",
            "skipped": SKIPPED_BY_USER,
        }.get(status) or _failure_message(result, timeout_seconds)
        for key, value in summarize(models).items():
            setattr(run, key, value)
        run.models = [
            RunModelResult(
                unique_id=m.unique_id, name=m.name, resource_type=m.resource_type, status=m.status,
                thread_id=m.thread_id, started_at=m.started_at, finished_at=m.finished_at,
                execution_time=m.execution_time, rows_affected=m.rows_affected,
                message=m.message[:ERROR_TAIL_CHARS], adapter_response=m.adapter_response,
            )
            for m in models
        ]


def _load_job(job_id: int) -> Optional[Job]:
    with session_scope() as session:
        return session.get(Job, job_id)


def resolve_job_env(job: Job) -> Dict[str, str]:
    """Decrypt the env vars a job runs with, according to its credentials mode."""
    if job.credentials_mode == "project":
        with session_scope() as session:
            creds = session.get(ProjectCredentials, job.project_key)
            if creds is None or not creds.env_encrypted:
                raise RuntimeError("The job uses project credentials, but none are set for this project")
            return decrypt_dict(creds.env_encrypted)
    return decrypt_dict(job.env_encrypted)


class RunManager:
    def __init__(self):
        self._semaphore: Optional[asyncio.Semaphore] = None
        self._active: Dict[int, DbtProcess] = {}
        self._job_locks: Dict[int, asyncio.Lock] = {}
        self._job_runs: Dict[int, int] = {}  # queued + running runs per job
        self._cancel_requested: Set[int] = set()
        self._skip_requested: Set[int] = set()  # cancelled with "Skip this run": recorded as skipped
        self._tasks: Set[asyncio.Task] = set()
        self._shutting_down = False
        self.loop: Optional[asyncio.AbstractEventLoop] = None

    def start(self) -> None:
        self.loop = asyncio.get_running_loop()
        self._semaphore = asyncio.Semaphore(config.settings.max_concurrent)
        self._job_locks = {}
        self._job_runs = {}
        self._cancel_requested = set()
        self._skip_requested = set()
        self._shutting_down = False

    def _job_lock(self, job_id: int) -> asyncio.Lock:
        return self._job_locks.setdefault(job_id, asyncio.Lock())

    def _spawn(self, coro) -> asyncio.Task:
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    # ---- Manual runs (delegated from the existing dbt command endpoints) ----

    async def run_manual(
        self, cmd: List[str], project_dir: Path, env: Dict[str, str],
        command: str, selector: str, target: str, full_refresh: bool,
    ) -> ExecutionResult:
        """Run a manual dbt command in the user's worktree and record it.

        Manual runs share the service-wide concurrency limit with scheduled runs: when all
        slots are busy the run is recorded as queued and starts as soon as one frees up.
        The timeout only counts time spent running, not waiting.
        """
        try:
            project = await asyncio.to_thread(checkout.resolve_project, project_dir)
            project_key, triggered_by = project.project_key, project.git_user_name
            commit = await asyncio.to_thread(_head_sha, project_dir)
        except Exception as e:
            print(f"[scheduler] Could not resolve project for manual run: {e}")
            project_key, triggered_by, commit = str(project_dir), "", ""

        run_id = await asyncio.to_thread(
            _create_run,
            job_id=None, job_name="", project_key=project_key, project_path=str(project_dir),
            trigger="manual", triggered_by=triggered_by, command=command, selector=selector,
            target=target, full_refresh=full_refresh, commit_sha=commit, status="queued",
        )
        async with self._semaphore:
            if run_id in self._cancel_requested:
                self._cancel_requested.discard(run_id)
                await asyncio.to_thread(
                    _update_run, run_id, **self._stopped(run_id, "Cancelled before start"), finished_at=utcnow()
                )
                now = utcnow()
                return ExecutionResult(
                    returncode=None, stdout="", stderr="Cancelled before start", started_at=now,
                    finished_at=now, cancelled=True,
                )
            await asyncio.to_thread(_update_run, run_id, status="running", started_at=utcnow())
            return await self._execute_manual(run_id, cmd, project_dir, env)

    async def _execute_manual(self, run_id: int, cmd: List[str], project_dir: Path, env: Dict[str, str]) -> ExecutionResult:
        timeout = config.settings.manual_timeout
        process = DbtProcess(
            cmd, project_dir, env, run_dir(run_id) / "output.log",
            timeout_seconds=timeout, max_memory_bytes=config.settings.max_memory_bytes,
        )
        self._active[run_id] = process
        try:
            result = await process.run()
        except Exception as e:
            await asyncio.to_thread(
                _update_run, run_id, status="failed", error=f"Failed to start dbt: {e}", finished_at=utcnow()
            )
            raise
        finally:
            self._active.pop(run_id, None)
        await asyncio.to_thread(
            _record_result, run_id, result, project_dir / "target" / "run_results.json", timeout,
            self._shutting_down, self._take_skip(run_id),
        )
        return result

    # ---- Scheduled runs ----

    async def trigger_job(self, job_id: int, trigger: str, triggered_by: str) -> int:
        run_ids = await self.trigger_job_runs(
            job_id, [RunRequest(scheduled_for=utcnow().replace(microsecond=0), trigger=trigger)], triggered_by
        )
        return run_ids[0]

    async def trigger_job_runs(self, job_id: int, requests: List[RunRequest], triggered_by: str) -> List[int]:
        """Create one run per request and execute them one after another, in this order.

        Catch-up batches and reruns always queue behind runs in progress; otherwise the job's
        overlap policy decides whether a run that finds the job busy is skipped.
        """
        job = await asyncio.to_thread(_load_job, job_id)
        if job is None:
            raise ValueError(f"Job {job_id} not found")
        run_ids = []
        for req in requests:
            dbt_vars = req.dbt_vars or schedule_vars(req.scheduled_for, job.cron)
            run_ids.append(await asyncio.to_thread(
                _create_run, req.run_id,
                **job_run_fields(job), trigger=req.trigger, triggered_by=triggered_by,
                command=req.command or job.command,
                selector=job.selector if req.selector is None else req.selector,
                target=job.target if req.target is None else req.target,
                full_refresh=job.full_refresh if req.full_refresh is None else req.full_refresh,
                commit_sha=req.commit_sha, status="queued", scheduled_for=req.scheduled_for,
                rerun_of_id=req.rerun_of_id, dbt_vars=json.dumps(dbt_vars),
            ))

        # No awaits between this check and the counter updates below
        queue = len(run_ids) > 1 or any(r.rerun_of_id for r in requests) or job.overlap_policy == "queue"
        if self._job_runs.get(job_id) and not queue:
            for run_id in run_ids:
                await asyncio.to_thread(
                    _update_run, run_id, status="skipped",
                    error="Skipped: the previous run of this job is still in progress", finished_at=utcnow(),
                )
            return run_ids
        for run_id in run_ids:
            self._job_runs[job_id] = self._job_runs.get(job_id, 0) + 1
            self._spawn(self._execute_job_run(run_id, job_id))
        return run_ids

    async def _execute_job_run(self, run_id: int, job_id: int) -> None:
        # The job lock is acquired first thing, so a job's runs start in the order they were spawned
        try:
            async with self._job_lock(job_id):
                async with self._semaphore:
                    if run_id in self._cancel_requested:
                        self._cancel_requested.discard(run_id)
                        await asyncio.to_thread(
                            _update_run, run_id, **self._stopped(run_id, "Cancelled before start"), finished_at=utcnow()
                        )
                        return
                    # Loaded now: the job may have been edited or deleted while this run was queued
                    job = await asyncio.to_thread(_load_job, job_id)
                    if job is None:
                        await asyncio.to_thread(
                            _update_run, run_id, status="failed", error="Job was deleted", finished_at=utcnow()
                        )
                        return
                    await asyncio.to_thread(_update_run, run_id, status="running", started_at=utcnow())
                    await self._run_prepared_job(run_id, job)
        finally:
            self._job_runs[job_id] -= 1
        # Outside the job lock and the concurrency limit: a slow endpoint doesn't hold up other runs
        await self._notify_failure(run_id)

    async def _notify_failure(self, run_id: int) -> None:
        try:
            result = await asyncio.to_thread(notify_run_failure, run_id)
        except Exception as e:
            print(f"[scheduler] Failure notification for run {run_id} failed: {e}")
            return
        if result is None:
            return
        channel, error = result
        line = f"could not be sent via {channel}: {error}" if error else f"sent via {channel}"
        with open(run_dir(run_id) / "output.log", "a", encoding="utf-8") as f:
            f.write(f"\n[dbt-ui] Failure notification {line}\n")

    async def _run_prepared_job(self, run_id: int, job: Job) -> None:
        """Run a job with the parameters recorded on the run (the original ones for reruns)."""
        run = await asyncio.to_thread(_load_run, run_id)
        log_path = run_dir(run_id) / "output.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            project_dir, env_vars, sha = await asyncio.to_thread(
                self._prepare_job_sync, job, log_path, run.commit_sha
            )
        except Exception as e:
            with open(log_path, "a", encoding="utf-8") as f:
                f.write(f"\n[dbt-ui] {e}\n")
            await asyncio.to_thread(_update_run, run_id, status="failed", error=str(e), finished_at=utcnow())
            return
        await asyncio.to_thread(_update_run, run_id, commit_sha=sha)

        if run_id in self._cancel_requested:
            self._cancel_requested.discard(run_id)
            await asyncio.to_thread(
                _update_run, run_id, **self._stopped(run_id, "Cancelled by user"), finished_at=utcnow()
            )
            return

        dbt = str(get_venv_dbt_path(project_dir))
        cmd = build_dbt_command(
            dbt, run.command, project_dir, run.selector, run.target, run.full_refresh,
            json.loads(run.dbt_vars) if run.dbt_vars else None,
        )
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"[dbt-ui] Commit {sha}\n[dbt-ui] $ dbt {' '.join(cmd[1:])}\n\n")
        process = DbtProcess(
            cmd, project_dir, get_dbt_env(project_dir, env_vars), log_path,
            timeout_seconds=job.timeout_seconds, max_memory_bytes=config.settings.max_memory_bytes,
        )
        self._active[run_id] = process
        try:
            result = await process.run()
        except Exception as e:
            await asyncio.to_thread(_update_run, run_id, status="failed", error=f"Failed to start dbt: {e}", finished_at=utcnow())
            return
        finally:
            self._active.pop(run_id, None)
            self._cancel_requested.discard(run_id)
        await asyncio.to_thread(
            _record_result, run_id, result, project_dir / "target" / "run_results.json", job.timeout_seconds,
            self._shutting_down, self._take_skip(run_id),
        )

    def _prepare_job_sync(self, job: Job, log_path: Path, commit_sha: str = ""):
        """Fetch, check out and build the environment for a job. Runs in a worker thread."""
        def log(line: str) -> None:
            with open(log_path, "a", encoding="utf-8") as f:
                f.write(line.rstrip() + "\n")

        repo = Path(job.repo_path)
        env_vars = resolve_job_env(job)
        branch = checkout.get_default_branch(repo, repo)
        if not branch:
            raise RuntimeError("Could not determine the repository's default branch")

        if commit_sha:
            log("[dbt-ui] Rerunning the commit of the original run")
            sha = commit_sha
        elif job.pull_latest:
            log(f"[dbt-ui] Fetching latest '{branch}'...")
            checkout.fetch_default_branch(repo, branch, decrypt_dict(job.git_creds_encrypted))
            sha = checkout.resolve_branch_sha(repo, branch)
        else:
            if not job.pinned_sha:
                raise RuntimeError("The job is pinned but has no commit set")
            sha = job.pinned_sha
        log(f"[dbt-ui] Checking out {sha[:12]} of '{branch}'...")

        _set_checkout_state(job.id, "preparing")
        try:
            project_dir = checkout.prepare_checkout(job.id, repo, job.subdirectory, sha)
            venv_fp, deps_fp, lines = checkout.ensure_environment(
                project_dir, job.venv_fingerprint, job.deps_fingerprint, env_vars
            )
        except Exception as e:
            _set_checkout_state(job.id, "error", str(e))
            raise
        for line in lines:
            if line:
                log(line)
        _set_checkout_state(job.id, "ready", "", venv_fp, deps_fp)
        return project_dir, env_vars, sha

    async def prepare_job(self, job_id: int) -> None:
        """Prepare a job's checkout ahead of its first run (called when a job is saved)."""
        async with self._job_lock(job_id):
            job = await asyncio.to_thread(_load_job, job_id)
            if job is None:
                return
            log_path = config.settings.checkouts_dir / f"job-{job_id}.prepare.log"
            log_path.parent.mkdir(parents=True, exist_ok=True)
            log_path.write_text("", encoding="utf-8")
            try:
                await asyncio.to_thread(self._prepare_job_sync, job, log_path)
            except Exception as e:
                print(f"[scheduler] Preparing job {job_id} failed: {e}")

    def prepare_job_in_background(self, job_id: int) -> None:
        self._spawn(self.prepare_job(job_id))

    # ---- Control ----

    async def cancel(self, run_id: int) -> bool:
        process = self._active.get(run_id)
        if process is not None:
            process.cancel()
            return True
        # Queued or preparing: cancelled when it reaches the front
        status = await asyncio.to_thread(_run_status, run_id)
        if status in ACTIVE_STATUSES:
            self._cancel_requested.add(run_id)
            return True
        return False

    async def skip(self, run_id: int) -> bool:
        """Stop a queued or running run right away and record it as skipped.

        A running dbt process is killed at once (no graceful cancel), so the next queued run can
        take its slot; a queued run is dropped when it reaches the front.
        """
        status = await asyncio.to_thread(_run_status, run_id)
        if status not in ACTIVE_STATUSES:
            return False
        self._skip_requested.add(run_id)
        process = self._active.get(run_id)
        if process is not None:
            process.kill()
        else:
            self._cancel_requested.add(run_id)
        return True

    def _take_skip(self, run_id: int) -> bool:
        skipped = run_id in self._skip_requested
        self._skip_requested.discard(run_id)
        return skipped

    def _stopped(self, run_id: int, cancelled_error: str) -> dict:
        """Status and error of a run stopped before dbt started: skipped or cancelled."""
        if self._take_skip(run_id):
            return {"status": "skipped", "error": SKIPPED_BY_USER}
        return {"status": "cancelled", "error": cancelled_error}

    def live_memory_profile(self, run_id: int) -> Optional[List[List[int]]]:
        """Memory samples so far of a run whose dbt process is running, else None."""
        process = self._active.get(run_id)
        return process.live_memory_profile() if process is not None else None

    def is_job_busy(self, job_id: int) -> bool:
        """True while the job has a queued/running run or its checkout is being prepared."""
        return bool(self._job_runs.get(job_id)) or self._job_lock(job_id).locked()

    async def shutdown(self) -> None:
        """Stop running dbt processes; their runs are recorded as interrupted, not cancelled."""
        self._shutting_down = True
        for process in list(self._active.values()):
            process.cancel()
        deadline = asyncio.get_running_loop().time() + 5
        while self._active and asyncio.get_running_loop().time() < deadline:
            await asyncio.sleep(0.2)
        # dbt runs in its own process group, so it would outlive the backend: don't leave orphans
        for process in list(self._active.values()):
            process.kill()
        for task in list(self._tasks):
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        mark_interrupted("Backend stopped while the run was in progress")


def _head_sha(path: Path) -> str:
    from utils.subprocess_utils import run_git_command
    result = run_git_command(["rev-parse", "HEAD"], path, timeout=5)
    return result.stdout.strip() if result.success else ""


def _load_run(run_id: int) -> Optional[Run]:
    with session_scope() as session:
        return session.get(Run, run_id)


def _run_status(run_id: int) -> Optional[str]:
    with session_scope() as session:
        run = session.get(Run, run_id)
        return run.status if run else None


def _set_checkout_state(job_id: int, state: str, error: str = "", venv_fp: str = None, deps_fp: str = None) -> None:
    values = {"checkout_state": state, "checkout_error": error}
    if venv_fp is not None:
        values["venv_fingerprint"] = venv_fp
    if deps_fp is not None:
        values["deps_fingerprint"] = deps_fp
    with session_scope() as session:
        session.execute(update(Job).where(Job.id == job_id).values(**values))


def mark_interrupted(reason: str) -> int:
    """Runs left queued/running by a previous process can never finish - close them."""
    with session_scope() as session:
        result = session.execute(
            update(Run).where(Run.status.in_(ACTIVE_STATUSES))
            .values(status="interrupted", error=reason, finished_at=utcnow())
        )
        session.execute(
            update(Job).where(Job.checkout_state == "preparing").values(checkout_state="pending")
        )
        return result.rowcount or 0


def cleanup_old_runs() -> int:
    """Delete runs (rows and log folders) older than the retention period."""
    cutoff = utcnow() - timedelta(days=config.settings.retention_days)
    with session_scope() as session:
        old_ids = session.execute(
            select(Run.id).where(Run.queued_at < cutoff, Run.status.notin_(ACTIVE_STATUSES))
        ).scalars().all()
        if old_ids:
            session.execute(delete(RunModelResult).where(RunModelResult.run_id.in_(old_ids)))
            session.execute(delete(Run).where(Run.id.in_(old_ids)))
    for run_id in old_ids:
        shutil.rmtree(run_dir(run_id), ignore_errors=True)
    return len(old_ids)


run_manager = RunManager()
