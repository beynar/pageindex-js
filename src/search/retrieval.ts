import type { TreeNode, SearchResult } from '../types/tree.js'
import type { StorageDriver, StoredContent } from '../types/storage.js'
import type { SearchOptions } from '../types/config.js'
import { StorageKeys } from '../types/storage.js'
import { findNodeById } from '../tree/navigation.js'

/**
 * Content retrieval result
 */
export interface RetrievalResult {
  /** Search results with scores */
  results: SearchResult[]

  /** Assembled context from retrieved content */
  context: string

  /** Token count of assembled context */
  tokenCount: number
}

/**
 * Options for content retrieval
 */
export interface RetrievalOptions extends SearchOptions {
  /** Maximum tokens in assembled context */
  maxContextTokens?: number

  /** Include node metadata in context */
  includeMetadata?: boolean
}

/**
 * Content retriever for tree-based documents
 */
export class ContentRetriever {
  constructor(private storage: StorageDriver) {}

  /**
   * Retrieve content for search results
   */
  async retrieveContent(
    results: SearchResult[],
    documentId: string,
    tree: TreeNode[],
    options?: RetrievalOptions
  ): Promise<RetrievalResult> {
    const maxTokens = options?.maxContextTokens ?? 10000
    const includeMetadata = options?.includeMetadata ?? true

    const contextParts: string[] = []
    let totalTokens = 0

    for (const result of results) {
      const nodeContent = await this.getNodeContent(
        result.node,
        documentId,
        tree
      )

      if (!nodeContent) continue

      // Estimate tokens (rough approximation)
      const estimatedTokens = Math.ceil(nodeContent.length / 4)

      if (totalTokens + estimatedTokens > maxTokens) {
        // Truncate if over budget
        const remainingTokens = maxTokens - totalTokens
        const truncatedContent = nodeContent.slice(0, remainingTokens * 4)

        const part = includeMetadata
          ? this.formatWithMetadata(result, truncatedContent, true)
          : truncatedContent

        contextParts.push(part)
        totalTokens = maxTokens
        break
      }

      const part = includeMetadata
        ? this.formatWithMetadata(result, nodeContent, false)
        : nodeContent

      contextParts.push(part)
      totalTokens += estimatedTokens
    }

    return {
      results,
      context: contextParts.join('\n\n---\n\n'),
      tokenCount: totalTokens,
    }
  }

  /**
   * Get content for a specific node
   */
  private async getNodeContent(
    node: TreeNode,
    documentId: string,
    _tree: TreeNode[]
  ): Promise<string | null> {
    // If text is inline in the node, use it
    if (node.text) {
      return node.text
    }

    // Otherwise, fetch from storage
    const content = await this.fetchContentFromStorage(
      documentId,
      node.startIndex,
      node.endIndex
    )

    return content
  }

  /**
   * Fetch content from storage for a page range
   */
  private async fetchContentFromStorage(
    documentId: string,
    startIndex: number,
    endIndex: number
  ): Promise<string | null> {
    const keys: string[] = []
    for (let i = startIndex; i <= endIndex; i++) {
      keys.push(StorageKeys.content(documentId, i))
    }

    const items = await this.storage.getMany(keys)
    const textParts: string[] = []

    for (let i = startIndex; i <= endIndex; i++) {
      const key = StorageKeys.content(documentId, i)
      const item = items.get(key)
      if (item?.type === 'content') {
        textParts.push((item as StoredContent).data.text)
      }
    }

    return textParts.length > 0 ? textParts.join('\n\n') : null
  }

  /**
   * Format content with metadata
   */
  private formatWithMetadata(
    result: SearchResult,
    content: string,
    truncated: boolean
  ): string {
    const parts = [
      `## ${result.node.title}`,
      `**Relevance:** ${(result.score * 100).toFixed(0)}%`,
      `**Path:** ${result.path.join(' > ')}`,
    ]

    if (result.node.summary) {
      parts.push(`**Summary:** ${result.node.summary}`)
    }

    parts.push('')
    parts.push(content)

    if (truncated) {
      parts.push('\n[Content truncated]')
    }

    return parts.join('\n')
  }

  /**
   * Get content for specific nodes by ID
   */
  async getContentByNodeIds(
    nodeIds: string[],
    documentId: string,
    tree: TreeNode[]
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>()

    for (const nodeId of nodeIds) {
      const node = findNodeById(tree, nodeId)
      if (node) {
        const content = await this.getNodeContent(node, documentId, tree)
        if (content) {
          result.set(nodeId, content)
        }
      }
    }

    return result
  }

  /**
   * Assemble context from multiple nodes
   */
  async assembleContext(
    nodeIds: string[],
    documentId: string,
    tree: TreeNode[],
    maxTokens: number = 10000
  ): Promise<string> {
    const contentMap = await this.getContentByNodeIds(nodeIds, documentId, tree)
    const parts: string[] = []
    let totalTokens = 0

    for (const nodeId of nodeIds) {
      const content = contentMap.get(nodeId)
      if (!content) continue

      const node = findNodeById(tree, nodeId)
      const estimatedTokens = Math.ceil(content.length / 4)

      if (totalTokens + estimatedTokens > maxTokens) {
        break
      }

      if (node) {
        parts.push(`## ${node.title}\n\n${content}`)
      } else {
        parts.push(content)
      }

      totalTokens += estimatedTokens
    }

    return parts.join('\n\n---\n\n')
  }
}

/**
 * Create a content retriever
 */
export function createRetriever(storage: StorageDriver): ContentRetriever {
  return new ContentRetriever(storage)
}
