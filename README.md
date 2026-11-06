# dbt UI

A modern web-based user interface for dbt-core projects.

**Documentation: https://dbt-ui.data-diving.com/**

<img width="1200" height="783" alt="dbt UI in action: editor, lineage, data preview, git, MetaDV and the scheduler's jobs, runs and memory timeline" src="docs/images/slideshow.webp" />


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
DBT_UI__GIT_REPOS_PATH=/path/to/your/repos docker compose up --build

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
| `DBT_UI__SCHEDULER_MAX_MEMORY` | - | Optional address-space cap per dbt process, e.g. `4g`. Some adapters reserve large virtual memory; remove the cap if dbt fails with `MemoryError` or `can't start new thread` |
| `DBT_UI__SCHEDULER_RETENTION_DAYS` | `30` | Days of run history and logs to keep |
| `DBT_UI__SCHEDULER_MANUAL_TIMEOUT` | `300` | Timeout in seconds for manual runs from the editor |
| `DBT_UI__SCHEDULER_MAX_CATCHUP_RUNS` | `100` | Most catch-up runs queued per job at a time; further missed slots follow in the next batch |
| `DBT_UI__FRONTEND_URL` | `http://localhost` in Docker | Address users open dbt UI at; failure notifications link to runs there (`{{run_url}}` is empty when it isn't set) |

### Volume Mount

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `DBT_UI__GIT_REPOS_PATH` | `./git-repos` | Mount for git repositories - both cloned from URLs and existing local repos |

Set `DBT_UI__GIT_REPOS_PATH` to point to your existing repos folder to work with local repositories.

Open your browser and navigate to `http://localhost`

The backend API is available at `http://localhost:8000`

## Architecture

This application consists of two parts:
- **Frontend**: React + TypeScript web application (Vite) - served via nginx
- **Backend**: FastAPI Python server for file system operations, git and dbt commands, and the optional scheduler (run data in SQLite or Postgres)

The scheduler runs dbt inside the backend container. dbt only sends SQL to your warehouse and waits for it, so it needs little CPU or memory; the backend still protects itself by running dbt as a separate process with lowered CPU priority, making it the first target of the out-of-memory killer, and optionally capping its memory. Run data tables are created or upgraded automatically on startup.

> [!WARNING]
> **WITH DUCKDB, SQLITE AND OTHER IN-PROCESS DATABASES, ALL DATA IS PROCESSED INSIDE THE DBT UI BACKEND CONTAINER.** The database engine runs inside the dbt process, so every scheduled and manual run uses the backend container's CPU, memory and disk. This can significantly slow down or destabilise dbt UI for all users. Use the scheduler with remote warehouses (Postgres, Snowflake, BigQuery, Redshift, Databricks and similar), or give the container enough memory and limit parallel runs with `DBT_UI__SCHEDULER_MAX_CONCURRENT`. Don't use `DBT_UI__SCHEDULER_MAX_MEMORY` as a memory budget: it caps the address space dbt reserves, which is several times what it uses, so values below a few GB make runs fail at random (`can't start new thread`).

## Features

- **Project Browser**: Browse your dbt project structure with an intuitive tree view. Each user works on their own branch in a separate git worktree on the server (hover the question mark next to the branch name to see its path); switching to another project asks for confirmation first
- **Code Editor**: Edit SQL models, YML configurations, tests, and macros with Monaco Editor
- **Lineage Graph**: Visualize model dependencies and data lineage
- **Quick Actions**: Run, test, seed and compile models from the lineage panel, and manage your project
- **Local File Access**: No file uploads - backend reads files directly from your filesystem
- **Git Integration**: View modified files, stage changes, commit, push/pull, and switch branches
- **MetaDV**: Visual Data Vault modeling - map source columns to entities and generate Data Vault 2.0 models using [metadv](https://pypi.org/project/metadv/) package
- **Scheduler** (optional, on in `docker-compose.yml`): Schedule dbt runs on cron, catch up missed runs, rerun failures, get failure notifications and review run history on a timeline. See the [documentation](https://dbt-ui.data-diving.com/scheduler/) for details

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
├── docs/               # Documentation site (Zensical, see mkdocs.yml)
├── screenshots/        # Generates the docs screenshots from a demo stack
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
| monaco-editor | MIT | ^0.55.1 | https://github.com/microsoft/monaco-editor |
| react | MIT | ^18.2.0 | https://github.com/facebook/react |
| react-dom | MIT | ^18.2.0 | https://github.com/facebook/react |
| react-markdown | MIT | ^9.0.1 | https://github.com/remarkjs/react-markdown |
| react-split-pane | MIT | ^3.0.4 | https://github.com/tomkp/react-split-pane |
| reactflow | MIT | ^11.11.4 | https://github.com/xyflow/xyflow |
| typescript | Apache-2.0 | ^5.2.2 | https://github.com/microsoft/TypeScript |
| vite | MIT | ^5.0.8 | https://github.com/vitejs/vite |
| eslint | MIT | ^8.55.0 | https://github.com/eslint/eslint |

#### Backend (PyPI)

| Package | License | Version | Repository |
|---------|---------|---------|------------|
| fastapi | MIT | 0.162.0 | https://github.com/tiangolo/fastapi |
| uvicorn | BSD-3-Clause | 0.54.0 | https://github.com/encode/uvicorn |
| pydantic | MIT | 2.14.2 | https://github.com/pydantic/pydantic |
| python-multipart | Apache-2.0 | 0.0.33 | https://github.com/Kludex/python-multipart |
| pyyaml | MIT | >=6.0 | https://github.com/yaml/pyyaml |
| packaging | Apache-2.0 | >=23.0 | https://github.com/pypa/packaging |
| metadv | MIT | >=0.1.0 | https://github.com/data-diving/metadv |
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
