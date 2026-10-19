import { useEffect, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { CommitInfo, CronPreview, Job, JobFields, NotificationChannel, SchedulerContext, formatUtc, schedulerApi } from './api'
import HelpTip from './HelpTip'

const MISFIRE_HELP =
  'Slots missed because dbt UI was stopped or its host was asleep. Run every missed slot starts one run per '
  + 'missed slot, oldest first, one after another, each with its own slot passed to dbt. Missed slots are also '
  + 'looked for in the run history since the job was created or its schedule changed, so older gaps are filled '
  + 'too. With Run once or Skip, slots that are not run are recorded as skipped runs. Slots while the job is '
  + 'paused are always recorded as skipped runs; rerun them to backfill.'

interface JobFormProps {
  projectPath: string
  context: SchedulerContext
  job: Job | null // null = new job
  profileTargets: string[]
  defaultTarget: string
  onClose: () => void
  onSaved: () => void
}

const CRON_PRESETS: { label: string; cron: string }[] = [
  { label: 'Every 15 minutes', cron: '*/15 * * * *' },
  { label: 'Hourly', cron: '0 * * * *' },
  { label: 'Daily at 03:00 UTC', cron: '0 3 * * *' },
  { label: 'Weekdays at 06:00 UTC', cron: '0 6 * * 1-5' },
  { label: 'Weekly, Monday 03:00 UTC', cron: '0 3 * * 1' },
]

// Same rules as the backend selector validation
const SELECTOR_PATTERN = /^[a-zA-Z0-9_.:+@*\-/\s,]*$/

function JobForm({ projectPath, context, job, profileTargets, defaultTarget, onClose, onSaved }: JobFormProps) {
  const [fields, setFields] = useState<JobFields>(() => job ? {
    name: job.name, command: job.command, selector: job.selector, target: job.target,
    full_refresh: job.full_refresh, cron: job.cron, enabled: job.enabled,
    timeout_seconds: job.timeout_seconds, overlap_policy: job.overlap_policy,
    misfire_policy: job.misfire_policy, pull_latest: job.pull_latest, credentials_mode: job.credentials_mode,
    notification_channel_id: job.notification_channel_id,
  } : {
    name: '', command: 'build', selector: '', target: defaultTarget, full_refresh: false,
    cron: '0 3 * * *', enabled: true, timeout_seconds: 3600, overlap_policy: 'skip',
    misfire_policy: 'run_all', pull_latest: true, credentials_mode: 'user', notification_channel_id: null,
  })
  const [refreshCredentials, setRefreshCredentials] = useState(false)
  const [repin, setRepin] = useState(false)
  const [preview, setPreview] = useState<CronPreview | null>(null)
  const [pinnedCommit, setPinnedCommit] = useState<CommitInfo | null>(null)
  const [channels, setChannels] = useState<NotificationChannel[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof JobFields>(key: K, value: JobFields[K]) =>
    setFields(prev => ({ ...prev, [key]: value }))

  const branch = context.default_branch || 'default branch'
  const projectCredNames = context.project_credentials.env_var_names
  const myNames = context.my_env_var_names
  const isNew = job === null
  const defaultChannel = channels?.find(c => c.is_default)

  // Live cron preview
  useEffect(() => {
    const handle = setTimeout(() => {
      schedulerApi.cronPreview(fields.cron).then(setPreview).catch(() => setPreview(null))
    }, 300)
    return () => clearTimeout(handle)
  }, [fields.cron])

  useEffect(() => {
    schedulerApi.notifications(projectPath).then(s => setChannels(s.channels)).catch(() => setChannels([]))
  }, [projectPath])

  // Describe the commit a pinned job runs
  useEffect(() => {
    if (job && job.pinned_sha) {
      schedulerApi.jobCommit(projectPath, job.id)
        .then(c => setPinnedCommit('sha' in c ? c as CommitInfo : null))
        .catch(() => setPinnedCommit(null))
    }
  }, [job, projectPath])

  const selectorValid = SELECTOR_PATTERN.test(fields.selector)
  const canSave = fields.name.trim() !== '' && selectorValid && preview?.valid !== false && !saving &&
    !(fields.credentials_mode === 'project' && projectCredNames.length === 0)

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      if (isNew) {
        await schedulerApi.createJob(projectPath, fields)
      } else {
        await schedulerApi.updateJob(projectPath, job.id, fields, { refresh_credentials: refreshCredentials, repin })
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const commitToShow: CommitInfo | null = !fields.pull_latest
    ? (job?.pinned_sha && !repin ? pinnedCommit : context.latest_commit)
    : null

  return (
    <div className="scheduler-modal-overlay" onMouseDown={onClose}>
      <div className="scheduler-modal" onMouseDown={e => e.stopPropagation()}>
        <div className="scheduler-modal-header">
          <h3>{isNew ? 'New scheduled job' : `Edit job: ${job.name}`}</h3>
          <button className="scheduler-icon-button" onClick={onClose} title="Close"><X size={16} /></button>
        </div>

        <div className="scheduler-modal-content">
          <label className="scheduler-field">
            <span>Name</span>
            <input value={fields.name} onChange={e => set('name', e.target.value)} placeholder="nightly build" autoFocus />
          </label>

          <div className="scheduler-row">
            <label className="scheduler-field">
              <span>Command</span>
              <select value={fields.command} onChange={e => set('command', e.target.value as JobFields['command'])}>
                <option value="build">build</option>
                <option value="run">run</option>
                <option value="test">test</option>
                <option value="seed">seed</option>
              </select>
            </label>
            <label className="scheduler-field">
              <span>Target</span>
              <select value={fields.target} onChange={e => set('target', e.target.value)}>
                <option value="">(profile default)</option>
                {profileTargets.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          </div>

          <label className="scheduler-field">
            <span>Selector (optional, empty = whole project)</span>
            <input
              className="mono"
              value={fields.selector}
              onChange={e => set('selector', e.target.value)}
              placeholder="tag:daily +orders"
            />
            {!selectorValid && <em className="scheduler-error-text">Invalid characters in selector</em>}
          </label>

          {(fields.command === 'run' || fields.command === 'seed' || fields.command === 'build') && (
            <label className="scheduler-check">
              <input type="checkbox" checked={fields.full_refresh} onChange={e => set('full_refresh', e.target.checked)} />
              <span>Full refresh</span>
            </label>
          )}

          <div className="scheduler-section-title">Schedule (UTC)</div>
          <div className="scheduler-row">
            <label className="scheduler-field grow">
              <span>Cron expression</span>
              <input className="mono" value={fields.cron} onChange={e => set('cron', e.target.value)} />
            </label>
            <label className="scheduler-field">
              <span>Presets</span>
              <select value="" onChange={e => e.target.value && set('cron', e.target.value)}>
                <option value="">Choose…</option>
                {CRON_PRESETS.map(p => <option key={p.cron} value={p.cron}>{p.label}</option>)}
              </select>
            </label>
          </div>
          {preview && !preview.valid && <em className="scheduler-error-text">{preview.error}</em>}
          {preview?.valid && (
            <div className="scheduler-hint">
              Next runs (UTC): {preview.next_runs.map(t => formatUtc(t)).join(' · ')}
            </div>
          )}

          <div className="scheduler-section-title">Code source</div>
          <div className="scheduler-callout warning">
            <AlertTriangle size={16} />
            <div>
              Scheduled runs use only what's <strong>committed to <code>{branch}</code></strong>.
              Uncommitted or unpushed changes in any worktree, including yours, are not included.
            </div>
          </div>
          <div className="scheduler-readonly">
            <span>Branch</span>
            <code>{branch}</code>
          </div>
          <label className="scheduler-check">
            <input type="checkbox" checked={fields.pull_latest} onChange={e => set('pull_latest', e.target.checked)} />
            <span>Pull latest <code>{branch}</code> before each run</span>
          </label>
          {!fields.pull_latest && (
            <div className="scheduler-hint">
              {commitToShow
                ? <>Always runs commit <code>{commitToShow.sha.slice(0, 12)}</code> — {commitToShow.subject} ({commitToShow.author})</>
                : 'Will be pinned to the latest commit when saved.'}
              {!isNew && job.pinned_sha && (
                <label className="scheduler-check inline">
                  <input type="checkbox" checked={repin} onChange={e => setRepin(e.target.checked)} />
                  <span>Pin to latest <code>{branch}</code> on save</span>
                </label>
              )}
            </div>
          )}
          {fields.pull_latest && !context.has_my_git_credentials && (isNew || !job.has_git_credentials) && (
            <div className="scheduler-hint">
              No saved git credentials found. Fetching works for public and already-authorized remotes;
              for private HTTPS remotes, pull once from the Git dialog with "save credentials" enabled.
            </div>
          )}

          <div className="scheduler-section-title">Credentials (profiles.yml env vars)</div>
          <label className="scheduler-check">
            <input
              type="radio"
              name="credentials_mode"
              checked={fields.credentials_mode === 'user'}
              onChange={() => set('credentials_mode', 'user')}
            />
            <span>
              My credentials{' '}
              <span className="muted">
                ({isNew || refreshCredentials || job.credentials_mode !== 'user'
                  ? (myNames.length ? myNames.join(', ') : 'no env vars set')
                  : (job.env_var_names.length ? job.env_var_names.join(', ') : 'no env vars stored')})
              </span>
            </span>
          </label>
          <label className={`scheduler-check ${projectCredNames.length === 0 ? 'disabled' : ''}`}>
            <input
              type="radio"
              name="credentials_mode"
              disabled={projectCredNames.length === 0}
              checked={fields.credentials_mode === 'project'}
              onChange={() => set('credentials_mode', 'project')}
            />
            <span>
              Project credentials{' '}
              <span className="muted">
                {projectCredNames.length ? `(${projectCredNames.join(', ')})` : '(not set — add them in Settings)'}
              </span>
            </span>
          </label>
          {fields.credentials_mode === 'user' && (
            <div className="scheduler-hint">
              A snapshot of your current env vars is stored encrypted with the job
              {isNew ? '.' : (
                <label className="scheduler-check inline">
                  <input type="checkbox" checked={refreshCredentials} onChange={e => setRefreshCredentials(e.target.checked)} />
                  <span>Replace the stored snapshot with my current env vars</span>
                </label>
              )}
            </div>
          )}

          <div className="scheduler-section-title">Execution</div>
          <div className="scheduler-row">
            <label className="scheduler-field">
              <span>Timeout (minutes)</span>
              <input
                type="number"
                min={1}
                value={Math.round(fields.timeout_seconds / 60)}
                onChange={e => set('timeout_seconds', Math.max(1, Number(e.target.value) || 1) * 60)}
              />
            </label>
            <label className="scheduler-field">
              <span>If the previous run is still going</span>
              <select value={fields.overlap_policy} onChange={e => set('overlap_policy', e.target.value as JobFields['overlap_policy'])}>
                <option value="skip">Skip this run</option>
                <option value="queue">Queue it</option>
              </select>
            </label>
            <label className="scheduler-field">
              <span>
                Missed while dbt UI or its host was down
                <HelpTip text={MISFIRE_HELP} />
              </span>
              <select value={fields.misfire_policy} onChange={e => set('misfire_policy', e.target.value as JobFields['misfire_policy'])}>
                <option value="run_all">Run every missed slot</option>
                <option value="run_once">Run once, for the latest slot</option>
                <option value="skip">Skip</option>
              </select>
            </label>
          </div>
          <label className="scheduler-check">
            <input type="checkbox" checked={fields.enabled} onChange={e => set('enabled', e.target.checked)} />
            <span>Enabled</span>
          </label>

          <div className="scheduler-section-title">Failure notifications</div>
          {channels && channels.length === 0 ? (
            <div className="scheduler-hint">No notification channels yet: add them in Settings to be told when runs fail.</div>
          ) : (
            <label className="scheduler-field">
              <span>Send to</span>
              <select
                value={fields.notification_channel_id ?? ''}
                onChange={e => set('notification_channel_id', e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Default channel{defaultChannel ? ` (${defaultChannel.name})` : ''}</option>
                {(channels ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}

          {error && <div className="scheduler-error-text block">{error}</div>}
        </div>

        <div className="scheduler-modal-actions">
          <button className="scheduler-button" onClick={onClose}>Cancel</button>
          <button className="scheduler-button primary" disabled={!canSave} onClick={handleSave}>
            {saving ? 'Saving…' : isNew ? 'Create job' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default JobForm
