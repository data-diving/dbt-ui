// Settings > All projects: how many jobs and runs every project on this dbt UI instance has,
// so you can see whether something is scheduled outside the project you have open

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { ProjectOverview, formatUtc, schedulerApi } from './api'
import StatusBadge from './StatusBadge'

interface ProjectsOverviewProps {
  currentProjectKey: string
}

function ProjectsOverview({ currentProjectKey }: ProjectsOverviewProps) {
  const [projects, setProjects] = useState<ProjectOverview[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { projects: next } = await schedulerApi.projects()
      // Current project first, then alphabetical (as sorted by the backend)
      setProjects([
        ...next.filter(p => p.project_key === currentProjectKey),
        ...next.filter(p => p.project_key !== currentProjectKey),
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [currentProjectKey])

  useEffect(() => { load() }, [load])

  return (
    <div className="scheduler-projects-overview">
      <div className="scheduler-toolbar">
        <p className="muted">Number of jobs and runs of every project on this dbt UI instance.</p>
        <button className="scheduler-icon-button" title="Refresh" disabled={loading} onClick={load}>
          <RefreshCw size={14} />
        </button>
      </div>

      {error && <div className="scheduler-error-text block">{error}</div>}
      {projects && projects.length === 0 && <div className="scheduler-hint">No project has jobs or runs yet.</div>}

      {projects && projects.length > 0 && (
        <table className="scheduler-table compact">
          <thead>
            <tr><th>Project</th><th>Jobs</th><th>Runs</th><th>Last run (UTC)</th></tr>
          </thead>
          <tbody>
            {projects.map(project => (
              <tr key={project.project_key}>
                <td title={project.upstream_url || 'No upstream git remote'}>
                  {project.repo}
                  {project.subdirectory && <span className="muted mono"> / {project.subdirectory}</span>}
                  {project.project_key === currentProjectKey && <span className="scheduler-default-label">current</span>}
                </td>
                <td>{project.jobs}</td>
                <td>{project.runs}</td>
                <td>
                  {project.last_run
                    ? <><StatusBadge status={project.last_run.status} /> <span className="muted">{formatUtc(project.last_run.at)}</span></>
                    : <span className="muted">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default ProjectsOverview
