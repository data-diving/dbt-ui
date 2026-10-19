"""Scheduler API routes: jobs, runs, logs, project credentials and notification channels.

All times are UTC. Credential values are write-only: the API only ever returns variable names,
and of notification endpoints only the URL's host and the header names.
"""
import asyncio
import json
import re
from datetime import timedelta
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import delete, desc, func, or_, select

from routes.env_routes import get_env_vars_from_cookie
from routes.git_routes import get_git_credentials_from_cookie
from scheduler import checkout, config, notify
from scheduler.cron import next_run_after, next_runs, validate_cron
from scheduler.crypto import decrypt_dict, encrypt_dict
from scheduler.db import (
    Job, NotificationChannel, ProjectCredentials, Run, session_scope, to_iso, utcnow,
)
from scheduler.manager import ACTIVE_STATUSES, SKIPPABLE_STATUSES, SKIPPED_BY_USER, RunRequest, run_manager, sync_scheduled_run
from scheduler.results import node_name
from scheduler.service import scheduler_service
from utils.input_validation import validate_dbt_selector, validate_dbt_target

router = APIRouter(prefix="/api/scheduler")

JOB_COMMANDS = {"run", "test", "seed", "build"}
OVERLAP_POLICIES = {"skip", "queue"}
MISFIRE_POLICIES = {"run_all", "run_once", "skip"}
CREDENTIAL_MODES = {"user", "project"}
MIN_TIMEOUT, MAX_TIMEOUT = 60, 7 * 24 * 3600
LOG_CHUNK_BYTES = 256 * 1024
MAX_RUNS_LISTED = 1000
ENV_VAR_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class PathRequest(BaseModel):
    path: str


class JobFields(BaseModel):
    name: str
    command: str = "build"
    selector: str = ""
    target: str = ""
    full_refresh: bool = False
    cron: str
    enabled: bool = True
    timeout_seconds: int = 3600
    overlap_policy: str = "skip"
    misfire_policy: str = "run_all"
    pull_latest: bool = True
    credentials_mode: str = "user"
    notification_channel_id: Optional[int] = None  # None: the project's default channel


class JobCreateRequest(JobFields):
    path: str


class JobUpdateRequest(JobFields):
    path: str
    refresh_credentials: bool = False  # re-capture the requester's env vars / git credentials
    repin: bool = False  # pin to the latest commit of the default branch


class CronPreviewRequest(BaseModel):
    cron: str


class RunsListRequest(BaseModel):
    path: str
    job_id: Optional[int] = None
    # Statuses to list; by default every status except skipped
    statuses: Optional[List[str]] = None
    include_memory_profile: bool = False  # for the memory chart
    since_hours: float = 24 * 7
    limit: int = 500


class RunsActionRequest(BaseModel):
    path: str
    run_ids: List[int]
    same_commit: bool = True  # reruns of job runs: the original commit, or the job's code source


class ProjectCredentialsSetRequest(BaseModel):
    path: str
    source: str = "my_env"  # my_env | values
    env_vars: Dict[str, str] = {}


class ChannelFields(BaseModel):
    name: str
    method: str = "POST"
    url: str = ""  # empty on update: keep the stored URL
    headers: Optional[Dict[str, str]] = None  # None on update: keep the stored headers
    body_format: str = "json"
    body_template: str = ""
    message_template: str = notify.DEFAULT_MESSAGE_TEMPLATE


class ChannelRequest(ChannelFields):
    path: str


# ---- helpers ----

def _require_ready() -> None:
    if not scheduler_service.enabled:
        raise HTTPException(status_code=503, detail="Scheduler is disabled. Set DBT_UI__SCHEDULER_ENABLED=true.")
    if not scheduler_service.ready:
        raise HTTPException(status_code=503, detail=scheduler_service.error or "Scheduler is starting")


def _project(path: str) -> checkout.ProjectInfo:
    project_path = Path(path).expanduser().resolve()
    if not project_path.exists():
        raise HTTPException(status_code=404, detail="Project path does not exist")
    try:
        return checkout.resolve_project(project_path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


def _validate_job_fields(fields: JobFields) -> JobFields:
    fields.name = fields.name.strip()
    if not fields.name or len(fields.name) > 200:
        raise HTTPException(status_code=400, detail="Job name is required (max 200 characters)")
    if fields.command not in JOB_COMMANDS:
        raise HTTPException(status_code=400, detail=f"Command must be one of: {', '.join(sorted(JOB_COMMANDS))}")
    fields.selector = validate_dbt_selector(fields.selector, "selector")
    fields.target = validate_dbt_target(fields.target)
    fields.cron = " ".join(fields.cron.split())
    try:
        validate_cron(fields.cron)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not MIN_TIMEOUT <= fields.timeout_seconds <= MAX_TIMEOUT:
        raise HTTPException(status_code=400, detail=f"Timeout must be between {MIN_TIMEOUT}s and {MAX_TIMEOUT}s")
    if fields.overlap_policy not in OVERLAP_POLICIES:
        raise HTTPException(status_code=400, detail="Invalid overlap policy")
    if fields.misfire_policy not in MISFIRE_POLICIES:
        raise HTTPException(status_code=400, detail="Invalid missed-run policy")
    if fields.credentials_mode not in CREDENTIAL_MODES:
        raise HTTPException(status_code=400, detail="Invalid credentials mode")
    return fields


def _latest_commit(project: checkout.ProjectInfo, git_creds: Dict[str, str]) -> Dict[str, str]:
    """Fetch (best effort) and describe the newest commit of the default branch."""
    repo = Path(project.repo_path)
    if not project.default_branch:
        raise HTTPException(status_code=400, detail="Could not determine the repository's default branch")
    fetch_error = ""
    try:
        checkout.fetch_default_branch(repo, project.default_branch, git_creds)
    except RuntimeError as e:
        fetch_error = str(e)
    try:
        sha = checkout.resolve_branch_sha(repo, project.default_branch)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    commit = checkout.describe_commit(repo, sha)
    commit["fetch_error"] = fetch_error
    return commit


def _user_git_creds(request: Request, project: checkout.ProjectInfo) -> Dict[str, str]:
    creds = get_git_credentials_from_cookie(request, project.repo_path)
    return creds if creds.get("username") and creds.get("password") else {}


def _names(token: str) -> List[str]:
    try:
        return sorted(decrypt_dict(token).keys())
    except ValueError:
        return []


def _serialize_run(run: Run, include_models: bool = False, include_memory_profile: bool = False) -> dict:
    data = {
        "id": run.id,
        "job_id": run.job_id,
        "job_name": run.job_name,
        "trigger": run.trigger,
        "triggered_by": run.triggered_by,
        "command": run.command,
        "selector": run.selector,
        "target": run.target,
        "full_refresh": run.full_refresh,
        "commit_sha": run.commit_sha,
        "scheduled_for": to_iso(run.scheduled_for),
        "rerun_of_id": run.rerun_of_id,
        "dbt_vars": json.loads(run.dbt_vars) if run.dbt_vars else None,
        "status": run.status,
        "error": run.error,
        "exit_code": run.exit_code,
        "queued_at": to_iso(run.queued_at),
        "started_at": to_iso(run.started_at),
        "finished_at": to_iso(run.finished_at),
        "duration_seconds": (
            (run.finished_at - run.started_at).total_seconds() if run.started_at and run.finished_at else None
        ),
        "peak_memory_bytes": run.peak_memory_bytes,
        "avg_memory_bytes": run.avg_memory_bytes,
        "rows_affected": run.rows_affected,
        "models_success": run.models_success,
        "models_error": run.models_error,
        "models_skipped": run.models_skipped,
        "notified_at": to_iso(run.notified_at),
        "notification_channel": run.notification_channel,
        "notification_error": run.notification_error,
    }
    if include_memory_profile:
        live = run_manager.live_memory_profile(run.id) if run.status == "running" else None
        data["memory_profile"] = live if live is not None else (
            json.loads(run.memory_profile) if run.memory_profile else []
        )
    if include_models:
        data["models"] = [
            {
                "unique_id": m.unique_id,
                "name": node_name(m.unique_id),
                "resource_type": m.resource_type,
                "status": m.status,
                "thread_id": m.thread_id,
                "started_at": to_iso(m.started_at),
                "finished_at": to_iso(m.finished_at),
                "execution_time": m.execution_time,
                "rows_affected": m.rows_affected,
                "message": m.message,
                "adapter_response": json.loads(m.adapter_response) if m.adapter_response else {},
            }
            for m in run.models
        ]
    return data


def _serialize_job(job: Job, last_run: Optional[Run]) -> dict:
    return {
        "id": job.id,
        "name": job.name,
        "command": job.command,
        "selector": job.selector,
        "target": job.target,
        "full_refresh": job.full_refresh,
        "cron": job.cron,
        "enabled": job.enabled,
        "timeout_seconds": job.timeout_seconds,
        "overlap_policy": job.overlap_policy,
        "misfire_policy": job.misfire_policy,
        "next_run_at": to_iso(job.next_run_at) if job.enabled else None,
        "pull_latest": job.pull_latest,
        "pinned_sha": job.pinned_sha,
        "credentials_mode": job.credentials_mode,
        "notification_channel_id": job.notification_channel_id,
        "env_var_names": _names(job.env_encrypted),
        "has_git_credentials": bool(job.git_creds_encrypted),
        "checkout_state": job.checkout_state,
        "checkout_error": job.checkout_error,
        "created_by": job.created_by,
        "created_at": to_iso(job.created_at),
        "updated_at": to_iso(job.updated_at),
        "busy": run_manager.is_job_busy(job.id),
        "last_run": _serialize_run(last_run) if last_run else None,
    }


def _get_job_for_project(session, job_id: int, project: checkout.ProjectInfo) -> Job:
    job = session.get(Job, job_id)
    if job is None or job.project_key != project.project_key:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def _check_channel(session, channel_id: Optional[int], project: checkout.ProjectInfo) -> None:
    if channel_id is None:
        return
    channel = session.get(NotificationChannel, channel_id)
    if channel is None or channel.project_key != project.project_key:
        raise HTTPException(status_code=400, detail="Notification channel not found")


def _prepare_in_background(job_id: int) -> None:
    run_manager.loop.call_soon_threadsafe(run_manager.prepare_job_in_background, job_id)


# ---- status & context ----

@router.get("/status")
def get_status():
    return scheduler_service.status()


@router.post("/context")
def get_context(body: PathRequest, request: Request):
    """Everything the job form needs: project identity, default branch, available credentials."""
    _require_ready()
    project = _project(body.path)
    repo = Path(project.repo_path)
    latest = None
    if project.default_branch:
        try:
            sha = checkout.resolve_branch_sha(repo, project.default_branch)
            latest = checkout.describe_commit(repo, sha)
        except RuntimeError:
            latest = None
    with session_scope() as session:
        creds = session.get(ProjectCredentials, project.project_key)
        project_creds = {
            "env_var_names": _names(creds.env_encrypted) if creds else [],
            "updated_by": creds.updated_by if creds else "",
            "updated_at": to_iso(creds.updated_at) if creds else None,
        }
    return {
        "project_key": project.project_key,
        "repo_path": project.repo_path,
        "subdirectory": project.subdirectory,
        "default_branch": project.default_branch,
        "latest_commit": latest,
        "user_name": project.git_user_name,
        "my_env_var_names": sorted(get_env_vars_from_cookie(request, body.path).keys()),
        "has_my_git_credentials": bool(_user_git_creds(request, project)),
        "project_credentials": project_creds,
    }


@router.post("/cron-preview")
def cron_preview(body: CronPreviewRequest):
    expression = " ".join(body.cron.split())
    try:
        validate_cron(expression)
    except ValueError as e:
        return {"valid": False, "error": str(e), "next_runs": []}
    return {"valid": True, "error": "", "next_runs": [to_iso(t) for t in next_runs(expression, 5)]}


# ---- jobs ----

@router.post("/jobs/list")
def list_jobs(body: PathRequest):
    _require_ready()
    project = _project(body.path)
    with session_scope() as session:
        jobs = session.execute(
            select(Job).where(Job.project_key == project.project_key).order_by(Job.name)
        ).scalars().all()
        latest_ids = dict(session.execute(
            select(Run.job_id, func.max(Run.id))
            .where(Run.job_id.in_([j.id for j in jobs]),
                   Run.status.notin_(["skipped", "scheduled"]))
            .group_by(Run.job_id)
        ).all()) if jobs else {}
        last_runs = {
            r.job_id: r for r in session.execute(select(Run).where(Run.id.in_(list(latest_ids.values())))).scalars()
        } if latest_ids else {}
        return {"jobs": [_serialize_job(j, last_runs.get(j.id)) for j in jobs]}


@router.post("/jobs")
def create_job(body: JobCreateRequest, request: Request):
    _require_ready()
    _validate_job_fields(body)
    project = _project(body.path)
    if not project.default_branch:
        raise HTTPException(status_code=400, detail="Could not determine the repository's default branch")

    git_creds = _user_git_creds(request, project)
    env_vars = get_env_vars_from_cookie(request, body.path) if body.credentials_mode == "user" else {}
    pinned_sha = "" if body.pull_latest else _latest_commit(project, git_creds)["sha"]

    with session_scope() as session:
        if body.credentials_mode == "project":
            creds = session.get(ProjectCredentials, project.project_key)
            if creds is None or not creds.env_encrypted:
                raise HTTPException(status_code=400, detail="Project credentials are not set for this project")
        _check_channel(session, body.notification_channel_id, project)
        job = Job(
            name=body.name, project_key=project.project_key, repo_path=project.repo_path,
            subdirectory=project.subdirectory, command=body.command, selector=body.selector,
            target=body.target, full_refresh=body.full_refresh, cron=body.cron, enabled=body.enabled,
            timeout_seconds=body.timeout_seconds, overlap_policy=body.overlap_policy,
            misfire_policy=body.misfire_policy, pull_latest=body.pull_latest, pinned_sha=pinned_sha,
            credentials_mode=body.credentials_mode, notification_channel_id=body.notification_channel_id,
            env_encrypted=encrypt_dict(env_vars),
            git_creds_encrypted=encrypt_dict(git_creds) if body.pull_latest else "",
            # Paused jobs keep their pointer, so their slots are recorded as skipped runs
            next_run_at=next_run_after(body.cron, utcnow()), catchup_since=utcnow(),
            created_by=project.git_user_name,
        )
        session.add(job)
        session.flush()
        sync_scheduled_run(session, job)
        job_id = job.id
        result = _serialize_job(job, None)
    _prepare_in_background(job_id)
    return result


@router.put("/jobs/{job_id}")
def update_job(job_id: int, body: JobUpdateRequest, request: Request):
    _require_ready()
    _validate_job_fields(body)
    project = _project(body.path)
    git_creds = _user_git_creds(request, project)

    with session_scope() as session:
        job = _get_job_for_project(session, job_id, project)
        cron_changed = job.cron != body.cron
        switched_to_user = body.credentials_mode == "user" and job.credentials_mode != "user"

        if body.credentials_mode == "project":
            creds = session.get(ProjectCredentials, project.project_key)
            if creds is None or not creds.env_encrypted:
                raise HTTPException(status_code=400, detail="Project credentials are not set for this project")
        _check_channel(session, body.notification_channel_id, project)
        if body.credentials_mode == "user" and (body.refresh_credentials or switched_to_user):
            job.env_encrypted = encrypt_dict(get_env_vars_from_cookie(request, body.path))
        if body.pull_latest and (body.refresh_credentials or not job.git_creds_encrypted) and git_creds:
            job.git_creds_encrypted = encrypt_dict(git_creds)

        if not body.pull_latest and (body.repin or not job.pinned_sha):
            job.pinned_sha = _latest_commit(project, git_creds)["sha"]

        for field in ("name", "command", "selector", "target", "full_refresh", "cron", "enabled",
                      "timeout_seconds", "overlap_policy", "misfire_policy", "pull_latest", "credentials_mode",
                      "notification_channel_id"):
            setattr(job, field, getattr(body, field))
        # Pausing and resuming keep the pointer; a new schedule starts from now, and so does
        # the search for missed slots (slots of the old schedule are never caught up)
        if cron_changed or job.next_run_at is None:
            job.next_run_at = next_run_after(job.cron, utcnow())
        if cron_changed:
            job.catchup_since = utcnow()
        sync_scheduled_run(session, job)
        needs_prepare = job.checkout_state != "ready"
        session.flush()
        result = _serialize_job(job, None)
    if needs_prepare:
        _prepare_in_background(job_id)
    return result


@router.post("/jobs/{job_id}/delete")
def delete_job(job_id: int, body: PathRequest):
    _require_ready()
    project = _project(body.path)
    if run_manager.is_job_busy(job_id):
        raise HTTPException(status_code=409, detail="The job is running. Cancel the run first.")
    with session_scope() as session:
        job = _get_job_for_project(session, job_id, project)
        repo = Path(job.repo_path)
        # Its scheduled run never ran; the rest of its history is kept
        session.execute(delete(Run).where(Run.job_id == job_id, Run.status == "scheduled"))
        session.delete(job)
    checkout.remove_checkout(job_id, repo)
    return {"success": True}


@router.post("/jobs/{job_id}/trigger")
async def trigger_job(job_id: int, body: PathRequest):
    _require_ready()
    project = await asyncio.to_thread(_project, body.path)
    with session_scope() as session:
        _get_job_for_project(session, job_id, project)
    run_id = await run_manager.trigger_job(job_id, "run_now", project.git_user_name)
    return {"run_id": run_id}


@router.post("/jobs/{job_id}/commit")
def describe_job_commit(job_id: int, body: PathRequest):
    """Subject/author of the commit a pinned job runs."""
    _require_ready()
    project = _project(body.path)
    with session_scope() as session:
        job = _get_job_for_project(session, job_id, project)
        sha = job.pinned_sha
    return checkout.describe_commit(Path(project.repo_path), sha) if sha else {}


# ---- runs ----

@router.post("/runs/list")
def list_runs(body: RunsListRequest):
    _require_ready()
    project = _project(body.path)
    since = utcnow() - timedelta(hours=max(0.25, body.since_hours))
    limit = max(1, min(body.limit, MAX_RUNS_LISTED))
    with session_scope() as session:
        # Runs that overlap the window: queued in it, finished in it, or still active
        query = select(Run).where(
            Run.project_key == project.project_key,
            or_(Run.queued_at >= since, Run.finished_at >= since, Run.finished_at.is_(None)),
        )
        if body.job_id is not None:
            query = query.where(Run.job_id == body.job_id)
        if body.statuses is None:
            query = query.where(Run.status != "skipped")
        else:
            query = query.where(Run.status.in_(body.statuses))
        runs = session.execute(query.order_by(desc(Run.queued_at)).limit(limit)).scalars().all()
        return {
            "runs": [_serialize_run(r, include_memory_profile=body.include_memory_profile) for r in runs],
            "now": to_iso(utcnow()),
        }


@router.get("/runs/{run_id}")
def get_run(run_id: int):
    _require_ready()
    with session_scope() as session:
        run = session.get(Run, run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="Run not found")
        return _serialize_run(run, include_models=True)


@router.get("/runs/{run_id}/logs")
def get_run_logs(run_id: int, offset: int = 0):
    _require_ready()
    with session_scope() as session:
        run = session.get(Run, run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="Run not found")
        # Scheduled and skipped runs never started, so they have no log
        log_path, done = Path(run.log_path) if run.log_path else None, run.status not in ACTIVE_STATUSES
    if log_path is None or not log_path.is_file():
        return {"content": "", "offset": 0, "done": done}
    with open(log_path, "rb") as f:
        f.seek(max(0, offset))
        data = f.read(LOG_CHUNK_BYTES)
    new_offset = max(0, offset) + len(data)
    # More content may remain even when the run is done; the client keeps reading until it catches up
    caught_up = new_offset >= log_path.stat().st_size
    return {"content": data.decode("utf-8", errors="replace"), "offset": new_offset, "done": done and caught_up}


def _project_runs(session, project: checkout.ProjectInfo, run_ids: List[int]) -> List[Run]:
    runs = session.execute(
        select(Run).where(Run.id.in_(run_ids), Run.project_key == project.project_key)
    ).scalars().all()
    if len(runs) != len(set(run_ids)):
        raise HTTPException(status_code=404, detail="Run not found")
    return runs


@router.post("/runs/rerun")
async def rerun_runs(body: RunsActionRequest):
    """Run job runs again with the parameters they were started with, oldest slot first.

    Reruns use the job's checkout and current credentials, and either the original commit
    (same_commit) or the job's code source. Manual runs from the editor can't be rerun.
    """
    _require_ready()
    if not body.run_ids:
        raise HTTPException(status_code=400, detail="No runs selected")
    project = await asyncio.to_thread(_project, body.path)
    with session_scope() as session:
        runs = _project_runs(session, project, body.run_ids)
        job_ids = {r.job_id for r in runs if r.job_id is not None}
        existing = set(session.execute(select(Job.id).where(Job.id.in_(list(job_ids)))).scalars()) if job_ids else set()
        invalid = [r.id for r in runs if r.job_id not in existing or r.status == "scheduled"]
        if invalid:
            raise HTTPException(
                status_code=400,
                detail="Only runs of existing jobs can be rerun (not manual or scheduled runs): "
                       f"#{', #'.join(map(str, sorted(invalid)))}",
            )
        runs.sort(key=lambda r: (r.scheduled_for or r.queued_at, r.id))
        job_requests: Dict[int, List[RunRequest]] = {}
        for r in runs:
            job_requests.setdefault(r.job_id, []).append(RunRequest(
                scheduled_for=r.scheduled_for or r.queued_at.replace(microsecond=0), trigger="rerun",
                rerun_of_id=r.id, command=r.command, selector=r.selector, target=r.target,
                full_refresh=r.full_refresh, dbt_vars=json.loads(r.dbt_vars) if r.dbt_vars else None,
                commit_sha=r.commit_sha if body.same_commit else "",
            ))

    new_ids: List[int] = []
    for job_id, requests in job_requests.items():
        new_ids += await run_manager.trigger_job_runs(job_id, requests, project.git_user_name)
    return {"run_ids": new_ids}


def _cancel_scheduled_run(session, run: Run, now) -> None:
    run.status, run.error, run.finished_at = "skipped", SKIPPED_BY_USER, now
    job = session.get(Job, run.job_id) if run.job_id else None
    if job is not None and job.next_run_at == run.scheduled_for:
        job.next_run_at = next_run_after(job.cron, run.scheduled_for)
        session.flush()
        sync_scheduled_run(session, job)


@router.post("/runs/skip")
async def skip_runs(body: RunsActionRequest):
    """Skip runs that haven't finished ("Skip this run"): they are recorded as skipped, so their slot isn't caught up.

    - A job's scheduled run is cancelled, and the job's following slot becomes its scheduled run.
    - Queued and running runs are stopped at once (a running dbt process is killed, so the next
      queued run can start).
    """
    _require_ready()
    project = await asyncio.to_thread(_project, body.path)
    scheduled, active = await asyncio.to_thread(_skip_runs, project, body.run_ids)
    for run_id in active:
        await run_manager.skip(run_id)
    return {"skipped": scheduled + active}


def _skip_runs(project: checkout.ProjectInfo, run_ids: List[int]):
    now = utcnow()
    with session_scope() as session:
        runs = _project_runs(session, project, run_ids)
        if any(r.status not in SKIPPABLE_STATUSES for r in runs):
            raise HTTPException(status_code=400, detail="Only scheduled, queued and running runs can be skipped")
        for r in runs:
            if r.status == "scheduled":
                _cancel_scheduled_run(session, r, now)
        return [r.id for r in runs if r.status == "skipped"], [r.id for r in runs if r.status in ACTIVE_STATUSES]


@router.post("/runs/{run_id}/cancel")
async def cancel_run(run_id: int):
    _require_ready()
    if not await run_manager.cancel(run_id):
        raise HTTPException(status_code=409, detail="Run is not active")
    return {"success": True}


# ---- project credentials ----

@router.post("/project-credentials/set")
def set_project_credentials(body: ProjectCredentialsSetRequest, request: Request):
    _require_ready()
    project = _project(body.path)
    if body.source == "my_env":
        env_vars = get_env_vars_from_cookie(request, body.path)
    elif body.source == "values":
        env_vars = {k.strip(): v for k, v in body.env_vars.items() if k.strip()}
    else:
        raise HTTPException(status_code=400, detail="source must be 'my_env' or 'values'")
    if not env_vars:
        raise HTTPException(status_code=400, detail="No environment variables to save")
    for name in env_vars:
        if not ENV_VAR_NAME.match(name):
            raise HTTPException(status_code=400, detail=f"Invalid variable name: {name}")
    with session_scope() as session:
        creds = session.get(ProjectCredentials, project.project_key)
        if creds is None:
            creds = ProjectCredentials(project_key=project.project_key)
            session.add(creds)
        creds.env_encrypted = encrypt_dict(env_vars)
        creds.updated_by = project.git_user_name
        creds.updated_at = utcnow()
    return {"env_var_names": sorted(env_vars.keys()), "updated_by": project.git_user_name}


@router.post("/project-credentials/delete")
def delete_project_credentials(body: PathRequest):
    _require_ready()
    project = _project(body.path)
    with session_scope() as session:
        in_use = session.execute(
            select(func.count()).select_from(Job)
            .where(Job.project_key == project.project_key, Job.credentials_mode == "project")
        ).scalar_one()
        if in_use:
            raise HTTPException(status_code=409, detail=f"{in_use} job(s) use project credentials")
        creds = session.get(ProjectCredentials, project.project_key)
        if creds is not None:
            session.delete(creds)
    return {"success": True}


# ---- notifications ----

def _serialize_channel(channel: NotificationChannel) -> dict:
    try:
        header_names = sorted(json.loads(decrypt_dict(channel.secrets_encrypted).get("headers") or "{}"))
    except ValueError:
        header_names = []
    return {
        "id": channel.id,
        "name": channel.name,
        "is_default": channel.is_default,
        "method": channel.method,
        "url_preview": channel.url_preview,
        "header_names": header_names,
        "body_format": channel.body_format,
        "body_template": channel.body_template,
        "message_template": channel.message_template,
        "created_by": channel.created_by,
        "updated_at": to_iso(channel.updated_at),
    }


def _project_channel(session, channel_id: int, project: checkout.ProjectInfo) -> NotificationChannel:
    channel = session.get(NotificationChannel, channel_id)
    if channel is None or channel.project_key != project.project_key:
        raise HTTPException(status_code=404, detail="Notification channel not found")
    return channel


def _validate_channel(body: ChannelFields, require_url: bool) -> None:
    body.name = body.name.strip()
    if not body.name or len(body.name) > 200:
        raise HTTPException(status_code=400, detail="Channel name is required (max 200 characters)")
    if body.method not in ("GET", "POST"):
        raise HTTPException(status_code=400, detail="Method must be GET or POST")
    if body.body_format not in ("json", "text"):
        raise HTTPException(status_code=400, detail="Body format must be json or text")
    body.url = body.url.strip()
    if require_url and not body.url:
        raise HTTPException(status_code=400, detail="URL is required")
    if body.url and not re.match(r"^https?://[^/\s]+", body.url):
        raise HTTPException(status_code=400, detail="URL must start with http:// or https://")
    if body.headers:
        for name in body.headers:
            if not re.match(r"^[A-Za-z0-9-]+$", name):
                raise HTTPException(status_code=400, detail=f"Invalid header name: {name}")
    templates = [("message template", body.message_template, False), ("URL", body.url, True)]
    if body.method == "POST":
        templates.append(("body", body.body_template, True))
    for label, template, allow_message in templates:
        unknown = notify.unknown_placeholders(template, allow_message)
        if unknown:
            raise HTTPException(
                status_code=400, detail=f"Unknown placeholder(s) in the {label}: {', '.join(unknown)}"
            )


def _store_secrets(channel: NotificationChannel, body: ChannelFields) -> None:
    secrets = decrypt_dict(channel.secrets_encrypted) if channel.secrets_encrypted else {}
    if body.url:
        secrets["url"] = body.url
        channel.url_preview = notify.url_preview(body.url)
    if body.headers is not None:
        secrets["headers"] = json.dumps({k: v for k, v in body.headers.items() if k})
    channel.secrets_encrypted = encrypt_dict(secrets)


@router.post("/notifications/list")
def list_notification_channels(body: PathRequest):
    _require_ready()
    project = _project(body.path)
    with session_scope() as session:
        channels = session.execute(
            select(NotificationChannel).where(NotificationChannel.project_key == project.project_key)
            .order_by(NotificationChannel.created_at, NotificationChannel.id)
        ).scalars().all()
        return {
            "channels": [_serialize_channel(c) for c in channels],
            "ui_url": config.settings.ui_url,
            "placeholders": notify.PLACEHOLDERS,
            "default_message_template": notify.DEFAULT_MESSAGE_TEMPLATE,
        }


@router.post("/notifications")
def create_notification_channel(body: ChannelRequest):
    _require_ready()
    _validate_channel(body, require_url=True)
    project = _project(body.path)
    with session_scope() as session:
        has_default = session.execute(
            select(func.count()).select_from(NotificationChannel).where(
                NotificationChannel.project_key == project.project_key, NotificationChannel.is_default.is_(True)
            )
        ).scalar_one()
        # The first channel becomes the default
        channel = NotificationChannel(
            project_key=project.project_key, name=body.name, is_default=not has_default, method=body.method,
            body_format=body.body_format, body_template=body.body_template,
            message_template=body.message_template, created_by=project.git_user_name,
        )
        _store_secrets(channel, body)
        session.add(channel)
        session.flush()
        return _serialize_channel(channel)


@router.put("/notifications/{channel_id}")
def update_notification_channel(channel_id: int, body: ChannelRequest):
    _require_ready()
    _validate_channel(body, require_url=False)
    project = _project(body.path)
    with session_scope() as session:
        channel = _project_channel(session, channel_id, project)
        for field in ("name", "method", "body_format", "body_template", "message_template"):
            setattr(channel, field, getattr(body, field))
        _store_secrets(channel, body)
        session.flush()
        return _serialize_channel(channel)


@router.post("/notifications/{channel_id}/default")
def set_default_notification_channel(channel_id: int, body: PathRequest):
    _require_ready()
    project = _project(body.path)
    with session_scope() as session:
        chosen = _project_channel(session, channel_id, project)
        for channel in session.execute(
            select(NotificationChannel).where(NotificationChannel.project_key == project.project_key)
        ).scalars():
            channel.is_default = channel.id == chosen.id
    return {"success": True}


@router.post("/notifications/{channel_id}/delete")
def delete_notification_channel(channel_id: int, body: PathRequest):
    """Delete a channel. Jobs that used it go back to the default; if it was the default, the oldest remaining one is."""
    _require_ready()
    project = _project(body.path)
    with session_scope() as session:
        channel = _project_channel(session, channel_id, project)
        for job in session.execute(select(Job).where(Job.notification_channel_id == channel_id)).scalars():
            job.notification_channel_id = None
        was_default = channel.is_default
        session.delete(channel)
        session.flush()
        if was_default:
            successor = session.execute(
                select(NotificationChannel).where(NotificationChannel.project_key == project.project_key)
                .order_by(NotificationChannel.created_at, NotificationChannel.id)
            ).scalars().first()
            if successor is not None:
                successor.is_default = True
    return {"success": True}


@router.post("/notifications/{channel_id}/test")
def test_notification_channel(channel_id: int, body: PathRequest):
    """Send a notification about the project's latest failed job run, or made-up values if there is none."""
    _require_ready()
    project = _project(body.path)
    with session_scope() as session:
        channel = _project_channel(session, channel_id, project)
        run = session.execute(
            select(Run).where(Run.project_key == project.project_key, Run.job_id.is_not(None), Run.status == "failed")
            .order_by(desc(Run.id)).limit(1)
        ).scalars().first()
        if run is not None:
            values = notify.run_values(run)
        else:
            now = utcnow().strftime("%Y-%m-%d %H:%M:%S")
            values = {
                "job_name": "example job", "run_id": "0", "status": "failed", "command": "build",
                "select": "tag:daily", "target": "", "full_refresh": "false", "scheduled_for": now, "run_at": now,
                "duration": "1m 5s", "author": project.git_user_name, "trigger": "schedule", "commit": "0000000",
                "error": "Test notification from dbt UI", "run_url": notify.run_url(0),
            }
        session.expunge(channel)
    error = notify.send(channel, values)
    if error:
        raise HTTPException(status_code=502, detail=f"The endpoint did not accept it: {error}")
    return {"success": True, "run_id": run.id if run is not None else None}

