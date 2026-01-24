import type { TreeNode, TreeVisitor, TraverseOptions } from '../types/tree.js'

/**
 * Traverse a tree structure with a visitor callback
 */
export function traverseTree<T>(
  nodes: TreeNode[],
  visitor: TreeVisitor<T>,
  options?: TraverseOptions
): T[] {
  const results: T[] = []
  const maxDepth = options?.maxDepth ?? Infinity
  const includeInternal = options?.includeInternal ?? true

  function traverse(node: TreeNode, depth: number, path: string[]): void {
    if (depth > maxDepth) return

    const currentPath = [...path, node.nodeId]
    const hasChildren = node.nodes && node.nodes.length > 0
    const isLeaf = !hasChildren

    // Visit node if it's a leaf or we're including internal nodes
    if (isLeaf || includeInternal) {
      const result = visitor(node, depth, currentPath)
      if (result !== undefined) {
        results.push(result)
      }
    }

    // Traverse children
    if (hasChildren) {
      for (const child of node.nodes!) {
        traverse(child, depth + 1, currentPath)
      }
    }
  }

  for (const node of nodes) {
    traverse(node, 0, [])
  }

  return results
}

/**
 * Get all nodes in the tree (flattened)
 */
export function getAllNodes(nodes: TreeNode[]): TreeNode[] {
  return traverseTree(nodes, (node) => node)
}

/**
 * Get only leaf nodes (nodes without children)
 */
export function getLeafNodes(nodes: TreeNode[]): TreeNode[] {
  return traverseTree(
    nodes,
    (node) => {
      const isLeaf = !node.nodes || node.nodes.length === 0
      return isLeaf ? node : undefined
    },
    { includeInternal: true }
  )
}

/**
 * Find a node by its ID
 */
export function findNodeById(
  nodes: TreeNode[],
  nodeId: string
): TreeNode | null {
  const results = traverseTree(nodes, (node) =>
    node.nodeId === nodeId ? node : undefined
  )
  return results[0] ?? null
}

/**
 * Get the path from root to a specific node
 */
export function getNodePath(nodes: TreeNode[], nodeId: string): string[] | null {
  let foundPath: string[] | null = null

  traverseTree(nodes, (node, _depth, path) => {
    if (node.nodeId === nodeId) {
      foundPath = path
      return true // Signal found (value doesn't matter)
    }
    return undefined
  })

  return foundPath
}

/**
 * Check if a node is a leaf (no children)
 */
export function isLeafNode(node: TreeNode): boolean {
  return !node.nodes || node.nodes.length === 0
}

/**
 * Get node depth in the tree
 */
export function getNodeDepth(nodes: TreeNode[], nodeId: string): number {
  const path = getNodePath(nodes, nodeId)
  return path ? path.length - 1 : -1
}

/**
 * Get parent node of a given node
 */
export function getParentNode(
  nodes: TreeNode[],
  nodeId: string
): TreeNode | null {
  const path = getNodePath(nodes, nodeId)
  if (!path || path.length < 2) return null

  const parentId = path[path.length - 2]
  return parentId ? findNodeById(nodes, parentId) : null
}

/**
 * Get sibling nodes (nodes with same parent)
 */
export function getSiblingNodes(
  nodes: TreeNode[],
  nodeId: string
): TreeNode[] {
  const parent = getParentNode(nodes, nodeId)

  if (!parent) {
    // Node is at root level
    return nodes.filter((n) => n.nodeId !== nodeId)
  }

  return (parent.nodes ?? []).filter((n) => n.nodeId !== nodeId)
}

/**
 * Get all ancestor nodes (from root to parent)
 */
export function getAncestorNodes(
  nodes: TreeNode[],
  nodeId: string
): TreeNode[] {
  const path = getNodePath(nodes, nodeId)
  if (!path || path.length < 2) return []

  const ancestors: TreeNode[] = []
  for (let i = 0; i < path.length - 1; i++) {
    const ancestorId = path[i]
    if (ancestorId) {
      const ancestor = findNodeById(nodes, ancestorId)
      if (ancestor) {
        ancestors.push(ancestor)
      }
    }
  }

  return ancestors
}

/**
 * Get all descendant nodes (children, grandchildren, etc.)
 */
export function getDescendantNodes(node: TreeNode): TreeNode[] {
  if (!node.nodes || node.nodes.length === 0) return []

  const descendants: TreeNode[] = []

  function collect(n: TreeNode): void {
    if (n.nodes) {
      for (const child of n.nodes) {
        descendants.push(child)
        collect(child)
      }
    }
  }

  collect(node)
  return descendants
}

/**
 * Count total nodes in tree
 */
export function countNodes(nodes: TreeNode[]): number {
  return getAllNodes(nodes).length
}

/**
 * Get maximum depth of tree
 */
export function getTreeDepth(nodes: TreeNode[]): number {
  let maxDepth = 0

  traverseTree(nodes, (_node, depth) => {
    if (depth > maxDepth) maxDepth = depth
    return undefined
  })

  return maxDepth
}

/**
 * Convert tree to flat list with depth info
 */
export function treeToFlatList(
  nodes: TreeNode[]
): Array<{ node: TreeNode; depth: number; path: string[] }> {
  return traverseTree(nodes, (node, depth, path) => ({
    node,
    depth,
    path,
  }))
}

/**
 * Get nodes at a specific depth
 */
export function getNodesAtDepth(nodes: TreeNode[], depth: number): TreeNode[] {
  return traverseTree(nodes, (node, d) =>
    d === depth ? node : undefined
  )
}

/**
 * Find nodes by title (case-insensitive partial match)
 */
export function findNodesByTitle(
  nodes: TreeNode[],
  searchTerm: string
): TreeNode[] {
  const lower = searchTerm.toLowerCase()
  return traverseTree(nodes, (node) =>
    node.title.toLowerCase().includes(lower) ? node : undefined
  )
}

/**
 * Get nodes that contain a specific page index
 */
export function findNodesContainingPage(
  nodes: TreeNode[],
  pageIndex: number
): TreeNode[] {
  return traverseTree(nodes, (node) =>
    pageIndex >= node.startIndex && pageIndex <= node.endIndex
      ? node
      : undefined
  )
}
