// Hook for source operations (add, delete)

import { useState, useCallback } from 'react'
import { apiUrl, apiFetch } from '../../../../config/api'
import { SourceColumn, MetaDVData, Connection, AddSourceDialogState } from '../types'

interface UseSourceOperationsProps {
  projectPath: string
  data: MetaDVData | null
  setData: React.Dispatch<React.SetStateAction<MetaDVData | null>>
  connections: Connection[]
  setConnections: React.Dispatch<React.SetStateAction<Connection[]>>
  setHasUnsavedChanges: React.Dispatch<React.SetStateAction<boolean>>
  setSuccessMessage: React.Dispatch<React.SetStateAction<string | null>>
  selectedTarget?: string | null
  onRefreshTree?: () => void
}

interface UseSourceOperationsResult {
  addSourceDialog: AddSourceDialogState
  setAddSourceDialog: React.Dispatch<React.SetStateAction<AddSourceDialogState>>
  handleOpenAddSource: () => void
  handleOpenEditSource: (source: string) => void
  handleCloseAddSource: () => void
  handleAddSource: () => Promise<void>
  handleDeleteSource: (source: string) => void
  handleRefreshSource: (source: string) => Promise<void>
  refreshingSource: string | null
  getSourceConnectionCount: (source: string) => number
}

export function useSourceOperations({
  projectPath,
  data,
  setData,
  connections,
  setConnections,
  setHasUnsavedChanges,
  setSuccessMessage,
  selectedTarget,
  onRefreshTree
}: UseSourceOperationsProps): UseSourceOperationsResult {
  const [addSourceDialog, setAddSourceDialog] = useState<AddSourceDialogState>({
    open: false,
    sourceName: '',
    loading: false,
    error: null,
    editMode: false
  })
  const [refreshingSource, setRefreshingSource] = useState<string | null>(null)

  const handleOpenAddSource = () => {
    setAddSourceDialog({
      open: true,
      sourceName: '',
      loading: false,
      error: null,
      editMode: false
    })
  }

  const handleOpenEditSource = (source: string) => {
    setAddSourceDialog({
      open: true,
      sourceName: source,
      loading: false,
      error: null,
      editMode: true,
      originalSource: source
    })
  }

  const handleCloseAddSource = () => {
    setAddSourceDialog({
      open: false,
      sourceName: '',
      loading: false,
      error: null,
      editMode: false
    })
  }

  const handleAddSource = async () => {
    const { sourceName, editMode, originalSource } = addSourceDialog

    if (!sourceName.trim()) {
      setAddSourceDialog((prev: AddSourceDialogState) => ({ ...prev, error: 'Source name is required' }))
      return
    }

    // In edit mode, check if the new name conflicts with an existing (different) source
    if (editMode) {
      const isNameChanged = sourceName !== originalSource
      if (isNameChanged) {
        const existingColumns = data?.source_columns.filter(
          (col: SourceColumn) => col.source === sourceName
        )
        if (existingColumns && existingColumns.length > 0) {
          setAddSourceDialog((prev: AddSourceDialogState) => ({ ...prev, error: 'A source with this name already exists' }))
          return
        }
      }

      // Update all source columns with the new source name
      setData((prev: MetaDVData | null) => {
        if (!prev) return prev
        return {
          ...prev,
          source_columns: prev.source_columns.map((col: SourceColumn) => {
            if (col.source === originalSource) {
              return {
                ...col,
                source: sourceName
              }
            }
            return col
          })
        }
      })

      // Update connection source column references
      setConnections(connections.map((c: Connection) => {
        if (c.sourceColumn.startsWith(originalSource + '.')) {
          const columnName = c.sourceColumn.substring(originalSource!.length + 1)
          return {
            ...c,
            sourceColumn: `${sourceName}.${columnName}`,
            id: c.id.replace(originalSource!, sourceName)
          }
        }
        return c
      }))

      setHasUnsavedChanges(true)
      handleCloseAddSource()
      setSuccessMessage(`Updated source "${originalSource}" to "${sourceName}"`)
      setTimeout(() => setSuccessMessage(null), 3000)
      // Refresh tree view when source is renamed
      onRefreshTree?.()
      return
    }

    // Add mode - check for existing source
    const existingColumns = data?.source_columns.filter(
      (col: SourceColumn) => col.source === sourceName
    )
    if (existingColumns && existingColumns.length > 0) {
      setAddSourceDialog((prev: AddSourceDialogState) => ({ ...prev, error: 'This source already exists' }))
      return
    }

    setAddSourceDialog((prev: AddSourceDialogState) => ({ ...prev, loading: true, error: null }))

    try {
      // Use source name (model name) to query dbt for columns
      const response = await apiFetch(apiUrl('/api/metadv-source-columns'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: projectPath,
          source_name: sourceName,
          target: selectedTarget || undefined
        })
      })

      const result = await response.json()

      if (!result.success) {
        setAddSourceDialog((prev: AddSourceDialogState) => ({ ...prev, loading: false, error: result.error || 'Failed to fetch columns' }))
        return
      }

      const newColumns: SourceColumn[] = result.columns.map((colName: string) => ({
        source: sourceName,
        column: colName,
        target: null  // Unified target array for all connections
      }))

      setData((prev: MetaDVData | null) => {
        if (!prev) return prev
        return {
          ...prev,
          source_columns: [...prev.source_columns, ...newColumns]
        }
      })

      setHasUnsavedChanges(true)
      handleCloseAddSource()
      setSuccessMessage(`Added ${result.columns.length} columns from ${sourceName}`)
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (err) {
      setAddSourceDialog((prev: AddSourceDialogState) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'An error occurred'
      }))
    }
  }

  const getSourceConnectionCount = useCallback((source: string): number => {
    return connections.filter((c: Connection) => c.sourceColumn.startsWith(source + '.')).length
  }, [connections])

  const handleDeleteSource = (source: string) => {
    setData((prev: MetaDVData | null) => {
      if (!prev) return prev
      return {
        ...prev,
        source_columns: prev.source_columns.filter(
          (col: SourceColumn) => col.source !== source
        )
      }
    })

    setConnections(connections.filter((c: Connection) => !c.sourceColumn.startsWith(source + '.')))

    setHasUnsavedChanges(true)
    setSuccessMessage(`Deleted source "${source}"`)
    setTimeout(() => setSuccessMessage(null), 3000)
  }

  const handleRefreshSource = async (source: string) => {
    setRefreshingSource(source)

    try {
      const response = await apiFetch(apiUrl('/api/metadv-source-columns'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: projectPath,
          source_name: source,
          target: selectedTarget || undefined
        })
      })

      const result = await response.json()

      if (!result.success) {
        setSuccessMessage(`Failed to refresh: ${result.error || 'Unknown error'}`)
        setTimeout(() => setSuccessMessage(null), 3000)
        return
      }

      // Get existing columns for this source to preserve unified target connections
      const existingColumns = data?.source_columns.filter(
        (col: SourceColumn) => col.source === source
      ) || []

      // Create a map of existing column metadata (unified target array)
      const existingMetadata: Record<string, { target: SourceColumn['target'] }> = {}
      existingColumns.forEach((col: SourceColumn) => {
        existingMetadata[col.column] = {
          target: col.target
        }
      })

      // Build new columns list, preserving metadata for existing columns
      const newColumns: SourceColumn[] = result.columns.map((colName: string) => ({
        source: source,
        column: colName,
        target: existingMetadata[colName]?.target || null  // Unified target array
      }))

      // Find columns that were removed
      const newColumnNames = new Set(result.columns)
      const removedColumns = existingColumns.filter(
        (col: SourceColumn) => !newColumnNames.has(col.column)
      )

      // Remove connections for deleted columns
      if (removedColumns.length > 0) {
        const removedColumnIds = new Set(
          removedColumns.map((col: SourceColumn) => `${source}.${col.column}`)
        )
        setConnections(connections.filter(
          (c: Connection) => !removedColumnIds.has(c.sourceColumn)
        ))
      }

      // Update the data
      setData((prev: MetaDVData | null) => {
        if (!prev) return prev
        return {
          ...prev,
          source_columns: [
            ...prev.source_columns.filter((col: SourceColumn) => col.source !== source),
            ...newColumns
          ]
        }
      })

      const addedCount = result.columns.filter((col: string) => !existingMetadata[col]).length
      const removedCount = removedColumns.length

      let message = `Refreshed "${source}"`
      if (addedCount > 0 || removedCount > 0) {
        const parts = []
        if (addedCount > 0) parts.push(`${addedCount} added`)
        if (removedCount > 0) parts.push(`${removedCount} removed`)
        message += ` (${parts.join(', ')})`
      }

      setHasUnsavedChanges(true)
      setSuccessMessage(message)
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (err) {
      setSuccessMessage(`Error refreshing: ${err instanceof Error ? err.message : 'Unknown error'}`)
      setTimeout(() => setSuccessMessage(null), 3000)
    } finally {
      setRefreshingSource(null)
    }
  }

  return {
    addSourceDialog,
    setAddSourceDialog,
    handleOpenAddSource,
    handleOpenEditSource,
    handleCloseAddSource,
    handleAddSource,
    handleDeleteSource,
    handleRefreshSource,
    refreshingSource,
    getSourceConnectionCount
  }
}
