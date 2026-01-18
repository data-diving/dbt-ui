import { AlertTriangle } from 'lucide-react'
import MonacoEditor from '@monaco-editor/react'
import './ConflictModal.css'

interface ConflictModalProps {
  diskContent: string
  myContent: string
  fileName?: string
  onCancel: () => void
  onAcceptIncoming: () => void
  onAcceptMyChanges: () => void
  onSaveWithConflicts: () => void
}

function ConflictModal({
  diskContent,
  myContent,
  fileName,
  onCancel,
  onAcceptIncoming,
  onAcceptMyChanges,
  onSaveWithConflicts,
}: ConflictModalProps) {
  // Determine language from file extension
  const getLanguage = (file?: string) => {
    if (!file) return 'plaintext'
    const ext = file.split('.').pop()?.toLowerCase()
    switch (ext) {
      case 'sql': return 'sql'
      case 'yml': case 'yaml': return 'yaml'
      case 'json': return 'json'
      case 'md': return 'markdown'
      case 'py': return 'python'
      case 'js': return 'javascript'
      case 'ts': return 'typescript'
      default: return 'plaintext'
    }
  }

  const language = getLanguage(fileName)

  return (
    <div className="conflict-modal-overlay" onClick={onCancel}>
      <div className="conflict-modal" onClick={(e) => e.stopPropagation()}>
        <div className="conflict-modal-header">
          <AlertTriangle size={20} className="conflict-icon" />
          <h3>File Conflict Detected</h3>
        </div>
        <div className="conflict-modal-content">
          <p>
            This file was modified by another user while you were editing it.
            Compare the versions below and choose how to proceed.
          </p>
          <div className="conflict-diff-container">
            <div className="conflict-diff-pane">
              <div className="conflict-diff-header">Incoming (Disk Version)</div>
              <div className="conflict-diff-editor">
                <MonacoEditor
                  height="100%"
                  language={language}
                  theme="vs-dark"
                  value={diskContent}
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    fontSize: 12,
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    wordWrap: 'on',
                  }}
                />
              </div>
            </div>
            <div className="conflict-diff-pane">
              <div className="conflict-diff-header">My Changes</div>
              <div className="conflict-diff-editor">
                <MonacoEditor
                  height="100%"
                  language={language}
                  theme="vs-dark"
                  value={myContent}
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    fontSize: 12,
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    wordWrap: 'on',
                  }}
                />
              </div>
            </div>
          </div>
        </div>
        <div className="conflict-modal-actions">
          <button className="conflict-modal-btn conflict-modal-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="conflict-modal-btn conflict-modal-incoming"
            onClick={onAcceptIncoming}
          >
            Accept Incoming
          </button>
          <button
            className="conflict-modal-btn conflict-modal-mine"
            onClick={onAcceptMyChanges}
          >
            Accept My Changes
          </button>
          <button
            className="conflict-modal-btn conflict-modal-conflicts"
            onClick={onSaveWithConflicts}
          >
            Save with Conflicts
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConflictModal
