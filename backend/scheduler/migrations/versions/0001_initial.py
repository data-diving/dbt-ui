"""Initial scheduler schema: jobs, runs, run results, project credentials and notification channels.

Revision ID: 0001_initial
Revises:
Create Date: 2026-10-09
"""
import sqlalchemy as sa
from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "scheduler_jobs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("project_key", sa.String(1024), nullable=False),
        sa.Column("repo_path", sa.String(1024), nullable=False),
        sa.Column("subdirectory", sa.String(1024), nullable=False, server_default=""),
        sa.Column("command", sa.String(20), nullable=False),
        sa.Column("selector", sa.String(1000), nullable=False, server_default=""),
        sa.Column("target", sa.String(200), nullable=False, server_default=""),
        sa.Column("full_refresh", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("cron", sa.String(100), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("timeout_seconds", sa.Integer(), nullable=False, server_default="3600"),
        sa.Column("overlap_policy", sa.String(20), nullable=False, server_default="skip"),
        sa.Column("misfire_policy", sa.String(20), nullable=False, server_default="run_all"),
        sa.Column("next_run_at", sa.DateTime(), nullable=True),
        sa.Column("catchup_since", sa.DateTime(), nullable=True),
        sa.Column("pull_latest", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("pinned_sha", sa.String(64), nullable=False, server_default=""),
        sa.Column("credentials_mode", sa.String(20), nullable=False, server_default="user"),
        sa.Column("env_encrypted", sa.Text(), nullable=False, server_default=""),
        sa.Column("git_creds_encrypted", sa.Text(), nullable=False, server_default=""),
        sa.Column("checkout_state", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("checkout_error", sa.Text(), nullable=False, server_default=""),
        sa.Column("venv_fingerprint", sa.String(64), nullable=False, server_default=""),
        sa.Column("deps_fingerprint", sa.String(64), nullable=False, server_default=""),
        sa.Column("notification_channel_id", sa.Integer(), nullable=True),
        sa.Column("created_by", sa.String(200), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_scheduler_jobs_project_key", "scheduler_jobs", ["project_key"])
    op.create_index("ix_scheduler_jobs_next_run_at", "scheduler_jobs", ["next_run_at"])

    op.create_table(
        "scheduler_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("job_id", sa.Integer(), sa.ForeignKey("scheduler_jobs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("job_name", sa.String(200), nullable=False, server_default=""),
        sa.Column("project_key", sa.String(1024), nullable=False),
        sa.Column("project_path", sa.String(1024), nullable=False),
        sa.Column("trigger", sa.String(20), nullable=False),
        sa.Column("triggered_by", sa.String(200), nullable=False, server_default=""),
        sa.Column("command", sa.String(20), nullable=False),
        sa.Column("selector", sa.String(1000), nullable=False, server_default=""),
        sa.Column("target", sa.String(200), nullable=False, server_default=""),
        sa.Column("full_refresh", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("commit_sha", sa.String(64), nullable=False, server_default=""),
        sa.Column("scheduled_for", sa.DateTime(), nullable=True),
        sa.Column("rerun_of_id", sa.Integer(), nullable=True),
        sa.Column("dbt_vars", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(20), nullable=False, server_default="queued"),
        sa.Column("error", sa.Text(), nullable=False, server_default=""),
        sa.Column("exit_code", sa.Integer(), nullable=True),
        sa.Column("queued_at", sa.DateTime(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("peak_memory_bytes", sa.BigInteger(), nullable=True),
        sa.Column("avg_memory_bytes", sa.BigInteger(), nullable=True),
        sa.Column("memory_profile", sa.Text(), nullable=False, server_default=""),
        sa.Column("rows_affected", sa.BigInteger(), nullable=True),
        sa.Column("models_success", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("models_error", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("models_skipped", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("log_path", sa.String(1024), nullable=False, server_default=""),
        sa.Column("notified_at", sa.DateTime(), nullable=True),
        sa.Column("notification_channel", sa.String(200), nullable=False, server_default=""),
        sa.Column("notification_error", sa.Text(), nullable=False, server_default=""),
    )
    op.create_index("ix_scheduler_runs_job_id", "scheduler_runs", ["job_id"])
    op.create_index("ix_scheduler_runs_project_key", "scheduler_runs", ["project_key"])
    op.create_index("ix_scheduler_runs_status", "scheduler_runs", ["status"])
    op.create_index("ix_scheduler_runs_queued_at", "scheduler_runs", ["queued_at"])
    op.create_index("ix_scheduler_runs_scheduled_for", "scheduler_runs", ["scheduled_for"])

    op.create_table(
        "scheduler_run_models",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("run_id", sa.Integer(), sa.ForeignKey("scheduler_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("unique_id", sa.String(500), nullable=False),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("resource_type", sa.String(50), nullable=False, server_default=""),
        sa.Column("status", sa.String(30), nullable=False, server_default=""),
        sa.Column("thread_id", sa.String(100), nullable=False, server_default=""),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("execution_time", sa.Float(), nullable=True),
        sa.Column("rows_affected", sa.BigInteger(), nullable=True),
        sa.Column("message", sa.Text(), nullable=False, server_default=""),
        sa.Column("adapter_response", sa.Text(), nullable=False, server_default=""),
    )
    op.create_index("ix_scheduler_run_models_run_id", "scheduler_run_models", ["run_id"])

    op.create_table(
        "scheduler_project_credentials",
        sa.Column("project_key", sa.String(1024), primary_key=True),
        sa.Column("env_encrypted", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_by", sa.String(200), nullable=False, server_default=""),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "scheduler_notification_channels",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_key", sa.String(1024), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("method", sa.String(10), nullable=False, server_default="POST"),
        sa.Column("body_format", sa.String(10), nullable=False, server_default="json"),
        sa.Column("body_template", sa.Text(), nullable=False, server_default=""),
        sa.Column("message_template", sa.Text(), nullable=False, server_default=""),
        sa.Column("secrets_encrypted", sa.Text(), nullable=False, server_default=""),
        sa.Column("url_preview", sa.String(1024), nullable=False, server_default=""),
        sa.Column("created_by", sa.String(200), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_scheduler_notification_channels_project_key", "scheduler_notification_channels", ["project_key"]
    )


def downgrade() -> None:
    op.drop_table("scheduler_notification_channels")
    op.drop_table("scheduler_project_credentials")
    op.drop_table("scheduler_run_models")
    op.drop_table("scheduler_runs")
    op.drop_table("scheduler_jobs")
