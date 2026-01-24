/**
 * Integration tests with real SQLite storage
 *
 * To run with actual LLM:
 *   CEREBRAS_API_KEY=... bun test tests/integration.test.ts
 *   OPENAI_API_KEY=sk-... bun test tests/integration.test.ts
 *   ANTHROPIC_API_KEY=sk-... bun test tests/integration.test.ts
 *
 * Without API key, LLM-dependent tests will be skipped
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { createPageIndex } from '../src/core'
import { createSQLiteStorage } from '../src/storage/sqlite'
import { createMemoryStorage } from '../src/storage/memory'
import type { PageIndex } from '../src/core'
import type { StorageDriver } from '../src/storage/driver'

// Check if we have an API key for real LLM testing
const hasCerebrasKey = !!process.env.CEREBRAS_API_KEY
const hasOpenAIKey = !!process.env.OPENAI_API_KEY
const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY

// Sample documents for testing
const sampleMarkdown = `# Technical Specification

This document describes the technical architecture of our system.

## Overview

The system is designed to handle high-volume data processing with low latency.
It uses a microservices architecture with event-driven communication.

### Key Components

- **API Gateway**: Handles all incoming requests and authentication
- **Processing Engine**: Core data processing logic
- **Storage Layer**: Distributed database with replication

## Authentication

Users authenticate using OAuth 2.0 with JWT tokens.

### Token Format

Tokens are signed using RS256 and contain:
- User ID
- Permissions
- Expiration timestamp

### Rate Limiting

API requests are rate-limited to:
- 100 requests per minute for free tier
- 1000 requests per minute for paid tier

## Data Processing

The processing pipeline consists of three stages.

### Stage 1: Ingestion

Raw data is received and validated against the schema.

### Stage 2: Transformation

Data is transformed and enriched with metadata.

### Stage 3: Storage

Processed data is stored in the distributed database.

## Configuration

System configuration is managed through environment variables.

### Required Variables

- \`DATABASE_URL\`: Connection string for the database
- \`API_KEY\`: Secret key for API authentication
- \`LOG_LEVEL\`: Logging verbosity (debug, info, warn, error)

### Optional Variables

- \`CACHE_TTL\`: Cache time-to-live in seconds (default: 300)
- \`MAX_CONNECTIONS\`: Maximum database connections (default: 10)

## Deployment

The system can be deployed using Docker or Kubernetes.

### Docker Deployment

Use the provided Dockerfile to build the image.

### Kubernetes Deployment

Helm charts are available in the \`/deploy\` directory.
`

const shortMarkdown = `# Simple Document

## Introduction

This is a simple test document.

## Content

Some content here for testing purposes.

## Conclusion

End of document.
`

// Minimal doc for fast LLM tests (only 3 nodes)
const minimalMarkdown = `# Test Document

## Section One

This section contains information about authentication and OAuth tokens.
Users authenticate using JWT tokens signed with RS256.
Rate limits are 100 requests per minute.

## Section Two

This section covers configuration and environment variables.
Required: DATABASE_URL, API_KEY.
Optional: CACHE_TTL, MAX_CONNECTIONS.
`

describe('SQLite Storage Integration', () => {
  let storage: SQLiteStorage

  // Import type for cleanup
  type SQLiteStorage = ReturnType<typeof createSQLiteStorage>

  beforeAll(() => {
    storage = createSQLiteStorage(':memory:')
    storage.initialize()
  })

  afterAll(() => {
    storage.close()
  })

  test('basic CRUD operations', async () => {
    // Set
    await storage.set('test:1', {
      type: 'document',
      data: { id: '1', name: 'Test' },
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // Get
    const item = await storage.get('test:1')
    expect(item).not.toBeNull()
    expect(item?.type).toBe('document')
    expect((item?.data as { name: string }).name).toBe('Test')

    // Exists
    expect(await storage.exists('test:1')).toBe(true)
    expect(await storage.exists('test:nonexistent')).toBe(false)

    // Delete
    const deleted = await storage.delete('test:1')
    expect(deleted).toBe(true)
    expect(await storage.exists('test:1')).toBe(false)
  })

  test('batch operations', async () => {
    const items = new Map()
    for (let i = 0; i < 10; i++) {
      items.set(`batch:${i}`, {
        type: 'document' as const,
        data: { index: i },
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    }

    // Set many
    await storage.setMany(items)

    // List with prefix
    const keys = await storage.list({ prefix: 'batch:' })
    expect(keys.length).toBe(10)

    // Get many
    const retrieved = await storage.getMany(keys)
    expect(retrieved.size).toBe(10)

    // Delete many
    const deletedCount = await storage.deleteMany(keys)
    expect(deletedCount).toBe(10)

    // Verify deleted
    const remaining = await storage.list({ prefix: 'batch:' })
    expect(remaining.length).toBe(0)
  })

  test('list with pagination', async () => {
    // Create test data
    for (let i = 0; i < 20; i++) {
      await storage.set(`page:${i.toString().padStart(2, '0')}`, {
        type: 'document',
        data: { index: i },
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    }

    // Test limit
    const first5 = await storage.list({ prefix: 'page:', limit: 5 })
    expect(first5.length).toBe(5)

    // Test offset
    const next5 = await storage.list({ prefix: 'page:', limit: 5, offset: 5 })
    expect(next5.length).toBe(5)
    expect(next5[0]).not.toBe(first5[0])

    // Cleanup
    const allKeys = await storage.list({ prefix: 'page:' })
    await storage.deleteMany(allKeys)
  })
})

describe('PageIndex with Memory Storage (no LLM)', () => {
  // These tests use mock model and verify the structure without actual LLM calls

  const mockModel = {
    specificationVersion: 'v1' as const,
    provider: 'mock',
    modelId: 'mock-model',
    defaultObjectGenerationMode: 'json' as const,
    doGenerate: async () => ({
      text: JSON.stringify({
        thinking: 'Test',
        summary: 'Test summary',
        description: 'Test description',
      }),
      finishReason: 'stop' as const,
      usage: { promptTokens: 0, completionTokens: 0 },
      rawCall: { rawPrompt: '', rawSettings: {} },
    }),
    doStream: async () => ({
      stream: new ReadableStream(),
      rawCall: { rawPrompt: '', rawSettings: {} },
    }),
  }

  test('indexes markdown document (structure only)', async () => {
    const storage = createMemoryStorage()
    const pageIndex = createPageIndex({
      model: mockModel,
      storage,
      processing: {
        addNodeSummary: false, // Disable LLM summaries
        addDocDescription: false,
      },
    })

    const result = await pageIndex.index({
      name: 'test-doc',
      type: 'markdown',
      content: shortMarkdown,
    })

    expect(result.document).toBeDefined()
    expect(result.document.name).toBe('test-doc')
    expect(result.document.type).toBe('markdown')
    expect(result.stats.nodeCount).toBeGreaterThan(0)
    expect(result.stats.pageCount).toBeGreaterThan(0)
  })

  test('tree structure is correct', async () => {
    const storage = createMemoryStorage()
    const pageIndex = createPageIndex({
      model: mockModel,
      storage,
      processing: {
        addNodeSummary: false,
      },
    })

    const { document } = await pageIndex.index({
      name: 'structure-test',
      type: 'markdown',
      content: shortMarkdown,
    })

    const tree = await pageIndex.getTree(document.id)
    expect(tree).not.toBeNull()
    expect(tree!.length).toBeGreaterThan(0)

    // Check root node
    const root = tree![0]
    expect(root?.title).toBe('Simple Document')
    expect(root?.nodeId).toBe('0000')
    expect(root?.nodes?.length).toBe(3) // Introduction, Content, Conclusion
  })

  test('document CRUD operations', async () => {
    const storage = createMemoryStorage()
    const pageIndex = createPageIndex({
      model: mockModel,
      storage,
      processing: { addNodeSummary: false },
    })

    // Create
    const { document } = await pageIndex.index({
      name: 'crud-test',
      type: 'markdown',
      content: shortMarkdown,
    })

    // Read
    const retrieved = await pageIndex.getDocument(document.id)
    expect(retrieved).not.toBeNull()
    expect(retrieved!.name).toBe('crud-test')

    // List
    const docs = await pageIndex.listDocuments()
    expect(docs.length).toBe(1)

    // Delete
    const deleted = await pageIndex.deleteDocument(document.id)
    expect(deleted).toBe(true)

    // Verify deleted
    const afterDelete = await pageIndex.getDocument(document.id)
    expect(afterDelete).toBeNull()
  })

  test('content storage modes', async () => {
    // Test inline mode
    const inlineStorage = createMemoryStorage()
    const inlineIndex = createPageIndex({
      model: mockModel,
      storage: inlineStorage,
      processing: {
        addNodeSummary: false,
        contentStorage: 'inline',
      },
    })

    const { document: inlineDoc } = await inlineIndex.index({
      name: 'inline-test',
      type: 'markdown',
      content: shortMarkdown,
    })

    const inlineTree = await inlineIndex.getTree(inlineDoc.id)
    expect(inlineTree![0]?.text).toBeDefined() // Text should be in nodes

    // Test separate mode
    const separateStorage = createMemoryStorage()
    const separateIndex = createPageIndex({
      model: mockModel,
      storage: separateStorage,
      processing: {
        addNodeSummary: false,
        contentStorage: 'separate',
      },
    })

    const { document: separateDoc } = await separateIndex.index({
      name: 'separate-test',
      type: 'markdown',
      content: shortMarkdown,
    })

    const separateTree = await separateIndex.getTree(separateDoc.id)
    expect(separateTree![0]?.text).toBeUndefined() // Text should NOT be in nodes

    // Verify content is stored separately
    const contentKeys = await separateStorage.list({ prefix: 'content:' })
    expect(contentKeys.length).toBeGreaterThan(0)
  })
})

// LLM-dependent tests - Cerebras (primary), OpenAI, Anthropic
const describeCerebras = hasCerebrasKey ? describe : describe.skip

describeCerebras('PageIndex with Real LLM (Cerebras)', () => {
  let storage: ReturnType<typeof createSQLiteStorage>
  let model: Awaited<ReturnType<typeof import('@ai-sdk/cerebras')['cerebras']>>

  beforeAll(async () => {
    const { cerebras } = await import('@ai-sdk/cerebras')
    model = cerebras('gpt-oss-120b')

    storage = createSQLiteStorage(':memory:')
    storage.initialize()
  })

  afterAll(() => {
    storage?.close()
  })

  test('indexes document (no summaries - fast)', async () => {
    const pageIndex = createPageIndex({
      model,
      storage,
      processing: {
        addNodeSummary: false,
        addDocDescription: false,
      },
    })

    const result = await pageIndex.index({
      name: 'fast-index-test',
      type: 'markdown',
      content: minimalMarkdown,
    })

    expect(result.document).toBeDefined()
    expect(result.document.name).toBe('fast-index-test')
    expect(result.stats.nodeCount).toBe(3) // Root + 2 sections

    await pageIndex.deleteDocument(result.document.id)
  }, 15000)

  test('indexes document with AI summaries', async () => {
    const pageIndex = createPageIndex({
      model,
      storage,
      processing: {
        addNodeSummary: true,
        addDocDescription: true,
        summaryTokenThreshold: 20, // Low threshold to generate summaries
      },
    })

    const result = await pageIndex.index({
      name: 'summary-test',
      type: 'markdown',
      content: minimalMarkdown, // Only 3 nodes = 4 LLM calls max
    })

    expect(result.document).toBeDefined()
    expect(result.document.description).toBeDefined()

    const tree = await pageIndex.getTree(result.document.id)
    // Check all nodes including nested children for summaries
    const checkAllNodes = (nodes: typeof tree): boolean => {
      if (!nodes) return false
      for (const node of nodes) {
        if (node.summary || node.prefixSummary) return true
        if (node.nodes && checkAllNodes(node.nodes)) return true
      }
      return false
    }
    const hasAnySummary = checkAllNodes(tree)
    expect(hasAnySummary).toBe(true)

    await pageIndex.deleteDocument(result.document.id)
  }, 30000)

  test('searches document with LLM reasoning', async () => {
    const pageIndex = createPageIndex({
      model,
      storage,
      processing: { addNodeSummary: false },
    })

    const { document } = await pageIndex.index({
      name: 'search-test',
      type: 'markdown',
      content: minimalMarkdown,
    })

    const results = await pageIndex.search('What are the rate limits?', {
      maxResults: 3,
      minScore: 0.1,
    })

    console.log('Search results:', results.map(r => ({ title: r.node.title, score: r.score })))

    expect(results.length).toBeGreaterThan(0)

    const topResult = results[0]
    expect(topResult).toBeDefined()
    expect(topResult!.reasoning).toBeDefined()

    await pageIndex.deleteDocument(document.id)
  }, 30000)

  test('retrieves content with context', async () => {
    const pageIndex = createPageIndex({
      model,
      storage,
      processing: { addNodeSummary: false },
    })

    const { document } = await pageIndex.index({
      name: 'retrieve-test',
      type: 'markdown',
      content: minimalMarkdown,
    })

    // Query for something in Section Two (config)
    const { results, context } = await pageIndex.retrieve(
      'What environment variables are required?',
      { maxResults: 2, minScore: 0.1 }
    )

    console.log('Retrieve results:', results.length, 'context length:', context.length)

    expect(results.length).toBeGreaterThan(0)
    expect(context.length).toBeGreaterThan(0)
    // Should find config-related content
    expect(context.toLowerCase()).toMatch(/database_url|api_key|config|variable/i)

    await pageIndex.deleteDocument(document.id)
  }, 30000)

  test('uses expert knowledge in search', async () => {
    const pageIndex = createPageIndex({
      model,
      storage,
      processing: { addNodeSummary: false },
    })

    const { document } = await pageIndex.index({
      name: 'expert-test',
      type: 'markdown',
      content: minimalMarkdown,
    })

    const results = await pageIndex.search('What environment variables are needed?', {
      maxResults: 3,
      expertKnowledge: 'Configuration is in Section Two',
      documentContext: 'Technical documentation',
    })

    expect(results.length).toBeGreaterThan(0)

    // Should find Section Two which has config info
    const titles = results.map((r) => r.node.title.toLowerCase())
    expect(titles.some((t) => t.includes('two') || t.includes('section'))).toBe(true)

    await pageIndex.deleteDocument(document.id)
  }, 30000)
})

// OpenAI tests (alternative)
const describeLLM = hasOpenAIKey ? describe : describe.skip

describeLLM('PageIndex with Real LLM (OpenAI)', () => {
  let pageIndex: PageIndex
  let storage: ReturnType<typeof createSQLiteStorage>

  beforeAll(async () => {
    const { openai } = await import('@ai-sdk/openai')

    storage = createSQLiteStorage(':memory:')
    storage.initialize()

    pageIndex = createPageIndex({
      model: openai('gpt-4o-mini'),
      storage,
      processing: {
        addNodeSummary: true,
        addDocDescription: true,
        summaryTokenThreshold: 50,
      },
    })
  })

  afterAll(() => {
    storage?.close()
  })

  test('indexes document with AI summaries', async () => {
    const result = await pageIndex.index({
      name: 'tech-spec',
      type: 'markdown',
      content: sampleMarkdown,
    })

    expect(result.document).toBeDefined()
    expect(result.document.description).toBeDefined()
    expect(result.stats.nodeCount).toBeGreaterThan(5)

    const tree = await pageIndex.getTree(result.document.id)
    // Check all nodes including nested children for summaries
    const checkAllNodes = (nodes: typeof tree): boolean => {
      if (!nodes) return false
      for (const node of nodes) {
        if (node.summary || node.prefixSummary) return true
        if (node.nodes && checkAllNodes(node.nodes)) return true
      }
      return false
    }
    const hasAnySummary = checkAllNodes(tree)
    expect(hasAnySummary).toBe(true)
  }, 60000)

  test('searches document with LLM reasoning', async () => {
    const { document } = await pageIndex.index({
      name: 'search-test',
      type: 'markdown',
      content: sampleMarkdown,
    })

    const results = await pageIndex.search('What are the rate limits?', {
      maxResults: 3,
      minScore: 0.3,
    })

    expect(results.length).toBeGreaterThan(0)

    const topResult = results[0]
    expect(topResult).toBeDefined()
    expect(topResult!.score).toBeGreaterThan(0.3)
    expect(topResult!.reasoning).toBeDefined()

    await pageIndex.deleteDocument(document.id)
  }, 60000)
})

// Anthropic tests
const describeAnthropic = hasAnthropicKey ? describe : describe.skip

describeAnthropic('PageIndex with Real LLM (Anthropic)', () => {
  let pageIndex: PageIndex
  let storage: ReturnType<typeof createSQLiteStorage>

  beforeAll(async () => {
    const { anthropic } = await import('@ai-sdk/anthropic')

    storage = createSQLiteStorage(':memory:')
    storage.initialize()

    pageIndex = createPageIndex({
      model: anthropic('claude-3-haiku-20240307'), // Use haiku for cost efficiency
      storage,
      processing: {
        addNodeSummary: true,
        summaryTokenThreshold: 50,
      },
    })
  })

  afterAll(() => {
    storage?.close()
  })

  test('indexes and searches with Claude', async () => {
    const { document } = await pageIndex.index({
      name: 'claude-test',
      type: 'markdown',
      content: sampleMarkdown,
    })

    const results = await pageIndex.search('How is data processed?', {
      maxResults: 3,
    })

    expect(results.length).toBeGreaterThan(0)
    expect(results[0]!.reasoning).toBeDefined()

    await pageIndex.deleteDocument(document.id)
  }, 60000)
})
