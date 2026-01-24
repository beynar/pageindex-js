import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { PdfProcessor } from '../src/processing/pdf'
import { createCerebras } from '@ai-sdk/cerebras'

const pdfBytes = readFileSync(join(import.meta.dir, 'fixtures/sample.pdf'))

// Helper to get a fresh ArrayBuffer copy (ArrayBuffer gets detached after use)
function getPdfBuffer(): ArrayBuffer {
  return pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength)
}

// Use Cerebras for fast, cheap LLM calls in tests
const cerebras = createCerebras()
const model = cerebras('llama-3.3-70b')

describe('PDF Processing', () => {
  describe('extractPages', () => {
    test('extracts all pages from PDF', async () => {
      const processor = new PdfProcessor(model)
      const pages = await processor.extractPages(getPdfBuffer())

      expect(pages.length).toBe(5)
    })

    test('pages have correct structure', async () => {
      const processor = new PdfProcessor(model)
      const pages = await processor.extractPages(getPdfBuffer())

      for (const page of pages) {
        expect(page).toHaveProperty('index')
        expect(page).toHaveProperty('text')
        expect(page).toHaveProperty('tokenCount')
        expect(typeof page.index).toBe('number')
        expect(typeof page.text).toBe('string')
        expect(typeof page.tokenCount).toBe('number')
      }
    })

    test('pages are 0-indexed', async () => {
      const processor = new PdfProcessor(model)
      const pages = await processor.extractPages(getPdfBuffer())

      expect(pages[0]?.index).toBe(0)
      expect(pages[1]?.index).toBe(1)
      expect(pages[4]?.index).toBe(4)
    })

    test('extracts text content from pages', async () => {
      const processor = new PdfProcessor(model)
      const pages = await processor.extractPages(getPdfBuffer())

      // Page 1: Vision, Mission, Promesse
      expect(pages[0]?.text).toContain('Helpsy')
      expect(pages[0]?.text).toContain('Vision')
      expect(pages[0]?.text).toContain('Mission')

      // Page 2: Les consultations, Les contenus, La communauté
      expect(pages[1]?.text).toContain('accompagnement')

      // Page 3: For professionals
      expect(pages[2]?.text).toContain('professionnels')

      // Page 4: Abonnement, Plateforme
      expect(pages[3]?.text).toContain('59')
      expect(pages[3]?.text).toContain('Abonnement')

      // Page 5: Team
      expect(pages[4]?.text).toContain('Pauline')
      expect(pages[4]?.text).toContain('Maxime')
    })

    test('calculates token counts', async () => {
      const processor = new PdfProcessor(model)
      const pages = await processor.extractPages(getPdfBuffer())

      for (const page of pages) {
        expect(page.tokenCount).toBeGreaterThan(0)
      }
    })
  })

  describe('tocEntriesToTree', () => {
    test('converts flat entries to tree structure', () => {
      const processor = new PdfProcessor(model)

      const entries = [
        { structure: '1', title: 'Introduction', physicalIndex: 0, appearStart: 'yes' as const },
        { structure: '1.1', title: 'Background', physicalIndex: 0, appearStart: 'yes' as const },
        { structure: '1.2', title: 'Objectives', physicalIndex: 1, appearStart: 'yes' as const },
        { structure: '2', title: 'Methods', physicalIndex: 2, appearStart: 'yes' as const },
      ]

      const tree = processor.tocEntriesToTree(entries)

      expect(tree.length).toBe(2) // Introduction and Methods at root
      expect(tree[0]?.title).toBe('Introduction')
      expect(tree[0]?.nodes?.length).toBe(2) // Background and Objectives
      expect(tree[1]?.title).toBe('Methods')
    })

    test('assigns node IDs', () => {
      const processor = new PdfProcessor(model)

      const entries = [
        { structure: '1', title: 'Section 1', physicalIndex: 0, appearStart: 'yes' as const },
        { structure: '2', title: 'Section 2', physicalIndex: 1, appearStart: 'yes' as const },
      ]

      const tree = processor.tocEntriesToTree(entries)

      expect(tree[0]?.nodeId).toBe('0000')
      expect(tree[1]?.nodeId).toBe('0001')
    })

    test('calculates start and end indices', () => {
      const processor = new PdfProcessor(model)

      const entries = [
        { structure: '1', title: 'Section 1', physicalIndex: 0, appearStart: 'yes' as const },
        { structure: '2', title: 'Section 2', physicalIndex: 2, appearStart: 'yes' as const },
        { structure: '3', title: 'Section 3', physicalIndex: 4, appearStart: 'yes' as const },
      ]

      const tree = processor.tocEntriesToTree(entries)

      expect(tree[0]?.startIndex).toBe(0)
      expect(tree[0]?.endIndex).toBe(1) // ends before section 2 starts
      expect(tree[1]?.startIndex).toBe(2)
      expect(tree[1]?.endIndex).toBe(3)
      expect(tree[2]?.startIndex).toBe(4)
      expect(tree[2]?.endIndex).toBe(4) // last section, same as start
    })

    test('respects appearStart when calculating end index', () => {
      const processor = new PdfProcessor(model)

      const entries = [
        { structure: '1', title: 'Section 1', physicalIndex: 0, appearStart: 'yes' as const },
        { structure: '2', title: 'Section 2', physicalIndex: 2, appearStart: 'no' as const }, // starts mid-page
        { structure: '3', title: 'Section 3', physicalIndex: 4, appearStart: 'yes' as const },
      ]

      const tree = processor.tocEntriesToTree(entries)

      // Section 2 starts mid-page, so Section 1 includes page 2
      expect(tree[0]?.startIndex).toBe(0)
      expect(tree[0]?.endIndex).toBe(2) // includes page 2 since Section 2 starts mid-page
      expect(tree[1]?.startIndex).toBe(2)
      expect(tree[1]?.endIndex).toBe(3) // Section 3 starts at beginning, so exclude page 4
      expect(tree[2]?.startIndex).toBe(4)
      expect(tree[2]?.endIndex).toBe(4)
    })
  })

  describe('addPrefaceIfNeeded (via process)', () => {
    test('adds preface when first entry starts after page 0', () => {
      const processor = new PdfProcessor(model)

      // Access private method for testing
      const addPreface = (processor as any).addPrefaceIfNeeded.bind(processor)

      const entries = [
        { structure: '1', title: 'Chapter 1', physicalIndex: 3, appearStart: 'yes' as const },
      ]

      const result = addPreface(entries)

      expect(result.length).toBe(2)
      expect(result[0]?.title).toBe('Preface')
      expect(result[0]?.physicalIndex).toBe(0)
      expect(result[1]?.title).toBe('Chapter 1')
    })

    test('does not add preface when first entry starts at page 0', () => {
      const processor = new PdfProcessor(model)

      const addPreface = (processor as any).addPrefaceIfNeeded.bind(processor)

      const entries = [
        { structure: '1', title: 'Chapter 1', physicalIndex: 0, appearStart: 'yes' as const },
      ]

      const result = addPreface(entries)

      expect(result.length).toBe(1)
      expect(result[0]?.title).toBe('Chapter 1')
    })
  })

  describe('groupPagesByTokens', () => {
    test('groups pages respecting token limit', () => {
      const processor = new PdfProcessor(model, { maxTokensPerNode: 1000 })

      const groupPages = (processor as any).groupPagesByTokens.bind(processor)

      const pages = [
        { index: 0, text: 'page 0', tokenCount: 400 },
        { index: 1, text: 'page 1', tokenCount: 400 },
        { index: 2, text: 'page 2', tokenCount: 400 },
        { index: 3, text: 'page 3', tokenCount: 400 },
      ]

      const groups = groupPages(pages)

      // 400+400 = 800 < 1000, but 400+400+400 = 1200 > 1000
      expect(groups.length).toBe(2)
      expect(groups[0].pages.length).toBe(2)
      expect(groups[1].pages.length).toBe(2)
    })
  })

  describe('full process pipeline', () => {
    test.skip('processes PDF and returns tree with pages', async () => {
      const processor = new PdfProcessor(model)
      const { tree, pages } = await processor.process(getPdfBuffer())

      expect(pages.length).toBe(5)
      expect(tree.length).toBeGreaterThan(0)

      // Tree nodes should have required properties
      for (const node of tree) {
        expect(node).toHaveProperty('title')
        expect(node).toHaveProperty('nodeId')
        expect(node).toHaveProperty('startIndex')
        expect(node).toHaveProperty('endIndex')
      }
    }, 60000) // 60s timeout for LLM calls

    test.skip('tree covers all pages', async () => {
      const processor = new PdfProcessor(model)
      const { tree, pages } = await processor.process(getPdfBuffer())

      // Collect all page indices covered by tree
      const coveredPages = new Set<number>()

      function collectPages(nodes: typeof tree) {
        for (const node of nodes) {
          for (let i = node.startIndex; i <= node.endIndex; i++) {
            coveredPages.add(i)
          }
          if (node.nodes) {
            collectPages(node.nodes)
          }
        }
      }

      collectPages(tree)

      // All pages should be covered (0 to 4)
      for (let i = 0; i < pages.length; i++) {
        expect(coveredPages.has(i)).toBe(true)
      }
    }, 60000)
  })
})

describe('PDF Integration with PageIndex', () => {
  test.skip('indexes PDF document', async () => {
    // Skip by default as it requires full LLM pipeline
    const { createPageIndex } = await import('../src/core')
    const { createMemoryStorage } = await import('../src/storage/memory')

    const pageIndex = createPageIndex({
      model,
      storage: createMemoryStorage(),
      processing: {
        addNodeSummary: false, // Skip summaries for faster test
      },
    })

    const result = await pageIndex.index({
      name: 'helpsy-presentation',
      type: 'pdf',
      content: getPdfBuffer(),
    })

    expect(result.document.id).toBeDefined()
    expect(result.document.name).toBe('helpsy-presentation')
    expect(result.document.type).toBe('pdf')
    expect(result.document.pageCount).toBe(5)
    expect(result.document.structure.length).toBeGreaterThan(0)
  }, 120000)

  test.skip('searches PDF content', async () => {
    const { createPageIndex } = await import('../src/core')
    const { createMemoryStorage } = await import('../src/storage/memory')

    const pageIndex = createPageIndex({
      model,
      storage: createMemoryStorage(),
      processing: {
        addNodeSummary: false,
      },
    })

    await pageIndex.index({
      name: 'helpsy-presentation',
      type: 'pdf',
      content: getPdfBuffer(),
    })

    // Search for team info
    const results = await pageIndex.search('Who are the founders?')

    expect(results.length).toBeGreaterThan(0)
    // Should find the team page (page 5)
    const teamResult = results.find((r) =>
      r.node.text?.includes('Pauline') || r.node.title.toLowerCase().includes('team')
    )
    expect(teamResult).toBeDefined()
  }, 120000)

  test.skip('searches for pricing information', async () => {
    const { createPageIndex } = await import('../src/core')
    const { createMemoryStorage } = await import('../src/storage/memory')

    const pageIndex = createPageIndex({
      model,
      storage: createMemoryStorage(),
      processing: {
        addNodeSummary: false,
      },
    })

    await pageIndex.index({
      name: 'helpsy-presentation',
      type: 'pdf',
      content: getPdfBuffer(),
    })

    // Search for pricing
    const results = await pageIndex.search('What is the subscription price?')

    expect(results.length).toBeGreaterThan(0)
    // Should find content with 59€
    const pricingResult = results.find((r) => r.node.text?.includes('59'))
    expect(pricingResult).toBeDefined()
  }, 120000)
})
