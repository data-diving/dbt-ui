# Run data in Postgres

The scheduler keeps jobs, run history, project credentials and notification channels in a database. By default that is a SQLite file in the `dbtui-data` volume, which needs no setup. You can use Postgres instead.

## When to use Postgres

SQLite is fine for most teams: dbt UI has a single backend, and the scheduler writes little data. Consider Postgres when:

- your organisation already backs up, monitors and restores Postgres databases, and you want run data handled the same way;
- you want to query run history with your own tools, e.g. for reporting on job durations or failures;
- you keep the `dbtui-data` volume on storage where SQLite does not work well, such as a network file system.

Postgres does not let you run several backends side by side: the scheduler runs inside the one backend.

Run logs and job checkouts stay in the data directory (the `dbtui-data` volume) either way. Only the database moves.

## Connection URL

Set `DBT_UI__SCHEDULER_DB_URL`, e.g. in `.env`:

```bash
DBT_UI__SCHEDULER_DB_URL=postgresql://dbtui:secret@db.example.com:5432/dbtui
```

- `postgresql://` and `postgres://` both work. dbt UI always connects with its bundled pure-Python driver, pg8000; a driver named in the URL, such as `postgresql+psycopg2://`, is replaced with it.
- Special characters in the user name or password must be URL-encoded, e.g. `@` as `%40` and `/` as `%2F`.
- The host must be reachable **from the backend container**. `localhost` there means the container itself; for a database on the Docker host, use the host's address.

All tables are prefixed with `scheduler_` (including Alembic's version table, `scheduler_alembic_version`), so the scheduler can share a database with other applications. Give the user permission to create tables in the database's schema; dbt UI creates and upgrades them itself.

### Postgres in the same compose project

To run Postgres next to dbt UI, add it in a `docker-compose.override.yml`, which Docker Compose merges with `docker-compose.yml` automatically:

```yaml title="docker-compose.override.yml"
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: dbtui
      POSTGRES_PASSWORD: ${DBTUI_PG_PASSWORD:?Set DBTUI_PG_PASSWORD}
      POSTGRES_DB: dbtui
    volumes:
      - dbtui-postgres:/var/lib/postgresql/data
    restart: unless-stopped

  backend:
    depends_on:
      - postgres

volumes:
  dbtui-postgres:
```

```bash title=".env"
DBTUI_PG_PASSWORD=choose-a-strong-password
DBT_UI__SCHEDULER_DB_URL=postgresql://dbtui:choose-a-strong-password@postgres:5432/dbtui
```

## Migrations run automatically

On every start, the backend creates the scheduler tables if they don't exist and applies any pending schema migrations (Alembic, version recorded in `scheduler_alembic_version`). There is nothing to run by hand when you [upgrade](upgrades.md).

If the database can't be reached at startup, the rest of dbt UI works and the scheduler retries every 15 seconds. Until it connects, the scheduler button is greyed out with *Scheduler unavailable* and the reason, and the backend log shows:

```text
[scheduler] Scheduler database unavailable: ... Retrying in 15s
```

Once connected, it logs `[scheduler] Database schema is up to date (postgresql)` and `[scheduler] Ready`.

## Switching from SQLite

dbt UI does not copy data between databases. When you point `DBT_UI__SCHEDULER_DB_URL` at a new Postgres database, the scheduler starts empty: create the jobs, project credentials and notification channels again. The old SQLite file stays in the `dbtui-data` volume, so you can switch back by removing the setting.

## Backups

Back up the `scheduler_*` tables like any other Postgres data, for example:

```bash
pg_dump --table='scheduler_*' --format=custom --file=dbtui.dump "postgresql://dbtui:...@db.example.com:5432/dbtui"
```

Keep the encryption key with the backup: the credentials in these tables can't be decrypted without it. See [Upgrades and backups](upgrades.md).
