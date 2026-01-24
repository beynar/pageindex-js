import type { TreeNode } from '../types/tree.js'
import { countTokens } from '../llm/tokens.js'

/**
 * Parsed markdown node (flat representation)
 */
export interface MarkdownNode {
  /** Header level (1 = #, 2 = ##, etc.) */
  level: number

  /** Header title */
  title: string

  /** Line number where header starts (0-indexed) */
  lineNumber: number

  /** Content under this header (until next header) */
  content: string

  /** Token count of content */
  tokenCount: number
}

/**
 * Options for markdown processing
 */
export interface MarkdownProcessingOptions {
  /** Enable tree thinning (merge small sections) */
  enableThinning?: boolean

  /** Token threshold for thinning (merge sections below this) */
  thinningThreshold?: number

  /** Minimum header level to process (1 = #) */
  minHeaderLevel?: number

  /** Maximum header level to process (6 = ######) */
  maxHeaderLevel?: number
}

const DEFAULT_OPTIONS: Required<MarkdownProcessingOptions> = {
  enableThinning: false,
  thinningThreshold: 5000,
  minHeaderLevel: 1,
  maxHeaderLevel: 6,
}

/**
 * Extract nodes from markdown content
 */
export function extractNodesFromMarkdown(
  content: string,
  options?: MarkdownProcessingOptions
): MarkdownNode[] {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const lines = content.split('\n')
  const nodes: MarkdownNode[] = []

  let inCodeBlock = false
  let currentNode: MarkdownNode | null = null
  let contentLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''

    // Track code blocks (skip headers inside them)
    // Use trim() to detect indented code blocks like "    ```python"
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock
      contentLines.push(line)
      continue
    }

    if (inCodeBlock) {
      contentLines.push(line)
      continue
    }

    // Check for header
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headerMatch) {
      const level = headerMatch[1]!.length
      const title = headerMatch[2]!.trim()

      // Skip if outside our level range
      if (level < opts.minHeaderLevel || level > opts.maxHeaderLevel) {
        contentLines.push(line)
        continue
      }

      // Save previous node
      if (currentNode) {
        currentNode.content = contentLines.join('\n').trim()
        currentNode.tokenCount = countTokens(currentNode.content)
        nodes.push(currentNode)
      }

      // Start new node
      currentNode = {
        level,
        title,
        lineNumber: i,
        content: '',
        tokenCount: 0,
      }
      contentLines = []
    } else {
      contentLines.push(line)
    }
  }

  // Save last node
  if (currentNode) {
    currentNode.content = contentLines.join('\n').trim()
    currentNode.tokenCount = countTokens(currentNode.content)
    nodes.push(currentNode)
  }

  return nodes
}

/**
 * Build tree structure from flat markdown nodes
 */
export function buildTreeFromNodes(
  nodes: MarkdownNode[],
  idGenerator?: () => string
): TreeNode[] {
  if (nodes.length === 0) return []

  let nodeIdCounter = 0
  const getId = idGenerator ?? (() => String(nodeIdCounter++).padStart(4, '0'))

  const tree: TreeNode[] = []
  const stack: Array<{ node: TreeNode; level: number }> = []

  for (const mdNode of nodes) {
    const treeNode: TreeNode = {
      title: mdNode.title,
      nodeId: getId(),
      startIndex: mdNode.lineNumber,
      endIndex: mdNode.lineNumber + mdNode.content.split('\n').length,
      text: mdNode.content,
      nodes: [],
    }

    // Find parent (last item in stack with lower level)
    while (stack.length > 0 && stack[stack.length - 1]!.level >= mdNode.level) {
      stack.pop()
    }

    if (stack.length === 0) {
      // Root level node
      tree.push(treeNode)
    } else {
      // Child of last stack item
      const parent = stack[stack.length - 1]!.node
      parent.nodes = parent.nodes ?? []
      parent.nodes.push(treeNode)
    }

    stack.push({ node: treeNode, level: mdNode.level })
  }

  // Clean up empty nodes arrays
  cleanEmptyNodes(tree)

  // Update end indices to include children
  updateEndIndices(tree)

  return tree
}

/**
 * Remove empty nodes arrays
 */
function cleanEmptyNodes(nodes: TreeNode[]): void {
  for (const node of nodes) {
    if (node.nodes && node.nodes.length === 0) {
      delete node.nodes
    } else if (node.nodes) {
      cleanEmptyNodes(node.nodes)
    }
  }
}

/**
 * Update end indices to span all children
 */
function updateEndIndices(nodes: TreeNode[]): void {
  for (const node of nodes) {
    if (node.nodes && node.nodes.length > 0) {
      updateEndIndices(node.nodes)

      // Find max end index among children
      let maxEnd = node.endIndex
      for (const child of node.nodes) {
        if (child.endIndex > maxEnd) {
          maxEnd = child.endIndex
        }
      }
      node.endIndex = maxEnd
    }
  }
}

/**
 * Apply tree thinning (merge small sections)
 */
export function applyTreeThinning(
  nodes: TreeNode[],
  threshold: number
): TreeNode[] {
  const result: TreeNode[] = []

  for (const node of nodes) {
    const totalTokens = calculateNodeTokens(node)

    if (totalTokens < threshold && node.nodes) {
      // Merge children into parent
      const mergedContent = collectAllContent(node)
      const merged: TreeNode = {
        title: node.title,
        nodeId: node.nodeId,
        startIndex: node.startIndex,
        endIndex: node.endIndex,
        text: mergedContent,
      }
      if (node.summary) merged.summary = node.summary
      if (node.prefixSummary) merged.prefixSummary = node.prefixSummary
      result.push(merged)
    } else if (node.nodes) {
      // Recursively thin children
      result.push({
        ...node,
        nodes: applyTreeThinning(node.nodes, threshold),
      })
    } else {
      result.push(node)
    }
  }

  return result
}

/**
 * Calculate total tokens in a node (including children)
 */
function calculateNodeTokens(node: TreeNode): number {
  let total = node.text ? countTokens(node.text) : 0

  if (node.nodes) {
    for (const child of node.nodes) {
      total += calculateNodeTokens(child)
    }
  }

  return total
}

/**
 * Collect all content from node and children
 */
function collectAllContent(node: TreeNode): string {
  const parts: string[] = []

  if (node.text) {
    parts.push(node.text)
  }

  if (node.nodes) {
    for (const child of node.nodes) {
      parts.push(collectAllContent(child))
    }
  }

  return parts.join('\n\n')
}

/**
 * Process markdown content into tree structure
 */
export function processMarkdown(
  content: string,
  options?: MarkdownProcessingOptions
): TreeNode[] {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  // Extract flat nodes
  const flatNodes = extractNodesFromMarkdown(content, opts)

  // Build tree
  let tree = buildTreeFromNodes(flatNodes)

  // Apply thinning if enabled
  if (opts.enableThinning) {
    tree = applyTreeThinning(tree, opts.thinningThreshold)
  }

  return tree
}

/**
 * Get total token count for markdown content
 */
export function getMarkdownTokenCount(content: string): number {
  return countTokens(content)
}

/**
 * Extract text content for a specific line range
 */
export function extractLineRange(
  content: string,
  startLine: number,
  endLine: number
): string {
  const lines = content.split('\n')
  return lines.slice(startLine, endLine + 1).join('\n')
}
