/**
 * Seeds the demo stack with projects, built data, jobs, credentials and a day of run history.
 *
 * Everything goes through dbt UI's API, except the run history: a few real runs are started,
 * then history.py clones them into earlier cron slots so the runs list and timeline show a
 * realistic day (including a stretch where one job was paused).
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { BACKEND_CONTAINER, BASE, DANA, SAM, REPOS, api, sleep } from './demo.ts'

const JAFFLE = `${REPOS}/jaffle_shop_duckdb`
const PLATFORM = `${REPOS}/analytics-platform/transform`

async function openProject(path: string, user = DANA): Promise<string> {
  const { path: validated } = await api('/api/validate-path', { path }, user)
  const { worktree_path } = await api('/api/setup-worktree', {
    path: validated, user_name: user.name, user_email: user.email, subdirectory: '',
  }, user)
  console.log(`  opened ${path} -> ${worktree_path}`)
  return worktree_path
}

async function dbt(path: string, command: string, selector = '') {
  await api('/api/dbt-command', { path, command, selector })
  for (;;) {
    await sleep(2000)
    const status = await api('/api/dbt-command-status', { path })
    if (status.status !== 'running') {
      console.log(`  dbt ${command}: ${status.status}`)
      return status
    }
  }
}

type JobSpec = {
  name: string, command: string, selector?: string, cron: string, enabled?: boolean,
  full_refresh?: boolean, user: typeof DANA, path: string, credentials_mode?: string,
  /** Slots per hour/day to clone the first real run into (UTC, within the last 26 hours) */
  slots: (now: Date) => Date[],
  /** Hours ago during which the job was paused: those slots become skipped runs */
  pausedHoursAgo?: [number, number],
  /** How many times longer than the demo's few seconds the job's runs take (see history.py) */
  stretch: number,
}

const hourly = (minute: number, everyHours = 1) => (now: Date) => {
  const out: Date[] = []
  const t = new Date(now)
  t.setUTCMinutes(minute, 0, 0)
  if (t >= now) t.setUTCHours(t.getUTCHours() - 1)
  while (now.getTime() - t.getTime() < 26 * 3600e3) {
    if (t.getUTCHours() % everyHours === 0) out.push(new Date(t))
    t.setUTCHours(t.getUTCHours() - 1)
  }
  return out
}

async function main() {
  console.log('Opening projects')
  const jaffle = await openProject(JAFFLE)
  const platform = await openProject(PLATFORM)
  // Sam opens the jaffle project too: the All projects table counts its users
  await openProject(JAFFLE, SAM)

  console.log('Creating virtual environments (downloads Python and dbt the first time)')
  for (const path of [jaffle, platform]) {
    const r = await api('/api/recreate-venv', { path })
    console.log(`  ${path}: dbt ${r.dbt_version}`)
  }

  console.log('Building the demo data')
  await dbt(jaffle, 'seed')
  await dbt(jaffle, 'run')

  console.log('Project credentials')
  await api('/api/scheduler/project-credentials/set', {
    path: jaffle, source: 'values',
    env_vars: { DBT_HOST: 's3.eu-central-1.amazonaws.com', DBT_USER: 'svc_dbt', DBT_PASSWORD: 'demo-only' },
  })

  const jobs: JobSpec[] = [
    { name: 'Hourly orders', command: 'run', selector: '+orders', cron: '15 * * * *', user: DANA, path: jaffle,
      credentials_mode: 'project', slots: hourly(15), pausedHoursAgo: [9, 12], stretch: 70 },
    { name: 'Data quality checks', command: 'test', cron: '30 */4 * * *', user: SAM, path: jaffle,
      credentials_mode: 'project', slots: hourly(30, 4), stretch: 45 },
    { name: 'Nightly build', command: 'run', cron: '0 2 * * *', user: SAM, path: jaffle, credentials_mode: 'project',
      slots: (now) => hourly(0)(now).filter(d => d.getUTCHours() === 2), stretch: 300 },
    { name: 'Weekly full refresh', command: 'run', cron: '0 5 * * 0', enabled: false, full_refresh: true,
      user: DANA, path: jaffle, credentials_mode: 'project', slots: () => [], stretch: 1 },
    { name: 'Platform daily', command: 'run', cron: '0 4 * * *', user: SAM, path: platform,
      slots: (now) => hourly(0)(now).filter(d => d.getUTCHours() === 4), stretch: 150 },
  ]

  console.log('Creating jobs')
  for (const j of jobs) {
    await api('/api/scheduler/jobs', {
      path: j.path, name: j.name, command: j.command, selector: j.selector ?? '', cron: j.cron,
      enabled: j.enabled ?? true, full_refresh: j.full_refresh ?? false, timeout_seconds: 3600,
      credentials_mode: j.credentials_mode ?? 'user',
    }, j.user)
  }
  const listed = (await api('/api/scheduler/jobs/list', { path: jaffle })).jobs
    .concat((await api('/api/scheduler/jobs/list', { path: platform })).jobs)
  const jobId = (name: string) => listed.find((j: any) => j.name === name).id

  // One at a time: the runs share one DuckDB file, which allows a single writer
  console.log('Running each enabled job once (first runs prepare their checkouts)')
  const firstRuns = new Map<string, number>()
  for (const j of jobs.filter(j => j.enabled !== false)) {
    const { run_id } = await api(`/api/scheduler/jobs/${jobId(j.name)}/trigger`, { path: j.path }, j.user)
    firstRuns.set(j.name, run_id)
    for (;;) {
      await sleep(3000)
      const run = await api(`/api/scheduler/runs/${run_id}`, null, DANA, 'GET')
      if (!['queued', 'running', 'scheduled'].includes(run.status)) {
        console.log(`  ${j.name}: ${run.status}`)
        break
      }
    }
  }

  console.log('Cloning the runs into a day of history')
  const now = new Date()
  const history = jobs.filter(j => firstRuns.has(j.name)).map((j) => {
    // Oldest first: the newest run gets the highest id, as real runs do
    const slots = j.slots(now).sort((a, b) => a.getTime() - b.getTime())
    const hoursAgo = (d: Date) => (now.getTime() - d.getTime()) / 3600e3
    const paused = (d: Date) => !!j.pausedHoursAgo && hoursAgo(d) >= j.pausedHoursAgo[0] && hoursAgo(d) <= j.pausedHoursAgo[1]
    return {
      run_id: firstRuns.get(j.name), user: j.user.name, job_name: j.name, stretch: j.stretch,
      slots: slots.filter(d => !paused(d)).map(d => d.toISOString()),
      paused: slots.filter(paused).map(d => d.toISOString()),
    }
  })
  // SQLite can't be shared between the host and the container: the script runs next to the database
  execFileSync('docker', ['exec', '-i', '-e', `HISTORY=${JSON.stringify(history)}`, BACKEND_CONTAINER, 'python', '-'],
    { input: readFileSync(new URL('./history.py', import.meta.url)), stdio: ['pipe', 'inherit', 'inherit'] })
  console.log(`Seeded ${BASE}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
