// Hook for managing git commit operations

import { useState, useCallback } from 'react'
import { apiUrl, apiFetch } from '../../../../config/api'
import { getGitConfig } from '../types'

interface UseCommitProps {
  projectPath: string
  stagedFiles: string[]
  onGitChange?: () => void
  onRefreshStatus: () => Promise<void>
}

interface UseCommitReturn {
  commitMessage: string
  committing: boolean
  setCommitMessage: (message: string) => void
  handleCommit: () => Promise<{ success: boolean; error?: string; commitHash?: string }>
}

export function useCommit({
  projectPath,
  stagedFiles,
  onGitChange,
  onRefreshStatus,
}: UseCommitProps): UseCommitReturn {
  const [commitMessage, setCommitMessage] = useState('')
  const [committing, setCommitting] = useState(false)

  const handleCommit = useCallback(async (): Promise<{ success: boolean; error?: string; commitHash?: string }> => {
    if (!commitMessage.trim()) {
      return { success: false, error: 'Please enter a commit message' }
    }

    if (stagedFiles.length === 0) {
      return { success: false, error: 'No files staged for commit' }
    }

    const gitConfig = getGitConfig()
    if (!gitConfig) {
      return { success: false, error: 'Git user configuration not found' }
    }

    setCommitting(true)

    try {
      const response = await apiFetch(apiUrl('/api/git-commit'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: projectPath,
          message: commitMessage,
          user_name: gitConfig.userName,
          user_email: gitConfig.userEmail,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setCommitMessage('')
        await onRefreshStatus()
        onGitChange?.()
        return { success: true, commitHash: data.commit_hash }
      } else {
        const data = await response.json()
        return { success: false, error: data.detail || 'Failed to create commit' }
      }
    } catch (err) {
      console.error('Error creating commit:', err)
      return { success: false, error: 'Failed to create commit' }
    } finally {
      setCommitting(false)
    }
  }, [commitMessage, stagedFiles, projectPath, onRefreshStatus, onGitChange])

  return {
    commitMessage,
    committing,
    setCommitMessage,
    handleCommit,
  }
}
