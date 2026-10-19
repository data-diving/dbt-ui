"""End-to-end tests of the scheduler API against a real git repo and a stub dbt."""
import time
from datetime import timedelta

from conftest import git, push_commit, set_env_cookie, wait_for_run

JOB = {
    "name": "nightly",
    "command": "build",
    "selector": "",
    "target": "",
    "full_refresh": False,
    "cron": "0 3 * * *",
    "enabled": True,
    "timeout_seconds": 600,
    "overlap_policy": "skip",
    "misfire_policy": "run_all",
    "pull_latest": True,
    "credentials_mode": "user",
}


def create_job(client, repo, **overrides):
    response = client.post("/api/scheduler/jobs", json={**JOB, "path": str(repo["project"]), **overrides})
    assert response.status_code == 200, response.text
    return response.json()


def test_status_and_cron_preview(client):
    status = client.get("/api/scheduler/status").json()
    assert status == {**status, "enabled": True, "ready": True, "timezone": "UTC"}

    preview = client.post("/api/scheduler/cron-preview", json={"cron": "*/15 * * * *"}).json()
    assert preview["valid"] and len(preview["next_runs"]) == 5
    assert all(t.endswith("Z") for t in preview["next_runs"])

    bad = client.post("/api/scheduler/cron-preview", json={"cron": "every day"}).json()
    assert not bad["valid"] and bad["error"]


def test_context_resolves_main_repo_and_default_branch(client, repo):
    set_env_cookie(client, repo["project"], {"DB_PASSWORD": "secret"})
    ctx = client.post("/api/scheduler/context", json={"path": str(repo["project"])}).json()
    assert ctx["repo_path"] == str(repo["clone"].resolve())
    assert ctx["subdirectory"] == "analytics"
    assert ctx["default_branch"] == "main"
    assert ctx["user_name"] == "alice"
    assert ctx["my_env_var_names"] == ["DB_PASSWORD"]
    assert ctx["latest_commit"]["sha"] == git("rev-parse", "origin/main", cwd=repo["clone"])


def test_run_now_uses_default_branch_and_records_metrics(client, repo):
    set_env_cookie(client, repo["project"], {"DB_PASSWORD": "from-alice"})
    job = create_job(client, repo)
    assert job["env_var_names"] == ["DB_PASSWORD"]
    assert job["next_run_at"].endswith("Z")
    assert job["created_by"] == "alice"

    # Uncommitted work in alice's worktree must never reach scheduled runs
    (repo["project"] / "dirty.sql").write_text("select 'uncommitted'\n")

    run_id = client.post(f"/api/scheduler/jobs/{job['id']}/trigger", json={"path": str(repo["project"])}).json()["run_id"]
    run = wait_for_run(client, run_id)
    assert run["status"] == "success", run
    assert run["trigger"] == "run_now" and run["triggered_by"] == "alice"
    assert run["commit_sha"] == git("rev-parse", "origin/main", cwd=repo["clone"])
    assert run["rows_affected"] == 42  # the view's -1 is ignored
    assert run["models_success"] == 2
    assert run["peak_memory_bytes"] is None or run["peak_memory_bytes"] > 0
    assert {m["name"] for m in run["models"]} == {"orders", "customers_view"}
    orders = next(m for m in run["models"] if m["name"] == "orders")
    assert orders["thread_id"] == "Thread-1" and orders["started_at"].endswith("Z")

    logs = client.get(f"/api/scheduler/runs/{run_id}/logs").json()
    assert "Completed successfully" in logs["content"] and logs["done"]
    assert "/checkouts/job-" in logs["content"]  # ran in the job checkout, not the worktree
    assert "dirty.sql" not in logs["content"]


def test_pull_latest_vs_pinned(client, repo):
    pulled = create_job(client, repo, name="pulled")
    pinned = create_job(client, repo, name="pinned", pull_latest=False)
    first_sha = git("rev-parse", "origin/main", cwd=repo["clone"])
    assert pinned["pinned_sha"] == first_sha

    new_sha = push_commit(repo, "new model")

    path = {"path": str(repo["project"])}
    run_pulled = wait_for_run(client, client.post(f"/api/scheduler/jobs/{pulled['id']}/trigger", json=path).json()["run_id"])
    run_pinned = wait_for_run(client, client.post(f"/api/scheduler/jobs/{pinned['id']}/trigger", json=path).json()["run_id"])
    assert run_pulled["commit_sha"] == new_sha
    assert run_pinned["commit_sha"] == first_sha

    repinned = client.put(
        f"/api/scheduler/jobs/{pinned['id']}", json={**JOB, "name": "pinned", "pull_latest": False, "repin": True, **path}
    ).json()
    assert repinned["pinned_sha"] == new_sha


def test_credentials_modes(client, repo, monkeypatch):
    monkeypatch.setenv("STUB_PRINT_ENV", "DB_PASSWORD")
    path = {"path": str(repo["project"])}

    set_env_cookie(client, repo["project"], {"DB_PASSWORD": "alice-secret"})
    user_job = create_job(client, repo, name="user-creds")

    # Project mode requires project credentials to exist
    response = client.post("/api/scheduler/jobs", json={**JOB, **path, "name": "proj", "credentials_mode": "project"})
    assert response.status_code == 400

    saved = client.post(
        "/api/scheduler/project-credentials/set",
        json={**path, "source": "values", "env_vars": {"DB_PASSWORD": "service-secret"}},
    ).json()
    assert saved["env_var_names"] == ["DB_PASSWORD"]
    project_job = create_job(client, repo, name="project-creds", credentials_mode="project")

    # Values are never returned
    ctx = client.post("/api/scheduler/context", json=path).json()
    assert "service-secret" not in str(ctx)

    run_user = wait_for_run(client, client.post(f"/api/scheduler/jobs/{user_job['id']}/trigger", json=path).json()["run_id"])
    run_project = wait_for_run(client, client.post(f"/api/scheduler/jobs/{project_job['id']}/trigger", json=path).json()["run_id"])
    assert "ENV DB_PASSWORD=alice-secret" in client.get(f"/api/scheduler/runs/{run_user['id']}/logs").json()["content"]
    assert "ENV DB_PASSWORD=service-secret" in client.get(f"/api/scheduler/runs/{run_project['id']}/logs").json()["content"]

    # Can't delete project credentials while a job uses them
    assert client.post("/api/scheduler/project-credentials/delete", json=path).status_code == 409


def test_overlap_skip_and_cancel(client, repo, monkeypatch):
    monkeypatch.setenv("STUB_SLEEP", "30")
    path = {"path": str(repo["project"])}
    job = create_job(client, repo, name="slow")

    first = client.post(f"/api/scheduler/jobs/{job['id']}/trigger", json=path).json()["run_id"]
    deadline = time.time() + 10
    while client.get(f"/api/scheduler/runs/{first}").json()["status"] != "running" and time.time() < deadline:
        time.sleep(0.1)
    second = client.post(f"/api/scheduler/jobs/{job['id']}/trigger", json=path).json()["run_id"]
    assert wait_for_run(client, second)["status"] == "skipped"

    assert client.post(f"/api/scheduler/runs/{first}/cancel").status_code == 200
    run = wait_for_run(client, first, timeout=40)
    assert run["status"] == "cancelled", run


def test_failed_run_reports_error(client, repo, monkeypatch):
    monkeypatch.setenv("STUB_FAIL", "1")
    job = create_job(client, repo, name="failing")
    run_id = client.post(f"/api/scheduler/jobs/{job['id']}/trigger", json={"path": str(repo["project"])}).json()["run_id"]
    run = wait_for_run(client, run_id)
    assert run["status"] == "failed"
    assert "exited with code 1" in run["error"] and "boom" in run["error"]
    assert run["models_error"] == 1


def _wait_for_job_runs(client, repo, job_ids, count, timeout=30):
    path = {"path": str(repo["project"])}
    deadline = time.time() + timeout
    while True:
        runs = client.post("/api/scheduler/runs/list", json=path).json()["runs"]
        mine = [r for r in runs if r["job_id"] in job_ids and r["status"] != "scheduled"]
        active = [r for r in mine if r["status"] in ("queued", "running")]
        if (len(mine) >= count and not active) or time.time() > deadline:
            return mine
        time.sleep(0.2)


def test_cron_loop_fires_due_jobs_and_handles_missed_slots(client, repo):
    from scheduler.db import Job, session_scope, utcnow

    # Every 15 minutes, last fired 2 hours ago: 8 slots were missed
    every_15 = {"cron": "*/15 * * * *", "overlap_policy": "skip"}
    due = create_job(client, repo, name="due")
    run_all = create_job(client, repo, name="run_all", misfire_policy="run_all", **every_15)
    run_once = create_job(client, repo, name="run_once", misfire_policy="run_once", **every_15)
    skip = create_job(client, repo, name="skip", misfire_policy="skip", **every_15)
    now = utcnow()
    first_missed = now.replace(minute=now.minute - now.minute % 15, second=0, microsecond=0) - timedelta(hours=2)
    with session_scope() as session:
        session.get(Job, due["id"]).next_run_at = now - timedelta(seconds=1)
        for job in (run_all, run_once, skip):
            session.get(Job, job["id"]).next_run_at = first_missed

    runs = _wait_for_job_runs(client, repo, {due["id"], run_all["id"], run_once["id"], skip["id"]}, 11)
    by_job = {j["id"]: sorted((r for r in runs if r["job_id"] == j["id"]), key=lambda r: r["id"])
              for j in (due, run_all, run_once, skip)}

    scheduled = by_job[due["id"]]
    assert scheduled and scheduled[0]["trigger"] == "schedule" and scheduled[0]["triggered_by"] == "alice"

    # One run per missed slot (8 or 9, depending on how old the current slot is), in slot order,
    # all executed although the overlap policy is "skip"
    caught_up = [r for r in by_job[run_all["id"]] if r["trigger"] == "catch_up"]
    assert len(caught_up) in (8, 9)
    assert [r["scheduled_for"] for r in caught_up] == sorted({r["scheduled_for"] for r in caught_up})
    assert caught_up[0]["scheduled_for"] == first_missed.isoformat() + "Z"
    assert all(r["status"] == "success" for r in by_job[run_all["id"]])
    assert [r["started_at"] for r in caught_up] == sorted(r["started_at"] for r in caught_up)

    once = [r for r in by_job[run_once["id"]] if r["trigger"] == "catch_up"]
    assert len(once) == 1 and once[0]["scheduled_for"] == caught_up[-1]["scheduled_for"]
    assert not [r for r in by_job[skip["id"]] if r["trigger"] == "catch_up"]

    path = {"path": str(repo["project"])}
    jobs = {j["id"]: j for j in client.post("/api/scheduler/jobs/list", json=path).json()["jobs"]}
    assert jobs[skip["id"]]["next_run_at"] > jobs[skip["id"]]["updated_at"]


def test_job_runs_get_slot_vars_and_can_be_rerun(client, repo):
    from scheduler.db import Job, session_scope

    path = {"path": str(repo["project"])}
    job = create_job(client, repo, name="vars", cron="*/5 * * * *", selector="orders")
    first = wait_for_run(client, client.post(f"/api/scheduler/jobs/{job['id']}/trigger", json=path).json()["run_id"])
    slot = first["scheduled_for"]
    assert first["trigger"] == "run_now" and slot.endswith("Z")
    assert first["dbt_vars"]["dbt_ui_run_datetime"] == slot and first["dbt_vars"]["dbt_ui_cron"] == "*/5 * * * *"

    # A rerun repeats the original parameters, even after the job was changed
    with session_scope() as session:
        changed = session.get(Job, job["id"])
        changed.selector, changed.cron = "customers_view", "0 * * * *"
    old_commit = first["commit_sha"]
    new_commit = push_commit(repo, "after the first run")
    assert new_commit != old_commit

    response = client.post("/api/scheduler/runs/rerun", json={**path, "run_ids": [first["id"]], "same_commit": True})
    assert response.status_code == 200, response.text
    rerun = wait_for_run(client, response.json()["run_ids"][0])
    assert rerun["trigger"] == "rerun" and rerun["rerun_of_id"] == first["id"] and rerun["status"] == "success"
    assert rerun["scheduled_for"] == slot and rerun["dbt_vars"] == first["dbt_vars"]
    assert rerun["selector"] == "orders" and rerun["commit_sha"] == old_commit
    log = client.get(f"/api/scheduler/runs/{rerun['id']}/logs").json()["content"]
    assert f'"dbt_ui_run_datetime": "{slot}"' in log and '"dbt_ui_cron": "*/5 * * * *"' in log
    assert "--select orders" in log

    latest = client.post("/api/scheduler/runs/rerun", json={**path, "run_ids": [first["id"]], "same_commit": False})
    assert wait_for_run(client, latest.json()["run_ids"][0])["commit_sha"] == new_commit


def test_bulk_rerun_in_slot_order(client, repo):
    path = {"path": str(repo["project"])}
    job = create_job(client, repo, name="bulk")
    ids = [wait_for_run(client, client.post(f"/api/scheduler/jobs/{job['id']}/trigger", json=path).json()["run_id"])["id"]
           for _ in range(2)]

    response = client.post("/api/scheduler/runs/rerun", json={**path, "run_ids": list(reversed(ids))})
    new_ids = response.json()["run_ids"]
    reruns = [wait_for_run(client, run_id) for run_id in new_ids]
    assert [r["rerun_of_id"] for r in reruns] == ids
    assert reruns[0]["started_at"] < reruns[1]["started_at"]

    # Finished runs can't be skipped
    response = client.post("/api/scheduler/runs/skip", json={**path, "run_ids": ids})
    assert response.status_code == 400
    assert client.get(f"/api/scheduler/runs/{ids[0]}").json()["status"] == "success"

    # Runs of deleted jobs have nothing to rerun with
    orphan = wait_for_run(client, client.post(f"/api/scheduler/jobs/{job['id']}/trigger", json=path).json()["run_id"])
    assert client.post(f"/api/scheduler/jobs/{job['id']}/delete", json=path).status_code == 200
    response = client.post("/api/scheduler/runs/rerun", json={**path, "run_ids": [orphan["id"]]})
    assert response.status_code == 400 and "existing jobs" in response.json()["detail"]

    # Neither do manual runs from the editor
    client.post("/api/dbt-command", json={**path, "command": "run", "selector": "orders"})
    client.post("/api/dbt-command-status", json=path)
    manual = next(r for r in client.post("/api/scheduler/runs/list", json=path).json()["runs"] if r["trigger"] == "manual")
    assert manual["scheduled_for"] is None and manual["dbt_vars"] is None
    assert client.post("/api/scheduler/runs/rerun", json={**path, "run_ids": [manual["id"]]}).status_code == 400


def test_manual_run_delegated_with_identical_status(client, repo):
    """The existing /api/dbt-command flow keeps its responses; the run is also recorded."""
    path = {"path": str(repo["project"])}
    response = client.post("/api/dbt-command", json={**path, "command": "run", "selector": "orders"})
    assert response.status_code == 200 and response.json()["status"] == "started"

    status = client.post("/api/dbt-command-status", json=path).json()
    assert status["status"] == "success", status
    assert status["command"] == "run" and status["selector"] == "orders"
    assert "Completed successfully" in status["output"]
    assert set(status) == {"status", "command", "selector", "completed_at", "output"}

    runs = client.post("/api/scheduler/runs/list", json=path).json()["runs"]
    manual = next(r for r in runs if r["trigger"] == "manual")
    assert manual["triggered_by"] == "alice" and manual["selector"] == "orders"
    assert manual["rows_affected"] == 42
    # Manual runs execute in the user's worktree and write to its normal target/
    assert (repo["project"] / "target" / "run_results.json").exists()


def test_manual_run_failure_and_timeout_match_original_messages(client, repo, monkeypatch):
    path = {"path": str(repo["project"])}
    monkeypatch.setenv("STUB_FAIL", "1")
    client.post("/api/dbt-command", json={**path, "command": "run"})
    status = client.post("/api/dbt-command-status", json=path).json()
    assert status["status"] == "failed" and "Database Error: boom" in status["error"]

    monkeypatch.delenv("STUB_FAIL")
    monkeypatch.setenv("STUB_SLEEP", "30")  # manual timeout is 5s in tests
    client.post("/api/dbt-command", json={**path, "command": "run"})
    status = client.post("/api/dbt-command-status", json=path).json()
    assert status["status"] == "failed" and "timed out" in status["error"]


def test_delete_job_removes_checkout(client, repo, data_dir):
    job = create_job(client, repo, name="to-delete")
    run_id = client.post(f"/api/scheduler/jobs/{job['id']}/trigger", json={"path": str(repo["project"])}).json()["run_id"]
    wait_for_run(client, run_id)
    assert (data_dir / "checkouts" / f"job-{job['id']}").exists()
    assert client.post(f"/api/scheduler/jobs/{job['id']}/delete", json={"path": str(repo["project"])}).status_code == 200
    assert not (data_dir / "checkouts" / f"job-{job['id']}").exists()
    # History is kept with the job name
    run = client.get(f"/api/scheduler/runs/{run_id}").json()
    assert run["job_id"] is None and run["job_name"] == "to-delete"


def test_invalid_job_input_rejected(client, repo):
    path = {"path": str(repo["project"])}
    for overrides in ({"cron": "61 * * * *"}, {"command": "rm"}, {"selector": "a; rm -rf /"}, {"name": ""}):
        assert client.post("/api/scheduler/jobs", json={**JOB, **path, **overrides}).status_code == 400


def test_manual_runs_wait_for_the_global_concurrency_limit(client, repo, monkeypatch):
    """With MAX_CONCURRENT=2 busy with scheduled runs, a manual run is queued until a slot frees up."""
    from datetime import datetime
    from scheduler import config
    assert config.settings.max_concurrent == 2
    monkeypatch.setenv("STUB_SLEEP", "3")
    path = {"path": str(repo["project"])}
    jobs = [create_job(client, repo, name=f"busy-{i}") for i in range(2)]
    job_runs = [client.post(f"/api/scheduler/jobs/{j['id']}/trigger", json=path).json()["run_id"] for j in jobs]
    deadline = time.time() + 15
    while time.time() < deadline and not all(
        client.get(f"/api/scheduler/runs/{r}").json()["status"] == "running" for r in job_runs
    ):
        time.sleep(0.1)

    # Blocks until the manual run finishes (TestClient runs background tasks inline)
    client.post("/api/dbt-command", json={**path, "command": "run"})
    status = client.post("/api/dbt-command-status", json=path).json()
    assert status["status"] == "success", status

    parse = lambda t: datetime.fromisoformat(t.replace("Z", ""))  # noqa: E731
    finished = [parse(wait_for_run(client, r)["finished_at"]) for r in job_runs]
    manual = next(r for r in client.post("/api/scheduler/runs/list", json=path).json()["runs"] if r["trigger"] == "manual")
    assert parse(manual["started_at"]) >= min(finished)


def test_paused_slots_are_recorded_as_skipped_and_can_be_backfilled(client, repo):
    from scheduler.db import Job, session_scope, utcnow

    path = {"path": str(repo["project"])}
    job = create_job(client, repo, name="paused", cron="*/15 * * * *", enabled=False)
    now = utcnow()
    first = now.replace(minute=now.minute - now.minute % 15, second=0, microsecond=0) - timedelta(minutes=30)
    with session_scope() as session:
        session.get(Job, job["id"]).next_run_at = first

    deadline = time.time() + 15
    while time.time() < deadline:
        runs = client.post("/api/scheduler/runs/list", json={**path, "job_id": job["id"], "statuses": ["skipped"]}).json()["runs"]
        if len(runs) >= 3:
            break
        time.sleep(0.2)
    assert sorted(r["scheduled_for"] for r in runs)[0] == first.isoformat() + "Z"
    assert all(r["status"] == "skipped" and "paused" in r["error"] for r in runs) and len(runs) == 3
    assert not client.post("/api/scheduler/runs/list", json={**path, "job_id": job["id"]}).json()["runs"]

    # Backfill: rerun the skipped slots, each with its own slot
    new_ids = client.post("/api/scheduler/runs/rerun", json={**path, "run_ids": [r["id"] for r in runs]}).json()["run_ids"]
    done = [wait_for_run(client, run_id) for run_id in new_ids]
    assert all(r["status"] == "success" for r in done)
    assert [r["scheduled_for"] for r in done] == sorted(r["scheduled_for"] for r in runs)


def test_history_scan_catches_up_old_gaps_but_not_skipped_runs(client, repo):
    from scheduler.db import Job, Run, session_scope, utcnow

    path = {"path": str(repo["project"])}
    job = create_job(client, repo, name="history", cron="0 * * * *")
    now = utcnow()
    last_hour = now.replace(minute=0, second=0, microsecond=0)
    if now - last_hour < timedelta(minutes=2):
        last_hour -= timedelta(hours=1)
    slots = [last_hour - timedelta(hours=h) for h in (4, 3, 2, 1, 0)]
    with session_scope() as session:
        stored = session.get(Job, job["id"])
        stored.catchup_since = slots[0] - timedelta(minutes=5)
        # One slot already ran, another one was skipped: neither is caught up
        for slot, status in ((slots[1], "success"), (slots[3], "skipped")):
            session.add(Run(
                job_id=stored.id, job_name=stored.name, project_key=stored.project_key, project_path="",
                trigger="schedule", command="build", status=status, queued_at=slot, started_at=slot,
                finished_at=slot, scheduled_for=slot,
            ))

    runs = _wait_for_job_runs(client, repo, {job["id"]}, 4)
    caught_up = sorted((r for r in runs if r["trigger"] == "catch_up"), key=lambda r: r["id"])
    assert [r["scheduled_for"] for r in caught_up] == [s.isoformat() + "Z" for s in (slots[0], slots[2], slots[4])]
    assert all(r["status"] == "success" for r in caught_up)
    assert caught_up[0]["dbt_vars"]["dbt_ui_run_datetime"] == slots[0].isoformat() + "Z"


def _scheduled_runs(client, path, job_id):
    runs = client.post("/api/scheduler/runs/list", json={**path, "job_id": job_id}).json()["runs"]
    return [r for r in runs if r["status"] == "scheduled"]


def test_each_job_has_one_scheduled_run_that_starts_on_time(client, repo):
    from scheduler.db import Job, Run, session_scope, utcnow

    path = {"path": str(repo["project"])}
    job = create_job(client, repo, name="next", cron="*/15 * * * *")
    [scheduled] = _scheduled_runs(client, path, job["id"])
    assert scheduled["scheduled_for"] == job["next_run_at"] and scheduled["started_at"] is None
    log = client.get(f"/api/scheduler/runs/{scheduled['id']}/logs")
    assert log.status_code == 200 and log.json() == {"content": "", "offset": 0, "done": True}
    log = client.get(f"/api/scheduler/runs/{scheduled['id']}/logs")
    assert log.status_code == 200 and log.json() == {"content": "", "offset": 0, "done": True}
    assert scheduled["dbt_vars"]["dbt_ui_run_datetime"] == job["next_run_at"]

    # Its time comes: that same run is started, and the next slot gets a scheduled run
    due = utcnow().replace(microsecond=0) - timedelta(seconds=1)
    with session_scope() as session:
        session.get(Job, job["id"]).next_run_at = due
        session.get(Run, scheduled["id"]).scheduled_for = due
    run = wait_for_run(client, scheduled["id"])
    assert run["status"] == "success" and run["trigger"] == "schedule" and run["started_at"]
    listed = client.post("/api/scheduler/runs/list", json={**path, "job_id": job["id"], "include_memory_profile": True}).json()
    profile = next(r for r in listed["runs"] if r["id"] == run["id"])["memory_profile"]
    assert profile and all(len(point) == 2 and point[1] > 0 for point in profile)
    deadline = time.time() + 10
    while time.time() < deadline and not _scheduled_runs(client, path, job["id"]):
        time.sleep(0.2)
    [following] = _scheduled_runs(client, path, job["id"])
    assert following["id"] != scheduled["id"] and following["scheduled_for"] > run["scheduled_for"]

    # Paused jobs have none; resuming brings it back
    fields = {k: v for k, v in JOB.items()} | {"name": "next", "cron": "*/15 * * * *", "path": path["path"]}
    client.put(f"/api/scheduler/jobs/{job['id']}", json={**fields, "enabled": False})
    assert _scheduled_runs(client, path, job["id"]) == []
    client.put(f"/api/scheduler/jobs/{job['id']}", json={**fields, "enabled": True})
    assert len(_scheduled_runs(client, path, job["id"])) == 1


def test_skipping_the_scheduled_run_cancels_it(client, repo):
    path = {"path": str(repo["project"])}
    job = create_job(client, repo, name="cancel", cron="*/15 * * * *")
    [scheduled] = _scheduled_runs(client, path, job["id"])

    response = client.post("/api/scheduler/runs/skip", json={**path, "run_ids": [scheduled["id"]]})
    assert response.status_code == 200 and response.json()["skipped"] == [scheduled["id"]]
    cancelled = client.get(f"/api/scheduler/runs/{scheduled['id']}").json()
    assert cancelled["status"] == "skipped" and cancelled["error"] == "Skipped by user"

    [following] = _scheduled_runs(client, path, job["id"])
    assert following["scheduled_for"] > scheduled["scheduled_for"]
    jobs = {j["id"]: j for j in client.post("/api/scheduler/jobs/list", json=path).json()["jobs"]}
    assert jobs[job["id"]]["next_run_at"] == following["scheduled_for"]
    assert jobs[job["id"]]["last_run"] is None

    # Scheduled runs can't be rerun, and deleting the job removes its scheduled run
    assert client.post("/api/scheduler/runs/rerun", json={**path, "run_ids": [following["id"]]}).status_code == 400
    assert client.post(f"/api/scheduler/jobs/{job['id']}/delete", json=path).status_code == 200
    assert client.get(f"/api/scheduler/runs/{following['id']}").status_code == 404


def test_skipping_a_running_run_kills_it_and_lets_the_queue_go_on(client, repo, monkeypatch):
    monkeypatch.setenv("STUB_SLEEP", "30")
    path = {"path": str(repo["project"])}
    job = create_job(client, repo, name="skip-running", overlap_policy="queue")
    first = client.post(f"/api/scheduler/jobs/{job['id']}/trigger", json=path).json()["run_id"]
    second = client.post(f"/api/scheduler/jobs/{job['id']}/trigger", json=path).json()["run_id"]
    deadline = time.time() + 15
    while client.get(f"/api/scheduler/runs/{first}").json()["status"] != "running" and time.time() < deadline:
        time.sleep(0.1)
    time.sleep(1)  # let dbt start

    started = time.time()
    assert client.post("/api/scheduler/runs/skip", json={**path, "run_ids": [first, second]}).status_code == 200
    killed = wait_for_run(client, first, timeout=10)
    assert time.time() - started < 5  # killed at once, not after the graceful cancel sequence
    assert killed["status"] == "skipped" and killed["error"] == "Skipped by user"
    queued = wait_for_run(client, second, timeout=10)
    assert queued["status"] == "skipped" and queued["error"] == "Skipped by user"


class _Receiver:
    """A local HTTP endpoint that records the requests it gets."""

    def __init__(self):
        import http.server
        import threading

        received = self.received = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def _record(self):
                length = int(self.headers.get("Content-Length") or 0)
                received.append({
                    "method": self.command, "path": self.path, "headers": dict(self.headers),
                    "body": self.rfile.read(length).decode() if length else "",
                })
                status = 500 if "fail" in self.path else 200
                self.send_response(status)
                self.end_headers()
                self.wfile.write(b'{"ok": false, "description": "bad chat"}' if status == 500 else b"{}")

            do_GET = do_POST = _record

            def log_message(self, *args):
                pass

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def wait(self, count, timeout=15):
        deadline = time.time() + timeout
        while len(self.received) < count and time.time() < deadline:
            time.sleep(0.1)
        return self.received

    def close(self):
        self.server.shutdown()


def _channels(client, path):
    return client.post("/api/scheduler/notifications/list", json=path).json()["channels"]


def _delete_channels(client, path):
    for channel in _channels(client, path):
        client.post(f"/api/scheduler/notifications/{channel['id']}/delete", json=path)


def test_notification_channels_keep_one_default_and_hide_secrets(client, repo):
    path = {"path": str(repo["project"])}
    _delete_channels(client, path)
    create = lambda **fields: client.post("/api/scheduler/notifications", json={**path, **fields})  # noqa: E731
    first = create(name="team", url="https://hooks.example.com/secret-token", headers={"X-Token": "s3cret"}).json()
    second = create(name="ops", url="https://ops.example.com", method="GET").json()
    assert first["is_default"] and not second["is_default"]
    assert first["url_preview"] == "https://hooks.example.com/…" and first["header_names"] == ["X-Token"]
    assert "secret-token" not in str(_channels(client, path)) and "s3cret" not in str(_channels(client, path))

    assert create(name="bad", url="https://x.example.com", message_template="{{nope}}").status_code == 400
    assert create(name="bad", url="ftp://x.example.com").status_code == 400

    # Updating without a URL keeps the stored one
    response = client.put(f"/api/scheduler/notifications/{first['id']}", json={**path, "name": "team-2"})
    assert response.status_code == 200 and response.json()["url_preview"] == "https://hooks.example.com/…"

    client.post(f"/api/scheduler/notifications/{second['id']}/default", json=path)
    assert [c["is_default"] for c in _channels(client, path)] == [False, True]
    # Deleting the default makes the oldest remaining channel the default; jobs using it fall back to the default
    job = create_job(client, repo, name="notify-override", notification_channel_id=second["id"])
    assert job["notification_channel_id"] == second["id"]
    client.post(f"/api/scheduler/notifications/{second['id']}/delete", json=path)
    assert [(c["name"], c["is_default"]) for c in _channels(client, path)] == [("team-2", True)]
    jobs = {j["id"]: j for j in client.post("/api/scheduler/jobs/list", json=path).json()["jobs"]}
    assert jobs[job["id"]]["notification_channel_id"] is None
    assert create_job_status(client, repo, notification_channel_id=second["id"]) == 400
    client.post(f"/api/scheduler/jobs/{job['id']}/delete", json=path)
    _delete_channels(client, path)


def create_job_status(client, repo, **overrides):
    return client.post("/api/scheduler/jobs", json={**JOB, "path": str(repo["project"]), **overrides}).status_code


def test_failed_runs_notify_the_default_channel_or_the_jobs_own(client, repo, monkeypatch):
    import json as jsonlib
    from urllib.parse import parse_qs, urlsplit

    monkeypatch.setenv("STUB_FAIL", "1")
    path = {"path": str(repo["project"])}
    _delete_channels(client, path)
    receiver = _Receiver()
    try:
        from scheduler import config
        monkeypatch.setattr(config.settings, "ui_url", "http://dbt-ui.local")
        default = client.post("/api/scheduler/notifications", json={
            **path, "name": "telegram", "url": f"{receiver.url}/bot/sendMessage", "headers": {"X-Token": "abc"},
            "body_template": '{"chat_id": "42", "text": "{{message}}"}',
            "message_template": 'Job "{{job_name}}" {{status}}\n{{select}} full_refresh={{full_refresh}}\n{{run_url}}',
        }).json()
        own = client.post("/api/scheduler/notifications", json={
            **path, "name": "pager", "method": "GET", "url": f"{receiver.url}/get?text={{{{message}}}}&run={{{{run_id}}}}",
            "message_template": "{{job_name}} by {{author}} at {{run_at}}",
        }).json()

        job = create_job(client, repo, name='quote "me"', selector="orders", full_refresh=True)
        run = wait_for_run(client, client.post(f"/api/scheduler/jobs/{job['id']}/trigger", json=path).json()["run_id"])
        [sent] = receiver.wait(1)
        assert sent["method"] == "POST" and sent["path"] == "/bot/sendMessage" and sent["headers"]["X-Token"] == "abc"
        body = jsonlib.loads(sent["body"])
        assert body == {"chat_id": "42", "text": (
            f'Job "quote "me"" failed\norders full_refresh=true\nhttp://dbt-ui.local/?scheduler_run={run["id"]}'
        )}
        deadline = time.time() + 5
        while not client.get(f"/api/scheduler/runs/{run['id']}").json()["notified_at"] and time.time() < deadline:
            time.sleep(0.1)
        run = client.get(f"/api/scheduler/runs/{run['id']}").json()
        assert run["notification_channel"] == "telegram" and run["notification_error"] == ""

        # The job's own channel instead of the default
        fields = {**JOB, "path": path["path"], "name": job["name"], "selector": "orders", "full_refresh": True,
                  "notification_channel_id": own["id"]}
        assert client.put(f"/api/scheduler/jobs/{job['id']}", json=fields).status_code == 200
        run = wait_for_run(client, client.post(f"/api/scheduler/jobs/{job['id']}/trigger", json=path).json()["run_id"])
        sent = receiver.wait(2)[1]
        query = parse_qs(urlsplit(sent["path"]).query)
        assert sent["method"] == "GET" and query["run"] == [str(run["id"])]
        assert query["text"][0].startswith('quote "me" by alice at ')

        # Errors from the endpoint are recorded on the run; the test button reports them
        client.put(f"/api/scheduler/notifications/{default['id']}", json={
            **path, "name": "telegram", "url": f"{receiver.url}/fail", "body_template": "{}",
        })
        response = client.post(f"/api/scheduler/notifications/{default['id']}/test", json=path)
        assert response.status_code == 502 and "HTTP 500" in response.json()["detail"] and "bad chat" in response.json()["detail"]
        response = client.post(f"/api/scheduler/notifications/{own['id']}/test", json=path)
        assert response.status_code == 200 and response.json()["run_id"] == run["id"]
        client.post(f"/api/scheduler/jobs/{job['id']}/delete", json=path)
    finally:
        receiver.close()
        _delete_channels(client, path)
