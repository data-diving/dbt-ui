// Hook for loading file content

import { useState, useEffect } from 'react'
import { apiUrl, apiFetch } from '../../../../config/api'
import { ViewMode } from '../types'

interface UseFileContentResult {
  content: string
  setContent: React.Dispatch<React.SetStateAction<string>>
  originalContent: string
  setOriginalContent: React.Dispatch<React.SetStateAction<string>>
  loading: boolean
  isBinaryFile: boolean
  hasUnsavedChanges: boolean
  setHasUnsavedChanges: React.Dispatch<React.SetStateAction<boolean>>
  viewMode: ViewMode
  setViewMode: React.Dispatch<React.SetStateAction<ViewMode>>
}

export function useFileContent(
  selectedFile: string | null,
  projectPath: string | null
): UseFileContentResult {
  const [content, setContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [isBinaryFile, setIsBinaryFile] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('table')

  useEffect(() => {
    if (!selectedFile || !projectPath) {
      setContent('')
      setOriginalContent('')
      setLoading(false)
      setHasUnsavedChanges(false)
      setIsBinaryFile(false)
      return
    }

    const isFolder = !selectedFile.includes('.') || selectedFile.endsWith('/')
    if (isFolder) {
      console.log('[Editor] Folder selected, not loading:', selectedFile)
      setContent('')
      setOriginalContent('')
      setLoading(false)
      setHasUnsavedChanges(false)
      setIsBinaryFile(false)
      return
    }

    console.log('[Editor] useEffect triggered for file:', selectedFile)
    let cancelled = false
    const abortController = new AbortController()

    const loadData = async () => {
      if (cancelled) {
        console.log('[Editor] Cancelled before starting')
        return
      }

      const startTime = performance.now()
      console.log('[Editor] Starting loadFileContent for:', selectedFile, 'at', startTime)

      setLoading(true)
      setHasUnsavedChanges(false)

      try {
        const fetchStartTime = performance.now()
        console.log('[Editor] Starting fetch at', fetchStartTime, `(+${(fetchStartTime - startTime).toFixed(2)}ms)`)

        const response = await apiFetch(apiUrl('/api/read-file'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            projectPath: projectPath,
            filePath: selectedFile,
          }),
          signal: abortController.signal
        })

        if (cancelled) {
          console.log('[Editor] Cancelled after fetch')
          return
        }

        const fetchEndTime = performance.now()
        console.log('[Editor] Fetch completed at', fetchEndTime, `(+${(fetchEndTime - fetchStartTime).toFixed(2)}ms)`)

        if (response.ok) {
          const jsonStartTime = performance.now()
          const data = await response.json()
          const jsonEndTime = performance.now()
          console.log('[Editor] JSON parsing completed at', jsonEndTime, `(+${(jsonEndTime - jsonStartTime).toFixed(2)}ms)`)
          console.log('[Editor] Content length:', data.content?.length || 0, 'characters')

          if (!cancelled) {
            if (data.isBinary) {
              setContent('')
              setOriginalContent('')
              setIsBinaryFile(true)
              console.log('[Editor] Binary file detected:', selectedFile)
            } else {
              setContent(data.content)
              setOriginalContent(data.content)
              setIsBinaryFile(false)
              console.log('[Editor] setState called at', performance.now())
            }
          }
        } else {
          console.error('[Editor] Response not OK:', response.status, response.statusText)
          if (!cancelled) {
            setContent('// Error loading file')
            setOriginalContent('// Error loading file')
            setIsBinaryFile(false)
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          console.log('[Editor] Fetch aborted')
          return
        }
        console.error('Error loading file:', err)
        if (!cancelled) {
          setContent('// Error connecting to backend')
          setOriginalContent('// Error connecting to backend')
        }
      } finally {
        if (!cancelled) {
          const finalTime = performance.now()
          setLoading(false)
          console.log('[Editor] setLoading(false) called at', finalTime, `Total time: ${(finalTime - startTime).toFixed(2)}ms`)
        }
      }
    }

    // Reset view mode based on file type
    const newIsSqlModel = selectedFile.endsWith('.sql') &&
                         (selectedFile.includes('/models/') || selectedFile.startsWith('models/'))
    const newIsCsvFile = selectedFile.endsWith('.csv')
    const newIsJsonFile = selectedFile.endsWith('.json')

    if (newIsCsvFile) {
      setViewMode('table')
    } else if (newIsSqlModel) {
      setViewMode(prev => (prev !== 'rendered' && prev !== 'text') ? 'text' : prev)
    } else if (newIsJsonFile) {
      setViewMode(prev => (prev !== 'rendered' && prev !== 'text') ? 'text' : prev)
    } else {
      setViewMode('text')
    }

    loadData()

    return () => {
      console.log('[Editor] Cleanup called for:', selectedFile)
      cancelled = true
      abortController.abort()
    }
  }, [selectedFile, projectPath])

  return {
    content,
    setContent,
    originalContent,
    setOriginalContent,
    loading,
    isBinaryFile,
    hasUnsavedChanges,
    setHasUnsavedChanges,
    viewMode,
    setViewMode
  }
}
