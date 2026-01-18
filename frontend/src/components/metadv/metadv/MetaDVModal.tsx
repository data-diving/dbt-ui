// Main MetaDVModal component

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { X, Database, Save, CheckCircle, AlertTriangle, AlertCircle, FileCode, Copy, ChevronDown, ChevronUp } from 'lucide-react'
import { apiUrl, apiFetch } from '../../../config/api'
import '../MetaDVModal.css'

import { MetaDVModalProps, SourceGroup, SourceColumn, Target, Connection, DeleteConfirmDialogState, CONNECTION_TYPE_COLORS, HoverHighlight, TargetAttribute, MetaDVData } from './types'
import { getColumnKey, getColumnNameFromColumnKey } from './utils'
import { useMetaDVData } from './hooks/useMetaDVData'
import { useConnections } from './hooks/useConnections'
import { useTargetOperations } from './hooks/useTargetOperations'
import { useSourceOperations } from './hooks/useSourceOperations'
import SourcePanel from './components/SourcePanel'
import TargetPanel from './components/TargetPanel'
import ConnectionsSvg from './components/ConnectionsSvg'
import { AddSourceDialog, AddTargetDialog, ConnectionTypePopup, DeleteConnectionBar, DeleteConfirmDialog, SelfLinkDialog, SaveBeforeGenerateDialog, RenameAttributeDialog } from './components/Dialogs'

interface ValidationIssue {
  type: 'error' | 'warning'
  code: string
  message: string
}

interface ValidationResult {
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
  summary?: {
    total_targets: number
    total_columns: number
    columns_with_connections: number
    error_count: number
    warning_count: number
  }
}

function MetaDVModal({ projectPath, onClose, selectedDbtTarget, onRefreshTree }: MetaDVModalProps) {
  // Filter state
  const [leftFilter, setLeftFilter] = useState('')
  const [rightFilter, setRightFilter] = useState('')
  const [collapsedSources, setCollapsedSources] = useState<Set<string>>(new Set())
  const [collapsedTargets, setCollapsedTargets] = useState<Set<string>>(new Set())

  // Validation state
  const [validating, setValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null)
  const [validationExpanded, setValidationExpanded] = useState(false)

  // Delete confirmation state
  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState<DeleteConfirmDialogState>({
    open: false,
    type: 'source',
    title: '',
    message: '',
    connectionCount: 0
  })

  // Generate dialog state
  const [showSaveBeforeGenerateDialog, setShowSaveBeforeGenerateDialog] = useState(false)

  // Drag state
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null)
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null)
  const [dragOverAttribute, setDragOverAttribute] = useState<string | null>(null)

  // Hover highlight state
  const [hoverHighlight, setHoverHighlight] = useState<HoverHighlight | null>(null)

  // Refs
  const leftPanelRef = useRef<HTMLDivElement>(null)
  const rightPanelRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const columnRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const targetRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const attributeRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const sourceGroupRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Data hook
  const {
    data,
    setData,
    loading,
    saving,
    generating,
    error,
    setError,
    successMessage,
    setSuccessMessage,
    hasUnsavedChanges,
    setHasUnsavedChanges,
    initializeAndLoad,
    handleSave,
    handleGenerate
  } = useMetaDVData(projectPath)

  // Connections hook
  const {
    connections,
    setConnections,
    pendingConnection,
    setPendingConnection,
    connectionToDelete,
    setConnectionToDelete,
    buildConnectionsFromData,
    handleConnectionTypeSelect,
    handleLinkEntitySelect,
    handleRemoveConnection,
    getConnectionLines
  } = useConnections()

  // Target operations hook
  const {
    selectedTargets,
    addTargetDialog,
    setAddTargetDialog,
    selfLinkDialog,
    renameAttributeDialog,
    setRenameAttributeDialog,
    selectedEntityCount,
    selfLinkAlreadyExists,
    handleOpenAddTarget,
    handleOpenEditTarget,
    handleCloseAddTarget,
    handleAddTarget,
    handleDeleteTarget,
    handleToggleTargetSelection,
    handleCreateLink,
    handleConfirmSelfLink,
    handleCancelSelfLink,
    getTargetConnectionCount,
    getTargetAttributes,
    getAttributeConnectionCount,
    handleOpenRenameAttribute,
    handleCloseRenameAttribute,
    handleRenameAttribute,
    handleDeleteAttribute,
    handleToggleMultiactiveKey
  } = useTargetOperations({
    data,
    setData,
    connections,
    setConnections,
    setHasUnsavedChanges,
    setSuccessMessage,
    setError
  })

  // Source operations hook
  const {
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
  } = useSourceOperations({
    projectPath,
    data,
    setData,
    connections,
    setConnections,
    setHasUnsavedChanges,
    setSuccessMessage,
    selectedTarget: selectedDbtTarget,
    onRefreshTree
  })

  // Confirmation handlers for delete operations
  const handleRequestDeleteSource = (source: string) => {
    const connectionCount = getSourceConnectionCount(source)
    if (connectionCount > 0) {
      setDeleteConfirmDialog({
        open: true,
        type: 'source',
        title: 'Delete Source',
        message: `Are you sure you want to delete the source "${source}"?`,
        connectionCount,
        source
      })
    } else {
      handleDeleteSource(source)
    }
  }

  const handleRequestDeleteTarget = (targetName: string) => {
    const connectionCount = getTargetConnectionCount(targetName)
    setDeleteConfirmDialog({
      open: true,
      type: 'target',
      title: 'Delete Target',
      message: `Are you sure you want to delete the target "${targetName}"?`,
      connectionCount,
      targetName
    })
  }

  const handleRequestDeleteAttribute = (targetName: string, attributeName: string) => {
    const connectionCount = getAttributeConnectionCount(attributeName)
    if (connectionCount > 0) {
      setDeleteConfirmDialog({
        open: true,
        type: 'attribute',
        title: 'Delete Attribute',
        message: `Are you sure you want to delete the attribute "${attributeName}"?`,
        connectionCount,
        targetName,
        attributeName
      })
    } else {
      handleDeleteAttribute(targetName, attributeName)
    }
  }

  const handleConfirmDelete = () => {
    if (deleteConfirmDialog.type === 'source' && deleteConfirmDialog.source) {
      handleDeleteSource(deleteConfirmDialog.source)
    } else if (deleteConfirmDialog.type === 'target' && deleteConfirmDialog.targetName) {
      handleDeleteTarget(deleteConfirmDialog.targetName)
    } else if (deleteConfirmDialog.type === 'attribute' && deleteConfirmDialog.targetName && deleteConfirmDialog.attributeName) {
      handleDeleteAttribute(deleteConfirmDialog.targetName, deleteConfirmDialog.attributeName)
    }
    setDeleteConfirmDialog((prev: DeleteConfirmDialogState) => ({ ...prev, open: false }))
  }

  const handleCancelDelete = () => {
    setDeleteConfirmDialog(prev => ({ ...prev, open: false }))
  }

  // Hover highlight handlers
  const handleConnectionHover = useCallback((connectionId: string | null) => {
    if (!connectionId) {
      setHoverHighlight(null)
      return
    }
    const conn = connections.find(c => c.id === connectionId)
    if (conn) {
      setHoverHighlight({
        type: 'connection',
        connectionId,
        connectedSources: new Set([conn.sourceColumn]),
        connectedTargets: new Set([conn.targetName]),
        connectedConnectionIds: new Set([connectionId])
      })
    }
  }, [connections])

  const handleSourceHover = useCallback((sourceColumn: string | null) => {
    if (!sourceColumn) {
      setHoverHighlight(null)
      return
    }
    const relatedConns = connections.filter(c => c.sourceColumn === sourceColumn)
    setHoverHighlight({
      type: 'source',
      sourceColumn,
      connectedSources: new Set([sourceColumn]),
      connectedTargets: new Set(relatedConns.map(c => c.targetName)),
      connectedConnectionIds: new Set(relatedConns.map(c => c.id))
    })
  }, [connections])

  const handleTargetHover = useCallback((targetName: string | null) => {
    if (!targetName) {
      setHoverHighlight(null)
      return
    }
    const relatedConns = connections.filter(c => c.targetName === targetName)
    setHoverHighlight({
      type: 'target',
      targetName,
      connectedSources: new Set(relatedConns.map(c => c.sourceColumn)),
      connectedTargets: new Set([targetName]),
      connectedConnectionIds: new Set(relatedConns.map(c => c.id))
    })
  }, [connections])

  const handleAttributeHover = useCallback((targetName: string, attributeName: string | null) => {
    if (!attributeName) {
      setHoverHighlight(null)
      return
    }
    // For attribute connections, c.targetName is the entity (e.g., "Customer")
    // We need to find connections where the source column's attribute has the matching display name
    const relatedConns = connections.filter(c => {
      if (c.connectionType !== 'attribute_of' || c.targetName !== targetName) return false
      // Find the source column and check if the attribute display name matches
      const sourceCol = data?.source_columns.find(col => getColumnKey(col) === c.sourceColumn)
      if (!sourceCol?.target) return false
      // Check if any attribute connection in this column matches the display name
      return sourceCol.target.some(t => {
        if (t.attribute_of !== targetName) return false
        const displayName = t.target_attribute || sourceCol.column
        return displayName === attributeName
      })
    })
    // Use the full attribute key (targetName.attributeName) for connectedTargets
    const attrKey = `${targetName}.${attributeName}`
    setHoverHighlight({
      type: 'target',
      targetName: attrKey,
      connectedSources: new Set(relatedConns.map(c => c.sourceColumn)),
      connectedTargets: new Set([attrKey]),
      connectedConnectionIds: new Set(relatedConns.map(c => c.id))
    })
  }, [connections, data?.source_columns])

  // Helper to add attribute connection to unified target array when creating attribute_of connection
  const setAttributeOnColumn = useCallback((sourceColumnKey: string, targetName: string) => {
    // Extract the column name from the key (format: "source.column")
    const columnName = getColumnNameFromColumnKey(sourceColumnKey)

    setData((prev: MetaDVData | null) => {
      if (!prev) return prev
      return {
        ...prev,
        source_columns: prev.source_columns.map((col: SourceColumn) => {
          if (getColumnKey(col) === sourceColumnKey) {
            // Check if this attribute connection already exists in unified target array
            const existingTarget = col.target || []
            const alreadyExists = existingTarget.some(
              t => t.attribute_of === targetName
            )
            if (alreadyExists) {
              return col
            }
            // Add new attribute connection to unified target array
            const newTargetConn = {
              attribute_of: targetName,
              target_attribute: columnName
            }
            return {
              ...col,
              target: [...existingTarget, newTargetConn]
            }
          }
          return col
        })
      }
    })
  }, [setData])

  // Wrapper for creating attribute_of connections that also sets attribute_of and target_attribute
  const handleAttributeConnectionCreate = useCallback(() => {
    if (!pendingConnection) return

    // Set attribute_of and target_attribute on the source column
    setAttributeOnColumn(pendingConnection.sourceColumn, pendingConnection.targetName)

    // Create the connection
    handleConnectionTypeSelect('attribute_of', () => setHasUnsavedChanges(true))
  }, [pendingConnection, setAttributeOnColumn, handleConnectionTypeSelect, setHasUnsavedChanges])

  // Initialize on mount
  useEffect(() => {
    initializeAndLoad().then(() => {
      // Build connections after data is loaded
    })
  }, [projectPath])

  // Track previous loading state to detect when data finishes loading
  const prevLoadingRef = useRef(loading)

  // Build connections only when data finishes loading from backend (loading: true -> false)
  // Don't rebuild on every data.source_columns change, as that would overwrite user's unsaved connections
  useEffect(() => {
    const wasLoading = prevLoadingRef.current
    prevLoadingRef.current = loading

    // Only rebuild connections when loading completes (was loading, now not loading)
    if (wasLoading && !loading && data) {
      const existingConnections = buildConnectionsFromData(data)
      setConnections(existingConnections)
    }
  }, [loading, data, buildConnectionsFromData, setConnections])

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pendingConnection) {
          setPendingConnection(null)
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, pendingConnection])

  // Filter source columns
  const filteredSourceColumns = useMemo(() => {
    if (!data?.source_columns) return []
    if (!leftFilter.trim()) return data.source_columns
    const filter = leftFilter.toLowerCase()
    return data.source_columns.filter((col: SourceColumn) =>
      col.column.toLowerCase().includes(filter) ||
      col.source.toLowerCase().includes(filter) ||
      (col.target && col.target.some((t) =>
        (t.target_name && t.target_name.toLowerCase().includes(filter)) ||
        (t.attribute_of && t.attribute_of.toLowerCase().includes(filter))
      ))
    )
  }, [data?.source_columns, leftFilter])

  // Group source columns by source (model name)
  const groupedSourceColumns = useMemo(() => {
    const groups: SourceGroup[] = []
    const groupMap = new Map<string, SourceGroup>()

    for (const col of filteredSourceColumns) {
      const key = col.source
      if (!groupMap.has(key)) {
        const group: SourceGroup = {
          source: col.source,
          columns: []
        }
        groupMap.set(key, group)
        groups.push(group)
      }
      groupMap.get(key)!.columns.push(col)
    }

    return groups
  }, [filteredSourceColumns])

  // Filter targets (selected targets always visible)
  const filteredTargets = useMemo(() => {
    if (!data?.targets) return []
    if (!rightFilter.trim()) return data.targets
    const filter = rightFilter.toLowerCase()
    return data.targets.filter((target: Target) =>
      selectedTargets.has(target.name) ||
      target.name.toLowerCase().includes(filter) ||
      (target.description && target.description.toLowerCase().includes(filter))
    )
  }, [data?.targets, rightFilter, selectedTargets])

  // Toggle source collapse
  const toggleSourceCollapse = (source: string) => {
    setCollapsedSources((prev: Set<string>) => {
      const newSet = new Set(prev)
      if (newSet.has(source)) {
        newSet.delete(source)
      } else {
        newSet.add(source)
      }
      return newSet
    })
  }

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, colKey: string) => {
    console.log('[MetaDV] Drag start:', colKey)
    setDraggedColumn(colKey)
    e.dataTransfer.setData('text/plain', colKey)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragEnd = () => {
    console.log('[MetaDV] Drag end')
    setDraggedColumn(null)
    setDragOverTarget(null)
    setDragOverAttribute(null)
  }

  const handleDragOver = (e: React.DragEvent, targetName: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverTarget !== targetName) {
      console.log('[MetaDV] Drag over:', targetName)
      setDragOverTarget(targetName)
    }
    setDragOverAttribute(null)
  }

  const handleDragOverAttribute = (e: React.DragEvent, targetName: string, attributeName: string) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    const attrKey = `${targetName}.${attributeName}`
    if (dragOverAttribute !== attrKey) {
      console.log('[MetaDV] Drag over attribute:', attrKey)
      setDragOverAttribute(attrKey)
    }
    setDragOverTarget(null)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement
    const currentTarget = e.currentTarget as HTMLElement
    if (!currentTarget.contains(relatedTarget)) {
      setDragOverTarget(null)
      setDragOverAttribute(null)
    }
  }

  const handleDrop = (e: React.DragEvent, targetName: string) => {
    e.preventDefault()
    e.stopPropagation()

    console.log('[MetaDV] Drop on:', targetName, 'draggedColumn:', draggedColumn)

    const colKey = e.dataTransfer.getData('text/plain') || draggedColumn
    console.log('[MetaDV] colKey:', colKey)

    setDragOverTarget(null)

    if (colKey) {
      const targetEl = targetRefs.current.get(targetName)
      console.log('[MetaDV] targetEl:', targetEl)
      if (targetEl) {
        const rect = targetEl.getBoundingClientRect()
        console.log('[MetaDV] Setting pendingConnection')

        // Find the target to get its type and linked entities
        const target = data?.targets.find((t: Target) => t.name === targetName)
        const targetType = target?.type || 'entity'
        const linkedEntities = target?.entities

        setPendingConnection({
          sourceColumn: colKey,
          targetName: targetName,
          position: { x: rect.left + rect.width / 2, y: rect.top },
          targetType,
          linkedEntities
        })
      }
    }

    setDraggedColumn(null)
  }

  // Drop on attribute - directly create attribute_of connection with existing attribute name
  const handleDropOnAttribute = (e: React.DragEvent, targetName: string, attributeName: string) => {
    e.preventDefault()
    e.stopPropagation()

    console.log('[MetaDV] Drop on attribute:', targetName, attributeName, 'draggedColumn:', draggedColumn)

    const colKey = e.dataTransfer.getData('text/plain') || draggedColumn
    console.log('[MetaDV] colKey:', colKey)

    setDragOverTarget(null)
    setDragOverAttribute(null)

    if (colKey) {
      // Add attribute connection to unified target array on the source column
      setData((prev: MetaDVData | null) => {
        if (!prev) return prev
        return {
          ...prev,
          source_columns: prev.source_columns.map((col: SourceColumn) => {
            if (getColumnKey(col) === colKey) {
              // Check if this attribute connection already exists
              const existingTarget = col.target || []
              const alreadyExists = existingTarget.some(
                t => t.attribute_of === targetName && (t.target_attribute || col.column) === attributeName
              )
              if (alreadyExists) {
                return col
              }
              // Add new attribute connection to unified target array
              const newTargetConn = {
                attribute_of: targetName,
                target_attribute: attributeName
              }
              return {
                ...col,
                target: [...existingTarget, newTargetConn]
              }
            }
            return col
          })
        }
      })

      // Directly create the connection without relying on pendingConnection state
      // This avoids race conditions with async state updates
      const connectionId = `${colKey}-attr-${targetName}`

      setConnections(prev => {
        // Check if connection already exists
        if (prev.some(c => c.id === connectionId)) {
          return prev
        }
        return [...prev, {
          id: connectionId,
          sourceColumn: colKey,
          targetName: targetName,
          connectionType: 'attribute_of' as const,
          color: CONNECTION_TYPE_COLORS.attribute_of
        }]
      })
      setHasUnsavedChanges(true)
    }

    setDraggedColumn(null)
  }

  // Toggle target collapse
  const toggleTargetCollapse = (targetName: string) => {
    setCollapsedTargets((prev: Set<string>) => {
      const newSet = new Set(prev)
      if (newSet.has(targetName)) {
        newSet.delete(targetName)
      } else {
        newSet.add(targetName)
      }
      return newSet
    })
  }

  // Connection lines state
  const [connectionLines, setConnectionLines] = useState<any[]>([])

  // Update connection lines
  useEffect(() => {
    const updateLines = () => {
      setConnectionLines(
        getConnectionLines(
          containerRef,
          columnRefs,
          targetRefs,
          attributeRefs,
          sourceGroupRefs,
          filteredSourceColumns,
          filteredTargets,
          collapsedSources,
          collapsedTargets
        )
      )
    }

    const timer = setTimeout(updateLines, 100)

    const leftPanel = leftPanelRef.current
    const rightPanel = rightPanelRef.current

    leftPanel?.addEventListener('scroll', updateLines)
    rightPanel?.addEventListener('scroll', updateLines)

    return () => {
      clearTimeout(timer)
      leftPanel?.removeEventListener('scroll', updateLines)
      rightPanel?.removeEventListener('scroll', updateLines)
    }
  }, [connections, filteredSourceColumns, filteredTargets, collapsedSources, collapsedTargets, getConnectionLines])

  const handleValidate = async () => {
    // Check if there are unsaved changes
    if (hasUnsavedChanges) {
      setError('Please save your changes before validating')
      return
    }

    setValidating(true)
    setError(null)
    setValidationResult(null)

    try {
      const response = await apiFetch(apiUrl('/api/metadv-validate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: projectPath })
      })

      const result = await response.json()

      if (result.success) {
        setValidationResult({
          errors: result.errors || [],
          warnings: result.warnings || [],
          summary: result.summary
        })

        if (result.errors.length === 0 && result.warnings.length === 0) {
          setSuccessMessage('Validation passed - no issues found!')
          setTimeout(() => setSuccessMessage(null), 3000)
        }
      } else {
        setError(result.error || 'Validation failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed')
    } finally {
      setValidating(false)
    }
  }

  // Generate models handlers
  const handleGenerateClick = () => {
    if (hasUnsavedChanges) {
      setShowSaveBeforeGenerateDialog(true)
    } else {
      doGenerate()
    }
  }

  const doGenerate = async () => {
    setShowSaveBeforeGenerateDialog(false)
    await handleGenerate()
  }

  const handleSaveAndGenerate = async () => {
    await handleSave(connections)
    // Only generate if save was successful (hasUnsavedChanges will be false)
    if (!hasUnsavedChanges) {
      await handleGenerate()
    }
    setShowSaveBeforeGenerateDialog(false)
  }

  const handleGenerateWithoutSaving = () => {
    doGenerate()
  }

  const handleCancelGenerate = () => {
    setShowSaveBeforeGenerateDialog(false)
  }

  return (
    <div className="metadv-modal-overlay" onClick={onClose}>
      <div className="metadv-modal" onClick={(e) => e.stopPropagation()}>
        <div className="metadv-modal-header">
          <Database size={20} />
          <h2>MetaDV - Metadata</h2>
          {hasUnsavedChanges && <span className="metadv-unsaved-indicator">Unsaved changes</span>}
          <button className="metadv-close-btn" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="metadv-modal-content">
          {loading ? (
            <div className="metadv-loading">Initializing MetaDV...</div>
          ) : error && !data ? (
            <div className="metadv-error">
              <p>Error: {error}</p>
              <button className="metadv-btn-secondary" onClick={initializeAndLoad}>
                Retry
              </button>
            </div>
          ) : (
            <>
              <div className="metadv-two-panel" ref={containerRef}>
                <SourcePanel
                  groupedSourceColumns={groupedSourceColumns}
                  sourceColumnsCount={data?.source_columns.length || 0}
                  leftFilter={leftFilter}
                  setLeftFilter={setLeftFilter}
                  collapsedSources={collapsedSources}
                  connections={connections}
                  draggedColumn={draggedColumn}
                  columnRefs={columnRefs}
                  sourceGroupRefs={sourceGroupRefs}
                  leftPanelRef={leftPanelRef}
                  hoverHighlight={hoverHighlight}
                  onToggleCollapse={toggleSourceCollapse}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onRemoveConnection={(id) => handleRemoveConnection(id, () => setHasUnsavedChanges(true))}
                  onOpenAddSource={handleOpenAddSource}
                  onEditSource={handleOpenEditSource}
                  onDeleteSource={handleRequestDeleteSource}
                  onRefreshSource={handleRefreshSource}
                  refreshingSource={refreshingSource}
                  onSourceHover={handleSourceHover}
                />

                <ConnectionsSvg
                  connectionLines={connectionLines}
                  connectionToDelete={connectionToDelete}
                  hoverHighlight={hoverHighlight}
                  onConnectionClick={(id) => setConnectionToDelete(id || null)}
                  onConnectionHover={handleConnectionHover}
                />

                {connectionToDelete && (
                  <DeleteConnectionBar
                    onDelete={() => {
                      handleRemoveConnection(connectionToDelete, () => setHasUnsavedChanges(true))
                      setConnectionToDelete(null)
                    }}
                    onCancel={() => setConnectionToDelete(null)}
                  />
                )}

                <TargetPanel
                  filteredTargets={filteredTargets}
                  targetsCount={data?.targets.length || 0}
                  rightFilter={rightFilter}
                  setRightFilter={setRightFilter}
                  selectedTargets={selectedTargets}
                  selectedEntityCount={selectedEntityCount}
                  selfLinkAlreadyExists={selfLinkAlreadyExists}
                  connections={connections}
                  dragOverTarget={dragOverTarget}
                  dragOverAttribute={dragOverAttribute}
                  collapsedTargets={collapsedTargets}
                  targetRefs={targetRefs}
                  attributeRefs={attributeRefs}
                  rightPanelRef={rightPanelRef}
                  hoverHighlight={hoverHighlight}
                  onDragOver={handleDragOver}
                  onDragOverAttribute={handleDragOverAttribute}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onDropOnAttribute={handleDropOnAttribute}
                  onToggleSelection={handleToggleTargetSelection}
                  onToggleCollapse={toggleTargetCollapse}
                  onDeleteTarget={handleRequestDeleteTarget}
                  onOpenAddTarget={handleOpenAddTarget}
                  onCreateLink={handleCreateLink}
                  onTargetHover={handleTargetHover}
                  onAttributeHover={handleAttributeHover}
                  onEditTarget={handleOpenEditTarget}
                  onRenameAttribute={handleOpenRenameAttribute}
                  onDeleteAttribute={handleRequestDeleteAttribute}
                  getTargetAttributes={getTargetAttributes}
                  onToggleMultiactiveKey={handleToggleMultiactiveKey}
                />

                {/* Color legend for connection types */}
                <div className="metadv-connection-legend">
                  <div className="metadv-legend-item">
                    <span className="metadv-legend-color" style={{ backgroundColor: CONNECTION_TYPE_COLORS.entity_name }}></span>
                    <span className="metadv-legend-label">Entity</span>
                  </div>
                  <div className="metadv-legend-item">
                    <span className="metadv-legend-color" style={{ backgroundColor: CONNECTION_TYPE_COLORS.attribute_of }}></span>
                    <span className="metadv-legend-label">Attribute Of</span>
                  </div>
                </div>
              </div>

              {pendingConnection && (
                <ConnectionTypePopup
                  position={pendingConnection.position}
                  targetName={pendingConnection.targetName}
                  linkedEntities={pendingConnection.linkedEntities}
                  onSelectEntity={(entityName, entityIndex) => handleLinkEntitySelect(entityName, entityIndex, () => setHasUnsavedChanges(true))}
                  onSelectAttribute={handleAttributeConnectionCreate}
                  onCancel={() => setPendingConnection(null)}
                />
              )}

              <AddSourceDialog
                dialog={addSourceDialog}
                setDialog={setAddSourceDialog}
                onClose={handleCloseAddSource}
                onAdd={handleAddSource}
              />

              <AddTargetDialog
                dialog={addTargetDialog}
                setDialog={setAddTargetDialog}
                onClose={handleCloseAddTarget}
                onAdd={handleAddTarget}
              />

              <DeleteConfirmDialog
                dialog={deleteConfirmDialog}
                onConfirm={handleConfirmDelete}
                onCancel={handleCancelDelete}
              />

              <SelfLinkDialog
                dialog={selfLinkDialog}
                onConfirm={handleConfirmSelfLink}
                onCancel={handleCancelSelfLink}
              />

              <RenameAttributeDialog
                dialog={renameAttributeDialog}
                setDialog={setRenameAttributeDialog}
                onClose={handleCloseRenameAttribute}
                onRename={handleRenameAttribute}
              />
            </>
          )}
        </div>

        <div className="metadv-modal-footer">
          <div className="metadv-footer-messages">
            {error && <span className="metadv-footer-error">{error}</span>}
            {successMessage && <span className="metadv-footer-success">{successMessage}</span>}
            {validationResult && (validationResult.errors.length > 0 || validationResult.warnings.length > 0) && (
              <div className="metadv-validation-results">
                <button
                  className="metadv-validation-summary"
                  onClick={() => setValidationExpanded(!validationExpanded)}
                >
                  {validationResult.errors.length > 0 && (
                    <span className="metadv-validation-badge metadv-validation-badge-error">
                      <AlertCircle size={12} />
                      {validationResult.errors.length} Error{validationResult.errors.length !== 1 ? 's' : ''}
                    </span>
                  )}
                  {validationResult.warnings.length > 0 && (
                    <span className="metadv-validation-badge metadv-validation-badge-warning">
                      <AlertTriangle size={12} />
                      {validationResult.warnings.length} Warning{validationResult.warnings.length !== 1 ? 's' : ''}
                    </span>
                  )}
                  {validationExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                </button>
                {validationExpanded && (
                  <div className="metadv-validation-details">
                    <div className="metadv-validation-details-header">
                      <span>Validation Results</span>
                      <button
                        className="metadv-validation-copy-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          const text = [
                            ...validationResult.errors.map(e => `Error: ${e.message}`),
                            ...validationResult.warnings.map(w => `Warning: ${w.message}`)
                          ].join('\n')
                          navigator.clipboard.writeText(text)
                          setSuccessMessage('Copied to clipboard')
                          setTimeout(() => setSuccessMessage(null), 2000)
                        }}
                        title="Copy to clipboard"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                    {validationResult.errors.length > 0 && (
                      <div className="metadv-validation-section metadv-validation-errors">
                        <div className="metadv-validation-section-header">Errors</div>
                        <ul className="metadv-validation-list">
                          {validationResult.errors.map((issue, idx) => (
                            <li key={idx}>{issue.message}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {validationResult.warnings.length > 0 && (
                      <div className="metadv-validation-section metadv-validation-warnings">
                        <div className="metadv-validation-section-header">Warnings</div>
                        <ul className="metadv-validation-list">
                          {validationResult.warnings.map((issue, idx) => (
                            <li key={idx}>{issue.message}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="metadv-footer-buttons">
            <button className="metadv-btn-secondary" onClick={handleValidate} disabled={saving || validating || generating}>
              <CheckCircle size={14} />
              {validating ? 'Validating...' : 'Validate'}
            </button>
            <button
              className="metadv-btn-secondary"
              onClick={handleGenerateClick}
              disabled={saving || validating || generating}
            >
              <FileCode size={14} />
              {generating ? 'Generating...' : 'Generate Models'}
            </button>
            <button
              className="metadv-btn-primary"
              onClick={() => handleSave(connections)}
              disabled={saving || !hasUnsavedChanges}
            >
              <Save size={14} />
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button className="metadv-btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        {/* Save before generate dialog */}
        <SaveBeforeGenerateDialog
          open={showSaveBeforeGenerateDialog}
          saving={saving}
          onSaveAndGenerate={handleSaveAndGenerate}
          onGenerateWithoutSaving={handleGenerateWithoutSaving}
          onCancel={handleCancelGenerate}
        />
      </div>
    </div>
  )
}

export default MetaDVModal
