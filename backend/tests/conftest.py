"""Shared fixtures: a scheduler-enabled app, a git repo with a dbt project, and a stub dbt."""
import base64
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest
from cryptography.fernet import Fernet

BACKEND_DIR = Path(__file__).resolve().parent.parent
STUB_DBT = Path(__file__).resolve().parent / "stub_dbt.py"
sys.path.insert(0, str(BACKEND_DIR))

for key, value in {
    "GIT_AUTHOR_NAME": "Test", "GIT_AUTHOR_EMAIL": "test@example.com",
    "GIT_COMMITTER_NAME": "Test", "GIT_COMMITTER_EMAIL": "test@example.com",
}.items():
    os.environ.setdefault(key, value)


def git(*args, cwd):
    result = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)
    assert result.returncode == 0, f"git {' '.join(args)} failed: {result.stderr}"
    return result.stdout.strip()


def install_stub_venv(project_dir: Path) -> None:
    """Create .dbt-ui-venv/bin/dbt pointing at the stub."""
    bin_dir = project_dir / ".dbt-ui-venv" / "bin"
    bin_dir.mkdir(parents=True, exist_ok=True)
    dbt = bin_dir / "dbt"
    dbt.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{STUB_DBT}" "$@"\n')
    dbt.chmod(0o755)
    if not (bin_dir / "python").exists():
        (bin_dir / "python").symlink_to(sys.executable)


@pytest.fixture(scope="session")
def data_dir(tmp_path_factory):
    return tmp_path_factory.mktemp("scheduler-data")


@pytest.fixture(scope="session")
def client(data_dir):
    os.environ["DBT_UI__SCHEDULER_ENABLED"] = "true"
    os.environ["DBT_UI__SCHEDULER_DATA_DIR"] = str(data_dir)
    os.environ["DBT_UI__SCHEDULER_ENCRYPTION_KEY"] = Fernet.generate_key().decode()
    os.environ["DBT_UI__SCHEDULER_TICK_SECONDS"] = "1"
    os.environ["DBT_UI__SCHEDULER_CATCHUP_SCAN_SECONDS"] = "1"
    os.environ["DBT_UI__SCHEDULER_MANUAL_TIMEOUT"] = "5"
    if os.environ.get("DBT_UI_TEST_PG_URL"):
        os.environ["DBT_UI__SCHEDULER_DB_URL"] = os.environ["DBT_UI_TEST_PG_URL"]
    from scheduler import config
    config.load_settings()

    import scheduler.checkout as checkout

    def fake_ensure_environment(project_dir, venv_fp, deps_fp, env_vars):
        install_stub_venv(project_dir)
        return "venv-fp", "deps-fp", ["[test] stub environment"]

    checkout.ensure_environment = fake_ensure_environment

    from fastapi.testclient import TestClient
    import main

    with TestClient(main.app) as test_client:
        deadline = time.time() + 30
        while time.time() < deadline:
            status = test_client.get("/api/scheduler/status").json()
            if status["ready"]:
                break
            time.sleep(0.1)
        assert status["ready"], status
        yield test_client


@pytest.fixture
def repo(tmp_path):
    """origin (bare) <- clone with a dbt project in analytics/ <- user worktree for 'alice'."""
    origin = tmp_path / "origin.git"
    git("init", "--bare", "-b", "main", str(origin), cwd=tmp_path)
    clone = tmp_path / "git-repos" / "proj"
    clone.parent.mkdir()
    git("clone", str(origin), str(clone), cwd=tmp_path)
    git("checkout", "-b", "main", cwd=clone)
    project = clone / "analytics"
    project.mkdir()
    (project / "dbt_project.yml").write_text("name: proj\nversion: '1.0'\nprofile: proj\n")
    (clone / ".gitignore").write_text(".dbt-ui-venv\ntarget/\nlogs/\n")
    git("add", ".", cwd=clone)
    git("commit", "-m", "initial", cwd=clone)
    git("push", "-u", "origin", "main", cwd=clone)
    git("remote", "set-head", "origin", "main", cwd=clone)

    worktree = tmp_path / "git-repos" / "worktrees" / "proj-alice"
    git("worktree", "add", "-b", "alice-main", str(worktree), "main", cwd=clone)
    git("config", "user.name", "alice", cwd=worktree)
    user_project = worktree / "analytics"
    install_stub_venv(user_project)
    return {"origin": origin, "clone": clone, "worktree": worktree, "project": user_project}


def push_commit(repo, message: str) -> str:
    """Commit to origin/main from a separate clone; returns the new sha."""
    other = repo["origin"].parent / f"other-{time.time_ns()}"
    git("clone", str(repo["origin"]), str(other), cwd=repo["origin"].parent)
    (other / "analytics" / f"{time.time_ns()}.sql").write_text("select 1\n")
    git("add", ".", cwd=other)
    git("commit", "-m", message, cwd=other)
    git("push", "origin", "HEAD:main", cwd=other)
    return git("rev-parse", "HEAD", cwd=other)


def set_env_cookie(client, project_path: Path, env_vars: dict) -> None:
    from routes.env_routes import get_cookie_name
    value = base64.b64encode(json.dumps(env_vars).encode()).decode()
    client.cookies.set(get_cookie_name(str(project_path)), value)


def wait_for_run(client, run_id: int, timeout: float = 30) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        run = client.get(f"/api/scheduler/runs/{run_id}").json()
        if run["status"] not in ("scheduled", "queued", "running"):
            return run
        time.sleep(0.1)
    raise AssertionError(f"Run {run_id} did not finish: {run}")
