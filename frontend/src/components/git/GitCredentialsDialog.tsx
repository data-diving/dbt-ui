import { useState, useEffect, useRef } from 'react'
import './GitCredentialsDialog.css'

interface GitCredentialsDialogProps {
  onSubmit: (username: string, password: string, saveCredentials: boolean) => void
  onCancel: () => void
  operation: string  // e.g., "clone", "push", "pull"
  isLoading?: boolean
  initialUsername?: string  // Pre-fill username from stored credentials
  hasStoredCredentials?: boolean  // True if credentials are stored (allows "use stored" option)
  onUseStored?: () => void  // Called when user wants to use stored credentials
}

function GitCredentialsDialog({
  onSubmit,
  onCancel,
  operation,
  isLoading = false,
  initialUsername = '',
  hasStoredCredentials = false,
  onUseStored
}: GitCredentialsDialogProps) {
  const [username, setUsername] = useState(initialUsername)
  const [password, setPassword] = useState('')
  const [saveCredentials, setSaveCredentials] = useState(true)
  const passwordInputRef = useRef<HTMLInputElement>(null)
  const usernameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Focus appropriate input on mount
    // If we have stored credentials, don't auto-focus (user might just confirm)
    // Otherwise focus username or password based on what's pre-filled
    const timer = setTimeout(() => {
      if (hasStoredCredentials) {
        // Don't auto-focus, user might just click "Use Saved"
      } else if (initialUsername) {
        passwordInputRef.current?.focus()
      } else {
        usernameInputRef.current?.focus()
      }
    }, 100)
    return () => clearTimeout(timer)
  }, [initialUsername, hasStoredCredentials])

  const handleSubmit = () => {
    if (!username || !password) return
    onSubmit(username, password, saveCredentials)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && username && password && !isLoading) {
      handleSubmit()
    } else if (e.key === 'Escape') {
      onCancel()
    }
  }

  return (
    <div className="git-creds-overlay" onClick={onCancel}>
      <div className="git-creds-dialog" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <h3>Authentication Required</h3>
        <p>Enter your Git credentials to {operation} the repository.</p>
        <p className="git-creds-hint">
          For GitHub, use a Personal Access Token as the password.
        </p>

        {/* Show "Use Saved Credentials" button if credentials are stored */}
        {hasStoredCredentials && onUseStored && (
          <div className="git-creds-saved-section">
            <button
              className="git-creds-btn-saved"
              onClick={onUseStored}
              disabled={isLoading}
            >
              {isLoading ? 'Authenticating...' : `Use Saved Credentials (${initialUsername})`}
            </button>
            <div className="git-creds-divider">
              <span>or enter different credentials</span>
            </div>
          </div>
        )}

        <div className="git-creds-form">
          <input
            type="text"
            ref={usernameInputRef}
            className="git-creds-username"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={isLoading}
          />
          <input
            type="password"
            ref={passwordInputRef}
            placeholder="Password / Token"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
          />
          <label className="git-creds-save-checkbox">
            <input
              type="checkbox"
              checked={saveCredentials}
              onChange={(e) => setSaveCredentials(e.target.checked)}
              disabled={isLoading}
            />
            <span>Remember credentials</span>
          </label>
          <div className="git-creds-buttons">
            <button
              className="git-creds-btn-primary"
              onClick={handleSubmit}
              disabled={!username || !password || isLoading}
            >
              {isLoading ? 'Authenticating...' : 'Submit'}
            </button>
            <button className="git-creds-btn-secondary" onClick={onCancel} disabled={isLoading}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default GitCredentialsDialog
