import { getDocumentProxy, extractText } from 'unpdf'
import type { LanguageModel } from 'ai'
import type { TreeNode, TocEntry } from '../types/tree.js'
import { countTokens, truncateToTokens } from '../llm/tokens.js'
import { LLMClient } from '../llm/client.js'
import {
  TocDetectionSchema,
  TocExtractionSchema,
  tocDetectionPrompt,
  tocExtractionPrompt,
} from '../llm/prompts/toc.js'
import {
  SectionExtractionSchema,
  PageMatchSchema,
  TitleVerificationSchema,
  sectionExtractionPrompt,
  pageMatchPrompt,
  titleVerificationPrompt,
} from '../llm/prompts/extraction.js'

/**
 * Extracted page information
 */
export interface PageInfo {
  /** Page index (0-based) */
  index: number

  /** Page text content */
  text: string

  /** Token count */
  tokenCount: number
}

/**
 * PDF processing options
 */
export interface PdfProcessingOptions {
  /** Number of pages to scan for TOC */
  tocCheckPages?: number

  /** Max tokens per tree node */
  maxTokensPerNode?: number

  /** Max pages per tree node (used with maxTokensPerNode for splitting) */
  maxPagesPerNode?: number
}

const DEFAULT_OPTIONS: Required<PdfProcessingOptions> = {
  tocCheckPages: 20,
  maxTokensPerNode: 20000,
  maxPagesPerNode: 10,
}

/**
 * PDF Processor class
 */
export class PdfProcessor {
  private llm: LLMClient
  private options: Required<PdfProcessingOptions>

  constructor(model: LanguageModel, options?: PdfProcessingOptions) {
    this.llm = new LLMClient(model)
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Extract text from all pages of a PDF
   */
  async extractPages(pdfData: ArrayBuffer): Promise<PageInfo[]> {
    const pdf = await getDocumentProxy(new Uint8Array(pdfData))

    // Extract all pages in a single call (not N calls!)
    const { text } = await extractText(pdf, { mergePages: false })
    const textArray = Array.isArray(text) ? text : [text]

    // Map to PageInfo objects
    return textArray.map((pageText, index) => ({
      index,
      text: pageText ?? '',
      tokenCount: countTokens(pageText ?? ''),
    }))
  }

  /**
   * Check if PDF has a table of contents
   */
  async detectToc(pages: PageInfo[]): Promise<{
    hasToc: boolean
    tocPages: number[]
    tocContent: string
  }> {
    const pagesToCheck = Math.min(pages.length, this.options.tocCheckPages)
    const tocPages: number[] = []
    let tocContent = ''

    for (let i = 0; i < pagesToCheck; i++) {
      const page = pages[i]
      if (!page) continue

      const { system, user } = tocDetectionPrompt(
        truncateToTokens(page.text, 4000)
      )
      const result = await this.llm.chatJSON(system, user, TocDetectionSchema)

      if (result.hasToc && result.confidence > 0.7) {
        tocPages.push(i)
        tocContent += page.text + '\n\n'
      }
    }

    return {
      hasToc: tocPages.length > 0,
      tocPages,
      tocContent: tocContent.trim(),
    }
  }

  /**
   * Extract TOC entries from content
   */
  async extractTocEntries(tocContent: string): Promise<TocEntry[]> {
    const { system, user } = tocExtractionPrompt(
      truncateToTokens(tocContent, 8000)
    )
    const result = await this.llm.chatJSON(system, user, TocExtractionSchema)

    return result.entries.map((entry) => {
      const tocEntry: TocEntry = {
        structure: entry.structure,
        title: entry.title,
        physicalIndex: 0, // Will be determined later
        appearStart: 'yes' as const,
      }
      if (entry.page !== undefined) {
        tocEntry.page = entry.page
      }
      return tocEntry
    })
  }

  /**
   * Find page numbers for TOC entries
   */
  async findPageNumbers(
    entries: TocEntry[],
    pages: PageInfo[]
  ): Promise<TocEntry[]> {
    const results: TocEntry[] = []

    for (const entry of entries) {
      // If entry has page number from TOC, verify it
      if (entry.page !== undefined) {
        const pageIndex = entry.page - 1 // Convert to 0-based
        if (pageIndex >= 0 && pageIndex < pages.length) {
          const page = pages[pageIndex]
          if (page) {
            const { system, user } = titleVerificationPrompt(
              entry.title,
              truncateToTokens(page.text, 2000)
            )
            const verification = await this.llm.chatJSON(
              system,
              user,
              TitleVerificationSchema
            )

            results.push({
              ...entry,
              physicalIndex: pageIndex,
              appearStart: verification.appearsAtStart ? 'yes' : 'no',
            })
            continue
          }
        }
      }

      // Search for the section in surrounding pages
      const searchPages = pages.slice(0, Math.min(50, pages.length))
      const pagesContent = searchPages.map((p) => ({
        index: p.index,
        content: truncateToTokens(p.text, 500),
      }))

      const { system, user } = pageMatchPrompt(entry.title, pagesContent)
      const match = await this.llm.chatJSON(system, user, PageMatchSchema)

      results.push({
        ...entry,
        physicalIndex: match.pageIndex,
        appearStart: match.appearsAtStart ? 'yes' : 'no',
      })
    }

    return results
  }

  /**
   * Verify TOC entries by checking if titles appear on assigned pages
   * Returns accuracy and list of incorrect entries
   */
  async verifyToc(
    entries: TocEntry[],
    pages: PageInfo[],
    sampleSize?: number
  ): Promise<{ accuracy: number; incorrect: TocEntry[] }> {
    // Determine which entries to check
    const toCheck = sampleSize
      ? this.randomSample(entries, Math.min(sampleSize, entries.length))
      : entries

    // Verify all entries in parallel
    const results = await Promise.all(
      toCheck.map(async (entry) => {
        const page = pages[entry.physicalIndex]
        if (!page) {
          return { entry, found: false }
        }

        const { system, user } = titleVerificationPrompt(
          entry.title,
          truncateToTokens(page.text, 2000)
        )
        const result = await this.llm.chatJSON(system, user, TitleVerificationSchema)
        return { entry, found: result.found }
      })
    )

    const incorrect = results.filter((r) => !r.found).map((r) => r.entry)
    const correctCount = results.filter((r) => r.found).length

    const accuracy = toCheck.length > 0 ? correctCount / toCheck.length : 0
    return { accuracy, incorrect }
  }

  /**
   * Random sample from array
   */
  private randomSample<T>(arr: T[], size: number): T[] {
    const shuffled = [...arr].sort(() => Math.random() - 0.5)
    return shuffled.slice(0, size)
  }

  /**
   * Calculate page offset between TOC page numbers and actual PDF page indices.
   * When TOC says "Chapter 1: page 1" but it's actually on PDF page 5,
   * the offset is 4.
   *
   * Returns the most common offset (mode) from verified entries.
   */
  private calculatePageOffset(
    entries: TocEntry[]
  ): number {
    // Only consider entries that have both a TOC page number and a verified physical index
    const differences: number[] = []

    for (const entry of entries) {
      if (entry.page !== undefined && entry.physicalIndex !== undefined) {
        const difference = entry.physicalIndex - entry.page
        differences.push(difference)
      }
    }

    if (differences.length === 0) {
      return 0
    }

    // Find the most common difference (mode)
    const counts = new Map<number, number>()
    for (const diff of differences) {
      counts.set(diff, (counts.get(diff) ?? 0) + 1)
    }

    let mostCommon = 0
    let maxCount = 0
    for (const [diff, count] of counts) {
      if (count > maxCount) {
        maxCount = count
        mostCommon = diff
      }
    }

    return mostCommon
  }

  /**
   * Apply page offset to all TOC entries that have page numbers.
   * Converts TOC page numbers to physical PDF page indices.
   */
  private applyPageOffset(entries: TocEntry[], offset: number): TocEntry[] {
    if (offset === 0) return entries

    return entries.map((entry) => {
      if (entry.page !== undefined) {
        return {
          ...entry,
          physicalIndex: entry.page + offset,
        }
      }
      return entry
    })
  }

  /**
   * Fix incorrect TOC entries by re-searching for them
   */
  async fixIncorrectEntries(
    entries: TocEntry[],
    incorrect: TocEntry[],
    pages: PageInfo[],
    maxAttempts: number = 3
  ): Promise<TocEntry[]> {
    let incorrectTitles = new Set(incorrect.map((e) => e.title))
    const result = [...entries]

    // Pre-compute searchPages once (same for all entries)
    const searchPages = pages.map((p) => ({
      index: p.index,
      content: truncateToTokens(p.text, 500),
    }))

    for (let attempt = 0; attempt < maxAttempts && incorrectTitles.size > 0; attempt++) {
      // Find indices of incorrect entries
      const indicesToFix = result
        .map((entry, i) => (entry && incorrectTitles.has(entry.title) ? i : -1))
        .filter((i) => i !== -1)

      // Fix ALL incorrect entries in parallel
      const fixResults = await Promise.all(
        indicesToFix.map(async (entryIndex) => {
          const entry = result[entryIndex]!

          // Re-search for this entry
          const { system, user } = pageMatchPrompt(entry.title, searchPages)
          const match = await this.llm.chatJSON(system, user, PageMatchSchema)

          const fixedEntry: TocEntry = {
            ...entry,
            physicalIndex: match.pageIndex,
            appearStart: match.appearsAtStart ? 'yes' : 'no',
          }

          // Verify the fix
          const page = pages[match.pageIndex]
          let verified = false
          if (page) {
            const verifyPrompt = titleVerificationPrompt(
              entry.title,
              truncateToTokens(page.text, 2000)
            )
            const verification = await this.llm.chatJSON(
              verifyPrompt.system,
              verifyPrompt.user,
              TitleVerificationSchema
            )
            verified = verification.found
          }

          return { entryIndex, fixedEntry, verified }
        })
      )

      // Apply fixes and track still-incorrect
      const stillIncorrect: string[] = []
      for (const { entryIndex, fixedEntry, verified } of fixResults) {
        result[entryIndex] = fixedEntry
        if (!verified) {
          stillIncorrect.push(fixedEntry.title)
        }
      }

      if (stillIncorrect.length === 0) break
      incorrectTitles = new Set(stillIncorrect)
    }

    return result
  }

  /**
   * Generate tree from content (no TOC available)
   */
  async generateTreeFromContent(pages: PageInfo[]): Promise<TocEntry[]> {
    const entries: TocEntry[] = []

    // Group pages by token count
    const groups = this.groupPagesByTokens(pages)

    for (const group of groups) {
      const content = group.pages.map((p) => p.text).join('\n\n---\n\n')
      const { system, user } = sectionExtractionPrompt(
        truncateToTokens(content, 15000),
        { start: group.startPage, end: group.endPage }
      )

      const result = await this.llm.chatJSON(
        system,
        user,
        SectionExtractionSchema
      )

      for (const section of result.sections) {
        entries.push({
          structure: section.structure,
          title: section.title,
          physicalIndex: section.startPage,
          appearStart: 'yes',
        })
      }
    }

    return entries
  }

  /**
   * Group pages by token count
   */
  private groupPagesByTokens(
    pages: PageInfo[]
  ): Array<{ pages: PageInfo[]; startPage: number; endPage: number }> {
    const groups: Array<{
      pages: PageInfo[]
      startPage: number
      endPage: number
    }> = []

    let currentGroup: PageInfo[] = []
    let currentTokens = 0
    let groupStart = 0

    for (const page of pages) {
      if (
        currentTokens + page.tokenCount > this.options.maxTokensPerNode &&
        currentGroup.length > 0
      ) {
        groups.push({
          pages: currentGroup,
          startPage: groupStart,
          endPage: page.index - 1,
        })
        currentGroup = []
        currentTokens = 0
        groupStart = page.index
      }

      currentGroup.push(page)
      currentTokens += page.tokenCount
    }

    if (currentGroup.length > 0) {
      groups.push({
        pages: currentGroup,
        startPage: groupStart,
        endPage: pages[pages.length - 1]?.index ?? groupStart,
      })
    }

    return groups
  }

  /**
   * Convert TOC entries to tree structure
   */
  tocEntriesToTree(entries: TocEntry[]): TreeNode[] {
    if (entries.length === 0) return []

    const tree: TreeNode[] = []
    const stack: Array<{ node: TreeNode; structure: string }> = []
    let nodeId = 0

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      if (!entry) continue

      const nextEntry = entries[i + 1]
      // If next section starts at beginning of its page, end before it.
      // If next section starts mid-page, this section includes that page too.
      const endIndex = nextEntry
        ? nextEntry.appearStart === 'yes'
          ? nextEntry.physicalIndex - 1
          : nextEntry.physicalIndex
        : entry.physicalIndex

      const treeNode: TreeNode = {
        title: entry.title,
        nodeId: String(nodeId++).padStart(4, '0'),
        startIndex: entry.physicalIndex,
        endIndex: Math.max(endIndex, entry.physicalIndex),
        nodes: [],
      }

      // Determine parent based on structure

      // Pop stack until we find parent or empty
      while (stack.length > 0) {
        const top = stack[stack.length - 1]
        if (top && entry.structure.startsWith(top.structure + '.')) {
          break
        }
        stack.pop()
      }

      if (stack.length === 0) {
        tree.push(treeNode)
      } else {
        const parent = stack[stack.length - 1]!.node
        parent.nodes = parent.nodes ?? []
        parent.nodes.push(treeNode)
      }

      stack.push({ node: treeNode, structure: entry.structure })
    }

    // Clean up empty nodes arrays
    this.cleanEmptyNodes(tree)

    return tree
  }

  /**
   * Add a preface node if there's content before the first TOC entry
   * This captures orphaned pages (cover, title page, copyright, etc.)
   */
  private addPrefaceIfNeeded(entries: TocEntry[]): TocEntry[] {
    if (entries.length === 0) return entries

    const firstEntry = entries[0]!

    // Check if first entry starts after page 0 (0-indexed)
    if (firstEntry.physicalIndex > 0) {
      const prefaceNode: TocEntry = {
        structure: '0', // Before "1" in hierarchy
        title: 'Preface',
        physicalIndex: 0, // Starts at page 0
        appearStart: 'yes',
      }
      return [prefaceNode, ...entries]
    }

    return entries
  }

  private cleanEmptyNodes(nodes: TreeNode[]): void {
    for (const node of nodes) {
      if (node.nodes && node.nodes.length === 0) {
        delete node.nodes
      } else if (node.nodes) {
        this.cleanEmptyNodes(node.nodes)
      }
    }
  }

  /**
   * Recursively split nodes that exceed both page and token thresholds
   */
  async processLargeNodeRecursively(
    node: TreeNode,
    pages: PageInfo[],
    nodeIdCounter: { value: number }
  ): Promise<void> {
    // Calculate node's page span and token count
    const nodePages = pages.slice(node.startIndex, node.endIndex + 1)
    const tokenCount = nodePages.reduce((sum, p) => sum + p.tokenCount, 0)
    const pageSpan = node.endIndex - node.startIndex + 1

    // Check if node exceeds BOTH thresholds
    const exceedsPageLimit = pageSpan > this.options.maxPagesPerNode
    const exceedsTokenLimit = tokenCount >= this.options.maxTokensPerNode

    if (exceedsPageLimit && exceedsTokenLimit) {
      // Extract sub-structure from this node's content
      const subEntries = await this.extractSubSections(nodePages, node.startIndex)

      if (subEntries.length > 0) {
        // Handle "preface pattern": first extracted title matches current node
        const firstMatchesTitle =
          subEntries[0]?.title.trim().toLowerCase() === node.title.trim().toLowerCase()

        const entriesToUse = firstMatchesTitle ? subEntries.slice(1) : subEntries

        if (entriesToUse.length > 0) {
          // Convert entries to child nodes
          node.nodes = this.entriesToChildNodes(entriesToUse, node.endIndex, nodeIdCounter)

          // Update current node's end_index to first child's start - 1
          const firstChildStart = entriesToUse[0]!.physicalIndex
          if (firstChildStart > node.startIndex) {
            node.endIndex = firstChildStart - 1
          }
        }
      }
    }

    // Recursively process children IN PARALLEL
    if (node.nodes && node.nodes.length > 0) {
      await Promise.all(
        node.nodes.map((child) =>
          this.processLargeNodeRecursively(child, pages, nodeIdCounter)
        )
      )
    }
  }

  /**
   * Extract sub-sections from a node's page content
   */
  private async extractSubSections(
    nodePages: PageInfo[],
    startOffset: number
  ): Promise<TocEntry[]> {
    const content = nodePages
      .map((p) => `<page_${p.index + 1}>\n${p.text}\n</page_${p.index + 1}>`)
      .join('\n\n')

    const { system, user } = sectionExtractionPrompt(
      truncateToTokens(content, 15000),
      { start: startOffset, end: startOffset + nodePages.length - 1 }
    )

    const result = await this.llm.chatJSON(system, user, SectionExtractionSchema)

    return result.sections.map((section, idx) => ({
      structure: String(idx + 1),
      title: section.title,
      physicalIndex: section.startPage,
      appearStart: 'yes' as const,
    }))
  }

  /**
   * Convert TOC entries to child TreeNodes
   */
  private entriesToChildNodes(
    entries: TocEntry[],
    parentEndIndex: number,
    nodeIdCounter: { value: number }
  ): TreeNode[] {
    const nodes: TreeNode[] = []

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!
      const nextEntry = entries[i + 1]
      // Respect appearStart when calculating end index
      const endIndex = nextEntry
        ? nextEntry.appearStart === 'yes'
          ? nextEntry.physicalIndex - 1
          : nextEntry.physicalIndex
        : parentEndIndex

      nodes.push({
        title: entry.title,
        nodeId: String(nodeIdCounter.value++).padStart(4, '0'),
        startIndex: entry.physicalIndex,
        endIndex: Math.max(endIndex, entry.physicalIndex),
      })
    }

    return nodes
  }

  /**
   * Process PDF and generate tree with verification
   */
  async process(pdfData: ArrayBuffer): Promise<{
    tree: TreeNode[]
    pages: PageInfo[]
  }> {
    // Extract pages
    const pages = await this.extractPages(pdfData)

    // Check for TOC
    const tocResult = await this.detectToc(pages)

    let entries: TocEntry[]
    let mode: 'toc_with_pages' | 'toc_no_pages' | 'no_toc'

    if (tocResult.hasToc) {
      // Try to extract and resolve TOC entries
      entries = await this.extractTocEntries(tocResult.tocContent)

      // Check if entries have page numbers
      const hasPageNumbers = entries.some((e) => e.page !== undefined)
      mode = hasPageNumbers ? 'toc_with_pages' : 'toc_no_pages'

      entries = await this.findPageNumbers(entries, pages)

      // Calculate and apply page offset for entries with TOC page numbers
      // This corrects for cover pages, TOC pages, etc. that shift page numbering
      if (hasPageNumbers) {
        const offset = this.calculatePageOffset(entries)
        if (offset !== 0) {
          // Re-apply offset to entries where individual verification might have been wrong
          entries = this.applyPageOffset(entries, offset)
        }
      }
    } else {
      // Generate structure from content
      mode = 'no_toc'
      entries = await this.generateTreeFromContent(pages)
    }

    // Verify and fix entries (like original verify_toc + fix_incorrect_toc_with_retries)
    const verification = await this.verifyToc(entries, pages, 10)

    if (verification.accuracy < 1.0 && verification.incorrect.length > 0) {
      if (verification.accuracy >= 0.6) {
        // Try to fix incorrect entries
        entries = await this.fixIncorrectEntries(
          entries,
          verification.incorrect,
          pages,
          3
        )
      } else if (mode === 'toc_with_pages') {
        // Fallback: Try without page numbers
        entries = await this.generateTreeFromContent(pages)
      } else if (mode === 'toc_no_pages') {
        // Fallback: Generate from content
        entries = await this.generateTreeFromContent(pages)
      }
    }

    // Add preface node if there's content before first TOC entry
    entries = this.addPrefaceIfNeeded(entries)

    // Convert to tree
    const tree = this.tocEntriesToTree(entries)

    // Process large nodes recursively (split if exceeding both thresholds)
    // Find the highest nodeId currently used
    let maxNodeId = 0
    const findMaxNodeId = (nodes: TreeNode[]): void => {
      for (const node of nodes) {
        const id = parseInt(node.nodeId, 10)
        if (id > maxNodeId) maxNodeId = id
        if (node.nodes) findMaxNodeId(node.nodes)
      }
    }
    findMaxNodeId(tree)
    const nodeIdCounter = { value: maxNodeId + 1 }

    await Promise.all(
      tree.map((node) => this.processLargeNodeRecursively(node, pages, nodeIdCounter))
    )

    return { tree, pages }
  }
}

/**
 * Create a PDF processor
 */
export function createPdfProcessor(
  model: LanguageModel,
  options?: PdfProcessingOptions
): PdfProcessor {
  return new PdfProcessor(model, options)
}

/**
 * Quick function to extract PDF text
 */
export async function extractPdfText(pdfData: ArrayBuffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(pdfData))
  const { text } = await extractText(pdf, { mergePages: true })
  return Array.isArray(text) ? text.join('\n') : text
}
