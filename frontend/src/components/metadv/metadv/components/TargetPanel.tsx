// Target panel component (right side)

import React from 'react'
import { Filter, Plus, X, Link, Trash2, Pencil, ChevronRight, ChevronDown, Key } from 'lucide-react'
import { Target, Connection, HoverHighlight, TargetAttribute } from '../types'

interface TargetPanelProps {
  filteredTargets: Target[]
  targetsCount: number
  rightFilter: string
  setRightFilter: (value: string) => void
  selectedTargets: Set<string>
  selectedEntityCount: number
  selfLinkAlreadyExists: boolean
  connections: Connection[]
  dragOverTarget: string | null
  dragOverAttribute: string | null
  collapsedTargets: Set<string>
  targetRefs: React.MutableRefObject<Map<string, HTMLDivElement>>
  attributeRefs: React.MutableRefObject<Map<string, HTMLDivElement>>
  rightPanelRef: React.RefObject<HTMLDivElement>
  hoverHighlight: HoverHighlight | null
  onDragOver: (e: React.DragEvent, targetName: string) => void
  onDragOverAttribute: (e: React.DragEvent, targetName: string, attributeName: string) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent, targetName: string) => void
  onDropOnAttribute: (e: React.DragEvent, targetName: string, attributeName: string) => void
  onToggleSelection: (targetName: string) => void
  onToggleCollapse: (targetName: string) => void
  onEditTarget: (targetName: string) => void
  onDeleteTarget: (targetName: string) => void
  onOpenAddTarget: () => void
  onCreateLink: () => void
  onTargetHover: (targetName: string | null) => void
  onAttributeHover: (targetName: string, attributeName: string | null) => void
  onRenameAttribute: (targetName: string, attributeName: string) => void
  onDeleteAttribute: (targetName: string, attributeName: string) => void
  getTargetAttributes: (targetName: string) => TargetAttribute[]
  onToggleMultiactiveKey: (attributeName: string) => void
}

function TargetPanel({
  filteredTargets,
  targetsCount,
  rightFilter,
  setRightFilter,
  selectedTargets,
  selectedEntityCount,
  selfLinkAlreadyExists,
  connections,
  dragOverTarget,
  dragOverAttribute,
  collapsedTargets,
  targetRefs,
  attributeRefs,
  rightPanelRef,
  hoverHighlight,
  onDragOver,
  onDragOverAttribute,
  onDragLeave,
  onDrop,
  onDropOnAttribute,
  onToggleSelection,
  onToggleCollapse,
  onEditTarget,
  onDeleteTarget,
  onOpenAddTarget,
  onCreateLink,
  onTargetHover,
  onAttributeHover,
  onRenameAttribute,
  onDeleteAttribute,
  getTargetAttributes,
  onToggleMultiactiveKey
}: TargetPanelProps) {

  const renderAttributeRow = (attr: TargetAttribute, target: Target) => {
    const attrKey = `${target.name}.${attr.name}`
    const isDropTarget = dragOverAttribute === attrKey

    // Get connections specifically for this attribute
    const attributeConnections = connections.filter((c: Connection) =>
      c.targetName === target.name && c.connectionType === 'attribute_of'
    )

    // Get unique source tables connected to this attribute
    const connectedSourceTables = new Map<string, Connection>()
    attributeConnections.forEach((conn: Connection) => {
      const sourceName = conn.sourceColumn.split('.')[0]
      if (!connectedSourceTables.has(sourceName)) {
        connectedSourceTables.set(sourceName, conn)
      }
    })

    // Check for highlight using full attribute key (targetName.attributeName)
    const isHighlighted = hoverHighlight?.connectedTargets.has(attrKey)
    const isDimmed = hoverHighlight && !isHighlighted && attributeConnections.length > 0

    return (
      <div
        key={attrKey}
        className={`metadv-list-row metadv-attribute-row metadv-drop-target ${isDropTarget ? 'drag-over' : ''} ${attributeConnections.length > 0 ? 'connected' : ''} ${isHighlighted ? 'hover-highlighted' : ''} ${isDimmed ? 'hover-dimmed' : ''}`}
        onDragOver={(e: React.DragEvent) => onDragOverAttribute(e, target.name, attr.name)}
        onDragLeave={(e: React.DragEvent) => onDragLeave(e)}
        onDrop={(e: React.DragEvent) => onDropOnAttribute(e, target.name, attr.name)}
        onMouseEnter={() => attributeConnections.length > 0 && onAttributeHover(target.name, attr.name)}
        onMouseLeave={() => onAttributeHover(target.name, null)}
        ref={(el) => {
          if (el) attributeRefs.current.set(attrKey, el)
        }}
      >
        <div className="metadv-attribute-info">
          <span className="metadv-attribute-name">{attr.name}</span>
          <span className="metadv-attribute-count">
            {connectedSourceTables.size} source{connectedSourceTables.size !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="metadv-attribute-connections">
          {Array.from(connectedSourceTables.entries()).map(([sourceName, conn]) => (
            <span
              key={sourceName}
              className="metadv-connection-indicator"
              style={{ backgroundColor: conn.color }}
              title={`Source: ${sourceName}`}
            />
          ))}
        </div>
        <button
          className={`metadv-multiactive-key-btn ${attr.hasMultiactiveKey ? 'active' : ''}`}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation()
            onToggleMultiactiveKey(attr.name)
          }}
          title={attr.hasMultiactiveKey ? "Disable multiactive key" : "Enable multiactive key"}
        >
          <Key size={14} />
        </button>
        <button
          className="metadv-edit-btn"
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation()
            onRenameAttribute(target.name, attr.name)
          }}
          title="Rename attribute"
        >
          <Pencil size={14} />
        </button>
        <button
          className="metadv-delete-btn"
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation()
            onDeleteAttribute(target.name, attr.name)
          }}
          title="Delete attribute"
        >
          <Trash2 size={14} />
        </button>
      </div>
    )
  }

  const renderTargetGroup = (target: Target, index: number) => {
    const isDropTarget = dragOverTarget === target.name
    const isConnected = connections.some((c: Connection) => c.targetName === target.name)
    const isSelected = selectedTargets.has(target.name)
    const isEntity = target.type === 'entity'
    const isHighlighted = hoverHighlight?.connectedTargets.has(target.name)
    const isDimmed = hoverHighlight && !isHighlighted && isConnected
    const isCollapsed = collapsedTargets.has(target.name)

    // Get attributes for this target
    const attributes = getTargetAttributes(target.name)

    // Count entity connections (not attribute connections)
    const entityConnections = connections.filter(
      (c: Connection) => c.targetName === target.name && c.connectionType === 'entity_name'
    )

    // Get unique source tables connected to this target
    const connectedSourceTables = new Map<string, Connection>()
    entityConnections.forEach((conn: Connection) => {
      const sourceName = conn.sourceColumn.split('.')[0]
      if (!connectedSourceTables.has(sourceName)) {
        connectedSourceTables.set(sourceName, conn)
      }
    })

    return (
      <div key={`${target.name}-${index}`} className="metadv-target-group">
        <div
          className={`metadv-target-group-header metadv-drop-target ${isDropTarget ? 'drag-over' : ''} ${isConnected ? 'connected' : ''} ${isSelected ? 'selected' : ''} ${target.type === 'relation' ? 'relation' : ''} ${isHighlighted ? 'hover-highlighted' : ''} ${isDimmed ? 'hover-dimmed' : ''}`}
          onDragOver={(e: React.DragEvent) => onDragOver(e, target.name)}
          onDragLeave={(e: React.DragEvent) => onDragLeave(e)}
          onDrop={(e: React.DragEvent) => onDrop(e, target.name)}
          onMouseEnter={() => isConnected && onTargetHover(target.name)}
          onMouseLeave={() => onTargetHover(null)}
          onClick={() => attributes.length > 0 && onToggleCollapse(target.name)}
          ref={(el) => {
            if (el) targetRefs.current.set(target.name, el)
          }}
        >
          {attributes.length > 0 ? (
            isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />
          ) : (
            <span className="metadv-target-spacer" />
          )}

          {isEntity && (
            <input
              type="checkbox"
              className="metadv-target-checkbox"
              checked={isSelected}
              onChange={() => onToggleSelection(target.name)}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              title="Select for linking"
            />
          )}
          <div className="metadv-target-info">
            <div className="metadv-target-name-row">
              <span className={`metadv-target-type-badge ${target.type}`}>
                {target.type === 'entity' ? 'E' : 'R'}
              </span>
              <span className="metadv-target-name">{target.name}</span>
            </div>
            {target.description && (
              <span className="metadv-target-description">{target.description}</span>
            )}
            {target.type === 'relation' && target.entities && (
              <span className="metadv-target-entities">
                Links: {target.entities.join(', ')}
              </span>
            )}
          </div>
          <div className="metadv-target-counts">
            {connectedSourceTables.size > 0 && (
              <span className="metadv-target-entity-count">{connectedSourceTables.size} source{connectedSourceTables.size !== 1 ? 's' : ''}</span>
            )}
            {attributes.length > 0 && (
              <span className="metadv-target-attr-count">{attributes.length} attr</span>
            )}
          </div>
          <div className="metadv-target-connections">
            {Array.from(connectedSourceTables.entries()).map(([sourceName, conn]) => (
              <span
                key={sourceName}
                className="metadv-connection-indicator"
                style={{ backgroundColor: conn.color }}
                title={`Source: ${sourceName}`}
              />
            ))}
          </div>
          {isEntity && (
            <button
              className="metadv-edit-btn"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation()
                onEditTarget(target.name)
              }}
              title="Edit target"
            >
              <Pencil size={14} />
            </button>
          )}
          <button
            className="metadv-delete-btn"
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation()
              onDeleteTarget(target.name)
            }}
            title="Delete target"
          >
            <Trash2 size={14} />
          </button>
        </div>

        {/* Attributes section */}
        {!isCollapsed && attributes.length > 0 && (
          <div className="metadv-target-attributes">
            {attributes.map((attr) => renderAttributeRow(attr, target))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="metadv-panel">
      <div className="metadv-panel-header">
        <h3>Targets</h3>
        <div className="metadv-panel-actions">
          <div className="metadv-filter-input">
            <Filter size={14} />
            <input
              type="text"
              placeholder="Filter targets..."
              value={rightFilter}
              onChange={(e) => setRightFilter(e.target.value)}
            />
            {rightFilter && (
              <button
                className="metadv-filter-clear"
                onClick={() => setRightFilter('')}
                title="Clear filter"
              >
                <X size={12} />
              </button>
            )}
          </div>
          <button
            className="metadv-link-btn"
            onClick={onCreateLink}
            disabled={selectedEntityCount < 1 || selfLinkAlreadyExists}
            title={
              selectedEntityCount < 1
                ? "Select entity targets to link"
                : selfLinkAlreadyExists
                  ? "Self-link already exists for this entity"
                  : selectedEntityCount === 1
                    ? "Create self-referencing relation"
                    : "Create relation from selected entities"
            }
          >
            <Link size={14} />
            <span>Link{selectedEntityCount > 0 ? ` (${selectedEntityCount})` : ''}</span>
          </button>
          <button
            className="metadv-add-btn"
            onClick={onOpenAddTarget}
            title="Add new target"
          >
            <Plus size={14} />
            <span>Add Target</span>
          </button>
        </div>
      </div>
      <div className="metadv-panel-content" ref={rightPanelRef}>
        {filteredTargets.length === 0 ? (
          <div className="metadv-empty">
            {targetsCount === 0
              ? 'No targets defined. Click "Add Target" to create one.'
              : 'No targets match the filter.'}
          </div>
        ) : (
          <div className="metadv-list">
            {filteredTargets.map((target: Target, idx: number) => renderTargetGroup(target, idx))}
          </div>
        )}
      </div>
    </div>
  )
}

export default TargetPanel
