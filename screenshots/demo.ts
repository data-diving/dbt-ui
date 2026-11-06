/** Shared settings and helpers for the screenshot scripts. */
export const BASE = process.env.DBTUI_URL ?? 'http://localhost:8180'
/** Repositories folder inside the backend container */
export const REPOS = '/home/dbtui/git-repos'
/** The demo stack's backend container (compose project dbtui-demo) */
export const BACKEND_CONTAINER = 'dbtui-demo-backend-1'

export type User = { name: string, email: string }
export const DANA: User = { name: 'Dana Analyst', email: 'dana@example.com' }
export const SAM: User = { name: 'Sam Engineer', email: 'sam@example.com' }

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Worktree a user gets for a repository (same naming as the backend) */
export const worktreePath = (repo: string, user: User) =>
  `${REPOS}/worktrees/${repo}-${user.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

/** Calls dbt UI's API as a user (the X-DBT-UI-User header the frontend sends) */
export async function api(path: string, body: unknown, user: User = DANA, method = 'POST', cookie = ''): Promise<any> {
  const response = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-DBT-UI-User': encodeURIComponent(user.name),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text.slice(0, 500)}`)
  return text ? JSON.parse(text) : {}
}
