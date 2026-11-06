// Recent projects list shared by the project dialog and the folder browser (stored in localStorage)

export const RECENT_PROJECTS_KEY = 'dbt-ui-recent-projects'
const MAX_RECENT_PROJECTS = 3

export interface RecentProject {
  path: string         // Worktree path the project was opened from
  name: string
  displayPath: string  // Original input (git URL or local path); used to reopen the project
  lastOpened: number
}

const nameFromDisplayPath = (displayPath: string): string => {
  if (displayPath.includes('://') || displayPath.startsWith('git@')) {
    // Git URL - extract repo name
    const match = displayPath.match(/\/([^/]+?)(\.git)?$/)
    return match ? match[1] : displayPath
  }
  // Local path - use last segment
  return displayPath.split('/').filter(Boolean).pop() || displayPath
}

// Accepts entries in the current shape and the older { path, displayPath } shape the folder
// browser used to write (there, path was the folder itself and displayPath only a label)
const normalize = (entry: unknown): RecentProject | null => {
  if (!entry || typeof entry !== 'object') return null
  const e = entry as Partial<RecentProject>
  if (typeof e.path !== 'string' || !e.path) return null
  const isLegacy = typeof e.name !== 'string'
  const displayPath = !isLegacy && typeof e.displayPath === 'string' && e.displayPath ? e.displayPath : e.path
  return {
    path: e.path,
    name: isLegacy ? nameFromDisplayPath(displayPath) : (e.name as string),
    displayPath,
    lastOpened: typeof e.lastOpened === 'number' ? e.lastOpened : 0,
  }
}

export const loadRecentProjects = (): RecentProject[] => {
  try {
    const stored = localStorage.getItem(RECENT_PROJECTS_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed)) {
        return parsed.map(normalize).filter((p): p is RecentProject => p !== null)
      }
    }
  } catch (e) {
    console.error('Failed to load recent projects:', e)
  }
  return []
}

// Record an opened project at the top of the list; returns the updated list
export const saveRecentProject = (path: string, displayPath: string, projectName?: string): RecentProject[] => {
  // Use dbt project name if available, otherwise derive it from displayPath
  const name = projectName || nameFromDisplayPath(displayPath)

  // Drop the same project (by worktree path or by the input it was opened from)
  const filtered = loadRecentProjects().filter(p => p.path !== path && p.displayPath !== displayPath)

  const updated: RecentProject[] = [
    { path, name, displayPath, lastOpened: Date.now() },
    ...filtered,
  ].slice(0, MAX_RECENT_PROJECTS)

  try {
    localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(updated))
  } catch (e) {
    console.error('Failed to save recent projects:', e)
  }
  return updated
}
