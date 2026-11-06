# Contributing

Thanks for your interest in dbt UI! Questions, ideas, bug reports and pull requests are all welcome.

## How to contribute

The process is described in [CONTRIBUTING.md](https://github.com/data-diving/dbt-ui/blob/main/CONTRIBUTING.md). In short:

1. Search [Discussions](https://github.com/data-diving/dbt-ui/discussions) and [Issues](https://github.com/data-diving/dbt-ui/issues) first.
2. Start a discussion for a new idea or a suspected bug.
3. Once it's agreed, an issue is opened from the issue template.
4. Send a pull request that links to the issue, with small commits that are easy to review.

## Architecture

```text
browser ──► frontend: nginx ──/api/──► backend: FastAPI ──► git, dbt (subprocesses)
            React + TypeScript          routes/, scheduler/
```

**Frontend** (`frontend/`): a React + TypeScript single-page app built with Vite. It uses Monaco for the code editor and React Flow with dagre for the lineage graph. In Docker, nginx serves the built app and forwards `/api/` to the backend (`docker/nginx.conf`).

**Backend** (`backend/`): a FastAPI app (`main.py`) with one router per area in `routes/`: files, git, dbt commands, Python environments, env vars, MetaDV and the scheduler. It works directly on repositories on the server's disk:

- each user works on their own branch in their own **git worktree** of a repository, created next to it in a `worktrees` folder;
- each worktree gets its own Python environment (`.dbt-ui-venv`, built with uv) with dbt-core and the project's `requirements.txt`;
- dbt runs as a subprocess with `--project-dir` and `--profiles-dir` both set to the project folder.

**Scheduler** (`backend/scheduler/`): runs in-process in the backend, started from FastAPI's lifespan when `DBT_UI__SCHEDULER_ENABLED=true`. A cron loop queues due runs; a run manager executes them as dbt subprocesses with a concurrency limit and safeguards (`executor.py`). Each job has its own checkout of the default branch. Run data lives in SQLite or Postgres through SQLAlchemy, with Alembic migrations in `scheduler/migrations/` applied on startup. When the scheduler is ready, manual runs from the editor go through it too (`delegate.py`).

## Run it locally

You can run everything with Docker (see [Install with Docker](getting-started/install.md)) and rebuild after changes with `docker compose up --build`. For a faster loop, run the two parts directly:

**Backend** (Python 3.11 or newer, [uv](https://docs.astral.sh/uv/), git):

```bash
cd backend
uv sync
uv run uvicorn main:app --reload --port 8000
```

Repositories are cloned to `~/git-repos` (set `GIT_REPOS_PATH` to change it). The scheduler is off unless you set `DBT_UI__SCHEDULER_ENABLED=true` and `DBT_UI__SCHEDULER_ENCRYPTION_KEY`; its data then goes to `~/.dbt-ui`. Some dbt safeguards (out-of-memory priority, memory cap) only apply on Linux. See the [configuration reference](admin/configuration.md) for all variables.

**Frontend** (Node.js):

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. The dev server calls the backend at `http://localhost:8000` (`VITE_API_URL`).

More details are in `backend/README.md` and `frontend/README.md` in the repository.

## Tests and checks

Backend tests use pytest and live in `backend/tests`. The scheduler tests use a stub `dbt` executable (`tests/stub_dbt.py`), so they need no warehouse or network:

```bash
cd backend
uv run pytest tests

# Also against Postgres (tables are created in the given database)
DBT_UI_TEST_PG_URL=postgresql://user:password@localhost:5432/dbtui uv run pytest tests
```

The frontend has no automated tests yet; check types and lint before sending a change:

```bash
cd frontend
npm run typecheck
npm run lint
```

## Documentation

This site is built with [Zensical](https://zensical.org/) from `docs/` and `mkdocs.yml`. To preview it:

```bash
pip install -r docs/requirements.txt
zensical serve
```

Pull requests that touch the docs are checked with `zensical build --strict`, which fails on broken links.

### Screenshots

The screenshots and the animated slideshow on the home page are generated from a demo dbt UI by `screenshots/run.sh` (Docker and Node.js needed). It starts a separate dbt UI on <http://localhost:8180> with the jaffle_shop_duckdb project, demo jobs and a day of run history, takes the screenshots with Playwright, frames them in a browser window and saves them to `docs/images/`. Your own dbt UI and its data aren't touched.

```bash
screenshots/run.sh          # everything
screenshots/run.sh shoot    # retake the screenshots (demo still running)
screenshots/run.sh down     # remove the demo
```

Run it after visible UI changes and commit the updated images. See `screenshots/README.md` for details.
