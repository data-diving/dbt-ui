// Hook for managing connections between source columns and targets

import { useState, useCallback, useMemo } from 'react'
import { Connection, PendingConnection, SourceColumn, Target, MetaDVData, CONNECTION_TYPE_COLORS } from '../types'
import { getColumnKey, getSourceFromColumnKey } from '../utils'

interface UseConnectionsResult {
  connections: Connection[]
  setConnections: React.Dispatch<React.SetStateAction<Connection[]>>
  pendingConnection: PendingConnection | null
  setPendingConnection: React.Dispatch<React.SetStateAction<PendingConnection | null>>
  connectionToDelete: string | null
  setConnectionToDelete: React.Dispatch<React.SetStateAction<string | null>>
  buildConnectionsFromData: (data: MetaDVData) => Connection[]
  handleConnectionTypeSelect: (type: 'entity_name' | 'attribute_of', onUnsavedChange: () => void) => void
  handleLinkEntitySelect: (entityName: string, entityIndex: number, onUnsavedChange: () => void) => void
  handleRemoveConnection: (connectionId: string, onUnsavedChange: () => void) => void
  getConnectionLines: (
    containerRef: React.RefObject<HTMLDivElement>,
    columnRefs: React.MutableRefObject<Map<string, HTMLDivElement>>,
    targetRefs: React.MutableRefObject<Map<string, HTMLDivElement>>,
    attributeRefs: React.MutableRefObject<Map<string, HTMLDivElement>>,
    tableGroupRefs: React.MutableRefObject<Map<string, HTMLDivElement>>,
    filteredSourceColumns: SourceColumn[],
    filteredTargets: Target[],
    collapsedTables: Set<string>,
    collapsedTargets: Set<string>
  ) => any[]
}

export function useConnections(): UseConnectionsResult {
  const [connections, setConnections] = useState<Connection[]>([])
  const [pendingConnection, setPendingConnection] = useState<PendingConnection | null>(null)
  const [connectionToDelete, setConnectionToDelete] = useState<string | null>(null)

  const buildConnectionsFromData = (data: MetaDVData): Connection[] => {
    const existingConnections: Connection[] = []

    // Build a map of targets by name for quick lookup
    const targetsByName = new Map<string, Target>()
    for (const target of data.targets) {
      targetsByName.set(target.name, target)
    }

    for (const col of data.source_columns) {
      const colKey = getColumnKey(col)

      // target is a unified array containing both entity/relation keys and attribute connections
      if (col.target && col.target.length > 0) {
        for (const targetConn of col.target) {
          // Check if this is an attribute connection (has attribute_of)
          if (targetConn.attribute_of) {
            existingConnections.push({
              id: `${colKey}-attr-${targetConn.attribute_of}`,
              sourceColumn: colKey,
              targetName: targetConn.attribute_of,
              connectionType: 'attribute_of',
              color: CONNECTION_TYPE_COLORS.attribute_of
            })
          }
          // Otherwise it's an entity/relation key connection (has target_name)
          else if (targetConn.target_name) {
            const targetName = targetConn.target_name
            const entityName = targetConn.entity_name  // Only set for relation connections
            const entityIndex = targetConn.entity_index

            // Determine linked entity info for relation connections
            let linkedEntityName: string | undefined
            let linkedEntityIndex: number | undefined

            // Check if this is a relation connection (has entity_name)
            if (entityName) {
              linkedEntityName = entityName

              // Check for self-link (duplicate entities in the relation)
              const relationTarget = targetsByName.get(targetName)
              if (relationTarget?.type === 'relation' && relationTarget.entities) {
                const hasDuplicates = relationTarget.entities.length !== new Set(relationTarget.entities).size
                if (hasDuplicates && entityIndex !== undefined && entityIndex !== null) {
                  linkedEntityIndex = entityIndex
                }
              }
            }

            // Build connection ID - include entity and index for relation/self-links
            let connectionIdSuffix: string
            if (linkedEntityName) {
              connectionIdSuffix = linkedEntityIndex !== undefined
                ? `${targetName}-${linkedEntityName}-${linkedEntityIndex}`
                : `${targetName}-${linkedEntityName}`
            } else {
              connectionIdSuffix = targetName
            }

            existingConnections.push({
              id: `${colKey}-entity-${connectionIdSuffix}`,
              sourceColumn: colKey,
              targetName: targetName,
              connectionType: 'entity_name',
              color: CONNECTION_TYPE_COLORS.entity_name,
              ...(linkedEntityName && { linkedEntityName }),
              ...(linkedEntityIndex !== undefined && { linkedEntityIndex })
            })
          }
        }
      }
    }

    return existingConnections
  }

  const handleConnectionTypeSelect = (type: 'entity_name' | 'attribute_of', onUnsavedChange: () => void) => {
    if (!pendingConnection) return

    const { sourceColumn, targetName } = pendingConnection

    const existingIndex = connections.findIndex(
      c => c.sourceColumn === sourceColumn && c.targetName === targetName && c.connectionType === type
    )

    if (existingIndex === -1) {
      const newConnection: Connection = {
        id: `${sourceColumn}-${type === 'entity_name' ? 'entity' : 'attr'}-${targetName}`,
        sourceColumn,
        targetName,
        connectionType: type,
        color: CONNECTION_TYPE_COLORS[type]
      }
      setConnections([...connections, newConnection])
      onUnsavedChange()
    }

    setPendingConnection(null)
  }

  const handleLinkEntitySelect = (entityName: string, entityIndex: number, onUnsavedChange: () => void) => {
    if (!pendingConnection) return

    const { sourceColumn, targetName, linkedEntities, targetType } = pendingConnection

    // For relation targets, store which entity within the relation is being connected
    const isRelation = targetType === 'relation' && linkedEntities && linkedEntities.length > 0

    // For self-links (same entity appears multiple times), include index in the connection ID
    // to distinguish between entity positions (e.g., employee as child vs employee as parent)
    const hasDuplicates = linkedEntities && linkedEntities.length !== new Set(linkedEntities).size
    const connectionIdSuffix = isRelation
      ? (hasDuplicates ? `${targetName}-${entityName}-${entityIndex}` : `${targetName}-${entityName}`)
      : entityName

    // Check for existing connection
    const existingIndex = connections.findIndex(
      c => c.sourceColumn === sourceColumn &&
           c.targetName === targetName &&
           c.connectionType === 'entity_name' &&
           c.linkedEntityName === (isRelation ? entityName : undefined) &&
           c.linkedEntityIndex === (isRelation && hasDuplicates ? entityIndex : undefined)
    )

    if (existingIndex === -1) {
      const newConnection: Connection = {
        id: `${sourceColumn}-entity-${connectionIdSuffix}`,
        sourceColumn,
        targetName: targetName,  // Keep the actual target (link or entity)
        connectionType: 'entity_name',
        color: CONNECTION_TYPE_COLORS.entity_name,
        // For relations, store which entity within the relation
        ...(isRelation && {
          linkedEntityName: entityName,
          linkedEntityIndex: hasDuplicates ? entityIndex : undefined
        })
      }
      setConnections([...connections, newConnection])
      onUnsavedChange()
    }

    setPendingConnection(null)
  }

  const handleRemoveConnection = (connectionId: string, onUnsavedChange: () => void) => {
    setConnections(prev => prev.filter(c => c.id !== connectionId))
    onUnsavedChange()
  }

  const getConnectionLines = useCallback((
    containerRef: React.RefObject<HTMLDivElement>,
    columnRefs: React.MutableRefObject<Map<string, HTMLDivElement>>,
    targetRefs: React.MutableRefObject<Map<string, HTMLDivElement>>,
    attributeRefs: React.MutableRefObject<Map<string, HTMLDivElement>>,
    tableGroupRefs: React.MutableRefObject<Map<string, HTMLDivElement>>,
    filteredSourceColumns: SourceColumn[],
    filteredTargets: Target[],
    collapsedTables: Set<string>,
    collapsedTargets: Set<string>
  ) => {
    if (!containerRef.current) return []

    const containerRect = containerRef.current.getBoundingClientRect()
    const lines: any[] = []

    const visibleColumnKeys = new Set(filteredSourceColumns.map((col: SourceColumn) => getColumnKey(col)))
    const visibleTargetNames = new Set(filteredTargets.map((target: Target) => target.name))

    for (const conn of connections) {
      if (!visibleColumnKeys.has(conn.sourceColumn)) {
        continue
      }

      const sourceKey = getSourceFromColumnKey(conn.sourceColumn)
      const isSourceCollapsed = collapsedTables.has(sourceKey)

      const sourceEl = isSourceCollapsed
        ? tableGroupRefs.current.get(sourceKey)
        : columnRefs.current.get(conn.sourceColumn)

      // For attribute_of connections, try to find the attribute element first
      // Fall back to target header if attribute is not visible (target collapsed)
      let targetEl: HTMLDivElement | undefined
      if (conn.connectionType === 'attribute_of') {
        // For attribute_of, conn.targetName is the attribute_of value
        // We need to find the display name (target_attribute or targetName) from the source column
        const sourceCol = filteredSourceColumns.find(
          (col: SourceColumn) => getColumnKey(col) === conn.sourceColumn
        )
        // Find the target_attribute from the unified target array
        const attrConn = sourceCol?.target?.find(t => t.attribute_of === conn.targetName)
        const displayName = attrConn?.target_attribute || conn.targetName

        // The attribute ref key is "targetName.displayName"
        const attrKey = `${conn.targetName}.${displayName}`
        const attrEl = attributeRefs.current.get(attrKey)

        if (attrEl) {
          // Check if target is collapsed - if so, point to target header
          if (collapsedTargets.has(conn.targetName)) {
            targetEl = targetRefs.current.get(conn.targetName)
          } else {
            targetEl = attrEl
          }
        } else {
          // Fall back to target header if attribute element not found
          targetEl = targetRefs.current.get(conn.targetName)
        }
      } else {
        // entity_name connections go to target header
        if (!visibleTargetNames.has(conn.targetName)) {
          continue
        }
        targetEl = targetRefs.current.get(conn.targetName)
      }

      if (sourceEl && targetEl) {
        const sourceRect = sourceEl.getBoundingClientRect()
        const targetRect = targetEl.getBoundingClientRect()

        lines.push({
          id: conn.id,
          x1: sourceRect.right - containerRect.left,
          y1: sourceRect.top + sourceRect.height / 2 - containerRect.top,
          x2: targetRect.left - containerRect.left,
          y2: targetRect.top + targetRect.height / 2 - containerRect.top,
          color: conn.color,
          type: conn.connectionType,
          sourceColumn: conn.sourceColumn,
          targetName: conn.targetName
        })
      }
    }

    return lines
  }, [connections])

  return {
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
  }
}
