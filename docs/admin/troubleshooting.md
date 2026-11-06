# Troubleshooting

Most problems show up in the backend log:

```bash
docker compose logs -f backend
```

Scheduler messages start with `[scheduler]`. For a single run, open it in [Runs](../scheduler/runs.md) to see its full dbt log.

## Runs fail with "can't start new thread" or MemoryError

Runs fail at random, sometimes the same command succeeds on retry, with errors like:

```text
RuntimeError: can't start new thread
AttributeError: 'DummyProcess' object has no attribute 'terminate'
MemoryError
```

**Cause:** `DBT_UI__SCHEDULER_MAX_MEMORY` is set too low. It caps the address space each dbt process may *reserve*, which is several times the memory it actually uses, so a cap that looks generous compared with the run's peak memory still breaks it. The `DummyProcess` error is a Python cleanup bug that hides the real one.

**Fix:** remove `DBT_UI__SCHEDULER_MAX_MEMORY` (or set it to several GB) and limit the container's memory instead. See [Sizing memory and concurrency](sizing.md#dbt_ui__scheduler_max_memory-is-not-a-ram-limit).

## "dbt was killed by the system, most likely out of memory"

The kernel stopped the dbt process because the backend container ran out of memory. dbt runs are deliberately the first to go, so dbt UI itself keeps working.

**Fix:** compare the run's peak memory and the container's `memory.peak` with its limit, then give the container more memory or lower `DBT_UI__SCHEDULER_MAX_CONCURRENT`. With DuckDB and other in-process databases, the data itself is processed in the container. See [Sizing](sizing.md#reading-real-memory-use).

## "dbt run timed out after ... (DBT_UI__SCHEDULER_MANUAL_TIMEOUT)" { #dbt-run-timed-out }

Runs started from the editor (Run, Test, Seed, Compile) stop after `DBT_UI__SCHEDULER_MANUAL_TIMEOUT` seconds, 300 by default. The message names the limit, e.g. *dbt run timed out after 5 minutes (DBT_UI__SCHEDULER_MANUAL_TIMEOUT)*.

**Fix:** raise the timeout, e.g. to 30 minutes, in `.env`, then `docker compose up -d`:

```bash
DBT_UI__SCHEDULER_MANUAL_TIMEOUT=1800
```

This works with and without the scheduler. With the scheduler, time a run spends waiting in the queue doesn't count.

Other timeouts:

- **Scheduled jobs** have their own timeout per job (1 hour by default); a run that hits it fails with *Timed out after ...s*. Change it in the [job's settings](../scheduler/jobs.md).
- **Show data** previews stop after 2 minutes (*Query timed out after 2 minutes*). This limit is fixed.

## env_var() values are not picked up

dbt fails with `Env var required but not provided`, or uses a default instead of your value. Check:

- **Values belong to your browser.** Values set in the env vars dialog are stored in a cookie in your browser, per project. Another browser, another computer or a colleague doesn't have them, and clearing cookies removes them. Set them again there.
- **Only `env_var('NAME')` calls in `.sql`, `.yml` and `.yaml` files are found.** The dialog lists every call with a quoted variable name in the project (hidden folders, `target`, `dbt_packages` and `logs` are skipped). A variable whose name isn't a quoted string, or that is used only in a file with another extension, isn't listed.
- **An empty field means "unset".** If you leave a field empty, dbt uses the default from `env_var('NAME', 'default')`, or fails if there is none.
- **dbt UI's own settings aren't available.** `DBT_UI__*` variables are never passed to dbt, so `env_var('DBT_UI__…')` returns nothing.
- **Scheduled jobs don't read your browser.** A job uses the values saved with it (a snapshot of its owner's values, or the project credentials). After changing values, save the job again or update the project credentials. See [Credentials](../scheduler/credentials.md).

More in [Env vars](../using/env-vars.md).

## Favicon or other files missing behind a proxy

The browser tab shows no icon, or `/favicon.ico`, `/icon.svg` or `/apple-touch-icon.png` return an HTML page or an error.

The frontend's nginx (`docker/nginx.conf`) serves any path with a file extension as a file, and returns a real 404 when it doesn't exist; all other paths get the web app. Check:

1. **The frontend serves it directly:**

    ```bash
    curl -I http://localhost/favicon.ico   # on the dbt UI host
    ```

    It should return `200` with `Content-Type: image/x-icon` (or similar). If it returns `text/html`, the frontend image is older than this nginx configuration: rebuild it with `docker compose up -d --build`.

2. **The proxy passes it through:** run the same `curl -I` against your public address. A reverse proxy in front of dbt UI must forward all paths to the frontend, including files at the root such as `/favicon.ico`, not only `/` and `/api/`. Some proxies or hosting setups answer `/favicon.ico` themselves.

3. Browsers cache icons for a long time: check in a private window.

## The scheduler is unavailable

The scheduler button is greyed out, and its tooltip says *Scheduler unavailable* with a reason. The backend log says why:

| Log message | Fix |
|---|---|
| `[scheduler] Not started: DBT_UI__SCHEDULER_ENCRYPTION_KEY is not set` | Set the key (see [Install](../getting-started/install.md)). |
| `[scheduler] Not started: DBT_UI__SCHEDULER_ENCRYPTION_KEY is not a valid Fernet key` | The key must be 32 bytes, URL-safe base64-encoded. Create one as shown in [Install](../getting-started/install.md); if you had a working key before, restore it instead. |
| `[scheduler] Not started: Invalid memory size: ...` | Fix or remove `DBT_UI__SCHEDULER_MAX_MEMORY`. |
| `[scheduler] Scheduler database unavailable: ... Retrying in 15s` | The database can't be reached. Check `DBT_UI__SCHEDULER_DB_URL` and the database; see [Run data in Postgres](postgres.md). |

After fixing a *Not started* problem, restart the backend: `docker compose up -d`.

If the tooltip says *Scheduler is disabled*, the backend runs without the scheduler: you started `docker-compose-without-scheduler.yml`, or `DBT_UI__SCHEDULER_ENABLED` isn't `true`.

## "Stored credentials cannot be decrypted"

Runs of a job fail with *Stored credentials cannot be decrypted. Was DBT_UI__SCHEDULER_ENCRYPTION_KEY changed?* The encryption key is not the one the credentials were saved with. Restore the original key, or save the credentials again: edit and save the job, the project credentials and the notification channels. See [Security](security.md#the-encryption-key).

## Docker Compose refuses to start

```text
error while interpolating services.backend.environment.DBT_UI__SCHEDULER_ENCRYPTION_KEY: required variable DBT_UI__SCHEDULER_ENCRYPTION_KEY is missing a value: Set DBT_UI__SCHEDULER_ENCRYPTION_KEY (see the comment at the top of this file)
```

`docker-compose.yml` needs the encryption key. Create it as shown in [Install](../getting-started/install.md), in `.env` next to `docker-compose.yml`, or run `docker compose -f docker-compose-without-scheduler.yml up` instead.

## "No such file or directory: …/.dbt-ui-venv/bin/dbt"

The workspace's Python environment can't run: the Python it was built with is gone or was replaced by another version. dbt UI shows such environments as missing, so **Create virtual environment** glows in the sidebar; click it to rebuild the environment. This can happen once after upgrading from a version of dbt UI that kept downloaded Python versions inside the container; they are now kept in the repositories folder (hidden `.dbt-ui/python`) and survive upgrades.

## Permission denied in the repositories folder

Cloning or opening a project fails with *Permission denied*. The backend runs as uid 1000, so the host folder mounted with `DBT_UI__GIT_REPOS_PATH` (default `./git-repos`) must be writable by uid 1000:

```bash
sudo chown -R 1000:1000 ./git-repos
```
