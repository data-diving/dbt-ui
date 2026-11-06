# Sizing memory and concurrency

All dbt processes started by dbt UI run inside the **backend container**: runs from the editor, scheduled jobs, Show data, and the setup of Python environments. This page explains what that costs and how to size the container and the number of parallel runs from real numbers.

## Where the work happens

**Remote warehouses** (Postgres, Snowflake, BigQuery, Redshift, Databricks and similar): dbt parses the project, sends SQL to the warehouse and waits. The data is processed in the warehouse. A dbt process typically needs a few hundred MB, mostly for parsing; larger projects and more threads need more.

**DuckDB, SQLite and other in-process databases**: the database engine runs *inside* the dbt process, so all data is processed in the backend container, with its CPU, memory and disk. A single run can then use gigabytes, and every scheduled and manual run competes with dbt UI itself for the same resources, which can slow it down or destabilise it for all users. Use the scheduler mainly with remote warehouses, or give the container plenty of memory and keep `DBT_UI__SCHEDULER_MAX_CONCURRENT` low.

## Reading real memory use

Don't guess; measure.

**Per run.** With the scheduler on, every run (scheduled and manual) records its memory: the **Peak memory** column in [Runs](../scheduler/runs.md) (click the header to sort by it), **Peak memory** in a run's details, and the memory view of the [timeline](../scheduler/timeline.md). This is the resident memory (RSS) of the dbt process and its child processes, sampled once per second, so very short spikes can be missed.

**Whole container.** The backend itself (the API and the scheduler) typically uses about 150 to 250 MB. To see the container as a whole:

```bash
# Current memory use and limit of each container
docker stats

# Highest memory use of the backend container since it started (cgroup v2)
docker compose exec backend cat /sys/fs/cgroup/memory.peak
```

`memory.peak` is in bytes and covers everything in the container: the backend, all dbt runs and anything else started from the UI. Check it after a busy period, e.g. a day with your usual scheduled jobs and users.

## Choosing DBT_UI__SCHEDULER_MAX_CONCURRENT

`DBT_UI__SCHEDULER_MAX_CONCURRENT` (default `2`) is the most dbt runs that execute at the same time, **scheduled and manual combined**. Further runs wait in a queue in the order they were started.

A starting point for the container's memory:

```text
backend (~250 MB)
+ MAX_CONCURRENT × peak memory of your largest runs
+ headroom for Show data and environment setup (see below), e.g. 25-50 %
```

For example, with runs peaking at 400 MB and 4 parallel runs: 250 MB + 4 × 400 MB = 1.85 GB, so 2.5 GB is comfortable. Then check `memory.peak` and adjust.

Some dbt processes do **not** wait in the queue and are not counted by the limit, so the UI stays responsive: Show data previews (`dbt show`), model listing for selectors (`dbt ls`), MetaDV queries, and `dbt deps` and package installation when a Python environment is (re)created. They do get the same protection as runs: lower CPU priority, and the kernel kills them first when memory runs out. Leave some room for them.

Without the scheduler (`docker-compose-without-scheduler.yml`), manual runs are not queued at all: each click starts dbt immediately.

### Threads

Within one run, dbt executes up to `threads` models in parallel. More threads mean more warehouse connections and more memory per run. dbt UI never passes `--threads`; the value comes from:

- `threads:` in the target in `profiles.yml` (dbt uses 1 if it isn't set), or
- the `DBT_THREADS` environment variable, which overrides it, set on the backend container (see [Configuration](configuration.md#other-variables)).

## Limiting memory

Set a memory limit on the **container** and let the kernel enforce it:

```yaml title="docker-compose.override.yml"
services:
  backend:
    mem_limit: 4g
```

dbt UI protects itself inside that limit. Every dbt process it starts for a run gets:

- **`oom_score_adj=1000`**: when the container runs out of memory, the kernel's out-of-memory killer picks a dbt run first, and dbt UI keeps running. The run fails with *dbt was killed by the system, most likely out of memory*.
- **Lower CPU priority** (niceness 10): parsing a large project doesn't make the UI slow.
- Its own process group, so cancelling or timing out a run stops dbt and everything it started.

These apply to queued runs (scheduled and manual) when the scheduler is on, on Linux hosts.

### DBT_UI__SCHEDULER_MAX_MEMORY is not a RAM limit

!!! danger "Leave DBT_UI__SCHEDULER_MAX_MEMORY unset"
    Use the container memory limit instead. If you do set it, use several GB, never a value close to the memory a run actually uses.

`DBT_UI__SCHEDULER_MAX_MEMORY` sets `RLIMIT_AS` on each dbt process: a cap on **reserved address space**, not on the memory it actually uses. A process reserves far more address space than it uses:

- Python, dbt and the adapter libraries are mapped into memory in full;
- every thread reserves 8 MB for its stack;
- glibc reserves up to 64 MB per thread for memory allocation (malloc arenas).

So a dbt run whose peak memory is about 200 MB can reserve well over 512 MB of address space. When a reservation hits the cap, the run fails, and *which* reservation hits it depends on timing. In a real case, runs with a `512m` cap failed at random with:

```text
RuntimeError: can't start new thread
...
AttributeError: 'DummyProcess' object has no attribute 'terminate'
```

The second error is a bug in Python's cleanup code that hides the first one. In a test, the same command under a 512 MB cap failed 1 in 5 times with 4 threads, and 3 in 5 times with 8 threads. `MemoryError` is another symptom.

Because it caps address space rather than use, `DBT_UI__SCHEDULER_MAX_MEMORY` can't serve as a memory budget. It only catches a run that reserves absurd amounts, and it applies only on Linux.

## Disk

Plan disk for:

- repositories and each user's worktree, each with its own Python environment (`.dbt-ui-venv`) with dbt and the adapter, often several hundred MB — in the `DBT_UI__GIT_REPOS_PATH` folder;
- in the same folder, under the hidden `.dbt-ui/` folder: Python versions that projects ask for with `.python-version` or `requires-python` (about 100–200 MB each, in `.dbt-ui/python`) and uv's package cache (`.dbt-ui/uv-cache`, which makes rebuilding environments faster; safe to delete);
- one checkout and Python environment per scheduled job, plus run logs — in the `dbtui-data` volume. Logs are kept for `DBT_UI__SCHEDULER_RETENTION_DAYS` (30 by default);
- with DuckDB and other file-based databases, the database files themselves.
