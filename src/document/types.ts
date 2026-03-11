import type { LanguageModel } from 'ai'
import type { DocumentInput, IndexedDocument, IndexResult } from '../types/document.js'
import type { TreeNode, SearchResult } from '../types/tree.js'
import type { StorageDriver } from '../types/storage.js'
import type { ProcessingOptions, SearchOptions } from '../types/config.js'

/**
 * Configuration for a single-document index
 */
export interface DocumentIndexConfig {
  /** LLM model for processing and search */
  model: LanguageModel

  /** Storage driver for this document */
  storage: StorageDriver

  /** Processing options */
  processing?: Partial<ProcessingOptions>

  /** Search options defaults */
  search?: Partial<SearchOptions>

  /**
   * Document ID (optional)
   * If not provided, will be generated on first index()
   * If provided, allows re-opening an existing document
   */
  documentId?: string
}

/**
 * Single-document index interface
 */
export interface DocumentIndex {
  /** Current document ID (null if not yet indexed) */
  readonly documentId: string | null

  /** Index a document (creates or replaces) */
  index(document: DocumentInput): Promise<IndexResult>

  /** Search within this document */
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>

  /** Get the indexed document metadata */
  getDocument(): Promise<IndexedDocument | null>

  /** Get the tree structure */
  getTree(): Promise<TreeNode[] | null>

  /** Get page content by index range */
  getContent(startIndex: number, endIndex: number): Promise<string>

  /** Get document summary for external use (orchestrators, selection) */
  getSummary(): Promise<DocumentSummary | null>

  /** Check if document is indexed */
  isIndexed(): Promise<boolean>

  /** Delete this document from storage */
  clear(): Promise<void>
}

/**
 * Summary for document selection (used by orchestrators)
 */
export interface DocumentSummary {
  /** Document identifier */
  id: string

  /** Document name */
  name: string

  /** Document type */
  type: string

  /** AI-generated description */
  description?: string

  /** Total page/section count */
  pageCount: number

  /** Total token count */
  tokenCount: number

  /** Top-level tree nodes with summaries */
  topLevelNodes: Array<{
    nodeId: string
    title: string
    summary?: string
  }>
}
