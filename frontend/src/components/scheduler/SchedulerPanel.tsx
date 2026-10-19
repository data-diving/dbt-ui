import { useEffect, useState } from 'react'
import {
  AlertTriangle, Clock, Edit2, KeyRound, Loader2, PauseCircle, Play, PlayCircle, Plus, RotateCcw, SkipForward, Trash2, X,
} from 'lucide-react'
import {
  Job, ROWS_AFFECTED_HELP, RUN_RANGES, Run, RunFilters, SKIPPABLE_STATUSES, SLOT_HELP, formatBytes, formatDuration, formatRows, formatUtc, runDurationSeconds,
  schedulerApi, triggerLabel,
} from './api'
import { SchedulerState, SchedulerTab } from './useScheduler'
import JobForm from './JobForm'
import NotificationSettings from './NotificationSettings'
import RunDetails from './RunDetails'
import RerunModal from './RerunModal'
import StatusBadge from './StatusBadge'
import { statusColor } from './statusColors'
import { SortAccessors, SortHeader, useSortedRows } from './sorting'
import ConfirmModal from '../main/ConfirmModal'
import HelpTip from './HelpTip'
import './Scheduler.css'

interface SchedulerPanelProps {
  projectPath: string
  scheduler: SchedulerState
  profileTargets: string[]
  selectedTarget: string
}


const RUN_FILTER_OPTIONS: { key: keyof RunFilters; label: string; color: string }[] = [
  { key: 'scheduled', label: 'Scheduled', color: statusColor('scheduled') },
  { key: 'active', label: 'Running', color: statusColor('running') },
  { key: 'success', label: 'Succeeded', color: statusColor('success') },
  { key: 'failed', label: 'Failed', color: statusColor('failed') },
  { key: 'skipped', label: 'Skipped', color: statusColor('skipped') },
]

// What "Skip this run" does, for the kinds of runs selected
function skipMessage(runs: Run[]): string {
  const parts: string[] = []
  if (runs.some(r => r.status === 'running')) {
    parts.push('Running runs are stopped at once: dbt is killed without waiting for it to cancel its queries, '
      + 'so queued runs can start. Work it already did in your warehouse stays as it is.')
  }
  if (runs.some(r => r.status === 'queued')) parts.push('Queued runs will not start.')
  if (runs.some(r => r.status === 'scheduled')) {
    parts.push("A job's scheduled run is cancelled: the job skips that time, and its following scheduled time becomes its next run.")
  }
  parts.push('Skipped runs are hidden (tick Skipped in Runs to list them again), their times are not caught up again, '
    + 'and they can still be rerun.')
  return parts.join(' ')
}

const STATUS_FILTER_KEYS = RUN_FILTER_OPTIONS.map(o => o.key)

const RUN_FILTERS_HELP =
  'Which runs the table and the timeline show; All selects or clears every status. Scheduled is each job\'s next run, not started yet; skip it '
  + 'to cancel it, and the following time is scheduled instead. Running includes queued runs; Failed includes cancelled and '
  + 'interrupted ones. Skipped runs record slots a job did not run for: while it was paused, missed while dbt UI '
  + 'was down (when the job is set to skip or run once), or because the previous run was still going, and runs you skipped. Select skipped runs '
  + 'and rerun them to backfill their slots.'

type RunColumn = 'id' | 'started' | 'slot' | 'job' | 'command' | 'status' | 'duration' | 'memory' | 'rows' | 'trigger' | 'commit'

const RUN_SORT: SortAccessors<Run, RunColumn> = {
  id: r => r.id,
  started: r => r.started_at ?? r.queued_at,
  slot: r => r.scheduled_for,
  job: r => r.job_name || 'manual',
  command: r => `${r.command} ${r.selector}`,
  status: r => r.status,
  duration: r => runDurationSeconds(r, Date.now()),
  memory: r => r.peak_memory_bytes,
  rows: r => r.rows_affected,
  trigger: r => triggerLabel(r),
  commit: r => r.commit_sha,
}

interface RunsTableProps {
  runs: Run[]
  nowMs: number
  selected: Set<number>
  canRerun: (run: Run) => boolean
  onSelect: (id: number) => void
  onToggleSelected: (ids: number[], on: boolean) => void
  onRerun: (runs: Run[]) => void
  onSkip: (runs: Run[]) => void
}

function RunsTable({ runs, nowMs, selected, canRerun, onSelect, onToggleSelected, onRerun, onSkip }: RunsTableProps) {
  const { sorted, sort, toggle } = useSortedRows<Run, RunColumn>(runs, RUN_SORT, { key: 'id', desc: true })
  const header = (column: RunColumn, label: string, help?: string) => (
    <SortHeader column={column} sort={sort} onSort={toggle} help={help}>{label}</SortHeader>
  )
  const selectedRuns = runs.filter(r => selected.has(r.id))
  const allSelected = runs.length > 0 && selectedRuns.length === runs.length
  const rerunBlocked = selectedRuns.some(r => !canRerun(r))
  const skipBlocked = selectedRuns.some(r => !SKIPPABLE_STATUSES.includes(r.status))
  const stop = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <>
      {selectedRuns.length > 0 && (
        <div className="scheduler-toolbar runs-bulk-toolbar">
          <span>{selectedRuns.length} selected</span>
          <button
            className="scheduler-button"
            disabled={rerunBlocked}
            title={rerunBlocked ? "Manual runs and runs of deleted jobs can't be rerun" : 'Rerun the selected runs'}
            onClick={() => onRerun(selectedRuns)}
          >
            <RotateCcw size={12} /> Rerun
          </button>
          <button
            className="scheduler-button danger"
            disabled={skipBlocked}
            title={skipBlocked ? 'Only scheduled, queued and running runs can be skipped' : 'Skip the selected runs'}
            onClick={() => onSkip(selectedRuns)}
          >
            <SkipForward size={12} /> {selectedRuns.length === 1 ? 'Skip this run' : `Skip ${selectedRuns.length} runs`}
          </button>
          <button className="scheduler-link" onClick={() => onToggleSelected(selectedRuns.map(r => r.id), false)}>
            Clear selection
          </button>
        </div>
      )}
      <table className="scheduler-table clickable">
        <thead>
          <tr>
            <th className="select-cell" onClick={stop}>
              <input
                type="checkbox"
                checked={allSelected}
                ref={el => { if (el) el.indeterminate = selectedRuns.length > 0 && !allSelected }}
                onChange={e => onToggleSelected(runs.map(r => r.id), e.target.checked)}
                title="Select all runs in this period"
              />
            </th>
            {header('id', '#')}{header('started', 'Started (UTC)')}{header('slot', 'Scheduled for (UTC)', SLOT_HELP)}{header('job', 'Job')}{header('command', 'Command')}
            {header('status', 'Status')}{header('duration', 'Duration')}{header('memory', 'Peak memory')}
            {header('rows', 'Rows', ROWS_AFFECTED_HELP)}{header('trigger', 'Triggered by')}{header('commit', 'Commit')}
            <th />
          </tr>
        </thead>
        <tbody>
          {runs.length === 0 && (
            <tr><td colSpan={13} className="muted">No runs in this period</td></tr>
          )}
          {sorted.map(run => (
            <tr
              key={run.id}
              className={selected.has(run.id) ? 'selected' : ''}
              onClick={() => onSelect(run.id)}
            >
              <td className="select-cell" onClick={stop}>
                <input
                  type="checkbox"
                  checked={selected.has(run.id)}
                  onChange={e => onToggleSelected([run.id], e.target.checked)}
                />
              </td>
              <td className="muted">{run.id}</td>
              <td>{run.status === 'scheduled' ? <span className="muted">—</span> : formatUtc(run.started_at ?? run.queued_at)}</td>
              <td className="muted">{run.scheduled_for ? formatUtc(run.scheduled_for) : '—'}</td>
              <td>{run.job_name || <span className="muted">manual</span>}</td>
              <td className="mono">{run.command}{run.selector ? ` ${run.selector}` : ''}</td>
              <td title={run.status === 'skipped' ? run.error : undefined}>
                <StatusBadge status={run.status} />
              </td>
              <td>{formatDuration(runDurationSeconds(run, nowMs))}</td>
              <td>{formatBytes(run.peak_memory_bytes)}</td>
              <td>{formatRows(run.rows_affected)}</td>
              <td>{triggerLabel(run)}</td>
              <td className="mono muted">{run.commit_sha.slice(0, 8) || '—'}</td>
              <td className="scheduler-actions">
                {canRerun(run) && (
                  <button
                    className="scheduler-icon-button"
                    title="Rerun for this slot"
                    onClick={e => {
                      e.stopPropagation()
                      onRerun([run])
                    }}
                  >
                    <RotateCcw size={14} />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

const TAB_TITLES: Record<SchedulerTab, string> = {
  jobs: 'Jobs',
  runs: 'Runs',
  settings: 'Settings',
}

function SchedulerPanel({ projectPath, scheduler, profileTargets, selectedTarget }: SchedulerPanelProps) {
  const { tab, setTab } = scheduler
  const [editing, setEditing] = useState<Job | 'new' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyJobId, setBusyJobId] = useState<number | null>(null)
  const [pausing, setPausing] = useState<Job | null>(null)
  const [rerunning, setRerunning] = useState<Run[] | null>(null)
  const [skipping, setSkipping] = useState<Run[] | null>(null)
  const [selectedRuns, setSelectedRuns] = useState<Set<number>>(new Set())
  const { context, jobs, runs, runDetail, status } = scheduler

  const act = async (jobId: number | null, action: () => Promise<unknown>) => {
    setActionError(null)
    setBusyJobId(jobId)
    try {
      await action()
      await scheduler.refresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyJobId(null)
    }
  }

  const runNow = (job: Job) => act(job.id, async () => {
    const { run_id } = await schedulerApi.triggerJob(projectPath, job.id)
    scheduler.selectRun(run_id)
    setTab('runs')
  })

  // Forget selected runs that left the list (skipped, or outside the time range)
  useEffect(() => {
    setSelectedRuns(prev => {
      const visible = new Set(runs.map(r => r.id))
      const next = new Set([...prev].filter(id => visible.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [runs])

  const toggleSelected = (ids: number[], on: boolean) => setSelectedRuns(prev => {
    const next = new Set(prev)
    ids.forEach(id => (on ? next.add(id) : next.delete(id)))
    return next
  })

  const canRerun = (run: Run) => run.status !== 'scheduled' && run.job_id !== null && jobs.some(j => j.id === run.job_id)

  const rerun = (targets: Run[], sameCommit: boolean) => act(null, async () => {
    const { run_ids } = await schedulerApi.rerunRuns(projectPath, targets.map(r => r.id), sameCommit)
    setSelectedRuns(new Set())
    // A single rerun opens straight away; several stay in the list
    scheduler.selectRun(run_ids.length === 1 ? run_ids[0] : null)
    setTab('runs')
  })

  const skipRuns = (targets: Run[]) => act(null, async () => {
    await schedulerApi.skipRuns(projectPath, targets.map(r => r.id))
    setSelectedRuns(new Set())
    if (targets.some(r => r.id === scheduler.selectedRunId)) scheduler.selectRun(null)
  })

  const toggleEnabled = (job: Job) => act(job.id, () => schedulerApi.updateJob(projectPath, job.id, {
    name: job.name, command: job.command, selector: job.selector, target: job.target,
    full_refresh: job.full_refresh, cron: job.cron, enabled: !job.enabled, timeout_seconds: job.timeout_seconds,
    overlap_policy: job.overlap_policy, misfire_policy: job.misfire_policy, pull_latest: job.pull_latest,
    credentials_mode: job.credentials_mode, notification_channel_id: job.notification_channel_id,
  }))

  const deleteJob = (job: Job) => {
    if (!window.confirm(`Delete job "${job.name}"? Its run history is kept.`)) return
    act(job.id, () => schedulerApi.deleteJob(projectPath, job.id))
  }

  const openRun = (runId: number) => {
    scheduler.selectRun(runId)
    setTab('runs')
  }

  return (
    <div className="scheduler-panel">
      <div className="scheduler-header">
        <div className="scheduler-header-left">
          <Clock size={14} />
          <span className="scheduler-title">{TAB_TITLES[tab]}</span>
          <span className="scheduler-tz">All times UTC</span>
          {scheduler.loading && <Loader2 size={14} className="scheduler-spinner" />}
        </div>
        <div className="scheduler-header-right">
          {tab === 'jobs' && (
            <button className="graph-action-button" onClick={() => setEditing('new')} disabled={!context}>
              <Plus size={14} /><span>New job</span>
            </button>
          )}
        </div>
      </div>

      {!status.ready && (
        <div className="scheduler-callout error">
          <AlertTriangle size={16} /> Scheduler unavailable: {status.error || 'starting…'}
        </div>
      )}
      {(scheduler.error || actionError) && (
        <div className="scheduler-callout error">
          <AlertTriangle size={16} /> {actionError || scheduler.error}
        </div>
      )}

      <div className="scheduler-body">
        {tab === 'jobs' && (
          <JobsTable
            jobs={jobs}
            branch={context?.default_branch || ''}
            busyJobId={busyJobId}
            onRunNow={runNow}
            onEdit={job => setEditing(job)}
            onToggle={setPausing}
            onDelete={deleteJob}
            onOpenRun={openRun}
            onNew={() => setEditing('new')}
          />
        )}

        {tab === 'runs' && (runDetail && scheduler.selectedRunId === runDetail.id ? (
          <RunDetails
            run={runDetail}
            onBack={() => scheduler.selectRun(null)}
            onChanged={scheduler.refresh}
            onRerun={run => setRerunning([run])}
            canRerun={canRerun(runDetail)}
            onSkip={run => setSkipping([run])}
          />
        ) : (
          <div>
            <div className="scheduler-toolbar">
              <span className="muted">Showing</span>
              {RUN_RANGES.map(r => (
                <button
                  key={r.hours}
                  className={`scheduler-chip ${scheduler.rangeHours === r.hours ? 'active' : ''}`}
                  onClick={() => scheduler.setRangeHours(r.hours)}
                >
                  {r.label}
                </button>
              ))}
              <span className="muted">· manual and scheduled runs · click a run for details</span>
              <span className="runs-filters">
                <span className="muted">Show</span>
                <label className="scheduler-check inline" title="All statuses">
                  <input
                    type="checkbox"
                    checked={STATUS_FILTER_KEYS.every(k => scheduler.runFilters[k])}
                    ref={el => {
                      if (el) {
                        const on = STATUS_FILTER_KEYS.filter(k => scheduler.runFilters[k]).length
                        el.indeterminate = on > 0 && on < STATUS_FILTER_KEYS.length
                      }
                    }}
                    onChange={e => scheduler.setRunFilters({
                      ...scheduler.runFilters,
                      ...Object.fromEntries(STATUS_FILTER_KEYS.map(k => [k, e.target.checked])),
                    })}
                  />
                  <span>All</span>
                </label>
                {RUN_FILTER_OPTIONS.map(({ key, label, color }) => (
                  <label key={key} className="scheduler-check inline">
                    <input
                      type="checkbox"
                      checked={scheduler.runFilters[key]}
                      onChange={e => scheduler.setRunFilters({ ...scheduler.runFilters, [key]: e.target.checked })}
                    />
                    <span className="runs-filter-dot" style={{ background: color }} />
                    <span>{label}</span>
                  </label>
                ))}
                <HelpTip text={RUN_FILTERS_HELP} />
              </span>
            </div>
            <RunsTable
              runs={runs}
              nowMs={scheduler.serverNow}
              selected={selectedRuns}
              canRerun={canRerun}
              onSelect={scheduler.selectRun}
              onToggleSelected={toggleSelected}
              onRerun={setRerunning}
              onSkip={setSkipping}
            />
          </div>
        ))}

        {tab === 'settings' && context && (
          <div className="scheduler-settings">
            <div className="scheduler-section-title">Project credentials</div>
            <ProjectCredentials
              projectPath={projectPath}
              names={context.project_credentials.env_var_names}
              updatedBy={context.project_credentials.updated_by}
              updatedAt={context.project_credentials.updated_at}
              myNames={context.my_env_var_names}
              onChanged={scheduler.refresh}
            />
            <div className="scheduler-section-title">Failure notifications</div>
            <NotificationSettings projectPath={projectPath} onChanged={scheduler.refresh} />
          </div>
        )}
      </div>

      {pausing && (
        <ConfirmModal
          onClose={() => setPausing(null)}
          onConfirm={() => {
            toggleEnabled(pausing)
            setPausing(null)
          }}
          title={pausing.enabled ? `Pause "${pausing.name}"?` : `Resume "${pausing.name}"?`}
          message={pausing.enabled
            ? 'The job will stop running on its schedule until it is resumed; its slots are recorded as skipped runs. A run in progress is not stopped, and Run now still works.'
            : `The job will run on its schedule again (${pausing.cron} UTC), starting from the next scheduled time. Slots while it was paused are recorded as skipped runs (tick Skipped in Runs to see them), which you can rerun.`}
          confirmLabel={pausing.enabled ? 'Pause' : 'Resume'}
          variant={pausing.enabled ? 'warning' : 'default'}
        />
      )}

      {rerunning && (
        <RerunModal
          runs={rerunning}
          jobs={jobs}
          branch={context?.default_branch || ''}
          onClose={() => setRerunning(null)}
          onConfirm={sameCommit => {
            rerun(rerunning, sameCommit)
            setRerunning(null)
          }}
        />
      )}

      {skipping && (
        <ConfirmModal
          onClose={() => setSkipping(null)}
          onConfirm={() => {
            skipRuns(skipping)
            setSkipping(null)
          }}
          title={skipping.length === 1 ? `Skip run #${skipping[0].id}?` : `Skip ${skipping.length} runs?`}
          message={skipMessage(skipping)}
          confirmLabel={skipping.length === 1 ? 'Skip this run' : `Skip ${skipping.length} runs`}
          variant="danger"
        />
      )}

      {editing && context && (
        <JobForm
          projectPath={projectPath}
          context={context}
          job={editing === 'new' ? null : editing}
          profileTargets={profileTargets}
          defaultTarget={selectedTarget}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            scheduler.refresh()
          }}
        />
      )}
    </div>
  )
}

interface JobsTableProps {
  jobs: Job[]
  branch: string
  busyJobId: number | null
  onRunNow: (job: Job) => void
  onEdit: (job: Job) => void
  onToggle: (job: Job) => void
  onDelete: (job: Job) => void
  onOpenRun: (runId: number) => void
  onNew: () => void
}

function JobsTable({ jobs, branch, busyJobId, onRunNow, onEdit, onToggle, onDelete, onOpenRun, onNew }: JobsTableProps) {
  if (jobs.length === 0) {
    return (
      <div className="scheduler-empty">
        <p>No scheduled jobs for this project yet.</p>
        <button className="scheduler-button primary" onClick={onNew}><Plus size={14} /> Create a job</button>
      </div>
    )
  }
  return (
    <table className="scheduler-table">
      <thead>
        <tr>
          <th>Name</th><th>Command</th><th>Schedule (UTC)</th><th>Next run</th><th>Code</th>
          <th>Credentials</th><th>Last run</th><th></th>
        </tr>
      </thead>
      <tbody>
        {jobs.map(job => (
          <tr key={job.id}>
            <td>
              {job.name}
              {job.checkout_state === 'preparing' && (
                <span className="muted" title="Preparing checkout and virtual environment">
                  {' '}<Loader2 size={12} className="scheduler-spinner" />
                </span>
              )}
              {job.checkout_state === 'error' && (
                <span className="scheduler-error-text" title={job.checkout_error}> <AlertTriangle size={12} /></span>
              )}
            </td>
            <td className="mono">
              {job.command}{job.selector ? ` -s ${job.selector}` : ''}{job.full_refresh ? ' --full-refresh' : ''}
              {job.target && <span className="muted"> ({job.target})</span>}
            </td>
            <td>
              <span className="mono">{job.cron}</span>
              {!job.enabled && <span className="scheduler-paused-label">paused</span>}
            </td>
            <td>{job.enabled ? formatUtc(job.next_run_at) : <span className="muted">—</span>}</td>
            <td title={job.pull_latest ? `Pulls latest ${branch} before each run` : `Pinned to ${job.pinned_sha}`}>
              {job.pull_latest ? <>latest <code>{branch}</code></> : <>pinned <code>{job.pinned_sha.slice(0, 8)}</code></>}
            </td>
            <td title={job.credentials_mode === 'user' ? job.env_var_names.join(', ') : 'Project credentials'}>
              {job.credentials_mode === 'user' ? `${job.created_by || 'creator'}'s` : 'project'}
            </td>
            <td>
              {job.last_run ? (
                <button className="link-button" onClick={() => onOpenRun(job.last_run!.id)}>
                  <StatusBadge status={job.last_run.status} />{' '}
                  <span className="muted">{formatUtc(job.last_run.started_at ?? job.last_run.queued_at)}</span>
                </button>
              ) : <span className="muted">never</span>}
            </td>
            <td className="scheduler-actions">
              <button className="scheduler-icon-button" title="Run now" onClick={() => onRunNow(job)} disabled={busyJobId === job.id}>
                <Play size={14} />
              </button>
              <button
                className="scheduler-icon-button"
                title={job.enabled ? 'Pause schedule' : 'Resume schedule'}
                onClick={() => onToggle(job)}
                disabled={busyJobId === job.id}
              >
                {job.enabled ? <PauseCircle size={14} /> : <PlayCircle size={14} />}
              </button>
              <button className="scheduler-icon-button" title="Edit" onClick={() => onEdit(job)}>
                <Edit2 size={14} />
              </button>
              <button className="scheduler-icon-button" title="Delete" onClick={() => onDelete(job)} disabled={job.busy}>
                <Trash2 size={14} />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

interface ProjectCredentialsProps {
  projectPath: string
  names: string[]
  updatedBy: string
  updatedAt: string | null
  myNames: string[]
  onChanged: () => Promise<void>
}

function ProjectCredentials({ projectPath, names, updatedBy, updatedAt, myNames, onChanged }: ProjectCredentialsProps) {
  const [rows, setRows] = useState<{ name: string; value: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const run = async (action: () => Promise<unknown>) => {
    setSaving(true)
    setError(null)
    try {
      await action()
      setRows([])
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const saveValues = () => run(() => schedulerApi.setProjectCredentials(
    projectPath, 'values', Object.fromEntries(rows.filter(r => r.name.trim()).map(r => [r.name.trim(), r.value])),
  ))

  return (
    <div className="scheduler-credentials">
      <p className="muted">
        Default env vars for this project's <code>profiles.yml</code>. Jobs set to "Project credentials" read them
        at run time, so updating them here updates every such job. Values are stored encrypted and are never shown again.
      </p>

      <div className="scheduler-readonly">
        <span><KeyRound size={14} /> Stored variables</span>
        {names.length ? <code>{names.join(', ')}</code> : <span className="muted">none</span>}
      </div>
      {updatedAt && <div className="scheduler-hint">Last updated {formatUtc(updatedAt)} UTC by {updatedBy || 'unknown'}</div>}

      <div className="scheduler-toolbar">
        <button
          className="scheduler-button"
          disabled={saving || myNames.length === 0}
          title={myNames.length ? `Copies: ${myNames.join(', ')}` : 'You have no env vars set (Env Vars button in the bottom panel)'}
          onClick={() => run(() => schedulerApi.setProjectCredentials(projectPath, 'my_env'))}
        >
          Use my current env vars
        </button>
        <button className="scheduler-button" disabled={saving} onClick={() => setRows([...rows, { name: '', value: '' }])}>
          <Plus size={14} /> Enter values
        </button>
        {names.length > 0 && (
          <button
            className="scheduler-button danger"
            disabled={saving}
            onClick={() => window.confirm('Delete project credentials?') && run(() => schedulerApi.deleteProjectCredentials(projectPath))}
          >
            <Trash2 size={14} /> Delete
          </button>
        )}
      </div>

      {rows.length > 0 && (
        <div className="scheduler-credential-rows">
          {rows.map((row, i) => (
            <div className="scheduler-row" key={i}>
              <input
                className="mono"
                placeholder="NAME"
                value={row.name}
                onChange={e => setRows(rows.map((r, j) => j === i ? { ...r, name: e.target.value } : r))}
              />
              <input
                className="mono grow"
                type="password"
                placeholder="value"
                value={row.value}
                onChange={e => setRows(rows.map((r, j) => j === i ? { ...r, value: e.target.value } : r))}
              />
              <button className="scheduler-icon-button" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                <X size={14} />
              </button>
            </div>
          ))}
          <div className="scheduler-hint">Saving replaces all stored project variables with the ones above.</div>
          <button className="scheduler-button primary" disabled={saving} onClick={saveValues}>Save project credentials</button>
        </div>
      )}
      {error && <div className="scheduler-error-text block">{error}</div>}
    </div>
  )
}

export default SchedulerPanel
