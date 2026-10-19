// Sidebar action buttons component

import {
  Clock,
  FolderTree,
  GitBranch,
  PackageOpen,
  FolderSearch
} from 'lucide-react'

interface SidebarActionsProps {
  isDbtOperationRunning?: boolean
  venvMissing?: boolean
  dbtModalOpen?: boolean
  hasModifiedFiles: boolean
  schedulerOpen: boolean
  schedulerAvailable: boolean
  schedulerTitle: string
  onFilesClick: () => void
  onSchedulerClick: () => void
  onGitClick: () => void
  onRecreateVenv?: () => void
  onChangeProject?: () => void
}

function SidebarActions({
  isDbtOperationRunning,
  venvMissing,
  dbtModalOpen,
  hasModifiedFiles,
  schedulerOpen,
  schedulerAvailable,
  schedulerTitle,
  onFilesClick,
  onSchedulerClick,
  onGitClick,
  onRecreateVenv,
  onChangeProject
}: SidebarActionsProps) {
  return (
    <div className="sidebar-actions">
      <button
        className={`action-button ${schedulerOpen ? '' : 'active'}`}
        title="Files and editor"
        onClick={onFilesClick}
      >
        <FolderTree size={18} />
      </button>
      <button
        className={`action-button ${schedulerOpen ? 'active' : ''}`}
        title={schedulerTitle}
        onClick={onSchedulerClick}
        disabled={!schedulerAvailable}
      >
        <Clock size={18} />
      </button>
      <button
        className={`action-button ${hasModifiedFiles ? 'glow' : ''}`}
        title="Git"
        onClick={onGitClick}
      >
        <GitBranch size={18} />
      </button>
      <button
        className={`action-button ${venvMissing ? 'glow' : ''}`}
        title="Create virtual environment"
        onClick={onRecreateVenv}
        disabled={isDbtOperationRunning || dbtModalOpen}
      >
        <PackageOpen size={18} />
      </button>
      <button
        className="action-button"
        title="Select another project"
        onClick={onChangeProject}
      >
        <FolderSearch size={18} />
      </button>
    </div>
  )
}

export default SidebarActions
