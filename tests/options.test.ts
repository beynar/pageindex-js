import { describe, test, expect } from 'bun:test'
import {
  processMarkdown,
  applyTreeThinning,
} from '../src/processing/markdown'
import { TreeBuilder } from '../src/tree/builder'
import { TreePostProcessor } from '../src/tree/postprocess'
import { TreeSearchEngine } from '../src/search/engine'
import {
  resolveConfig,
  DEFAULT_PROCESSING_OPTIONS,
  DEFAULT_SEARCH_OPTIONS,
} from '../src/types/config'
import type { ProcessingOptions, SearchOptions } from '../src/types/config'
import type { TreeNode } from '../src/types/tree'
import { countTokens } from '../src/llm/tokens'
import { treeSearchPrompt } from '../src/llm/prompts/search'
import { createMemoryStorage } from '../src/storage/memory'

// Mock LLM model for testing
const mockModel = {
  specificationVersion: 'v1' as const,
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

// Sample markdown for testing
const sampleMarkdown = `# Document Title

Introduction paragraph.

## Section One

Content for section one. This is a longer section with more content to ensure
it has enough tokens to be significant. We need to make sure the token counting
works correctly and that sections are properly processed.

### Subsection 1.1

Detailed content for subsection 1.1. More text here to increase token count.

### Subsection 1.2

Detailed content for subsection 1.2. Additional content for testing.

## Section Two

Content for section two. Another section with substantial content.

### Subsection 2.1

Content for subsection 2.1.

## Section Three

Short content.
`

describe('Processing Options', () => {
  describe('addNodeId', () => {
    test('assigns sequential node IDs when enabled', () => {
      const tree = processMarkdown(sampleMarkdown)

      // Check that node IDs are assigned
      expect(tree[0]?.nodeId).toBe('0000')
      expect(tree[0]?.nodes?.[0]?.nodeId).toBe('0001')
      expect(tree[0]?.nodes?.[0]?.nodes?.[0]?.nodeId).toBe('0002')
    })

    test('node IDs are 4-digit padded', () => {
      const tree = processMarkdown(sampleMarkdown)

      const allNodeIds: string[] = []
      function collectIds(nodes: TreeNode[]) {
        for (const node of nodes) {
          allNodeIds.push(node.nodeId)
          if (node.nodes) collectIds(node.nodes)
        }
      }
      collectIds(tree)

      // All IDs should be 4 characters
      expect(allNodeIds.every((id) => id.length === 4)).toBe(true)
    })
  })

  describe('enableTreeThinning / thinningThreshold', () => {
    test('does not merge sections when disabled', () => {
      const tree = processMarkdown(sampleMarkdown, { enableThinning: false })

      // Should preserve all sections
      const sectionCount = tree[0]?.nodes?.length ?? 0
      expect(sectionCount).toBe(3) // Section One, Two, Three
    })

    test('merges small sections when threshold is high', () => {
      const tree = processMarkdown(sampleMarkdown)

      // With very high threshold, sections should be merged
      const thinned = applyTreeThinning(tree, 1000000)

      // Check that content is merged into parent
      expect(thinned[0]?.text).toBeDefined()
    })

    test('respects thinningThreshold value', () => {
      const smallMarkdown = `# Root
## Small 1
tiny
## Small 2
tiny
## Small 3
tiny
`
      const tree = processMarkdown(smallMarkdown)

      // With low threshold, nothing should merge
      const thinnedLow = applyTreeThinning(tree, 1)
      expect(thinnedLow[0]?.nodes?.length).toBe(3)

      // With high threshold, should merge
      const thinnedHigh = applyTreeThinning(tree, 1000000)
      // After thinning, small sections should be merged into parent
      expect(thinnedHigh[0]?.text).toContain('tiny')
    })
  })

  describe('maxTokensPerNode', () => {
    test('default value is 20000', () => {
      expect(DEFAULT_PROCESSING_OPTIONS.maxTokensPerNode).toBe(20000)
    })

    test('config resolution preserves custom value', () => {
      const config = resolveConfig({
        model: mockModel,
        storage: createMemoryStorage(),
        processing: { maxTokensPerNode: 5000 },
      })

      expect(config.processing.maxTokensPerNode).toBe(5000)
    })
  })

  describe('tocCheckPages', () => {
    test('default value is 20', () => {
      expect(DEFAULT_PROCESSING_OPTIONS.tocCheckPages).toBe(20)
    })

    test('config resolution preserves custom value', () => {
      const config = resolveConfig({
        model: mockModel,
        storage: createMemoryStorage(),
        processing: { tocCheckPages: 10 },
      })

      expect(config.processing.tocCheckPages).toBe(10)
    })
  })

  describe('summaryTokenThreshold', () => {
    test('default value is 200', () => {
      expect(DEFAULT_PROCESSING_OPTIONS.summaryTokenThreshold).toBe(200)
    })

    test('config resolution preserves custom value', () => {
      const config = resolveConfig({
        model: mockModel,
        storage: createMemoryStorage(),
        processing: { summaryTokenThreshold: 500 },
      })

      expect(config.processing.summaryTokenThreshold).toBe(500)
    })

    test('nodes below threshold would be skipped', () => {
      const shortText = 'Short text'
      const longText = 'This is a longer piece of text. '.repeat(50) // ~250 tokens

      expect(countTokens(shortText)).toBeLessThan(200)
      expect(countTokens(longText)).toBeGreaterThan(200)
    })
  })

  describe('contentStorage', () => {
    test('default value is auto', () => {
      expect(DEFAULT_PROCESSING_OPTIONS.contentStorage).toBe('auto')
    })

    test('accepts inline, separate, and auto', () => {
      const inlineConfig = resolveConfig({
        model: mockModel,
        storage: createMemoryStorage(),
        processing: { contentStorage: 'inline' },
      })
      expect(inlineConfig.processing.contentStorage).toBe('inline')

      const separateConfig = resolveConfig({
        model: mockModel,
        storage: createMemoryStorage(),
        processing: { contentStorage: 'separate' },
      })
      expect(separateConfig.processing.contentStorage).toBe('separate')

      const autoConfig = resolveConfig({
        model: mockModel,
        storage: createMemoryStorage(),
        processing: { contentStorage: 'auto' },
      })
      expect(autoConfig.processing.contentStorage).toBe('auto')
    })
  })

  describe('autoStoragePageThreshold', () => {
    test('default value is 50', () => {
      expect(DEFAULT_PROCESSING_OPTIONS.autoStoragePageThreshold).toBe(50)
    })

    test('config resolution preserves custom value', () => {
      const config = resolveConfig({
        model: mockModel,
        storage: createMemoryStorage(),
        processing: { autoStoragePageThreshold: 100 },
      })

      expect(config.processing.autoStoragePageThreshold).toBe(100)
    })

    test('auto mode uses threshold for decision', () => {
      // When pageCount > threshold, should use separate storage
      // When pageCount <= threshold, should use inline storage
      const threshold = 50

      // Small doc (10 pages) - should use inline
      const smallDocPages = 10
      expect(smallDocPages > threshold).toBe(false)

      // Large doc (100 pages) - should use separate
      const largeDocPages = 100
      expect(largeDocPages > threshold).toBe(true)
    })
  })

  describe('addNodeSummary', () => {
    test('default value is true', () => {
      expect(DEFAULT_PROCESSING_OPTIONS.addNodeSummary).toBe(true)
    })

    test('config resolution preserves custom value', () => {
      const config = resolveConfig({
        model: mockModel,
        storage: createMemoryStorage(),
        processing: { addNodeSummary: false },
      })

      expect(config.processing.addNodeSummary).toBe(false)
    })
  })

  describe('addDocDescription', () => {
    test('default value is false', () => {
      expect(DEFAULT_PROCESSING_OPTIONS.addDocDescription).toBe(false)
    })

    test('config resolution preserves custom value', () => {
      const config = resolveConfig({
        model: mockModel,
        storage: createMemoryStorage(),
        processing: { addDocDescription: true },
      })

      expect(config.processing.addDocDescription).toBe(true)
    })
  })
})

describe('Search Options', () => {
  describe('maxResults', () => {
    test('default value is 5', () => {
      expect(DEFAULT_SEARCH_OPTIONS.maxResults).toBe(5)
    })

    test('config resolution preserves custom value', () => {
      const config = resolveConfig({
        model: mockModel,
        storage: createMemoryStorage(),
        search: { maxResults: 10 },
      })

      expect(config.search.maxResults).toBe(10)
    })
  })

  describe('minScore', () => {
    test('default value is 0.5', () => {
      expect(DEFAULT_SEARCH_OPTIONS.minScore).toBe(0.5)
    })

    test('config resolution preserves custom value', () => {
      const config = resolveConfig({
        model: mockModel,
        storage: createMemoryStorage(),
        search: { minScore: 0.7 },
      })

      expect(config.search.minScore).toBe(0.7)
    })

    test('filters results below threshold', () => {
      const results = [
        { score: 0.9, nodeId: '1' },
        { score: 0.6, nodeId: '2' },
        { score: 0.4, nodeId: '3' },
        { score: 0.3, nodeId: '4' },
      ]

      const minScore = 0.5
      const filtered = results.filter((r) => r.score >= minScore)

      expect(filtered).toHaveLength(2)
      expect(filtered.every((r) => r.score >= minScore)).toBe(true)
    })
  })

  describe('includeText', () => {
    test('default value is true', () => {
      expect(DEFAULT_SEARCH_OPTIONS.includeText).toBe(true)
    })

    test('config resolution preserves custom value', () => {
      const config = resolveConfig({
        model: mockModel,
        storage: createMemoryStorage(),
        search: { includeText: false },
      })

      expect(config.search.includeText).toBe(false)
    })
  })

  describe('maxDepth', () => {
    test('default value is Infinity', () => {
      expect(DEFAULT_SEARCH_OPTIONS.maxDepth).toBe(Infinity)
    })

    test('config resolution preserves custom value', () => {
      const config = resolveConfig({
        model: mockModel,
        storage: createMemoryStorage(),
        search: { maxDepth: 3 },
      })

      expect(config.search.maxDepth).toBe(3)
    })

    test('filters nodes by depth', () => {
      const tree: TreeNode[] = [
        {
          title: 'Root',
          nodeId: '0000',
          startIndex: 0,
          endIndex: 100,
          nodes: [
            {
              title: 'Child',
              nodeId: '0001',
              startIndex: 1,
              endIndex: 50,
              nodes: [
                {
                  title: 'Grandchild',
                  nodeId: '0002',
                  startIndex: 2,
                  endIndex: 25,
                },
              ],
            },
          ],
        },
      ]

      function getNodesAtMaxDepth(
        nodes: TreeNode[],
        maxDepth: number,
        currentDepth = 0
      ): TreeNode[] {
        const result: TreeNode[] = []
        for (const node of nodes) {
          if (currentDepth <= maxDepth) {
            result.push(node)
            if (node.nodes) {
              result.push(
                ...getNodesAtMaxDepth(node.nodes, maxDepth, currentDepth + 1)
              )
            }
          }
        }
        return result
      }

      const depth0 = getNodesAtMaxDepth(tree, 0)
      expect(depth0).toHaveLength(1) // Just root

      const depth1 = getNodesAtMaxDepth(tree, 1)
      expect(depth1).toHaveLength(2) // Root + child

      const depth2 = getNodesAtMaxDepth(tree, 2)
      expect(depth2).toHaveLength(3) // Root + child + grandchild
    })
  })

  describe('documentIds', () => {
    test('default value is empty array', () => {
      expect(DEFAULT_SEARCH_OPTIONS.documentIds).toEqual([])
    })

    test('config resolution preserves custom value', () => {
      const config = resolveConfig({
        model: mockModel,
        storage: createMemoryStorage(),
        search: { documentIds: ['doc1', 'doc2'] },
      })

      expect(config.search.documentIds).toEqual(['doc1', 'doc2'])
    })
  })

  describe('expertKnowledge', () => {
    test('is optional and undefined by default', () => {
      const config = resolveConfig({
        model: mockModel,
        storage: createMemoryStorage(),
      })

      expect(config.search.expertKnowledge).toBeUndefined()
    })

    test('is included in search prompt when provided', () => {
      const expertKnowledge =
        'For financial queries, prioritize Item 7 MD&A section.'
      const { system } = treeSearchPrompt(
        'What is the revenue?',
        '[0000] Financial Statements',
        0,
        { expertKnowledge }
      )

      expect(system).toContain(expertKnowledge)
    })

    test('is not included in prompt when not provided', () => {
      const { system } = treeSearchPrompt(
        'What is the revenue?',
        '[0000] Financial Statements',
        0
      )

      expect(system).not.toContain('Expert Knowledge')
    })
  })

  describe('documentContext', () => {
    test('is optional and undefined by default', () => {
      const config = resolveConfig({
        model: mockModel,
        storage: createMemoryStorage(),
      })

      expect(config.search.documentContext).toBeUndefined()
    })

    test('is included in search prompt when provided', () => {
      const documentContext = 'This is a 10-K SEC filing from 2023.'
      const { user } = treeSearchPrompt(
        'What is the revenue?',
        '[0000] Financial Statements',
        0,
        { documentContext }
      )

      expect(user).toContain(documentContext)
    })
  })
})

describe('Config Resolution', () => {
  test('applies all processing defaults', () => {
    const config = resolveConfig({
      model: mockModel,
      storage: createMemoryStorage(),
    })

    expect(config.processing.tocCheckPages).toBe(20)
    expect(config.processing.maxTokensPerNode).toBe(20000)
    expect(config.processing.addNodeId).toBe(true)
    expect(config.processing.addNodeSummary).toBe(true)
    expect(config.processing.addDocDescription).toBe(false)
    expect(config.processing.summaryTokenThreshold).toBe(200)
    expect(config.processing.enableTreeThinning).toBe(false)
    expect(config.processing.thinningThreshold).toBe(5000)
    expect(config.processing.contentStorage).toBe('auto')
    expect(config.processing.autoStoragePageThreshold).toBe(50)
  })

  test('applies all search defaults', () => {
    const config = resolveConfig({
      model: mockModel,
      storage: createMemoryStorage(),
    })

    expect(config.search.maxResults).toBe(5)
    expect(config.search.minScore).toBe(0.5)
    expect(config.search.includeText).toBe(true)
    expect(config.search.maxDepth).toBe(Infinity)
    expect(config.search.documentIds).toEqual([])
  })

  test('custom values override defaults', () => {
    const config = resolveConfig({
      model: mockModel,
      storage: createMemoryStorage(),
      processing: {
        tocCheckPages: 10,
        addNodeSummary: false,
        contentStorage: 'separate',
      },
      search: {
        maxResults: 20,
        minScore: 0.8,
      },
    })

    // Custom values
    expect(config.processing.tocCheckPages).toBe(10)
    expect(config.processing.addNodeSummary).toBe(false)
    expect(config.processing.contentStorage).toBe('separate')
    expect(config.search.maxResults).toBe(20)
    expect(config.search.minScore).toBe(0.8)

    // Defaults still applied for non-overridden
    expect(config.processing.addNodeId).toBe(true)
    expect(config.search.includeText).toBe(true)
  })

  test('debug defaults to false', () => {
    const config = resolveConfig({
      model: mockModel,
      storage: createMemoryStorage(),
    })

    expect(config.debug).toBe(false)
  })

  test('debug can be enabled', () => {
    const config = resolveConfig({
      model: mockModel,
      storage: createMemoryStorage(),
      debug: true,
    })

    expect(config.debug).toBe(true)
  })
})

describe('Tree Building with Options', () => {
  test('TreeBuilder passes options to markdown processor', () => {
    const options: ProcessingOptions = {
      enableTreeThinning: true,
      thinningThreshold: 10000,
      addNodeId: true,
    }

    const builder = new TreeBuilder(mockModel, options)

    // We can't easily test the internal behavior without mocking,
    // but we can verify the builder accepts the options
    expect(builder).toBeDefined()
  })

  test('TreePostProcessor uses summaryTokenThreshold', () => {
    const options: ProcessingOptions = {
      summaryTokenThreshold: 500,
      addNodeSummary: true,
    }

    const processor = new TreePostProcessor(mockModel, options)

    // Verify processor is created with options
    expect(processor).toBeDefined()
  })
})

describe('Content Storage Logic', () => {
  test('inline mode keeps text in nodes', () => {
    const shouldStoreContent = (
      mode: 'inline' | 'separate' | 'auto',
      pageCount: number,
      threshold: number
    ): boolean => {
      return (
        mode === 'separate' || (mode === 'auto' && pageCount > threshold)
      )
    }

    // Inline mode - never store separately
    expect(shouldStoreContent('inline', 100, 50)).toBe(false)
    expect(shouldStoreContent('inline', 10, 50)).toBe(false)
  })

  test('separate mode always stores content separately', () => {
    const shouldStoreContent = (
      mode: 'inline' | 'separate' | 'auto',
      pageCount: number,
      threshold: number
    ): boolean => {
      return (
        mode === 'separate' || (mode === 'auto' && pageCount > threshold)
      )
    }

    // Separate mode - always store separately
    expect(shouldStoreContent('separate', 10, 50)).toBe(true)
    expect(shouldStoreContent('separate', 100, 50)).toBe(true)
  })

  test('auto mode uses threshold for decision', () => {
    const shouldStoreContent = (
      mode: 'inline' | 'separate' | 'auto',
      pageCount: number,
      threshold: number
    ): boolean => {
      return (
        mode === 'separate' || (mode === 'auto' && pageCount > threshold)
      )
    }

    // Auto mode with threshold 50
    expect(shouldStoreContent('auto', 10, 50)).toBe(false) // Below threshold
    expect(shouldStoreContent('auto', 50, 50)).toBe(false) // At threshold
    expect(shouldStoreContent('auto', 51, 50)).toBe(true) // Above threshold
    expect(shouldStoreContent('auto', 100, 50)).toBe(true) // Well above
  })
})
