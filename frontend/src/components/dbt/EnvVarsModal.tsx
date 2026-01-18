import { useState, useEffect } from 'react'
import { X, Variable, FileCode, Loader2 } from 'lucide-react'
import './EnvVarsModal.css'
import { apiUrl, apiFetch } from '../../config/api'

interface EnvVarsModalProps {
  projectPath: string
  onClose: () => void
  onFileClick?: (filePath: string) => void
}

interface EnvVarInfo {
  name: string
  files: string[]
  default_value: string | null
}

interface EnvVarWithValue extends EnvVarInfo {
  currentValue: string
  editedValue: string
}

function EnvVarsModal({ projectPath, onClose, onFileClick }: EnvVarsModalProps) {
  const [envVars, setEnvVars] = useState<EnvVarWithValue[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    loadEnvVars()
  }, [projectPath])

  const loadEnvVars = async () => {
    setLoading(true)
    setError('')

    try {
      // Fetch scanned env vars and current values in parallel
      // Use credentials: 'include' to send HttpOnly cookies
      const [scanResponse, currentResponse] = await Promise.all([
        apiFetch(apiUrl('/api/scan-env-vars'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ path: projectPath }),
        }),
        apiFetch(apiUrl('/api/get-env-vars'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ path: projectPath }),
        }),
      ])

      if (!scanResponse.ok) {
        throw new Error('Failed to scan environment variables')
      }

      const scanData = await scanResponse.json()
      const currentData = currentResponse.ok ? await currentResponse.json() : { env_vars: {} }

      // Merge scanned vars with current values
      const merged: EnvVarWithValue[] = scanData.env_vars.map((envVar: EnvVarInfo) => ({
        ...envVar,
        currentValue: currentData.env_vars[envVar.name] || envVar.default_value || '',
        editedValue: currentData.env_vars[envVar.name] || envVar.default_value || '',
      }))

      setEnvVars(merged)
    } catch (err: any) {
      setError(err.message || 'Failed to load environment variables')
      console.error('Error loading env vars:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleValueChange = (name: string, value: string) => {
    setEnvVars(prev =>
      prev.map(envVar =>
        envVar.name === name ? { ...envVar, editedValue: value } : envVar
      )
    )
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')

    try {
      // Build env vars object with edited values
      const envVarsToSave: Record<string, string> = {}
      envVars.forEach(envVar => {
        if (envVar.editedValue) {
          envVarsToSave[envVar.name] = envVar.editedValue
        }
      })

      // Use credentials: 'include' to receive and store HttpOnly cookies
      const response = await apiFetch(apiUrl('/api/set-env-vars'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          path: projectPath,
          env_vars: envVarsToSave,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.detail || 'Failed to save environment variables')
      }

      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to save environment variables')
      console.error('Error saving env vars:', err)
    } finally {
      setSaving(false)
    }
  }

  const hasChanges = envVars.some(v => v.currentValue !== v.editedValue)

  return (
    <div className="env-vars-modal-overlay" onClick={onClose}>
      <div className="env-vars-modal" onClick={e => e.stopPropagation()}>
        <div className="env-vars-modal-header">
          <div className="env-vars-modal-title">
            <Variable size={20} />
            <h2>Environment Variables</h2>
          </div>
          <button className="env-vars-close-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="env-vars-modal-content">
          {loading && (
            <div className="env-vars-loading">
              <Loader2 className="spin" size={24} />
              <span>Scanning project files...</span>
            </div>
          )}

          {error && <div className="env-vars-error">{error}</div>}

          {!loading && !error && envVars.length === 0 && (
            <div className="env-vars-empty">
              No environment variables found in project files.
            </div>
          )}

          {!loading && !error && envVars.length > 0 && (
            <div className="env-vars-list">
              <div className="env-vars-list-header">
                <span className="env-var-name-header">Variable</span>
                <span className="env-var-value-header">Value</span>
              </div>
              {envVars.map(envVar => (
                <div key={envVar.name} className="env-var-item">
                  <div className="env-var-info">
                    <div className="env-var-name">{envVar.name}</div>
                    <div className="env-var-files">
                      <FileCode size={12} />
                      <span>
                        {envVar.files.length} file{envVar.files.length !== 1 ? 's' : ''}:
                      </span>
                      <span className="env-var-files-list">
                        {envVar.files.map((file, idx) => (
                          <span key={file}>
                            <button
                              className="env-var-file-link"
                              onClick={() => {
                                if (onFileClick) {
                                  onFileClick(file)
                                  onClose()
                                }
                              }}
                              title={file}
                            >
                              {file.split('/').pop()}
                            </button>
                            {idx < envVar.files.length - 1 && ', '}
                          </span>
                        ))}
                      </span>
                    </div>
                    {envVar.default_value && (
                      <div className="env-var-default">
                        Default: {envVar.default_value}
                      </div>
                    )}
                  </div>
                  <div className="env-var-value">
                    <input
                      type="text"
                      value={envVar.editedValue}
                      onChange={e => handleValueChange(envVar.name, e.target.value)}
                      placeholder="Enter value..."
                      className={envVar.currentValue !== envVar.editedValue ? 'modified' : ''}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="env-vars-modal-footer">
          <span className="env-vars-count">
            {envVars.length} variable{envVars.length !== 1 ? 's' : ''} found
          </span>
          <div className="env-vars-actions">
            <button className="env-vars-cancel-button" onClick={onClose}>
              Cancel
            </button>
            <button
              className="env-vars-save-button"
              onClick={handleSave}
              disabled={saving || !hasChanges}
            >
              {saving ? (
                <>
                  <Loader2 className="spin" size={16} />
                  Saving...
                </>
              ) : (
                'Save'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default EnvVarsModal
