// Confirmation for rerunning job runs, listing the parameters each rerun repeats

import { useState } from 'react'
import { RotateCcw, X } from 'lucide-react'
import { Job, Run, formatUtc } from './api'

interface RerunModalProps {
  runs: Run[]
  jobs: Job[]
  branch: string
  onClose: () => void
  onConfirm: (sameCommit: boolean) => void
}

export function dbtCommandLine(run: Run): string {
  const parts = ['dbt', run.command]
  if (run.selector) parts.push('--select', run.selector)
  if (run.target) parts.push('--target', run.target)
  if (run.full_refresh && ['run', 'seed', 'build'].includes(run.command)) parts.push('--full-refresh')
  return parts.join(' ')
}

// What the rerun passes: the recorded vars, or for runs from before they were recorded,
// the same values the backend derives from the slot and the job's cron
function rerunVars(run: Run, job: Job | undefined): Run['dbt_vars'] {
  if (run.dbt_vars) return run.dbt_vars
  const slot = run.scheduled_for ?? run.queued_at.replace(/\.\d+Z$/, 'Z')
  return {
    dbt_ui_run_timestamp: Math.floor(Date.parse(slot) / 1000),
    dbt_ui_run_datetime: slot.replace(/\.\d+Z$/, 'Z'),
    dbt_ui_cron: job?.cron ?? '',
  }
}

function slotOf(run: Run): string {
  return formatUtc(run.scheduled_for ?? run.queued_at, true)
}

function credentialsLabel(job: Job | undefined): string {
  if (!job) return '—'
  if (job.credentials_mode === 'project') return 'Project credentials (as currently saved)'
  const names = job.env_var_names.length ? `: ${job.env_var_names.join(', ')}` : ''
  return `Env vars of ${job.created_by || 'the job creator'} saved with the job${names}`
}

function codeSourceLabel(job: Job | undefined, branch: string): string {
  if (!job) return "The job's code source"
  return job.pull_latest
    ? `Latest commit of ${branch || 'the default branch'}`
    : `The job's pinned commit ${job.pinned_sha.slice(0, 12)}`
}

function RerunModal({ runs, jobs, branch, onClose, onConfirm }: RerunModalProps) {
  const [sameCommit, setSameCommit] = useState(true)
  const jobById = new Map(jobs.map(j => [j.id, j]))
  const single = runs.length === 1 ? runs[0] : null
  const singleJob = single ? jobById.get(single.job_id!) : undefined
  const sortedRuns = [...runs].sort((a, b) =>
    (a.scheduled_for ?? a.queued_at).localeCompare(b.scheduled_for ?? b.queued_at) || a.id - b.id)

  return (
    <div className="scheduler-modal-overlay" onMouseDown={onClose}>
      <div
        className="scheduler-modal rerun-modal"
        onMouseDown={e => e.stopPropagation()}
        onKeyDown={e => e.key === 'Escape' && onClose()}
      >
        <div className="scheduler-modal-header">
          <h3>{single ? `Rerun #${single.id} · ${single.job_name}` : `Rerun ${runs.length} runs`}</h3>
          <button className="scheduler-icon-button" onClick={onClose} title="Close"><X size={16} /></button>
        </div>

        <div className="scheduler-modal-content">
          {single ? (
            <dl className="rerun-params">
              <dt>Job</dt><dd>{single.job_name}</dd>
              <dt>Command</dt><dd><code>{dbtCommandLine(single)}</code></dd>
              <dt>Selector</dt><dd>{single.selector ? <code>{single.selector}</code> : 'All nodes'}</dd>
              <dt>Target</dt><dd>{single.target ? <code>{single.target}</code> : 'Profile default'}</dd>
              <dt>Full refresh</dt><dd>{single.full_refresh ? 'Yes' : 'No'}</dd>
              <dt>Scheduled for (UTC)</dt><dd>{slotOf(single)}</dd>
              <dt>dbt vars</dt>
              <dd>
                <pre className="rerun-vars">{JSON.stringify(rerunVars(single, singleJob), null, 2)}</pre>
                {!single.dbt_vars && (
                  <span className="muted">Not recorded for this older run: derived from its slot and the job's current cron</span>
                )}
              </dd>
              <dt>Original commit</dt><dd>{single.commit_sha ? <code>{single.commit_sha.slice(0, 12)}</code> : '—'}</dd>
              <dt>Original run</dt>
              <dd>{single.status} · started {formatUtc(single.started_at ?? single.queued_at, true)} UTC</dd>
              <dt>Credentials</dt><dd>{credentialsLabel(singleJob)}</dd>
              <dt>Timeout</dt><dd>{singleJob ? `${singleJob.timeout_seconds}s (the job's current setting)` : '—'}</dd>
            </dl>
          ) : (
            <div className="rerun-table-wrap">
              <table className="scheduler-table">
                <thead>
                  <tr>
                    <th>#</th><th>Job</th><th>Command</th><th>Scheduled for (UTC)</th><th>dbt vars (timestamp · cron)</th><th>Commit</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRuns.map(run => {
                    const vars = rerunVars(run, jobById.get(run.job_id!))
                    return (
                    <tr key={run.id}>
                      <td className="muted">{run.id}</td>
                      <td>{run.job_name}</td>
                      <td className="mono">{dbtCommandLine(run)}</td>
                      <td className="nowrap">{slotOf(run)}</td>
                      <td className="mono muted" title={JSON.stringify(vars, null, 2)}>
                        {vars?.dbt_ui_run_timestamp} · {vars?.dbt_ui_cron}
                      </td>
                      <td className="mono muted">{run.commit_sha.slice(0, 8) || '—'}</td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="scheduler-hint">
            {single ? 'The rerun repeats' : 'Each rerun repeats'} the command, selector, target, full refresh and dbt vars
            (the original slot in <code>dbt_ui_run_timestamp</code> and <code>dbt_ui_run_datetime</code>) of its run.
            {!single && ' They run in slot order, one after another per job.'} Credentials and timeout are the
            job's current ones. Reruns wait for any run of the same job in progress.
          </div>

          <div className="rerun-code">
            <span>Code</span>
            <label className="scheduler-check">
              <input type="radio" checked={sameCommit} onChange={() => setSameCommit(true)} />
              <span>Same commit as the original {single ? 'run' : 'runs'}</span>
            </label>
            <label className="scheduler-check">
              <input type="radio" checked={!sameCommit} onChange={() => setSameCommit(false)} />
              <span>{single ? codeSourceLabel(singleJob, branch) : "Each job's current code source"}</span>
            </label>
          </div>
        </div>

        <div className="scheduler-modal-actions">
          <button className="scheduler-button" onClick={onClose}>Cancel</button>
          <button className="scheduler-button primary" autoFocus onClick={() => onConfirm(sameCommit)}>
            <RotateCcw size={12} /> {single ? 'Rerun' : `Rerun ${runs.length} runs`}
          </button>
        </div>
      </div>
    </div>
  )
}

export default RerunModal
