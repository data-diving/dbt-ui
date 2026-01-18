import { useState, useEffect } from 'react'
import { GitBranch } from 'lucide-react'
import './GitSetupDialog.css'

const GIT_CONFIG_KEY = 'dbt-ui-git-config'

interface GitConfig {
  userName: string
  userEmail: string
}

interface GitSetupDialogProps {
  onComplete: (config: GitConfig) => void
  initialConfig?: GitConfig | null
  isEditing?: boolean
}

function GitSetupDialog({ onComplete, initialConfig, isEditing }: GitSetupDialogProps) {
  const [userName, setUserName] = useState(initialConfig?.userName || '')
  const [userEmail, setUserEmail] = useState(initialConfig?.userEmail || '')
  const [error, setError] = useState('')

  // Load saved config on mount (only if not editing)
  useEffect(() => {
    if (isEditing) return // Skip auto-complete when editing

    try {
      const stored = localStorage.getItem(GIT_CONFIG_KEY)
      if (stored) {
        const config: GitConfig = JSON.parse(stored)
        // If we have saved config, skip this dialog
        if (config.userName && config.userEmail) {
          onComplete(config)
        }
      }
    } catch (e) {
      console.error('Failed to load git config:', e)
    }
  }, [onComplete, isEditing])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const trimmedName = userName.trim()
    const trimmedEmail = userEmail.trim()

    if (!trimmedName) {
      setError('Please enter your name')
      return
    }

    if (!trimmedEmail) {
      setError('Please enter your email')
      return
    }

    // Basic email validation
    if (!trimmedEmail.includes('@')) {
      setError('Please enter a valid email address')
      return
    }

    const config: GitConfig = {
      userName: trimmedName,
      userEmail: trimmedEmail,
    }

    // Save to localStorage
    try {
      localStorage.setItem(GIT_CONFIG_KEY, JSON.stringify(config))
    } catch (e) {
      console.error('Failed to save git config:', e)
    }

    onComplete(config)
  }

  return (
    <div className="git-setup-overlay">
      <div className="git-setup-container">
        <div className="git-setup-icon">
          <GitBranch size={48} />
        </div>
        <h1 className="git-setup-title">{isEditing ? 'Edit Profile' : 'Welcome to dbt UI'}</h1>
        <p className="git-setup-subtitle">
          {isEditing ? 'Update your Git credentials' : 'Please enter your Git credentials to identify your commits'}
        </p>
        <form onSubmit={handleSubmit}>
          <div className="git-setup-field">
            <label htmlFor="userName">Name</label>
            <input
              id="userName"
              type="text"
              placeholder="Your Name"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="git-setup-field">
            <label htmlFor="userEmail">Email</label>
            <input
              id="userEmail"
              type="email"
              placeholder="your.email@example.com"
              value={userEmail}
              onChange={(e) => setUserEmail(e.target.value)}
            />
          </div>
          {error && <p className="git-setup-error">{error}</p>}
          <button type="submit" className="git-setup-button">
            {isEditing ? 'Save Changes' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default GitSetupDialog
export type { GitConfig }
