# Credentials

A scheduled job runs without anyone signed in, so it needs its own copy of the values your `profiles.yml` reads with `env_var()`: warehouse user, password, token and so on. Each job uses one of two sources, chosen under **Credentials (profiles.yml env vars)** in the job form:

| Option | What the job runs with | Use it for |
|---|---|---|
| **My credentials** (default) | A snapshot of the env vars of the person who last changed the job's settings. | Development and trying things out. |
| **Project credentials** | The env vars stored once for the project in [Settings](settings.md), shared by every job that uses them. | Production jobs. |

!!! tip "Use project credentials for production jobs"
    Give production jobs **Project credentials** with a service account, not tied to one person. They keep working when the person who set them up leaves or changes their own password, and editing the job doesn't change which account it runs as. Use personal credentials for development jobs.

The jobs list shows which source each job uses in its **Credentials** column: whose personal credentials (e.g. *alice's*) or *project*. Hover it to see the variable names.

## Personal credentials

With **My credentials**, saving the job stores a snapshot of the env vars you have set in dbt UI for this project (see [Env vars](../using/env-vars.md)). The form lists their names next to the option, e.g. *My credentials (DBT_USER, DBT_PASSWORD)*, or *no env vars set*.

It is a snapshot: if you change your env vars later, the job keeps the old values until its credentials are replaced.

### Whose credentials a job uses

A job uses the credentials of **the person who last changed its settings**, not necessarily the one who created it. When someone edits the job:

- **Saving a real change** (any field: name, command, selector, target, schedule, code source, timeout, policies, credentials option or notification channel) **replaces the stored credentials with the editor's own**: their env vars and their saved git credentials (see [Git credentials](#git-credentials)). From then on the job runs as them.
- **Saving without changing anything** keeps the stored credentials.
- **Pausing and resuming** keep the stored credentials, from the jobs list or with the **Enabled** checkbox in the form.

This way nobody can change what a job does and keep running it with someone else's credentials.

When you edit a job that uses personal credentials, the form shows the variable names stored with it. To store your current values without changing anything else (for example after your password changed), tick **Replace the stored snapshot with my current env vars** and click **Save**.

!!! warning "Check your env vars before editing someone else's job"
    If you save a change to a job that runs with a colleague's credentials, it runs with yours from the next run. If you have no env vars set for the project, or different ones, its runs may fail. Set your env vars first, or switch the job to **Project credentials**.

## Project credentials

Project credentials are env vars stored once per dbt project, in [Settings](settings.md). Jobs set to **Project credentials** read them when each run starts, so when you update them in Settings, every such job uses the new values from its next run.

- The option is disabled in the job form until project credentials are set (*not set — add them in Settings*).
- Editing a job that uses project credentials doesn't change the env vars it runs with.
- Project credentials can't be deleted while jobs use them.

## Git credentials

To fetch the latest commit from a private HTTPS remote, a job also needs git credentials. Git credentials are always personal: project credentials only cover env vars. When you save a job (or a change to it) that pulls the latest commit, the git credentials you saved in dbt UI for the repository are stored with it. Save them by pulling once from the [Git](../using/git.md) dialog with "save credentials" enabled. If you have none, the form tells you; fetching then only works for public remotes and remotes the server can already reach. Jobs pinned to a commit don't fetch before each run, so no git credentials are stored for them.

Git credentials follow the same rule as personal env vars: saving a real change to a job replaces them with the editor's, **also for jobs that use project credentials**. If you have no git credentials saved:

- **Private repository, and the job has git credentials stored:** the change isn't saved. dbt UI asks you to save your git credentials in the Git dialog first, then save the job again. This way a job never loses the credentials it needs to fetch.
- **Public repository:** the change is saved, and the job's stored git credentials are removed, as it doesn't need any.

## Stored safely

- Env vars and git credentials are stored **encrypted** with the server's encryption key (`DBT_UI__SCHEDULER_ENCRYPTION_KEY`).
- Values are never shown again in dbt UI: you only see variable names.
- Reruns use the job's **current** credentials, not the ones the original run had.

If the encryption key is lost or changed, stored credentials can't be decrypted and runs fail with *Stored credentials cannot be decrypted*. Save the jobs and the project credentials again. See [Security](../admin/security.md).
