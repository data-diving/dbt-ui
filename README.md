# dbt UI

A modern web-based user interface for dbt-core projects.

<img width="3200" height="2000" alt="dbt UI with the jaffle_shop_duckdb project: file tree, data preview, model properties and lineage graph" src="docs/images/screenshot.png" />


## Quick Start with Docker

The easiest way to run dbt UI is using Docker:

```bash
# Clone the repository
git clone https://github.com/data-diving/dbt-ui.git
cd dbt-ui

# Create an encryption key for the scheduler (once; kept in .env, which git ignores)
echo "DBT_UI__SCHEDULER_ENCRYPTION_KEY=$(openssl rand -base64 32 | tr '+/' '-_')" >> .env

# Run with Docker Compose
docker compose up --build

# Or use existing git repositories from your computer
GIT_REPOS_PATH=/path/to/your/repos docker compose up --build

# Or run without the scheduler (no encryption key needed)
docker compose -f docker-compose-without-scheduler.yml up --build
```

`docker-compose.yml` enables the scheduler and requires `DBT_UI__SCHEDULER_ENCRYPTION_KEY`; Docker Compose refuses to start without it. Keep the key: credentials stored with scheduled jobs cannot be decrypted without it. `docker-compose-without-scheduler.yml` runs dbt UI without the scheduler; keep the two files in sync when changing shared settings.

Scheduler settings (environment variables, e.g. in `.env`):

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `DBT_UI__SCHEDULER_ENABLED` | `false` (`true` in `docker-compose.yml`) | Enable the scheduler |
| `DBT_UI__SCHEDULER_ENCRYPTION_KEY` | - | Required. Fernet key for stored credentials |
| `DBT_UI__SCHEDULER_DB_URL` | `sqlite:///<data dir>/dbt-ui.db` | Run data database. Postgres: `postgresql://user:password@host:5432/dbname` (connected through pg8000) |
| `DBT_UI__SCHEDULER_DATA_DIR` | `~/.dbt-ui` (`/home/dbtui/data` in Docker) | SQLite file, run logs and job checkouts |
| `DBT_UI__SCHEDULER_MAX_CONCURRENT` | `2` | dbt runs executing at the same time, scheduled and manual combined; further runs wait in a queue |
| `DBT_UI__SCHEDULER_MAX_MEMORY` | - | Optional address-space cap per dbt process, e.g. `4g`. Some adapters reserve large virtual memory; remove the cap if dbt fails with `MemoryError` |
| `DBT_UI__SCHEDULER_RETENTION_DAYS` | `30` | Days of run history and logs to keep |
| `DBT_UI__SCHEDULER_MANUAL_TIMEOUT` | `300` | Timeout in seconds for manual runs from the editor |
| `DBT_UI__SCHEDULER_MAX_CATCHUP_RUNS` | `100` | Most catch-up runs queued per job at a time; further missed slots follow in the next batch |
| `DBT_UI__FRONTEND_URL` | `http://localhost` in Docker | Address users open dbt UI at; failure notifications link to runs there (`{{run_url}}` is empty when it isn't set) |

### Volume Mount

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `GIT_REPOS_PATH` | `./git-repos` | Mount for git repositories - both cloned from URLs and existing local repos |

Set `GIT_REPOS_PATH` to point to your existing repos folder to work with local repositories.

Open your browser and navigate to `http://localhost`

The backend API is available at `http://localhost:8000`

## Architecture

This application consists of two parts:
- **Frontend**: React + TypeScript web application (Vite) - served via nginx
- **Backend**: FastAPI Python server for file system operations, git and dbt commands, and the optional scheduler (run data in SQLite or Postgres)

The scheduler runs dbt inside the backend container. dbt only sends SQL to your warehouse and waits for it, so it needs little CPU or memory; the backend still protects itself by running dbt as a separate process with lowered CPU priority, making it the first target of the out-of-memory killer, and optionally capping its memory. Run data tables are created or upgraded automatically on startup.

> [!WARNING]
> **WITH DUCKDB, SQLITE AND OTHER IN-PROCESS DATABASES, ALL DATA IS PROCESSED INSIDE THE DBT UI BACKEND CONTAINER.** The database engine runs inside the dbt process, so every scheduled and manual run uses the backend container's CPU, memory and disk. This can significantly slow down or destabilise dbt UI for all users. Use the scheduler with remote warehouses (Postgres, Snowflake, BigQuery, Redshift, Databricks and similar), or set `DBT_UI__SCHEDULER_MAX_MEMORY` and give the container enough resources.

## Features

- **Project Browser**: Browse your dbt project structure with an intuitive tree view. Each user works on their own branch in a separate git worktree on the server (hover the question mark next to the branch name to see its path); switching to another project asks for confirmation first
- **Code Editor**: Edit SQL models, YML configurations, tests, and macros with Monaco Editor
- **Lineage Graph**: Visualize model dependencies and data lineage
- **Quick Actions**: Run, test, seed and compile models from the lineage panel, and manage your project
- **Local File Access**: No file uploads - backend reads files directly from your filesystem
- **Git Integration**: View modified files, stage changes, commit, push/pull, and switch branches
- **MetaDV**: Visual Data Vault modeling - map source columns to entities and generate Data Vault 2.0 models using [metadv](https://pypi.org/project/metadv/) package
- **Scheduler** (optional, on in `docker-compose.yml`): Schedule dbt runs on cron and review their history. Open it with the clock button in the sidebar toolbar and return to the files and editor with the tree button next to it; while it is open, the sidebar switches between jobs, runs and settings instead of showing your file tree. All schedules and timestamps are UTC.
  - **Jobs**: run a job now, pause or resume its schedule (with confirmation), edit or delete it. Paused jobs are labelled next to their cron expression. A new or resumed job first runs at the next scheduled time; use Run now to start one immediately. Each active job's next run is listed as a scheduled run; skipping it cancels that run, and the job's following time becomes its next run.
  - **Missed slots**: every slot of a job gets a run. Slots missed while dbt UI was stopped or its host was asleep are caught up with one run per slot, oldest first, one after another; the run history since the job was created or its schedule changed is checked as well, so older gaps are filled too. A job can instead catch up only the latest missed slot, or none. Slots that are not run, including every slot while a job is paused, are recorded as skipped runs.
  - **dbt vars**: every job run passes the cron slot it is for to dbt as `--vars`: `dbt_ui_run_timestamp` (Unix seconds), `dbt_ui_run_datetime` (e.g. `2026-10-13T04:15:00Z`) and `dbt_ui_cron`. Catch-up runs and reruns get the original run's vars. Manual runs from the editor don't pass them, so give a default in models, e.g. `{{ var('dbt_ui_run_datetime', run_started_at.strftime('%Y-%m-%dT%H:%M:%SZ')) }}`.
  - **Code source**: jobs always run the repository's default branch, never uncommitted or unpushed work. By default the latest commit is fetched before each run; alternatively a job can be pinned to a fixed commit. Each job gets its own checkout and virtual environment, rebuilt only when `requirements.txt`, `require-dbt-version` or package files change.
  - **Credentials**: a job uses either a snapshot of its creator's env vars (default) or the project credentials managed in the scheduler's Settings. Both are stored encrypted; only variable names are ever shown. For private HTTPS remotes, the creator's saved git credentials are stored with the job to fetch the latest commit.
  - **Failure notifications**: in Settings, add notification channels: simple GET or POST requests to the Telegram bot API or any HTTP(S) webhook. The first channel becomes the project's default; each job can send to another channel instead. Each channel has a message template with placeholders such as `{{job_name}}`, `{{run_id}}`, `{{status}}`, `{{command}}`, `{{select}}`, `{{target}}`, `{{full_refresh}}`, `{{scheduled_for}}`, `{{run_at}}`, `{{author}}` and `{{run_url}}` (a link that opens the run in dbt UI, at the address set by `DBT_UI__FRONTEND_URL`), and the rendered message can go into the URL or body as `{{message}}`. Failed job runs are reported once; the run page shows whether the notification was sent. URLs and headers are stored encrypted; a test button sends a sample notification.
  - **Runs**: manual and scheduled runs for the last 15 minutes up to 30 days, sortable by any column, with the slot each run is for. Open a run for its log, node results, duration, peak memory and rows affected. Rerun job runs from the list or a run's page: the confirmation shows the parameters the run was started with (command, selector, target, full refresh, slot, dbt vars, commit), and the rerun repeats them on the original commit or the job's current code source. Filter runs by status (scheduled, running, succeeded, failed, skipped, or all); the Gantt chart follows the same filters. Select runs with the checkboxes to rerun or skip several at once; rerunning skipped runs this way also backfills their slots. Skip this run (in the list or on a run's page) records a run that hasn't finished as skipped, and its time is not caught up again: a scheduled run is cancelled, a queued run won't start, and a running run is stopped at once (dbt is killed) so queued runs can go ahead. Finished runs can't be skipped. Manual runs from the editor can't be rerun.
  - **Runs timeline**: the bottom panel switches between two views on a UTC time axis that keeps about 10% for the near future. *Scheduled for* is a Gantt chart with one row per job and each run placed at the time it was scheduled for, so gaps in the schedule stand out; catch-up runs and reruns note when they actually ran. *Actual run at* is a stacked area chart of the memory dbt runs used over the time they actually ran, one area per job, so its top edge is the scheduler's load on the server; jobs can be shown or hidden, and hovering an area shows the run behind it (click to open it). Scroll over the chart to change the time range (Shift + scroll moves the rows). For an opened run, it shows one row per node. It fits the panel width, scrolls vertically, follows the runs filters, and can be expanded to the full window (Esc to collapse). Click a run's bar to see its nodes.
  - **Rows affected**: taken from what dbt-core and the adapter report in the run results, so it may be missing for some adapters or operations (DuckDB reports it only for seeds).
  - **Manual runs**: when the scheduler is enabled, Run/Test/Seed/Compile from the editor are executed and recorded by it as well, in your worktree as before. They share the concurrency limit with scheduled runs and wait for a free slot when it is reached; the editor keeps waiting while a run is queued.

**Note**: Only git-based dbt projects are supported. The project must be a git repository.

## Want to Contribute?

Like `dbt-ui` and want to help make it even better? Check out our **[Contributing Guide](CONTRIBUTING.md)** to get started with discussions, issues, and pull requests. Your contributions help improve the experience for everyone!

## Project Structure

```
dbt-ui/
├── frontend/           # React frontend application
├── backend/            # FastAPI backend server
│   └── scheduler/      # Optional built-in scheduler
├── docker/             # Docker configuration
├── docs/images/        # README screenshots
├── docker-compose.yml                   # with the scheduler
├── docker-compose-without-scheduler.yml
└── README.md
```

## License and Attribution

This project is licensed under the [MIT License](LICENSE).

## Third-Party Software

This project uses open-source libraries under various permissive licenses (MIT, Apache-2.0, BSD-3-Clause, ISC).

When you install dependencies via `npm install` and `pip install` or build a Docker image their license files are placed in:
- **Frontend**: `node_modules/` (view with `npm ls`)
- **Backend**: Python site-packages (view with `pip list`)

For license texts and copyright information, check each package's GitHub repository

#### Frontend (npm)

| Package | License | Version | Repository |
|---------|---------|---------|------------|
| @monaco-editor/react | MIT | ^4.7.0 | https://github.com/suren-atoyan/monaco-react |
| dagre | MIT | ^0.8.5 | https://github.com/dagrejs/dagre |
| lucide-react | ISC | ^0.294.0 | https://github.com/lucide-icons/lucide |
| react | MIT | ^18.2.0 | https://github.com/facebook/react |
| react-dom | MIT | ^18.2.0 | https://github.com/facebook/react |
| react-split-pane | MIT | ^3.0.4 | https://github.com/tomkp/react-split-pane |
| reactflow | MIT | ^11.11.4 | https://github.com/xyflow/xyflow |
| typescript | Apache-2.0 | ^5.2.2 | https://github.com/microsoft/TypeScript |
| vite | MIT | ^5.0.8 | https://github.com/vitejs/vite |
| eslint | MIT | ^8.55.0 | https://github.com/eslint/eslint |

#### Backend (PyPI)

| Package | License | Version | Repository |
|---------|---------|---------|------------|
| fastapi | MIT | 0.109.0 | https://github.com/tiangolo/fastapi |
| uvicorn | BSD-3-Clause | 0.27.0 | https://github.com/encode/uvicorn |
| pydantic | MIT | 2.5.3 | https://github.com/pydantic/pydantic |
| python-multipart | Apache-2.0 | 0.0.6 | https://github.com/Kludex/python-multipart |
| pyyaml | MIT | >=6.0 | https://github.com/yaml/pyyaml |
| packaging | Apache-2.0 | >=23.0 | https://github.com/pypa/packaging |
| sqlalchemy | MIT | >=2.0 | https://github.com/sqlalchemy/sqlalchemy |
| alembic | MIT | >=1.13 | https://github.com/sqlalchemy/alembic |
| pg8000 | BSD-3-Clause | >=1.30 | https://codeberg.org/tlocke/pg8000 |
| cryptography | Apache-2.0 OR BSD-3-Clause | >=42.0 | https://github.com/pyca/cryptography |
| croniter | MIT | >=2.0 | https://github.com/pallets-eco/croniter |
| psutil | BSD-3-Clause | >=5.9 | https://github.com/giampaolo/psutil |

## Trademarks

- **dbt**, **dbt Core**, and **dbt Labs** are trademarks of [dbt Labs, Inc.](https://www.getdbt.com/)
- **Docker** and the Docker logo are trademarks or registered trademarks of [Docker, Inc.](https://www.docker.com/)

This project is not affiliated with, endorsed by, or sponsored by dbt Labs, Inc. or Docker, Inc.
