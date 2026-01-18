// Sidebar component types

export interface SidebarProps {
  projectPath: string
  onFileSelect: (file: string) => void
  selectedFile: string | null
  onToggle?: () => void
  onChangeProject?: () => void
  onCompile?: (selector: string) => Promise<void>
  compilationTrigger?: number
  refreshTrigger?: number
  isDbtOperationRunning?: boolean
  compilingModels?: Set<string>
  modifiedFiles?: Set<string>
  onRefreshModifiedFiles?: () => void
  onRecreateVenv?: () => void
  onDbtRun?: (selector: string, fullRefresh?: boolean) => Promise<void>
  venvMissing?: boolean
  hasUnsavedChanges?: boolean
  onCheckUnsavedChanges?: (actionType: string, callback: () => void) => void
  dbtModalOpen?: boolean
  onDbtModalOpenChange?: (open: boolean) => void
  selectedTarget?: string
  onPackagesFileChanged?: () => void
}

export interface TreeNode {
  name: string
  type: 'folder' | 'model' | 'source' | 'test' | 'macro' | 'file'
  children?: TreeNode[]
  path?: string
  deleted?: boolean
  hasChildren?: boolean
  isLoading?: boolean
}

export interface ApiFileNode {
  name: string
  type: 'file' | 'directory'
  path: string
  children?: ApiFileNode[]
  deleted?: boolean
  hasChildren?: boolean
}

export interface DragState {
  draggedItem: { path: string; isFolder: boolean } | null
  dragOverFolder: string | null
  dragOverRoot: boolean
}
