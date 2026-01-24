/**
 * Test search relevance with and without summaries
 * Run: bun test tests/search-relevance.test.ts
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { createPageIndex } from '../src/core'
import { createSQLiteStorage } from '../src/storage/sqlite'

const hasCerebrasKey = !!process.env.CEREBRAS_API_KEY
const describeCerebras = hasCerebrasKey ? describe : describe.skip

const testDoc = `# Product Documentation

## Authentication

Users authenticate using OAuth 2.0 with JWT tokens.
Tokens are signed with RS256 and expire after 24 hours.
Rate limits: 100 requests/minute for free tier, 1000 for paid.

## Configuration

System configuration uses environment variables.
Required: DATABASE_URL, API_KEY, LOG_LEVEL.
Optional: CACHE_TTL (default 300), MAX_CONNECTIONS (default 10).

## Deployment

Deploy using Docker or Kubernetes.
Docker: Use the provided Dockerfile.
Kubernetes: Helm charts in /deploy directory.
`

describeCerebras('Search Relevance', () => {
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

  test('WITHOUT summaries - poor relevance (titles only)', async () => {
    const pageIndex = createPageIndex({
      model,
      storage,
      processing: { addNodeSummary: false },
    })

    const { document } = await pageIndex.index({
      name: 'no-summary-test',
      type: 'markdown',
      content: testDoc,
    })

    // Tree only shows titles - LLM can't see content
    const tree = await pageIndex.getTree(document.id)
    console.log('\n=== WITHOUT SUMMARIES ===')
    console.log('Tree structure (what LLM sees in phase 1):')
    tree?.forEach((n) => {
      console.log(`  [${n.nodeId}] ${n.title}`)
      n.nodes?.forEach((c) => console.log(`    [${c.nodeId}] ${c.title} ${c.summary ? `- ${c.summary}` : '(no summary)'}`))
    })

    const results = await pageIndex.search('What are the rate limits?', {
      maxResults: 3,
      minScore: 0.1,
    })

    console.log('\nSearch results for "rate limits":')
    results.forEach((r) => {
      console.log(`  ${r.node.title}: ${r.score.toFixed(2)} - ${r.reasoning}`)
    })

    // With no summaries, results may not be well-ranked
    expect(results.length).toBeGreaterThan(0)

    await pageIndex.deleteDocument(document.id)
  }, 60000)

  test('WITH summaries - good relevance', async () => {
    const pageIndex = createPageIndex({
      model,
      storage,
      processing: {
        addNodeSummary: true,
        summaryTokenThreshold: 10, // Generate for all nodes
      },
    })

    const { document } = await pageIndex.index({
      name: 'with-summary-test',
      type: 'markdown',
      content: testDoc,
    })

    const tree = await pageIndex.getTree(document.id)
    console.log('\n=== WITH SUMMARIES ===')
    console.log('Tree structure (what LLM sees in phase 1):')
    tree?.forEach((n) => {
      console.log(`  [${n.nodeId}] ${n.title}`)
      n.nodes?.forEach((c) => {
        const summary = c.summary || c.prefixSummary || '(no summary)'
        console.log(`    [${c.nodeId}] ${c.title} - ${summary.slice(0, 60)}...`)
      })
    })

    const results = await pageIndex.search('What are the rate limits?', {
      maxResults: 3,
      minScore: 0.1,
    })

    console.log('\nSearch results for "rate limits":')
    results.forEach((r) => {
      console.log(`  ${r.node.title}: ${r.score.toFixed(2)} - ${r.reasoning}`)
    })

    // With summaries, Authentication section should rank highest
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]?.node.title).toBe('Authentication')

    await pageIndex.deleteDocument(document.id)
  }, 90000)
})
