// Sidebar header component

import {
  GitBranch,
  HelpCircle,
  FilePlus,
  Edit3,
  Trash2,
  ArchiveRestore
} from 'lucide-react'

interface SidebarHeaderProps {
  projectName: string
  projectPath: string
  branchName: string
  selectedFile: string | null
  selectedIsDeleted: boolean
  onCreateFile: () => void
  onRenameClick: () => void
  onDeleteClick: () => void
  onRestoreClick: () => void
}

function SidebarHeader({
  projectName,
  projectPath,
  branchName,
  selectedFile,
  selectedIsDeleted,
  onCreateFile,
  onRenameClick,
  onDeleteClick,
  onRestoreClick
}: SidebarHeaderProps) {
  return (
    <div className="sidebar-header" title={projectPath}>
      <div className="sidebar-title-container">
        <span className="sidebar-title">{projectName || projectPath.split('/').pop()}</span>
        {branchName && (
          <span className="sidebar-branch">
            <GitBranch size={12} />
            {branchName}
            <span
              className="sidebar-branch-help"
              title={`This branch is not checked out in the repository's root folder on the server. `
                + `It lives in a git worktree created for you:\n${projectPath}\n`
                + `Each user has their own worktree, so your changes don't affect other users until you push them.`}
            >
              <HelpCircle size={11} />
            </span>
          </span>
        )}
      </div>
      <div className="sidebar-header-actions">
        <button className="header-action-button" title="Create file" onClick={onCreateFile}>
          <FilePlus size={16} />
        </button>
        <button className="header-action-button" title="Rename file" onClick={onRenameClick} disabled={!selectedFile || selectedIsDeleted}>
          <Edit3 size={16} />
        </button>
        {selectedIsDeleted ? (
          <button className="header-action-button restore" title="Restore file" onClick={onRestoreClick}>
            <ArchiveRestore size={16} />
          </button>
        ) : (
          <button className="header-action-button" title="Delete file" onClick={onDeleteClick} disabled={!selectedFile}>
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </div>
  )
}

export default SidebarHeader
