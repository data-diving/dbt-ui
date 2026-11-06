"""Clones real job runs into earlier cron slots, for a realistic day of run history.

Runs inside the demo backend container (seed.ts calls it), next to the SQLite database:
SQLite can't be shared safely between the host and a container. Input: the HISTORY env var,
JSON [{"run_id": 7, "user": "Dana Analyst", "slots": ["2026-11-05T10:15:00Z", ...],
"paused": [...slots recorded as skipped...], "stretch": 60}]. The demo project builds in seconds:
"stretch" makes a job's runs take that many times longer, like they would on a real warehouse.
"""
import json
import os
import random
import sqlite3
from datetime import datetime, timedelta, timezone

DB = "/home/dbtui/data/dbt-ui.db"
FORMAT = "%Y-%m-%d %H:%M:%S.%f"
random.seed(7)


def parse(value):
    return datetime.fromisoformat(value.replace("Z", "")) if value else None


def fmt(value):
    return value.strftime(FORMAT) if value else None


db = sqlite3.connect(DB, timeout=30)
db.row_factory = sqlite3.Row
run_cols = [r["name"] for r in db.execute("pragma table_info(scheduler_runs)") if r["name"] != "id"]
model_cols = [r["name"] for r in db.execute("pragma table_info(scheduler_run_models)") if r["name"] != "id"]


def insert(table, cols, row):
    db_cols = [c for c in cols if c in row]
    cur = db.execute(
        f"insert into {table} ({','.join(db_cols)}) values ({','.join('?' for _ in db_cols)})",
        [row[c] for c in db_cols],
    )
    return cur.lastrowid


def stretched_profile(profile, factor, jitter):
    """The memory profile over a run factor times longer: 30 points with some noise."""
    if not profile:
        return []
    length = max(s for s, _ in profile) * factor or 1
    points = []
    for i in range(30):
        second = length * i / 29
        nearest = min(profile, key=lambda p: abs(p[0] * factor - second))[1]
        points.append([round(second), int(nearest * jitter * (0.93 + random.random() * 0.14))])
    return points


def copy_models(models, run_id, shift=timedelta(0)):
    for model in models:
        copy = {**model, "run_id": run_id}
        for col in ("started_at", "finished_at"):
            if copy[col]:
                copy[col] = fmt(parse(copy[col]) + shift)
        insert("scheduler_run_models", model_cols, copy)


jobs = json.loads(os.environ["HISTORY"])
# Runs that really happened (manual runs, the jobs' first runs): kept as the newest
originals = [dict(r) for r in db.execute(
    "select * from scheduler_runs where status != 'scheduled' order by queued_at")]
templates = {}
entries = []  # (slot, job, paused), inserted oldest first so ids grow with time like real runs
for job in jobs:
    templates[job["run_id"]] = (
        dict(db.execute("select * from scheduler_runs where id = ?", (job["run_id"],)).fetchone()),
        [dict(r) for r in db.execute("select * from scheduler_run_models where run_id = ?", (job["run_id"],))],
    )
    entries += [(parse(s), job, False) for s in job["slots"]] + [(parse(s), job, True) for s in job["paused"]]

for slot, job, paused in sorted(entries, key=lambda e: e[0]):
    template, models = templates[job["run_id"]]
    row = {**template, "trigger": "schedule", "triggered_by": job["user"], "rerun_of_id": None,
           "scheduled_for": fmt(slot), "queued_at": fmt(slot),
           "notified_at": None, "notification_channel": "", "notification_error": ""}
    if paused:
        row.update(status="skipped", error="Skipped: the job was paused", exit_code=None, started_at=None,
                   finished_at=fmt(slot), peak_memory_bytes=None, avg_memory_bytes=None, memory_profile="",
                   rows_affected=None, models_success=0, models_error=0, models_skipped=0)
        insert("scheduler_runs", run_cols, row)
        continue
    started, finished = parse(template["started_at"]), parse(template["finished_at"])
    jitter = 0.85 + random.random() * 0.3
    start = slot + timedelta(seconds=1 + random.random() * 2)
    factor = job.get("stretch", 1) * jitter
    row.update(
        started_at=fmt(start), finished_at=fmt(start + (finished - started) * factor),
        peak_memory_bytes=template["peak_memory_bytes"] and int(template["peak_memory_bytes"] * jitter),
        avg_memory_bytes=template["avg_memory_bytes"] and int(template["avg_memory_bytes"] * jitter),
        memory_profile=json.dumps(stretched_profile(json.loads(template["memory_profile"] or "[]"), factor, jitter)),
    )
    copy_models(models, insert("scheduler_runs", run_cols, row), start - started)

# Move the real runs behind the clones, so they have the highest ids, and spread them over the
# last hour (they ran a few seconds apart, which would stack them into one spike on the memory chart)
now = datetime.now(timezone.utc).replace(tzinfo=None)
stretch = {job["job_name"]: job.get("stretch", 1) for job in jobs}
for i, run in enumerate(originals):
    models = [dict(r) for r in db.execute("select * from scheduler_run_models where run_id = ?", (run["id"],))]
    queued = parse(run["queued_at"])
    shift = now - timedelta(minutes=8 * (len(originals) - i)) - queued
    factor = stretch.get(run["job_name"], 1)
    started, finished = parse(run["started_at"]), parse(run["finished_at"])
    run = {**run, "queued_at": fmt(queued + shift),
           "scheduled_for": run["scheduled_for"] and fmt(parse(run["scheduled_for"]) + shift)}
    if started and finished:
        run.update(started_at=fmt(started + shift), finished_at=fmt(started + shift + (finished - started) * factor),
                   memory_profile=json.dumps(stretched_profile(json.loads(run["memory_profile"] or "[]"), factor, 1)))
    copy_models(models, insert("scheduler_runs", run_cols, run), shift)
    db.execute("delete from scheduler_run_models where run_id = ?", (run["id"],))
    db.execute("delete from scheduler_runs where id = ?", (run["id"],))

# Jobs look like they have existed for a while (catchup_since stays: it decides which slots are missed)
db.execute("update scheduler_jobs set created_at = ?", (fmt(datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=30)),))
db.commit()
print(f"History cloned into {DB}")
