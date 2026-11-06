# Docs screenshots

Generates the screenshots in `docs/images/screens/` and the slideshow `docs/images/slideshow.webp`
(README and docs home page) from a demo dbt UI. Needs Docker and Node.js 24+.

```bash
screenshots/run.sh          # fresh demo, seed it, take all screenshots, build the slideshow
screenshots/run.sh seed     # fresh demo with demo data only, to look around at http://localhost:8180
screenshots/run.sh shoot    # screenshots and slideshow only (demo already seeded and running)
npx tsx shoot.ts using-editor scheduler-runs-list   # some screenshots only (run in screenshots/)
screenshots/run.sh down     # remove the demo stack and its data
```

The demo is a separate Docker Compose project (`dbtui-demo`, port 8180, own data volume, repositories
in `screenshots/.demo/`), so a dbt UI you run from this checkout keeps running and keeps its data.

## How it works

| File | Does |
| --- | --- |
| `prepare-demo-repos.sh` | Clones [jaffle_shop_duckdb](https://github.com/dbt-labs/jaffle_shop_duckdb) and adds what the screenshots need: a `prod` target with env vars, automate_dv with a MetaDV mapping, and a failing data test. Its origin is redirected to a local bare copy (job checkouts fetch from origin), and all runs share one DuckDB file. A second repository has the project in a subdirectory. |
| `docker-compose.demo.yml` | Override of `docker-compose.yml` for the demo stack. |
| `seed.ts` | Through dbt UI's API: opens the projects as two users, builds the data, stores project credentials, creates five jobs and runs each once. |
| `history.py` | Clones those runs into a day of history (inside the backend container, next to the SQLite database). |
| `shoot.ts` | One function per screenshot: Playwright opens the app as the demo user and sets up the screen. Window size 1440×900, dark mode, UTC. |
| `frame.ts` | Puts each screenshot into a browser window frame. |
| `slideshow.ts` | Builds the animated WebP slideshow from some of the framed screenshots. |

To add a screenshot, add an entry to `shots` in `shoot.ts` and reference
`images/screens/<name>.png` from the docs.
