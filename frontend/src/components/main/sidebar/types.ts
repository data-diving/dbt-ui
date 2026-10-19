// Sidebar component types

import { ReactNode } from 'react'

export interface SidebarProps {
  projectPath: string
  onFileSelect: (file: string) => void
  selectedFile: string | null
  onToggle?: () => void
  onChangeProject?: () => void
  compilationTrigger?: number
  refreshTrigger?: number
  isDbtOperationRunning?: boolean
  compilingModels?: Set<string>
  modifiedFiles?: Set<string>
  onRefreshModifiedFiles?: () => void
  onRecreateVenv?: () => void
  schedulerAvailable?: boolean
  schedulerTitle?: string
  schedulerOpen?: boolean
  // Rendered instead of the header and file tree while the scheduler is open
  renderSchedulerSidebar?: (projectName: string) => ReactNode
  onOpenScheduler?: () => void
  onCloseScheduler?: () => void
  venvMissing?: boolean
  hasUnsavedChanges?: boolean
  dbtModalOpen?: boolean
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
