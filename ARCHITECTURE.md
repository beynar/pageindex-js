# PageIndex: Scaling Architecture Implementation Guide

> A step-by-step implementation guide for refactoring PageIndex to scale to millions of documents using Cloudflare Durable Objects.

**Target Audience:** AI implementing this architecture. Each section includes WHY, WHAT, and HOW.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Solution Overview](#2-solution-overview)
   - 2b. [Two-Phase Search Architecture](#2b-two-phase-search-architecture)
   - 2c. [Document Indexing Configuration](#2c-document-indexing-configuration)
3. [Critical Requirement: SQL Storage](#3-critical-requirement-sql-storage)
4. [Step 1: Extract Core Primitives](#step-1-extract-core-primitives)
5. [Step 2: Create DocumentIndex API](#step-2-create-documentindex-api)
6. [Step 3: Implement SQL Storage Driver](#step-3-implement-sql-storage-driver)
7. [Step 4: Implement Reference Following](#step-4-implement-reference-following)
8. [Step 5: Update Indexing Pipeline](#step-5-update-indexing-pipeline)
9. [Step 6: Update Search with References](#step-6-update-search-with-references)
10. [Appendix: DO Implementation Example](#appendix-do-implementation-example)

---

## 1. Problem Statement

### Current Architecture Issues

```
┌─────────────────────────────────────────────────────────────────┐
│                    Current PageIndex                             │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                   MIXED CONCERNS                           │  │
│  │                                                            │  │
│  │  ✅ TreeBuilder         (stateless, single-doc)           │  │
│  │  ✅ TreePostProcessor   (stateless, single-doc)           │  │
│  │  ✅ TreeSearchEngine    (stateless, single-doc)           │  │
│  │  ─────────────────────────────────────────────            │  │
│  │  ❌ listDocuments()     (loads ALL docs → OOM)            │  │
│  │  ❌ search() loop       (sequential, O(n) LLM calls)      │  │
│  │  ❌ No pre-filtering    (searches everything)             │  │
│  │  ❌ Key-value storage   (can't do graph queries)          │  │
│  │                                                            │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Bottleneck Locations in Code

| Bottleneck | File | Lines | Problem |
|------------|------|-------|---------|
| Loads all docs | `core.ts` | 379-391 | `listDocuments()` fetches everything |
| Sequential search | `core.ts` | 270-280 | `for (doc of docs) await search(doc)` |
| No pagination | `core.ts` | 379 | Returns full array, no cursor |
| KV storage N+1 | `cloudflare-kv.ts` | 76-83 | Type filter loads each item |

### Impact at Scale

| Documents | Current Behavior | Goal |
|-----------|------------------|------|
| 100 | Works (2-5 min) | 1s |
| 1,000 | Slow (20-50 min) | 2s |
| 10,000 | Risky (3-8 hours) | 3s |
| 100,000 | OOM crash | 5s |
| 1,000,000 | Impossible | 10s |

---

## 2. Solution Overview

### Target Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Cloudflare Worker                           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                       Hono Router                          │  │
│  │  POST /documents  GET /documents  POST /search  etc.      │  │
│  └───────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Orchestrator DO                               │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                   SQLite Storage                           │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  documents (id, collection, name, summary, ...)     │  │  │
│  │  │  collections (name, doc_count, metadata, ...)       │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│  • Document selection (metadata/embeddings)                      │
│  • Fan-out to Document DOs in parallel                          │
│  • Result aggregation                                            │
└──────────────────────────────┬──────────────────────────────────┘
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

### Library Layers

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 3: Orchestration (NOT in library - user implements)      │
│  ───────────────────────────────────────────────────────────    │
│  • Worker + Hono Router (entry point)                           │
│  • Orchestrator DO with SQLite (global document index)          │
│  • Document DOs with SQLite (one per document)                  │
│  • OPTIONAL: Only needed for multi-document scaling             │
└─────────────────────────────────────────────────────────────────┘
                              │ uses
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 2: DocumentIndex (library - the main API)                │
│  ───────────────────────────────────────────────────────────    │
│  • createDocumentIndex(config) → DocumentIndex                  │
│  • Single-document: index(), search(), getSummary(), clear()   │
│  • Requires SQL storage (DO's SQLite or bun:sqlite)            │
│  • Reference extraction and following built-in                  │
│  • CAN BE USED STANDALONE for single-document use cases        │
└─────────────────────────────────────────────────────────────────┘
                              │ uses
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1: Primitives (library - already exists, just export)    │
│  ───────────────────────────────────────────────────────────    │
│  • TreeBuilder: PDF/Markdown → Tree                             │
│  • TreePostProcessor: add summaries                             │
│  • TreeSearchEngine: LLM-based tree search                      │
│  • Stateless, pure functions                                    │
└─────────────────────────────────────────────────────────────────┘
```

### Single-Document Usage (No Orchestration)

For users who only need to index and search **one document**, Layer 2 can be used directly without any orchestration layer:

```typescript
import { createDocumentIndex } from 'pageindex'
import { createBunSQLiteExecutor } from 'pageindex/storage'
import { Database } from 'bun:sqlite'
import { openai } from '@ai-sdk/openai'

// ─────────────────────────────────────────────────────────────
// Single-document usage - NO orchestrator, NO embeddings, NO vector DB
// ─────────────────────────────────────────────────────────────

// 1. Create SQLite database (in-memory or file)
const db = new Database(':memory:')  // or './my-index.sqlite'

// 2. Create document index
const docIndex = createDocumentIndex({
  sql: createBunSQLiteExecutor(db),
  models: {
    treeBuilder: openai('gpt-4o'),
  },
})

// 3. Index your document
await docIndex.index({
  name: 'company-handbook.pdf',
  type: 'pdf',
  content: await Bun.file('./handbook.pdf').arrayBuffer(),
})

// 4. Search
const results = await docIndex.search('What is the vacation policy?')

console.log(results[0].node.text)  // The relevant text
```

**This is the simplest way to use PageIndex** — no collections, no embeddings, no multi-document complexity. Just index one document and search it.

### When to Use Each Layer

| Use Case | Layer | What You Need |
|----------|-------|---------------|
| **Single document** | Layer 2 only | `createDocumentIndex()` + SQLite |
| **Few documents (local)** | Layer 2 per doc | Multiple `DocumentIndex` instances |
| **Many documents (cloud)** | Layer 2 + 3 | Orchestrator DO + Document DOs |
| **Millions of documents** | Layer 2 + 3 + embeddings | Full architecture with Vectorize |

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Single-doc focus in library | Each Document DO handles one document |
| SQL storage required | Reference following needs graph queries (recursive CTEs) |
| Orchestrator DO with SQLite | Global index stays in DO's SQLite, not D1 |
| Worker + Hono as entry point | Thin HTTP layer, routes to Orchestrator DO |
| Orchestration outside library | Platform-specific (CF Workers, Node, etc.) |

### Component Responsibilities

| Component | Storage | Responsibilities |
|-----------|---------|------------------|
| **Worker + Hono** | None | HTTP endpoints, request validation, routes to Orchestrator |
| **Orchestrator DO** | SQLite (global index) | Document registry, collection management, document selection, fan-out to Document DOs, result aggregation |
| **Document DO** | SQLite (per-doc) | Tree storage, pages, references, search within document |
| **PageIndex Library** | None (uses provided SQL) | Tree building, post-processing, search engine, reference extraction |

---

## 2b. Two-Phase Search Architecture

### WHY Two Phases

PageIndex's LLM-based tree reasoning is **expensive** (multiple LLM calls per document). Searching all documents is not viable at scale:

| Documents | LLM Calls (All Docs) | Cost | Time |
|-----------|---------------------|------|------|
| 100 | 500+ | $5 | 5 min |
| 1,000 | 5,000+ | $50 | 50 min |
| 10,000 | 50,000+ | $500 | 8 hours |
| 1,000,000 | 5,000,000+ | $50,000 | Weeks |

**Solution:** First select 10-50 relevant documents (cheap), then deep-search only those (expensive but bounded).

### Two-Phase Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 1: Document Selection (Fast, Cheap)                      │
│  ─────────────────────────────────────────                      │
│                                                                  │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐           │
│  │  Metadata   │   │  Embedding  │   │  Meta-Tree  │           │
│  │  Filtering  │ + │  Similarity │ + │  Reasoning  │  = Top-K  │
│  │  (instant)  │   │  (fast)     │   │  (LLM)      │           │
│  └─────────────┘   └─────────────┘   └─────────────┘           │
│                                                                  │
│  Input: 1,000,000 documents                                     │
│  Output: 20 candidate documents                                  │
│  Cost: ~$0.01 (embedding) or $0.10 (meta-tree)                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 2: Deep Tree Search (Slow, Accurate)                     │
│  ──────────────────────────────────────────                     │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  For each of 20 documents (in parallel):                  │  │
│  │  • LLM navigates tree structure                           │  │
│  │  • Scores relevant nodes                                   │  │
│  │  • Follows cross-references                                │  │
│  │  • Returns ranked results                                  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Input: 20 candidate documents                                  │
│  Output: Ranked search results with text content                │
│  Cost: ~$0.50 (20 docs × 5 LLM calls each)                     │
└─────────────────────────────────────────────────────────────────┘
```

### Document Selection Strategies

The Orchestrator supports **three strategies** that can be used individually or combined:

#### Strategy A: Metadata Filtering (Fastest, No LLM)

```
Query: "termination clauses in employment contracts"
        ↓
Orchestrator SQLite:
  SELECT id FROM documents 
  WHERE collection = 'legal'
    AND json_extract(metadata, '$.type') = 'contract'
    AND json_extract(metadata, '$.category') = 'employment'
  LIMIT 50
        ↓
Result: 50 documents (instant, $0)
```

**Pros:** Instant, zero cost, predictable
**Cons:** Requires structured metadata, can't handle semantic similarity

#### Strategy B: Embedding Similarity (Fast, Semantic)

```
Query: "termination clauses in employment contracts"
        ↓
1. Generate query embedding (1 API call)
2. Vector search in Orchestrator's SQLite or external vector DB
   SELECT id, vector_distance(embedding, ?) as distance
   FROM documents
   ORDER BY distance
   LIMIT 50
        ↓
Result: 50 most similar documents (~100ms, ~$0.001)
```

**Pros:** Semantic understanding, works without structured metadata
**Cons:** Requires embedding model, embedding storage

#### Strategy C: Meta-Tree Reasoning (Accurate, LLM-Based)

```
Query: "termination clauses in employment contracts"
        ↓
1. Load document summaries from Orchestrator SQLite
2. Build meta-tree:
   [
     { id: 'doc-1', name: 'Employment Agreement', summary: '...' },
     { id: 'doc-2', name: 'NDA Template', summary: '...' },
     ...
   ]
3. LLM reasons: "For termination clauses, I should search doc-1, doc-5, doc-12"
        ↓
Result: 10-20 precisely selected documents (~2s, ~$0.10)
```

**Pros:** Most accurate, handles complex reasoning queries
**Cons:** Slower, costs more (but still 100x cheaper than searching all)

#### Strategy D: Hybrid (Recommended for Production)

```
Query: "termination clauses in employment contracts"
        ↓
1. Metadata filter: collection='legal', type='contract' → 500 docs
2. Embedding similarity on 500 docs → top 50
3. (Optional) Meta-tree on 50 docs → final 20
        ↓
Result: 20 highly relevant documents
```

### Orchestrator Configuration

The Orchestrator DO must be **fully configurable** by the user:

```typescript
/**
 * Configuration for the Orchestrator DO
 * All components are user-provided, not hardcoded
 */
interface OrchestratorConfig {
  // ─────────────────────────────────────────────────────────────
  // Document Selection
  // ─────────────────────────────────────────────────────────────
  
  /** Selection strategy: which methods to use and in what order */
  selectionStrategy: {
    /** Primary strategy */
    primary: 'metadata' | 'embedding' | 'meta-tree' | 'hybrid'
    
    /** For hybrid: which strategies to combine */
    stages?: Array<{
      strategy: 'metadata' | 'embedding' | 'meta-tree'
      maxDocuments: number  // Output limit for this stage
    }>
    
    /** Final limit after all stages */
    maxDocuments: number  // default: 20
  }
  
  // ─────────────────────────────────────────────────────────────
  // Embedding Configuration (if using embedding strategy)
  // ─────────────────────────────────────────────────────────────
  
  embedding?: {
    /** Embedding model (user provides) */
    model: EmbeddingModel  // e.g., openai.embedding('text-embedding-3-small')
    
    /** Vector storage implementation (user provides) */
    vectorStore: VectorStore  // Interface defined below
    
    /** Dimensions of embeddings */
    dimensions: number  // e.g., 1536 for OpenAI
    
    /** Minimum similarity threshold (0-1) */
    minSimilarity?: number  // default: 0.7
  }
  
  // ─────────────────────────────────────────────────────────────
  // Meta-Tree Configuration (if using meta-tree strategy)
  // ─────────────────────────────────────────────────────────────
  
  metaTree?: {
    /** LLM model for meta-tree reasoning */
    model: LanguageModel  // e.g., openai('gpt-4o-mini')
    
    /** Max documents to include in meta-tree context */
    maxContextDocuments: number  // default: 100
    
    /** Include node summaries (more accurate but more tokens) */
    includeNodeSummaries: boolean  // default: false
  }
  
  // ─────────────────────────────────────────────────────────────
  // Summary Generation (for document index)
  // ─────────────────────────────────────────────────────────────
  
  summary?: {
    /** Model for generating document summaries */
    model: LanguageModel  // e.g., openai('gpt-4o-mini')
    
    /** Max tokens for summary */
    maxTokens?: number  // default: 500
    
    /** Generate embedding when indexing */
    generateEmbedding: boolean  // default: true if embedding config exists
  }
  
  // ─────────────────────────────────────────────────────────────
  // Storage Configuration
  // ─────────────────────────────────────────────────────────────
  
  storage: {
    /** SQL executor for Orchestrator's SQLite */
    sql: SQLExecutor  // DO's ctx.storage.sql
    
    /** Optional: external vector database */
    vectorDB?: VectorStore
  }
}
```

### Vector Store Interface

User can provide any vector database implementation:

```typescript
/**
 * Vector store interface - user implements for their preferred DB
 */
interface VectorStore {
  /** Store a document embedding */
  upsert(id: string, embedding: number[], metadata?: Record<string, unknown>): Promise<void>
  
  /** Find similar documents */
  search(embedding: number[], options: {
    topK: number
    minSimilarity?: number
    filter?: Record<string, unknown>  // Metadata filter
  }): Promise<Array<{ id: string; similarity: number }>>
  
  /** Delete an embedding */
  delete(id: string): Promise<void>
  
  /** Batch operations */
  upsertMany?(items: Array<{ id: string; embedding: number[]; metadata?: Record<string, unknown> }>): Promise<void>
}
```

### Vector Store Implementations

**Important:** Cloudflare DO's SQLite does NOT have vector extensions. You cannot do native vector similarity search in DO SQLite.

#### Option 1: Cloudflare Vectorize (Recommended for Cloudflare)

```typescript
// Use Cloudflare's managed vector database
import { createVectorizeStore } from 'pageindex/vector'
const vectorStore = createVectorizeStore(env.VECTORIZE)

// Implementation
export function createVectorizeStore(vectorize: VectorizeIndex): VectorStore {
  return {
    async upsert(id, embedding, metadata) {
      await vectorize.upsert([{ id, values: embedding, metadata }])
    },
    async search(embedding, options) {
      const results = await vectorize.query(embedding, {
        topK: options.topK,
        filter: options.filter,
      })
      return results.matches.map(m => ({ id: m.id, similarity: m.score }))
    },
    async delete(id) {
      await vectorize.deleteByIds([id])
    },
  }
}
```

#### Option 2: External Vector DB (Production at Scale)

```typescript
// Pinecone, Qdrant, Weaviate, etc.
import { createPineconeStore } from 'pageindex/vector'
const vectorStore = createPineconeStore(pineconeClient, 'index-name')
```

#### Option 3: In-Memory (Testing Only)

```typescript
import { createMemoryVectorStore } from 'pageindex/vector'
const vectorStore = createMemoryVectorStore({ dimensions: 1536 })
```

### Vector Store Selection Guide

| Scale | Cloudflare | Self-Hosted |
|-------|------------|-------------|
| Any scale | **Vectorize** | Qdrant, Pinecone, Milvus |

**Recommendation for Cloudflare:** Use Vectorize. It's the only option that doesn't require external infrastructure.

### Embedding Model Interface

User provides their embedding model:

```typescript
/**
 * Embedding model interface - user implements or uses AI SDK
 */
interface EmbeddingModel {
  /** Generate embedding for text */
  embed(text: string): Promise<number[]>
  
  /** Batch embed (more efficient) */
  embedMany?(texts: string[]): Promise<number[][]>
  
  /** Embedding dimensions */
  readonly dimensions: number
}

// Example with AI SDK
import { openai } from '@ai-sdk/openai'
import { embed } from 'ai'

const embeddingModel: EmbeddingModel = {
  dimensions: 1536,
  async embed(text: string) {
    const { embedding } = await embed({
      model: openai.embedding('text-embedding-3-small'),
      value: text,
    })
    return embedding
  },
  async embedMany(texts: string[]) {
    const results = await Promise.all(texts.map(t => this.embed(t)))
    return results
  },
}
```

---

## 2c. Document Indexing Configuration

### WHY Configurable

Different users have different requirements:
- Some want fast indexing without embeddings
- Some need custom metadata extraction
- Some want different LLM models for different tasks
- Some want to skip summary generation

### Document Index Configuration

```typescript
/**
 * Configuration for createDocumentIndex()
 * All processing components are user-provided
 */
interface DocumentIndexConfig {
  // ─────────────────────────────────────────────────────────────
  // Required
  // ─────────────────────────────────────────────────────────────
  
  /** SQL executor (DO's ctx.storage.sql or bun:sqlite) */
  sql: SQLExecutor
  
  /** Document ID (for re-opening) or leave empty for auto-generate */
  documentId?: string
  
  // ─────────────────────────────────────────────────────────────
  // LLM Models (user provides all models)
  // ─────────────────────────────────────────────────────────────
  
  models: {
    /** Model for tree building (TOC detection, structure analysis) */
    treeBuilder: LanguageModel  // e.g., openai('gpt-4o')
    
    /** Model for generating node summaries */
    summarizer?: LanguageModel  // e.g., openai('gpt-4o-mini')
    
    /** Model for search (can be same as treeBuilder) */
    search?: LanguageModel  // default: uses treeBuilder model
    
    /** Model for reference extraction */
    referenceExtractor?: LanguageModel  // default: uses summarizer or treeBuilder
  }
  
  // ─────────────────────────────────────────────────────────────
  // Processing Options
  // ─────────────────────────────────────────────────────────────
  
  processing?: {
    /** Generate summaries for each node (default: true) */
    generateNodeSummaries?: boolean
    
    /** Generate document-level description (default: true) */
    generateDocDescription?: boolean
    
    /** Extract cross-references between nodes (default: true) */
    extractReferences?: boolean
    
    /** Batch size for LLM calls during processing */
    batchSize?: number  // default: 10
    
    /** Concurrency limit for parallel LLM calls */
    concurrency?: number  // default: 5
    
    /** Custom metadata extractor (optional) */
    metadataExtractor?: (document: DocumentInput, tree: TreeNode[]) => Promise<Record<string, unknown>>
  }
  
  // ─────────────────────────────────────────────────────────────
  // Search Options (defaults)
  // ─────────────────────────────────────────────────────────────
  
  search?: {
    /** Follow cross-references in search results (default: true) */
    followReferences?: boolean
    
    /** Maximum reference depth to follow (default: 2) */
    maxReferenceDepth?: number
    
    /** Include page text in results (default: true) */
    includeText?: boolean
    
    /** Maximum results to return (default: 5) */
    maxResults?: number
  }
}
```

### Example: Minimal Configuration

```typescript
// Minimal: just the essentials
const docIndex = createDocumentIndex({
  sql: createDOSQLiteExecutor(ctx.storage.sql),
  models: {
    treeBuilder: openai('gpt-4o'),
  },
})
```

### Example: Full Configuration

```typescript
// Full: everything customized
const docIndex = createDocumentIndex({
  sql: createDOSQLiteExecutor(ctx.storage.sql),
  documentId: ctx.id.toString(),
  
  models: {
    treeBuilder: openai('gpt-4o'),          // Best for structure
    summarizer: openai('gpt-4o-mini'),      // Cheaper for summaries
    search: openai('gpt-4o'),               // Best for search
    referenceExtractor: openai('gpt-4o-mini'), // Cheaper for refs
  },
  
  processing: {
    generateNodeSummaries: true,
    generateDocDescription: true,
    extractReferences: true,
    batchSize: 20,
    concurrency: 10,
    metadataExtractor: async (doc, tree) => ({
      wordCount: countWords(doc.content),
      language: await detectLanguage(doc.content),
      topics: await extractTopics(doc.content),
    }),
  },
  
  search: {
    followReferences: true,
    maxReferenceDepth: 3,
    includeText: true,
    maxResults: 10,
  },
})
```

### Orchestrator Indexing Flow

When the Orchestrator indexes a document, it:

1. **Creates Document DO** with user's config
2. **Indexes in Document DO** (tree, summaries, references)
3. **Gets summary** from Document DO
4. **Generates embedding** (if configured)
5. **Stores in global index** (Orchestrator's SQLite)

```typescript
// In OrchestratorDO
async indexDocument(document: DocumentInput, collection: string): Promise<IndexResult> {
  // 1. Create Document DO
  const doId = this.env.DOCUMENT_DO.newUniqueId()
  const stub = this.env.DOCUMENT_DO.get(doId)
  
  // 2. Index document (uses Document DO's config)
  const result = await stub.index(document)
  
  // 3. Get summary for global index
  const summary = await stub.getSummary()
  
  // 4. Generate embedding if configured
  let embedding: number[] | null = null
  if (this.config.embedding && this.config.summary?.generateEmbedding) {
    const embeddingText = `${summary.name} ${summary.description ?? ''} ${
      summary.topLevelNodes.map(n => n.title).join(' ')
    }`
    embedding = await this.config.embedding.model.embed(embeddingText)
    
    // Store in vector DB
    await this.config.embedding.vectorStore.upsert(doId.toString(), embedding, {
      collection,
      name: summary.name,
    })
  }
  
  // 5. Store in Orchestrator's SQLite
  this.sql.exec(`
    INSERT INTO documents (id, collection, name, type, description, 
                          page_count, token_count, summary, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, 
    doId.toString(),
    collection,
    summary.name,
    summary.type,
    summary.description,
    summary.pageCount,
    summary.tokenCount,
    JSON.stringify(summary),
    JSON.stringify(document.metadata ?? {}),
    Date.now()
  )
  
  return { id: doId.toString(), stats: result.stats }
}
```

---

## 3. Critical Requirement: SQL Storage

### WHY SQL is Required

Reference following creates a **graph structure** overlaid on the tree:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Node Graph                                │
│                                                                  │
│   ┌──────────┐                      ┌──────────┐                │
│   │  Node A  │ ──── references ───► │  Node B  │                │
│   │ "...see  │                      │ Appendix │                │
│   │ Appendix │                      │    G     │                │
│   │   G..."  │                      │          │                │
│   └──────────┘                      └──────────┘                │
│        │                                  ▲                      │
│        │ parent_id (tree)                 │ reference (graph)    │
│        ▼                                  │                      │
│   ┌──────────┐                            │                      │
│   │  Node C  │ ───────────────────────────┘                      │
│   └──────────┘                                                   │
│                                                                  │
│   Tree edges: parent_id → hierarchical structure                 │
│   Reference edges: node_id → node_id → cross-references         │
└─────────────────────────────────────────────────────────────────┘
```

**Graph traversal requires SQL recursive CTEs:**
- Key-value stores (Memory, Redis, KV) cannot do this
- Only SQLite, D1, PostgreSQL support recursive CTEs

### Storage Driver Compatibility

| Storage Driver | SQL Support | Reference Following | Use Case |
|----------------|-------------|---------------------|----------|
| Memory | ❌ No | ❌ No | Testing only |
| Redis | ❌ No | ❌ No | Not recommended |
| Cloudflare KV | ❌ No | ❌ No | Not recommended |
| **bun:sqlite** | ✅ Yes | ✅ Yes | Local development, Node/Bun |
| **DO SQLite** | ✅ Yes | ✅ Yes | **Production: Document DOs + Orchestrator DO** |
| **D1** | ✅ Yes | ✅ Yes | Alternative to DO SQLite (external) |
| **PostgreSQL** | ✅ Yes | ✅ Yes | Self-hosted, not Cloudflare |

**Note:** In the DO architecture, both the Orchestrator DO and each Document DO use their own SQLite storage via `ctx.storage.sql`. D1 is not required.

### SQL Schema (Normalized)

This schema replaces the current JSON key-value storage:

```sql
-- ============================================================
-- NORMALIZED SCHEMA FOR PAGEINDEX WITH REFERENCE FOLLOWING
-- ============================================================

-- Document metadata
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,              -- 'pdf' | 'markdown'
  description TEXT,                -- LLM-generated summary
  page_count INTEGER NOT NULL,
  token_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Tree nodes (flattened hierarchy)
CREATE TABLE nodes (
  node_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  parent_id TEXT,                  -- NULL for root nodes (tree edge)
  title TEXT NOT NULL,
  summary TEXT,                    -- LLM-generated node summary
  start_index INTEGER NOT NULL,    -- First page index
  end_index INTEGER NOT NULL,      -- Last page index
  depth INTEGER NOT NULL,          -- 0 = root, 1 = child, etc.
  position INTEGER NOT NULL,       -- Order within parent
  
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES nodes(node_id)
);

CREATE INDEX idx_nodes_document ON nodes(document_id);
CREATE INDEX idx_nodes_parent ON nodes(parent_id);
CREATE INDEX idx_nodes_depth ON nodes(depth);

-- Page content (separate for lazy loading)
CREATE TABLE pages (
  document_id TEXT NOT NULL,
  page_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  
  PRIMARY KEY (document_id, page_index),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX idx_pages_document ON pages(document_id);

-- Cross-references (graph edges between nodes)
CREATE TABLE node_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_node_id TEXT NOT NULL,    -- Node containing the reference text
  target_node_id TEXT NOT NULL,    -- Node being referenced
  reference_text TEXT NOT NULL,    -- Original text: "see Appendix G"
  reference_type TEXT NOT NULL,    -- 'section' | 'table' | 'figure' | 'appendix' | 'page'
  confidence REAL DEFAULT 1.0,     -- Match confidence (0-1)
  
  FOREIGN KEY (source_node_id) REFERENCES nodes(node_id) ON DELETE CASCADE,
  FOREIGN KEY (target_node_id) REFERENCES nodes(node_id) ON DELETE CASCADE,
  UNIQUE(source_node_id, target_node_id)
);

CREATE INDEX idx_refs_source ON node_references(source_node_id);
CREATE INDEX idx_refs_target ON node_references(target_node_id);
```

---

## Step 1: Extract Core Primitives

### WHY
Layer 1 components already exist but are not cleanly exported. They need to be accessible for Layer 2.

### WHAT TO DO

1. Create `src/primitives/index.ts` to re-export existing components
2. Ensure each primitive is stateless and single-document focused

### FILE: `src/primitives/index.ts`

```typescript
// Re-export existing primitives for clean access
// These are already implemented, just need to be exported

export { TreeBuilder } from '../tree/builder.js'
export type { TreeBuildResult, TreeBuildOptions } from '../tree/builder.js'

export { TreePostProcessor } from '../tree/postprocess.js'
export type { PostProcessResult } from '../tree/postprocess.js'

export { TreeSearchEngine } from '../search/engine.js'
export type { SearchEngineOptions } from '../search/engine.js'

export { ContentRetriever } from '../search/retrieval.js'

export { LLMClient } from '../llm/client.js'
export type { LLMCallOptions } from '../llm/client.js'

// Re-export types
export type { TreeNode, SearchResult } from '../types/tree.js'
export type { DocumentInput, IndexedDocument } from '../types/document.js'
export type { ProcessingOptions, SearchOptions } from '../types/config.js'
```

### VERIFICATION

After this step, the following should work:

```typescript
import { TreeBuilder, TreeSearchEngine } from 'pageindex/primitives'

const builder = new TreeBuilder(model, options)
const { tree, pages } = await builder.build(document)

const engine = new TreeSearchEngine(model)
const results = await engine.search(query, tree, options)
```

---

## Step 2: Create DocumentIndex API

### WHY
Single-document API that DO can wrap. Separates document operations from multi-document orchestration.

### WHAT TO DO

1. Create `src/document/types.ts` with interfaces
2. Create `src/document/document-index.ts` with implementation
3. Create `src/document/index.ts` to export

### FILE: `src/document/types.ts`

```typescript
import type { LanguageModel } from 'ai'
import type { TreeNode, SearchResult } from '../types/tree.js'
import type { DocumentInput } from '../types/document.js'
import type { ProcessingOptions, SearchOptions } from '../types/config.js'

/**
 * SQL executor interface - works with both bun:sqlite and DO's ctx.storage.sql
 */
export interface SQLExecutor {
  exec(query: string, ...bindings: unknown[]): SQLCursor
}

export interface SQLCursor {
  one(): Record<string, unknown> | null
  toArray(): Record<string, unknown>[]
  run(...bindings: unknown[]): void
}

/**
 * Configuration for createDocumentIndex()
 */
export interface DocumentIndexConfig {
  /** LLM model for processing and search */
  model: LanguageModel
  
  /** SQL executor (required for reference following) */
  sql: SQLExecutor
  
  /** Document ID (if re-opening existing, or leave empty for new) */
  documentId?: string
  
  /** Processing options */
  processing?: Partial<ProcessingOptions> & {
    /** Extract cross-references during indexing (default: true) */
    extractReferences?: boolean
    /** Batch size for reference extraction LLM calls (default: 10) */
    referenceExtractionBatchSize?: number
  }
  
  /** Default search options */
  search?: Partial<SearchOptions> & {
    /** Follow cross-references in search (default: true) */
    followReferences?: boolean
    /** Max reference hops to follow (default: 2) */
    maxReferenceDepth?: number
  }
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
 * Index result with reference stats
 */
export interface IndexResult {
  documentId: string
  stats: {
    pageCount: number
    tokenCount: number
    nodeCount: number
    referenceCount: number
    llmCalls: number
    durationMs: number
  }
}

/**
 * Extended search result with reference info
 */
export interface ExtendedSearchResult extends SearchResult {
  /** How many reference hops from original result (0 = direct match) */
  referenceDepth?: number
  
  /** Reference path that led to this result */
  referencePath?: Array<{
    fromNodeId: string
    toNodeId: string
    referenceText: string
  }>
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
  search(query: string, options?: SearchOptions): Promise<ExtendedSearchResult[]>
  
  /** Get the tree structure */
  getTree(): Promise<TreeNode[] | null>
  
  /** Get page content by index range */
  getContent(startIndex: number, endIndex: number): Promise<string>
  
  /** Get document summary (for orchestrator selection) */
  getSummary(): Promise<DocumentSummary | null>
  
  /** Check if document is indexed */
  isIndexed(): Promise<boolean>
  
  /** Delete this document from storage */
  clear(): Promise<void>
}
```

### FILE: `src/document/document-index.ts`

```typescript
import type { DocumentIndex, DocumentIndexConfig, DocumentSummary, IndexResult, ExtendedSearchResult, SQLExecutor } from './types.js'
import type { DocumentInput } from '../types/document.js'
import type { TreeNode, SearchResult } from '../types/tree.js'
import type { SearchOptions } from '../types/config.js'
import { TreeBuilder } from '../primitives/tree-builder.js'
import { TreePostProcessor } from '../primitives/tree-postprocessor.js'
import { TreeSearchEngine } from '../primitives/tree-search.js'
import { LLMClient } from '../llm/client.js'

/**
 * Create a single-document index with SQL storage
 * 
 * @example
 * ```typescript
 * const docIndex = createDocumentIndex({
 *   model: openai('gpt-4o'),
 *   sql: db,  // bun:sqlite Database or DO's ctx.storage.sql
 * })
 * 
 * await docIndex.index(document)
 * const results = await docIndex.search(query)
 * ```
 */
export function createDocumentIndex(config: DocumentIndexConfig): DocumentIndex {
  const { model, sql } = config
  const llm = new LLMClient(model)
  
  // Initialize schema on first use
  let schemaInitialized = false
  function ensureSchema(): void {
    if (schemaInitialized) return
    initializeSchema(sql)
    schemaInitialized = true
  }
  
  let documentId: string | null = config.documentId ?? null
  
  // Merge options with defaults
  const processingOptions = {
    extractReferences: true,
    referenceExtractionBatchSize: 10,
    ...config.processing,
  }
  
  const searchDefaults = {
    followReferences: true,
    maxReferenceDepth: 2,
    ...config.search,
  }
  
  return {
    get documentId() {
      return documentId
    },
    
    async index(document: DocumentInput): Promise<IndexResult> {
      ensureSchema()
      const startTime = Date.now()
      let llmCalls = 0
      
      // Generate ID if not provided
      if (!documentId) {
        documentId = generateDocId(document.name)
      }
      
      // Clear existing data for this document
      await clearDocumentData(sql, documentId)
      
      // Step 1: Build tree
      const builder = new TreeBuilder(model, processingOptions)
      const buildResult = await builder.build(document)
      llmCalls += buildResult.stats.llmCalls ?? 0
      
      // Step 2: Post-process (add summaries)
      const postProcessor = new TreePostProcessor(model, processingOptions)
      const processResult = await postProcessor.process(buildResult.tree, buildResult.pages)
      llmCalls += processResult.stats?.llmCalls ?? 0
      
      // Step 3: Store document metadata
      storeDocument(sql, documentId, document, buildResult.stats, processResult.description)
      
      // Step 4: Store nodes (flattened tree)
      const nodeCount = storeNodes(sql, documentId, processResult.tree)
      
      // Step 5: Store pages
      storePages(sql, documentId, buildResult.pages)
      
      // Step 6: Extract and store references (if enabled)
      let referenceCount = 0
      if (processingOptions.extractReferences) {
        referenceCount = await extractAndStoreReferences(
          sql,
          documentId,
          llm,
          processingOptions.referenceExtractionBatchSize
        )
        llmCalls += Math.ceil(nodeCount / processingOptions.referenceExtractionBatchSize)
      }
      
      return {
        documentId,
        stats: {
          pageCount: buildResult.stats.pageCount,
          tokenCount: buildResult.stats.tokenCount,
          nodeCount,
          referenceCount,
          llmCalls,
          durationMs: Date.now() - startTime,
        },
      }
    },
    
    async search(query: string, options?: SearchOptions): Promise<ExtendedSearchResult[]> {
      ensureSchema()
      if (!documentId) return []
      
      const mergedOptions = { ...searchDefaults, ...options }
      
      // Load tree from SQL
      const tree = await this.getTree()
      if (!tree || tree.length === 0) return []
      
      // Step 1: Standard tree search
      const searchEngine = new TreeSearchEngine(model)
      const initialResults = await searchEngine.search(query, tree, mergedOptions)
      
      if (initialResults.length === 0) return []
      
      // Step 2: Expand with references (if enabled)
      if (mergedOptions.followReferences) {
        return expandWithReferences(
          sql,
          documentId,
          initialResults,
          query,
          llm,
          mergedOptions.maxReferenceDepth
        )
      }
      
      return initialResults.map(r => ({ ...r, referenceDepth: 0 }))
    },
    
    async getTree(): Promise<TreeNode[] | null> {
      ensureSchema()
      if (!documentId) return null
      return loadTreeFromSQL(sql, documentId)
    },
    
    async getContent(startIndex: number, endIndex: number): Promise<string> {
      ensureSchema()
      if (!documentId) return ''
      return loadContentFromSQL(sql, documentId, startIndex, endIndex)
    },
    
    async getSummary(): Promise<DocumentSummary | null> {
      ensureSchema()
      if (!documentId) return null
      return loadSummaryFromSQL(sql, documentId)
    },
    
    async isIndexed(): Promise<boolean> {
      ensureSchema()
      if (!documentId) return false
      const row = sql.exec(
        'SELECT 1 FROM documents WHERE id = ?', documentId
      ).one()
      return row !== null
    },
    
    async clear(): Promise<void> {
      ensureSchema()
      if (!documentId) return
      await clearDocumentData(sql, documentId)
      documentId = null
    },
  }
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function generateDocId(name: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  const safeName = name.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 20)
  return `${safeName}-${timestamp}-${random}`
}

function initializeSchema(sql: SQLExecutor): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      page_count INTEGER NOT NULL,
      token_count INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS nodes (
      node_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      parent_id TEXT,
      title TEXT NOT NULL,
      summary TEXT,
      start_index INTEGER NOT NULL,
      end_index INTEGER NOT NULL,
      depth INTEGER NOT NULL,
      position INTEGER NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES nodes(node_id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_nodes_document ON nodes(document_id);
    CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);
    CREATE INDEX IF NOT EXISTS idx_nodes_depth ON nodes(depth);
    
    CREATE TABLE IF NOT EXISTS pages (
      document_id TEXT NOT NULL,
      page_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      PRIMARY KEY (document_id, page_index),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );
    
    CREATE INDEX IF NOT EXISTS idx_pages_document ON pages(document_id);
    
    CREATE TABLE IF NOT EXISTS node_references (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_node_id TEXT NOT NULL,
      target_node_id TEXT NOT NULL,
      reference_text TEXT NOT NULL,
      reference_type TEXT NOT NULL,
      confidence REAL DEFAULT 1.0,
      FOREIGN KEY (source_node_id) REFERENCES nodes(node_id) ON DELETE CASCADE,
      FOREIGN KEY (target_node_id) REFERENCES nodes(node_id) ON DELETE CASCADE,
      UNIQUE(source_node_id, target_node_id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_refs_source ON node_references(source_node_id);
    CREATE INDEX IF NOT EXISTS idx_refs_target ON node_references(target_node_id);
  `)
}

async function clearDocumentData(sql: SQLExecutor, documentId: string): Promise<void> {
  // Delete in correct order due to foreign keys
  sql.exec('DELETE FROM node_references WHERE source_node_id IN (SELECT node_id FROM nodes WHERE document_id = ?)', documentId)
  sql.exec('DELETE FROM pages WHERE document_id = ?', documentId)
  sql.exec('DELETE FROM nodes WHERE document_id = ?', documentId)
  sql.exec('DELETE FROM documents WHERE id = ?', documentId)
}

function storeDocument(
  sql: SQLExecutor,
  documentId: string,
  document: DocumentInput,
  stats: { pageCount: number; tokenCount: number },
  description?: string
): void {
  const now = new Date().toISOString()
  sql.exec(`
    INSERT INTO documents (id, name, type, description, page_count, token_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, documentId, document.name, document.type, description ?? null, stats.pageCount, stats.tokenCount, now, now)
}

function storeNodes(sql: SQLExecutor, documentId: string, tree: TreeNode[]): number {
  let count = 0
  
  function insertRecursive(nodes: TreeNode[], parentId: string | null, depth: number): void {
    nodes.forEach((node, position) => {
      sql.exec(`
        INSERT INTO nodes (node_id, document_id, parent_id, title, summary, start_index, end_index, depth, position)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, node.nodeId, documentId, parentId, node.title, node.summary ?? null, node.startIndex, node.endIndex, depth, position)
      count++
      
      if (node.nodes && node.nodes.length > 0) {
        insertRecursive(node.nodes, node.nodeId, depth + 1)
      }
    })
  }
  
  insertRecursive(tree, null, 0)
  return count
}

function storePages(sql: SQLExecutor, documentId: string, pages: Array<{ index: number; text: string; tokenCount: number }>): void {
  for (const page of pages) {
    sql.exec(`
      INSERT INTO pages (document_id, page_index, content, token_count)
      VALUES (?, ?, ?, ?)
    `, documentId, page.index, page.text, page.tokenCount)
  }
}

function loadTreeFromSQL(sql: SQLExecutor, documentId: string): TreeNode[] {
  const rows = sql.exec(`
    SELECT * FROM nodes WHERE document_id = ? ORDER BY depth, position
  `, documentId).toArray()
  
  if (rows.length === 0) return []
  
  // Build tree from flat rows
  const nodeMap = new Map<string, TreeNode>()
  const roots: TreeNode[] = []
  
  for (const row of rows) {
    const node: TreeNode = {
      nodeId: row.node_id as string,
      title: row.title as string,
      summary: row.summary as string | undefined,
      startIndex: row.start_index as number,
      endIndex: row.end_index as number,
      nodes: [],
    }
    nodeMap.set(node.nodeId, node)
    
    if (row.parent_id) {
      const parent = nodeMap.get(row.parent_id as string)
      if (parent) {
        parent.nodes = parent.nodes ?? []
        parent.nodes.push(node)
      }
    } else {
      roots.push(node)
    }
  }
  
  return roots
}

function loadContentFromSQL(sql: SQLExecutor, documentId: string, startIndex: number, endIndex: number): string {
  const rows = sql.exec(`
    SELECT content FROM pages 
    WHERE document_id = ? AND page_index >= ? AND page_index <= ?
    ORDER BY page_index
  `, documentId, startIndex, endIndex).toArray()
  
  return rows.map(r => r.content as string).join('\n\n')
}

function loadSummaryFromSQL(sql: SQLExecutor, documentId: string): DocumentSummary | null {
  const docRow = sql.exec('SELECT * FROM documents WHERE id = ?', documentId).one()
  if (!docRow) return null
  
  const topNodes = sql.exec(`
    SELECT node_id, title, summary FROM nodes 
    WHERE document_id = ? AND depth = 0 
    ORDER BY position
  `, documentId).toArray()
  
  return {
    id: docRow.id as string,
    name: docRow.name as string,
    type: docRow.type as string,
    description: docRow.description as string | undefined,
    pageCount: docRow.page_count as number,
    tokenCount: docRow.token_count as number,
    topLevelNodes: topNodes.map(n => ({
      nodeId: n.node_id as string,
      title: n.title as string,
      summary: n.summary as string | undefined,
    })),
  }
}

// Reference extraction and following are implemented in Steps 4-6
async function extractAndStoreReferences(
  sql: SQLExecutor,
  documentId: string,
  llm: LLMClient,
  batchSize: number
): Promise<number> {
  // Implementation in Step 4
  return 0  // Placeholder
}

async function expandWithReferences(
  sql: SQLExecutor,
  documentId: string,
  initialResults: SearchResult[],
  query: string,
  llm: LLMClient,
  maxDepth: number
): Promise<ExtendedSearchResult[]> {
  // Implementation in Step 6
  return initialResults.map(r => ({ ...r, referenceDepth: 0 }))  // Placeholder
}
```

### FILE: `src/document/index.ts`

```typescript
export { createDocumentIndex } from './document-index.js'
export type {
  DocumentIndex,
  DocumentIndexConfig,
  DocumentSummary,
  IndexResult,
  ExtendedSearchResult,
  SQLExecutor,
  SQLCursor,
} from './types.js'
```

---

## Step 3: Implement SQL Storage Driver

### WHY
The SQLExecutor interface must work with both:
- `bun:sqlite` Database (for Node/Bun)
- DO's `ctx.storage.sql` (for Cloudflare Workers)

### WHAT TO DO

Create adapter functions to normalize the APIs.

### FILE: `src/storage/sql-adapter.ts`

```typescript
import type { SQLExecutor, SQLCursor } from '../document/types.js'

/**
 * Create SQLExecutor from bun:sqlite Database
 */
export function createBunSQLiteExecutor(db: import('bun:sqlite').Database): SQLExecutor {
  return {
    exec(query: string, ...bindings: unknown[]): SQLCursor {
      const stmt = db.prepare(query)
      
      return {
        one(): Record<string, unknown> | null {
          return stmt.get(...bindings) as Record<string, unknown> | null
        },
        toArray(): Record<string, unknown>[] {
          return stmt.all(...bindings) as Record<string, unknown>[]
        },
        run(...args: unknown[]): void {
          stmt.run(...(args.length > 0 ? args : bindings))
        },
      }
    },
  }
}

/**
 * Create SQLExecutor from Cloudflare DO's ctx.storage.sql
 * 
 * DO's sql.exec() returns a cursor with .toArray(), .one(), .raw()
 */
export function createDOSQLiteExecutor(sql: DurableObjectStorage['sql']): SQLExecutor {
  return {
    exec(query: string, ...bindings: unknown[]): SQLCursor {
      const cursor = sql.exec(query, ...bindings)
      
      return {
        one(): Record<string, unknown> | null {
          const arr = cursor.toArray()
          return arr.length > 0 ? arr[0] : null
        },
        toArray(): Record<string, unknown>[] {
          return cursor.toArray()
        },
        run(): void {
          // DO's exec already runs the query
          cursor.toArray()  // Consume cursor
        },
      }
    },
  }
}
```

### USAGE EXAMPLES

```typescript
// With bun:sqlite
import { Database } from 'bun:sqlite'
import { createBunSQLiteExecutor } from 'pageindex/storage'
import { createDocumentIndex } from 'pageindex'

const db = new Database(':memory:')
const docIndex = createDocumentIndex({
  model: openai('gpt-4o'),
  sql: createBunSQLiteExecutor(db),
})

// With Cloudflare DO
import { createDOSQLiteExecutor } from 'pageindex/storage'
import { createDocumentIndex } from 'pageindex'

class DocumentDO extends DurableObject {
  private docIndex = createDocumentIndex({
    model: openai('gpt-4o'),
    sql: createDOSQLiteExecutor(this.ctx.storage.sql),
    documentId: this.ctx.id.toString(),
  })
}
```

---

## Step 4: Implement Reference Following

### WHY
Documents contain cross-references like "see Appendix G" that should be explicitly followed during search.

### WHAT TO DO

1. Extract references from node content using LLM
2. Resolve reference hints to actual node IDs
3. Store as edges in `node_references` table

### FILE: `src/document/reference-extraction.ts`

```typescript
import type { SQLExecutor } from './types.js'
import { LLMClient } from '../llm/client.js'
import { z } from 'zod'

// ============================================================
// TYPES
// ============================================================

interface RawReference {
  nodeId: string
  referenceText: string      // "see Appendix G"
  targetHint: string         // "Appendix G"
  targetType: 'section' | 'table' | 'figure' | 'appendix' | 'page' | 'unknown'
}

const ReferenceExtractionSchema = z.object({
  references: z.array(z.object({
    referenceText: z.string().describe('Exact text of the reference'),
    targetHint: z.string().describe('What is being referenced'),
    targetType: z.enum(['section', 'table', 'figure', 'appendix', 'page', 'unknown']),
  })),
})

// ============================================================
// MAIN FUNCTION
// ============================================================

/**
 * Extract references from all nodes and store in node_references table
 * 
 * @returns Number of references extracted
 */
export async function extractAndStoreReferences(
  sql: SQLExecutor,
  documentId: string,
  llm: LLMClient,
  batchSize: number = 10
): Promise<number> {
  // Step 1: Get all nodes with their content
  const nodesWithContent = sql.exec(`
    SELECT 
      n.node_id,
      n.title,
      GROUP_CONCAT(p.content, '\n\n') as content
    FROM nodes n
    LEFT JOIN pages p 
      ON p.document_id = n.document_id
      AND p.page_index BETWEEN n.start_index AND n.end_index
    WHERE n.document_id = ?
    GROUP BY n.node_id
  `, documentId).toArray()
  
  // Step 2: Extract references from each node (batched)
  const allRawRefs: RawReference[] = []
  
  for (let i = 0; i < nodesWithContent.length; i += batchSize) {
    const batch = nodesWithContent.slice(i, i + batchSize)
    
    const batchResults = await Promise.all(
      batch.map(node => extractReferencesFromNode(
        llm,
        node.node_id as string,
        node.content as string
      ))
    )
    
    allRawRefs.push(...batchResults.flat())
  }
  
  if (allRawRefs.length === 0) return 0
  
  // Step 3: Get all node titles for matching
  const allNodes = sql.exec(`
    SELECT node_id, title, summary FROM nodes WHERE document_id = ?
  `, documentId).toArray()
  
  // Step 4: Resolve and store references
  let storedCount = 0
  
  for (const ref of allRawRefs) {
    const resolved = await resolveReference(llm, ref, allNodes)
    
    if (resolved && resolved.targetNodeId !== ref.nodeId) {
      sql.exec(`
        INSERT OR IGNORE INTO node_references 
          (source_node_id, target_node_id, reference_text, reference_type, confidence)
        VALUES (?, ?, ?, ?, ?)
      `, ref.nodeId, resolved.targetNodeId, ref.referenceText, ref.targetType, resolved.confidence)
      storedCount++
    }
  }
  
  return storedCount
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

const EXTRACTION_PROMPT = `Extract all cross-references from this document section.

Look for phrases that point to other parts of the document:
- "see [Section/Appendix/Chapter] X"
- "refer to [Table/Figure] X"  
- "as shown/described/detailed in X"
- "per [Section] X"
- "(see page X)"

Only extract EXPLICIT references, not general mentions.
Return an empty array if no references found.`

async function extractReferencesFromNode(
  llm: LLMClient,
  nodeId: string,
  content: string | null
): Promise<RawReference[]> {
  if (!content || content.length < 50) return []
  
  try {
    const result = await llm.generateJSON(
      EXTRACTION_PROMPT + `\n\nContent:\n${content.slice(0, 4000)}`,
      ReferenceExtractionSchema
    )
    
    return result.references.map(r => ({
      nodeId,
      referenceText: r.referenceText,
      targetHint: r.targetHint,
      targetType: r.targetType,
    }))
  } catch {
    return []
  }
}

const MatchSchema = z.object({
  nodeId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
})

async function resolveReference(
  llm: LLMClient,
  ref: RawReference,
  allNodes: Record<string, unknown>[]
): Promise<{ targetNodeId: string; confidence: number } | null> {
  // Step 1: Try exact title match
  const exactMatch = allNodes.find(n => 
    (n.title as string).toLowerCase().includes(ref.targetHint.toLowerCase())
  )
  
  if (exactMatch) {
    return {
      targetNodeId: exactMatch.node_id as string,
      confidence: 1.0,
    }
  }
  
  // Step 2: Use LLM for fuzzy matching
  const nodeList = allNodes
    .slice(0, 50)  // Limit to prevent token overflow
    .map(n => `[${n.node_id}] ${n.title}`)
    .join('\n')
  
  try {
    const match = await llm.generateJSON(
      `Find the node that best matches this reference.
Return { nodeId: null, confidence: 0 } if no good match exists.

Reference: "${ref.targetHint}"

Available nodes:
${nodeList}`,
      MatchSchema
    )
    
    if (match.nodeId && match.confidence > 0.6) {
      return {
        targetNodeId: match.nodeId,
        confidence: match.confidence,
      }
    }
  } catch {
    // Ignore LLM errors
  }
  
  return null
}
```

---

## Step 5: Update Indexing Pipeline

### WHY
The `index()` method needs to call reference extraction after storing nodes.

### WHAT TO DO

Update `document-index.ts` to use the real `extractAndStoreReferences` function.

### CODE CHANGE in `src/document/document-index.ts`

Replace the placeholder import and function:

```typescript
// Add import at top
import { extractAndStoreReferences } from './reference-extraction.js'

// The function is now imported, remove the placeholder
```

---

## Step 6: Update Search with References

### WHY
Search results should include nodes reached via cross-references.

### WHAT TO DO

Implement the `expandWithReferences` function using recursive CTEs.

### FILE: `src/document/reference-search.ts`

```typescript
import type { SQLExecutor, ExtendedSearchResult } from './types.js'
import type { SearchResult, TreeNode } from '../types/tree.js'
import { LLMClient } from '../llm/client.js'

/**
 * Expand search results by following references
 * 
 * Uses recursive CTE to traverse the reference graph
 */
export async function expandWithReferences(
  sql: SQLExecutor,
  documentId: string,
  initialResults: SearchResult[],
  query: string,
  llm: LLMClient,
  maxDepth: number = 2
): Promise<ExtendedSearchResult[]> {
  if (initialResults.length === 0) return []
  
  const initialNodeIds = initialResults.map(r => r.node.nodeId)
  
  // Build placeholder string for SQL IN clause
  const placeholders = initialNodeIds.map(() => '?').join(',')
  
  // Recursive CTE to find all referenced nodes
  const expandedRows = sql.exec(`
    WITH RECURSIVE reference_chain AS (
      -- Base case: initial search result nodes
      SELECT 
        node_id,
        node_id as origin_node_id,
        0 as depth
      FROM nodes
      WHERE node_id IN (${placeholders})
        AND document_id = ?
      
      UNION ALL
      
      -- Recursive case: follow outgoing references
      SELECT 
        r.target_node_id,
        rc.origin_node_id,
        rc.depth + 1
      FROM reference_chain rc
      JOIN node_references r ON r.source_node_id = rc.node_id
      JOIN nodes n ON n.node_id = r.target_node_id
      WHERE rc.depth < ?
        AND n.document_id = ?
    )
    SELECT DISTINCT
      n.node_id,
      n.title,
      n.summary,
      n.start_index,
      n.end_index,
      MIN(rc.depth) as reference_depth,
      rc.origin_node_id,
      GROUP_CONCAT(DISTINCT r.reference_text) as via_references
    FROM reference_chain rc
    JOIN nodes n ON n.node_id = rc.node_id
    LEFT JOIN node_references r 
      ON r.target_node_id = n.node_id
      AND r.source_node_id IN (${placeholders})
    GROUP BY n.node_id
    ORDER BY reference_depth, n.node_id
  `, ...initialNodeIds, documentId, maxDepth, documentId, ...initialNodeIds).toArray()
  
  // Build results
  const results: ExtendedSearchResult[] = []
  const initialResultMap = new Map(initialResults.map(r => [r.node.nodeId, r]))
  
  for (const row of expandedRows) {
    const nodeId = row.node_id as string
    const depth = row.reference_depth as number
    
    // Check if this was an initial result
    const existingResult = initialResultMap.get(nodeId)
    
    if (existingResult) {
      // Direct match - use existing score
      results.push({
        ...existingResult,
        referenceDepth: 0,
      })
    } else {
      // Referenced node - calculate decayed score
      const node: TreeNode = {
        nodeId,
        title: row.title as string,
        summary: row.summary as string | undefined,
        startIndex: row.start_index as number,
        endIndex: row.end_index as number,
      }
      
      // Find the origin result to get base score
      const originResult = initialResultMap.get(row.origin_node_id as string)
      const baseScore = originResult?.score ?? 0.5
      
      // Apply decay: 0.9^depth
      const decayedScore = baseScore * Math.pow(0.9, depth)
      
      results.push({
        node,
        score: decayedScore,
        path: [row.origin_node_id as string, nodeId],
        reasoning: `Referenced via: ${row.via_references ?? 'cross-reference'}`,
        referenceDepth: depth,
        referencePath: row.via_references ? [{
          fromNodeId: row.origin_node_id as string,
          toNodeId: nodeId,
          referenceText: row.via_references as string,
        }] : undefined,
      })
    }
  }
  
  // Sort by score (highest first)
  return results.sort((a, b) => b.score - a.score)
}
```

### Update `document-index.ts`

```typescript
// Add import at top
import { expandWithReferences } from './reference-search.js'

// The function is now imported, remove the placeholder
```

---

## Appendix: DO Implementation Example

This is how users would implement a DO-based architecture using the library.

### FILE: `examples/cloudflare-do/document-do.ts`

```typescript
import { DurableObject } from 'cloudflare:workers'
import { createDocumentIndex, createDOSQLiteExecutor, type DocumentIndex } from 'pageindex'
import { openai } from '@ai-sdk/openai'

interface Env {
  OPENAI_API_KEY: string
}

export class DocumentDO extends DurableObject<Env> {
  private docIndex: DocumentIndex | null = null
  
  private getDocIndex(): DocumentIndex {
    if (!this.docIndex) {
      this.docIndex = createDocumentIndex({
        model: openai('gpt-4o', { apiKey: this.env.OPENAI_API_KEY }),
        sql: createDOSQLiteExecutor(this.ctx.storage.sql),
        documentId: this.ctx.id.toString(),
        processing: {
          extractReferences: true,
        },
        search: {
          followReferences: true,
          maxReferenceDepth: 2,
        },
      })
    }
    return this.docIndex
  }
  
  async index(document: DocumentInput) {
    return this.getDocIndex().index(document)
  }
  
  async search(query: string, options?: SearchOptions) {
    return this.getDocIndex().search(query, options)
  }
  
  async getSummary() {
    return this.getDocIndex().getSummary()
  }
  
  async getContent(startIndex: number, endIndex: number) {
    return this.getDocIndex().getContent(startIndex, endIndex)
  }
  
  async clear() {
    return this.getDocIndex().clear()
  }
}
```

### FILE: `examples/cloudflare-do/orchestrator-do.ts`

```typescript
import { DurableObject } from 'cloudflare:workers'
import type { DocumentDO } from './document-do'

interface Env {
  DOCUMENT_DO: DurableObjectNamespace<DocumentDO>
  OPENAI_API_KEY: string
}

/**
 * Orchestrator DO - manages the global document index in its own SQLite
 * 
 * Architecture:
 *   Worker + Hono → OrchestratorDO (SQLite) → DocumentDO[] (each with SQLite)
 */
export class OrchestratorDO extends DurableObject<Env> {
  private sql = this.ctx.storage.sql
  private initialized = false
  
  private ensureSchema(): void {
    if (this.initialized) return
    
    this.sql.exec(`
      -- Global document index (stored in Orchestrator's SQLite)
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        collection TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT,
        page_count INTEGER,
        token_count INTEGER,
        summary TEXT,              -- JSON with top-level nodes
        created_at INTEGER NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_docs_collection 
        ON documents(collection, created_at DESC);
      
      CREATE TABLE IF NOT EXISTS collections (
        name TEXT PRIMARY KEY,
        document_count INTEGER DEFAULT 0,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
    
    this.initialized = true
  }
  
  // ─────────────────────────────────────────────────────────────
  // Document Management
  // ─────────────────────────────────────────────────────────────
  
  async indexDocument(
    document: { name: string; type: string; content: string | Uint8Array },
    collection: string = 'default'
  ): Promise<{ id: string; stats: any }> {
    this.ensureSchema()
    
    // Create new Document DO
    const doId = this.env.DOCUMENT_DO.newUniqueId()
    const stub = this.env.DOCUMENT_DO.get(doId)
    
    // Index document in the DO
    const result = await stub.index(document)
    
    // Get summary for global index
    const summary = await stub.getSummary()
    
    // Store in Orchestrator's SQLite
    this.sql.exec(`
      INSERT INTO documents (id, collection, name, type, description, page_count, token_count, summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, 
      doId.toString(),
      collection,
      document.name,
      document.type,
      summary?.description ?? null,
      summary?.pageCount ?? 0,
      summary?.tokenCount ?? 0,
      JSON.stringify(summary),
      Date.now()
    )
    
    // Update collection count
    this.sql.exec(`
      INSERT INTO collections (name, document_count, created_at, updated_at)
      VALUES (?, 1, ?, ?)
      ON CONFLICT(name) DO UPDATE SET 
        document_count = document_count + 1,
        updated_at = excluded.updated_at
    `, collection, Date.now(), Date.now())
    
    return { id: doId.toString(), stats: result.stats }
  }
  
  async listDocuments(options: {
    collection?: string
    limit?: number
    cursor?: string
  } = {}): Promise<{ documents: any[]; nextCursor?: string }> {
    this.ensureSchema()
    
    const collection = options.collection ?? 'default'
    const limit = options.limit ?? 50
    
    let query = `
      SELECT id, name, type, page_count, token_count, created_at
      FROM documents
      WHERE collection = ?
    `
    const params: any[] = [collection]
    
    if (options.cursor) {
      query += ` AND created_at < ?`
      params.push(parseInt(options.cursor))
    }
    
    query += ` ORDER BY created_at DESC LIMIT ?`
    params.push(limit + 1)
    
    const rows = this.sql.exec(query, ...params).toArray()
    const hasMore = rows.length > limit
    const documents = rows.slice(0, limit)
    
    return {
      documents,
      nextCursor: hasMore ? String(documents[documents.length - 1]?.created_at) : undefined,
    }
  }
  
  async deleteDocument(id: string): Promise<void> {
    this.ensureSchema()
    
    // Get collection before delete
    const doc = this.sql.exec('SELECT collection FROM documents WHERE id = ?', id).one()
    
    // Delete from Document DO
    const stub = this.env.DOCUMENT_DO.get(this.env.DOCUMENT_DO.idFromString(id))
    await stub.clear()
    
    // Delete from global index
    this.sql.exec('DELETE FROM documents WHERE id = ?', id)
    
    // Update collection count
    if (doc) {
      this.sql.exec(`
        UPDATE collections SET document_count = document_count - 1, updated_at = ?
        WHERE name = ?
      `, Date.now(), doc.collection)
    }
  }
  
  // ─────────────────────────────────────────────────────────────
  // Search
  // ─────────────────────────────────────────────────────────────
  
  async search(
    query: string,
    options: {
      collection?: string
      maxDocuments?: number
      maxResults?: number
    } = {}
  ): Promise<any[]> {
    this.ensureSchema()
    
    const collection = options.collection ?? 'default'
    const maxDocuments = options.maxDocuments ?? 20
    const maxResults = options.maxResults ?? 10
    
    // Phase 1: Select documents from Orchestrator's SQLite
    const docs = this.sql.exec(`
      SELECT id, name FROM documents
      WHERE collection = ?
      ORDER BY created_at DESC
      LIMIT ?
    `, collection, maxDocuments).toArray()
    
    if (docs.length === 0) {
      return []
    }
    
    // Phase 2: Fan out to Document DOs in parallel
    const allResults = await Promise.all(
      docs.map(async (row) => {
        try {
          const stub = this.env.DOCUMENT_DO.get(
            this.env.DOCUMENT_DO.idFromString(row.id as string)
          )
          const results = await stub.search(query)
          
          // Tag results with document info
          return results.map((r: any) => ({
            ...r,
            documentId: row.id,
            documentName: row.name,
          }))
        } catch (error) {
          console.error(`Search failed for ${row.id}:`, error)
          return []
        }
      })
    )
    
    // Phase 3: Merge and rank
    return allResults
      .flat()
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
  }
  
  async searchDocument(id: string, query: string): Promise<any[]> {
    const stub = this.env.DOCUMENT_DO.get(this.env.DOCUMENT_DO.idFromString(id))
    return stub.search(query)
  }
}
```

### FILE: `examples/cloudflare-do/worker.ts`

```typescript
import { Hono } from 'hono'
import type { OrchestratorDO } from './orchestrator-do'
import type { DocumentDO } from './document-do'

// Export DO classes for Cloudflare
export { OrchestratorDO } from './orchestrator-do'
export { DocumentDO } from './document-do'

interface Env {
  ORCHESTRATOR_DO: DurableObjectNamespace<OrchestratorDO>
  DOCUMENT_DO: DurableObjectNamespace<DocumentDO>
  OPENAI_API_KEY: string
}

const app = new Hono<{ Bindings: Env }>()

// Get the singleton orchestrator
function getOrchestrator(env: Env) {
  // Use a fixed ID for the single orchestrator instance
  const id = env.ORCHESTRATOR_DO.idFromName('main')
  return env.ORCHESTRATOR_DO.get(id)
}

// ─────────────────────────────────────────────────────────────
// Document Management Routes
// ─────────────────────────────────────────────────────────────

app.post('/documents', async (c) => {
  const body = await c.req.json()
  const orchestrator = getOrchestrator(c.env)
  
  const result = await orchestrator.indexDocument(
    {
      name: body.name,
      type: body.type,
      content: body.type === 'pdf'
        ? Uint8Array.from(atob(body.content), ch => ch.charCodeAt(0))
        : body.content,
    },
    body.collection ?? 'default'
  )
  
  return c.json(result, 201)
})

app.get('/documents', async (c) => {
  const orchestrator = getOrchestrator(c.env)
  
  const result = await orchestrator.listDocuments({
    collection: c.req.query('collection'),
    limit: c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined,
    cursor: c.req.query('cursor'),
  })
  
  return c.json(result)
})

app.delete('/documents/:id', async (c) => {
  const orchestrator = getOrchestrator(c.env)
  await orchestrator.deleteDocument(c.req.param('id'))
  return c.json({ success: true })
})

// ─────────────────────────────────────────────────────────────
// Search Routes
// ─────────────────────────────────────────────────────────────

app.post('/search', async (c) => {
  const body = await c.req.json()
  const orchestrator = getOrchestrator(c.env)
  
  const results = await orchestrator.search(body.query, {
    collection: body.collection,
    maxDocuments: body.maxDocuments,
    maxResults: body.maxResults,
  })
  
  return c.json({ results })
})

app.post('/documents/:id/search', async (c) => {
  const body = await c.req.json()
  const orchestrator = getOrchestrator(c.env)
  
  const results = await orchestrator.searchDocument(c.req.param('id'), body.query)
  return c.json({ results })
})

export default app
```

### FILE: `examples/cloudflare-do/wrangler.toml`

```toml
name = "pageindex-service"
main = "worker.ts"
compatibility_date = "2024-12-01"

[vars]
# OPENAI_API_KEY set via: wrangler secret put OPENAI_API_KEY

# Orchestrator DO (singleton with global document index)
[[durable_objects.bindings]]
name = "ORCHESTRATOR_DO"
class_name = "OrchestratorDO"

# Document DOs (one per document)
[[durable_objects.bindings]]
name = "DOCUMENT_DO"
class_name = "DocumentDO"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["OrchestratorDO", "DocumentDO"]
```

---

## Summary: Implementation Checklist

### Files to Create

| File | Purpose |
|------|---------|
| `src/primitives/index.ts` | Re-export Layer 1 components |
| `src/document/types.ts` | DocumentIndex interfaces |
| `src/document/document-index.ts` | createDocumentIndex() implementation |
| `src/document/index.ts` | Export document module |
| `src/document/reference-extraction.ts` | Reference extraction logic |
| `src/document/reference-search.ts` | Reference-aware search |
| `src/storage/sql-adapter.ts` | SQLExecutor adapters |

### Files to Modify

| File | Change |
|------|--------|
| `src/index.ts` | Add new exports |
| `src/core.ts` | Remove (replaced by document-index.ts) |

### Export Structure

```typescript
// src/index.ts
export { createDocumentIndex } from './document/index.js'
export type { DocumentIndex, DocumentSummary, SQLExecutor } from './document/index.js'

export * from './primitives/index.js'
export * from './storage/sql-adapter.js'
export * from './types/index.js'
```

### Key Constraints

1. **SQL storage is REQUIRED** for reference following
2. **Single-document focus** in library, multi-doc is user's concern
3. **DO compatibility** via SQLExecutor interface

### Performance Expectations

| Document Size | Index Time | Reference Extraction | Search Time |
|---------------|------------|---------------------|-------------|
| 10 pages | 5s | +5s | <1s |
| 100 pages | 30s | +30s | <1s |
| 500 pages | 2min | +2min | <1s |

Reference following adds ~50% to index time but <10ms to search time (recursive CTEs are fast).

---

## Post-Implementation Tasks

### Task: Update README.md

After implementing the architecture, update the README to reflect the new API:

**Changes needed:**

1. **Replace `createPageIndex()` examples** with `createDocumentIndex()`
2. **Update Quick Start** to show single-document usage (simplest path)
3. **Add "Scaling" section** explaining when to use orchestration
4. **Update API Reference** with new interfaces:
   - `DocumentIndexConfig`
   - `DocumentIndex`
   - `SQLExecutor`
5. **Add examples:**
   - Single-document (local SQLite)
   - Single-document in Cloudflare DO
   - Multi-document with Orchestrator DO
6. **Update installation** if package exports change
7. **Remove any references** to the old multi-document `PageIndex` interface

**New README structure suggestion:**

```markdown
# PageIndex

## Quick Start (Single Document)
- Minimal example with createDocumentIndex()

## Installation

## Usage
### Single Document (Simplest)
### Multiple Documents (Local)
### Scaling to Millions (Cloudflare DO)

## Configuration
### Models
### Processing Options
### Search Options

## API Reference
### createDocumentIndex()
### DocumentIndex interface
### SQLExecutor interface

## Architecture
- Link to ARCHITECTURE.md for details

## Examples
- examples/single-document/
- examples/cloudflare-do/
```
