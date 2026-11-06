# Security

## Who can do what

dbt UI has no individual accounts or roles. Everyone who can open it, or who knows the shared login, can use every feature, every project on the server, and every scheduler job, credential set and notification channel (see [Administration](index.md#access)).

Using dbt UI also means running code on the server: dbt models and macros, packages from `packages.yml`, and Python packages from a project's `requirements.txt` all execute in the backend container. dbt, git and uv don't receive dbt UI's own settings (the `DBT_UI__*` variables, such as `DBT_UI__SCHEDULER_ENCRYPTION_KEY`, the login password and the database URL), so `env_var('DBT_UI__…')` returns nothing. But they run as the same operating system user as the backend, so code in a project can still read the backend's environment, for example from `/proc`. **Treat everyone with access to dbt UI as an administrator of the server it runs on**, and only give access to people you would trust with that.

The names shown as *created by* or *triggered by* in the scheduler are the git user names each person set in their browser. They are not verified.

## Require a login

Set a user name and password for the backend, e.g. in `.env`:

```bash
DBT_UI__BACKEND_USER=dbt
DBT_UI__BACKEND_PASSWORD=choose-a-strong-password
```

Login is on only when **both** are set. Then every API request needs these credentials (HTTP Basic authentication), and the browser asks for them when someone opens dbt UI. It is one account shared by everyone; to revoke someone's access, change the password and tell everyone else the new one.

The web app's static files (HTML, JavaScript, icons) are served without a login; all data and actions go through the API, which requires it.

## Use HTTPS

HTTP Basic sends the user name and password with every request, and the browser cookies that hold git credentials and env var values (see below) go with requests too. Over plain HTTP all of this travels unencrypted. On anything but your own machine, put dbt UI behind a reverse proxy that terminates HTTPS, for example nginx, Caddy or Traefik, and:

- forward **all** paths to the frontend container (port 80), not just `/` and `/api/`: the frontend's nginx serves the app and its static files and forwards `/api/` to the backend itself;
- pass the `Authorization` header through (most proxies do by default);
- send the `X-Forwarded-Proto` header (Caddy and Traefik do by default; in nginx add `proxy_set_header X-Forwarded-Proto $scheme;`): the frontend's nginx forwards it to the backend, which then marks the credential cookies `Secure`, so browsers never send them over plain HTTP;
- allow long requests, at least 300 seconds, like the bundled nginx: cloning a repository or creating a project's Python environment can take minutes;
- set `DBT_UI__FRONTEND_URL` to the public address, e.g. `https://dbt-ui.example.com`.

### Network exposure

The compose files publish the backend's port 8000 on `127.0.0.1` only, so it can be reached from the host itself but not from other machines. The web app doesn't need it, as browsers reach the backend through the frontend's `/api/` path. Change the mapping to `"8000:8000"` only if you want to expose the API on the network on purpose. The API on port 8000 requires the login too, but its interactive documentation (`/docs`) and `/health` do not.

## The encryption key

`DBT_UI__SCHEDULER_ENCRYPTION_KEY` is a Fernet key (AES in CBC mode with an HMAC signature). The scheduler encrypts with it everything secret it stores in its database:

- the env var values and git credentials saved with jobs (personal credentials),
- project credentials,
- notification channel URLs and headers, which often contain tokens.

The UI only ever shows variable names and the scheme and host of channel URLs, never stored values.

Create the key once (see [Install](../getting-started/install.md)) and keep it with your backups, separately from them if you can. Whoever has both the key and the database can decrypt the credentials.

- **If the key is lost or changed**, stored credentials can't be decrypted: runs of affected jobs fail with *Stored credentials cannot be decrypted. Was DBT_UI__SCHEDULER_ENCRYPTION_KEY changed?* Save the credentials again (edit and save the job, project credentials or channel).
- **A malformed key** keeps the scheduler from starting; the reason is in the backend log and the scheduler button's tooltip.

There is no key rotation: changing the key means saving all credentials again.

## Where credentials live

| What | Where | Protection |
|---|---|---|
| Env var values for runs from the editor ([Env vars](../using/env-vars.md)) | A cookie in the user's browser, one per project, for 1 year | HttpOnly (not readable by JavaScript), base64-encoded, not encrypted; `Secure` when dbt UI is opened over HTTPS. Sent to the backend with requests. |
| Git credentials for clone, pull and push | A cookie in the user's browser, one per repository, for `DBT_UI__BACKEND_GIT_CREDS_COOKIE_MAX_AGE` seconds (30 days by default) | HttpOnly, base64-encoded, not encrypted; `Secure` when dbt UI is opened over HTTPS. Passed to git through a temporary askpass helper script, not stored in the repository's git config or remote URL. |
| Credentials of scheduled jobs, project credentials, notification channel secrets | The scheduler database | Encrypted with the encryption key. See [Credentials](../scheduler/credentials.md). |
| Login (`DBT_UI__BACKEND_USER`, `DBT_UI__BACKEND_PASSWORD`) | Environment of the backend; the browser keeps it for the session | Sent with every request; use HTTPS. |

A shorter `DBT_UI__BACKEND_GIT_CREDS_COOKIE_MAX_AGE` makes users enter their git credentials more often but limits how long they stay in a browser. Prefer personal access tokens with narrow scopes over passwords.

## Containers

- The backend, which runs git and dbt, runs as a non-root user, `dbtui` (uid 1000). The frontend is the standard `nginx:alpine` image serving static files.
- The backend image installs only production Python dependencies (`uv export --no-dev`).
- dbt runs as a separate process with lower priority, and the kernel kills it first when memory runs out (see [Sizing](sizing.md#limiting-memory)).

## Keep the images patched

Both Dockerfiles install the latest operating system security fixes when the image is built: `apt-get upgrade` in the backend (Debian, `python:3.14-slim`) and `apk upgrade` in the frontend (`nginx:alpine`). So rebuilding regularly, e.g. monthly, picks up fixes even without a new dbt UI version:

```bash
docker compose build --pull
docker compose up -d
```

`--pull` also fetches the newest base images. See [Upgrades and backups](upgrades.md).

Python environments of projects and jobs are separate: they get the dbt and adapter versions from each project's `requirements.txt` and `dbt_project.yml`, and are only updated when those files change or the environment is recreated.
