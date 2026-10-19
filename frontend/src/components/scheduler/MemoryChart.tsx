// Server load view of the runs timeline: memory used by dbt runs over actual time, stacked per job,
// so the top edge is the total memory the scheduler's dbt processes used

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Run, formatBytes, formatDuration, formatUtc, parseUtc, runDurationSeconds, triggerLabel,
} from './api'
import { loadUiState, saveUiState } from '../main/uiState'

const MANUAL_SERIES = 'Manual runs'
const PALETTE = ['#4e79a7', '#f28e2b', '#59a14f', '#b07aa1', '#76b7b2', '#edc948', '#ff9da7', '#9c755f', '#e15759', '#bab0ac']
const MANUAL_COLOR = '#8c8c8c'
const VIEW_HEIGHT = 1000
const Y_TICKS = 4
const HIDDEN_KEY = 'scheduler-memory-hidden-jobs'
const MAX_TOOLTIP_RUNS = 3

interface MemoryChartProps {
  runs: Run[]
  jobNames: string[]
  startMs: number
  endMs: number
  nowMs: number
  width: number
  labelWidth: number
  gridTicks: number[]
  pct: (ms: number) => string
  onSelectRun: (id: number) => void
}

interface RunSteps {
  run: Run
  steps: [number, number, number][] // [from, to, bytes]
}

interface Series {
  name: string
  color: string
  values: Float64Array // per column, bytes
  runs: RunSteps[]
}

interface Hover {
  col: number
  clientX: number
  clientY: number
  series: Series | null
  runs: RunSteps[]
}

const TOOLTIP_MARGIN = 8

// A run's memory as [from, to, bytes] steps: from its sampled profile, or for runs recorded before
// profiles existed, its average memory over the whole run
function memorySteps(run: Run, nowMs: number): [number, number, number][] {
  const start = parseUtc(run.started_at)
  if (start === null) return []
  const end = parseUtc(run.finished_at) ?? nowMs
  const profile = run.memory_profile ?? []
  if (profile.length === 0) {
    const bytes = run.avg_memory_bytes ?? run.peak_memory_bytes
    return bytes ? [[start, end, bytes]] : []
  }
  return profile.map(([seconds, bytes], i) => {
    const from = start + seconds * 1000
    const to = i + 1 < profile.length ? start + profile[i + 1][0] * 1000 : end
    return [from, Math.max(from, to), bytes]
  })
}

function MemoryChart({
  runs, jobNames, startMs, endMs, nowMs, width, labelWidth, gridTicks, pct, onSelectRun,
}: MemoryChartProps) {
  const [hover, setHover] = useState<Hover | null>(null)
  // Several runs under the cursor: a click pins the tooltip so one of them can be picked
  const [pinned, setPinned] = useState<Hover | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [hidden, setHiddenState] = useState<Set<string>>(
    () => new Set(loadUiState<string[]>(HIDDEN_KEY, [], v => Array.isArray(v))),
  )
  const plotRef = useRef<HTMLDivElement>(null)
  const columns = Math.max(50, Math.floor(width / 2))
  const colMs = (endMs - startMs) / columns

  const setHidden = (next: Set<string>) => {
    setHiddenState(next)
    saveUiState(HIDDEN_KEY, [...next])
  }

  const allSeries = useMemo(() => {
    const names = [...new Set([...jobNames, ...runs.filter(r => r.job_name).map(r => r.job_name)])].sort()
    if (runs.some(r => !r.job_name)) names.push(MANUAL_SERIES)
    const series: Series[] = names.map((name, i) => ({
      name,
      color: name === MANUAL_SERIES ? MANUAL_COLOR : PALETTE[i % PALETTE.length],
      values: new Float64Array(columns),
      runs: [],
    }))
    const byName = new Map(series.map(s => [s.name, s]))
    for (const run of runs) {
      const steps = memorySteps(run, nowMs).filter(([from, to]) => to >= startMs && from <= endMs && to > from)
      if (steps.length) byName.get(run.job_name || MANUAL_SERIES)?.runs.push({ run, steps })
    }

    // Per job, memory in use over time is the sum of its runs' samples at each moment (runs that
    // overlap add up, runs one after another don't); each column shows that sum's highest value
    for (const target of series) {
      const events: [number, number][] = target.runs.flatMap(({ steps }) =>
        steps.flatMap(([from, to, bytes]) => [[from, bytes], [to, -bytes]] as [number, number][]))
      events.sort((a, b) => a[0] - b[0] || a[1] - b[1]) // at the same moment, ends before starts
      let level = 0
      for (let i = 0; i < events.length; i++) {
        level += events[i][1]
        const from = events[i][0]
        const to = i + 1 < events.length ? events[i + 1][0] : from
        if (level <= 0 || to <= from) continue
        const first = Math.max(0, Math.floor((from - startMs) / colMs))
        const last = Math.min(columns - 1, Math.floor((to - startMs) / colMs))
        for (let c = first; c <= last; c++) target.values[c] = Math.max(target.values[c], level)
      }
    }
    return series
  }, [runs, jobNames, startMs, endMs, nowMs, columns, colMs])

  const series = allSeries.filter(s => !hidden.has(s.name))
  const totals = useMemo(() => {
    const t = new Float64Array(columns)
    series.forEach(s => s.values.forEach((v, c) => { t[c] += v }))
    return t
  }, [series, columns]) // eslint-disable-line react-hooks/exhaustive-deps
  const maxTotal = Math.max(...totals, 0)
  const yMax = maxTotal > 0 ? maxTotal * 1.15 : 1024 * 1024 * 1024
  const y = (bytes: number) => VIEW_HEIGHT - (bytes / yMax) * VIEW_HEIGHT

  // Stacked step areas: each visible series sits on top of the ones before it
  const polygons = useMemo(() => {
    const base = new Float64Array(columns)
    return series.map(s => {
      const top: string[] = []
      const bottom: string[] = []
      for (let c = 0; c < columns; c++) {
        const lower = base[c]
        const upper = lower + s.values[c]
        top.push(`${c},${y(upper)}`, `${c + 1},${y(upper)}`)
        bottom.unshift(`${c + 1},${y(lower)}`, `${c},${y(lower)}`)
        base[c] = upper
      }
      return { ...s, points: [...top, ...bottom].join(' ') }
    })
  }, [series, columns, yMax]) // eslint-disable-line react-hooks/exhaustive-deps

  const yTicks = Array.from({ length: Y_TICKS }, (_, i) => (yMax / Y_TICKS) * (i + 1))
  const hoverMs = hover ? startMs + (hover.col + 0.5) * colMs : null
  const peakOf = (s: Series) => Math.max(...s.values, 0)

  // The job under the cursor is the band it points at; its runs are those running in that column
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const col = Math.floor(((e.clientX - rect.left) / rect.width) * columns)
    if (col < 0 || col >= columns || startMs + col * colMs > nowMs) {
      setHover(null)
      return
    }
    const bytesAt = (1 - (e.clientY - rect.top) / rect.height) * yMax
    let lower = 0
    let target: Series | null = null
    for (const s of series) {
      const upper = lower + s.values[col]
      if (s.values[col] > 0 && bytesAt >= lower && bytesAt < upper) target = s
      lower = upper
    }
    const colStart = startMs + col * colMs
    const colEnd = colStart + colMs
    const active = target
      ? target.runs
        .filter(({ steps }) => steps.some(([from, to]) => from < colEnd && to >= colStart))
        .sort((a, b) => (b.run.peak_memory_bytes ?? 0) - (a.run.peak_memory_bytes ?? 0))
      : []
    setHover({ col, clientX: e.clientX, clientY: e.clientY, series: target, runs: active })
  }

  const onClick = () => {
    if (!hover?.runs.length) return
    if (hover.runs.length === 1) onSelectRun(hover.runs[0].run.id)
    else setPinned(hover)
  }

  const tip = pinned ?? (hover && hover.series && hover.runs.length > 0 ? hover : null)

  // Keep the tooltip inside the window: next to the cursor, flipped or shifted when it would overflow
  useLayoutEffect(() => {
    const el = tooltipRef.current
    if (!el || !tip) return
    const { width, height } = el.getBoundingClientRect()
    let left = tip.clientX + 14
    if (left + width > window.innerWidth - TOOLTIP_MARGIN) left = tip.clientX - 14 - width
    let top = tip.clientY - 10
    if (top + height > window.innerHeight - TOOLTIP_MARGIN) top = window.innerHeight - TOOLTIP_MARGIN - height
    el.style.left = `${Math.max(TOOLTIP_MARGIN, left)}px`
    el.style.top = `${Math.max(TOOLTIP_MARGIN, top)}px`
  })

  useEffect(() => {
    if (!pinned) return
    const close = (e: KeyboardEvent | MouseEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !tooltipRef.current?.contains(e.target as Node)) {
        setPinned(null)
      }
    }
    // Registered after the click that pinned it has finished
    const id = setTimeout(() => {
      window.addEventListener('keydown', close)
      window.addEventListener('mousedown', close)
    })
    return () => {
      clearTimeout(id)
      window.removeEventListener('keydown', close)
      window.removeEventListener('mousedown', close)
    }
  }, [pinned])

  const allVisible = hidden.size === 0
  const toggleAll = () => setHidden(allVisible ? new Set(allSeries.map(s => s.name)) : new Set())
  const toggle = (name: string) => {
    const next = new Set(hidden)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setHidden(next)
  }

  return (
    <div className="memory-chart">
      <div className="memory-legend" style={{ flexBasis: labelWidth }}>
        <div className="memory-legend-title">
          {hoverMs !== null
            ? `${new Date(hoverMs).toISOString().slice(5, 16).replace('T', ' ')} UTC`
            : 'Peak in range'}
        </div>
        <label className="memory-legend-row">
          <input
            type="checkbox"
            checked={allVisible}
            ref={el => { if (el) el.indeterminate = !allVisible && hidden.size < allSeries.length }}
            onChange={toggleAll}
          />
          <span className="memory-legend-name">All</span>
        </label>
        {allSeries.map(s => (
          <label key={s.name} className={`memory-legend-row ${hidden.has(s.name) ? 'off' : ''}`} title={s.name}>
            <input type="checkbox" checked={!hidden.has(s.name)} onChange={() => toggle(s.name)} />
            <span className="memory-swatch" style={{ background: s.color }} />
            <span className="memory-legend-name">{s.name}</span>
            <span className="memory-legend-value">
              {hidden.has(s.name) ? '' : formatBytes(hover ? s.values[hover.col] : peakOf(s))}
            </span>
          </label>
        ))}
        <div className="memory-legend-row total">
          <span className="memory-legend-name">Total shown</span>
          <span className="memory-legend-value">{formatBytes(hover ? totals[hover.col] : maxTotal)}</span>
        </div>
      </div>
      <div
        ref={plotRef}
        className={`memory-plot ${hover?.runs.length ? 'pointing' : ''}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onClick={onClick}
      >
        {gridTicks.map(t => <div key={t} className="gantt-gridline" style={{ left: pct(t) }} />)}
        {yTicks.map(v => (
          <div key={v} className="memory-ygrid" style={{ top: `${(y(v) / VIEW_HEIGHT) * 100}%` }}>
            <span>{formatBytes(v)}</span>
          </div>
        ))}
        <svg viewBox={`0 0 ${columns} ${VIEW_HEIGHT}`} preserveAspectRatio="none">
          {polygons.map(p => (
            <polygon
              key={p.name}
              points={p.points}
              fill={p.color}
              fillOpacity={hover?.series && hover.series.name !== p.name ? 0.45 : 0.8}
            />
          ))}
        </svg>
        <div className="gantt-now" style={{ left: pct(nowMs) }} title="Now" />
        {hoverMs !== null && <div className="memory-hover" style={{ left: pct(hoverMs) }} />}
        {tip && (
          <div ref={tooltipRef} className={`memory-tooltip ${pinned ? 'pinned' : ''}`}>
            {(pinned ? tip.runs : tip.runs.slice(0, MAX_TOOLTIP_RUNS)).map(({ run }) => (
              <div
                key={run.id}
                className="memory-tooltip-run"
                onClick={pinned ? () => { setPinned(null); onSelectRun(run.id) } : undefined}
              >
                <div className="memory-tooltip-title">
                  <span className="memory-swatch" style={{ background: tip.series!.color }} />
                  #{run.id} {run.job_name || 'Manual run'} — {run.status}
                </div>
                <div>dbt {run.command}{run.selector ? ` -s ${run.selector}` : ''}</div>
                {run.scheduled_for && <div>Scheduled for: {formatUtc(run.scheduled_for, true)} UTC</div>}
                <div>Started: {formatUtc(run.started_at, true)} UTC</div>
                <div>Duration: {formatDuration(runDurationSeconds(run, nowMs))}</div>
                <div>Peak memory: {formatBytes(run.peak_memory_bytes)}</div>
                <div>Triggered by: {triggerLabel(run)}</div>
              </div>
            ))}
            {!pinned && tip.runs.length > MAX_TOOLTIP_RUNS && (
              <div className="muted">and {tip.runs.length - MAX_TOOLTIP_RUNS} more runs here</div>
            )}
            <div className="muted">
              {pinned
                ? 'Click a run to open it · Esc or click outside to close'
                : tip.runs.length > 1 ? 'Click to pick one of these runs' : 'Click to open the run'}
            </div>
          </div>
        )}
        {maxTotal === 0 && (
          <div className="gantt-empty">
            {allSeries.length && series.length === 0 ? 'All jobs are hidden' : 'No memory recorded for runs in this period'}
          </div>
        )}
      </div>
    </div>
  )
}

export default MemoryChart
