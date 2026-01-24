# PageIndex: Library Architecture for DO Scaling

> Refactoring plan to make PageIndex a standalone library that enables but doesn't require Cloudflare Durable Objects.

---

## Design Goals

1. **Standalone library** — Works in Node.js, Bun, Deno, Cloudflare Workers, browsers
2. **DO-enabled** — Provides primitives that DO implementations can use
3. **Not DO-tied** — No Cloudflare imports in core library
4. **Single-doc focus** — Core library optimized for single-document operations
5. **Multi-doc via composition** — Orchestration layer built on top, not inside

---

## Current Architecture Analysis

### What Exists Today

```
┌─────────────────────────────────────────────────────────────────┐
│                    createPageIndex(config)                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                   Mixed Concerns                           │  │
│  │                                                            │  │
│  │  • TreeBuilder (stateless, per-document)                  │  │
│  │  • TreePostProcessor (stateless, per-document)            │  │
│  │  • TreeSearchEngine (stateless, per-document)             │  │
│  │  • ContentRetriever (stateless, per-document)             │  │
│  │  ────────────────────────────────────────────────         │  │
│  │  • StorageDriver (stateful, multi-document)               │  │
│  │  • listDocuments() (multi-document coordination)          │  │
│  │  • search() loops over ALL documents                      │  │
│  │                                                            │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### The Problem

The `PageIndex` interface conflates:
- **Document processing** (build tree from PDF/Markdown)
- **Document storage** (persist tree + content)
- **Document search** (LLM reasoning over tree)
- **Multi-document coordination** (list, cross-search)

For DO architecture, we need:
- Document processing → Inside each DO
- Document storage → Each DO's SQLite
- Document search → Inside each DO
- Multi-document coordination → Separate orchestrator

---

## Proposed Architecture

### Layer Separation

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 3: Orchestration (NOT in core library)                   │
│  ────────────────────────────────────────────                   │
│  • Multi-document search                                         │
│  • Document selection/routing                                    │
│  • Result aggregation                                            │
│  • Implemented by: DO Orchestrator, or your own code            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ uses
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 2: Document Operations (core library)                    │
│  ──────────────────────────────────────────                     │
│  • DocumentProcessor: build + store single document             │
│  • DocumentSearcher: search within single document              │
│  • DocumentStore: CRUD for single document                      │
│  • Storage-agnostic (you provide the driver)                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ uses
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1: Core Primitives (core library)                        │
│  ────────────────────────────────────────                       │
│  • TreeBuilder: PDF/Markdown → Tree                             │
│  • TreePostProcessor: summaries, descriptions                   │
│  • TreeSearchEngine: query → relevant nodes                     │
│  • ContentRetriever: nodes → text content                       │
│  • LLMClient: abstraction over AI SDK                           │
│  • Stateless, pure functions                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## API Changes

### Current API (Multi-Document Focused)

```typescript
// Current: One instance manages ALL documents
const pageIndex = createPageIndex({
  model: openai('gpt-4o'),
  storage: createMemoryStorage(),
})

await pageIndex.index(doc1)
await pageIndex.index(doc2)
await pageIndex.search(query)  // Searches ALL documents
```

### New API: Layer 1 — Core Primitives

```typescript
// Stateless, per-document operations
import {
  TreeBuilder,
  TreePostProcessor,
  TreeSearchEngine,
  ContentRetriever,
  LLMClient,
} from 'pageindex/core'

// Build tree from document (no storage)
const builder = new TreeBuilder(model, options)
const { tree, pages, stats } = await builder.build(document)

// Add summaries (no storage)
const processor = new TreePostProcessor(model, options)
const { tree: processedTree, description } = await processor.process(tree, pages)

// Search tree (no storage)
const searchEngine = new TreeSearchEngine(model)
const results = await searchEngine.search(query, tree, options)
```

### New API: Layer 2 — Document Operations

```typescript
// Single-document operations with storage
import { createDocumentIndex } from 'pageindex'

// Each document gets its own index
const docIndex = createDocumentIndex({
  model: openai('gpt-4o'),
  storage: createSQLiteStorage(db),  // Or any StorageDriver
})

// Index THIS document
const result = await docIndex.index(document)

// Search THIS document only
const results = await docIndex.search(query)

// Get document info
const doc = await docIndex.getDocument()
const tree = await docIndex.getTree()

// Clear this document
await docIndex.clear()
```

### New API: Layer 3 — Multi-Document (User-Implemented)

```typescript
// Example: Simple multi-document search (user code, not in library)
async function searchAllDocuments(query: string, docIndexes: DocumentIndex[]) {
  const results = await Promise.all(
    docIndexes.map(idx => idx.search(query))
  )
  return results.flat().sort((a, b) => b.score - a.score)
}

// Example: DO orchestrator (user code, not in library)
async function searchViaDO(query: string, docIds: string[], env: Env) {
  const results = await Promise.all(
    docIds.map(async id => {
      const stub = env.DOCUMENT_DO.get(env.DOCUMENT_DO.idFromString(id))
      return stub.search(query)
    })
  )
  return results.flat().sort((a, b) => b.score - a.score)
}
```

---

## File Structure Changes

### Current Structure

```
src/
├── core.ts              # Everything mixed together
├── storage/             # Multi-document storage drivers
├── search/              # Search engine
├── tree/                # Tree operations
├── processing/          # PDF/Markdown processing
├── llm/                 # LLM client
└── types/               # Type definitions
```

### Proposed Structure

```
src/
├── index.ts                    # Main exports
│
├── primitives/                 # Layer 1: Stateless core
│   ├── index.ts
│   ├── tree-builder.ts         # TreeBuilder class
│   ├── tree-postprocessor.ts   # TreePostProcessor class
│   ├── tree-search.ts          # TreeSearchEngine class
│   └── content-retriever.ts    # ContentRetriever class
│
├── document/                   # Layer 2: Single-document operations
│   ├── index.ts
│   ├── document-index.ts       # createDocumentIndex()
│   └── types.ts                # DocumentIndex interface
│
├── storage/                    # Storage drivers (unchanged)
│   ├── index.ts
│   ├── driver.ts               # StorageDriver interface
│   ├── memory.ts
│   ├── sqlite.ts
│   └── ...
│
├── processing/                 # Document processing (unchanged)
│   ├── markdown.ts
│   └── pdf.ts
│
├── llm/                        # LLM utilities (unchanged)
│   ├── client.ts
│   ├── tokens.ts
│   └── prompts/
│
├── tree/                       # Tree utilities (unchanged)
│   ├── navigation.ts
│   └── ...
│
└── types/                      # Shared types
    ├── index.ts
    ├── tree.ts
    ├── document.ts
    ├── config.ts
    └── storage.ts

# Separate package or examples folder:
examples/
├── multi-document/             # Example multi-doc implementation
│   └── simple-search.ts
└── cloudflare-do/              # Example DO implementation
    ├── document-do.ts
    ├── orchestrator.ts
    └── wrangler.toml
```

---

## Implementation Details

### Layer 1: Core Primitives

These already exist but need to be exported cleanly:

```typescript
// src/primitives/index.ts
export { TreeBuilder, createTreeBuilder } from './tree-builder.js'
export { TreePostProcessor, createPostProcessor } from './tree-postprocessor.js'
export { TreeSearchEngine, createSearchEngine } from './tree-search.js'
export { ContentRetriever, createRetriever } from './content-retriever.js'

// Re-export types
export type { TreeBuildResult } from './tree-builder.js'
export type { PostProcessResult } from './tree-postprocessor.js'
export type { SearchResult } from '../types/tree.js'
```

### Layer 2: Document Index

New single-document focused API:

```typescript
// src/document/document-index.ts
import type { LanguageModel } from 'ai'
import type { DocumentInput, IndexedDocument } from '../types/document.js'
import type { TreeNode, SearchResult } from '../types/tree.js'
import type { StorageDriver, StoredDocument, StoredContent } from '../types/storage.js'
import type { ProcessingOptions, SearchOptions } from '../types/config.js'
import { TreeBuilder } from '../primitives/tree-builder.js'
import { TreePostProcessor } from '../primitives/tree-postprocessor.js'
import { TreeSearchEngine } from '../primitives/tree-search.js'
import { ContentRetriever } from '../primitives/content-retriever.js'

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
  
  /** Get page content by index */
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
  id: string
  name: string
  type: string
  description?: string
  pageCount: number
  tokenCount: number
  topLevelNodes: Array<{
    nodeId: string
    title: string
    summary?: string
  }>
}

/**
 * Create a single-document index
 */
export function createDocumentIndex(config: DocumentIndexConfig): DocumentIndex {
  const builder = new TreeBuilder(config.model, config.processing ?? {})
  const postProcessor = new TreePostProcessor(config.model, config.processing ?? {})
  const searchEngine = new TreeSearchEngine(config.model)
  const retriever = new ContentRetriever(config.storage)
  
  let documentId: string | null = config.documentId ?? null
  
  // Storage key helpers (all scoped to this document)
  const keys = {
    document: () => `doc:${documentId}`,
    content: (pageIndex: number) => `content:${documentId}:${pageIndex}`,
  }
  
  return {
    get documentId() {
      return documentId
    },
    
    async index(document: DocumentInput): Promise<IndexResult> {
      const startTime = Date.now()
      
      // Generate ID if not provided
      if (!documentId) {
        documentId = generateDocId(document.name)
      }
      
      // Build tree
      const buildResult = await builder.build(document)
      
      // Post-process
      const processResult = await postProcessor.process(
        buildResult.tree,
        buildResult.pages
      )
      
      // Store pages
      const contentItems = new Map<string, StoredContent>()
      for (const page of buildResult.pages) {
        contentItems.set(keys.content(page.index), {
          type: 'content',
          data: {
            documentId: documentId!,
            index: page.index,
            text: page.text,
            tokenCount: page.tokenCount,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      }
      await config.storage.setMany(contentItems)
      
      // Store document (with tree, without page text)
      postProcessor.stripText(processResult.tree)
      
      const indexedDoc: IndexedDocument = {
        id: documentId!,
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
      
      await config.storage.set(keys.document(), {
        type: 'document',
        data: indexedDoc,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      
      return {
        document: indexedDoc,
        stats: {
          ...buildResult.stats,
          llmCalls: 0,
          llmTokensUsed: 0,
          durationMs: Date.now() - startTime,
        },
      }
    },
    
    async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
      const tree = await this.getTree()
      if (!tree) return []
      
      const mergedOptions = { ...config.search, ...options }
      const results = await searchEngine.search(query, tree, mergedOptions)
      
      // Populate text content
      for (const result of results) {
        if (result.node.text === undefined) {
          result.node.text = await this.getContent(
            result.node.startIndex,
            result.node.endIndex
          )
        }
      }
      
      return results
    },
    
    async getDocument(): Promise<IndexedDocument | null> {
      if (!documentId) return null
      const item = await config.storage.get(keys.document())
      if (!item || item.type !== 'document') return null
      return (item as StoredDocument).data
    },
    
    async getTree(): Promise<TreeNode[] | null> {
      const doc = await this.getDocument()
      return doc?.structure ?? null
    },
    
    async getContent(startIndex: number, endIndex: number): Promise<string> {
      if (!documentId) return ''
      
      const contentKeys: string[] = []
      for (let i = startIndex; i <= endIndex; i++) {
        contentKeys.push(keys.content(i))
      }
      
      const items = await config.storage.getMany(contentKeys)
      const parts: string[] = []
      
      for (let i = startIndex; i <= endIndex; i++) {
        const item = items.get(keys.content(i))
        if (item?.type === 'content') {
          parts.push((item as StoredContent).data.text)
        }
      }
      
      return parts.join('\n\n')
    },
    
    async getSummary(): Promise<DocumentSummary | null> {
      const doc = await this.getDocument()
      if (!doc) return null
      
      return {
        id: doc.id,
        name: doc.name,
        type: doc.type,
        description: doc.description,
        pageCount: doc.pageCount,
        tokenCount: doc.tokenCount,
        topLevelNodes: doc.structure.map(node => ({
          nodeId: node.nodeId,
          title: node.title,
          summary: node.summary,
        })),
      }
    },
    
    async isIndexed(): Promise<boolean> {
      if (!documentId) return false
      return config.storage.exists(keys.document())
    },
    
    async clear(): Promise<void> {
      if (!documentId) return
      
      const doc = await this.getDocument()
      if (!doc) return
      
      // Delete content
      const contentKeys: string[] = []
      for (let i = 0; i < doc.pageCount; i++) {
        contentKeys.push(keys.content(i))
      }
      await config.storage.deleteMany(contentKeys)
      
      // Delete document
      await config.storage.delete(keys.document())
      
      documentId = null
    },
  }
}

function generateDocId(name: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  const safeName = name.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 20)
  return `${safeName}-${timestamp}-${random}`
}
```

### Backward Compatibility: Keep `createPageIndex`

The existing API can be a thin wrapper:

```typescript
// src/core.ts (updated)
import { createDocumentIndex, type DocumentIndex } from './document/document-index.js'

/**
 * Multi-document PageIndex (backward compatible)
 * 
 * @deprecated Consider using createDocumentIndex() for single-document use,
 * or implement your own multi-document orchestration.
 */
export function createPageIndex(config: PageIndexConfig): PageIndex {
  const resolved = resolveConfig(config)
  
  // Internal registry of document indexes
  const docIndexes = new Map<string, DocumentIndex>()
  
  async function getOrCreateDocIndex(docId: string): Promise<DocumentIndex> {
    if (!docIndexes.has(docId)) {
      docIndexes.set(docId, createDocumentIndex({
        model: resolved.model,
        storage: resolved.storage,
        processing: resolved.processing,
        search: resolved.search,
        documentId: docId,
      }))
    }
    return docIndexes.get(docId)!
  }
  
  return {
    config: resolved,
    
    async index(document: DocumentInput): Promise<IndexResult> {
      const docIndex = createDocumentIndex({
        model: resolved.model,
        storage: resolved.storage,
        processing: resolved.processing,
        search: resolved.search,
      })
      const result = await docIndex.index(document)
      docIndexes.set(result.document.id, docIndex)
      return result
    },
    
    async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
      // ... existing multi-document search logic
    },
    
    // ... rest of existing methods
  }
}
```

---

## DO Implementation (Separate Package/Example)

### Architecture: Worker + Hono + Orchestrator + Document DOs

```
┌─────────────────────────────────────────────────────────────────┐
│                      Cloudflare Worker                           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                       Hono Router                          │  │
│  │                                                            │  │
│  │  POST   /documents           → index new document          │  │
│  │  GET    /documents           → list documents              │  │
│  │  GET    /documents/:id       → get document                │  │
│  │  DELETE /documents/:id       → delete document             │  │
│  │  POST   /search              → search across documents     │  │
│  │  POST   /documents/:id/search → search single document     │  │
│  │                                                            │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                      Orchestrator                          │  │
│  │                                                            │  │
│  │  • Manages D1 global index (document metadata)            │  │
│  │  • Routes requests to appropriate Document DOs            │  │
│  │  • Handles document selection for multi-doc search        │  │
│  │  • Aggregates and ranks results from multiple DOs         │  │
│  │                                                            │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
└──────────────────────────────┼───────────────────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
   ┌─────────────┐      ┌─────────────┐      ┌─────────────┐
   │ DocumentDO  │      │ DocumentDO  │      │ DocumentDO  │
   │  doc-abc    │      │  doc-def    │      │  doc-ghi    │
   ├─────────────┤      ├─────────────┤      ├─────────────┤
   │  SQLite DB  │      │  SQLite DB  │      │  SQLite DB  │
   │  ┌───────┐  │      │  ┌───────┐  │      │  ┌───────┐  │
   │  │ nodes │  │      │  │ nodes │  │      │  │ nodes │  │
   │  │ pages │  │      │  │ pages │  │      │  │ pages │  │
   │  │ refs  │  │      │  │ refs  │  │      │  │ refs  │  │
   │  └───────┘  │      │  └───────┘  │      │  └───────┘  │
   ├─────────────┤      ├─────────────┤      ├─────────────┤
   │ pageindex   │      │ pageindex   │      │ pageindex   │
   │ library     │      │ library     │      │ library     │
   └─────────────┘      └─────────────┘      └─────────────┘
```

### File Structure

```
src/
├── index.ts              # Worker entry point
├── router.ts             # Hono routes
├── orchestrator.ts       # Orchestration logic
├── document-do.ts        # Document Durable Object
└── types.ts              # Shared types

wrangler.toml             # Cloudflare config
```

### Worker Entry Point

```typescript
// src/index.ts
import { Hono } from 'hono'
import { DocumentDO } from './document-do'
import { createRouter } from './router'

export { DocumentDO }

export interface Env {
  DOCUMENT_DO: DurableObjectNamespace
  DB: D1Database
  OPENAI_API_KEY: string
}

const app = new Hono<{ Bindings: Env }>()

// Mount the router
app.route('/', createRouter())

export default app
```

### Hono Router

```typescript
// src/router.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { Orchestrator } from './orchestrator'
import type { Env } from './index'

export function createRouter() {
  const router = new Hono<{ Bindings: Env }>()
  
  // Lazy orchestrator per request
  const getOrchestrator = (env: Env) => new Orchestrator(env)
  
  // ─────────────────────────────────────────────────────────────
  // Document Management
  // ─────────────────────────────────────────────────────────────
  
  // Index a new document
  router.post(
    '/documents',
    zValidator('json', z.object({
      name: z.string(),
      type: z.enum(['pdf', 'markdown']),
      content: z.string(),  // base64 for PDF, raw for markdown
      collection: z.string().optional().default('default'),
      metadata: z.record(z.unknown()).optional(),
    })),
    async (c) => {
      const body = c.req.valid('json')
      const orchestrator = getOrchestrator(c.env)
      
      const result = await orchestrator.indexDocument({
        name: body.name,
        type: body.type,
        content: body.type === 'pdf' 
          ? Uint8Array.from(atob(body.content), c => c.charCodeAt(0))
          : body.content,
        metadata: body.metadata,
      }, body.collection)
      
      return c.json(result, 201)
    }
  )
  
  // List documents
  router.get('/documents', async (c) => {
    const collection = c.req.query('collection') ?? 'default'
    const limit = parseInt(c.req.query('limit') ?? '50')
    const cursor = c.req.query('cursor')
    
    const orchestrator = getOrchestrator(c.env)
    const result = await orchestrator.listDocuments({ collection, limit, cursor })
    
    return c.json(result)
  })
  
  // Get document details
  router.get('/documents/:id', async (c) => {
    const id = c.req.param('id')
    const orchestrator = getOrchestrator(c.env)
    
    const doc = await orchestrator.getDocument(id)
    if (!doc) {
      return c.json({ error: 'Document not found' }, 404)
    }
    
    return c.json(doc)
  })
  
  // Delete document
  router.delete('/documents/:id', async (c) => {
    const id = c.req.param('id')
    const orchestrator = getOrchestrator(c.env)
    
    await orchestrator.deleteDocument(id)
    return c.json({ success: true })
  })
  
  // ─────────────────────────────────────────────────────────────
  // Search
  // ─────────────────────────────────────────────────────────────
  
  // Search across documents
  router.post(
    '/search',
    zValidator('json', z.object({
      query: z.string(),
      collection: z.string().optional().default('default'),
      maxDocuments: z.number().optional().default(20),
      maxResults: z.number().optional().default(10),
    })),
    async (c) => {
      const body = c.req.valid('json')
      const orchestrator = getOrchestrator(c.env)
      
      const results = await orchestrator.search(
        body.query,
        body.collection,
        { maxDocuments: body.maxDocuments, maxResults: body.maxResults }
      )
      
      return c.json({ results })
    }
  )
  
  // Search single document
  router.post(
    '/documents/:id/search',
    zValidator('json', z.object({
      query: z.string(),
      maxResults: z.number().optional().default(5),
    })),
    async (c) => {
      const id = c.req.param('id')
      const body = c.req.valid('json')
      const orchestrator = getOrchestrator(c.env)
      
      const results = await orchestrator.searchDocument(id, body.query, {
        maxResults: body.maxResults,
      })
      
      return c.json({ results })
    }
  )
  
  return router
}
```

### Orchestrator

```typescript
// src/orchestrator.ts
import type { Env } from './index'
import type { 
  DocumentInput, 
  IndexResult, 
  SearchResult,
  DocumentSummary 
} from 'pageindex'

export interface ListOptions {
  collection: string
  limit: number
  cursor?: string
}

export interface SearchOptions {
  maxDocuments?: number
  maxResults?: number
}

export class Orchestrator {
  constructor(private env: Env) {}
  
  // ─────────────────────────────────────────────────────────────
  // Document Management
  // ─────────────────────────────────────────────────────────────
  
  async indexDocument(
    document: DocumentInput,
    collection: string
  ): Promise<{ id: string; stats: IndexResult['stats'] }> {
    // Create new Document DO
    const doId = this.env.DOCUMENT_DO.newUniqueId()
    const stub = this.env.DOCUMENT_DO.get(doId)
    
    // Index document in the DO
    const result = await stub.index(document)
    
    // Get summary for global index
    const summary = await stub.getSummary()
    
    // Store in D1 global index
    await this.env.DB.prepare(`
      INSERT INTO documents (
        id, collection, name, type, description,
        page_count, token_count, summary, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      doId.toString(),
      collection,
      document.name,
      document.type,
      summary?.description ?? null,
      summary?.pageCount ?? 0,
      summary?.tokenCount ?? 0,
      JSON.stringify(summary),
      Date.now()
    ).run()
    
    return {
      id: doId.toString(),
      stats: result.stats,
    }
  }
  
  async getDocument(id: string): Promise<DocumentSummary | null> {
    const row = await this.env.DB.prepare(`
      SELECT * FROM documents WHERE id = ?
    `).bind(id).first()
    
    if (!row) return null
    
    return JSON.parse(row.summary as string)
  }
  
  async listDocuments(options: ListOptions): Promise<{
    documents: Array<{ id: string; name: string; type: string; createdAt: number }>
    nextCursor?: string
  }> {
    let query = `
      SELECT id, name, type, created_at 
      FROM documents 
      WHERE collection = ?
    `
    const params: unknown[] = [options.collection]
    
    if (options.cursor) {
      query += ` AND created_at < ?`
      params.push(parseInt(options.cursor))
    }
    
    query += ` ORDER BY created_at DESC LIMIT ?`
    params.push(options.limit + 1)
    
    const result = await this.env.DB.prepare(query).bind(...params).all()
    const rows = result.results ?? []
    
    const hasMore = rows.length > options.limit
    const documents = rows.slice(0, options.limit).map(row => ({
      id: row.id as string,
      name: row.name as string,
      type: row.type as string,
      createdAt: row.created_at as number,
    }))
    
    return {
      documents,
      nextCursor: hasMore 
        ? String(documents[documents.length - 1]?.createdAt)
        : undefined,
    }
  }
  
  async deleteDocument(id: string): Promise<void> {
    // Delete from DO
    const stub = this.env.DOCUMENT_DO.get(
      this.env.DOCUMENT_DO.idFromString(id)
    )
    await stub.clear()
    
    // Delete from global index
    await this.env.DB.prepare(`
      DELETE FROM documents WHERE id = ?
    `).bind(id).run()
  }
  
  // ─────────────────────────────────────────────────────────────
  // Search
  // ─────────────────────────────────────────────────────────────
  
  async search(
    query: string,
    collection: string,
    options: SearchOptions = {}
  ): Promise<Array<SearchResult & { documentId: string; documentName: string }>> {
    const maxDocuments = options.maxDocuments ?? 20
    const maxResults = options.maxResults ?? 10
    
    // Get document IDs from global index
    // TODO: Add embedding-based pre-selection here
    const docs = await this.env.DB.prepare(`
      SELECT id, name FROM documents 
      WHERE collection = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(collection, maxDocuments).all()
    
    if (!docs.results?.length) {
      return []
    }
    
    // Fan out search to Document DOs in parallel
    const searchResults = await Promise.all(
      docs.results.map(async (row) => {
        try {
          const stub = this.env.DOCUMENT_DO.get(
            this.env.DOCUMENT_DO.idFromString(row.id as string)
          )
          const results = await stub.search(query)
          
          // Tag results with document info
          return results.map(r => ({
            ...r,
            documentId: row.id as string,
            documentName: row.name as string,
          }))
        } catch (error) {
          console.error(`Search failed for ${row.id}:`, error)
          return []
        }
      })
    )
    
    // Merge and rank
    return searchResults
      .flat()
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
  }
  
  async searchDocument(
    id: string,
    query: string,
    options: { maxResults?: number } = {}
  ): Promise<SearchResult[]> {
    const stub = this.env.DOCUMENT_DO.get(
      this.env.DOCUMENT_DO.idFromString(id)
    )
    return stub.search(query, options)
  }
}
```

### Document Durable Object

```typescript
// src/document-do.ts
import { DurableObject } from 'cloudflare:workers'
import { 
  createDocumentIndex, 
  type DocumentIndex, 
  type DocumentInput,
  type DocumentSummary,
  type SearchResult,
  type SearchOptions,
  type IndexResult,
} from 'pageindex'
import { createSQLiteStorage } from 'pageindex/storage'
import { openai } from '@ai-sdk/openai'
import type { Env } from './index'

export class DocumentDO extends DurableObject<Env> {
  private docIndex: DocumentIndex | null = null
  
  private getDocIndex(): DocumentIndex {
    if (!this.docIndex) {
      this.docIndex = createDocumentIndex({
        model: openai('gpt-4o', {
          apiKey: this.env.OPENAI_API_KEY,
        }),
        storage: createSQLiteStorage(this.ctx.storage.sql),
        documentId: this.ctx.id.toString(),
        processing: {
          addNodeSummary: true,
          addDocDescription: true,
          extractReferences: true,  // Enable reference extraction
        },
      })
    }
    return this.docIndex
  }
  
  // ─────────────────────────────────────────────────────────────
  // Public Methods (called by Orchestrator)
  // ─────────────────────────────────────────────────────────────
  
  async index(document: DocumentInput): Promise<IndexResult> {
    return this.getDocIndex().index(document)
  }
  
  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    return this.getDocIndex().search(query, options)
  }
  
  async getSummary(): Promise<DocumentSummary | null> {
    return this.getDocIndex().getSummary()
  }
  
  async getContent(startIndex: number, endIndex: number): Promise<string> {
    return this.getDocIndex().getContent(startIndex, endIndex)
  }
  
  async clear(): Promise<void> {
    return this.getDocIndex().clear()
  }
}
```

### Wrangler Configuration

```toml
# wrangler.toml
name = "pageindex-service"
main = "src/index.ts"
compatibility_date = "2024-12-01"

[vars]
# OPENAI_API_KEY set via wrangler secret

[[durable_objects.bindings]]
name = "DOCUMENT_DO"
class_name = "DocumentDO"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["DocumentDO"]

[[d1_databases]]
binding = "DB"
database_name = "pageindex-global"
database_id = "your-database-id-here"
```

### D1 Global Index Schema

```sql
-- Run with: wrangler d1 execute pageindex-global --file=schema.sql

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  collection TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  page_count INTEGER,
  token_count INTEGER,
  summary TEXT,  -- JSON
  embedding BLOB, -- For future vector search
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_documents_collection ON documents(collection, created_at DESC);
CREATE INDEX idx_documents_name ON documents(name);

CREATE TABLE IF NOT EXISTS collections (
  name TEXT PRIMARY KEY,
  document_count INTEGER DEFAULT 0,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```
```

---

## SQLite Storage Driver Enhancement

For DO's SQLite, we need a driver that works with the DO's `sql` property:

```typescript
// src/storage/sqlite.ts (updated)

/**
 * Create SQLite storage from a SQL executor
 * Works with both better-sqlite3 and Cloudflare DO's sql
 */
export function createSQLiteStorage(
  sql: SQLExecutor,
  options?: { prefix?: string }
): StorageDriver {
  const prefix = options?.prefix ?? 'pageindex_'
  
  // Initialize schema
  sql.exec(`
    CREATE TABLE IF NOT EXISTS ${prefix}storage (
      key TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_${prefix}type ON ${prefix}storage(type);
  `)
  
  return {
    async get(key: string): Promise<StoredItem | null> {
      const row = sql.exec(
        `SELECT * FROM ${prefix}storage WHERE key = ?`, key
      ).one()
      if (!row) return null
      return deserializeItem(row)
    },
    
    async set(key: string, value: StoredItem): Promise<void> {
      sql.exec(`
        INSERT OR REPLACE INTO ${prefix}storage (key, type, data, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `, key, value.type, JSON.stringify(value.data), 
         value.createdAt.toISOString(), value.updatedAt.toISOString())
    },
    
    // ... rest of methods
  }
}

/**
 * SQL executor interface (works with DO sql and better-sqlite3)
 */
interface SQLExecutor {
  exec(sql: string, ...params: unknown[]): SQLResult
}

interface SQLResult {
  one(): Record<string, unknown> | null
  all(): Record<string, unknown>[]
  toArray(): Record<string, unknown>[]
}
```

---

## Export Structure

### Main Package Exports

```typescript
// src/index.ts
// Layer 2: Document operations (primary API)
export { 
  createDocumentIndex,
  type DocumentIndex,
  type DocumentIndexConfig,
  type DocumentSummary,
} from './document/index.js'

// Layer 2: Multi-document (backward compat)
export { 
  createPageIndex,
  type PageIndex,
  type PageIndexConfig,
} from './core.js'

// Types
export * from './types/index.js'

// Storage
export * from './storage/index.js'
```

### Subpath Exports

```typescript
// package.json
{
  "exports": {
    ".": "./dist/index.js",
    "./core": "./dist/primitives/index.js",
    "./storage": "./dist/storage/index.js",
    "./document": "./dist/document/index.js"
  }
}
```

### Usage Examples

```typescript
// Simple single-document use
import { createDocumentIndex } from 'pageindex'

// Access to primitives for custom implementations
import { TreeBuilder, TreeSearchEngine } from 'pageindex/core'

// Storage drivers
import { createSQLiteStorage, createMemoryStorage } from 'pageindex/storage'

// Types only
import type { TreeNode, SearchResult, DocumentSummary } from 'pageindex'
```

---

## Migration Path

### For Existing Users

```typescript
// Before (still works)
import { createPageIndex } from 'pageindex'
const pi = createPageIndex({ model, storage })
await pi.index(doc1)
await pi.index(doc2)
await pi.search(query)

// After (recommended for new code)
import { createDocumentIndex } from 'pageindex'

// Single document
const docIndex = createDocumentIndex({ model, storage })
await docIndex.index(doc)
await docIndex.search(query)

// Multiple documents (explicit)
const indexes = docs.map(d => createDocumentIndex({ model, storage: createPerDocStorage(d.id) }))
await Promise.all(indexes.map((idx, i) => idx.index(docs[i])))
const results = await Promise.all(indexes.map(idx => idx.search(query)))
```

### For DO Implementers

```typescript
// In DO
import { createDocumentIndex } from 'pageindex'
import { createSQLiteStorage } from 'pageindex/storage'

class DocumentDO extends DurableObject {
  private index = createDocumentIndex({
    model: openai('gpt-4o'),
    storage: createSQLiteStorage(this.ctx.storage.sql),
    documentId: this.ctx.id.toString(),
  })
  
  // Expose methods as needed
  index = (doc) => this.index.index(doc)
  search = (q) => this.index.search(q)
  getSummary = () => this.index.getSummary()
}
```

---

## Summary

| Change | Impact | Effort |
|--------|--------|--------|
| Extract primitives to `pageindex/core` | Low (just re-exports) | 1 day |
| Create `DocumentIndex` interface | Medium (new code) | 2-3 days |
| Create `createDocumentIndex()` | Medium (extract from core.ts) | 1-2 days |
| Update SQLite driver for DO compat | Low (minor changes) | 1 day |
| Keep `createPageIndex` as wrapper | Low (thin wrapper) | 0.5 day |
| Add examples for DO | Medium (new code) | 2-3 days |

Total: ~1-2 weeks for clean separation without breaking existing users.

The key insight: **The library provides single-document primitives. Multi-document orchestration is your concern.** This makes it trivially usable in DO architecture while remaining useful everywhere else.
