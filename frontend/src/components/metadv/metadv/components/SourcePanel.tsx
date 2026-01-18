// Source panel component (left side)

import React from 'react'
import { Search, Plus, X, ChevronRight, ChevronDown, Trash2, Pencil, RefreshCw } from 'lucide-react'
import { SourceGroup, SourceColumn, Connection, HoverHighlight } from '../types'
import { getColumnKey } from '../utils'

interface SourcePanelProps {
  groupedSourceColumns: SourceGroup[]
  sourceColumnsCount: number
  leftFilter: string
  setLeftFilter: (value: string) => void
  collapsedSources: Set<string>
  connections: Connection[]
  draggedColumn: string | null
  compilingModels?: Set<string>
  columnRefs: React.MutableRefObject<Map<string, HTMLDivElement>>
  sourceGroupRefs: React.MutableRefObject<Map<string, HTMLDivElement>>
  leftPanelRef: React.RefObject<HTMLDivElement>
  hoverHighlight: HoverHighlight | null
  onToggleCollapse: (source: string) => void
  onDragStart: (e: React.DragEvent, colKey: string) => void
  onDragEnd: () => void
  onRemoveConnection: (connectionId: string) => void
  onOpenAddSource: () => void
  onEditSource: (source: string) => void
  onDeleteSource: (source: string) => void
  onRefreshSource: (source: string) => void
  refreshingSource: string | null
  onSourceHover: (sourceColumn: string | null) => void
}

function SourcePanel({
  groupedSourceColumns,
  sourceColumnsCount,
  leftFilter,
  setLeftFilter,
  collapsedSources,
  connections,
  draggedColumn,
  columnRefs,
  sourceGroupRefs,
  leftPanelRef,
  hoverHighlight,
  onToggleCollapse,
  onDragStart,
  onDragEnd,
  onRemoveConnection,
  onOpenAddSource,
  onEditSource,
  onDeleteSource,
  onRefreshSource,
  refreshingSource,
  onSourceHover
}: SourcePanelProps) {

  const renderSourceColumnRow = (col: SourceColumn, index: number) => {
    const colKey = getColumnKey(col)
    const isConnected = connections.some(c => c.sourceColumn === colKey)
    const isDragging = draggedColumn === colKey
    const isHighlighted = hoverHighlight?.connectedSources.has(colKey)
    const isDimmed = hoverHighlight && !isHighlighted && isConnected

    return (
      <div
        key={`${colKey}-${index}`}
        className={`metadv-list-row metadv-column-row metadv-draggable ${isDragging ? 'dragging' : ''} ${isConnected ? 'connected' : ''} ${isHighlighted ? 'hover-highlighted' : ''} ${isDimmed ? 'hover-dimmed' : ''}`}
        draggable={true}
        onDragStart={(e) => onDragStart(e, colKey)}
        onDragEnd={onDragEnd}
        onMouseEnter={() => isConnected && onSourceHover(colKey)}
        onMouseLeave={() => onSourceHover(null)}
        ref={(el) => {
          if (el) columnRefs.current.set(colKey, el)
        }}
      >
        <div className="metadv-col-info" draggable={false}>
          <span className="metadv-col-name">{col.column}</span>
        </div>
        <div className="metadv-col-meta" draggable={false}>
          {connections
            .filter(c => c.sourceColumn === colKey)
            .map(conn => (
              <span
                key={conn.id}
                className={`metadv-tag ${conn.connectionType === 'entity_name' ? 'metadv-tag-entity' : 'metadv-tag-attribute'}`}
                style={{ borderLeft: `3px solid ${conn.color}` }}
                title={`${conn.connectionType === 'entity_name' ? 'Entity' : 'Attribute of'}: ${conn.targetName}`}
              >
                {conn.targetName}
                <button
                  className="metadv-tag-remove"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemoveConnection(conn.id)
                  }}
                  title="Remove connection"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
        </div>
        <div className="metadv-drag-handle" title="Drag to connect to a target" draggable={false}>
          <span className="metadv-drag-dots">⋮⋮</span>
        </div>
      </div>
    )
  }

  const renderSourceGroup = (group: SourceGroup) => {
    const sourceName = group.source
    const isCollapsed = collapsedSources.has(sourceName)
    const isRefreshing = refreshingSource === sourceName
    const connectedCount = group.columns.filter((col: SourceColumn) =>
      connections.some((c: Connection) => c.sourceColumn === getColumnKey(col))
    ).length

    return (
      <div key={sourceName} className="metadv-table-group">
        <div
          className={`metadv-table-group-header ${isCollapsed && connectedCount > 0 ? 'has-connections' : ''}`}
          onClick={() => onToggleCollapse(sourceName)}
          ref={(el: HTMLDivElement | null) => {
            if (el) sourceGroupRefs.current.set(sourceName, el)
          }}
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <span className="metadv-table-group-name">{sourceName}</span>
          <span className="metadv-table-group-count">
            {connectedCount > 0 && <span className="metadv-table-group-connected">{connectedCount} connected</span>}
            {group.columns.length} columns
          </span>
          <button
            className={`metadv-refresh-btn ${isRefreshing ? 'refreshing' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              if (!isRefreshing) {
                onRefreshSource(sourceName)
              }
            }}
            title="Refresh columns from database"
            disabled={isRefreshing}
          >
            <RefreshCw size={14} className={isRefreshing ? 'spinning' : ''} />
          </button>
          <button
            className="metadv-edit-btn"
            onClick={(e) => {
              e.stopPropagation()
              onEditSource(sourceName)
            }}
            title="Edit source"
          >
            <Pencil size={14} />
          </button>
          <button
            className="metadv-delete-btn"
            onClick={(e) => {
              e.stopPropagation()
              onDeleteSource(sourceName)
            }}
            title="Delete source"
          >
            <Trash2 size={14} />
          </button>
        </div>
        {!isCollapsed && (
          <div className="metadv-table-group-columns">
            {group.columns.map((col, idx) => renderSourceColumnRow(col, idx))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="metadv-panel">
      <div className="metadv-panel-header">
        <h3>Sources</h3>
        <div className="metadv-panel-actions">
          <div className="metadv-filter-input">
            <Search size={14} />
            <input
              type="text"
              placeholder="Filter columns..."
              value={leftFilter}
              onChange={(e) => setLeftFilter(e.target.value)}
            />
            {leftFilter && (
              <button
                className="metadv-filter-clear"
                onClick={() => setLeftFilter('')}
                title="Clear filter"
              >
                <X size={12} />
              </button>
            )}
          </div>
          <button
            className="metadv-add-btn"
            onClick={onOpenAddSource}
            title="Add new source model"
          >
            <Plus size={14} />
            <span>Add Source</span>
          </button>
        </div>
      </div>
      <div className="metadv-panel-content" ref={leftPanelRef}>
        {groupedSourceColumns.length === 0 ? (
          <div className="metadv-empty">
            {sourceColumnsCount === 0
              ? 'No source columns defined. Click "Add Source" to fetch columns from a model.'
              : 'No columns match the filter.'}
          </div>
        ) : (
          <div className="metadv-list">
            {groupedSourceColumns.map((group: SourceGroup) => renderSourceGroup(group))}
          </div>
        )}
      </div>
    </div>
  )
}

export default SourcePanel
