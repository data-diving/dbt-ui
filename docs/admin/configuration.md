# Configuration reference

dbt UI is configured with environment variables. With Docker Compose, put them in a `.env` file next to `docker-compose.yml` (Compose reads it automatically) or set them in the shell that runs `docker compose`.

```bash title=".env"
DBT_UI__SCHEDULER_ENCRYPTION_KEY=...
DBT_UI__BACKEND_USER=dbt
DBT_UI__BACKEND_PASSWORD=choose-a-strong-password
DBT_UI__FRONTEND_URL=https://dbt-ui.example.com
```

After changing a value, recreate the containers with `docker compose up -d`. Settings marked **build time** are baked into the frontend bundle and need a rebuild: `docker compose up -d --build`.

!!! note "Only the variables listed in the compose file reach the containers"
    `docker-compose.yml` passes each variable below to the containers explicitly. A variable that is not listed there (for example `DBT_THREADS`, or the advanced scheduler settings at the end of this page) has no effect when you put it in `.env`. Add it under the service's `environment:` instead, e.g. in a `docker-compose.override.yml`, which Docker Compose merges automatically:

    ```yaml title="docker-compose.override.yml"
    services:
      backend:
        environment:
          DBT_THREADS: "4"
    ```

## Access and URLs

| Variable | Default | Read by | Effect |
|---|---|---|---|
| `DBT_UI__BACKEND_USER` | empty | backend | User name of the shared login. Login is on only when both user and password are set. See [Security](security.md). |
| `DBT_UI__BACKEND_PASSWORD` | empty | backend | Password of the shared login. |
| `DBT_UI__FRONTEND_URL` | `http://localhost` in the compose files; unset otherwise | backend | The address users open dbt UI at. Added to the backend's allowed CORS origins, and used for links to runs in [failure notifications](../scheduler/notifications.md) (`{{run_url}}` is empty when it isn't set). Set it whenever dbt UI is not opened at `http://localhost`. |
| `DBT_UI__BACKEND_URL` | `http://backend:8000` | frontend (nginx), at container start | Where the frontend's nginx forwards `/api/` requests. Change it only if the backend runs under another name or address. |
| `DBT_UI__BACKEND_GIT_CREDS_COOKIE_MAX_AGE` | `2592000` (30 days) | backend | Lifetime in seconds of the browser cookie that remembers a user's git credentials for a repository. |

The backend always allows `localhost` and `127.0.0.1` on ports 80, 3000, 5173 and 8080 as CORS origins, for Docker and local development.

## Features

| Variable | Default | Read by | Effect |
|---|---|---|---|
| `DBT_UI__METADV_ENABLED` | `true` | backend | Turns [MetaDV](../using/metadv.md) on or off. `true`, `1` or `yes` mean on. When off, the MetaDV API is not loaded and the frontend hides MetaDV. Read at runtime: recreating the containers is enough, no rebuild needed. |
| `DBT_UI__FRONTEND_LINEAGE_MAX_NODES` | `200` | frontend, **build time** | Most nodes the [lineage graph](../using/lineage.md) draws. Larger graphs are cut to this many nodes with a hint to reduce the upstream/downstream depth. |

## Repositories

| Variable | Default | Read by | Effect |
|---|---|---|---|
| `DBT_UI__GIT_REPOS_PATH` | `./git-repos` | Docker Compose | Folder **on the host** that is mounted into the backend container at `/home/dbtui/git-repos`. Repositories cloned in dbt UI are stored there, and existing repositories in it can be opened directly. |
| `GIT_REPOS_PATH` | `~/git-repos` | backend | Folder **inside the backend** where repositories are cloned to. Not set by the compose files: in the container `~` is `/home/dbtui`, so the default is exactly the mounted folder. Only useful when running the backend without Docker. |

Users' personal workspaces (git worktrees) are created in a `worktrees` folder next to the repository, so with the default setup they live in the host folder as well. See [Upgrades and backups](upgrades.md).

## Scheduler

These are read by the backend only. `docker-compose-without-scheduler.yml` sets only `DBT_UI__SCHEDULER_MANUAL_TIMEOUT`, so the scheduler is off there.

| Variable | Default | Effect |
|---|---|---|
| `DBT_UI__SCHEDULER_ENABLED` | `false` (`true` in `docker-compose.yml`) | Turns the [scheduler](../scheduler/index.md) on. When on, manual runs from the editor are also executed and recorded by it. |
| `DBT_UI__SCHEDULER_ENCRYPTION_KEY` | none; **required** | Fernet key that encrypts credentials stored with jobs, project credentials and notification channel URLs and headers. `docker compose up` refuses to start without it. See [Security](security.md#the-encryption-key). |
| `DBT_UI__SCHEDULER_DATA_DIR` | `~/.dbt-ui`; `/home/dbtui/data` in Docker (not configurable through compose) | Where the SQLite database, run logs (`runs/`) and job checkouts (`checkouts/`) are stored. In Docker this is the `dbtui-data` volume. |
| `DBT_UI__SCHEDULER_DB_URL` | `sqlite:///<data dir>/dbt-ui.db` | Database for jobs and run history. See [Run data in Postgres](postgres.md). |
| `DBT_UI__SCHEDULER_MAX_CONCURRENT` | `2` | Most dbt runs executing at the same time, scheduled and manual combined. Further runs wait in a queue. Minimum 1. See [Sizing](sizing.md). |
| `DBT_UI__SCHEDULER_MAX_MEMORY` | empty (no cap) | Address-space cap per dbt process, e.g. `4g`. **Not** a RAM limit: small values make runs fail at random. Leave it empty unless you have read [Sizing](sizing.md#dbt_ui__scheduler_max_memory-is-not-a-ram-limit). Accepts a number of bytes or a number with `k`, `m`, `g` or `t`. |
| `DBT_UI__SCHEDULER_RETENTION_DAYS` | `30` | Days of run history and logs to keep. Older runs are deleted, rows and log files. |
| `DBT_UI__SCHEDULER_MANUAL_TIMEOUT` | `300` | Timeout in seconds for manual runs started from the editor, with or without the scheduler. Scheduled jobs have their own timeout per job. |
| `DBT_UI__SCHEDULER_MAX_CATCHUP_RUNS` | `100` | Most [catch-up runs](../scheduler/catch-up.md) queued per job at a time; further missed slots follow in the next batch. |

Invalid integers are ignored with a message in the backend log, and the default is used. An invalid encryption key or `DBT_UI__SCHEDULER_MAX_MEMORY` value stops the scheduler from starting: the reason is shown in the scheduler button's tooltip and in the backend log (`[scheduler] Not started: ...`).

Without the scheduler, manual runs are not limited in number; they still time out after `DBT_UI__SCHEDULER_MANUAL_TIMEOUT`.

### Advanced

Not listed in the compose files; add them under `environment:` if you need them.

| Variable | Default | Effect |
|---|---|---|
| `DBT_UI__SCHEDULER_TICK_SECONDS` | `15` | How often the scheduler checks for due jobs. |
| `DBT_UI__SCHEDULER_CATCHUP_SCAN_SECONDS` | `600` | How often the scheduler looks for missed slots in the run history. |

## Other variables

| Variable | Where | Effect |
|---|---|---|
| `PYTHONUNBUFFERED` | set to `1` by the compose files | Python writes log lines immediately, so `docker compose logs` is up to date. |
| `DBT_THREADS` and other dbt variables | backend container | dbt processes inherit the backend's environment, except dbt UI's own settings (`DBT_UI__*`), so dbt's own environment variables apply to every run. See [Sizing](sizing.md#threads). |

### Frontend development (build time)

Only for building the frontend yourself. `docker/Dockerfile.frontend` sets `VITE_API_URL` to empty and the others are not used in Docker.

| Variable | Default | Effect |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` | Backend address the browser calls. Empty means relative URLs (`/api/...`), as used behind the bundled nginx. |
| `VITE_API_USER`, `VITE_API_PASSWORD` | empty | Send this login with every API request. They end up in the JavaScript bundle in plain text, readable by anyone who can load the page: use them for local development only. |

## Volumes and ports

| Mount or port | Service | Contents |
|---|---|---|
| `${DBT_UI__GIT_REPOS_PATH:-./git-repos}` → `/home/dbtui/git-repos` | backend | Repositories, users' worktrees, and each worktree's Python environment (`.dbt-ui-venv`). |
| `dbtui-data` volume → `/home/dbtui/data` | backend (scheduler only) | SQLite database, run logs, job checkouts and their Python environments. |
| `80:80` | frontend | The web app. `/api/` is forwarded to the backend. |
| `127.0.0.1:8000:8000` | backend | The API, published for local access on the host only. Browsers don't need it: they use the frontend's `/api/` path. See [Security](security.md#network-exposure). |

The containers run as user `dbtui` (uid 1000). A host folder used for `DBT_UI__GIT_REPOS_PATH` must be writable by uid 1000.
