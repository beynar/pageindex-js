import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  extractNodesFromMarkdown,
  buildTreeFromNodes,
  processMarkdown,
  applyTreeThinning,
} from '../src/processing/markdown'

const sampleMarkdown = readFileSync(
  join(import.meta.dir, 'fixtures/sample.md'),
  'utf-8'
)

describe('Markdown Processing', () => {
  describe('extractNodesFromMarkdown', () => {
    test('extracts headers correctly', () => {
      const nodes = extractNodesFromMarkdown(sampleMarkdown)

      expect(nodes.length).toBeGreaterThan(0)
      expect(nodes[0]?.title).toBe('Sample Document')
      expect(nodes[0]?.level).toBe(1)
    })

    test('extracts all levels of headers', () => {
      const nodes = extractNodesFromMarkdown(sampleMarkdown)

      const levels = new Set(nodes.map((n) => n.level))
      expect(levels.has(1)).toBe(true)
      expect(levels.has(2)).toBe(true)
      expect(levels.has(3)).toBe(true)
    })

    test('captures content between headers', () => {
      const nodes = extractNodesFromMarkdown(sampleMarkdown)

      const introNode = nodes.find((n) => n.title === 'Introduction')
      expect(introNode).toBeDefined()
      expect(introNode?.content).toContain('introduces the document')
    })

    test('skips code blocks', () => {
      const markdown = `# Title

\`\`\`
# This is not a header
## Neither is this
\`\`\`

## Real Header
`
      const nodes = extractNodesFromMarkdown(markdown)

      expect(nodes).toHaveLength(2)
      expect(nodes[0]?.title).toBe('Title')
      expect(nodes[1]?.title).toBe('Real Header')
    })

    test('tracks line numbers', () => {
      const nodes = extractNodesFromMarkdown(sampleMarkdown)

      expect(nodes[0]?.lineNumber).toBe(0) // First line
      expect(nodes[1]?.lineNumber).toBeGreaterThan(0)
    })
  })

  describe('buildTreeFromNodes', () => {
    test('builds hierarchical tree', () => {
      const nodes = extractNodesFromMarkdown(sampleMarkdown)
      const tree = buildTreeFromNodes(nodes)

      expect(tree.length).toBeGreaterThan(0)

      // Root should be Sample Document
      expect(tree[0]?.title).toBe('Sample Document')

      // Should have children
      expect(tree[0]?.nodes).toBeDefined()
      expect(tree[0]?.nodes?.length).toBeGreaterThan(0)
    })

    test('assigns node IDs', () => {
      const nodes = extractNodesFromMarkdown(sampleMarkdown)
      const tree = buildTreeFromNodes(nodes)

      expect(tree[0]?.nodeId).toBe('0000')

      if (tree[0]?.nodes?.[0]) {
        expect(tree[0].nodes[0].nodeId).toBe('0001')
      }
    })

    test('preserves nested structure', () => {
      const markdown = `# Root
## Child 1
### Grandchild 1
### Grandchild 2
## Child 2
`
      const nodes = extractNodesFromMarkdown(markdown)
      const tree = buildTreeFromNodes(nodes)

      expect(tree[0]?.title).toBe('Root')
      expect(tree[0]?.nodes?.length).toBe(2)

      const child1 = tree[0]?.nodes?.[0]
      expect(child1?.title).toBe('Child 1')
      expect(child1?.nodes?.length).toBe(2)
    })
  })

  describe('processMarkdown', () => {
    test('returns complete tree structure', () => {
      const tree = processMarkdown(sampleMarkdown)

      expect(tree.length).toBeGreaterThan(0)
      expect(tree[0]?.nodeId).toBeDefined()
      expect(tree[0]?.startIndex).toBeDefined()
      expect(tree[0]?.endIndex).toBeDefined()
    })

    test('includes text content', () => {
      const tree = processMarkdown(sampleMarkdown)

      expect(tree[0]?.text).toBeDefined()
      expect(tree[0]?.text?.length).toBeGreaterThan(0)
    })
  })

  describe('applyTreeThinning', () => {
    test('merges small sections', () => {
      const markdown = `# Root
## Small Section 1
tiny content
## Small Section 2
more tiny content
`
      const tree = processMarkdown(markdown)

      // With high threshold, sections should be merged
      const thinned = applyTreeThinning(tree, 100000)

      // After thinning, the root should have merged content
      expect(thinned[0]?.text).toContain('tiny content')
      expect(thinned[0]?.text).toContain('more tiny content')
    })
  })
})
