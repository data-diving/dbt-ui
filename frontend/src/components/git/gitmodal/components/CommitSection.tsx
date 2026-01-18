// Commit section component for GitModal

interface CommitSectionProps {
  commitMessage: string
  isAnyOperationInProgress: boolean
  committing: boolean
  onCommitMessageChange: (message: string) => void
  onCommit: () => void
}

export default function CommitSection({
  commitMessage,
  isAnyOperationInProgress,
  committing,
  onCommitMessageChange,
  onCommit,
}: CommitSectionProps) {
  return (
    <div className="git-commit-section">
      <textarea
        className="git-commit-input"
        placeholder="Commit message"
        value={commitMessage}
        onChange={(e) => onCommitMessageChange(e.target.value)}
        disabled={isAnyOperationInProgress}
        rows={3}
      />
      <button
        className="git-commit-btn"
        onClick={onCommit}
        disabled={isAnyOperationInProgress || !commitMessage.trim()}
      >
        {committing ? 'Committing...' : 'Commit'}
      </button>
    </div>
  )
}
