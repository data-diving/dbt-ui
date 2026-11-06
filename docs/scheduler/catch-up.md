# Missed slots and dbt vars

Each time a job's cron expression matches is a **slot**: with `0 3 * * *`, every day at 03:00 UTC is one slot. The scheduler accounts for every slot of every job: each one either gets a run, or is recorded as a skipped run that says why it wasn't run. Every job run also tells dbt which slot it is for, so your models can process the data of that slot, even when the run happens later.

## Missed slots

A slot is missed when dbt UI couldn't run it on time: the backend was stopped or restarting, or its host was asleep. The scheduler checks for due slots every 15 seconds; a slot that is more than a minute old by the time it is checked counts as missed.

What happens to missed slots depends on the job's **Missed while dbt UI or its host was down** setting (see [Jobs](jobs.md)):

| Setting | What happens |
|---|---|
| **Run every missed slot** (default) | Each missed slot gets its own run, oldest first, one after another, each with its own slot passed to dbt. |
| **Run once, for the latest slot** | One run for the most recent missed slot. The other missed slots are recorded as skipped runs. |
| **Skip** | No run. All missed slots are recorded as skipped runs. |

Runs that catch up a slot are labelled *Catch-up* in **Triggered by**. In the [timeline](timeline.md) they are drawn at their slot, with a note of when they actually ran.

### Older gaps are filled too

For jobs set to **Run every missed slot**, the scheduler also looks through the run history every 10 minutes for slots that have no run at all, and starts catch-up runs for them. It looks back to when the job was created or its schedule last changed, within the run history that is kept (30 days by default). So gaps are filled whenever they happened, not only right after a restart.

A slot counts as covered by **any** run for it, whatever its status: succeeded, failed, cancelled or skipped.

!!! warning "Failed runs are not retried"
    Catching up fills slots that never got a run. A slot whose run failed already has a run, so it isn't run again automatically. To retry it, [rerun](runs.md#rerun-runs) the failed run.

### The catch-up limit

A job catches up at most 100 slots at a time. If more are missing (for example a job running every 5 minutes after a long outage), the rest are started by later checks of the run history, 100 at a time per job. Your administrator can change the limit with `DBT_UI__SCHEDULER_MAX_CATCHUP_RUNS` (see the [configuration reference](../admin/configuration.md)).

Catch-up runs of a job run one after another, and like all runs they share the server's limit on runs at the same time. A large catch-up can keep the server busy for a while; you can select catch-up runs in [Runs](runs.md) and skip them.

### Slots that are never caught up

- **Paused jobs.** Every slot while a job is paused is recorded as a skipped run, whatever its missed-slot setting. After you resume it, the job continues from its next slot.
- **Skipped runs.** Runs that you skip, and runs skipped because the previous run was still going, already cover their slot.
- **Old schedules.** When you change a job's cron expression, the next run is scheduled from now, and missed slots of the old schedule are not caught up.

To backfill any of these, tick **Skipped** in [Runs](runs.md), select the skipped runs and rerun them. Each rerun processes its own slot.

## dbt vars

Every run of a job passes its slot to dbt with `--vars`:

| Var | Example | Value |
|---|---|---|
| `dbt_ui_run_timestamp` | `1791864900` | The slot as Unix time in seconds. |
| `dbt_ui_run_datetime` | `2026-10-13T04:15:00Z` | The slot in UTC, as `YYYY-MM-DDTHH:MM:SSZ`. |
| `dbt_ui_cron` | `15 4 * * *` | The job's cron expression. |

Which slot a run gets:

| Run | Slot passed to dbt |
|---|---|
| Scheduled run | Its cron slot. |
| Catch-up run | The missed slot it catches up, not the time it actually runs. |
| Rerun | The same vars as the run it repeats. |
| **Run now** | The time it was started, to the second. |
| Manual run from the editor | None: these vars are not passed. |

You can see the vars of a run in the rerun confirmation, and the full dbt command line, including `--vars`, near the top of the run's log.

### Use them in a model

Because manual runs from the editor don't pass these vars, always give `var()` a default. dbt's `run_started_at` is a good one: it is the time the dbt invocation started, in UTC.

This incremental model loads the orders of the day before its slot. A daily job at 03:00 UTC loads yesterday's orders; a catch-up run for a missed day, or a rerun of a failed one, loads the orders of its own day:

```sql
{{ config(materialized='incremental', unique_key='order_id') }}

{%- set slot = modules.datetime.datetime.strptime(
      var('dbt_ui_run_datetime', run_started_at.strftime('%Y-%m-%dT%H:%M:%SZ')),
      '%Y-%m-%dT%H:%M:%SZ') %}
{%- set day_from = (slot - modules.datetime.timedelta(days=1)).strftime('%Y-%m-%d') %}
{%- set day_to = slot.strftime('%Y-%m-%d') %}

select *
from {{ ref('stg_orders') }}
{% if is_incremental() %}
where order_date >= '{{ day_from }}'
  and order_date < '{{ day_to }}'
{% endif %}
```

The date arithmetic happens in Jinja, so the SQL is the same for every warehouse. If you only need the slot as text, use the var directly, e.g. `'{{ var("dbt_ui_run_datetime", run_started_at.strftime("%Y-%m-%dT%H:%M:%SZ")) }}' as loaded_for`.

!!! tip "Test with a slot from the command line"
    To try the model with a given slot outside the scheduler, pass the var yourself: `dbt run --select my_model --vars '{"dbt_ui_run_datetime": "2026-10-13T03:00:00Z"}'`.
