import type { TreeNode } from './tree.js'

/**
 * Document type for processing
 */
export type DocumentType = 'pdf' | 'markdown'

/**
 * Input document for indexing
 */
export interface DocumentInput {
  /** Document name/identifier */
  name: string

  /** Document type */
  type: DocumentType

  /** Raw content (text for markdown, base64 or ArrayBuffer for PDF) */
  content: string | ArrayBuffer

  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Processed document with tree structure
 */
export interface IndexedDocument {
  /** Document identifier */
  id: string

  /** Document name */
  name: string

  /** Document type */
  type: DocumentType

  /** AI-generated document description */
  description?: string

  /** Hierarchical tree structure */
  structure: TreeNode[]

  /** Total page/section count */
  pageCount: number

  /** Total token count */
  tokenCount: number

  /** Creation timestamp */
  createdAt: Date

  /** Last updated timestamp */
  updatedAt: Date

  /** User-provided metadata */
  metadata?: Record<string, unknown>
}

/**
 * Page/section content for separate storage mode
 */
export interface PageContent {
  /** Document ID this content belongs to */
  documentId: string

  /** Page/section index */
  index: number

  /** Text content */
  text: string

  /** Token count for this page */
  tokenCount: number
}

/**
 * Result of document indexing operation
 */
export interface IndexResult {
  /** Created document */
  document: IndexedDocument

  /** Processing statistics */
  stats: IndexingStats
}

/**
 * Statistics from indexing operation
 */
export interface IndexingStats {
  /** Total pages/sections processed */
  pageCount: number

  /** Total tokens in document */
  tokenCount: number

  /** Number of tree nodes created */
  nodeCount: number

  /** Number of LLM calls made */
  llmCalls: number

  /** Total tokens used in LLM calls */
  llmTokensUsed: number

  /** Processing duration in milliseconds */
  durationMs: number
}
