import { useState, useEffect } from 'react'
import { Folder, FolderOpen, ChevronRight, Clock } from 'lucide-react'
import './FolderBrowser.css'
import { apiUrl, apiFetch } from '../../config/api'

const RECENT_PROJECTS_KEY = 'dbt-ui-recent-projects'
const MAX_RECENT_PROJECTS = 3

interface RecentProject {
  path: string
  displayPath: string
}

interface FolderBrowserProps {
  onSelect: (path: string) => void
  onClose: () => void
}

interface Directory {
  name: string
  path: string
  isParent: boolean
  isDbtProject?: boolean
}

function FolderBrowser({ onSelect, onClose }: FolderBrowserProps) {
  const [currentPath, setCurrentPath] = useState('')
  const [displayPath, setDisplayPath] = useState('')
  const [directories, setDirectories] = useState<Directory[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([])

  // Load recent projects from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_PROJECTS_KEY)
      if (stored) {
        setRecentProjects(JSON.parse(stored))
      }
    } catch (e) {
      console.error('Failed to load recent projects:', e)
    }
  }, [])

  const loadDirectories = async (path?: string) => {
    setLoading(true)
    setError('')

    try {
      const response = await apiFetch(apiUrl('/api/browse-directories'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: path || '' }),
      })

      if (!response.ok) {
        throw new Error('Failed to load directories')
      }

      const data = await response.json()
      setCurrentPath(data.currentPath)
      setDisplayPath(data.displayPath || data.currentPath)
      setDirectories(data.directories)
    } catch (err: any) {
      setError('Failed to load directories. Is the backend running?')
      console.error('Error loading directories:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDirectories()
  }, [])

  const handleDirectoryClick = (directory: Directory) => {
    loadDirectories(directory.path)
  }

  const saveToRecentProjects = (path: string, display: string) => {
    const newRecent: RecentProject = { path, displayPath: display }
    const filtered = recentProjects.filter(p => p.path !== path)
    const updated = [newRecent, ...filtered].slice(0, MAX_RECENT_PROJECTS)
    setRecentProjects(updated)
    try {
      localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(updated))
    } catch (e) {
      console.error('Failed to save recent projects:', e)
    }
  }

  const handleSelectCurrent = () => {
    saveToRecentProjects(currentPath, displayPath)
    onSelect(currentPath)
  }

  const handleRecentClick = (recent: RecentProject) => {
    saveToRecentProjects(recent.path, recent.displayPath)
    onSelect(recent.path)
  }

  return (
    <div className="folder-browser-overlay" onClick={onClose}>
      <div className="folder-browser-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="folder-browser-header">
          <h2>Select Project</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="current-path">
          <span className="path-label">Path:</span>
          <span className="path-value">{displayPath}</span>
        </div>

        <div className="directory-list">
          {loading && <div className="loading">Loading...</div>}
          {error && <div className="error">{error}</div>}
          {!loading && !error && directories.length === 0 && (
            <div className="empty">No directories found</div>
          )}
          {!loading && !error && directories.map((dir, index) => (
            <div
              key={index}
              className={`directory-item ${dir.isDbtProject ? 'dbt-project' : ''}`}
              onClick={() => handleDirectoryClick(dir)}
            >
              <div className="directory-icon">
                {dir.isParent ? (
                  <ChevronRight size={16} style={{ transform: 'rotate(180deg)' }} />
                ) : dir.isDbtProject ? (
                  <FolderOpen size={16} />
                ) : (
                  <Folder size={16} />
                )}
              </div>
              <div className="directory-name">
                {dir.name}
                {dir.isDbtProject && <span className="dbt-badge">dbt</span>}
              </div>
            </div>
          ))}
        </div>

        {recentProjects.length > 0 && (
          <div className="recent-projects">
            <div className="recent-projects-header">
              <Clock size={14} />
              <span>Recent</span>
            </div>
            <div className="recent-projects-list">
              {recentProjects.map((recent, index) => (
                <div
                  key={index}
                  className="recent-project-item"
                  onClick={() => handleRecentClick(recent)}
                >
                  <FolderOpen size={14} />
                  <span>{recent.displayPath}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="folder-browser-footer">
          <button className="cancel-button" onClick={onClose}>
            Cancel
          </button>
          <button className="select-button" onClick={handleSelectCurrent}>
            Select Current Folder
          </button>
        </div>
      </div>
    </div>
  )
}

export default FolderBrowser
