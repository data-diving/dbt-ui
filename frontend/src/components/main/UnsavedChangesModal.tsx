import './UnsavedChangesModal.css'

interface UnsavedChangesModalProps {
  onClose: () => void
  onSave: () => void
  onDiscard: () => void
  action: string // e.g., "compile", "run", "test"
}

function UnsavedChangesModal({ onClose, onSave, onDiscard, action }: UnsavedChangesModalProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="unsaved-changes-modal-overlay" onClick={onClose} onKeyDown={handleKeyDown}>
      <div className="unsaved-changes-modal" onClick={e => e.stopPropagation()}>
        <div className="unsaved-changes-modal-header">
          <h3>Unsaved Changes</h3>
        </div>
        <div className="unsaved-changes-modal-content">
          <p>You have unsaved changes. Do you want to save before {action}?</p>
        </div>
        <div className="unsaved-changes-modal-actions">
          <button
            className="unsaved-changes-modal-cancel"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="unsaved-changes-modal-discard"
            onClick={onDiscard}
          >
            Don't Save
          </button>
          <button
            className="unsaved-changes-modal-save"
            onClick={onSave}
            autoFocus
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

export default UnsavedChangesModal
