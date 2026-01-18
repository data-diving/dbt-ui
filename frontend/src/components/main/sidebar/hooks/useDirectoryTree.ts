// Hook for managing directory tree state and operations

import { useState, useRef } from 'react'
import { flushSync } from 'react-dom'
import { apiUrl, apiFetch } from '../../../../config/api'
import { TreeNode } from '../types'
import { convertApiNodeToTreeNode, updateNodeInTree, findNodeInTree } from '../utils'

interface UseDirectoryTreeResult {
  tree: TreeNode[]
  setTree: React.Dispatch<React.SetStateAction<TreeNode[]>>
  treeRef: React.MutableRefObject<TreeNode[]>
  loading: boolean
  expandedNodes: Set<string>
  setExpandedNodes: React.Dispatch<React.SetStateAction<Set<string>>>
  loadDirectoryTree: () => Promise<void>
  loadFolderChildren: (folderPath: string) => Promise<TreeNode[]>
  toggleNode: (path: string, node: TreeNode) => void
  refreshTreeWithExpandedFolders: () => Promise<void>
}

export function useDirectoryTree(projectPath: string): UseDirectoryTreeResult {
  const [tree, setTree] = useState<TreeNode[]>([])
  const treeRef = useRef<TreeNode[]>(tree)
  treeRef.current = tree
  const [loading, setLoading] = useState(true)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())

  const loadDirectoryTree = async () => {
    const startTime = performance.now()
    console.log('[Sidebar] Starting loadDirectoryTree (shallow) at', startTime)
    setLoading(true)
    try {
      const response = await apiFetch(apiUrl('/api/list-directory-shallow'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: projectPath, subPath: '' }),
      })

      if (response.ok) {
        const data = await response.json()
        const convertedTree = data.children.map(convertApiNodeToTreeNode)
        setTree(convertedTree)
        console.log('[Sidebar] Loaded root directory in', (performance.now() - startTime).toFixed(2), 'ms')
      }
    } catch (err) {
      console.error('Error loading directory tree:', err)
    } finally {
      setLoading(false)
    }
  }

  const loadFolderChildren = async (folderPath: string): Promise<TreeNode[]> => {
    try {
      const response = await apiFetch(apiUrl('/api/list-directory-shallow'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: projectPath, subPath: folderPath }),
      })

      if (response.ok) {
        const data = await response.json()
        return data.children.map(convertApiNodeToTreeNode)
      }
    } catch (err) {
      console.error('Error loading folder children:', err)
    }
    return []
  }

  const toggleNode = (path: string, node: TreeNode) => {
    if (expandedNodes.has(path)) {
      setExpandedNodes(prev => {
        const newSet = new Set(prev)
        newSet.delete(path)
        return newSet
      })
    } else {
      setExpandedNodes(prev => new Set(prev).add(path))

      if (node.type === 'folder' && node.hasChildren && !node.children) {
        flushSync(() => {
          setTree(prevTree => updateNodeInTree(prevTree, path, n => ({ ...n, isLoading: true })))
        })

        loadFolderChildren(path).then(children => {
          setTree(prevTree => updateNodeInTree(prevTree, path, n => ({
            ...n,
            children,
            isLoading: false,
            hasChildren: children.length > 0
          })))
        })
      }
    }
  }

  const refreshTreeWithExpandedFolders = async () => {
    await loadDirectoryTree()
    for (const folderPath of expandedNodes) {
      const children = await loadFolderChildren(folderPath)
      setTree(prevTree => updateNodeInTree(prevTree, folderPath, n => ({
        ...n,
        children,
        hasChildren: children.length > 0
      })))
    }
  }

  return {
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
  }
}
