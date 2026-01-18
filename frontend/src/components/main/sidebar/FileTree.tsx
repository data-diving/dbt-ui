// File tree rendering component

import {
  FolderOpen,
  ChevronRight,
  ChevronDown,
  FileText,
  Loader2,
  AlertCircle,
  Database,
  FileCode,
  Table,
  Braces,
  ScrollText
} from 'lucide-react'
import { TreeNode, DragState } from './types'

interface FileTreeProps {
  tree: TreeNode[]
  expandedNodes: Set<string>
  selectedFile: string | null
  selectedDeletedFile: string | null
  compilingModels?: Set<string>
  modifiedFiles?: Set<string>
  dragState: DragState
  onToggleNode: (path: string, node: TreeNode) => void
  onSelectFile: (path: string, isFolder: boolean, isDeleted: boolean) => void
  onDragStart: (path: string, isFolder: boolean) => void
  onDragEnd: () => void
  onDragOver: (e: React.DragEvent, nodePath: string, isFolder: boolean, itemPath: string | undefined) => void
  onDragLeave: (e: React.DragEvent, nodePath: string) => void
  onDrop: (e: React.DragEvent, nodePath: string, isFolder: boolean, itemPath: string | undefined) => void
}

const getFileIcon = (fileName: string) => {
  if (fileName.endsWith('.sql')) {
    return <Database size={16} />
  } else if (fileName.endsWith('.yml') || fileName.endsWith('.yaml')) {
    return <FileCode size={16} />
  } else if (fileName.endsWith('.csv')) {
    return <Table size={16} />
  } else if (fileName.endsWith('.json')) {
    return <Braces size={16} />
  } else if (fileName.endsWith('.log')) {
    return <ScrollText size={16} />
  } else {
    return <FileText size={16} />
  }
}

function FileTree({
  tree,
  expandedNodes,
  selectedFile,
  selectedDeletedFile,
  compilingModels,
  modifiedFiles,
  dragState,
  onToggleNode,
  onSelectFile,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop
}: FileTreeProps) {
  const { draggedItem, dragOverFolder } = dragState

  const renderTree = (nodes: TreeNode[], parentPath = '') => {
    return nodes.map((node) => {
      const nodePath = parentPath ? `${parentPath}/${node.name}` : node.name
      const isExpanded = expandedNodes.has(nodePath)
      const hasChildren = (node.children && node.children.length > 0) || node.hasChildren
      const itemPath = node.type === 'folder' ? nodePath : node.path
      const isDeleted = node.deleted || false
      const isSelected = itemPath === selectedFile || (isDeleted && itemPath === selectedDeletedFile)
      const modelName = node.path?.split('/').pop()?.replace(/\.sql$/, '')
      const isCompiling = compilingModels && modelName && compilingModels.has(modelName)
      const isModified = modifiedFiles && node.path && modifiedFiles.has(node.path)
      const isFolder = node.type === 'folder'
      const isDragOver = dragOverFolder === nodePath

      return (
        <div key={nodePath} className="tree-node">
          <div
            className={`tree-node-content ${isDeleted ? 'deleted' : 'clickable'} ${isSelected ? 'selected' : ''} ${isDragOver ? 'drag-over' : ''}`}
            draggable={!isDeleted}
            onDragStart={(e) => {
              if (isDeleted) return
              e.stopPropagation()
              onDragStart(itemPath || '', isFolder)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnd={onDragEnd}
            onDragOver={(e) => {
              if (isDeleted) return
              e.preventDefault()
              e.stopPropagation()
              if (draggedItem && draggedItem.path !== itemPath) {
                onDragOver(e, nodePath, isFolder, itemPath)
              }
            }}
            onDragLeave={(e) => {
              e.stopPropagation()
              onDragLeave(e, nodePath)
            }}
            onDrop={(e) => {
              if (isDeleted) return
              e.preventDefault()
              e.stopPropagation()
              onDrop(e, nodePath, isFolder, itemPath)
            }}
            onClick={() => {
              if (hasChildren) {
                onToggleNode(nodePath, node)
              }
              if (itemPath) {
                onSelectFile(itemPath, isFolder, isDeleted)
              }
            }}
          >
            {hasChildren && (
              <span className="tree-chevron">
                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </span>
            )}
            {!hasChildren && <span className="tree-spacer" />}
            <span className="tree-icon">
              {node.type === 'folder' ? <FolderOpen size={16} /> : getFileIcon(node.name)}
            </span>
            <span className={`tree-label ${isDeleted ? 'strikethrough' : ''}`}>{node.name}</span>
            {isModified && !isCompiling && !isDeleted && (
              <span className="tree-modified">
                <AlertCircle size={14} />
              </span>
            )}
            {isCompiling && (
              <span className="tree-spinner">
                <Loader2 size={14} className="spinning" />
              </span>
            )}
          </div>
          {hasChildren && isExpanded && (
            <div className="tree-children">
              {node.children ? renderTree(node.children, nodePath) : (
                <div className="tree-loading">
                  <Loader2 size={14} className="spinning" />
                  <span>Loading...</span>
                </div>
              )}
            </div>
          )}
        </div>
      )
    })
  }

  return <>{renderTree(tree)}</>
}

export default FileTree
