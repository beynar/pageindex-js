import * as v from 'valibot'

/**
 * Schema for node summary generation
 */
export const NodeSummarySchema = v.object({
  thinking: v.string(),
  summary: v.string(),
})

export type NodeSummaryResult = v.InferOutput<typeof NodeSummarySchema>

/**
 * Prompt for generating a summary of a tree node
 */
export function nodeSummaryPrompt(
  title: string,
  content: string,
  hasChildren: boolean
): { system: string; user: string } {
  const summaryType = hasChildren
    ? 'prefix summary (overview of what this section contains)'
    : 'content summary (key information in this section)'

  return {
    system: `You are generating concise summaries for document sections.

Guidelines:
- Keep summaries under 2-3 sentences
- Focus on the main topics and key information
- For parent sections, summarize what subsections cover
- For leaf sections, summarize the actual content
- Be specific rather than generic
- Avoid phrases like "This section discusses..."`,

    user: `Generate a ${summaryType} for this section:

Title: ${title}
${hasChildren ? '(This section has subsections)' : ''}

Content:
---
${content}
---

Provide a concise summary.`,
  }
}

/**
 * Schema for document description
 */
export const DocDescriptionSchema = v.object({
  thinking: v.string(),
  description: v.string(),
  topics: v.array(v.string()),
})

export type DocDescriptionResult = v.InferOutput<typeof DocDescriptionSchema>

/**
 * Prompt for generating document-level description
 */
export function docDescriptionPrompt(
  docName: string,
  sectionTitles: string[]
): { system: string; user: string } {
  return {
    system: `You are generating a one-sentence description of a document.

Guidelines:
- Describe what the document is about in one clear sentence
- Mention the main topics or purpose
- Be specific to this document's content
- Avoid generic descriptions`,

    user: `Generate a one-sentence description for this document:

Document: ${docName}

Main sections:
${sectionTitles.map((t) => `- ${t}`).join('\n')}

Describe what this document covers.`,
  }
}

/**
 * Schema for batch summary (multiple nodes at once)
 */
export const BatchSummarySchema = v.object({
  summaries: v.array(
    v.object({
      nodeId: v.string(),
      summary: v.string(),
    })
  ),
})

export type BatchSummaryResult = v.InferOutput<typeof BatchSummarySchema>

/**
 * Prompt for generating multiple summaries in one call
 */
export function batchSummaryPrompt(
  nodes: Array<{ nodeId: string; title: string; content: string }>
): { system: string; user: string } {
  const nodesText = nodes
    .map(
      (n) => `[Node ${n.nodeId}] ${n.title}
---
${n.content}
---`
    )
    .join('\n\n')

  return {
    system: `You are generating summaries for multiple document sections.

For each section:
- Keep summary under 2-3 sentences
- Focus on key information
- Be specific to the content
- Return summaries matched to node IDs`,

    user: `Generate summaries for these sections:

${nodesText}

Provide a summary for each node ID.`,
  }
}
