# FAQ

## Which version of dbt-core does dbt UI have?

None. dbt UI doesn't contain dbt-core or any adapter. It's a wrapper around dbt and an orchestrator for its jobs: it edits your project's files and runs the `dbt` command of the project's own Python environment.

That environment is created per project, when you create the virtual environment in the editor and when a scheduled job prepares its checkout. dbt UI then installs from PyPI, the Python package index:

- everything in the project's `requirements.txt`, such as your adapter (`dbt-snowflake`, `dbt-postgres`, ...);
- dbt-core in the version that `require-dbt-version` in `dbt_project.yml` allows. When `require-dbt-version` isn't set, you get the version from `requirements.txt`, or the latest one.

So each project runs the dbt version it asks for, and different projects on the same dbt UI can use different dbt versions. To change the version, change `requirements.txt` or `require-dbt-version` and recreate the virtual environment. Scheduled jobs pick up the change by themselves on their next run once it's committed. See [Open your first project](getting-started/first-project.md#3-create-the-virtual-environment).

## Which databases and adapters are supported?

Any dbt Core adapter you can install with pip. List it in a `requirements.txt` next to `dbt_project.yml`, e.g. `dbt-snowflake` or `dbt-postgres`. dbt UI doesn't contain dbt-core or any adapter. For each project it builds a separate Python environment and installs from PyPI everything in `requirements.txt` plus dbt-core in the version allowed by `require-dbt-version` in `dbt_project.yml` (the version from `requirements.txt`, or the latest, if it isn't set). Different projects can use different dbt versions.

With DuckDB and other in-process databases, the data is processed on the dbt UI server itself, so give it enough memory: see [Sizing](admin/sizing.md).

## Can I use it without git?

No. dbt UI works with dbt projects in a git repository, cloned from a URL or already on the server. Git is what gives every user their own workspace and lets the scheduler run committed code. See [Open your first project](getting-started/first-project.md).

## Where are my changes stored?

On the server, in your own workspace: a git worktree on your own branch. Saving a file writes it there. Your changes stay on the server until you commit and push them; nobody else's workspace sees them. See [Git](using/git.md).

## Can several people work on the same project?

Yes. Each person gets their own branch and workspace of the repository, so you don't overwrite each other's files. You meet again through git: push, pull and merge as usual.

## Is my data sent anywhere?

dbt UI has no telemetry. The server talks to:

- your git remote and your data warehouse;
- PyPI and the dbt package hub, to build a project's Python environment and install dbt packages;
- the URLs of [notification channels](scheduler/notifications.md) you set up.

The code editor (Monaco) is served by dbt UI itself; the browser doesn't contact any third-party CDN, so dbt UI also works on networks without internet access (dbt still needs to reach your warehouse and PyPI). dbt itself may send anonymous usage statistics to dbt Labs; to turn that off for all runs, set `DBT_SEND_ANONYMOUS_USAGE_STATS=false` on the backend container (see [Configuration](admin/configuration.md#other-variables)).

## Is there a light mode?

No, dbt UI has a dark theme only.

## Can I restrict who sees which projects or jobs?

Not yet. dbt UI has no roles or individual accounts: everyone who can open it can see and change every project, job, credential and notification channel on the server. You can require a shared login and limit who can reach the server. See [Administration](admin/index.md#access) and [Security](admin/security.md).

## Does the scheduler run my uncommitted changes?

No. Scheduled jobs always run what is committed to the repository's default branch, in their own checkout. Runs you start from the editor use your workspace as it is. See [Scheduler](scheduler/index.md).

## How many dbt runs can run at the same time?

Two by default, scheduled and manual runs combined; further runs wait in a queue. An administrator can change this with `DBT_UI__SCHEDULER_MAX_CONCURRENT`. Within a run, dbt executes as many models in parallel as the `threads` setting of your profile allows. See [Sizing memory and concurrency](admin/sizing.md).

## My run from the editor stops after 5 minutes. Can I make it longer?

Yes: 5 minutes is the default, and an administrator can raise it with `DBT_UI__SCHEDULER_MANUAL_TIMEOUT`, with or without the scheduler. Scheduled jobs have their own timeout in the job settings. See [Troubleshooting](admin/troubleshooting.md#dbt-run-timed-out).

## Which time zone does the scheduler use?

UTC, for cron schedules and all times it shows. See [Scheduler](scheduler/index.md).
