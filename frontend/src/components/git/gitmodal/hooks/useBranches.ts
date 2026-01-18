// Hook for managing git branches

import { useState, useCallback } from 'react'
import { apiUrl, apiFetch } from '../../../../config/api'
import { BranchState, getGitConfig } from '../types'

interface UseBranchesProps {
  projectPath: string
  onBranchChange?: () => void
  onGitChange?: () => void
  onTreeRefresh?: () => void
}

interface UseBranchesReturn {
  branchState: BranchState
  branchLoading: boolean
  showBranchDropdown: boolean
  showNewBranchInput: boolean
  newBranchName: string
  setShowBranchDropdown: (show: boolean) => void
  setShowNewBranchInput: (show: boolean) => void
  setNewBranchName: (name: string) => void
  fetchBranches: () => Promise<void>
  handleCreateBranch: () => Promise<{ success: boolean; error?: string; branch?: string }>
  handleCheckoutBranch: (branch: string) => Promise<{ success: boolean; error?: string }>
  handleDeleteBranch: (branch: string) => Promise<{ success: boolean; error?: string }>
  isBranchDisabled: (branch: string) => boolean
  getBranchDisabledReason: (branch: string) => string
  canDeleteBranch: (branch: string) => boolean
  isOtherUsersDefaultBranch: (branch: string) => boolean
  setOperationMessage: (message: string) => void
  operationMessage: string
}

export function useBranches({ projectPath, onBranchChange, onGitChange, onTreeRefresh }: UseBranchesProps): UseBranchesReturn {
  const [branchState, setBranchState] = useState<BranchState>({
    currentBranch: '',
    branches: [],
    defaultBranch: '',
    worktreeBranches: [],
    userDefaultBranch: '',
  })
  const [branchLoading, setBranchLoading] = useState(false)
  const [showBranchDropdown, setShowBranchDropdown] = useState(false)
  const [showNewBranchInput, setShowNewBranchInput] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [operationMessage, setOperationMessage] = useState('')

  const fetchBranches = useCallback(async () => {
    try {
      const response = await apiFetch(apiUrl('/api/git-list-branches'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: projectPath }),
      })

      if (response.ok) {
        const data = await response.json()

        // Find user's default branch (ends with -main)
        let userBranch = ''
        const gitConfig = getGitConfig()
        if (gitConfig) {
          const sanitizedName = gitConfig.userName.toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'user'
          userBranch = `${sanitizedName}-main`
          if (!(data.branches || []).includes(userBranch)) {
            userBranch = ''
          }
        }

        setBranchState({
          branches: data.branches || [],
          currentBranch: data.current || '',
          defaultBranch: data.default_branch || '',
          worktreeBranches: data.worktree_branches || [],
          userDefaultBranch: userBranch,
        })
      }
    } catch (err) {
      console.error('Error fetching branches:', err)
    }
  }, [projectPath])

  // Check if a branch is another user's default branch (ends with -main but not current user's)
  const isOtherUsersDefaultBranch = useCallback((branch: string): boolean => {
    if (branch.endsWith('-main') && branch !== 'main') {
      if (branch === branchState.userDefaultBranch) return false
      return true
    }
    return false
  }, [branchState.userDefaultBranch])

  // Check if a branch is disabled
  const isBranchDisabled = useCallback((branch: string): boolean => {
    if (branch === branchState.defaultBranch) return true
    if (branchState.worktreeBranches.includes(branch)) return true
    if (isOtherUsersDefaultBranch(branch)) return true
    return false
  }, [branchState.defaultBranch, branchState.worktreeBranches, isOtherUsersDefaultBranch])

  const getBranchDisabledReason = useCallback((branch: string): string => {
    if (branch === branchState.defaultBranch) return 'Default branch'
    if (branchState.worktreeBranches.includes(branch)) return 'Checked out in another worktree'
    if (isOtherUsersDefaultBranch(branch)) return "Another user's default branch"
    return ''
  }, [branchState.defaultBranch, branchState.worktreeBranches, isOtherUsersDefaultBranch])

  const canDeleteBranch = useCallback((branch: string): boolean => {
    if (branch === branchState.currentBranch) return false
    if (branch === branchState.defaultBranch) return false
    if (branch === branchState.userDefaultBranch) return false
    if (branchState.worktreeBranches.includes(branch)) return false
    return true
  }, [branchState])

  const handleCreateBranch = useCallback(async (): Promise<{ success: boolean; error?: string; branch?: string }> => {
    if (!newBranchName.trim()) {
      return { success: false, error: 'Please enter a branch name' }
    }

    setBranchLoading(true)
    setOperationMessage('Creating branch...')

    try {
      const response = await apiFetch(apiUrl('/api/git-create-branch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: projectPath,
          branch_name: newBranchName,
          checkout: true,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setNewBranchName('')
        setShowNewBranchInput(false)
        setBranchState((prev) => ({ ...prev, currentBranch: data.branch }))
        await fetchBranches()
        onBranchChange?.()
        onTreeRefresh?.()
        onGitChange?.()
        return { success: true, branch: data.branch }
      } else {
        const data = await response.json()
        return { success: false, error: data.detail || 'Failed to create branch' }
      }
    } catch (err) {
      console.error('Error creating branch:', err)
      return { success: false, error: 'Failed to create branch' }
    } finally {
      setBranchLoading(false)
      setOperationMessage('')
    }
  }, [newBranchName, projectPath, fetchBranches, onBranchChange, onTreeRefresh, onGitChange])

  const handleCheckoutBranch = useCallback(async (branch: string): Promise<{ success: boolean; error?: string }> => {
    if (branch === branchState.currentBranch || isBranchDisabled(branch)) {
      setShowBranchDropdown(false)
      return { success: false }
    }

    setBranchLoading(true)
    setOperationMessage('Switching branch...')

    try {
      const response = await apiFetch(apiUrl('/api/git-checkout-branch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: projectPath,
          branch_name: branch,
        }),
      })

      if (response.ok) {
        setBranchState((prev) => ({ ...prev, currentBranch: branch }))
        setShowBranchDropdown(false)
        onBranchChange?.()
        onTreeRefresh?.()
        onGitChange?.()
        return { success: true }
      } else {
        const data = await response.json()
        return { success: false, error: data.detail || 'Failed to checkout branch' }
      }
    } catch (err) {
      console.error('Error checking out branch:', err)
      return { success: false, error: 'Failed to checkout branch' }
    } finally {
      setBranchLoading(false)
      setOperationMessage('')
    }
  }, [branchState.currentBranch, isBranchDisabled, projectPath, onBranchChange, onTreeRefresh, onGitChange])

  const handleDeleteBranch = useCallback(async (branchToDelete: string): Promise<{ success: boolean; error?: string }> => {
    if (branchToDelete === branchState.currentBranch) {
      return { success: false, error: 'Cannot delete the currently checked out branch' }
    }

    if (branchToDelete === branchState.defaultBranch) {
      return { success: false, error: 'Cannot delete the default branch' }
    }

    if (branchToDelete === branchState.userDefaultBranch) {
      return { success: false, error: 'Cannot delete your default working branch' }
    }

    setBranchLoading(true)
    setOperationMessage('Deleting branch...')

    try {
      const response = await apiFetch(apiUrl('/api/git-delete-branch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: projectPath,
          branch_name: branchToDelete,
        }),
      })

      if (response.ok) {
        await fetchBranches()
        return { success: true }
      } else {
        const data = await response.json()
        return { success: false, error: data.detail || 'Failed to delete branch' }
      }
    } catch (err) {
      console.error('Error deleting branch:', err)
      return { success: false, error: 'Failed to delete branch' }
    } finally {
      setBranchLoading(false)
      setOperationMessage('')
    }
  }, [branchState, projectPath, fetchBranches])

  return {
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
    isOtherUsersDefaultBranch,
    setOperationMessage,
    operationMessage,
  }
}
