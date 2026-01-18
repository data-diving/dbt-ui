// Main Sidebar component - orchestrates sub-components and hooks

import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import '../Sidebar.css'

import { SidebarProps, TreeNode, DragState } from './types'
import { useProjectData } from './hooks/useProjectData'
import { useDirectoryTree } from './hooks/useDirectoryTree'
import { useFileOperations } from './hooks/useFileOperations'
import { findNodeInTree, updateNodeInTree } from './utils'
import FileTree from './FileTree'
import SidebarHeader from './SidebarHeader'
import SidebarActions from './SidebarActions'
import DbtRunModal from '../../dbt/DbtRunModal'
import ConfirmModal from '../ConfirmModal'
import GitModal from '../../git/GitModal'

function Sidebar({
  projectPath,
  onFileSelect,
  selectedFile,
  onToggle,
  onChangeProject,
  onCompile,
  compilationTrigger,
  refreshTrigger,
  isDbtOperationRunning,
  compilingModels,
  modifiedFiles,
  onRefreshModifiedFiles,
  onRecreateVenv,
  onDbtRun,
  venvMissing,
  hasUnsavedChanges = false,
  onCheckUnsavedChanges,
  dbtModalOpen = false,
  onDbtModalOpenChange,
  selectedTarget = '',
  onPackagesFileChanged
}: SidebarProps) {
  // Selection state
  const [selectedIsFolder, setSelectedIsFolder] = useState(false)
  const [selectedIsDeleted, setSelectedIsDeleted] = useState(false)
  const [selectedDeletedFile, setSelectedDeletedFile] = useState<string | null>(null)

  // Drag state
  const [dragState, setDragState] = useState<DragState>({
    draggedItem: null,
    dragOverFolder: null,
    dragOverRoot: false
  })

  // Modal state
  const [showRunModal, setShowRunModal] = useState(false)
  const [showCompileModal, setShowCompileModal] = useState(false)
  const [showRenameModal, setShowRenameModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showGitModal, setShowGitModal] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [isCompiling, setIsCompiling] = useState(false)

  // Project data hook
  const {
    projectName,
    branchName,
    manifestMissing,
    loadProjectName,
    loadBranchName,
    checkManifest
  } = useProjectData(projectPath)

  // Directory tree hook
  const {
    tree,
    setTree,
    treeRef,
    loading,
    expandedNodes,
    setExpandedNodes,
    loadDirectoryTree,
    loadFolderChildren,
    toggleNode,
    refreshTreeWithExpandedFolders
  } = useDirectoryTree(projectPath)

  // File operations hook
  const {
    handleCreateFile,
    handleRenameConfirm,
    handleDeleteConfirm,
    handleRestoreFile,
    handleMoveFile
  } = useFileOperations({
    projectPath,
    tree,
    setTree,
    selectedFile,
    selectedIsFolder,
    onFileSelect,
    onRefreshModifiedFiles,
    onPackagesFileChanged,
    loadDirectoryTree,
    checkManifest
  })

  // Initial load
  useEffect(() => {
    console.log('[Sidebar] useEffect triggered with projectPath:', projectPath)
    if (!projectPath) return

    let cancelled = false

    const loadData = async () => {
      if (cancelled) return
      console.log('[Sidebar] Calling loadDirectoryTree and loadProjectName')
      await Promise.all([
        loadDirectoryTree(),
        loadProjectName(),
        loadBranchName(),
        checkManifest()
      ])
    }

    loadData()

    return () => {
      cancelled = true
    }
  }, [projectPath])

  // Re-check manifest and reload tree when compilation completes
  useEffect(() => {
    if (compilationTrigger && compilationTrigger > 0) {
      checkManifest()
      refreshTreeWithExpandedFolders()
    }
  }, [compilationTrigger])

  // Refresh when refreshTrigger changes
  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      refreshTreeWithExpandedFolders()
    }
  }, [refreshTrigger])

  // Auto-expand folders when a file is selected
  useEffect(() => {
    if (!selectedFile) return

    const pathParts = selectedFile.split('/')
    const parentPaths: string[] = []

    for (let i = 0; i < pathParts.length - 1; i++) {
      const parentPath = pathParts.slice(0, i + 1).join('/')
      parentPaths.push(parentPath)
    }

    setExpandedNodes(prev => {
      const newSet = new Set(prev)
      parentPaths.forEach(p => newSet.add(p))
      return newSet
    })

    const loadMissingFolders = async () => {
      let currentTree = treeRef.current
      for (const folderPath of parentPaths) {
        const node = findNodeInTree(currentTree, folderPath)
        if (node && node.type === 'folder' && node.hasChildren && !node.children) {
          const children = await loadFolderChildren(folderPath)
          currentTree = updateNodeInTree(currentTree, folderPath, n => ({
            ...n,
            children,
            hasChildren: children.length > 0
          }))
          setTree(currentTree)
        }
      }
    }

    loadMissingFolders()
  }, [selectedFile])

  // Handler for branch changes
  const handleBranchChange = async () => {
    setExpandedNodes(new Set())
    await Promise.all([loadBranchName(), loadDirectoryTree()])
  }

  // Selection handlers
  const handleSelectFile = (path: string, isFolder: boolean, isDeleted: boolean) => {
    if (isDeleted) {
      onFileSelect('')
      setSelectedDeletedFile(path)
    } else {
      setSelectedDeletedFile(null)
      onFileSelect(path)
    }
    setSelectedIsFolder(isFolder)
    setSelectedIsDeleted(isDeleted)
  }

  // Drag handlers
  const handleDragStart = (path: string, isFolder: boolean) => {
    setDragState(prev => ({
      ...prev,
      draggedItem: { path, isFolder }
    }))
  }

  const handleDragEnd = () => {
    setDragState({
      draggedItem: null,
      dragOverFolder: null,
      dragOverRoot: false
    })
  }

  const handleDragOver = (e: React.DragEvent, nodePath: string, isFolder: boolean, itemPath: string | undefined) => {
    if (isFolder) {
      setDragState(prev => ({
        ...prev,
        dragOverFolder: nodePath,
        dragOverRoot: false
      }))
    } else {
      const targetDir = itemPath?.includes('/') ? itemPath.substring(0, itemPath.lastIndexOf('/')) : ''
      if (targetDir) {
        setDragState(prev => ({
          ...prev,
          dragOverFolder: targetDir,
          dragOverRoot: false
        }))
      } else {
        setDragState(prev => ({
          ...prev,
          dragOverFolder: null,
          dragOverRoot: true
        }))
      }
    }
  }

  const handleDragLeave = (e: React.DragEvent, nodePath: string) => {
    if (dragState.dragOverFolder === nodePath) {
      setDragState(prev => ({
        ...prev,
        dragOverFolder: null
      }))
    }
  }

  const handleDrop = (e: React.DragEvent, nodePath: string, isFolder: boolean, itemPath: string | undefined) => {
    const { draggedItem } = dragState
    setDragState({
      draggedItem: null,
      dragOverFolder: null,
      dragOverRoot: false
    })

    if (draggedItem && draggedItem.path !== itemPath) {
      if (isFolder) {
        if (!nodePath.startsWith(draggedItem.path + '/')) {
          handleMoveFile(draggedItem.path, nodePath)
        }
      } else {
        const targetDir = itemPath?.includes('/') ? itemPath.substring(0, itemPath.lastIndexOf('/')) : ''
        handleMoveFile(draggedItem.path, targetDir)
      }
    }
  }

  // dbt handlers
  const handleDbtRun = async (selector: string, fullRefresh?: boolean) => {
    if (!onDbtRun) return
    setIsRunning(true)
    setShowRunModal(false)
    try {
      await onDbtRun(selector, fullRefresh)
    } finally {
      setIsRunning(false)
    }
  }

  const handleDbtCompile = async (selector: string) => {
    if (!onCompile) return
    setIsCompiling(true)
    setShowCompileModal(false)
    try {
      await onCompile(selector)
    } finally {
      setIsCompiling(false)
    }
  }

  const hasModifiedFiles = modifiedFiles ? modifiedFiles.size > 0 : false

  return (
    <div className="sidebar">
      <SidebarHeader
        projectName={projectName}
        projectPath={projectPath}
        branchName={branchName}
        selectedFile={selectedFile}
        selectedIsDeleted={selectedIsDeleted}
        onCreateFile={handleCreateFile}
        onRenameClick={() => selectedFile && setShowRenameModal(true)}
        onDeleteClick={() => selectedFile && setShowDeleteModal(true)}
        onRestoreClick={() => selectedDeletedFile && handleRestoreFile(selectedDeletedFile)}
      />

      <div className="sidebar-tree">
        {loading ? (
          <div style={{ padding: '1rem', color: '#888' }}>Loading project files...</div>
        ) : (
          <>
            <FileTree
              tree={tree}
              expandedNodes={expandedNodes}
              selectedFile={selectedFile}
              selectedDeletedFile={selectedDeletedFile}
              compilingModels={compilingModels}
              modifiedFiles={modifiedFiles}
              dragState={dragState}
              onToggleNode={toggleNode}
              onSelectFile={handleSelectFile}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            />
            {/* Drop zone for moving files to project root */}
            <div
              className={`root-drop-zone ${dragState.dragOverRoot ? 'drag-over' : ''} ${dragState.draggedItem ? 'visible' : ''}`}
              onDragOver={(e) => {
                if (dragState.draggedItem) {
                  e.preventDefault()
                  e.stopPropagation()
                  setDragState(prev => ({
                    ...prev,
                    dragOverFolder: null,
                    dragOverRoot: true
                  }))
                }
              }}
              onDragLeave={() => {
                setDragState(prev => ({
                  ...prev,
                  dragOverRoot: false
                }))
              }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (dragState.draggedItem) {
                  handleMoveFile(dragState.draggedItem.path, '')
                }
                setDragState({
                  draggedItem: null,
                  dragOverFolder: null,
                  dragOverRoot: false
                })
              }}
            >
              Drop here to move to root
            </div>
          </>
        )}
      </div>

      {(isDbtOperationRunning || dbtModalOpen || (compilingModels && compilingModels.size > 0)) && (
        <div className="sidebar-progress">
          <div className="sidebar-progress-bar" />
        </div>
      )}

      <SidebarActions
        isDbtOperationRunning={isDbtOperationRunning}
        compilingModels={compilingModels}
        venvMissing={venvMissing}
        dbtModalOpen={dbtModalOpen}
        manifestMissing={manifestMissing}
        hasModifiedFiles={hasModifiedFiles}
        isRunning={isRunning}
        isCompiling={isCompiling}
        hasUnsavedChanges={hasUnsavedChanges}
        onRunClick={() => {
          const openModal = () => {
            if (onDbtModalOpenChange) onDbtModalOpenChange(true)
            setShowRunModal(true)
          }
          if (hasUnsavedChanges && onCheckUnsavedChanges) {
            onCheckUnsavedChanges('running dbt', openModal)
          } else {
            openModal()
          }
        }}
        onCompileClick={() => {
          const openModal = () => {
            if (onDbtModalOpenChange) onDbtModalOpenChange(true)
            setShowCompileModal(true)
          }
          if (hasUnsavedChanges && onCheckUnsavedChanges) {
            onCheckUnsavedChanges('compiling', openModal)
          } else {
            openModal()
          }
        }}
        onGitClick={() => setShowGitModal(true)}
        onRecreateVenv={onRecreateVenv}
        onChangeProject={onChangeProject}
      />

      {/* Modals */}
      {showRunModal && (
        <DbtRunModal
          onClose={() => {
            setShowRunModal(false)
            if (onDbtModalOpenChange) onDbtModalOpenChange(false)
          }}
          onRun={handleDbtRun}
          isRunning={isRunning}
          target={selectedTarget}
        />
      )}

      {showCompileModal && (
        <DbtRunModal
          onClose={() => {
            setShowCompileModal(false)
            if (onDbtModalOpenChange) onDbtModalOpenChange(false)
          }}
          onRun={handleDbtCompile}
          isRunning={isCompiling}
          mode="compile"
          target={selectedTarget}
        />
      )}

      {showRenameModal && selectedFile && (
        <ConfirmModal
          onClose={() => setShowRenameModal(false)}
          onConfirm={(newName) => {
            handleRenameConfirm(newName)
            setShowRenameModal(false)
          }}
          title={`Rename ${selectedIsFolder ? 'folder' : 'file'}`}
          message={`Enter a new name for "${selectedFile.split('/').pop()}":`}
          confirmLabel="Rename"
          cancelLabel="Cancel"
          variant="default"
          inputMode={true}
          inputValue={selectedFile}
        />
      )}

      {showDeleteModal && selectedFile && (
        <ConfirmModal
          onClose={() => setShowDeleteModal(false)}
          onConfirm={() => {
            handleDeleteConfirm()
            setShowDeleteModal(false)
          }}
          title={`Delete ${selectedIsFolder ? 'folder' : 'file'}`}
          message={`Are you sure you want to delete "${selectedFile}"?${selectedIsFolder ? ' This will delete all contents inside it.' : ''}`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          variant="danger"
        />
      )}

      {showGitModal && (
        <GitModal
          projectPath={projectPath}
          onClose={() => setShowGitModal(false)}
          onBranchChange={handleBranchChange}
          onGitChange={onRefreshModifiedFiles}
          onTreeRefresh={loadDirectoryTree}
        />
      )}
    </div>
  )
}

export default Sidebar
