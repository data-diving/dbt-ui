"""Cron evaluation (UTC only) and the loop that fires due jobs.

The database is the source of truth: each job stores next_run_at, and the loop
starts every enabled job whose next_run_at has passed (one run per due cron slot),
then advances it. For jobs that catch up every missed slot, the run history is also
scanned periodically for slots that never got a run, whenever the gap happened.
"""
import asyncio
from datetime import datetime, timedelta
from typing import List, Optional, Tuple

from croniter import CroniterBadCronError, croniter
from sqlalchemy import select

from scheduler import config
from scheduler.db import Job, Run, session_scope, utcnow
from scheduler.manager import RunRequest, skipped_slot_run, sync_scheduled_run

CLEANUP_INTERVAL = timedelta(hours=1)


def validate_cron(expression: str) -> None:
    """Raise ValueError for anything that isn't a standard 5-field cron expression."""
    expression = (expression or "").strip()
    if len(expression.split()) != 5:
        raise ValueError("Use a 5-field cron expression: minute hour day-of-month month day-of-week")
    try:
        croniter(expression)
    except (CroniterBadCronError, ValueError, KeyError) as e:
        raise ValueError(f"Invalid cron expression: {e}")


def next_run_after(expression: str, after: datetime) -> datetime:
    return croniter(expression, after).get_next(datetime)


def next_runs(expression: str, count: int = 5, after: Optional[datetime] = None) -> List[datetime]:
    itr = croniter(expression, after or utcnow())
    return [itr.get_next(datetime) for _ in range(count)]


def slots_between(expression: str, start: datetime, end: datetime) -> List[datetime]:
    """Cron slots from `start` (to the second, inclusive) up to `end` (inclusive)."""
    itr = croniter(expression, start.replace(microsecond=0) - timedelta(seconds=1))
    slots: List[datetime] = []
    slot = itr.get_next(datetime)
    while slot <= end:
        slots.append(slot)
        slot = itr.get_next(datetime)
    return slots


def _grace() -> timedelta:
    return timedelta(seconds=max(60, config.settings.tick_seconds * 2))


def _claim_due_jobs(now: datetime) -> List[Tuple[int, List[RunRequest]]]:
    """Advance next_run_at for due jobs and return, per job, the runs to start now.

    Every slot is accounted for. A slot is missed when it is more than a grace period old (dbt UI
    or its host was down or asleep): it is caught up with its own run (run_all), only the latest
    one is (run_once), or none is (skip); slots that are not run are recorded as skipped runs,
    as are all slots of paused jobs. For run_all, slots beyond the batch limit are left to the
    history scan. A slot that has the job's scheduled run starts that run; afterwards every
    enabled job gets a scheduled run for its new next slot.
    """
    settings = config.settings
    grace = _grace()
    claimed: List[Tuple[int, List[RunRequest]]] = []
    with session_scope() as session:
        # Jobs paused before slots were recorded for paused jobs have no pointer yet
        for job in session.execute(select(Job).where(Job.next_run_at.is_(None))).scalars():
            job.next_run_at = next_run_after(job.cron, now)

        due = session.execute(
            select(Job).where(Job.next_run_at.is_not(None), Job.next_run_at <= now)
        ).scalars().all()
        for job in due:
            slots = slots_between(job.cron, job.next_run_at, now)
            if not slots or slots[0] != job.next_run_at:
                slots.insert(0, job.next_run_at)  # the pointer is due even if it isn't on the cron schedule
            job.next_run_at = next_run_after(job.cron, now)
            scheduled = {r.scheduled_for: r for r in session.execute(
                select(Run).where(Run.job_id == job.id, Run.status == "scheduled")
            ).scalars()}

            def skip(slot: datetime, reason: str) -> None:
                row = scheduled.pop(slot, None)
                if row is None:
                    session.add(skipped_slot_run(job, slot, reason))
                else:
                    row.status, row.error, row.finished_at = "skipped", f"Skipped: {reason}", utcnow()

            def start(slot: datetime, trigger: str) -> RunRequest:
                row = scheduled.pop(slot, None)
                if row is not None:
                    row.status = "queued"  # claimed: no longer the job's scheduled run
                return RunRequest(scheduled_for=slot, trigger=trigger, run_id=row.id if row else None)

            if not job.enabled:
                for slot in slots:
                    skip(slot, "the job was paused")
                continue
            missed = [s for s in slots if now - s > grace]
            on_time = [s for s in slots if now - s <= grace]
            if job.misfire_policy == "run_all":
                catch_up = missed[:settings.max_catchup_runs]
                not_run = []
            else:
                catch_up = missed[-1:] if job.misfire_policy == "run_once" else []
                not_run = [s for s in missed if s not in catch_up]
            if not_run:
                print(f"[scheduler] Skipping {len(not_run)} missed run(s) of job {job.id} ({job.name}) since {not_run[0]}")
                for slot in not_run:
                    skip(slot, "missed while dbt UI was down")
            runs = [start(s, "catch_up") for s in catch_up] + [start(s, "schedule") for s in on_time]
            if runs:
                claimed.append((job.id, runs))

        session.flush()
        for job in session.execute(select(Job)).scalars():
            sync_scheduled_run(session, job)
    return claimed


def _find_missed_slots(now: datetime) -> List[Tuple[int, List[datetime]]]:
    """Slots of run_all jobs that have no run in the history, oldest first, up to the batch limit per job.

    A job's history is checked from its catchup_since (creation or last schedule change)
    up to its next_run_at, within the retention period. Runs of any status count, including
    failed and skipped ones (e.g. while paused, or skipped by the user).
    """
    settings = config.settings
    oldest = now - timedelta(days=settings.retention_days) + timedelta(hours=1)
    result: List[Tuple[int, List[datetime]]] = []
    with session_scope() as session:
        jobs = session.execute(
            select(Job).where(Job.enabled.is_(True), Job.misfire_policy == "run_all", Job.next_run_at.is_not(None))
        ).scalars().all()
        for job in jobs:
            start = max(job.catchup_since or job.created_at, oldest)
            end = min(job.next_run_at - timedelta(seconds=1), now - _grace())
            expected = slots_between(job.cron, start, end) if end >= start else []
            if not expected:
                continue
            covered = set(session.execute(
                select(Run.scheduled_for).where(
                    Run.job_id == job.id, Run.scheduled_for >= expected[0], Run.scheduled_for <= expected[-1]
                )
            ).scalars())
            missing = [s for s in expected if s not in covered][:settings.max_catchup_runs]
            if missing:
                result.append((job.id, missing))
    return result


async def cron_loop(run_manager) -> None:
    from scheduler.manager import cleanup_old_runs

    last_cleanup = datetime.min
    last_scan = datetime.min
    while True:
        try:
            now = utcnow()
            # Older gaps first, so a job's catch-up runs are queued in slot order
            if now - last_scan >= timedelta(seconds=config.settings.catchup_scan_seconds):
                for job_id, slots in await asyncio.to_thread(_find_missed_slots, now):
                    print(f"[scheduler] Catching up {len(slots)} missed slot(s) of job {job_id} from {slots[0]}")
                    owner = await asyncio.to_thread(_job_owner, job_id)
                    requests = [RunRequest(scheduled_for=slot, trigger="catch_up") for slot in slots]
                    await run_manager.trigger_job_runs(job_id, requests, owner)
                last_scan = now
            for job_id, requests in await asyncio.to_thread(_claim_due_jobs, now):
                owner = await asyncio.to_thread(_job_owner, job_id)
                await run_manager.trigger_job_runs(job_id, requests, owner)
            if now - last_cleanup > CLEANUP_INTERVAL:
                removed = await asyncio.to_thread(cleanup_old_runs)
                if removed:
                    print(f"[scheduler] Removed {removed} runs older than {config.settings.retention_days} days")
                last_cleanup = now
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[scheduler] Cron loop error: {e}")
        await asyncio.sleep(config.settings.tick_seconds)


def _job_owner(job_id: int) -> str:
    with session_scope() as session:
        job = session.get(Job, job_id)
        return job.created_by if job else ""
