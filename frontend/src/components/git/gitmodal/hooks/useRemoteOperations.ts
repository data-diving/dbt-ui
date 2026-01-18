// Hook for managing remote git operations (push/pull)

import { useState, useCallback } from 'react'
import { apiUrl, apiFetch, gitPush, gitPull } from '../../../../config/api'
import { RemoteState } from '../types'

interface UseRemoteOperationsProps {
  projectPath: string
  onGitChange?: () => void
  onTreeRefresh?: () => void
  onRefreshStatus: () => Promise<void>
}

interface UseRemoteOperationsReturn {
  remoteState: RemoteState
  pushing: boolean
  pulling: boolean
  showCredentialsDialog: boolean
  pendingOperation: 'push' | 'pull' | null
  storedUsername: string
  fetchBranchInfo: () => Promise<void>
  handlePush: (username?: string, password?: string, saveCredsFlag?: boolean, useStored?: boolean) => Promise<void>
  handlePull: (username?: string, password?: string, saveCredsFlag?: boolean, useStored?: boolean) => Promise<void>
  handleCredentialsSubmit: (username: string, password: string, saveCredentials: boolean) => void
  handleUseStoredCredentials: () => Promise<void>
  handleCredentialsCancel: () => void
  setOperationMessage: (message: string) => void
}

export function useRemoteOperations({
  projectPath,
  onGitChange,
  onTreeRefresh,
  onRefreshStatus,
}: UseRemoteOperationsProps): UseRemoteOperationsReturn {
  const [remoteState, setRemoteState] = useState<RemoteState>({
    hasRemote: false,
    ahead: 0,
    behind: 0,
  })
  const [pushing, setPushing] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [showCredentialsDialog, setShowCredentialsDialog] = useState(false)
  const [pendingOperation, setPendingOperation] = useState<'push' | 'pull' | null>(null)
  const [storedUsername, setStoredUsername] = useState('')
  const [, setOperationMessage] = useState('')

  const fetchBranchInfo = useCallback(async () => {
    try {
      const response = await apiFetch(apiUrl('/api/git-branch-info'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: projectPath }),
      })

      if (response.ok) {
        const data = await response.json()
        setRemoteState({
          hasRemote: data.has_remote || false,
          ahead: data.ahead || 0,
          behind: data.behind || 0,
        })
      }
    } catch (err) {
      console.error('Error fetching branch info:', err)
    }
  }, [projectPath])

  const handlePush = useCallback(async (
    username?: string,
    password?: string,
    saveCredsFlag?: boolean,
    useStored?: boolean
  ) => {
    setPushing(true)
    setOperationMessage('Pushing to remote...')

    try {
      const result = await gitPush(projectPath, {
        username,
        password,
        saveCredentials: saveCredsFlag,
        useStored,
      })

      if (result.success) {
        await fetchBranchInfo()
        setShowCredentialsDialog(false)
        setPendingOperation(null)
        setStoredUsername('')
        return
      } else if (result.authRequired) {
        setPendingOperation('push')
        setStoredUsername(result.storedUsername || '')
        setShowCredentialsDialog(true)
      } else {
        throw new Error(result.error || 'Failed to push')
      }
    } finally {
      setPushing(false)
      setOperationMessage('')
    }
  }, [projectPath, fetchBranchInfo])

  const handlePull = useCallback(async (
    username?: string,
    password?: string,
    saveCredsFlag?: boolean,
    useStored?: boolean
  ) => {
    setPulling(true)
    setOperationMessage('Pulling from remote...')

    try {
      const result = await gitPull(projectPath, {
        username,
        password,
        saveCredentials: saveCredsFlag,
        useStored,
      })

      if (result.success) {
        await onRefreshStatus()
        await fetchBranchInfo()
        onTreeRefresh?.()
        onGitChange?.()
        setShowCredentialsDialog(false)
        setPendingOperation(null)
        setStoredUsername('')
        return
      } else if (result.authRequired) {
        setPendingOperation('pull')
        setStoredUsername(result.storedUsername || '')
        setShowCredentialsDialog(true)
      } else {
        throw new Error(result.error || 'Failed to pull')
      }
    } finally {
      setPulling(false)
      setOperationMessage('')
    }
  }, [projectPath, fetchBranchInfo, onRefreshStatus, onTreeRefresh, onGitChange])

  const handleCredentialsSubmit = useCallback((username: string, password: string, saveCredentials: boolean) => {
    if (pendingOperation === 'push') {
      handlePush(username, password, saveCredentials)
    } else if (pendingOperation === 'pull') {
      handlePull(username, password, saveCredentials)
    }
  }, [pendingOperation, handlePush, handlePull])

  const handleUseStoredCredentials = useCallback(async () => {
    if (pendingOperation === 'push') {
      handlePush(undefined, undefined, true, true)
    } else if (pendingOperation === 'pull') {
      handlePull(undefined, undefined, true, true)
    }
  }, [pendingOperation, handlePush, handlePull])

  const handleCredentialsCancel = useCallback(() => {
    setShowCredentialsDialog(false)
    setPendingOperation(null)
    setStoredUsername('')
  }, [])

  return {
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
    setOperationMessage,
  }
}
