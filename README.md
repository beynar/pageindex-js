# PageIndex

A reasoning-based RAG (Retrieval-Augmented Generation) library that uses hierarchical tree indexing instead of vector databases. PageIndex enables LLMs to navigate documents through reasoning, mimicking how human experts find information in complex documents.

## Why PageIndex?

Traditional RAG systems rely on vector similarity search, which often fails for professional documents requiring domain expertise. **Similarity ≠ Relevance**.

PageIndex takes a different approach:

1. **Build a hierarchical tree** - Transform documents into a structured "table of contents"
2. **Reason through the tree** - Use LLM reasoning to navigate to relevant sections
3. **Retrieve with context** - Return content with full structural awareness

This mirrors how experts work: understand the document structure first, then reason about where specific information is located.

## Installation

```bash
bun add pageindex
# or
npm install pageindex
```

You'll also need an AI SDK provider:

```bash
bun add @ai-sdk/openai
# or @ai-sdk/anthropic, @ai-sdk/google, etc.
```

## Quick Start

```typescript
import { createPageIndex, createMemoryStorage } from 'pageindex'
import { openai } from '@ai-sdk/openai'

// Create a PageIndex instance
const pageIndex = createPageIndex({
  model: openai('gpt-4o'),
  storage: createMemoryStorage(),
})

// Index a markdown document
const { document } = await pageIndex.index({
  name: 'technical-spec',
  type: 'markdown',
  content: markdownContent,
})

// Search using LLM reasoning
const results = await pageIndex.search('How does authentication work?')

// Retrieve content with context
const { context } = await pageIndex.retrieve('What are the API rate limits?')
console.log(context) // Assembled content from relevant sections
```

## Features

### Document Processing

- **Markdown** - Parses headers to build hierarchical structure
- **PDF** - Extracts text and detects table of contents using LLM

### Tree Building

- Automatic TOC detection and parsing
- LLM-based section extraction for documents without TOC
- Configurable node splitting by page count and token limits
- Optional tree thinning to merge small sections

### Search & Retrieval

- LLM-based tree navigation with reasoning
- Multi-hop reasoning for complex queries
- Relevance scoring with explanations
- Content assembly from multiple nodes

### Storage Backends

- **Memory** - In-memory storage for development
- **SQLite** - Local file or in-memory database (bun:sqlite)
- **Cloudflare KV** - For Cloudflare Workers
- **Cloudflare D1** - SQLite-based database for Cloudflare Workers
- **Redis** - Compatible with Redis, Upstash, etc.

## Configuration

### Full Configuration Options

```typescript
import { createPageIndex } from 'pageindex'
import { openai } from '@ai-sdk/openai'
import { createMemoryStorage } from 'pageindex'

const pageIndex = createPageIndex({
  // Required: LLM model from Vercel AI SDK
  model: openai('gpt-4o'),

  // Required: Storage driver
  storage: createMemoryStorage(),

  // Optional: Processing options
  processing: {
    // PDF: Number of pages to scan for TOC detection
    tocCheckPages: 20,

    // Maximum tokens per tree node
    maxTokensPerNode: 20000,

    // Add unique IDs to nodes (0000, 0001, etc.)
    addNodeId: true,

    // Generate AI summaries for each node
    addNodeSummary: true,

    // Generate document-level description
    addDocDescription: false,

    // Minimum tokens to generate a summary
    summaryTokenThreshold: 200,

    // Markdown: Merge small sections
    enableTreeThinning: false,
    thinningThreshold: 5000,

    // Content storage strategy
    // 'inline' - Store text in tree nodes
    // 'separate' - Store text separately (better for large docs)
    // 'auto' - Choose based on document size
    contentStorage: 'auto',

    // Page threshold for auto mode
    autoStoragePageThreshold: 50,
  },

  // Optional: Default search options
  search: {
    maxResults: 5,
    minScore: 0.5,
    includeContent: true,
    maxDepth: Infinity,

    // Expert knowledge to guide search (e.g., domain-specific hints)
    // expertKnowledge: 'For financial queries, prioritize Item 7 MD&A',

    // Document context for better relevance
    // documentContext: 'This is a 10-K SEC filing',
  },

  // Enable debug logging
  debug: false,
})
```

### Storage Drivers

#### Memory Storage (Development)

```typescript
import { createMemoryStorage } from 'pageindex'

const storage = createMemoryStorage()
```

#### SQLite Storage (Local/Testing)

```typescript
import { createSQLiteStorage } from 'pageindex'

// In-memory database (for testing)
const storage = createSQLiteStorage(':memory:')
storage.initialize()

// File-based database (persistent)
const storage = createSQLiteStorage('./data/pageindex.db')
storage.initialize()

// Don't forget to close when done
storage.close()
```

#### Cloudflare KV

```typescript
import { createKVStorage } from 'pageindex'

// In a Cloudflare Worker
export default {
  async fetch(request, env) {
    const storage = createKVStorage(env.MY_KV_NAMESPACE)
    // ...
  }
}
```

#### Redis / Upstash

```typescript
import { createRedisStorage } from 'pageindex'
import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.UPSTASH_URL,
  token: process.env.UPSTASH_TOKEN,
})

const storage = createRedisStorage(redis, 'pageindex:') // optional prefix
```

#### Cloudflare D1

```typescript
import { createD1Storage } from 'pageindex'

// In a Cloudflare Worker
export default {
  async fetch(request, env) {
    const storage = createD1Storage(env.DB) // D1 binding

    // Initialize table (call once, e.g., in a setup script)
    await storage.initialize()

    // Use with PageIndex
    const pageIndex = createPageIndex({
      model: openai('gpt-4o'),
      storage,
    })
  }
}
```

## API Reference

### `createPageIndex(config)`

Creates a PageIndex instance with the specified configuration.

### PageIndex Methods

#### `index(document)`

Index a document and store its tree structure.

```typescript
const result = await pageIndex.index({
  name: 'my-document',
  type: 'markdown', // or 'pdf'
  content: '# Title\n\n## Section...',
  metadata: { author: 'John' }, // optional
})

// Result includes:
// - document: IndexedDocument
// - stats: { pageCount, tokenCount, nodeCount, durationMs }
```

#### `search(query, options?)`

Search indexed documents using LLM reasoning.

```typescript
const results = await pageIndex.search('How do I configure X?', {
  maxResults: 5,
  minScore: 0.5,
  documentIds: ['doc-id'], // optional: limit to specific docs

  // Domain expertise to guide the search
  expertKnowledge: 'Configuration is typically in Section 3 or Appendix A',

  // Context about the document being searched
  documentContext: 'Technical specification document',
})

// Each result includes:
// - node: TreeNode
// - score: number (0-1)
// - path: string[] (path from root)
// - reasoning: string (why this node is relevant)
```

#### `retrieve(query, options?)`

Search and retrieve content from matching nodes.

```typescript
const { results, context } = await pageIndex.retrieve('Explain feature Y')

// context: Assembled text from all relevant sections
// results: Same as search()
```

#### `getDocument(id)`

Get an indexed document by ID.

```typescript
const doc = await pageIndex.getDocument('doc-id')
```

#### `getTree(id)`

Get the tree structure for a document.

```typescript
const tree = await pageIndex.getTree('doc-id')
```

#### `deleteDocument(id)`

Delete an indexed document and its content.

```typescript
await pageIndex.deleteDocument('doc-id')
```

#### `listDocuments()`

List all indexed documents.

```typescript
const docs = await pageIndex.listDocuments()
```

## Tree Structure

Documents are converted to a hierarchical tree:

```typescript
interface TreeNode {
  title: string           // Section title
  nodeId: string          // Unique ID (e.g., "0001")
  startIndex: number      // Start page/line
  endIndex: number        // End page/line
  summary?: string        // AI-generated summary
  text?: string           // Full content (if inline storage)
  nodes?: TreeNode[]      // Child sections
}
```

## Utilities

### Tree Navigation

```typescript
import {
  getAllNodes,
  getLeafNodes,
  findNodeById,
  getNodePath,
  traverseTree,
} from 'pageindex'

// Get all nodes flattened
const allNodes = getAllNodes(tree)

// Get only leaf nodes (no children)
const leaves = getLeafNodes(tree)

// Find a specific node
const node = findNodeById(tree, '0005')

// Get path from root to node
const path = getNodePath(tree, '0005') // ['0000', '0002', '0005']

// Custom traversal
traverseTree(tree, (node, depth, path) => {
  console.log(`${'  '.repeat(depth)}${node.title}`)
})
```

### Token Counting

```typescript
import { countTokens, truncateToTokens, splitIntoChunks } from 'pageindex'

// Count tokens in text
const tokens = countTokens('Hello, world!')

// Truncate to fit token limit
const truncated = truncateToTokens(longText, 1000)

// Split into chunks
const chunks = splitIntoChunks(veryLongText, 4000)
```

## Custom Storage Driver

Implement the `StorageDriver` interface for custom backends:

```typescript
import type { StorageDriver, StoredItem, ListQuery } from 'pageindex'

class MyStorage implements StorageDriver {
  async get(key: string): Promise<StoredItem | null> { ... }
  async set(key: string, value: StoredItem): Promise<void> { ... }
  async delete(key: string): Promise<boolean> { ... }
  async list(query?: ListQuery): Promise<string[]> { ... }
  async exists(key: string): Promise<boolean> { ... }
  async getMany(keys: string[]): Promise<Map<string, StoredItem | null>> { ... }
  async setMany(items: Map<string, StoredItem>): Promise<void> { ... }
  async deleteMany(keys: string[]): Promise<number> { ... }
}
```

Key format conventions:
- Documents: `doc:{documentId}`
- Content: `content:{documentId}:{pageIndex}`
- Metadata: `meta:{key}`

## Environment Compatibility

PageIndex is designed to work in various JavaScript environments:

- **Node.js** - Full support including PDF processing
- **Bun** - Full support
- **Cloudflare Workers** - Full support (use KV storage)
- **Edge runtimes** - Supported with appropriate storage driver

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Type check
bun run typecheck

# Build
bun run build
```

## License

MIT

## Credits

This is a TypeScript port of [PageIndex](https://github.com/EvidenceRAG/PageIndex), originally implemented in Python.
