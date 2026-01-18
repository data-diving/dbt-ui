// Sidebar utility functions

import { TreeNode, ApiFileNode } from './types'

export const getFileType = (filename: string): 'model' | 'source' | 'test' | 'macro' | 'file' => {
  if (filename.endsWith('.sql')) {
    if (filename.includes('test')) return 'test'
    return 'model'
  }
  if (filename.includes('source') || filename.includes('schema')) return 'source'
  return 'file'
}

export const convertApiNodeToTreeNode = (apiNode: ApiFileNode): TreeNode => {
  const nodeType = apiNode.type === 'directory' ? 'folder' : getFileType(apiNode.name)

  return {
    name: apiNode.name,
    type: nodeType,
    path: apiNode.path,
    children: apiNode.children?.map(convertApiNodeToTreeNode),
    deleted: apiNode.deleted || false,
    hasChildren: apiNode.hasChildren || false
  }
}

export const findNodeInTree = (nodes: TreeNode[], targetPath: string): TreeNode | null => {
  for (const node of nodes) {
    const nodePath = node.path || node.name
    if (nodePath === targetPath) {
      return node
    }
    if (node.children) {
      const found = findNodeInTree(node.children, targetPath)
      if (found) return found
    }
  }
  return null
}

export const updateNodeInTree = (
  nodes: TreeNode[],
  targetPath: string,
  updater: (node: TreeNode) => TreeNode
): TreeNode[] => {
  return nodes.map(node => {
    const nodePath = node.path || node.name
    if (nodePath === targetPath) {
      return updater(node)
    }
    if (node.children) {
      return { ...node, children: updateNodeInTree(node.children, targetPath, updater) }
    }
    return node
  })
}

export const markNodeAsDeleted = (nodes: TreeNode[], targetPath: string): TreeNode[] => {
  return nodes.map(node => {
    const nodePath = node.type === 'folder' ? node.path : node.path
    if (nodePath === targetPath) {
      return { ...node, deleted: true }
    }
    if (node.children) {
      return { ...node, children: markNodeAsDeleted(node.children, targetPath) }
    }
    return node
  })
}

export const removeNodeFromTree = (nodes: TreeNode[], targetPath: string): TreeNode[] => {
  return nodes.filter(node => {
    if (node.path === targetPath) {
      return false
    }
    if (node.children) {
      node.children = removeNodeFromTree(node.children, targetPath)
    }
    return true
  })
}

export const isPackagesFile = (path: string): boolean => {
  return path.endsWith('packages.yml') || path.endsWith('dependencies.yml')
}
