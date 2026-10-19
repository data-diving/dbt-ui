// Scheduler API client and types. All timestamps are ISO strings in UTC.

import { apiUrl, apiFetch } from '../../config/api'

export type RunStatus = 'scheduled' | 'queued' | 'running' | 'success' | 'failed' | 'cancelled' | 'interrupted' | 'skipped'

export interface SchedulerStatus {
  enabled: boolean
  ready: boolean
  error: string
  max_concurrent?: number
}

export interface CommitInfo {
  sha: string
  subject: string
  author: string
  date: string
}

export interface SchedulerContext {
  project_key: string
  repo_path: string
  subdirectory: string
  default_branch: string
  latest_commit: CommitInfo | null
  user_name: string
  my_env_var_names: string[]
  has_my_git_credentials: boolean
  project_credentials: {
    env_var_names: string[]
    updated_by: string
    updated_at: string | null
  }
}

export interface Run {
  id: number
  job_id: number | null
  job_name: string
  trigger: 'manual' | 'schedule' | 'catch_up' | 'run_now' | 'rerun'
  triggered_by: string
  command: string
  selector: string
  target: string
  full_refresh: boolean
  commit_sha: string
  // Cron slot the run is for (UTC); null for manual runs from the editor
  scheduled_for: string | null
  rerun_of_id: number | null
  // [[seconds since start, bytes], ...]; only listed for the memory chart
  memory_profile?: number[][]
  // --vars passed to dbt (job runs)
  dbt_vars: { dbt_ui_run_timestamp: number; dbt_ui_run_datetime: string; dbt_ui_cron: string } | null
  status: RunStatus
  error: string
  exit_code: number | null
  queued_at: string
  started_at: string | null
  finished_at: string | null
  duration_seconds: number | null
  peak_memory_bytes: number | null
  avg_memory_bytes: number | null
  rows_affected: number | null
  models_success: number
  models_error: number
  models_skipped: number
  // Failure notification: when it was sent, through which channel, and the endpoint's error if it failed
  notified_at: string | null
  notification_channel: string
  notification_error: string
}

export interface RunFilters {
  scheduled: boolean
  active: boolean
  success: boolean
  failed: boolean
  skipped: boolean
}

export const DEFAULT_RUN_FILTERS: RunFilters = { scheduled: true, active: true, success: true, failed: true, skipped: false }

// Statuses each run filter checkbox stands for
export const RUN_FILTER_STATUSES: Record<keyof RunFilters, RunStatus[]> = {
  scheduled: ['scheduled'],
  active: ['queued', 'running'],
  success: ['success'],
  failed: ['failed', 'cancelled', 'interrupted'],
  skipped: ['skipped'],
}

export interface ModelResult {
  unique_id: string
  name: string
  resource_type: string
  status: string
  thread_id: string
  started_at: string | null
  finished_at: string | null
  execution_time: number | null
  rows_affected: number | null
  message: string
  adapter_response: Record<string, unknown>
}

export interface RunDetail extends Run {
  models: ModelResult[]
}

export interface JobFields {
  name: string
  command: 'run' | 'build' | 'test' | 'seed'
  selector: string
  target: string
  full_refresh: boolean
  cron: string
  enabled: boolean
  timeout_seconds: number
  overlap_policy: 'skip' | 'queue'
  misfire_policy: 'run_all' | 'run_once' | 'skip'
  pull_latest: boolean
  credentials_mode: 'user' | 'project'
  // Failure notifications go to this channel; null: the project's default channel
  notification_channel_id: number | null
}

export interface Job extends JobFields {
  id: number
  next_run_at: string | null
  pinned_sha: string
  env_var_names: string[]
  has_git_credentials: boolean
  checkout_state: 'pending' | 'preparing' | 'ready' | 'error'
  checkout_error: string
  created_by: string
  created_at: string
  updated_at: string
  busy: boolean
  last_run: Run | null
}

export interface ChannelFields {
  name: string
  method: 'GET' | 'POST'
  body_format: 'json' | 'text'
  body_template: string
  message_template: string
}

export interface NotificationChannel extends ChannelFields {
  id: number
  is_default: boolean
  // The URL and headers are write-only: only the URL's scheme and host and the header names are returned
  url_preview: string
  header_names: string[]
  created_by: string
  updated_at: string
}

export interface NotificationSettings {
  channels: NotificationChannel[]
  // dbt UI address for {{run_url}} links (DBT_UI__FRONTEND_URL); empty when not set
  ui_url: string
  placeholders: Record<string, string>
  default_message_template: string
}

export interface CronPreview {
  valid: boolean
  error: string
  next_runs: string[]
}

async function request<T>(endpoint: string, method: string, body?: unknown): Promise<T> {
  const response = await apiFetch(apiUrl(endpoint), {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    // Cookies carry the user's env vars and git credentials for capture at scheduling time
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      const data = await response.json()
      if (typeof data.detail === 'string') message = data.detail
      else if (data.detail?.message) message = data.detail.message
    } catch {
      // keep default message
    }
    throw new Error(message)
  }
  return response.json()
}

export const schedulerApi = {
  status: () => request<SchedulerStatus>('/api/scheduler/status', 'GET'),
  context: (path: string) => request<SchedulerContext>('/api/scheduler/context', 'POST', { path }),
  cronPreview: (cron: string) => request<CronPreview>('/api/scheduler/cron-preview', 'POST', { cron }),

  listJobs: (path: string) => request<{ jobs: Job[] }>('/api/scheduler/jobs/list', 'POST', { path }),
  createJob: (path: string, fields: JobFields) =>
    request<Job>('/api/scheduler/jobs', 'POST', { path, ...fields }),
  updateJob: (path: string, id: number, fields: JobFields, options: { refresh_credentials?: boolean; repin?: boolean } = {}) =>
    request<Job>(`/api/scheduler/jobs/${id}`, 'PUT', { path, ...fields, ...options }),
  deleteJob: (path: string, id: number) => request<{ success: boolean }>(`/api/scheduler/jobs/${id}/delete`, 'POST', { path }),
  triggerJob: (path: string, id: number) => request<{ run_id: number }>(`/api/scheduler/jobs/${id}/trigger`, 'POST', { path }),
  jobCommit: (path: string, id: number) => request<CommitInfo | Record<string, never>>(`/api/scheduler/jobs/${id}/commit`, 'POST', { path }),

  listRuns: (path: string, sinceHours: number, filters: RunFilters, memoryProfile = false, jobId?: number | null) =>
    request<{ runs: Run[]; now: string }>('/api/scheduler/runs/list', 'POST', {
      path, since_hours: sinceHours, job_id: jobId ?? null, limit: 1000,
      statuses: (Object.keys(RUN_FILTER_STATUSES) as (keyof RunFilters)[])
        .filter(key => filters[key]).flatMap(key => RUN_FILTER_STATUSES[key]),
      include_memory_profile: memoryProfile,
    }),
  getRun: (id: number) => request<RunDetail>(`/api/scheduler/runs/${id}`, 'GET'),
  getLogs: (id: number, offset: number) =>
    request<{ content: string; offset: number; done: boolean }>(`/api/scheduler/runs/${id}/logs?offset=${offset}`, 'GET'),
  cancelRun: (id: number) => request<{ success: boolean }>(`/api/scheduler/runs/${id}/cancel`, 'POST'),
  rerunRuns: (path: string, runIds: number[], sameCommit: boolean) =>
    request<{ run_ids: number[] }>('/api/scheduler/runs/rerun', 'POST', { path, run_ids: runIds, same_commit: sameCommit }),
  skipRuns: (path: string, runIds: number[]) =>
    request<{ skipped: number[] }>('/api/scheduler/runs/skip', 'POST', { path, run_ids: runIds }),

  setProjectCredentials: (path: string, source: 'my_env' | 'values', envVars: Record<string, string> = {}) =>
    request<{ env_var_names: string[] }>('/api/scheduler/project-credentials/set', 'POST', {
      path, source, env_vars: envVars,
    }),
  deleteProjectCredentials: (path: string) =>
    request<{ success: boolean }>('/api/scheduler/project-credentials/delete', 'POST', { path }),

  notifications: (path: string) => request<NotificationSettings>('/api/scheduler/notifications/list', 'POST', { path }),
  // url: empty keeps the stored URL; headers: null keeps the stored headers
  createChannel: (path: string, fields: ChannelFields & { url: string; headers: Record<string, string> | null }) =>
    request<NotificationChannel>('/api/scheduler/notifications', 'POST', { path, ...fields }),
  updateChannel: (path: string, id: number, fields: ChannelFields & { url: string; headers: Record<string, string> | null }) =>
    request<NotificationChannel>(`/api/scheduler/notifications/${id}`, 'PUT', { path, ...fields }),
  setDefaultChannel: (path: string, id: number) =>
    request<{ success: boolean }>(`/api/scheduler/notifications/${id}/default`, 'POST', { path }),
  deleteChannel: (path: string, id: number) =>
    request<{ success: boolean }>(`/api/scheduler/notifications/${id}/delete`, 'POST', { path }),
  testChannel: (path: string, id: number) =>
    request<{ success: boolean; run_id: number | null }>(`/api/scheduler/notifications/${id}/test`, 'POST', { path }),
}

// ---- formatting helpers ----

export function parseUtc(value: string | null | undefined): number | null {
  return value ? Date.parse(value) : null
}

export function formatUtc(value: string | null | undefined, withSeconds = false): string {
  if (!value) return '—'
  const iso = new Date(value).toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, withSeconds ? 19 : 16)}`
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—'
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  if (m < 60) return `${m}m ${s}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

export function formatRows(rows: number | null | undefined): string {
  if (rows === null || rows === undefined) return '—'
  return rows.toLocaleString('en-US')
}

export function runDurationSeconds(run: Run, nowMs: number): number | null {
  const start = parseUtc(run.started_at)
  if (start === null) return null
  const end = parseUtc(run.finished_at) ?? nowMs
  return Math.max(0, (end - start) / 1000)
}

export function triggerLabel(run: Run): string {
  if (run.trigger === 'manual') return `Manual · ${run.triggered_by || 'unknown'}`
  if (run.trigger === 'run_now') return `Run now · ${run.triggered_by || 'unknown'}`
  if (run.trigger === 'rerun') return `Rerun of #${run.rerun_of_id ?? '?'} · ${run.triggered_by || 'unknown'}`
  if (run.trigger === 'catch_up') return `Catch-up${run.triggered_by ? ` · created by ${run.triggered_by}` : ''}`
  return `Schedule${run.triggered_by ? ` · created by ${run.triggered_by}` : ''}`
}

export const ROWS_AFFECTED_HELP =
  'Taken from what dbt-core reports for each node in its run results (adapter_response.rows_affected). '
  + 'Whether it is available depends on dbt-core and the database adapter: some report it only for certain '
  + 'operations (DuckDB, for example, only for seeds), others not at all. Shown as — when not reported.'

export const SLOT_HELP =
  'The time this run was scheduled for (its cron slot). Catch-up runs and reruns keep the original time, '
  + 'even though they run later; Run now uses the time it was started. Job runs pass it to dbt as vars: '
  + 'dbt_ui_run_timestamp (Unix seconds), dbt_ui_run_datetime (e.g. 2026-10-13T04:15:00Z) and dbt_ui_cron. '
  + 'Manual runs from the editor have none.'

export const ACTIVE_STATUSES: RunStatus[] = ['queued', 'running']
// Runs that haven't finished; finished runs can't be skipped
export const SKIPPABLE_STATUSES: RunStatus[] = ['scheduled', ...ACTIVE_STATUSES]

// Time ranges offered by the runs list and the runs timeline (they share one selection)
export const RUN_RANGES = [
  { hours: 0.25, label: '15m' },
  { hours: 1, label: '1h' },
  { hours: 4, label: '4h' },
  { hours: 12, label: '12h' },
  { hours: 24, label: '24h' },
  { hours: 24 * 7, label: '7d' },
  { hours: 24 * 30, label: '30d' },
]
