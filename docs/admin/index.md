# Administration

This section is for whoever runs dbt UI for a team: how it is deployed, how to configure, size, secure, upgrade and back it up, and what to do when something goes wrong. To install it, start with [Install with Docker](../getting-started/install.md).

## How dbt UI is deployed

dbt UI runs as two containers:

```text
browser ──► frontend (nginx, port 80) ──/api/──► backend (FastAPI, port 8000) ──► git remotes
                                                     │                          ──► your warehouse
                                                     └─ dbt processes
```

**Frontend.** nginx serves the web app and forwards every request under `/api/` to the backend. Users only ever talk to the frontend.

**Backend.** A Python API that reads and writes project files, runs git and dbt, and runs the [scheduler](../scheduler/index.md). Every dbt command runs here as a separate process, using the project's own Python environment (`.dbt-ui-venv`), which dbt UI builds with dbt-core and the packages listed in the project's `requirements.txt`, such as the adapter.

**Storage** on the backend:

| What | Where (Docker) | Contents |
|---|---|---|
| Repositories | host folder `./git-repos` (`DBT_UI__GIT_REPOS_PATH`), mounted at `/home/dbtui/git-repos` | Repositories cloned or opened in dbt UI, every user's personal worktree with its branch and uncommitted changes, and their Python environments |
| Scheduler data | Docker volume `dbtui-data`, mounted at `/home/dbtui/data` | SQLite database with jobs and run history (unless you use [Postgres](postgres.md)), run logs, a checkout of each job's repository |
| Encryption key | `.env` next to the compose file | `DBT_UI__SCHEDULER_ENCRYPTION_KEY`, needed to decrypt credentials stored with jobs |

There is one backend: the scheduler runs inside it, so don't run several backends against the same scheduler data.

## Access

!!! warning "No roles: everyone can do everything"
    dbt UI currently has no role model and no individual accounts. **Every user who can open dbt UI has access to all features, all projects on the server, and all scheduler jobs, settings, credentials and notification channels**, whoever created them.

    The only access control is an optional shared login, `DBT_UI__BACKEND_USER` and `DBT_UI__BACKEND_PASSWORD` (HTTP Basic, one account for everyone). Without it, anyone who can reach the server can use dbt UI.

Each user does get their own workspace: a branch and a git worktree per repository, so people don't overwrite each other's files. That separates work, not permissions: anyone can open any project on the server.

Because dbt and project code run in the backend, access to dbt UI amounts to running code on the server. See [Security](security.md) for what that means and how to limit who gets in.

## Where to go next

- [Configuration reference](configuration.md): every environment variable, volume and port
- [Run data in Postgres](postgres.md): keep jobs and run history in Postgres instead of SQLite
- [Sizing memory and concurrency](sizing.md): container memory, parallel runs, and why not to use `DBT_UI__SCHEDULER_MAX_MEMORY`
- [Security](security.md): login, HTTPS, the encryption key, credentials, patching
- [Upgrades and backups](upgrades.md): what to back up and how to upgrade
- [Troubleshooting](troubleshooting.md): common errors and their fixes
