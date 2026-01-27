// Hook for file operations (create, rename, delete, restore, move)

import { apiUrl, apiFetch } from '../../../../config/api'
import { isPackagesFile } from '../utils'

interface UseFileOperationsProps {
  projectPath: string
  selectedFile: string | null
  selectedIsFolder: boolean
  onFileSelect: (file: string) => void
  onRefreshModifiedFiles?: () => void
  onPackagesFileChanged?: () => void
  onTreeRefreshNeeded: () => Promise<void>
  checkManifest: () => Promise<void>
}

interface UseFileOperationsResult {
  handleCreateFile: () => Promise<void>
  handleRenameConfirm: (newName?: string) => Promise<void>
  handleDeleteConfirm: () => Promise<void>
  handleRestoreFile: (deletedFile: string) => Promise<void>
  handleMoveFile: (sourcePath: string, targetFolder: string) => Promise<void>
}

export function useFileOperations({
  projectPath,
  selectedFile,
  selectedIsFolder,
  onFileSelect,
  onRefreshModifiedFiles,
  onPackagesFileChanged,
  onTreeRefreshNeeded,
  checkManifest
}: UseFileOperationsProps): UseFileOperationsResult {

  const handleCreateFile = async () => {
    try {
      let targetFolder = ''
      if (selectedFile) {
        if (selectedIsFolder) {
          targetFolder = selectedFile
        } else {
          const lastSlash = selectedFile.lastIndexOf('/')
          targetFolder = lastSlash > 0 ? selectedFile.substring(0, lastSlash) : ''
        }
      }

      const response = await apiFetch(apiUrl('/api/create-file'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: projectPath,
          folder: targetFolder
        }),
      })

      if (response.ok) {
        const data = await response.json()
        console.log(`Created file: ${data.file_path}`)
        await onTreeRefreshNeeded()
        onFileSelect(data.file_path)
        if (onRefreshModifiedFiles) {
          onRefreshModifiedFiles()
        }
      } else {
        console.error('Failed to create file')
      }
    } catch (err) {
      console.error('Error creating file:', err)
    }
  }

  const handleRenameConfirm = async (newName?: string) => {
    if (!selectedFile || !newName || newName === selectedFile) {
      return
    }

    const itemType = selectedIsFolder ? 'folder' : 'file'

    try {
      const response = await apiFetch(apiUrl('/api/rename-file'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: projectPath,
          old_path: selectedFile,
          new_path: newName
        }),
      })

      if (response.ok) {
        const data = await response.json()
        console.log(`Renamed ${itemType}: ${selectedFile} -> ${data.new_path}`)
        await onTreeRefreshNeeded()
        onFileSelect(data.new_path)
        if (onRefreshModifiedFiles) {
          onRefreshModifiedFiles()
        }
        if (onPackagesFileChanged && (isPackagesFile(selectedFile) || isPackagesFile(data.new_path))) {
          onPackagesFileChanged()
        }
      } else {
        const error = await response.json()
        console.error(`Failed to rename ${itemType}: ${error.detail}`)
      }
    } catch (err) {
      console.error(`Error renaming ${itemType}:`, err)
    }
  }

  const handleDeleteConfirm = async () => {
    if (!selectedFile) {
      return
    }

    const itemType = selectedIsFolder ? 'folder' : 'file'

    try {
      let isGitTracked = false
      try {
        console.log(`[handleDeleteConfirm] Checking git tracking for: ${selectedFile}`)
        const gitResponse = await apiFetch(apiUrl('/api/git-is-tracked'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: projectPath,
            file_path: selectedFile
          }),
        })
        console.log(`[handleDeleteConfirm] Git response status: ${gitResponse.status}`)
        if (gitResponse.ok) {
          const gitData = await gitResponse.json()
          isGitTracked = gitData.tracked
          console.log(`[handleDeleteConfirm] Git tracked: ${isGitTracked}`)
        } else {
          console.error(`[handleDeleteConfirm] Git check failed with status: ${gitResponse.status}`)
        }
      } catch (gitErr) {
        console.error('[handleDeleteConfirm] Error checking git status:', gitErr)
      }

      const response = await apiFetch(apiUrl('/api/delete-file'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: projectPath,
          file_path: selectedFile
        }),
      })

      if (response.ok) {
        console.log(`Deleted ${itemType}: ${selectedFile}, isGitTracked: ${isGitTracked}`)

        await onTreeRefreshNeeded()

        onFileSelect('')
        if (onRefreshModifiedFiles) {
          onRefreshModifiedFiles()
        }
        checkManifest()
      } else {
        const error = await response.json()
        console.error(`Failed to delete ${itemType}: ${error.detail}`)
      }
    } catch (err) {
      console.error(`Error deleting ${itemType}:`, err)
    }
  }

  const handleRestoreFile = async (deletedFile: string) => {
    if (!deletedFile) {
      return
    }

    try {
      const response = await apiFetch(apiUrl('/api/restore-file'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: projectPath,
          file_path: deletedFile
        }),
      })

      if (response.ok) {
        console.log(`Restored file: ${deletedFile}`)
        await onTreeRefreshNeeded()
        onFileSelect(deletedFile)
        if (onRefreshModifiedFiles) {
          onRefreshModifiedFiles()
        }
      } else {
        const error = await response.json()
        alert(`Failed to restore file: ${error.detail}`)
      }
    } catch (err) {
      console.error('Error restoring file:', err)
      alert('Error restoring file')
    }
  }

  const handleMoveFile = async (sourcePath: string, targetFolder: string) => {
    const fileName = sourcePath.split('/').pop() || ''
    const newPath = targetFolder ? `${targetFolder}/${fileName}` : fileName

    if (sourcePath === newPath) return

    try {
      const response = await apiFetch(apiUrl('/api/rename-file'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: projectPath,
          old_path: sourcePath,
          new_path: newPath
        }),
      })

      if (response.ok) {
        console.log(`Moved: ${sourcePath} -> ${newPath}`)
        await onTreeRefreshNeeded()
        onFileSelect(newPath)
        if (onRefreshModifiedFiles) {
          onRefreshModifiedFiles()
        }
        if (onPackagesFileChanged && (isPackagesFile(sourcePath) || isPackagesFile(newPath))) {
          onPackagesFileChanged()
        }
      } else {
        const error = await response.json()
        alert(`Failed to move: ${error.detail}`)
      }
    } catch (err) {
      console.error('Error moving:', err)
      alert('Error moving file/folder')
    }
  }

  return {
    handleCreateFile,
    handleRenameConfirm,
    handleDeleteConfirm,
    handleRestoreFile,
    handleMoveFile
  }
}
