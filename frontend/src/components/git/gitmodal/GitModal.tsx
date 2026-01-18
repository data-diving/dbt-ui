// Main GitModal component

import { useState, useEffect, useCallback } from 'react'
import { GitBranch, RefreshCw } from 'lucide-react'
import '../GitModal.css'
import GitCredentialsDialog from '../GitCredentialsDialog'
import { GitModalProps } from './types'
import { useGitStatus } from './hooks/useGitStatus'
import { useBranches } from './hooks/useBranches'
import { useRemoteOperations } from './hooks/useRemoteOperations'
import { useCommit } from './hooks/useCommit'
import BranchSection from './components/BranchSection'
import StagedFiles from './components/StagedFiles'
import UnstagedChanges from './components/UnstagedChanges'
import CommitSection from './components/CommitSection'

function GitModal({ projectPath, onClose, onBranchChange, onGitChange, onTreeRefresh }: GitModalProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  // Git status hook
  const {
    gitStatus,
    stagedFiles,
    selectedFiles,
    operationInProgress,
    operationMessage,
    fetchGitStatus,
    fetchStagedFiles,
    toggleFileSelection,
    selectAllUnstaged,
    deselectAll,
    stageSelectedFiles,
    unstageFile,
    getAllChangedFiles,
  } = useGitStatus({ projectPath, onGitChange })

  // Branch hook
  const {
    branchState,
    branchLoading,
    showBranchDropdown,
    showNewBranchInput,
    newBranchName,
    setShowBranchDropdown,
    setShowNewBranchInput,
    setNewBranchName,
    fetchBranches,
    handleCreateBranch,
    handleCheckoutBranch,
    handleDeleteBranch,
    isBranchDisabled,
    getBranchDisabledReason,
    canDeleteBranch,
  } = useBranches({ projectPath, onBranchChange, onGitChange, onTreeRefresh })

  // Refresh status helper
  const refreshStatus = useCallback(async () => {
    await Promise.all([fetchGitStatus(), fetchStagedFiles()])
  }, [fetchGitStatus, fetchStagedFiles])

  // Remote operations hook
  const {
    remoteState,
    pushing,
    pulling,
    showCredentialsDialog,
    pendingOperation,
    storedUsername,
    fetchBranchInfo,
    handlePush,
    handlePull,
    handleCredentialsSubmit,
    handleUseStoredCredentials,
    handleCredentialsCancel,
  } = useRemoteOperations({ projectPath, onGitChange, onTreeRefresh, onRefreshStatus: refreshStatus })

  // Commit hook
  const {
    commitMessage,
    committing,
    setCommitMessage,
    handleCommit: commitHandler,
  } = useCommit({ projectPath, stagedFiles, onGitChange, onRefreshStatus: refreshStatus })

  // Check if any operation is in progress
  const isAnyOperationInProgress = loading || branchLoading || committing || pushing || pulling || operationInProgress

  // Refresh all data
  const refreshAll = useCallback(async () => {
    setLoading(true)
    setError('')
    await Promise.all([fetchGitStatus(), fetchStagedFiles(), fetchBranches(), fetchBranchInfo()])
    setLoading(false)
  }, [fetchGitStatus, fetchStagedFiles, fetchBranches, fetchBranchInfo])

  useEffect(() => {
    refreshAll()
  }, [refreshAll])

  // Handle staging files
  const handleStageSelected = async () => {
    const result = await stageSelectedFiles()
    if (result.success) {
      setSuccessMessage('Files staged successfully')
      setTimeout(() => setSuccessMessage(''), 3000)
    } else if (result.error) {
      setError(result.error)
    }
  }

  // Handle unstaging file
  const handleUnstageFile = async (file: string) => {
    const result = await unstageFile(file)
    if (!result.success && result.error) {
      setError(result.error)
    }
  }

  // Handle commit
  const handleCommit = async () => {
    const result = await commitHandler()
    if (result.success) {
      setSuccessMessage(`Committed: ${result.commitHash}`)
      setTimeout(() => setSuccessMessage(''), 5000)
    } else if (result.error) {
      setError(result.error)
    }
  }

  // Handle branch creation
  const handleBranchCreate = async () => {
    const result = await handleCreateBranch()
    if (result.success) {
      setSuccessMessage(`Created and switched to branch: ${result.branch}`)
      setTimeout(() => setSuccessMessage(''), 3000)
    } else if (result.error) {
      setError(result.error)
    }
  }

  // Handle branch checkout
  const handleBranchCheckout = async (branch: string) => {
    const result = await handleCheckoutBranch(branch)
    if (result.success) {
      setSuccessMessage(`Switched to branch: ${branch}`)
      setTimeout(() => setSuccessMessage(''), 3000)
      await refreshStatus()
      await fetchBranchInfo()
    } else if (result.error) {
      setError(result.error)
    }
  }

  // Handle branch deletion
  const handleBranchDelete = async (branch: string) => {
    const result = await handleDeleteBranch(branch)
    if (result.success) {
      setSuccessMessage(`Deleted branch: ${branch}`)
      setTimeout(() => setSuccessMessage(''), 3000)
    } else if (result.error) {
      setError(result.error)
    }
  }

  // Handle push
  const handlePushClick = async () => {
    try {
      await handlePush()
      setSuccessMessage('Pushed successfully')
      setTimeout(() => setSuccessMessage(''), 3000)
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message)
      }
    }
  }

  // Handle pull
  const handlePullClick = async () => {
    try {
      await handlePull()
      setSuccessMessage('Pulled successfully')
      setTimeout(() => setSuccessMessage(''), 3000)
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message)
      }
    }
  }

  const changedFiles = getAllChangedFiles()
  const totalChanges = changedFiles.length + stagedFiles.length

  return (
    <div className="git-modal-overlay" onClick={onClose}>
      <div className="git-modal" onClick={(e) => e.stopPropagation()}>
        <div className="git-modal-header">
          <GitBranch size={20} />
          <h2>Git</h2>
          <button
            className="git-refresh-btn"
            onClick={refreshAll}
            disabled={isAnyOperationInProgress}
            title="Refresh"
          >
            <RefreshCw size={16} className={loading ? 'spinning' : ''} />
          </button>
        </div>

        <div className="git-modal-content">
          {/* Branch Section */}
          <BranchSection
            branchState={branchState}
            remoteState={remoteState}
            showBranchDropdown={showBranchDropdown}
            showNewBranchInput={showNewBranchInput}
            newBranchName={newBranchName}
            isAnyOperationInProgress={isAnyOperationInProgress}
            pushing={pushing}
            pulling={pulling}
            onShowBranchDropdown={setShowBranchDropdown}
            onShowNewBranchInput={setShowNewBranchInput}
            onNewBranchNameChange={setNewBranchName}
            onCheckoutBranch={handleBranchCheckout}
            onCreateBranch={handleBranchCreate}
            onDeleteBranch={handleBranchDelete}
            onPush={handlePushClick}
            onPull={handlePullClick}
            isBranchDisabled={isBranchDisabled}
            getBranchDisabledReason={getBranchDisabledReason}
            canDeleteBranch={canDeleteBranch}
          />

          {/* Progress Bar */}
          {isAnyOperationInProgress && operationMessage && (
            <div className="git-operation-progress">
              <div className="git-progress-bar">
                <div className="git-progress-fill"></div>
              </div>
              <span className="git-progress-text">{operationMessage}</span>
            </div>
          )}

          {/* Messages */}
          {error && <div className="git-modal-error">{error}</div>}
          {successMessage && <div className="git-modal-success">{successMessage}</div>}

          {loading && !operationMessage && <div className="git-modal-loading">Loading...</div>}

          {!loading && (
            <>
              {/* Staged Files Section */}
              <StagedFiles
                stagedFiles={stagedFiles}
                isAnyOperationInProgress={isAnyOperationInProgress}
                onUnstageFile={handleUnstageFile}
              />

              {/* Commit Section */}
              {stagedFiles.length > 0 && (
                <CommitSection
                  commitMessage={commitMessage}
                  isAnyOperationInProgress={isAnyOperationInProgress}
                  committing={committing}
                  onCommitMessageChange={setCommitMessage}
                  onCommit={handleCommit}
                />
              )}

              {/* Unstaged Changes Section */}
              <UnstagedChanges
                changedFiles={changedFiles}
                selectedFiles={selectedFiles}
                isAnyOperationInProgress={isAnyOperationInProgress}
                onToggleFileSelection={toggleFileSelection}
                onSelectAll={selectAllUnstaged}
                onDeselectAll={deselectAll}
                onStageSelected={handleStageSelected}
              />

              {totalChanges === 0 && (
                <div className="git-modal-no-changes">Working tree clean</div>
              )}
            </>
          )}
        </div>

        <div className="git-modal-footer">
          <button className="git-modal-ok-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {/* Credentials Dialog */}
      {showCredentialsDialog && pendingOperation && (
        <GitCredentialsDialog
          operation={pendingOperation}
          onSubmit={handleCredentialsSubmit}
          onCancel={handleCredentialsCancel}
          isLoading={pushing || pulling}
          initialUsername={storedUsername}
          hasStoredCredentials={!!storedUsername}
          onUseStored={storedUsername ? handleUseStoredCredentials : undefined}
        />
      )}
    </div>
  )
}

export default GitModal
