"""Database engine, session factory and ORM models for the scheduler.

All timestamps are naive datetimes in UTC.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, Optional

from sqlalchemy import (
    BigInteger, Boolean, DateTime, Float, ForeignKey, Integer, String, Text,
    create_engine, event,
)
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

# Tables are prefixed so the scheduler can share a Postgres database with other apps
TABLE_PREFIX = "scheduler_"
VERSION_TABLE = "scheduler_alembic_version"


def utcnow() -> datetime:
    """Current UTC time as a naive datetime (the format stored in the DB)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def to_iso(value: Optional[datetime]) -> Optional[str]:
    """Serialize a stored UTC datetime for the API."""
    return value.isoformat() + "Z" if value else None


class Base(DeclarativeBase):
    pass


class Job(Base):
    __tablename__ = f"{TABLE_PREFIX}jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    # Project identity: main repository path + subdirectory of the dbt project in it
    project_key: Mapped[str] = mapped_column(String(1024), index=True)
    repo_path: Mapped[str] = mapped_column(String(1024))
    subdirectory: Mapped[str] = mapped_column(String(1024), default="")

    command: Mapped[str] = mapped_column(String(20))
    selector: Mapped[str] = mapped_column(String(1000), default="")
    target: Mapped[str] = mapped_column(String(200), default="")
    full_refresh: Mapped[bool] = mapped_column(Boolean, default=False)

    cron: Mapped[str] = mapped_column(String(100))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=3600)
    overlap_policy: Mapped[str] = mapped_column(String(20), default="skip")  # skip | queue
    # Slots missed while dbt UI (or its host) was down: run_all | run_once | skip
    misfire_policy: Mapped[str] = mapped_column(String(20), default="run_all")
    next_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, index=True)
    # Missed slots are looked for in the run history from here on: creation or last schedule change
    catchup_since: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Code source: always the repository's default branch
    pull_latest: Mapped[bool] = mapped_column(Boolean, default=True)
    pinned_sha: Mapped[str] = mapped_column(String(64), default="")

    # Credentials: 'user' (snapshot of creator's env vars) or 'project' (project defaults)
    credentials_mode: Mapped[str] = mapped_column(String(20), default="user")
    env_encrypted: Mapped[str] = mapped_column(Text, default="")
    git_creds_encrypted: Mapped[str] = mapped_column(Text, default="")

    # Dedicated checkout state
    checkout_state: Mapped[str] = mapped_column(String(20), default="pending")  # pending|preparing|ready|error
    checkout_error: Mapped[str] = mapped_column(Text, default="")
    venv_fingerprint: Mapped[str] = mapped_column(String(64), default="")
    deps_fingerprint: Mapped[str] = mapped_column(String(64), default="")

    # Where failure notifications go: this channel, or the project's default one when None
    notification_channel_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    created_by: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class Run(Base):
    __tablename__ = f"{TABLE_PREFIX}runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey(f"{TABLE_PREFIX}jobs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    job_name: Mapped[str] = mapped_column(String(200), default="")
    project_key: Mapped[str] = mapped_column(String(1024), index=True)
    project_path: Mapped[str] = mapped_column(String(1024))

    trigger: Mapped[str] = mapped_column(String(20))  # manual | schedule | catch_up | run_now | rerun
    triggered_by: Mapped[str] = mapped_column(String(200), default="")

    command: Mapped[str] = mapped_column(String(20))
    selector: Mapped[str] = mapped_column(String(1000), default="")
    target: Mapped[str] = mapped_column(String(200), default="")
    full_refresh: Mapped[bool] = mapped_column(Boolean, default=False)
    commit_sha: Mapped[str] = mapped_column(String(64), default="")
    # Cron slot the run is for (trigger time for run_now; empty for manual runs from the editor)
    scheduled_for: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, index=True)
    rerun_of_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # JSON of the --vars passed to dbt (job runs only), so reruns can repeat them exactly
    dbt_vars: Mapped[str] = mapped_column(Text, default="")

    # scheduled (a job's next slot, not started yet) | queued | running | success | failed | cancelled
    # | interrupted | skipped
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    error: Mapped[str] = mapped_column(Text, default="")
    exit_code: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    queued_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    peak_memory_bytes: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    avg_memory_bytes: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    # JSON [[seconds since start, bytes], ...] for the memory chart
    memory_profile: Mapped[str] = mapped_column(Text, default="")
    rows_affected: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    models_success: Mapped[int] = mapped_column(Integer, default=0)
    models_error: Mapped[int] = mapped_column(Integer, default=0)
    models_skipped: Mapped[int] = mapped_column(Integer, default=0)

    log_path: Mapped[str] = mapped_column(String(1024), default="")
    # Failure notification: when it was sent, through which channel, and why it failed (if it did)
    notified_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    notification_channel: Mapped[str] = mapped_column(String(200), default="")
    notification_error: Mapped[str] = mapped_column(Text, default="")

    models: Mapped[list["RunModelResult"]] = relationship(
        back_populates="run", cascade="all, delete-orphan", order_by="RunModelResult.started_at"
    )


class RunModelResult(Base):
    __tablename__ = f"{TABLE_PREFIX}run_models"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(f"{TABLE_PREFIX}runs.id", ondelete="CASCADE"), index=True
    )
    unique_id: Mapped[str] = mapped_column(String(500))
    name: Mapped[str] = mapped_column(String(300))
    resource_type: Mapped[str] = mapped_column(String(50), default="")
    status: Mapped[str] = mapped_column(String(30), default="")
    thread_id: Mapped[str] = mapped_column(String(100), default="")
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    execution_time: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    rows_affected: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    message: Mapped[str] = mapped_column(Text, default="")
    adapter_response: Mapped[str] = mapped_column(Text, default="")  # JSON

    run: Mapped[Run] = relationship(back_populates="models")


class ProjectCredentials(Base):
    __tablename__ = f"{TABLE_PREFIX}project_credentials"

    project_key: Mapped[str] = mapped_column(String(1024), primary_key=True)
    env_encrypted: Mapped[str] = mapped_column(Text, default="")
    updated_by: Mapped[str] = mapped_column(String(200), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class NotificationChannel(Base):
    """An HTTP endpoint that failure notifications are sent to (a webhook, e.g. the Telegram bot API)."""
    __tablename__ = f"{TABLE_PREFIX}notification_channels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_key: Mapped[str] = mapped_column(String(1024), index=True)
    name: Mapped[str] = mapped_column(String(200))
    # Each project has exactly one default channel while it has any
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    method: Mapped[str] = mapped_column(String(10), default="POST")  # GET | POST
    body_format: Mapped[str] = mapped_column(String(10), default="json")  # json | text (POST only)
    body_template: Mapped[str] = mapped_column(Text, default="")
    message_template: Mapped[str] = mapped_column(Text, default="")
    # URL and headers may hold tokens: stored encrypted, only the URL's scheme and host are shown
    secrets_encrypted: Mapped[str] = mapped_column(Text, default="")
    url_preview: Mapped[str] = mapped_column(String(1024), default="")
    created_by: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


_engine: Optional[Engine] = None
_session_factory: Optional[sessionmaker] = None


# Postgres is always accessed through pg8000 (BSD-licensed, pure Python)
_POSTGRES_PREFIXES = ("postgresql+psycopg2://", "postgresql+psycopg://", "postgresql://", "postgres://")


def normalize_db_url(db_url: str) -> str:
    """Map any Postgres URL form (plain, or naming another driver) to the bundled pg8000 driver."""
    for prefix in _POSTGRES_PREFIXES:
        if db_url.startswith(prefix):
            return "postgresql+pg8000://" + db_url[len(prefix):]
    return db_url


def create_db_engine(db_url: str) -> Engine:
    """Create an engine; for SQLite, make sure the folder exists and enable WAL."""
    db_url = normalize_db_url(db_url)
    if db_url.startswith("sqlite"):
        db_file = db_url.split("///", 1)[-1]
        if db_file and db_file != ":memory:":
            Path(db_file).expanduser().parent.mkdir(parents=True, exist_ok=True)
        engine = create_engine(
            db_url,
            connect_args={"check_same_thread": False, "timeout": 30},
        )

        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_connection, _record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA busy_timeout=30000")
            cursor.close()

        return engine

    return create_engine(db_url, pool_pre_ping=True)


def init_engine(db_url: str) -> Engine:
    global _engine, _session_factory
    if _engine is not None:
        _engine.dispose()
    _engine = create_db_engine(db_url)
    _session_factory = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


def get_engine() -> Engine:
    if _engine is None:
        raise RuntimeError("Scheduler database is not initialized")
    return _engine


@contextmanager
def session_scope() -> Iterator[Session]:
    """Transactional session: commits on success, rolls back on error."""
    if _session_factory is None:
        raise RuntimeError("Scheduler database is not initialized")
    session = _session_factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
