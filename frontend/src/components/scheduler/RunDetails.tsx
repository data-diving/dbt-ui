import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, RotateCcw, SkipForward, Square } from 'lucide-react'
import {
  ACTIVE_STATUSES, ModelResult, ROWS_AFFECTED_HELP, RunDetail, SKIPPABLE_STATUSES, SLOT_HELP, formatBytes, formatDuration, formatRows, formatUtc,
  runDurationSeconds, schedulerApi, triggerLabel,
} from './api'
import StatusBadge from './StatusBadge'
import HelpTip from './HelpTip'
import { SortAccessors, SortHeader, useSortedRows } from './sorting'

interface RunDetailsProps {
  run: RunDetail
  onBack: () => void
  onChanged: () => void
  onRerun: (run: RunDetail) => void
  canRerun: boolean
  onSkip: (run: RunDetail) => void
}

type NodeColumn = 'node' | 'status' | 'started' | 'time' | 'rows' | 'thread'

const NODE_SORT: SortAccessors<ModelResult, NodeColumn> = {
  node: m => m.name,
  status: m => m.status,
  started: m => m.started_at,
  time: m => m.execution_time,
  rows: m => m.rows_affected,
  thread: m => m.thread_id,
}

// Strip ANSI color codes from dbt output
// eslint-disable-next-line no-control-regex
const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '')

function RunDetails({ run, onBack, onChanged, onRerun, canRerun, onSkip }: RunDetailsProps) {
  const [log, setLog] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const logRef = useRef<HTMLPreElement>(null)
  const stickToBottom = useRef(true)
  const active = ACTIVE_STATUSES.includes(run.status)

  // Tail the log incrementally
  useEffect(() => {
    let cancelled = false
    let offset = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    setLog('')
    const load = async () => {
      try {
        const chunk = await schedulerApi.getLogs(run.id, offset)
        if (cancelled) return
        offset = chunk.offset
        if (chunk.content) setLog(prev => prev + stripAnsi(chunk.content))
        if (!chunk.done) timer = setTimeout(load, chunk.content ? 300 : 1500)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    }
    load()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [run.id])

  useEffect(() => {
    if (stickToBottom.current && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [log])

  const handleCancel = async () => {
    setCancelling(true)
    try {
      await schedulerApi.cancelRun(run.id)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCancelling(false)
    }
  }

  const { sorted: models, sort, toggle } = useSortedRows<ModelResult, NodeColumn>(run.models, NODE_SORT, { key: 'started', desc: false })
  const header = (column: NodeColumn, label: string, help?: string) => (
    <SortHeader column={column} sort={sort} onSort={toggle} help={help}>{label}</SortHeader>
  )

  return (
    <div className="run-details">
      <div className="run-details-toolbar">
        <button className="scheduler-button" onClick={onBack}><ArrowLeft size={14} /> All runs</button>
        <span className="run-details-title">
          Run #{run.id} · {run.job_name || 'Manual run'} · <code>dbt {run.command}{run.selector ? ` -s ${run.selector}` : ''}</code>
        </span>
        <StatusBadge status={run.status} />
        {active && (
          <button className="scheduler-button danger" onClick={handleCancel} disabled={cancelling}>
            <Square size={12} /> {cancelling ? 'Cancelling…' : 'Cancel'}
          </button>
        )}
        {canRerun && (
          <button className="scheduler-button" onClick={() => onRerun(run)} title="Rerun for this slot">
            <RotateCcw size={12} /> Rerun
          </button>
        )}
        {SKIPPABLE_STATUSES.includes(run.status) && (
          <button
            className="scheduler-button danger"
            onClick={() => onSkip(run)}
            title={run.status === 'running' ? 'Stop dbt at once and skip this run' : 'Skip this run'}
          >
            <SkipForward size={12} /> Skip this run
          </button>
        )}
      </div>

      <div className="run-details-stats">
        <div><span>Started (UTC)</span>{formatUtc(run.started_at, true)}</div>
        <div><span>Scheduled for (UTC) <HelpTip text={SLOT_HELP} /></span>{run.scheduled_for ? formatUtc(run.scheduled_for, true) : '—'}</div>
        <div><span>Duration</span>{formatDuration(runDurationSeconds(run, Date.now()))}</div>
        <div><span>Peak memory</span>{formatBytes(run.peak_memory_bytes)}</div>
        <div><span>Rows affected <HelpTip text={ROWS_AFFECTED_HELP} /></span>{formatRows(run.rows_affected)}</div>
        <div><span>Triggered by</span>{triggerLabel(run)}</div>
        <div><span>Commit</span>{run.commit_sha ? <code>{run.commit_sha.slice(0, 12)}</code> : '—'}</div>
        <div><span>Results</span>{run.models_success} ok · {run.models_error} error · {run.models_skipped} skipped</div>
        {run.notified_at && (
          <div>
            <span>Failure notification</span>
            {run.notification_error
              ? <span className="scheduler-error-text" title={run.notification_error}>not sent ({run.notification_channel})</span>
              : `${run.notification_channel} · ${formatUtc(run.notified_at, true)}`}
          </div>
        )}
      </div>
      {run.notification_error && (
        <div className="scheduler-error-text block">
          Failure notification to {run.notification_channel} failed: {run.notification_error}
        </div>
      )}

      {run.error && run.status !== 'success' && <pre className="run-details-error">{run.error}</pre>}
      {run.status === 'scheduled' && (
        <div className="scheduler-callout">
          The job's next scheduled run: it starts at {formatUtc(run.scheduled_for, true)} UTC. Skip it to
          cancel it; the job's following scheduled time then becomes its next run.
        </div>
      )}
      {error && <div className="scheduler-error-text block">{error}</div>}

      <div className="run-details-body">
        <div className="run-details-models">
          <table className="scheduler-table compact">
            <thead>
              <tr>
                {header('node', 'Node')}{header('status', 'Status')}{header('started', 'Started (UTC)')}
                {header('time', 'Time')}{header('rows', 'Rows', ROWS_AFFECTED_HELP)}{header('thread', 'Thread')}
              </tr>
            </thead>
            <tbody>
              {models.length === 0 && (
                <tr><td colSpan={6} className="muted">{active ? 'Waiting for results…' : 'No node results'}</td></tr>
              )}
              {models.map(m => (
                <tr key={m.unique_id} title={m.message}>
                  <td className="mono node-name" title={m.unique_id}>{m.name}<span className="muted"> {m.resource_type}</span></td>
                  <td><StatusBadge status={m.status} /></td>
                  <td>{m.started_at ? formatUtc(m.started_at, true).slice(11) : '—'}</td>
                  <td>{formatDuration(m.execution_time)}</td>
                  <td>{formatRows(m.rows_affected)}</td>
                  <td className="muted nowrap">{m.thread_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <pre
          className="run-details-log"
          ref={logRef}
          onScroll={e => {
            const el = e.currentTarget
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 20
          }}
        >
          {log || (run.status === 'scheduled'
            ? 'Not started yet: there is no log until the run starts.'
            : run.status === 'skipped' && !run.started_at
              ? 'This run never started, so there is no log.'
              : active ? 'Waiting for output…' : 'No output')}
        </pre>
      </div>
    </div>
  )
}

export default RunDetails
