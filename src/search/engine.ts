import type { LanguageModel } from 'ai'
import type { TreeNode, SearchResult } from '../types/tree.js'
import type { SearchOptions } from '../types/config.js'
import { LLMClient } from '../llm/client.js'
import {
  TreeSearchSchema,
  RelevanceScoreSchema,
  treeSearchPrompt,
  relevanceScorePrompt,
  formatTreeForPrompt,
  type TreeSearchPromptOptions,
} from '../llm/prompts/search.js'
import {
  getAllNodes,
  findNodeById,
  getNodePath,
  treeToFlatList,
} from '../tree/navigation.js'

/**
 * Search engine for tree-based document retrieval
 */
export class TreeSearchEngine {
  private llm: LLMClient

  constructor(model: LanguageModel) {
    this.llm = new LLMClient(model)
  }

  /**
   * Search the tree structure for relevant nodes
   */
  async search(
    query: string,
    tree: TreeNode[],
    options?: SearchOptions
  ): Promise<SearchResult[]> {
    const maxResults = options?.maxResults ?? 5
    const minScore = options?.minScore ?? 0.5
    const maxDepth = options?.maxDepth ?? Infinity

    // Build prompt options with expert knowledge if provided
    const promptOptions: TreeSearchPromptOptions = {}
    if (options?.expertKnowledge) {
      promptOptions.expertKnowledge = options.expertKnowledge
    }
    if (options?.documentContext) {
      promptOptions.documentContext = options.documentContext
    }

    // Format tree for prompt
    const flatTree = treeToFlatList(tree)
    const treeText = formatTreeForPrompt(
      flatTree
        .filter((n) => n.depth <= maxDepth)
        .map((n) => {
          const item: { nodeId: string; title: string; depth: number; summary?: string } = {
            nodeId: n.node.nodeId,
            title: n.node.title,
            depth: n.depth,
          }
          if (n.node.summary) item.summary = n.node.summary
          return item
        })
    )

    // Initial tree search with expert knowledge
    const { system, user } = treeSearchPrompt(query, treeText, 0, promptOptions)
    const searchResult = await this.llm.chatJSON(system, user, TreeSearchSchema)

    // Collect candidate nodes
    const candidates: Array<{
      nodeId: string
      initialScore: number
      reasoning: string
    }> = []

    for (const relevant of searchResult.relevantNodes) {
      candidates.push({
        nodeId: relevant.nodeId,
        initialScore: relevant.relevance,
        reasoning: relevant.reasoning,
      })
    }

    // Explore ALL marked children in parallel
    const childResultArrays = await Promise.all(
      searchResult.shouldExploreChildren.map(async (nodeId) => {
        const node = findNodeById(tree, nodeId)
        if (!node?.nodes) return []
        return this.searchChildren(query, node.nodes, maxDepth, 1)
      })
    )
    for (const childResults of childResultArrays) {
      candidates.push(...childResults)
    }

    // Score and rank candidates
    const scoredResults = await this.scoreAndRank(
      query,
      candidates,
      tree,
      minScore
    )

    // Return top results
    return scoredResults.slice(0, maxResults)
  }

  /**
   * Search children nodes recursively
   */
  private async searchChildren(
    query: string,
    nodes: TreeNode[],
    maxDepth: number,
    currentDepth: number
  ): Promise<Array<{ nodeId: string; initialScore: number; reasoning: string }>> {
    if (currentDepth >= maxDepth) return []

    const flatTree = treeToFlatList(nodes)
    const treeText = formatTreeForPrompt(
      flatTree.map((n) => {
        const item: { nodeId: string; title: string; depth: number; summary?: string } = {
          nodeId: n.node.nodeId,
          title: n.node.title,
          depth: n.depth,
        }
        if (n.node.summary) item.summary = n.node.summary
        return item
      })
    )

    const { system, user } = treeSearchPrompt(query, treeText, currentDepth)
    const result = await this.llm.chatJSON(system, user, TreeSearchSchema)

    const candidates: Array<{
      nodeId: string
      initialScore: number
      reasoning: string
    }> = []

    for (const relevant of result.relevantNodes) {
      candidates.push({
        nodeId: relevant.nodeId,
        initialScore: relevant.relevance,
        reasoning: relevant.reasoning,
      })
    }

    // Continue exploring in parallel
    const childResultArrays = await Promise.all(
      result.shouldExploreChildren.map(async (nodeId) => {
        const node = findNodeById(nodes, nodeId)
        if (!node?.nodes) return []
        return this.searchChildren(query, node.nodes, maxDepth, currentDepth + 1)
      })
    )
    for (const childResults of childResultArrays) {
      candidates.push(...childResults)
    }

    return candidates
  }

  /**
   * Score and rank candidate nodes
   */
  private async scoreAndRank(
    query: string,
    candidates: Array<{ nodeId: string; initialScore: number; reasoning: string }>,
    tree: TreeNode[],
    minScore: number
  ): Promise<SearchResult[]> {
    // Deduplicate by nodeId, keeping highest initial score
    const uniqueCandidates = new Map<
      string,
      { nodeId: string; initialScore: number; reasoning: string }
    >()

    for (const candidate of candidates) {
      const existing = uniqueCandidates.get(candidate.nodeId)
      if (!existing || existing.initialScore < candidate.initialScore) {
        uniqueCandidates.set(candidate.nodeId, candidate)
      }
    }

    // Score ALL candidates in parallel
    const scoredResults = await Promise.all(
      Array.from(uniqueCandidates.values()).map(async (candidate) => {
        const node = findNodeById(tree, candidate.nodeId)
        if (!node) return null

        // Get detailed relevance score
        const { system, user } = relevanceScorePrompt(
          query,
          node.title,
          node.summary,
          node.text
        )
        const scoreResult = await this.llm.chatJSON(
          system,
          user,
          RelevanceScoreSchema
        )

        // Combine initial and detailed scores
        const finalScore = (candidate.initialScore + scoreResult.score) / 2

        if (finalScore < minScore) return null

        const path = getNodePath(tree, node.nodeId) ?? [node.nodeId]

        return {
          node,
          score: finalScore,
          path,
          reasoning: scoreResult.reasoning,
        }
      })
    )

    // Filter nulls and sort by score descending
    return scoredResults
      .filter((r): r is SearchResult => r !== null)
      .sort((a, b) => b.score - a.score)
  }

  /**
   * Find nodes by simple title matching (fast, no LLM)
   */
  searchByTitle(
    searchTerm: string,
    tree: TreeNode[],
    options?: { caseSensitive?: boolean }
  ): SearchResult[] {
    const caseSensitive = options?.caseSensitive ?? false
    const term = caseSensitive ? searchTerm : searchTerm.toLowerCase()

    const allNodes = getAllNodes(tree)
    const results: SearchResult[] = []

    for (const node of allNodes) {
      const title = caseSensitive ? node.title : node.title.toLowerCase()

      if (title.includes(term)) {
        const path = getNodePath(tree, node.nodeId) ?? [node.nodeId]
        results.push({
          node,
          score: title === term ? 1.0 : 0.8, // Exact match scores higher
          path,
          reasoning: `Title contains "${searchTerm}"`,
        })
      }
    }

    return results.sort((a, b) => b.score - a.score)
  }
}

/**
 * Create a tree search engine
 */
export function createSearchEngine(model: LanguageModel): TreeSearchEngine {
  return new TreeSearchEngine(model)
}
