# Upgrades and backups

## What to back up

| What | Where | Why |
|---|---|---|
| Encryption key | `DBT_UI__SCHEDULER_ENCRYPTION_KEY` in `.env` | Without it, credentials stored with jobs, project credentials and notification channels can't be decrypted. Keep a copy somewhere safe, e.g. a password manager. |
| Scheduler data | `dbtui-data` Docker volume (`/home/dbtui/data`) | The SQLite database (jobs, run history, stored credentials, notification channels), run logs, and job checkouts. Checkouts are recreated automatically, so they are optional. |
| Postgres | your database, if you [use Postgres](postgres.md) | Jobs and run history instead of the SQLite file. |
| Repositories | `./git-repos`, or the folder in `DBT_UI__GIT_REPOS_PATH` | Users' worktrees hold **uncommitted and unpushed work**. Everything that is pushed is also on the git remote. |
| Configuration | `.env`, and `docker-compose.override.yml` if you have one | Your settings. |

Python environments (`.dbt-ui-venv` folders) and the hidden `.dbt-ui/` folder in the repositories folder (downloaded Python versions and uv's package cache) don't need a backup: they can be recreated from each project's `requirements.txt`.

Python environments survive upgrades: they and the Python versions uv downloads for projects are both kept in the repositories folder. If an upgrade changes the version of the image's own Python, environments built with the old version show as missing, and dbt UI offers **Create virtual environment** again; scheduled jobs rebuild theirs before their next run.

### Back up the data volume

Stop the backend for a consistent copy of the SQLite database, archive the volume, and start it again:

```bash
docker compose stop backend

# The volume is named <compose project>_dbtui-data, e.g. dbt-ui_dbtui-data
docker volume ls | grep dbtui-data

docker run --rm -v dbt-ui_dbtui-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/dbtui-data-$(date +%F).tgz -C /data .

docker compose start backend
```

Runs in progress when the backend stops are recorded as *interrupted*. Slots missed while it was stopped are handled by each job's [missed-slot setting](../scheduler/catch-up.md).

## Upgrade

1. Back up, as above.
2. Get the new version and rebuild:

    ```bash
    cd dbt-ui
    git pull
    docker compose build --pull
    docker compose up -d
    ```

3. Check the backend log for the scheduler start-up:

    ```bash
    docker compose logs backend | grep scheduler
    ```

    ```text
    [scheduler] Database schema is up to date (sqlite)
    [scheduler] Ready
    ```

Database migrations run automatically when the backend starts: it applies any pending Alembic migrations to the scheduler database (version table `scheduler_alembic_version`), SQLite or Postgres. There is no separate migration step.

If you changed the compose files, compare them with the new versions before pulling, or move your changes to `.env` and a `docker-compose.override.yml`, which survive upgrades untouched.

Rebuilding with `--pull` also picks up operating system security fixes, so do it regularly even without a new version. See [Security](security.md#keep-the-images-patched).

### Going back to an older version

Downgrading after a migration has changed the database is not supported: an older backend doesn't know the newer schema. To go back, restore the backup taken before the upgrade together with the older version.

## Restore

1. Stop dbt UI: `docker compose down` (without `-v`, which would delete the volume).
2. Put `.env` with the **same encryption key** back in place.
3. Restore the data volume:

    ```bash
    docker volume create dbt-ui_dbtui-data
    docker run --rm -v dbt-ui_dbtui-data:/data -v "$PWD":/backup alpine \
      sh -c 'rm -rf /data/* && tar xzf /backup/dbtui-data-2026-11-05.tgz -C /data'
    ```

    The archive keeps file ownership (uid 1000, the backend's `dbtui` user).

4. If you use Postgres, restore the database, e.g. with `pg_restore`.
5. Restore the repositories folder if needed.
6. Start dbt UI: `docker compose up -d`.
