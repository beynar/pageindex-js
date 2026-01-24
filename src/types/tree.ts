/**
 * Tree node representing a section in the document hierarchy
 */
export interface TreeNode {
  /** Section title */
  title: string

  /** Unique node identifier (4-digit format: 0000, 0001, etc.) */
  nodeId: string

  /** Starting page/line index (1-indexed for PDF pages, 0-indexed for markdown lines) */
  startIndex: number

  /** Ending page/line index (inclusive) */
  endIndex: number

  /** AI-generated summary of the section content */
  summary?: string

  /** Prefix summary for non-leaf nodes (overview of children) */
  prefixSummary?: string

  /** Full text content of the section (when contentStorage is 'inline' or includeText is true) */
  text?: string

  /** Child sections */
  nodes?: TreeNode[]
}

/**
 * Tree node with guaranteed text content (for use with includeText: true)
 */
export interface TreeNodeWithText extends Omit<TreeNode, 'text' | 'nodes'> {
  text: string
  nodes?: TreeNodeWithText[]
}

/**
 * Tree node without text content (for use with includeText: false)
 */
export interface TreeNodeWithoutText extends Omit<TreeNode, 'text' | 'nodes'> {
  text?: undefined
  nodes?: TreeNodeWithoutText[]
}

/**
 * Flat TOC entry used during tree construction
 */
export interface TocEntry {
  /** Hierarchical structure like "1.2.3" */
  structure: string

  /** Section title */
  title: string

  /** Physical page number in document (0-indexed internally) */
  physicalIndex: number

  /** Page number from TOC (if available) */
  page?: number

  /** Whether section starts at the beginning of the page */
  appearStart: 'yes' | 'no'
}

/**
 * Result of tree search operation
 */
export interface SearchResult {
  /** Matched node */
  node: TreeNode

  /** Relevance score (0-1) */
  score: number

  /** Path from root to this node */
  path: string[]

  /** LLM reasoning for why this node is relevant */
  reasoning: string
}

/**
 * Search result with guaranteed text content (for use with includeText: true)
 */
export interface SearchResultWithText extends Omit<SearchResult, 'node'> {
  node: TreeNodeWithText
}

/**
 * Search result without text content (for use with includeText: false)
 */
export interface SearchResultWithoutText extends Omit<SearchResult, 'node'> {
  node: TreeNodeWithoutText
}

/**
 * Tree traversal callback
 */
export type TreeVisitor<T> = (
  node: TreeNode,
  depth: number,
  path: string[]
) => T | undefined

/**
 * Options for tree traversal
 */
export interface TraverseOptions {
  /** Maximum depth to traverse (undefined = unlimited) */
  maxDepth?: number

  /** Whether to include non-leaf nodes */
  includeInternal?: boolean
}
