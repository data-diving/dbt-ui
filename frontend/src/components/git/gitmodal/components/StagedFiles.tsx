// Staged files section component for GitModal

import { Check } from 'lucide-react'

interface StagedFilesProps {
  stagedFiles: string[]
  isAnyOperationInProgress: boolean
  onUnstageFile: (file: string) => void
}

export default function StagedFiles({
  stagedFiles,
  isAnyOperationInProgress,
  onUnstageFile,
}: StagedFilesProps) {
  return (
    <div className="git-section">
      <div className="git-section-header">
        <h3>Staged Changes ({stagedFiles.length})</h3>
      </div>
      {stagedFiles.length > 0 ? (
        <ul className="git-file-list staged">
          {stagedFiles.map((file, idx) => (
            <li key={idx} className="git-file-item staged">
              <Check size={12} className="staged-icon" />
              <span className="git-file-name">{file}</span>
              <button
                className="git-unstage-btn"
                onClick={() => onUnstageFile(file)}
                disabled={isAnyOperationInProgress}
                title="Unstage"
              >
                −
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="git-empty-section">No staged changes</div>
      )}
    </div>
  )
}
