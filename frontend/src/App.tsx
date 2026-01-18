import { useState, useEffect } from 'react'
import './App.css'
import GitSetupDialog, { GitConfig } from './components/git/GitSetupDialog'
import ProjectPathDialog from './components/main/ProjectPathDialog'
import MainLayout from './components/main/MainLayout'
import { apiUrl, apiFetch } from './config/api'

const STORAGE_KEY = 'dbt-ui-project-path'
const GIT_CONFIG_KEY = 'dbt-ui-git-config'
const RECENT_PROJECTS_KEY = 'dbt-ui-recent-projects'
const MAX_RECENT_PROJECTS = 3

interface RecentProject {
  path: string
  name: string
  displayPath: string  // Original input (git URL or local path)
  lastOpened: number
}

function App() {
  const [gitConfig, setGitConfig] = useState<GitConfig | null>(null)
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [dbtVersion, setDbtVersion] = useState<string>('')
  const [isValidating, setIsValidating] = useState(true)
  const [isEditingGitConfig, setIsEditingGitConfig] = useState(false)
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([])

  // Load recent projects from localStorage
  const loadRecentProjects = (): RecentProject[] => {
    try {
      const stored = localStorage.getItem(RECENT_PROJECTS_KEY)
      if (stored) {
        return JSON.parse(stored)
      }
    } catch (e) {
      console.error('Failed to load recent projects:', e)
    }
    return []
  }

  // Save a project to recent projects list
  const saveToRecentProjects = (path: string, displayPath: string, projectName?: string) => {
    const projects = loadRecentProjects()

    // Use dbt project name if available, otherwise extract from displayPath
    let name = projectName
    if (!name) {
      if (displayPath.includes('://') || displayPath.startsWith('git@')) {
        // Git URL - extract repo name
        const match = displayPath.match(/\/([^/]+?)(\.git)?$/)
        name = match ? match[1] : displayPath
      } else {
        // Local path - use last segment
        name = displayPath.split('/').filter(Boolean).pop() || displayPath
      }
    }

    // Remove if already exists (by worktree path)
    const filtered = projects.filter((p) => p.path !== path)

    // Add to front
    const updated: RecentProject[] = [
      { path, name, displayPath, lastOpened: Date.now() },
      ...filtered,
    ].slice(0, MAX_RECENT_PROJECTS)

    try {
      localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(updated))
      setRecentProjects(updated)
    } catch (e) {
      console.error('Failed to save recent projects:', e)
    }
  }

  // Check for existing git config on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(GIT_CONFIG_KEY)
      if (stored) {
        const config: GitConfig = JSON.parse(stored)
        if (config.userName && config.userEmail) {
          setGitConfig(config)
        }
      }
    } catch (e) {
      console.error('Failed to load git config:', e)
    }

    // Load recent projects
    setRecentProjects(loadRecentProjects())
  }, [])

  // On mount, try to restore the last project path
  useEffect(() => {
    const restoreProject = async () => {
      const savedPath = localStorage.getItem(STORAGE_KEY)
      if (savedPath) {
        try {
          // Validate the saved path still exists
          const response = await apiFetch(apiUrl('/api/validate-path'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: savedPath }),
          })
          if (response.ok) {
            setProjectPath(savedPath)
          } else {
            // Path no longer valid, clear it
            localStorage.removeItem(STORAGE_KEY)
          }
        } catch {
          // Backend not available, clear saved path
          localStorage.removeItem(STORAGE_KEY)
        }
      }
      setIsValidating(false)
    }
    restoreProject()
  }, [])

  const handlePathSubmit = (path: string, version: string, displayPath: string, projectName?: string) => {
    localStorage.setItem(STORAGE_KEY, path)
    saveToRecentProjects(path, displayPath, projectName)
    setProjectPath(path)
    setDbtVersion(version)
  }

  const handleChangeProject = () => {
    localStorage.removeItem(STORAGE_KEY)
    setProjectPath(null)
  }

  const handleGitSetupComplete = (config: GitConfig) => {
    setGitConfig(config)
    setIsEditingGitConfig(false)
  }

  const handleEditGitConfig = () => {
    setIsEditingGitConfig(true)
  }

  // Show nothing while validating saved path
  if (isValidating) {
    return <div className="app" />
  }

  // Show git setup dialog if not configured or if editing
  if (!gitConfig || isEditingGitConfig) {
    return (
      <div className="app">
        <GitSetupDialog
          onComplete={handleGitSetupComplete}
          initialConfig={gitConfig}
          isEditing={isEditingGitConfig}
        />
      </div>
    )
  }

  return (
    <div className="app">
      {!projectPath ? (
        <ProjectPathDialog
          gitConfig={gitConfig}
          onSubmit={handlePathSubmit}
          onEditUser={handleEditGitConfig}
          recentProjects={recentProjects}
        />
      ) : (
        <MainLayout projectPath={projectPath} dbtVersion={dbtVersion} onChangeProject={handleChangeProject} />
      )}
    </div>
  )
}

export default App
