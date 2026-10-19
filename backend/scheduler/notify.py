"""Failure notifications: render a channel's templates for a run and send them to its HTTP endpoint.

Templates use {{placeholder}} for run details. The message template is rendered first and is
available to the URL and body as {{message}}. Values are URL-encoded in the URL and JSON-escaped
in JSON bodies, so templates can put them anywhere (e.g. "text": "{{message}}").
"""
import json
import re
import urllib.error
import urllib.request
from datetime import datetime
from typing import Dict, Optional, Tuple
from urllib.parse import quote, urlsplit

from sqlalchemy import select

from scheduler import config
from scheduler.crypto import decrypt_dict
from scheduler.db import Job, NotificationChannel, Run, session_scope, utcnow

PLACEHOLDER = re.compile(r"\{\{\s*([a-z_]+)\s*\}\}")
# What each placeholder holds, shown in the settings form
PLACEHOLDERS: Dict[str, str] = {
    "job_name": "Job name",
    "run_id": "Run number",
    "status": "Run status (failed)",
    "command": "dbt command (build, run, test, seed)",
    "select": "Selector, empty for the whole project",
    "target": "Target, empty for the profile default",
    "full_refresh": "Full refresh: true or false",
    "scheduled_for": "Time the run was scheduled for (UTC)",
    "run_at": "Time the run actually started (UTC)",
    "duration": "How long the run took",
    "author": "Who scheduled the run (the job's creator), or started it with Run now or a rerun",
    "trigger": "What started the run (schedule, catch-up, run now, rerun)",
    "commit": "Commit the run used (short SHA)",
    "error": "Error message (up to 1000 characters)",
    "run_url": "Link to the run in dbt UI (its address is set by DBT_UI__FRONTEND_URL)",
    "message": "The rendered message template (URL and body only)",
}
DEFAULT_MESSAGE_TEMPLATE = (
    'dbt job "{{job_name}}" {{status}} (run #{{run_id}})\n'
    "Scheduled for: {{scheduled_for}} UTC\n"
    "Ran at: {{run_at}} UTC\n"
    "Command: dbt {{command}} --select {{select}}\n"
    "Scheduled by: {{author}}\n"
    "{{run_url}}"
)
NOTIFY_STATUSES = ("failed",)
ERROR_CHARS = 1000
TIMEOUT_SECONDS = 10
TRIGGER_LABELS = {"schedule": "schedule", "catch_up": "catch-up", "run_now": "run now", "rerun": "rerun"}


def unknown_placeholders(template: str, allow_message: bool = True) -> list:
    names = set(PLACEHOLDER.findall(template))
    allowed = set(PLACEHOLDERS) - (set() if allow_message else {"message"})
    return sorted(names - allowed)


def render(template: str, values: Dict[str, str], escape=lambda v: v) -> str:
    return PLACEHOLDER.sub(lambda m: escape(values[m.group(1)]) if m.group(1) in values else m.group(0), template)


def url_preview(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}/…" if parts.path not in ("", "/") or parts.query else f"{parts.scheme}://{parts.netloc}"


def _time(value: Optional[datetime]) -> str:
    return value.strftime("%Y-%m-%d %H:%M:%S") if value else ""


def _duration(run: Run) -> str:
    if not run.started_at or not run.finished_at:
        return ""
    seconds = int((run.finished_at - run.started_at).total_seconds())
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours}h {minutes}m {seconds}s" if hours else f"{minutes}m {seconds}s" if minutes else f"{seconds}s"


def run_url(run_id: int) -> str:
    base_url = config.settings.ui_url
    return f"{base_url}/?scheduler_run={run_id}" if base_url else ""


def run_values(run: Run) -> Dict[str, str]:
    error = run.error or ""
    return {
        "job_name": run.job_name,
        "run_id": str(run.id),
        "status": run.status,
        "command": run.command,
        "select": run.selector,
        "target": run.target,
        "full_refresh": "true" if run.full_refresh else "false",
        "scheduled_for": _time(run.scheduled_for),
        "run_at": _time(run.started_at),
        "duration": _duration(run),
        "author": run.triggered_by,
        "trigger": TRIGGER_LABELS.get(run.trigger, run.trigger),
        "commit": run.commit_sha[:8],
        "error": error if len(error) <= ERROR_CHARS else error[:ERROR_CHARS] + "…",
        "run_url": run_url(run.id),
    }


def build_request(channel: NotificationChannel, values: Dict[str, str]) -> urllib.request.Request:
    secrets = decrypt_dict(channel.secrets_encrypted)
    values = {**values, "message": render(channel.message_template, values)}
    url = render(secrets.get("url", ""), values, lambda v: quote(v, safe=""))
    headers = {"User-Agent": "dbt-ui"}
    data = None
    if channel.method == "POST":
        if channel.body_format == "json":
            data = render(channel.body_template, values, lambda v: json.dumps(v)[1:-1])
            headers["Content-Type"] = "application/json"
        else:
            data = render(channel.body_template, values)
            headers["Content-Type"] = "text/plain; charset=utf-8"
    headers.update(json.loads(secrets.get("headers") or "{}"))
    return urllib.request.Request(
        url, data=data.encode() if data is not None else None, headers=headers, method=channel.method
    )


def send(channel: NotificationChannel, values: Dict[str, str]) -> str:
    """Send one notification. Returns an error message, or "" when the endpoint accepted it."""
    try:
        request = build_request(channel, values)
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS):
            return ""
    except urllib.error.HTTPError as e:
        detail = e.read(300).decode("utf-8", errors="replace").strip()
        return f"HTTP {e.code}" + (f": {detail}" if detail else "")
    except Exception as e:
        reason = getattr(e, "reason", None)
        return f"{type(e).__name__}: {reason or e}"


def channel_for(session, job: Optional[Job], project_key: str) -> Optional[NotificationChannel]:
    """The job's own channel, else the project's default one."""
    if job is not None and job.notification_channel_id is not None:
        channel = session.get(NotificationChannel, job.notification_channel_id)
        if channel is not None and channel.project_key == project_key:
            return channel
    return session.execute(
        select(NotificationChannel).where(
            NotificationChannel.project_key == project_key, NotificationChannel.is_default.is_(True)
        )
    ).scalars().first()


def notify_run_failure(run_id: int) -> Optional[Tuple[str, str]]:
    """Send the failure notification of a finished job run, once. Runs in a worker thread.

    Returns (channel name, error) when one was sent or attempted, None when there was nothing to send.
    """
    with session_scope() as session:
        run = session.get(Run, run_id)
        if run is None or run.job_id is None or run.status not in NOTIFY_STATUSES or run.notified_at:
            return None
        channel = channel_for(session, session.get(Job, run.job_id), run.project_key)
        if channel is None:
            return None
        values = run_values(run)
        # Claimed before sending, so it's sent at most once
        run.notified_at, run.notification_channel = utcnow(), channel.name
        session.expunge(channel)
    error = send(channel, values)
    with session_scope() as session:
        run = session.get(Run, run_id)
        if run is not None:
            run.notification_error = error
    return channel.name, error
