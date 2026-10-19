"""Unit tests that don't need the app: settings, crypto, results parsing, fingerprints, schema."""
import json
import os
from pathlib import Path

import pytest
from cryptography.fernet import Fernet


def test_parse_memory_size():
    from scheduler.config import parse_memory_size
    assert parse_memory_size("") is None
    assert parse_memory_size("512m") == 512 * 1024 ** 2
    assert parse_memory_size("2G") == 2 * 1024 ** 3
    assert parse_memory_size("1024") == 1024
    with pytest.raises(ValueError):
        parse_memory_size("lots")


def test_crypto_roundtrip_and_bad_key(monkeypatch):
    from scheduler import crypto
    monkeypatch.setattr(crypto, "_fernet", crypto._fernet)  # restored after the test
    with pytest.raises(ValueError):
        crypto.init_crypto("")
    with pytest.raises(ValueError):
        crypto.init_crypto("not-a-key")
    crypto.init_crypto(Fernet.generate_key().decode())
    token = crypto.encrypt_dict({"A": "1"})
    assert crypto.decrypt_dict(token) == {"A": "1"}
    crypto.init_crypto(Fernet.generate_key().decode())
    with pytest.raises(ValueError):
        crypto.decrypt_dict(token)


def test_run_results_parsing(tmp_path):
    from scheduler.results import parse_run_results, summarize
    path = tmp_path / "run_results.json"
    path.write_text(json.dumps({"results": [
        {"unique_id": "model.p.a", "status": "success", "thread_id": "Thread-1",
         "timing": [{"started_at": "2026-10-09T10:00:00.000000Z", "completed_at": "2026-10-09T10:00:05.000000Z"}],
         "adapter_response": {"rows_affected": 10}},
        {"unique_id": "test.p.not_null_a", "status": "fail", "timing": [], "adapter_response": {}},
        {"unique_id": "model.p.b", "status": "skipped", "timing": [], "adapter_response": {"rows_affected": -1}},
    ]}))
    results = parse_run_results(path)
    assert [r.name for r in results] == ["a", "not_null_a", "b"]
    assert results[0].resource_type == "model"
    assert (results[0].finished_at - results[0].started_at).total_seconds() == 5
    assert summarize(results) == {"models_success": 1, "models_error": 1, "models_skipped": 1, "rows_affected": 10}


def test_stale_run_results_ignored(tmp_path):
    from datetime import timedelta
    from scheduler.db import utcnow
    from scheduler.results import parse_run_results
    path = tmp_path / "run_results.json"
    path.write_text(json.dumps({"results": [{"unique_id": "model.p.a", "status": "success"}]}))
    old = utcnow().timestamp() - 3600
    os.utime(path, (old, old))
    assert parse_run_results(path, not_before=utcnow() - timedelta(seconds=1)) == []


def test_fingerprints_track_requirements_and_packages(tmp_path):
    from scheduler.checkout import deps_fingerprint, venv_fingerprint
    (tmp_path / "dbt_project.yml").write_text("name: p\nrequire-dbt-version: '>=1.8.0'\n")
    venv_fp, deps_fp = venv_fingerprint(tmp_path), deps_fingerprint(tmp_path)
    (tmp_path / "packages.yml").write_text("packages: []\n")
    assert venv_fingerprint(tmp_path) == venv_fp and deps_fingerprint(tmp_path) != deps_fp
    (tmp_path / "requirements.txt").write_text("dbt-duckdb\n")
    assert venv_fingerprint(tmp_path) != venv_fp


def test_schema_upgrade_is_idempotent(tmp_path):
    from sqlalchemy import inspect
    from scheduler.db import create_db_engine
    from scheduler.migrate import upgrade_schema
    url = os.environ.get("DBT_UI_TEST_PG_URL") or f"sqlite:///{tmp_path / 'nested' / 'db.sqlite'}"
    engine = create_db_engine(url)
    upgrade_schema(engine)
    upgrade_schema(engine)
    tables = set(inspect(engine).get_table_names())
    assert {"scheduler_jobs", "scheduler_runs", "scheduler_run_models",
            "scheduler_project_credentials", "scheduler_alembic_version"} <= tables
    engine.dispose()


def test_cron_validation():
    from scheduler.cron import validate_cron
    validate_cron("0 3 * * 1-5")
    for bad in ("", "* * * *", "0 3 * * * *", "99 * * * *"):
        with pytest.raises(ValueError):
            validate_cron(bad)


def test_disabled_scheduler_uses_original_subprocess_path(monkeypatch, tmp_path):
    import scheduler.delegate as delegate
    calls = []
    monkeypatch.setattr(delegate, "scheduler_is_ready", lambda: False)
    monkeypatch.setattr(delegate, "run_command", lambda cmd, path, timeout, env: calls.append((cmd, timeout)) or "ok")
    assert delegate.run_dbt_command(["dbt", "run"], tmp_path, 300, {}, "run", "", "", False) == "ok"
    assert calls == [(["dbt", "run"], 300)]


def test_runs_stopped_by_shutdown_are_interrupted_not_cancelled():
    from scheduler.db import utcnow
    from scheduler.executor import ExecutionResult
    from scheduler.manager import _final_status
    stopped = ExecutionResult(returncode=-2, stdout="", stderr="", started_at=utcnow(), finished_at=utcnow(), cancelled=True)
    assert _final_status(stopped) == "cancelled"
    assert _final_status(stopped, interrupted=True) == "interrupted"
    ok = ExecutionResult(returncode=0, stdout="", stderr="", started_at=utcnow(), finished_at=utcnow())
    assert _final_status(ok, interrupted=True) == "success"


def test_node_name_drops_generic_test_hash():
    from scheduler.results import node_name

    assert node_name("model.shop.stg_orders") == "stg_orders"
    assert node_name("test.shop.unique_orders_order_id.fed79b3a6e") == "unique_orders_order_id"
    assert node_name("test.shop.assert_positive_total") == "assert_positive_total"
    assert node_name("unit_test.shop.stg_orders.test_dates") == "test_dates"


def test_postgres_urls_use_pg8000():
    from scheduler.db import normalize_db_url

    expected = "postgresql+pg8000://u:p@h:5432/db"
    for url in ("postgresql://u:p@h:5432/db", "postgres://u:p@h:5432/db",
                "postgresql+psycopg://u:p@h:5432/db", "postgresql+psycopg2://u:p@h:5432/db", expected):
        assert normalize_db_url(url) == expected
    assert normalize_db_url("sqlite:////tmp/x.db") == "sqlite:////tmp/x.db"


def test_venv_with_missing_interpreter_needs_rebuild(tmp_path):
    from scheduler.checkout import venv_python_ok
    from utils.venv_utils import get_venv_path

    bin_dir = get_venv_path(tmp_path) / "bin"
    bin_dir.mkdir(parents=True)
    interpreter = tmp_path / "python3.13"
    interpreter.write_text("")
    (bin_dir / "python").symlink_to(interpreter)
    assert venv_python_ok(tmp_path)

    interpreter.unlink()  # e.g. container recreated and the uv-managed Python is gone
    assert not venv_python_ok(tmp_path)


def test_slots_between_includes_both_ends():
    from datetime import datetime

    from scheduler.cron import slots_between

    slots = slots_between("*/15 * * * *", datetime(2026, 10, 13, 4, 15), datetime(2026, 10, 13, 7, 57, 44))
    assert slots[0] == datetime(2026, 10, 13, 4, 15) and slots[-1] == datetime(2026, 10, 13, 7, 45) and len(slots) == 15
    assert slots_between("*/15 * * * *", datetime(2026, 10, 13, 4, 1, 30, 500), datetime(2026, 10, 13, 4, 30)) == [
        datetime(2026, 10, 13, 4, 15), datetime(2026, 10, 13, 4, 30)]


def test_schedule_vars_describe_the_slot():
    from datetime import datetime

    from scheduler.manager import build_dbt_command, schedule_vars

    slot_vars = schedule_vars(datetime(2026, 10, 13, 4, 15), "*/15 * * * *")
    assert slot_vars == {
        "dbt_ui_run_timestamp": 1791864900,
        "dbt_ui_run_datetime": "2026-10-13T04:15:00Z",
        "dbt_ui_cron": "*/15 * * * *",
    }
    cmd = build_dbt_command("dbt", "build", Path("/p"), dbt_vars=slot_vars)
    assert cmd[-2] == "--vars" and json.loads(cmd[-1]) == slot_vars


def test_memory_profile_downsamples_keeping_peaks():
    from scheduler.executor import memory_profile

    assert memory_profile([]) == []
    assert memory_profile([5, 7, 6]) == [[0, 5], [1, 7], [2, 6]]
    profile = memory_profile(list(range(100)), max_points=10)
    assert len(profile) == 10 and profile[0] == [0, 9] and profile[-1] == [90, 99]
