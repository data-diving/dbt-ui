"""Scheduler lifecycle: database setup on startup, readiness status, shutdown."""
import asyncio
from typing import Optional

from scheduler import config
from scheduler.crypto import init_crypto
from scheduler.db import get_engine, init_engine
from scheduler.migrate import upgrade_schema

RETRY_SECONDS = 15


class SchedulerService:
    def __init__(self):
        self.ready = False
        self.error = ""
        self._startup_task: Optional[asyncio.Task] = None
        self._cron_task: Optional[asyncio.Task] = None

    @property
    def enabled(self) -> bool:
        return config.settings.enabled

    def status(self) -> dict:
        return {
            "enabled": self.enabled,
            "ready": self.ready,
            "error": self.error,
            "max_concurrent": config.settings.max_concurrent,
            "timezone": "UTC",
        }

    async def start(self) -> None:
        """Called from the FastAPI lifespan. Setup retries in the background until it succeeds."""
        if not self.enabled:
            return
        self._startup_task = asyncio.create_task(self._startup_with_retry())

    async def _startup_with_retry(self) -> None:
        from scheduler.cron import cron_loop
        from scheduler.manager import mark_interrupted, run_manager

        while True:
            try:
                await asyncio.to_thread(self._setup_sync)
                interrupted = await asyncio.to_thread(
                    mark_interrupted, "Backend restarted while the run was in progress"
                )
                if interrupted:
                    print(f"[scheduler] Marked {interrupted} unfinished runs as interrupted")
                await asyncio.to_thread(_schedule_missing_next_runs)
                run_manager.start()
                self._cron_task = asyncio.create_task(cron_loop(run_manager))
                self.ready = True
                self.error = ""
                print("[scheduler] Ready")
                return
            except asyncio.CancelledError:
                raise
            except ValueError as e:
                # Configuration problem (e.g. bad encryption key): retrying won't help
                self.error = str(e)
                print(f"[scheduler] Not started: {e}")
                return
            except Exception as e:
                self.error = f"Scheduler database unavailable: {e}"
                print(f"[scheduler] {self.error}. Retrying in {RETRY_SECONDS}s")
                await asyncio.sleep(RETRY_SECONDS)

    def _setup_sync(self) -> None:
        settings = config.settings
        init_crypto(settings.encryption_key)
        settings.max_memory_bytes  # validates DBT_UI__SCHEDULER_MAX_MEMORY
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        settings.runs_dir.mkdir(parents=True, exist_ok=True)
        settings.checkouts_dir.mkdir(parents=True, exist_ok=True)
        engine = init_engine(settings.db_url)
        upgrade_schema(engine)
        print(f"[scheduler] Database schema is up to date ({engine.dialect.name})")

    async def stop(self) -> None:
        from scheduler.manager import run_manager

        for task in (self._startup_task, self._cron_task):
            if task and not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
        if self.ready:
            await run_manager.shutdown()
            get_engine().dispose()
        self.ready = False


def _schedule_missing_next_runs() -> None:
    """Jobs created while the scheduler was down, or with a cleared next_run_at, get one now."""
    from sqlalchemy import select

    from scheduler.cron import next_run_after
    from scheduler.db import Job, session_scope, utcnow

    with session_scope() as session:
        for job in session.execute(
            select(Job).where(Job.enabled.is_(True), Job.next_run_at.is_(None))
        ).scalars():
            job.next_run_at = next_run_after(job.cron, utcnow())


scheduler_service = SchedulerService()


def scheduler_is_ready() -> bool:
    return scheduler_service.enabled and scheduler_service.ready
