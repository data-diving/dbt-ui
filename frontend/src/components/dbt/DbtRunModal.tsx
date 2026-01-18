import { useState } from 'react'
import './DbtRunModal.css'

interface DbtRunModalProps {
  onClose: () => void
  onRun: (selector: string, fullRefresh?: boolean) => void
  isRunning: boolean
  initialSelector?: string
  mode?: 'run' | 'test' | 'compile' | 'seed'
  target?: string
}

// Validate dbt selector to prevent command injection
// Only allow: alphanumeric, underscores, dots, colons, plus, at, asterisk, spaces, and dbt operators
const isValidDbtSelector = (selector: string): boolean => {
  if (!selector.trim()) return true // Empty is valid (runs all models)

  // dbt selector syntax allows:
  // - model names: alphanumeric, underscores
  // - path selectors: path:models/staging
  // - tag selectors: tag:daily
  // - config selectors: config.materialized:table
  // - graph operators: + (ancestors), @ (ancestors + descendants)
  // - set operators: model1 model2 (space-separated union)
  // - intersection: model1,model2 (comma for intersection in some contexts)
  // - wildcards: * for matching
  // - method selectors: method:selector_value

  // Disallow dangerous characters that could enable shell injection
  const dangerousChars = /[;&|`$(){}[\]<>\\'"!#%^~\n\r]/
  if (dangerousChars.test(selector)) {
    return false
  }

  // Only allow safe characters for dbt selectors
  // Alphanumeric, underscore, dot, colon, plus, at, asterisk, hyphen, slash, space, comma
  const safePattern = /^[a-zA-Z0-9_.:+@*\-/\s,]+$/
  return safePattern.test(selector)
}

function DbtRunModal({ onClose, onRun, isRunning, initialSelector = '', mode = 'run', target = '' }: DbtRunModalProps) {
  const [selector, setSelector] = useState(initialSelector)
  const [error, setError] = useState('')
  const [fullRefresh, setFullRefresh] = useState(false)

  const isTestMode = mode === 'test'
  const isCompileMode = mode === 'compile'
  const isSeedMode = mode === 'seed'
  const isRunMode = mode === 'run'
  const showFullRefresh = isRunMode || isSeedMode // Only show for run and seed modes
  const actionLabel = isCompileMode ? 'Compile' : isTestMode ? 'Test' : isSeedMode ? 'Seed' : 'Run'
  const runningLabel = isCompileMode ? 'Compiling...' : isTestMode ? 'Testing...' : isSeedMode ? 'Seeding...' : 'Running...'
  const targetSuffix = target ? ` on target "${target}"` : ''
  const selectorLabel = isSeedMode ? 'Seed selector (optional)' : 'Model selector (optional)'

  const handleSelectorChange = (value: string) => {
    setSelector(value)
    if (value && !isValidDbtSelector(value)) {
      setError('Invalid characters in selector. Only model names, paths, tags, and dbt operators (+, @, *, :) are allowed.')
    } else {
      setError('')
    }
  }

  const handleRun = () => {
    if (!isValidDbtSelector(selector)) {
      setError('Invalid selector')
      return
    }
    onRun(selector.trim(), fullRefresh)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !error && !isRunning) {
      handleRun()
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="dbt-run-modal-overlay" onClick={onClose}>
      <div className="dbt-run-modal" onClick={e => e.stopPropagation()}>
        <div className="dbt-run-modal-header">
          <h3>{actionLabel} dbt{targetSuffix}</h3>
        </div>
        <div className="dbt-run-modal-content">
          <label htmlFor="dbt-selector">{selectorLabel}</label>
          <input
            id="dbt-selector"
            type="text"
            placeholder={isSeedMode ? "e.g., seed_name, tag:daily" : "e.g., model_name, +model_name, tag:daily"}
            value={selector}
            onChange={e => handleSelectorChange(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            disabled={isRunning}
          />
          {error && <p className="dbt-run-modal-error">{error}</p>}
          <p className="dbt-run-modal-hint">
            {isSeedMode ? (
              <>
                Leave empty to run all seeds, or use dbt selectors like:
                <br />
                <code>seed_name</code> - single seed
                <br />
                <code>tag:daily</code> - seeds with tag
              </>
            ) : (
              <>
                Leave empty to select all models, or use dbt selectors like:
                <br />
                <code>model_name</code> - single model
                <br />
                <code>+model_name</code> - model and its ancestors
                <br />
                <code>model_name+</code> - model and its descendants
                <br />
                <code>tag:daily</code> - models with tag
                <br />
                <code>path:models/staging</code> - models in path
              </>
            )}
          </p>
          {showFullRefresh && (
            <label className={`dbt-run-modal-checkbox ${fullRefresh ? 'checked' : ''}`}>
              <input
                type="checkbox"
                checked={fullRefresh}
                onChange={e => setFullRefresh(e.target.checked)}
                disabled={isRunning}
              />
              <span>Full Refresh</span>
            </label>
          )}
        </div>
        <div className="dbt-run-modal-actions">
          <button
            className="dbt-run-modal-cancel"
            onClick={onClose}
            disabled={isRunning}
          >
            Cancel
          </button>
          <button
            className="dbt-run-modal-run"
            onClick={handleRun}
            disabled={!!error || isRunning}
          >
            {isRunning ? runningLabel : actionLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default DbtRunModal
