// Sidebar content shown instead of the file tree while the scheduler is open

import { AlertTriangle, GitBranch, History, ListChecks, Settings } from 'lucide-react'
import { ACTIVE_STATUSES } from './api'
import HelpTip from './HelpTip'
import { SchedulerState, SchedulerTab } from './useScheduler'
import './Scheduler.css'

interface SchedulerSidebarProps {
  projectName: string
  scheduler: SchedulerState
}

const MAX_CONCURRENT_HELP =
  'Set by the DBT_UI__SCHEDULER_MAX_CONCURRENT environment variable of the dbt UI backend (default 2, ' +
  'passed through docker-compose.yml, e.g. from .env). Scheduled and manual runs share this limit; ' +
  'further runs wait in a queue. Restart the backend after changing it.'

function SchedulerSidebar({ projectName, scheduler }: SchedulerSidebarProps) {
  const { context, jobs, runs, status, tab, setTab } = scheduler
  const activeRuns = runs.filter(r => ACTIVE_STATUSES.includes(r.status)).length

  const item = (key: SchedulerTab, icon: JSX.Element, label: string, badge?: string) => (
    <button
      className={`scheduler-nav-item ${tab === key ? 'active' : ''}`}
      onClick={() => {
        setTab(key)
        if (key === 'runs') scheduler.selectRun(null)
      }}
    >
      {icon}
      <span>{label}</span>
      {badge && <span className="scheduler-nav-badge">{badge}</span>}
    </button>
  )

  return (
    <div className="scheduler-sidebar">
      <div className="sidebar-header">
        <div className="sidebar-title-container">
          <span className="sidebar-title">{projectName}</span>
          <span
            className="sidebar-branch scheduler-sidebar-branch"
            title="Scheduled jobs only run code committed to the default branch"
          >
            <GitBranch size={12} />
            {context?.default_branch || '…'}
            <AlertTriangle size={12} className="scheduler-warning-icon" />
          </span>
        </div>
      </div>
      <nav className="scheduler-nav">
        {item('jobs', <ListChecks size={16} />, 'Jobs', String(jobs.length))}
        {item('runs', <History size={16} />, 'Runs', activeRuns ? `${activeRuns} active` : undefined)}
        {item('settings', <Settings size={16} />, 'Settings')}
      </nav>
      <div className="scheduler-sidebar-footer">
        All times UTC
        {status.max_concurrent ? (
          <>
            {` · up to ${status.max_concurrent} runs at a time`}
            <HelpTip text={MAX_CONCURRENT_HELP} />
          </>
        ) : null}
      </div>
    </div>
  )
}

export default SchedulerSidebar
