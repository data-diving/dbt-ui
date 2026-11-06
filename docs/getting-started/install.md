# Install with Docker

dbt UI runs as two containers: the **frontend** (the web app, served by nginx on port 80) and the **backend** (a Python API that works with files, git and dbt, and runs the scheduler, on port 8000).

## Requirements

- Docker with Docker Compose
- Network access from the server to your git remote and your data warehouse

## Start dbt UI

```bash
# Get dbt UI
git clone https://github.com/data-diving/dbt-ui.git
cd dbt-ui

# Create an encryption key for the scheduler (once; kept in .env, which git ignores)
echo "DBT_UI__SCHEDULER_ENCRYPTION_KEY=$(openssl rand -base64 32 | tr '+/' '-_')" >> .env

# Build and start
docker compose up --build
```

Open <http://localhost> in your browser. The backend API is published at <http://localhost:8000> on the server itself only; browsers reach it through the frontend's `/api/` path.

!!! warning "Keep the encryption key"
    Credentials stored with scheduled jobs are encrypted with `DBT_UI__SCHEDULER_ENCRYPTION_KEY`. If you lose or change the key, those credentials can't be decrypted and the jobs need their credentials saved again. Docker Compose refuses to start without the key.

## Choose a setup

=== "With the scheduler (default)"

    ```bash
    docker compose up --build
    ```

    Uses `docker-compose.yml`. The [scheduler](../scheduler/index.md) is on, and run history is kept in a SQLite database in the `dbtui-data` Docker volume.

=== "Without the scheduler"

    ```bash
    docker compose -f docker-compose-without-scheduler.yml up --build
    ```

    No encryption key needed. Runs from the editor work as usual, with the same timeout (`DBT_UI__SCHEDULER_MANUAL_TIMEOUT`), but aren't recorded.

=== "Use repositories already on the server"

    ```bash
    DBT_UI__GIT_REPOS_PATH=/path/to/your/repos docker compose up --build
    ```

    By default dbt UI keeps repositories in `./git-repos`. Point `DBT_UI__GIT_REPOS_PATH` at a folder with your existing git repositories to open them directly.

## Protect it with a password

By default anyone who can reach the server can use dbt UI. To require a login, set a user name and password, e.g. in `.env`:

```bash
DBT_UI__BACKEND_USER=dbt
DBT_UI__BACKEND_PASSWORD=choose-a-strong-password
```

Everyone signs in with the same credentials: dbt UI has no individual accounts or roles (see [Administration](../admin/index.md)).

## Run it on a server

When users open dbt UI at an address other than `http://localhost`, set that address so links in the scheduler's failure notifications point to the right place:

```bash
DBT_UI__FRONTEND_URL=https://dbt-ui.example.com
```

All settings are listed in the [configuration reference](../admin/configuration.md). For memory and parallel runs, see [Sizing memory and concurrency](../admin/sizing.md).

## Next

[Open your first project :octicons-arrow-right-24:](first-project.md)
