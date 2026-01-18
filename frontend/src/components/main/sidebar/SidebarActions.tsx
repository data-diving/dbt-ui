// Sidebar action buttons component

import {
  Play,
  RefreshCw,
  GitBranch,
  PackageOpen,
  FolderSearch
} from 'lucide-react'

interface SidebarActionsProps {
  isDbtOperationRunning?: boolean
  compilingModels?: Set<string>
  venvMissing?: boolean
  dbtModalOpen?: boolean
  manifestMissing: boolean
  hasModifiedFiles: boolean
  isRunning: boolean
  isCompiling: boolean
  hasUnsavedChanges: boolean
  onRunClick: () => void
  onCompileClick: () => void
  onGitClick: () => void
  onRecreateVenv?: () => void
  onChangeProject?: () => void
}

function SidebarActions({
  isDbtOperationRunning,
  compilingModels,
  venvMissing,
  dbtModalOpen,
  manifestMissing,
  hasModifiedFiles,
  isRunning,
  isCompiling,
  onRunClick,
  onCompileClick,
  onGitClick,
  onRecreateVenv,
  onChangeProject
}: SidebarActionsProps) {
  const isDisabled = isDbtOperationRunning || (compilingModels && compilingModels.size > 0) || dbtModalOpen

  return (
    <div className="sidebar-actions">
      <button
        className="action-button"
        title="Run dbt"
        onClick={onRunClick}
        disabled={isDisabled || isRunning || venvMissing}
      >
        <Play size={18} />
      </button>
      <button
        className={`action-button ${manifestMissing ? 'glow' : ''}`}
        title="Compile"
        onClick={onCompileClick}
        disabled={isDisabled || isCompiling || venvMissing}
      >
        <RefreshCw size={18} />
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
