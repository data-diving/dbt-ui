// Unstaged changes section component for GitModal

import { FileEdit, FilePlus, FileX } from 'lucide-react'
import { ChangedFile } from '../types'

interface UnstagedChangesProps {
  changedFiles: ChangedFile[]
  selectedFiles: Set<string>
  isAnyOperationInProgress: boolean
  onToggleFileSelection: (file: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onStageSelected: () => void
}

export default function UnstagedChanges({
  changedFiles,
  selectedFiles,
  isAnyOperationInProgress,
  onToggleFileSelection,
  onSelectAll,
  onDeselectAll,
  onStageSelected,
}: UnstagedChangesProps) {
  return (
    <div className="git-section">
      <div className="git-section-header">
        <h3>Changes ({changedFiles.length})</h3>
        {changedFiles.length > 0 && (
          <div className="git-section-actions">
            <button className="git-link-btn" onClick={onSelectAll} disabled={isAnyOperationInProgress}>
              Select All
            </button>
            {selectedFiles.size > 0 && (
              <button className="git-link-btn" onClick={onDeselectAll} disabled={isAnyOperationInProgress}>
                Deselect
              </button>
            )}
          </div>
        )}
      </div>
      {changedFiles.length > 0 ? (
        <>
          <ul className="git-file-list">
            {changedFiles.map(({ file, type }, idx) => (
              <li
                key={idx}
                className={`git-file-item ${type} ${selectedFiles.has(file) ? 'selected' : ''}`}
                onClick={() => onToggleFileSelection(file)}
              >
                <input
                  type="checkbox"
                  checked={selectedFiles.has(file)}
                  onChange={() => onToggleFileSelection(file)}
                  onClick={(e) => e.stopPropagation()}
                />
                {type === 'modified' && <FileEdit size={12} />}
                {type === 'untracked' && <FilePlus size={12} />}
                {type === 'deleted' && <FileX size={12} />}
                <span className="git-file-name">{file}</span>
              </li>
            ))}
          </ul>
          {selectedFiles.size > 0 && (
            <button className="git-stage-btn" onClick={onStageSelected} disabled={isAnyOperationInProgress}>
              Stage Selected ({selectedFiles.size})
            </button>
          )}
        </>
      ) : (
        <div className="git-empty-section">No unstaged changes</div>
      )}
    </div>
  )
}
