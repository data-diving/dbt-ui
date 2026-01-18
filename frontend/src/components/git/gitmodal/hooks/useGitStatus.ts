// Hook for managing git status and staging operations

import { useState, useCallback } from 'react'
import { apiUrl, apiFetch } from '../../../../config/api'
import { GitStatus, ChangedFile } from '../types'

interface UseGitStatusProps {
  projectPath: string
  onGitChange?: () => void
}

interface UseGitStatusReturn {
  gitStatus: GitStatus | null
  stagedFiles: string[]
  selectedFiles: Set<string>
  loading: boolean
  operationInProgress: boolean
  operationMessage: string
  fetchGitStatus: () => Promise<void>
  fetchStagedFiles: () => Promise<void>
  toggleFileSelection: (file: string) => void
  selectAllUnstaged: () => void
  deselectAll: () => void
  stageSelectedFiles: () => Promise<{ success: boolean; error?: string }>
  unstageFile: (file: string) => Promise<{ success: boolean; error?: string }>
  getAllChangedFiles: () => ChangedFile[]
  setOperationInProgress: (value: boolean) => void
  setOperationMessage: (message: string) => void
}

export function useGitStatus({ projectPath, onGitChange }: UseGitStatusProps): UseGitStatusReturn {
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null)
  const [stagedFiles, setStagedFiles] = useState<string[]>([])
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [operationInProgress, setOperationInProgress] = useState(false)
  const [operationMessage, setOperationMessage] = useState('')

  const fetchGitStatus = useCallback(async () => {
    try {
      const response = await apiFetch(apiUrl('/api/git-modified-files'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: projectPath }),
      })

      if (!response.ok) {
        throw new Error('Failed to fetch git status')
      }

      const data = await response.json()
      setGitStatus({
        modified: data.modified || [],
        deleted: data.deleted || [],
        untracked: data.untracked || [],
      })
    } catch (err) {
      console.error('Error fetching git status:', err)
      throw err
    }
  }, [projectPath])

  const fetchStagedFiles = useCallback(async () => {
    try {
      const response = await apiFetch(apiUrl('/api/git-staged-files'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: projectPath }),
      })

      if (response.ok) {
        const data = await response.json()
        setStagedFiles(data.staged || [])
      }
    } catch (err) {
      console.error('Error fetching staged files:', err)
    }
  }, [projectPath])

  const getAllChangedFiles = useCallback((): ChangedFile[] => {
    if (!gitStatus) return []

    const files: ChangedFile[] = []

    gitStatus.modified
      .filter((f) => !stagedFiles.includes(f))
      .forEach((f) => files.push({ file: f, type: 'modified' }))

    gitStatus.deleted
      .filter((f) => !stagedFiles.includes(f))
      .forEach((f) => files.push({ file: f, type: 'deleted' }))

    gitStatus.untracked
      .filter((f) => !stagedFiles.includes(f))
      .forEach((f) => files.push({ file: f, type: 'untracked' }))

    return files
  }, [gitStatus, stagedFiles])

  const toggleFileSelection = useCallback((file: string) => {
    setSelectedFiles((prev) => {
      const newSelected = new Set(prev)
      if (newSelected.has(file)) {
        newSelected.delete(file)
      } else {
        newSelected.add(file)
      }
      return newSelected
    })
  }, [])

  const selectAllUnstaged = useCallback(() => {
    const allFiles = getAllChangedFiles().map((f) => f.file)
    setSelectedFiles(new Set(allFiles))
  }, [getAllChangedFiles])

  const deselectAll = useCallback(() => {
    setSelectedFiles(new Set())
  }, [])

  const stageSelectedFiles = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    if (selectedFiles.size === 0) return { success: false, error: 'No files selected' }

    setOperationInProgress(true)
    setOperationMessage('Staging files...')

    try {
      const response = await apiFetch(apiUrl('/api/git-stage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: projectPath,
          files: Array.from(selectedFiles),
        }),
      })

      if (response.ok) {
        setSelectedFiles(new Set())
        await Promise.all([fetchGitStatus(), fetchStagedFiles()])
        onGitChange?.()
        return { success: true }
      } else {
        const data = await response.json()
        return { success: false, error: data.detail || 'Failed to stage files' }
      }
    } catch (err) {
      console.error('Error staging files:', err)
      return { success: false, error: 'Failed to stage files' }
    } finally {
      setOperationInProgress(false)
      setOperationMessage('')
    }
  }, [selectedFiles, projectPath, fetchGitStatus, fetchStagedFiles, onGitChange])

  const unstageFile = useCallback(async (file: string): Promise<{ success: boolean; error?: string }> => {
    setOperationInProgress(true)
    setOperationMessage('Unstaging file...')

    try {
      const response = await apiFetch(apiUrl('/api/git-unstage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: projectPath,
          files: [file],
        }),
      })

      if (response.ok) {
        await Promise.all([fetchGitStatus(), fetchStagedFiles()])
        onGitChange?.()
        return { success: true }
      } else {
        const data = await response.json()
        return { success: false, error: data.detail || 'Failed to unstage file' }
      }
    } catch (err) {
      console.error('Error unstaging file:', err)
      return { success: false, error: 'Failed to unstage file' }
    } finally {
      setOperationInProgress(false)
      setOperationMessage('')
    }
  }, [projectPath, fetchGitStatus, fetchStagedFiles, onGitChange])

  return {
    gitStatus,
    stagedFiles,
    selectedFiles,
    loading,
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
    setOperationInProgress,
    setOperationMessage,
  }
}
