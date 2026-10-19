// Shared scheduler state for the scheduler panel (top pane) and runs graph (bottom pane)

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ACTIVE_STATUSES, DEFAULT_RUN_FILTERS, Job, RUN_RANGES, Run, RunDetail, RunFilters, SchedulerContext, SchedulerStatus, schedulerApi,
} from './api'
import { loadUiState, saveUiState } from '../main/uiState'

export type SchedulerTab = 'jobs' | 'runs' | 'settings'
// Runs timeline: a Gantt chart by scheduled time, or a memory chart by actual run time
export type ChartMode = 'scheduled' | 'actual'

const SCHEDULER_TABS: SchedulerTab[] = ['jobs', 'runs', 'settings']
const RANGE_KEY = 'scheduler-range-hours'
const TAB_KEY = 'scheduler-tab'
const FILTERS_KEY = 'scheduler-run-filters'
const CHART_MODE_KEY = 'scheduler-chart-mode'

const STATUS_POLL_MS = 30000
const DATA_POLL_MS = 4000

export interface SchedulerState {
  status: SchedulerStatus
  context: SchedulerContext | null
  jobs: Job[]
  runs: Run[]
  serverNow: number
  rangeHours: number
  setRangeHours: (hours: number) => void
  runFilters: RunFilters
  setRunFilters: (filters: RunFilters) => void
  chartMode: ChartMode
  setChartMode: (mode: ChartMode) => void
  selectedRunId: number | null
  selectRun: (id: number | null) => void
  runDetail: RunDetail | null
  error: string | null
  loading: boolean
  refresh: () => Promise<void>
  tab: SchedulerTab
  setTab: (tab: SchedulerTab) => void
}

export const DISABLED_STATUS: SchedulerStatus = { enabled: false, ready: false, error: '' }

export function schedulerButtonTitle(status: SchedulerStatus): string {
  if (!status.enabled) {
    return 'Scheduler is disabled. Start dbt UI with docker-compose.yml (DBT_UI__SCHEDULER_ENABLED=true)'
  }
  if (!status.ready) return `Scheduler unavailable: ${status.error || 'starting...'}`
  return 'Scheduler'
}

export function useScheduler(projectPath: string, active: boolean): SchedulerState {
  const [status, setStatus] = useState<SchedulerStatus>(DISABLED_STATUS)
  const [context, setContext] = useState<SchedulerContext | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [serverNow, setServerNow] = useState<number>(Date.now())
  const [rangeHours, setRangeHoursState] = useState(() =>
    loadUiState(RANGE_KEY, 24, v => RUN_RANGES.some(r => r.hours === v)))
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTabState] = useState<SchedulerTab>(() =>
    loadUiState<SchedulerTab>(TAB_KEY, 'jobs', v => SCHEDULER_TABS.includes(v as SchedulerTab)))
  const setRangeHours = useCallback((hours: number) => {
    setRangeHoursState(hours)
    saveUiState(RANGE_KEY, hours)
  }, [])
  const setTab = useCallback((next: SchedulerTab) => {
    setTabState(next)
    saveUiState(TAB_KEY, next)
  }, [])
  // Merged with the defaults, so filters added later start with their default value
  const [runFilters, setRunFiltersState] = useState<RunFilters>(() => ({
    ...DEFAULT_RUN_FILTERS,
    ...loadUiState<Partial<RunFilters>>(FILTERS_KEY, {}, v => typeof v === 'object' && v !== null),
  }))
  const setRunFilters = useCallback((filters: RunFilters) => {
    setRunFiltersState(filters)
    saveUiState(FILTERS_KEY, filters)
  }, [])
  const [chartMode, setChartModeState] = useState<ChartMode>(() =>
    loadUiState<ChartMode>(CHART_MODE_KEY, 'scheduled', v => v === 'scheduled' || v === 'actual'))
  const setChartMode = useCallback((mode: ChartMode) => {
    setChartModeState(mode)
    saveUiState(CHART_MODE_KEY, mode)
  }, [])
  const chartModeRef = useRef(chartMode)
  chartModeRef.current = chartMode
  const rangeRef = useRef(rangeHours)
  rangeRef.current = rangeHours
  const filtersRef = useRef(runFilters)
  filtersRef.current = runFilters

  // Status is polled even while the scheduler is closed, for the sidebar clock button
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const next = await schedulerApi.status()
        if (!cancelled) setStatus(next)
      } catch {
        if (!cancelled) setStatus(DISABLED_STATUS)
      }
    }
    load()
    const id = setInterval(load, STATUS_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!projectPath) return
    try {
      const [ctx, jobList, runList] = await Promise.all([
        schedulerApi.context(projectPath),
        schedulerApi.listJobs(projectPath),
        schedulerApi.listRuns(projectPath, rangeRef.current, filtersRef.current, chartModeRef.current === 'actual'),
      ])
      setContext(ctx)
      setJobs(jobList.jobs)
      setRuns(runList.runs)
      setServerNow(Date.parse(runList.now))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [projectPath])

  // Poll jobs and runs while the scheduler is open
  useEffect(() => {
    if (!active || !status.ready) return
    let cancelled = false
    setLoading(true)
    refresh().finally(() => !cancelled && setLoading(false))
    const id = setInterval(refresh, DATA_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [active, status.ready, refresh, rangeHours, runFilters, chartMode])

  // Selected run details, refreshed while the run is active
  useEffect(() => {
    if (!active || selectedRunId === null) {
      setRunDetail(null)
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const load = async () => {
      try {
        const detail = await schedulerApi.getRun(selectedRunId)
        if (cancelled) return
        setRunDetail(detail)
        if (ACTIVE_STATUSES.includes(detail.status)) timer = setTimeout(load, 2000)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    }
    load()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [active, selectedRunId])

  return {
    status, context, jobs, runs, serverNow, rangeHours, setRangeHours, runFilters, setRunFilters, chartMode, setChartMode,
    selectedRunId, selectRun: setSelectedRunId, runDetail, error, loading, refresh, tab, setTab,
  }
}
