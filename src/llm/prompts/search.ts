import * as v from 'valibot'

/**
 * Schema for tree search reasoning
 */
export const TreeSearchSchema = v.object({
  thinking: v.string(),
  relevantNodes: v.array(
    v.object({
      nodeId: v.string(),
      relevance: v.number(),
      reasoning: v.string(),
    })
  ),
  shouldExploreChildren: v.array(v.string()),
})

export type TreeSearchResult = v.InferOutput<typeof TreeSearchSchema>

/**
 * Options for tree search prompt
 */
export interface TreeSearchPromptOptions {
  /** Expert knowledge or user preferences to guide search */
  expertKnowledge?: string
  /** Additional context about the document type */
  documentContext?: string
}

/**
 * Prompt for reasoning about tree structure to find relevant nodes
 */
export function treeSearchPrompt(
  query: string,
  treeStructure: string,
  currentDepth: number,
  options?: TreeSearchPromptOptions
): { system: string; user: string } {
  const expertSection = options?.expertKnowledge
    ? `\n\nExpert Knowledge for relevant sections:\n${options.expertKnowledge}\n`
    : ''

  const contextSection = options?.documentContext
    ? `\nDocument context: ${options.documentContext}\n`
    : ''

  return {
    system: `You are an expert at navigating document structures to find relevant information.

Given a user query and a document's tree structure (like a table of contents), you need to:
1. Reason about which sections are likely to contain the answer
2. Identify the most relevant nodes
3. Decide if you need to explore child nodes for more detail

Think like a domain expert who knows how to navigate professional documents:
- Consider the query's intent and required information
- Match against section titles and summaries
- Rank by relevance, not just keyword matching
- If a parent node seems relevant, explore its children for specifics
${expertSection}
Current exploration depth: ${currentDepth}`,

    user: `Query: "${query}"
${contextSection}
Document structure:
${treeStructure}

Analyze this structure and identify:
1. Which nodes are most relevant to the query
2. Which nodes should have their children explored for more detail
3. Your reasoning for each choice`,
  }
}

/**
 * Schema for relevance scoring
 */
export const RelevanceScoreSchema = v.object({
  thinking: v.string(),
  score: v.number(),
  reasoning: v.string(),
  isDirectAnswer: v.boolean(),
})

export type RelevanceScoreResult = v.InferOutput<typeof RelevanceScoreSchema>

/**
 * Prompt for scoring the relevance of a specific node to a query
 */
export function relevanceScorePrompt(
  query: string,
  nodeTitle: string,
  nodeSummary: string | undefined,
  nodeContent: string | undefined
): { system: string; user: string } {
  const contextParts = [
    `Title: ${nodeTitle}`,
    nodeSummary ? `Summary: ${nodeSummary}` : '',
    nodeContent ? `Content preview:\n${nodeContent.slice(0, 2000)}` : '',
  ].filter(Boolean)

  return {
    system: `You are evaluating how relevant a document section is to a user query.

Score from 0 to 1:
- 0.0-0.2: Not relevant at all
- 0.2-0.4: Tangentially related
- 0.4-0.6: Somewhat relevant, contains related information
- 0.6-0.8: Relevant, likely contains useful information
- 0.8-1.0: Highly relevant, likely directly answers the query

Consider:
- Does the section topic match the query?
- Would a human expert look here for the answer?
- Is this a direct answer or just context?`,

    user: `Query: "${query}"

Section:
${contextParts.join('\n')}

Score the relevance of this section to the query.`,
  }
}

/**
 * Schema for multi-hop reasoning
 */
export const MultiHopReasoningSchema = v.object({
  thinking: v.string(),
  hops: v.array(
    v.object({
      step: v.number(),
      nodeId: v.string(),
      reasoning: v.string(),
      foundInfo: v.optional(v.string()),
    })
  ),
  finalAnswer: v.object({
    nodeIds: v.array(v.string()),
    confidence: v.number(),
    reasoning: v.string(),
  }),
})

export type MultiHopReasoningResult = v.InferOutput<typeof MultiHopReasoningSchema>

/**
 * Prompt for multi-hop reasoning (complex queries)
 */
export function multiHopReasoningPrompt(
  query: string,
  exploredNodes: Array<{ nodeId: string; title: string; summary?: string }>,
  treeStructure: string
): { system: string; user: string } {
  const exploredText = exploredNodes
    .map((n) => `- [${n.nodeId}] ${n.title}${n.summary ? `: ${n.summary}` : ''}`)
    .join('\n')

  return {
    system: `You are performing multi-hop reasoning to find information in a document.

Some queries require combining information from multiple sections:
- "Compare X and Y" - need to find both X and Y sections
- "How does A affect B" - need A section, B section, and possibly relationships
- "What are all the requirements for X" - may be scattered across sections

Track your reasoning path and identify all relevant sections.`,

    user: `Query: "${query}"

Already explored nodes:
${exploredText || '(none yet)'}

Full document structure:
${treeStructure}

Continue reasoning to find all relevant sections for this query.`,
  }
}

/**
 * Format tree structure for prompts
 */
export function formatTreeForPrompt(
  nodes: Array<{
    nodeId: string
    title: string
    summary?: string
    depth: number
  }>
): string {
  return nodes
    .map((n) => {
      const indent = '  '.repeat(n.depth)
      const summary = n.summary ? ` - ${n.summary}` : ''
      return `${indent}[${n.nodeId}] ${n.title}${summary}`
    })
    .join('\n')
}
