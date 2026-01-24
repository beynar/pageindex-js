import type { LanguageModel } from 'ai'
import type { StorageDriver } from './storage.js'

/**
 * Content storage strategy
 */
export type ContentStorage = 'inline' | 'separate' | 'auto'

/**
 * Processing options for document indexing
 */
export interface ProcessingOptions {
  /**
   * Number of pages to scan for TOC detection (PDF only)
   * @default 20
   */
  tocCheckPages?: number

  /**
   * Maximum tokens per tree node
   * @default 20000
   */
  maxTokensPerNode?: number

  /**
   * Maximum pages per tree node (used with maxTokensPerNode for large node splitting)
   * Nodes exceeding BOTH thresholds will be recursively split
   * @default 10
   */
  maxPagesPerNode?: number

  /**
   * Add unique node IDs to tree nodes
   * @default true
   */
  addNodeId?: boolean

  /**
   * Generate AI summaries for each node
   * @default true
   */
  addNodeSummary?: boolean

  /**
   * Generate document-level description
   * @default false
   */
  addDocDescription?: boolean

  /**
   * Token threshold for summary generation (nodes below this skip summary)
   * @default 200
   */
  summaryTokenThreshold?: number

  /**
   * Number of concurrent LLM calls for summary generation
   * @default 15
   */
  summaryBatchSize?: number

  /**
   * Enable tree thinning for markdown (merge small sections)
   * @default false
   */
  enableTreeThinning?: boolean

  /**
   * Token threshold for tree thinning
   * @default 5000
   */
  thinningThreshold?: number

  /**
   * Content storage strategy
   * - 'inline': Store text directly in tree nodes
   * - 'separate': Store text in separate storage, tree has references
   * - 'auto': Use inline for small docs (<50 pages), separate for large
   * @default 'auto'
   */
  contentStorage?: ContentStorage

  /**
   * Page count threshold for auto content storage mode
   * @default 50
   */
  autoStoragePageThreshold?: number
}

/**
 * Base search options (without includeText for typing purposes)
 */
export interface SearchOptionsBase {
  /**
   * Maximum number of results to return
   * @default 5
   */
  maxResults?: number

  /**
   * Minimum relevance score (0-1)
   * @default 0.5
   */
  minScore?: number

  /**
   * Maximum tree depth to search
   * @default undefined (unlimited)
   */
  maxDepth?: number

  /**
   * Document IDs to search (undefined = all documents)
   */
  documentIds?: string[]

  /**
   * Expert knowledge or user preferences to guide search.
   * Example: "If the query mentions EBITDA adjustments, prioritize Item 7 (MD&A)
   * and footnotes in Item 8 (Financial Statements) in 10-K reports."
   */
  expertKnowledge?: string

  /**
   * Additional context about the document type being searched
   */
  documentContext?: string
}

/**
 * Search options with text inclusion control
 */
export interface SearchOptions extends SearchOptionsBase {
  /**
   * Include full text content in search results.
   * When true (default), fetches text even if stored separately.
   * When false, node.text will be undefined.
   * @default true
   */
  includeText?: boolean
}

/**
 * Search options that explicitly include text
 */
export interface SearchOptionsWithText extends SearchOptionsBase {
  includeText?: true
}

/**
 * Search options that explicitly exclude text
 */
export interface SearchOptionsWithoutText extends SearchOptionsBase {
  includeText: false
}

/**
 * Main configuration for PageIndex
 */
export interface PageIndexConfig {
  /**
   * Language model for AI operations (from @ai-sdk/*)
   */
  model: LanguageModel

  /**
   * Storage driver for persistence
   */
  storage: StorageDriver

  /**
   * Processing options
   */
  processing?: ProcessingOptions

  /**
   * Search options (defaults)
   */
  search?: SearchOptions

  /**
   * Enable debug logging
   * @default false
   */
  debug?: boolean
}

/**
 * Resolved configuration with all defaults applied
 */
export interface ResolvedConfig {
  model: LanguageModel
  storage: StorageDriver
  processing: Required<ProcessingOptions>
  search: ResolvedSearchOptions
  debug: boolean
}

/**
 * Default processing options
 */
export const DEFAULT_PROCESSING_OPTIONS: Required<ProcessingOptions> = {
  tocCheckPages: 20,
  maxTokensPerNode: 20000,
  maxPagesPerNode: 10,
  addNodeId: true,
  addNodeSummary: true,
  addDocDescription: false,
  summaryTokenThreshold: 200,
  summaryBatchSize: 15,
  enableTreeThinning: false,
  thinningThreshold: 5000,
  contentStorage: 'auto',
  autoStoragePageThreshold: 50,
}

/**
 * Resolved search options (with defaults applied)
 */
export type ResolvedSearchOptions = {
  maxResults: number
  minScore: number
  includeText: boolean
  maxDepth: number
  documentIds: string[]
  expertKnowledge?: string
  documentContext?: string
}

/**
 * Default search options
 */
export const DEFAULT_SEARCH_OPTIONS: ResolvedSearchOptions = {
  maxResults: 5,
  minScore: 0.5,
  includeText: true,
  maxDepth: Infinity,
  documentIds: [],
}

/**
 * Resolve config with defaults
 */
export function resolveConfig(config: PageIndexConfig): ResolvedConfig {
  return {
    model: config.model,
    storage: config.storage,
    processing: {
      ...DEFAULT_PROCESSING_OPTIONS,
      ...config.processing,
    },
    search: {
      ...DEFAULT_SEARCH_OPTIONS,
      ...config.search,
    },
    debug: config.debug ?? false,
  }
}
