// Runs timeline: a Gantt chart with one row per job, its runs placed at the time they were scheduled
// for (gaps in the schedule stand out), or a memory chart over actual run time (server load); and for
// one run, a Gantt chart of its nodes. Fits the pane width; scrolls vertically only.

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, BarChart3, Maximize2, Minimize2 } from 'lucide-react'
import {
  ModelResult, RUN_RANGES, Run, RunDetail, formatBytes, formatDuration, formatRows, formatUtc, parseUtc, triggerLabel,
} from './api'
import { statusColor } from './statusColors'
import { ChartMode, SchedulerState } from './useScheduler'
import MemoryChart from './MemoryChart'
import '../editor/GraphView.css'
import './Scheduler.css'

const LABEL_WIDTH = 200
const MIN_TICK_SPACING = 90
const MANUAL_LANE = 'Manual runs'
// The global timeline zooms to the runs inside the selected range, but never narrower than this
const MIN_WINDOW_MS = 30 * 60 * 1000
// Room to the right of "now" so active runs don't touch the edge
const RIGHT_PAD = 0.02
// The runs timeline keeps about 10% of its width for the future, so "Now" sits around 90%
const FUTURE_SHARE = 0.1
// Room for a tick label (up to ~11 characters) plus the "Now" label left of the now line
const NOW_LABEL_CLEARANCE = 100
// Mouse wheel zoom: wheel distance per range step, and the pause between steps
const WHEEL_STEP = 40
const WHEEL_COOLDOWN_MS = 250

const TIME_STEPS_MS = [
  0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 172800, 604800,
].map(s => s * 1000)

interface Bar {
  key: string
  start: number
  end: number
  color: string
  label: string
  title: string
  runId?: number
  active?: boolean
  variant?: 'skipped'
  running?: boolean
}

interface Row {
  key: string
  label: string
  title: string
  bars: Bar[]
}

interface Chart {
  startMs: number
  endMs: number
  nowMs: number | null
  rows: Row[]
  relativeTicks: boolean
  tickLabel: (ms: number) => string
}

function pickStep(rangeMs: number, width: number): number {
  return TIME_STEPS_MS.find(step => (width / (rangeMs / step)) >= MIN_TICK_SPACING) ?? TIME_STEPS_MS[TIME_STEPS_MS.length - 1]
}

function runTitle(run: Run, durationS: number | null): string {
  return [
    `#${run.id} ${run.job_name || 'Manual run'} — ${run.status}`,
    `dbt ${run.command}${run.selector ? ` -s ${run.selector}` : ''}`,
    run.status === 'scheduled' ? 'Not started yet' : `Started: ${formatUtc(run.started_at ?? run.queued_at, true)} UTC`,
    run.scheduled_for ? `Scheduled for: ${formatUtc(run.scheduled_for, true)} UTC` : '',
    `Duration: ${formatDuration(durationS)}`,
    `Peak memory: ${formatBytes(run.peak_memory_bytes)}`,
    `Rows affected: ${formatRows(run.rows_affected)}`,
    `Triggered by: ${triggerLabel(run)}`,
    run.commit_sha ? `Commit: ${run.commit_sha.slice(0, 12)}` : '',
    run.status === 'skipped' ? run.error : '',
  ].filter(Boolean).join('\n')
}

// Where a run sits on the time axis. Skipped and scheduled runs haven't started: they are drawn
// as a marker at their slot. The runs list only contains skipped runs when their checkbox is on.
// "07:45", or "10-12 07:45" when it isn't the same UTC day as `relativeTo`
function shortTime(iso: string, relativeTo: number): string {
  const time = new Date(parseUtc(iso)!).toISOString()
  const sameDay = time.slice(0, 10) === new Date(relativeTo).toISOString().slice(0, 10)
  return sameDay ? time.slice(11, 16) : `${time.slice(5, 10)} ${time.slice(11, 16)}`
}

// By scheduled time, a run that started keeps its actual duration but begins at its scheduled time
// (runs without one, like manual runs, stay at their actual time).
// A scheduled run is drawn as long as its job's latest finished run took.
function runSpan(run: Run, nowMs: number, byScheduled: boolean, expectedMs = 0): [number, number] | null {
  const s = parseUtc(run.started_at)
  if (s !== null) {
    const e = parseUtc(run.finished_at) ?? nowMs
    const at = byScheduled ? (parseUtc(run.scheduled_for) ?? s) : s
    return [at, at + (e - s)]
  }
  if (run.status !== 'skipped' && run.status !== 'scheduled') return null // still queued
  const slot = parseUtc(run.scheduled_for ?? run.queued_at)
  if (slot === null) return null
  return [slot, run.status === 'scheduled' ? slot + expectedMs : slot]
}

// Duration of each job's latest finished run, used to draw its scheduled run
function lastDurations(runs: Run[]): Map<string, number> {
  const latest = new Map<string, { finished: number; ms: number }>()
  for (const run of runs) {
    const s = parseUtc(run.started_at)
    const e = parseUtc(run.finished_at)
    if (s === null || e === null || !run.job_name) continue
    const prev = latest.get(run.job_name)
    if (!prev || e > prev.finished) latest.set(run.job_name, { finished: e, ms: e - s })
  }
  return new Map([...latest].map(([name, { ms }]) => [name, ms]))
}

function buildGlobal(
  runs: Run[], jobNames: string[], rangeHours: number, nowMs: number, selectedRunId: number | null, byScheduled: boolean,
): Chart {
  const rangeStart = nowMs - rangeHours * 3600 * 1000
  const starts = runs.map(r => runSpan(r, nowMs, byScheduled)?.[0] ?? null).filter((t): t is number => t !== null && t >= rangeStart)
  const earliest = starts.length ? Math.min(...starts) : rangeStart
  const span = Math.max(Math.min(MIN_WINDOW_MS, nowMs - rangeStart), (nowMs - earliest) * 1.1)
  const startMs = Math.max(rangeStart, nowMs - span)
  const endMs = nowMs + (nowMs - startMs) * FUTURE_SHARE / (1 - FUTURE_SHARE)

  const lanes = [...new Set([...jobNames, ...runs.filter(r => r.job_name).map(r => r.job_name)])].sort()
  if (runs.some(r => !r.job_name)) lanes.push(MANUAL_LANE)
  const rows = new Map<string, Row>(lanes.map(l => [l, { key: l, label: l, title: l, bars: [] }]))

  const expected = lastDurations(runs)
  for (const run of runs) {
    const span = runSpan(run, nowMs, byScheduled, expected.get(run.job_name) ?? 0)
    if (span === null) continue
    const [s, e] = span
    if (e < startMs) continue
    const scheduled = run.status === 'scheduled'
    const marker = !run.started_at && !scheduled
    // Catch-ups and reruns ran later than scheduled: say when (by scheduled time) or for when (by actual time)
    const late = (run.trigger === 'catch_up' || run.trigger === 'rerun') && run.scheduled_for && run.started_at
    const lateNote = !late ? '' : byScheduled
      ? ` · ran at ${shortTime(run.started_at!, s)}`
      : ` · scheduled ${shortTime(run.scheduled_for!, s)}`
    const label = marker ? '' : scheduled ? `#${run.id} next` : `#${run.id} ${formatDuration((e - s) / 1000)}${lateNote}`
    rows.get(run.job_name || MANUAL_LANE)?.bars.push({
      key: `run-${run.id}`,
      start: Math.max(s, startMs),
      end: e,
      color: statusColor(run.status),
      label,
      title: runTitle(run, marker || scheduled ? null : (e - s) / 1000),
      runId: run.id,
      active: run.id === selectedRunId,
      variant: marker ? 'skipped' : undefined,
      running: run.status === 'running',
    })
  }
  // Later bars are drawn over earlier ones, and running runs over everything: with many short
  // runs packed together (e.g. catch-ups) the one in progress stays visible
  for (const row of rows.values()) {
    row.bars.sort((a, b) => Number(!!a.running) - Number(!!b.running) || a.start - b.start)
  }

  const short = nowMs - startMs <= 24 * 3600 * 1000
  return {
    startMs, endMs, nowMs, rows: [...rows.values()], relativeTicks: false,
    tickLabel: ms => {
      const iso = new Date(ms).toISOString()
      return short ? iso.slice(11, 16) : `${iso.slice(5, 10)} ${iso.slice(11, 16)}`
    },
  }
}

function modelTitle(m: ModelResult): string {
  return [
    `${m.name} (${m.resource_type}) — ${m.status}`,
    `Time: ${formatDuration(m.execution_time)}`,
    `Rows affected: ${formatRows(m.rows_affected)}`,
    `Thread: ${m.thread_id}`,
    m.message ? `Message: ${m.message.slice(0, 300)}` : '',
  ].filter(Boolean).join('\n')
}

function buildRun(run: RunDetail, nowMs: number): Chart {
  // Span of node execution only: dbt's startup/parsing time is shown in the header instead
  const models = run.models
    .filter(m => m.started_at && m.finished_at)
    .sort((a, b) => parseUtc(a.started_at)! - parseUtc(b.started_at)!)
  const runStart = parseUtc(run.started_at) ?? nowMs
  const startMs = models.length ? parseUtc(models[0].started_at)! : runStart
  const lastModel = models.length ? Math.max(...models.map(m => parseUtc(m.finished_at)!)) : (parseUtc(run.finished_at) ?? nowMs)
  const lastEnd = Math.max(lastModel, startMs + 100)
  const endMs = lastEnd + (lastEnd - startMs) * RIGHT_PAD

  const rows: Row[] = models.map(m => {
    const s = parseUtc(m.started_at)!
    const e = parseUtc(m.finished_at)!
    return {
      key: m.unique_id,
      label: m.name,
      title: `${m.unique_id}\nThread: ${m.thread_id}`,
      bars: [{
        key: m.unique_id, start: s, end: e, color: statusColor(m.status),
        label: formatDuration((e - s) / 1000), title: modelTitle(m),
      }],
    }
  })

  return {
    startMs, endMs, nowMs: null, rows, relativeTicks: true,
    tickLabel: ms => `+${formatDuration((ms - startMs) / 1000)}`,
  }
}

function chartTicks(chart: Chart, width: number): number[] {
  const step = pickStep(chart.endMs - chart.startMs, Math.max(1, width))
  const first = chart.relativeTicks ? chart.startMs : Math.ceil(chart.startMs / step) * step
  const ticks: number[] = []
  for (let t = first; t <= chart.endMs; t += step) ticks.push(t)
  return ticks
}

function startupNote(run: RunDetail): string {
  const runStart = parseUtc(run.started_at)
  const starts = run.models.map(m => parseUtc(m.started_at)).filter((t): t is number => t !== null)
  if (runStart === null || starts.length === 0) return ''
  return ` · ${formatDuration((Math.min(...starts) - runStart) / 1000)} dbt startup before first node`
}

const CHART_MODES: { mode: ChartMode; label: string; title: string }[] = [
  { mode: 'scheduled', label: 'Scheduled for', title: 'Gantt chart with each run at the time it was scheduled for: gaps in the schedule stand out' },
  { mode: 'actual', label: 'Actual run at', title: 'Memory used by runs over the time they actually ran, stacked per job: the load on the server' },
]

interface RunsGraphProps {
  scheduler: SchedulerState
}

function RunsGraph({ scheduler }: RunsGraphProps) {
  const { runs, jobs, rangeHours, serverNow, selectedRunId, runDetail, chartMode, setChartMode } = scheduler
  const [expanded, setExpanded] = useState(false)
  const [trackWidth, setTrackWidth] = useState(0)
  const bodyRef = useRef<HTMLDivElement>(null)
  const showRun = runDetail !== null && runDetail.id === selectedRunId

  // Track width decides how dense the time axis labels can be
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setTrackWidth(el.clientWidth - LABEL_WIDTH))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Mouse wheel over the chart steps through the time ranges: up zooms in, down zooms out.
  // Shift + wheel scrolls the rows instead. Trackpads send many small events, so deltas add up
  // to a step, and steps are spaced out.
  const wheel = useRef({ total: 0, lastStep: 0 })
  const latest = useRef({ showRun, rangeHours, setRangeHours: scheduler.setRangeHours })
  latest.current = { showRun, rangeHours, setRangeHours: scheduler.setRangeHours }
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (latest.current.showRun) return
      e.preventDefault()
      if (e.shiftKey) {
        el.scrollTop += e.deltaY || e.deltaX
        return
      }
      const state = wheel.current
      const now = performance.now()
      if (now - state.lastStep < WHEEL_COOLDOWN_MS) {
        state.total = 0
        return
      }
      state.total += e.deltaY
      if (Math.abs(state.total) < WHEEL_STEP) return
      const index = RUN_RANGES.findIndex(r => r.hours === latest.current.rangeHours)
      const next = Math.min(RUN_RANGES.length - 1, Math.max(0, index + (state.total > 0 ? 1 : -1)))
      state.total = 0
      state.lastStep = now
      if (next !== index) latest.current.setRangeHours(RUN_RANGES[next].hours)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setExpanded(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  const chart = useMemo(() => (
    showRun
      ? buildRun(runDetail!, Date.now())
      : buildGlobal(runs, jobs.map(j => j.name), rangeHours, serverNow, selectedRunId, chartMode !== 'actual')
  ), [showRun, runDetail, runs, jobs, rangeHours, serverNow, selectedRunId, chartMode])
  const memoryView = !showRun && chartMode === 'actual'

  const ticks = useMemo(() => chartTicks(chart, trackWidth), [chart, trackWidth])
  const pct = (ms: number) => `${((ms - chart.startMs) / (chart.endMs - chart.startMs)) * 100}%`
  // Time labels that would run into the "Now" label (just left of the now line) are left out
  const toPx = (ms: number) => ((ms - chart.startMs) / (chart.endMs - chart.startMs)) * trackWidth
  const labelTicks = chart.nowMs === null ? ticks : ticks.filter(t => {
    const dx = toPx(chart.nowMs!) - toPx(t)
    return dx > NOW_LABEL_CLEARANCE || dx < -4
  })

  const emptyMessage = showRun
    ? (chart.rows.length === 0 ? 'No per-node timings for this run' : null)
    : (runs.every(r => !r.started_at) ? 'No runs in this period' : null)

  return (
    <div className={`graph-view ${expanded ? 'runs-graph-expanded' : ''}`}>
      <div className="graph-header">
        <div className="graph-header-left">
          <BarChart3 size={14} />
          <span className="graph-title">
            {showRun
              ? `Run #${runDetail!.id} · ${runDetail!.job_name || 'Manual run'} · nodes${startupNote(runDetail!)}`
              : memoryView ? 'Memory used by runs (UTC)' : 'Runs timeline (UTC)'}
          </span>
          {!showRun && (
            <div className="chart-mode-toggle" role="group" aria-label="Chart">
              {CHART_MODES.map(m => (
                <button
                  key={m.mode}
                  className={`graph-action-button ${chartMode === m.mode ? 'selected' : ''}`}
                  title={m.title}
                  onClick={() => setChartMode(m.mode)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="graph-header-right">
          {showRun ? (
            <button className="graph-action-button" onClick={() => scheduler.selectRun(null)}>
              <ArrowLeft size={14} /><span>All runs</span>
            </button>
          ) : RUN_RANGES.map(r => (
            <button
              key={r.hours}
              className={`graph-action-button ${rangeHours === r.hours ? 'selected' : ''}`}
              title="Or scroll over the chart to zoom (Shift + scroll moves the rows)"
              onClick={() => scheduler.setRangeHours(r.hours)}
            >
              {r.label}
            </button>
          ))}
          <button
            className="graph-action-button"
            onClick={() => setExpanded(!expanded)}
            title={expanded ? 'Collapse (Esc)' : 'Expand'}
          >
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>
      <div className="gantt" ref={bodyRef}>
        <div className="gantt-axis">
          <div className="gantt-label gantt-axis-label">{showRun ? 'Node' : memoryView ? 'Job · memory' : 'Job'}</div>
          <div className="gantt-track">
            {labelTicks.map(t => <span key={t} className="gantt-tick-label" style={{ left: pct(t) }}>{chart.tickLabel(t)}</span>)}
            {chart.nowMs !== null && <span className="gantt-now-label" style={{ left: pct(chart.nowMs) }}>Now</span>}
          </div>
        </div>
        {memoryView ? (
          <MemoryChart
            runs={runs}
            jobNames={jobs.map(j => j.name)}
            startMs={chart.startMs}
            endMs={chart.endMs}
            nowMs={serverNow}
            width={trackWidth}
            labelWidth={LABEL_WIDTH}
            gridTicks={ticks}
            pct={pct}
            onSelectRun={scheduler.selectRun}
          />
        ) : (
          <div className="gantt-rows">
            <div className="gantt-grid" style={{ left: LABEL_WIDTH }}>
              {ticks.map(t => <div key={t} className="gantt-gridline" style={{ left: pct(t) }} />)}
              {chart.nowMs !== null && <div className="gantt-now" style={{ left: pct(chart.nowMs) }} title="Now" />}
            </div>
            {chart.rows.map(row => (
              <div key={row.key} className="gantt-row">
                <div className="gantt-label" title={row.title}>{row.label}</div>
                <div className="gantt-track">
                  {row.bars.map(bar => (
                    <div
                      key={bar.key}
                      className={`timeline-bar ${bar.runId ? 'clickable' : ''} ${bar.active ? 'active' : ''} ${bar.variant ?? ''} ${bar.running ? 'running' : ''}`}
                      style={{ left: pct(bar.start), width: `calc(${pct(bar.end)} - ${pct(bar.start)})`, background: bar.color }}
                      title={bar.title}
                      onClick={bar.runId ? () => scheduler.selectRun(bar.runId!) : undefined}
                    >
                      <span>{bar.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {emptyMessage && <div className="gantt-empty">{emptyMessage}</div>}
          </div>
        )}
      </div>
    </div>
  )
}

export default RunsGraph
