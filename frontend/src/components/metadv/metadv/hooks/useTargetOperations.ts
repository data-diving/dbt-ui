// Hook for target operations (add, delete, select, link)

import { useState, useMemo, useCallback } from 'react'
import { Target, MetaDVData, Connection, AddTargetDialogState, SelfLinkDialogState, RenameAttributeDialogState, TargetAttribute, SourceColumn } from '../types'

interface UseTargetOperationsProps {
  data: MetaDVData | null
  setData: React.Dispatch<React.SetStateAction<MetaDVData | null>>
  connections: Connection[]
  setConnections: React.Dispatch<React.SetStateAction<Connection[]>>
  setHasUnsavedChanges: React.Dispatch<React.SetStateAction<boolean>>
  setSuccessMessage: React.Dispatch<React.SetStateAction<string | null>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
}

interface UseTargetOperationsResult {
  selectedTargets: Set<string>
  setSelectedTargets: React.Dispatch<React.SetStateAction<Set<string>>>
  addTargetDialog: AddTargetDialogState
  setAddTargetDialog: React.Dispatch<React.SetStateAction<AddTargetDialogState>>
  selfLinkDialog: SelfLinkDialogState
  setSelfLinkDialog: React.Dispatch<React.SetStateAction<SelfLinkDialogState>>
  renameAttributeDialog: RenameAttributeDialogState
  setRenameAttributeDialog: React.Dispatch<React.SetStateAction<RenameAttributeDialogState>>
  selectedEntityCount: number
  selfLinkAlreadyExists: boolean
  handleOpenAddTarget: () => void
  handleOpenEditTarget: (targetName: string) => void
  handleCloseAddTarget: () => void
  handleAddTarget: () => void
  handleDeleteTarget: (targetName: string) => void
  handleToggleTargetSelection: (targetName: string) => void
  handleCreateLink: () => void
  handleConfirmSelfLink: () => void
  handleCancelSelfLink: () => void
  getTargetConnectionCount: (targetName: string) => number
  getTargetAttributes: (targetName: string) => TargetAttribute[]
  getAttributeConnectionCount: (attributeName: string) => number
  handleOpenRenameAttribute: (targetName: string, attributeName: string) => void
  handleCloseRenameAttribute: () => void
  handleRenameAttribute: () => void
  handleDeleteAttribute: (targetName: string, attributeName: string) => void
  handleToggleMultiactiveKey: (attributeName: string) => void
}

export function useTargetOperations({
  data,
  setData,
  connections,
  setConnections,
  setHasUnsavedChanges,
  setSuccessMessage,
  setError
}: UseTargetOperationsProps): UseTargetOperationsResult {
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set())
  const [addTargetDialog, setAddTargetDialog] = useState<AddTargetDialogState>({
    open: false,
    targetName: '',
    description: '',
    error: null,
    editMode: false
  })
  const [selfLinkDialog, setSelfLinkDialog] = useState<SelfLinkDialogState>({
    open: false,
    entityName: ''
  })
  const [renameAttributeDialog, setRenameAttributeDialog] = useState<RenameAttributeDialogState>({
    open: false,
    targetName: '',
    oldAttributeName: '',
    newAttributeName: '',
    error: null
  })

  const selectedEntityCount = useMemo(() => {
    if (!data?.targets) return 0
    return data.targets.filter(
      (t: Target) => t.type === 'entity' && selectedTargets.has(t.name)
    ).length
  }, [data?.targets, selectedTargets])

  // Check if a self-link already exists for the selected entity (when only one is selected)
  const selfLinkAlreadyExists = useMemo(() => {
    if (!data?.targets || selectedEntityCount !== 1) return false

    const selectedEntityName = data.targets.find(
      (t: Target) => t.type === 'entity' && selectedTargets.has(t.name)
    )?.name

    if (!selectedEntityName) return false

    // Check if there's already a relation that is a self-link for this entity
    return data.targets.some((t: Target) =>
      t.type === 'relation' &&
      t.entities &&
      t.entities.length === 2 &&
      t.entities[0] === selectedEntityName &&
      t.entities[1] === selectedEntityName
    )
  }, [data?.targets, selectedTargets, selectedEntityCount])

  const handleOpenAddTarget = () => {
    setAddTargetDialog({
      open: true,
      targetName: '',
      description: '',
      error: null,
      editMode: false
    })
  }

  const handleOpenEditTarget = (targetName: string) => {
    const target = data?.targets.find((t: Target) => t.name === targetName)
    if (!target) return

    setAddTargetDialog({
      open: true,
      targetName: target.name,
      description: target.description || '',
      error: null,
      editMode: true,
      originalName: target.name
    })
  }

  const handleCloseAddTarget = () => {
    setAddTargetDialog({
      open: false,
      targetName: '',
      description: '',
      error: null,
      editMode: false
    })
  }

  const handleAddTarget = () => {
    const { targetName, description, editMode, originalName } = addTargetDialog

    if (!targetName.trim()) {
      setAddTargetDialog((prev: AddTargetDialogState) => ({ ...prev, error: 'Target name is required' }))
      return
    }

    // In edit mode, check if the new name conflicts with an existing (different) target
    if (editMode && originalName) {
      const isNameChanged = targetName.trim().toLowerCase() !== originalName.toLowerCase()
      if (isNameChanged) {
        const existingTarget = data?.targets.find(
          (t: Target) => t.name.toLowerCase() === targetName.trim().toLowerCase()
        )
        if (existingTarget) {
          setAddTargetDialog((prev: AddTargetDialogState) => ({ ...prev, error: 'A target with this name already exists' }))
          return
        }
      }

      // Update the target and all references
      setData((prev: MetaDVData | null) => {
        if (!prev) return prev
        return {
          ...prev,
          targets: prev.targets.map((t: Target) => {
            if (t.name === originalName) {
              return {
                ...t,
                name: targetName.trim(),
                description: description.trim() || undefined
              }
            }
            // Also update relation entities that reference this target
            if (t.type === 'relation' && t.entities) {
              return {
                ...t,
                entities: t.entities.map((e: string) => e === originalName ? targetName.trim() : e)
              }
            }
            return t
          })
        }
      })

      // Update connection target references
      setConnections(connections.map((c: Connection) => {
        if (c.targetName === originalName) {
          return {
            ...c,
            targetName: targetName.trim(),
            id: c.id.replace(originalName, targetName.trim())
          }
        }
        // Also update linkedEntityName if it references this target
        if (c.linkedEntityName === originalName) {
          return {
            ...c,
            linkedEntityName: targetName.trim()
          }
        }
        return c
      }))

      // Update selected targets if the edited target was selected
      setSelectedTargets((prev: Set<string>) => {
        if (prev.has(originalName)) {
          const newSet = new Set(prev)
          newSet.delete(originalName)
          newSet.add(targetName.trim())
          return newSet
        }
        return prev
      })

      setHasUnsavedChanges(true)
      handleCloseAddTarget()
      setSuccessMessage(`Updated target "${originalName}" to "${targetName.trim()}"`)
      setTimeout(() => setSuccessMessage(null), 3000)
      return
    }

    // Add mode - check for existing target
    const existingTarget = data?.targets.find(
      (t: Target) => t.name.toLowerCase() === targetName.trim().toLowerCase()
    )
    if (existingTarget) {
      setAddTargetDialog((prev: AddTargetDialogState) => ({ ...prev, error: 'A target with this name already exists' }))
      return
    }

    const newTarget: Target = {
      name: targetName.trim(),
      description: description.trim() || undefined,
      type: 'entity'
    }

    setData((prev: MetaDVData | null) => {
      if (!prev) return prev
      return {
        ...prev,
        targets: [...prev.targets, newTarget]
      }
    })

    setHasUnsavedChanges(true)
    handleCloseAddTarget()
    setSuccessMessage(`Added target "${targetName.trim()}"`)
    setTimeout(() => setSuccessMessage(null), 3000)
  }

  const getTargetConnectionCount = useCallback((targetName: string): number => {
    return connections.filter((c: Connection) => c.targetName === targetName).length
  }, [connections])

  const handleDeleteTarget = (targetName: string) => {
    setData((prev: MetaDVData | null) => {
      if (!prev) return prev
      return {
        ...prev,
        targets: prev.targets.filter((t: Target) => t.name !== targetName)
      }
    })

    setConnections(connections.filter((c: Connection) => c.targetName !== targetName))

    setSelectedTargets((prev: Set<string>) => {
      const newSet = new Set(prev)
      newSet.delete(targetName)
      return newSet
    })

    setHasUnsavedChanges(true)
    setSuccessMessage(`Deleted target "${targetName}"`)
    setTimeout(() => setSuccessMessage(null), 3000)
  }

  const handleToggleTargetSelection = (targetName: string) => {
    setSelectedTargets((prev: Set<string>) => {
      const newSet = new Set(prev)
      if (newSet.has(targetName)) {
        newSet.delete(targetName)
      } else {
        newSet.add(targetName)
      }
      return newSet
    })
  }

  const handleCreateLink = () => {
    if (selectedEntityCount < 1) return

    const selectedEntityNames = data?.targets
      .filter((t: Target) => t.type === 'entity' && selectedTargets.has(t.name))
      .map((t: Target) => t.name) || []

    // If only one entity selected, show confirmation dialog for self-link
    if (selectedEntityCount === 1) {
      setSelfLinkDialog({
        open: true,
        entityName: selectedEntityNames[0]
      })
      return
    }

    createRelation(selectedEntityNames)
  }

  const createRelation = (entityNames: string[]) => {
    // For self-link, use the entity name twice
    const relationName = entityNames.length === 1
      ? `${entityNames[0]}_self_link`
      : entityNames.join('_') + '_link'

    const existingTarget = data?.targets.find(
      (t: Target) => t.name.toLowerCase() === relationName.toLowerCase()
    )
    if (existingTarget) {
      setError(`A target named "${relationName}" already exists`)
      setTimeout(() => setError(null), 3000)
      return
    }

    // For self-link, entities array contains the same entity twice
    const entities = entityNames.length === 1
      ? [entityNames[0], entityNames[0]]
      : entityNames

    const newRelation: Target = {
      name: relationName,
      type: 'relation',
      entities
    }

    setData((prev: MetaDVData | null) => {
      if (!prev) return prev
      return {
        ...prev,
        targets: [...prev.targets, newRelation]
      }
    })

    setSelectedTargets(new Set())

    setHasUnsavedChanges(true)
    const message = entityNames.length === 1
      ? `Created self-referencing relation "${relationName}" for ${entityNames[0]}`
      : `Created relation "${relationName}" linking ${entityNames.join(', ')}`
    setSuccessMessage(message)
    setTimeout(() => setSuccessMessage(null), 3000)
  }

  const handleConfirmSelfLink = () => {
    const { entityName } = selfLinkDialog
    setSelfLinkDialog({ open: false, entityName: '' })
    createRelation([entityName])
  }

  const handleCancelSelfLink = () => {
    setSelfLinkDialog({ open: false, entityName: '' })
  }

  // Get unique attributes for a target (from attribute_of connections in unified target array)
  // Groups by target_attribute field (or falls back to column name if not set)
  const getTargetAttributes = useCallback((targetName: string): TargetAttribute[] => {
    if (!data?.source_columns) return []

    // Find all source columns that have attribute_of = targetName in their target array
    // Group them by their target_attribute (display name)
    const attributeMap = new Map<string, { count: number; hasMultiactiveKey: boolean }>()

    for (const col of data.source_columns) {
      // Check unified target array for attribute connections
      if (col.target && col.target.length > 0) {
        for (const targetConn of col.target) {
          if (targetConn.attribute_of === targetName) {
            // Use target_attribute for display name, fall back to column name if not set
            const displayName = targetConn.target_attribute || col.column
            const existing = attributeMap.get(displayName) || { count: 0, hasMultiactiveKey: false }
            attributeMap.set(displayName, {
              count: existing.count + 1,
              hasMultiactiveKey: existing.hasMultiactiveKey || targetConn.multiactive_key === true
            })
          }
        }
      }
    }

    // Convert map to array of TargetAttribute
    const attributes: TargetAttribute[] = []
    for (const [name, info] of attributeMap) {
      attributes.push({
        name,
        targetName,
        connectionCount: info.count,
        hasMultiactiveKey: info.hasMultiactiveKey
      })
    }

    return attributes
  }, [data?.source_columns])

  // Get connection count for a specific attribute (by target_attribute display name)
  const getAttributeConnectionCount = useCallback((attributeName: string): number => {
    if (!data?.source_columns) return 0
    let count = 0
    for (const col of data.source_columns) {
      if (col.target && col.target.length > 0) {
        for (const targetConn of col.target) {
          if (targetConn.attribute_of) {
            const displayName = targetConn.target_attribute || col.column
            if (displayName === attributeName) {
              count++
            }
          }
        }
      }
    }
    return count
  }, [data?.source_columns])

  // Open rename attribute dialog
  const handleOpenRenameAttribute = (targetName: string, attributeName: string) => {
    setRenameAttributeDialog({
      open: true,
      targetName,
      oldAttributeName: attributeName,
      newAttributeName: attributeName,
      error: null
    })
  }

  // Close rename attribute dialog
  const handleCloseRenameAttribute = () => {
    setRenameAttributeDialog({
      open: false,
      targetName: '',
      oldAttributeName: '',
      newAttributeName: '',
      error: null
    })
  }

  // Rename attribute (updates target_attribute in unified target array for matching attribute connections)
  const handleRenameAttribute = () => {
    const { targetName, oldAttributeName, newAttributeName } = renameAttributeDialog

    if (!newAttributeName.trim()) {
      setRenameAttributeDialog((prev: RenameAttributeDialogState) => ({
        ...prev,
        error: 'Attribute name is required'
      }))
      return
    }

    const trimmedNewName = newAttributeName.trim()

    // Update target_attribute in unified target array for matching attribute connections
    setData((prev: MetaDVData | null) => {
      if (!prev) return prev
      return {
        ...prev,
        source_columns: prev.source_columns.map((col: SourceColumn) => {
          if (!col.target || col.target.length === 0) return col

          // Check if any target connection matches
          const updatedTarget = col.target.map(targetConn => {
            if (targetConn.attribute_of === targetName) {
              const displayName = targetConn.target_attribute || col.column
              if (displayName === oldAttributeName) {
                return { ...targetConn, target_attribute: trimmedNewName }
              }
            }
            return targetConn
          })

          return { ...col, target: updatedTarget }
        })
      }
    })

    setHasUnsavedChanges(true)
    handleCloseRenameAttribute()
    setSuccessMessage(`Renamed attribute "${oldAttributeName}" to "${trimmedNewName}"`)
    setTimeout(() => setSuccessMessage(null), 3000)
  }

  // Delete attribute (removes attribute connection from unified target array)
  const handleDeleteAttribute = (targetName: string, attributeName: string) => {
    const connectionCount = getAttributeConnectionCount(attributeName)

    // Remove attribute connections from unified target array
    setData((prev: MetaDVData | null) => {
      if (!prev) return prev
      return {
        ...prev,
        source_columns: prev.source_columns.map((col: SourceColumn) => {
          if (!col.target || col.target.length === 0) return col

          // Filter out attribute connections that match the target and display name
          const filteredTarget = col.target.filter(targetConn => {
            if (targetConn.attribute_of === targetName) {
              const displayName = targetConn.target_attribute || col.column
              return displayName !== attributeName
            }
            return true  // Keep non-attribute connections and attribute connections for other targets
          })

          return {
            ...col,
            target: filteredTarget.length > 0 ? filteredTarget : null
          }
        })
      }
    })

    // Remove attribute_of connections for this target
    setConnections(connections.filter(
      (c: Connection) => !(c.targetName === targetName && c.connectionType === 'attribute_of')
    ))

    setHasUnsavedChanges(true)
    setSuccessMessage(`Deleted attribute "${attributeName}" and removed ${connectionCount} connection(s)`)
    setTimeout(() => setSuccessMessage(null), 3000)
  }

  // Toggle multiactive_key for all source columns with matching attribute display name
  const handleToggleMultiactiveKey = (attributeName: string) => {
    if (!data) return

    // Helper to check if a target connection matches by display name
    const matchesAttribute = (col: SourceColumn, targetConn: any) => {
      if (!targetConn.attribute_of) return false
      const displayName = targetConn.target_attribute || col.column
      return displayName === attributeName
    }

    // Check current state - if any matching attribute has multiactive_key, we'll turn it off for all
    // If none have it, we'll turn it on for all
    let hasMultiactiveKey = false
    for (const col of data.source_columns) {
      if (col.target) {
        for (const targetConn of col.target) {
          if (matchesAttribute(col, targetConn) && targetConn.multiactive_key === true) {
            hasMultiactiveKey = true
            break
          }
        }
      }
      if (hasMultiactiveKey) break
    }

    const newValue = !hasMultiactiveKey

    setData((prev: MetaDVData | null) => {
      if (!prev) return prev
      return {
        ...prev,
        source_columns: prev.source_columns.map((col: SourceColumn) => {
          if (!col.target || col.target.length === 0) return col

          const updatedTarget = col.target.map(targetConn => {
            if (matchesAttribute(col, targetConn)) {
              if (newValue) {
                return { ...targetConn, multiactive_key: true }
              } else {
                // Remove multiactive_key when false
                const { multiactive_key, ...rest } = targetConn
                return rest
              }
            }
            return targetConn
          })

          return { ...col, target: updatedTarget }
        })
      }
    })

    setHasUnsavedChanges(true)
    setSuccessMessage(newValue
      ? `Enabled multiactive key for attribute "${attributeName}"`
      : `Disabled multiactive key for attribute "${attributeName}"`
    )
    setTimeout(() => setSuccessMessage(null), 3000)
  }

  return {
    selectedTargets,
    setSelectedTargets,
    addTargetDialog,
    setAddTargetDialog,
    selfLinkDialog,
    setSelfLinkDialog,
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
  }
}
