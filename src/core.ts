import type {
  PageIndexConfig,
  ResolvedConfig,
  SearchOptions,
} from './types/config.js'
import type {
  DocumentInput,
  IndexedDocument,
  IndexResult,
  IndexingStats,
} from './types/document.js'
import type {
  SearchResult,
  SearchResultWithText,
  SearchResultWithoutText,
  TreeNode,
} from './types/tree.js'
import type { StoredDocument, StoredContent, StorageDriver } from './types/storage.js'
import { resolveConfig } from './types/config.js'
import { StorageKeys } from './types/storage.js'
import { TreeBuilder } from './tree/builder.js'
import { TreePostProcessor } from './tree/postprocess.js'
import { TreeSearchEngine } from './search/engine.js'
import { ContentRetriever } from './search/retrieval.js'
import { createTools, type PageIndexTools } from './tools/internal.js'

/**
 * PageIndex instance interface
 */
export interface PageIndex {
  /**
   * Index a document and store its tree structure
   */
  index(document: DocumentInput): Promise<IndexResult>

  /**
   * Search indexed documents using LLM reasoning.
   * By default (includeText: true), fetches full text content for each result.
   *
   * @example
   * ```ts
   * // Default: text is included
   * const results = await pageIndex.search(query)
   * results[0].node.text // string
   *
   * // Explicit: skip text fetching
   * const results = await pageIndex.search(query, { includeText: false })
   * results[0].node.text // undefined
   * ```
   */
  search<TIncludeText extends boolean = true>(
    query: string,
    options?: SearchOptions & { includeText?: TIncludeText }
  ): Promise<TIncludeText extends false ? SearchResultWithoutText[] : SearchResultWithText[]>

  /**
   * Search and retrieve content from matching nodes
   */
  retrieve(
    query: string,
    options?: SearchOptions
  ): Promise<{ results: SearchResultWithText[]; context: string }>

  /**
   * Get an indexed document by ID
   */
  getDocument(id: string): Promise<IndexedDocument | null>

  /**
   * Get tree structure for a document
   */
  getTree(id: string): Promise<TreeNode[] | null>

  /**
   * Delete an indexed document
   */
  deleteDocument(id: string): Promise<boolean>

  /**
   * List all indexed documents
   */
  listDocuments(): Promise<IndexedDocument[]>

  /**
   * Get the resolved configuration
   */
  readonly config: ResolvedConfig

  /**
   * AI SDK tools for use with generateText/streamText.
   * Use these to let an LLM search and retrieve from indexed documents.
   *
   * @example
   * ```ts
   * const result = await generateText({
   *   model: openai('gpt-4o'),
   *   tools: pageIndex.tools,
   *   prompt: 'Find information about authentication',
   * })
   * ```
   */
  readonly tools: PageIndexTools
}

// Re-export config type for convenience
export type { PageIndexConfig }

/**
 * Generate a unique document ID
 */
function generateDocId(name: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  const safeName = name.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 20)
  return `${safeName}-${timestamp}-${random}`
}

/**
 * Create a PageIndex instance
 *
 * @example
 * ```ts
 * import { createPageIndex } from 'pageindex'
 * import { openai } from '@ai-sdk/openai'
 * import { createMemoryStorage } from 'pageindex/storage'
 *
 * const pageIndex = createPageIndex({
 *   model: openai('gpt-4o'),
 *   storage: createMemoryStorage(),
 *   processing: {
 *     addNodeSummary: true,
 *     contentStorage: 'auto',
 *   },
 * })
 *
 * // Index a document
 * const result = await pageIndex.index({
 *   name: 'my-document',
 *   type: 'markdown',
 *   content: '# Hello\n\nWorld',
 * })
 *
 * // Search
 * const results = await pageIndex.search('What is this about?')
 * ```
 */
export function createPageIndex(config: PageIndexConfig): PageIndex {
  const resolved = resolveConfig(config)
  const builder = new TreeBuilder(resolved.model, resolved.processing)
  const postProcessor = new TreePostProcessor(resolved.model, resolved.processing)
  const searchEngine = new TreeSearchEngine(resolved.model)
  const retriever = new ContentRetriever(resolved.storage)

  // Create the instance first (tools need reference to it)
  const instance: PageIndex = {
    config: resolved,
    tools: null as unknown as PageIndexTools, // Will be set below

    async index(document: DocumentInput): Promise<IndexResult> {
      const startTime = Date.now()
      const docId = generateDocId(document.name)

      // Build tree structure
      const buildResult = await builder.build(document)

      // Post-process (summaries, descriptions)
      const processResult = await postProcessor.process(
        buildResult.tree,
        buildResult.pages
      )

      // Determine content storage strategy
      const shouldStoreContentSeparately =
        resolved.processing.contentStorage === 'separate' ||
        (resolved.processing.contentStorage === 'auto' &&
          buildResult.stats.pageCount > resolved.processing.autoStoragePageThreshold)

      // Store page content separately if needed
      if (shouldStoreContentSeparately) {
        const contentItems = new Map<string, StoredContent>()
        for (const page of buildResult.pages) {
          const key = StorageKeys.content(docId, page.index)
          contentItems.set(key, {
            type: 'content',
            data: {
              documentId: docId,
              index: page.index,
              text: page.text,
              tokenCount: page.tokenCount,
            },
            createdAt: new Date(),
            updatedAt: new Date(),
          })
        }
        await resolved.storage.setMany(contentItems)

        // Strip text from tree nodes
        postProcessor.stripText(processResult.tree)
      }

      // Create indexed document
      const indexedDoc: IndexedDocument = {
        id: docId,
        name: document.name,
        type: document.type,
        structure: processResult.tree,
        pageCount: buildResult.stats.pageCount,
        tokenCount: buildResult.stats.tokenCount,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      if (processResult.description) {
        indexedDoc.description = processResult.description
      }

      if (document.metadata) {
        indexedDoc.metadata = document.metadata
      }

      // Store document
      const docKey = StorageKeys.document(docId)
      await resolved.storage.set(docKey, {
        type: 'document',
        data: indexedDoc,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const durationMs = Date.now() - startTime
      const stats: IndexingStats = {
        ...buildResult.stats,
        llmCalls: 0, // TODO: Track this
        llmTokensUsed: 0, // TODO: Track this
        durationMs,
      }

      return {
        document: indexedDoc,
        stats,
      }
    },

    async search<TIncludeText extends boolean = true>(
      query: string,
      options?: SearchOptions & { includeText?: TIncludeText }
    ): Promise<TIncludeText extends false ? SearchResultWithoutText[] : SearchResultWithText[]> {
      const mergedOptions = { ...resolved.search, ...options }
      const includeText = mergedOptions.includeText ?? true

      // Get documents to search
      let docsToSearch: IndexedDocument[]
      if (mergedOptions.documentIds && mergedOptions.documentIds.length > 0) {
        const docs = await Promise.all(
          mergedOptions.documentIds.map((id) => this.getDocument(id))
        )
        docsToSearch = docs.filter((d): d is IndexedDocument => d !== null)
      } else {
        docsToSearch = await this.listDocuments()
      }

      if (docsToSearch.length === 0) {
        return []
      }

      // Search each document and combine results
      // Track which document each result came from for text fetching
      const allResults: Array<SearchResult & { _docId: string }> = []

      for (const doc of docsToSearch) {
        const results = await searchEngine.search(
          query,
          doc.structure,
          mergedOptions
        )
        // Tag results with document ID
        for (const result of results) {
          allResults.push({ ...result, _docId: doc.id })
        }
      }

      // Sort by score and limit
      allResults.sort((a, b) => b.score - a.score)
      const limitedResults = allResults.slice(0, mergedOptions.maxResults)

      // Fetch text content if requested and not already inline
      if (includeText) {
        await populateTextContent(limitedResults, resolved.storage)
      }

      // Remove internal _docId and return
      const finalResults = limitedResults.map(({ _docId, ...result }) => result)
      return finalResults as TIncludeText extends false ? SearchResultWithoutText[] : SearchResultWithText[]
    },

    async retrieve(
      query: string,
      options?: SearchOptions
    ): Promise<{ results: SearchResultWithText[]; context: string }> {
      // Always include text for retrieve
      const results = await this.search(query, { ...options, includeText: true }) as SearchResultWithText[]

      if (results.length === 0) {
        return { results: [], context: '' }
      }

      // Get the document for the first result
      const firstNode = results[0]?.node
      if (!firstNode) {
        return { results, context: '' }
      }

      // Find which document this result came from
      const docs = await this.listDocuments()
      let docId: string | null = null

      for (const doc of docs) {
        const allNodes = getAllNodesFromTree(doc.structure)
        if (allNodes.some((n) => n.nodeId === firstNode.nodeId)) {
          docId = doc.id
          break
        }
      }

      if (!docId) {
        return { results, context: '' }
      }

      const doc = await this.getDocument(docId)
      if (!doc) {
        return { results, context: '' }
      }

      const retrieval = await retriever.retrieveContent(
        results,
        docId,
        doc.structure,
        { includeMetadata: true }
      )

      return {
        results: retrieval.results as SearchResultWithText[],
        context: retrieval.context,
      }
    },

    async getDocument(id: string): Promise<IndexedDocument | null> {
      const key = StorageKeys.document(id)
      const item = await resolved.storage.get(key)
      if (!item || item.type !== 'document') return null
      return (item as StoredDocument).data
    },

    async getTree(id: string): Promise<TreeNode[] | null> {
      const doc = await this.getDocument(id)
      return doc?.structure ?? null
    },

    async deleteDocument(id: string): Promise<boolean> {
      const key = StorageKeys.document(id)

      // Get document to find content keys
      const doc = await this.getDocument(id)
      if (!doc) return false

      // Delete content entries if using separate storage
      if (resolved.processing.contentStorage !== 'inline') {
        const contentKeys: string[] = []
        for (let i = 0; i < doc.pageCount; i++) {
          contentKeys.push(StorageKeys.content(id, i))
        }
        await resolved.storage.deleteMany(contentKeys)
      }

      // Delete document
      return resolved.storage.delete(key)
    },

    async listDocuments(): Promise<IndexedDocument[]> {
      const keys = await resolved.storage.list({ prefix: 'doc:' })
      const items = await resolved.storage.getMany(keys)

      const documents: IndexedDocument[] = []
      for (const item of items.values()) {
        if (item?.type === 'document') {
          documents.push((item as StoredDocument).data)
        }
      }

      return documents
    },
  }

  // Set up tools with reference to the instance
  ;(instance as { tools: PageIndexTools }).tools = createTools(instance)

  return instance
}

/**
 * Helper to get all nodes from a tree
 */
function getAllNodesFromTree(nodes: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = []

  function collect(node: TreeNode): void {
    result.push(node)
    if (node.nodes) {
      for (const child of node.nodes) {
        collect(child)
      }
    }
  }

  for (const node of nodes) {
    collect(node)
  }

  return result
}

/**
 * Populate text content for search results that don't have inline text
 */
async function populateTextContent(
  results: Array<SearchResult & { _docId: string }>,
  storage: StorageDriver
): Promise<void> {
  for (const result of results) {
    // Skip if text is already present
    if (result.node.text !== undefined) continue

    // Fetch content from storage
    const keys: string[] = []
    for (let i = result.node.startIndex; i <= result.node.endIndex; i++) {
      keys.push(StorageKeys.content(result._docId, i))
    }

    const items = await storage.getMany(keys)
    const textParts: string[] = []

    for (let i = result.node.startIndex; i <= result.node.endIndex; i++) {
      const key = StorageKeys.content(result._docId, i)
      const item = items.get(key)
      if (item?.type === 'content') {
        textParts.push((item as StoredContent).data.text)
      }
    }

    if (textParts.length > 0) {
      result.node.text = textParts.join('\n\n')
    }
  }
}
