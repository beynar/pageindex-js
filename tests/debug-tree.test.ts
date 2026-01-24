/**
 * Debug tree structure and text assignment
 */
import { describe, test, expect } from 'bun:test'
import { processMarkdown } from '../src/processing/markdown'
import { TreeBuilder } from '../src/tree/builder'
import { getAllNodes } from '../src/tree/navigation'

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

// Mock model for testing
const mockModel = {
  specificationVersion: 'v2' as const,
  provider: 'mock',
  modelId: 'mock-model',
  defaultObjectGenerationMode: 'json' as const,
  doGenerate: async () => ({
    text: '{}',
    finishReason: 'stop' as const,
    usage: { promptTokens: 0, completionTokens: 0 },
    rawCall: { rawPrompt: '', rawSettings: {} },
  }),
  doStream: async () => ({
    stream: new ReadableStream(),
    rawCall: { rawPrompt: '', rawSettings: {} },
  }),
}

describe('Debug Tree', () => {
  test('processMarkdown text assignment', () => {
    const tree = processMarkdown(testDoc)

    console.log('\n=== PROCESS MARKDOWN OUTPUT ===')
    for (const node of getAllNodes(tree)) {
      console.log(`\n[${node.nodeId}] ${node.title}`)
      console.log(`  startIndex: ${node.startIndex}, endIndex: ${node.endIndex}`)
      console.log(`  text preview: "${node.text?.slice(0, 100)}..."`)
    }

    // Check that Authentication node has auth content
    const authNode = getAllNodes(tree).find((n) => n.title === 'Authentication')
    expect(authNode).toBeDefined()
    expect(authNode?.text).toContain('OAuth')
    expect(authNode?.text).toContain('JWT')
    expect(authNode?.text?.toLowerCase()).toContain('rate limits')

    // Check that Configuration node has config content
    const configNode = getAllNodes(tree).find((n) => n.title === 'Configuration')
    expect(configNode).toBeDefined()
    expect(configNode?.text).toContain('DATABASE_URL')
  })

  test('TreeBuilder pages and indices', async () => {
    const builder = new TreeBuilder(mockModel as any, { addNodeId: true })
    const result = await builder.build({
      name: 'test',
      type: 'markdown',
      content: testDoc,
    })

    console.log('\n=== TREE BUILDER OUTPUT ===')
    console.log(`Pages: ${result.pages.length}`)
    result.pages.forEach((p, i) => {
      console.log(`  Page ${i}: index=${p.index}, tokens=${p.tokenCount}`)
      console.log(`    text: "${p.text.slice(0, 80)}..."`)
    })

    console.log('\nTree nodes:')
    for (const node of getAllNodes(result.tree)) {
      console.log(`  [${node.nodeId}] ${node.title}`)
      console.log(`    startIndex: ${node.startIndex}, endIndex: ${node.endIndex}`)
    }

    // The issue: pages are extracted per-node, indices are node indices not line indices
    // So when postprocess adds text, it might use wrong mapping
  })
})
