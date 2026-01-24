import type { LanguageModel } from 'ai'
import type { TreeNode } from '../types/tree.js'
import type { ProcessingOptions } from '../types/config.js'
import { LLMClient } from '../llm/client.js'
import {
  NodeSummarySchema,
  DocDescriptionSchema,
  nodeSummaryPrompt,
  docDescriptionPrompt,
} from '../llm/prompts/summary.js'
import { countTokens } from '../llm/tokens.js'
import { getAllNodes, isLeafNode } from './navigation.js'

/**
 * Post-processor for tree enrichment
 */
export class TreePostProcessor {
  private llm: LLMClient

  constructor(
    model: LanguageModel,
    private options: ProcessingOptions
  ) {
    this.llm = new LLMClient(model)
  }

  /**
   * Apply all post-processing steps to the tree
   */
  async process(
    tree: TreeNode[],
    pages: Array<{ index: number; text: string; tokenCount: number; nodeId?: string }>
  ): Promise<{
    tree: TreeNode[]
    description?: string
  }> {
    // Always add text to nodes (needed for summary generation)
    // Text may be stripped later by core.ts if using separate storage
    this.addTextToNodes(tree, pages)

    // Generate summaries if enabled
    if (this.options.addNodeSummary) {
      await this.generateSummaries(tree)
    }

    // Generate document description if enabled
    if (this.options.addDocDescription) {
      const description = await this.generateDocDescription(tree)
      return { tree, description }
    }

    return { tree }
  }

  /**
   * Add text content to tree nodes
   * Uses nodeId for proper mapping (works for both markdown and PDF)
   */
  private addTextToNodes(
    tree: TreeNode[],
    pages: Array<{ index: number; text: string; tokenCount: number; nodeId?: string }>
  ): void {
    // Check if pages have nodeId (markdown) or use index (PDF)
    const hasNodeIds = pages.some((p) => p.nodeId !== undefined)

    if (hasNodeIds) {
      // Markdown: use nodeId for mapping
      const pageMap = new Map(pages.filter((p) => p.nodeId).map((p) => [p.nodeId!, p.text]))

      function addTextByNodeId(node: TreeNode): void {
        const pageText = pageMap.get(node.nodeId)
        if (pageText !== undefined) {
          node.text = pageText
        }

        if (node.nodes) {
          for (const child of node.nodes) {
            addTextByNodeId(child)
          }
        }
      }

      for (const node of tree) {
        addTextByNodeId(node)
      }
    } else {
      // PDF: use page index for mapping (startIndex/endIndex are page numbers)
      const pageMap = new Map(pages.map((p) => [p.index, p.text]))

      function addTextByIndex(node: TreeNode): void {
        const textParts: string[] = []
        for (let i = node.startIndex; i <= node.endIndex; i++) {
          const pageText = pageMap.get(i)
          if (pageText) {
            textParts.push(pageText)
          }
        }
        node.text = textParts.join('\n\n')

        if (node.nodes) {
          for (const child of node.nodes) {
            addTextByIndex(child)
          }
        }
      }

      for (const node of tree) {
        addTextByIndex(node)
      }
    }
  }

  /**
   * Generate summaries for all nodes
   */
  async generateSummaries(tree: TreeNode[]): Promise<void> {
    const threshold = this.options.summaryTokenThreshold ?? 200

    // Collect nodes that need summaries
    const nodesToSummarize = getAllNodes(tree).filter((node) => {
      const content = node.text ?? ''
      return countTokens(content) >= threshold
    })

    // Generate summaries concurrently (with configurable batch size)
    const concurrency = this.options.summaryBatchSize ?? 15
    for (let i = 0; i < nodesToSummarize.length; i += concurrency) {
      const batch = nodesToSummarize.slice(i, i + concurrency)
      await Promise.all(
        batch.map(async (node) => {
          const summary = await this.generateNodeSummary(node)
          if (isLeafNode(node)) {
            node.summary = summary
          } else {
            node.prefixSummary = summary
          }
        })
      )
    }
  }

  /**
   * Generate summary for a single node
   */
  private async generateNodeSummary(node: TreeNode): Promise<string> {
    const content = node.text ?? ''
    const hasChildren = !isLeafNode(node)

    const { system, user } = nodeSummaryPrompt(node.title, content, hasChildren)
    const result = await this.llm.chatJSON(system, user, NodeSummarySchema)

    return result.summary
  }

  /**
   * Generate document-level description
   */
  async generateDocDescription(tree: TreeNode[]): Promise<string> {
    // Get top-level section titles
    const titles = tree.map((node) => node.title)

    const { system, user } = docDescriptionPrompt('document', titles)
    const result = await this.llm.chatJSON(system, user, DocDescriptionSchema)

    return result.description
  }

  /**
   * Assign sequential node IDs
   */
  assignNodeIds(tree: TreeNode[]): void {
    let counter = 0

    function assign(nodes: TreeNode[]): void {
      for (const node of nodes) {
        node.nodeId = String(counter++).padStart(4, '0')
        if (node.nodes) {
          assign(node.nodes)
        }
      }
    }

    assign(tree)
  }

  /**
   * Remove text from nodes (for separate storage mode)
   */
  stripText(tree: TreeNode[]): void {
    function strip(node: TreeNode): void {
      delete node.text
      if (node.nodes) {
        for (const child of node.nodes) {
          strip(child)
        }
      }
    }

    for (const node of tree) {
      strip(node)
    }
  }
}

/**
 * Create a post-processor
 */
export function createPostProcessor(
  model: LanguageModel,
  options: ProcessingOptions
): TreePostProcessor {
  return new TreePostProcessor(model, options)
}
