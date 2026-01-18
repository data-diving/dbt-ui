import { useState, useEffect } from 'react'
import { FolderOpen, Clock, X } from 'lucide-react'
import FolderBrowser from './FolderBrowser'
import GitCredentialsDialog from '../git/GitCredentialsDialog'
import './ProjectPathDialog.css'
import { apiUrl, apiFetch, cloneGitRepo } from '../../config/api'

interface GitConfig {
  userName: string
  userEmail: string
}

interface RecentProject {
  path: string
  name: string
  displayPath: string
  lastOpened: number
}

interface ProjectPathDialogProps {
  gitConfig: GitConfig
  onSubmit: (path: string, dbtVersion: string, displayPath: string, projectName?: string) => void
  onEditUser?: () => void
  recentProjects?: RecentProject[]
}

function ProjectPathDialog({ gitConfig, onSubmit, onEditUser, recentProjects = [] }: ProjectPathDialogProps) {
  const [path, setPath] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState('')
  const [showBrowser, setShowBrowser] = useState(false)
  const [isGitUrl, setIsGitUrl] = useState(false)
  const [showCredentialsDialog, setShowCredentialsDialog] = useState(false)
  const [pendingGitUrl, setPendingGitUrl] = useState('')
  const [storedUsername, setStoredUsername] = useState('')  // Username from stored credentials

  // Check if input is a Git URL
  const detectGitUrl = (input: string): boolean => {
    const gitUrlPatterns = [
      /^https?:\/\//i,  // http:// or https://
      /^git@/i,         // git@github.com:user/repo.git
      /^git:\/\//i,     // git://
      /\.git$/i         // ends with .git
    ]
    return gitUrlPatterns.some(pattern => pattern.test(input.trim()))
  }

  // Extract project name from dbt_project.yml content (simple YAML parsing)
  const extractProjectName = (content: string): string | undefined => {
    // Look for "name: project_name" or "name: 'project_name'" or 'name: "project_name"'
    const match = content.match(/^name:\s*['"]?([^'"\n]+)['"]?\s*$/m)
    return match ? match[1].trim() : undefined
  }

  // Fetch dbt project name from dbt_project.yml
  const fetchProjectName = async (projectPath: string): Promise<string | undefined> => {
    try {
      const response = await apiFetch(apiUrl('/api/read-file'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: projectPath,
          filePath: 'dbt_project.yml',
        }),
      })
      if (response.ok) {
        const data = await response.json()
        return extractProjectName(data.content)
      }
    } catch (err) {
      console.error('Failed to fetch project name:', err)
    }
    return undefined
  }

  // Update isGitUrl when path changes
  useEffect(() => {
    setIsGitUrl(detectGitUrl(path))
  }, [path])

  // Load default path on mount
  useEffect(() => {
    const loadDefaultPath = async () => {
      try {
        const response = await apiFetch(apiUrl('/api/default-project-path'))
        if (response.ok) {
          const data = await response.json()
          setPath(data.path)
        }
      } catch (err) {
        console.error('Failed to load default path:', err)
      }
    }
    loadDefaultPath()
  }, [])

  // Continue after successful clone (handles worktree setup)
  const continueAfterClone = async (validatedPath: string, subdirectory: string, displayPath: string) => {
    // Setup worktree for user isolation
    setLoadingMessage('Setting up workspace...')
    const worktreeResponse = await apiFetch(apiUrl('/api/setup-worktree'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        path: validatedPath,
        user_name: gitConfig.userName,
        user_email: gitConfig.userEmail,
        subdirectory: subdirectory,
      }),
    })

    if (!worktreeResponse.ok) {
      const errorData = await worktreeResponse.json()
      setError(errorData.detail || 'Failed to setup workspace')
      setLoading(false)
      return
    }

    const worktreeData = await worktreeResponse.json()

    // Try to fetch the dbt project name
    const projectName = await fetchProjectName(worktreeData.worktree_path)

    // Use the worktree path instead of the original repo path
    // Pass original input as displayPath for recent projects
    onSubmit(worktreeData.worktree_path, '', displayPath, projectName)
  }

  // Handle credentials submission from the dialog
  const handleCredentialsSubmit = async (username: string, password: string, saveCredentials: boolean) => {
    setLoading(true)
    setLoadingMessage('Cloning repository...')
    setError('')

    const result = await cloneGitRepo(pendingGitUrl, {
      username,
      password,
      saveCredentials,
    })

    if (result.success) {
      setShowCredentialsDialog(false)
      setPendingGitUrl('')
      setStoredUsername('')
      await continueAfterClone(result.data.path, result.data.subdirectory || '', pendingGitUrl)
    } else if (result.authRequired) {
      setError('Invalid credentials. Please try again.')
      setLoading(false)
    } else {
      setError(result.error || 'Failed to clone Git repository')
      setLoading(false)
      setShowCredentialsDialog(false)
      setPendingGitUrl('')
    }
  }

  const handleCredentialsCancel = () => {
    setShowCredentialsDialog(false)
    setPendingGitUrl('')
    setStoredUsername('')
    setLoading(false)
  }

  // Handle using stored credentials
  const handleUseStoredCredentials = async () => {
    setLoading(true)
    setLoadingMessage('Cloning repository...')
    setError('')

    const result = await cloneGitRepo(pendingGitUrl, {
      saveCredentials: true,
      useStored: true,
    })

    if (result.success) {
      setShowCredentialsDialog(false)
      setPendingGitUrl('')
      setStoredUsername('')
      await continueAfterClone(result.data.path, result.data.subdirectory || '', pendingGitUrl)
    } else if (result.authRequired) {
      setError('Stored credentials are invalid. Please enter new credentials.')
      setLoading(false)
    } else {
      setError(result.error || 'Failed to clone Git repository')
      setLoading(false)
      setShowCredentialsDialog(false)
      setPendingGitUrl('')
      setStoredUsername('')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!path.trim()) {
      setError('Please enter a path or Git URL')
      return
    }

    setLoading(true)
    setError('')

    try {
      let validatedPath = ''
      let subdirectory = ''

      if (isGitUrl) {
        // Clone Git repository
        setLoadingMessage('Opening project...')
        const result = await cloneGitRepo(path.trim())

        if (result.success) {
          validatedPath = result.data.path
          subdirectory = result.data.subdirectory || ''
        } else if (result.authRequired) {
          // Authentication is required, show credentials dialog
          setPendingGitUrl(path.trim())
          setStoredUsername(result.storedUsername || '')
          setShowCredentialsDialog(true)
          setLoading(false)
          return
        } else {
          setError(result.error || 'Failed to clone Git repository')
          setLoading(false)
          return
        }
      } else {
        // Validate local file path
        setLoadingMessage('Validating path...')
        const response = await apiFetch(apiUrl('/api/validate-path'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ path: path.trim() }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          setError(errorData.detail || 'Invalid project path')
          setLoading(false)
          return
        }

        const data = await response.json()
        validatedPath = data.path
      }

      // Continue with worktree setup
      await continueAfterClone(validatedPath, subdirectory, path.trim())
    } catch (err: any) {
      setError('Failed to connect to backend server.')
      console.error('Validation error:', err)
      setLoading(false)
    }
  }

  const handleBrowseClick = () => {
    setShowBrowser(true)
  }

  const handleFolderSelect = (selectedPath: string) => {
    setPath(selectedPath)
    setShowBrowser(false)
  }

  const handleRecentProjectClick = (displayPath: string) => {
    setPath(displayPath)
  }

  return (
    <div className="dialog-overlay">
      <div className="dialog-container">
        <h1 className="dialog-title">dbt UI</h1>
        <p className="dialog-subtitle">Open a dbt project</p>
        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <div className="input-wrapper">
              <input
                type="text"
                className="path-input"
                placeholder="Enter Git URL or path to dbt project folder"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                autoFocus
                disabled={loading}
              />
              {path && !loading && (
                <button
                  type="button"
                  className="clear-button"
                  onClick={() => setPath('')}
                  title="Clear"
                >
                  <X size={16} />
                </button>
              )}
            </div>
            {!isGitUrl && (
              <button
                type="button"
                className="browse-button"
                onClick={handleBrowseClick}
                disabled={loading}
                title="Browse folders"
              >
                <FolderOpen size={18} />
              </button>
            )}
          </div>
          <p className="open-as-user">
            open as{' '}
            <a
              href="#"
              className="user-link"
              onClick={(e) => {
                e.preventDefault()
                onEditUser?.()
              }}
            >
              {gitConfig.userName}
            </a>
          </p>
          {error && <p className="error-message">{error}</p>}

          {loading && !error ? (
            <div className="progress-container">
              <div className="progress-bar">
                <div className="progress-fill"></div>
              </div>
              <p className="progress-text">{loadingMessage}</p>
            </div>
          ) : (
            <button type="submit" className="submit-button" disabled={loading}>
              Open Project
            </button>
          )}
        </form>

        {recentProjects.length > 0 && (
          <div className="recent-projects">
            <div className="recent-projects-header">
              <Clock size={14} />
              <span>Recent Projects</span>
            </div>
            <ul className="recent-projects-list">
              {recentProjects.map((project) => (
                <li key={project.path}>
                  <button
                    className="recent-project-item"
                    onClick={() => handleRecentProjectClick(project.displayPath || project.path)}
                    disabled={loading}
                    title={project.displayPath || project.path}
                  >
                    <span className="recent-project-name">{project.name}</span>
                    <span className="recent-project-path">{project.displayPath || project.path}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {showBrowser && (
        <FolderBrowser
          onSelect={handleFolderSelect}
          onClose={() => setShowBrowser(false)}
        />
      )}

      {showCredentialsDialog && (
        <GitCredentialsDialog
          operation="clone"
          onSubmit={handleCredentialsSubmit}
          onCancel={handleCredentialsCancel}
          isLoading={loading}
          initialUsername={storedUsername}
          hasStoredCredentials={!!storedUsername}
          onUseStored={storedUsername ? handleUseStoredCredentials : undefined}
        />
      )}
    </div>
  )
}

export default ProjectPathDialog
