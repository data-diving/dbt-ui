// MetaDV component types

export interface SourceGroup {
  source: string  // Model name (e.g., 'raw_sales')
  columns: SourceColumn[]
}

export interface Target {
  name: string
  description?: string
  type: 'entity' | 'relation'
  entities?: string[]
}

// Represents a connection from a source column to a target
// Unified structure: each entry is either an entity/relation key OR an attribute connection
export interface TargetConnection {
  // For entity/relation key connections:
  target_name?: string  // The target (entity or relation) this column connects to
  entity_name?: string  // For relation connections: which entity within the relation
  entity_index?: number // For self-links: position in the relation's entities list (0-indexed)

  // For attribute connections:
  attribute_of?: string // The target this column is an attribute of
  target_attribute?: string // Custom display name for the attribute
  multiactive_key?: boolean // For multiactive satellites
}

export interface SourceColumn {
  source: string  // Model name
  column: string
  // Unified array of all connections (both entity keys and attributes)
  target?: TargetConnection[] | null
}

export interface MetaDVData {
  targets: Target[]
  source_columns: SourceColumn[]
  raw: any
}

export interface Connection {
  id: string
  sourceColumn: string
  targetName: string
  connectionType: 'entity_name' | 'attribute_of'
  color: string
  // For relation targets: which entity within the relation this connects to
  linkedEntityName?: string
  linkedEntityIndex?: number
}

export interface PendingConnection {
  sourceColumn: string
  targetName: string
  position: { x: number; y: number }
  targetType: 'entity' | 'relation'
  linkedEntities?: string[]  // For relation targets, the entities it links
}

export interface AddSourceDialogState {
  open: boolean
  sourceName: string  // Model name
  loading: boolean
  error: string | null
  // Edit mode fields
  editMode: boolean
  originalSource?: string
}

export interface AddTargetDialogState {
  open: boolean
  targetName: string
  description: string
  error: string | null
  // Edit mode fields
  editMode: boolean
  originalName?: string
}

export interface DeleteConfirmDialogState {
  open: boolean
  type: 'source' | 'target' | 'attribute'
  title: string
  message: string
  connectionCount: number
  // For source deletion
  source?: string
  // For target deletion
  targetName?: string
  // For attribute deletion
  attributeName?: string
}

export interface RenameAttributeDialogState {
  open: boolean
  targetName: string
  oldAttributeName: string
  newAttributeName: string
  error: string | null
}

// Computed attribute info for display in target panel
export interface TargetAttribute {
  name: string
  targetName: string
  connectionCount: number
  hasMultiactiveKey: boolean  // True if any connected column has multiactive_key = true
}

export interface SelfLinkDialogState {
  open: boolean
  entityName: string
}

export interface MetaDVModalProps {
  projectPath: string
  onClose: () => void
  selectedDbtTarget?: string
  onRefreshTree?: () => void
}

// Fixed colors by connection type for consistency
export const CONNECTION_TYPE_COLORS = {
  entity_name: '#9cdcfe', // light blue - for entity/primary key connections
  attribute_of: '#dcdcaa', // yellow - for attribute connections
} as const

// Hover highlight state for showing connected elements
export interface HoverHighlight {
  type: 'connection' | 'source' | 'target'
  connectionId?: string
  sourceColumn?: string
  targetName?: string
  connectedSources: Set<string>
  connectedTargets: Set<string>
  connectedConnectionIds: Set<string>
}
