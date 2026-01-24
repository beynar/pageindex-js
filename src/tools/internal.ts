import { tool, type Tool } from 'ai'
import { valibotSchema } from '@ai-sdk/valibot'
import type { PageIndex } from '../core.js'
import {
  SearchInputSchema,
  GetDocumentInputSchema,
  GetNodeContentInputSchema,
  ListDocumentsInputSchema,
  RetrieveInputSchema,
  type SearchInput,
  type GetDocumentInput,
  type GetNodeContentInput,
  type RetrieveInput,
} from './schemas.js'
import { findNodeById } from '../tree/navigation.js'

/**
 * AI SDK tools available on PageIndex.tools
 */
export interface PageIndexTools {
  /** Search documents using semantic understanding */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  search: Tool<any, any>
  /** Retrieve content with assembled context */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  retrieve: Tool<any, any>
  /** Get document metadata and structure */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getDocument: Tool<any, any>
  /** Get content of a specific node */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getNodeContent: Tool<any, any>
  /** List all indexed documents */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listDocuments: Tool<any, any>
}

/**
 * Create tools bound to a PageIndex instance
 * @internal
 */
export function createTools(pageIndex: PageIndex): PageIndexTools {
  const searchExecute = async (input: SearchInput) => {
    const { query, documentId, maxResults, minScore, expertKnowledge } = input
    const searchOptions: Parameters<typeof pageIndex.search>[1] = {
      maxResults: maxResults ?? 5,
      minScore: minScore ?? 0.5,
      includeText: true,
    }
    if (documentId) {
      searchOptions.documentIds = [documentId]
    }
    if (expertKnowledge) {
      searchOptions.expertKnowledge = expertKnowledge
    }

    const results = await pageIndex.search(query, searchOptions)

    return results.map((r) => ({
      nodeId: r.node.nodeId,
      title: r.node.title,
      score: r.score,
      reasoning: r.reasoning,
      path: r.path,
      summary: r.node.summary,
      text: r.node.text,
    }))
  }

  const retrieveExecute = async (input: RetrieveInput) => {
    const { query, documentId, maxResults, minScore, expertKnowledge } = input
    const searchOptions: Parameters<typeof pageIndex.retrieve>[1] = {
      maxResults: maxResults ?? 5,
      minScore: minScore ?? 0.5,
    }
    if (documentId) {
      searchOptions.documentIds = [documentId]
    }
    if (expertKnowledge) {
      searchOptions.expertKnowledge = expertKnowledge
    }

    const { results, context } = await pageIndex.retrieve(query, searchOptions)

    return {
      results: results.map((r) => ({
        nodeId: r.node.nodeId,
        title: r.node.title,
        score: r.score,
        reasoning: r.reasoning,
      })),
      context,
    }
  }

  const getDocumentExecute = async (input: GetDocumentInput) => {
    const { documentId } = input
    const doc = await pageIndex.getDocument(documentId)
    if (!doc) {
      return { error: `Document not found: ${documentId}` }
    }

    return {
      id: doc.id,
      name: doc.name,
      type: doc.type,
      description: doc.description,
      pageCount: doc.pageCount,
      tokenCount: doc.tokenCount,
      createdAt: doc.createdAt.toISOString(),
      structure: formatTreeStructure(doc.structure),
    }
  }

  const getNodeContentExecute = async (input: GetNodeContentInput) => {
    const { documentId, nodeId } = input
    const tree = await pageIndex.getTree(documentId)
    if (!tree) {
      return { error: `Document not found: ${documentId}` }
    }

    const node = findNodeById(tree, nodeId)
    if (!node) {
      return { error: `Node not found: ${nodeId}` }
    }

    // Search with specific criteria to get the text content
    const results = await pageIndex.search(node.title, {
      documentIds: [documentId],
      maxResults: 1,
      minScore: 0,
      includeText: true,
    })

    const matchedResult = results.find((r) => r.node.nodeId === nodeId)

    return {
      nodeId: node.nodeId,
      title: node.title,
      summary: node.summary,
      text: matchedResult?.node.text ?? node.text,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }

  const listDocumentsExecute = async () => {
    const docs = await pageIndex.listDocuments()

    return docs.map((doc) => ({
      id: doc.id,
      name: doc.name,
      type: doc.type,
      description: doc.description,
      pageCount: doc.pageCount,
      tokenCount: doc.tokenCount,
      createdAt: doc.createdAt.toISOString(),
    }))
  }

  return {
    search: tool({
      description:
        'Search through indexed documents using semantic understanding. Returns relevant sections with scores and reasoning.',
      parameters: valibotSchema(SearchInputSchema),
      // @ts-expect-error AI SDK tool types incompatible with exactOptionalPropertyTypes
      execute: searchExecute,
    }),

    retrieve: tool({
      description:
        'Search documents and retrieve assembled context from matching nodes. Best for RAG workflows where you need formatted context.',
      parameters: valibotSchema(RetrieveInputSchema),
      // @ts-expect-error AI SDK tool types incompatible with exactOptionalPropertyTypes
      execute: retrieveExecute,
    }),

    getDocument: tool({
      description: 'Get document metadata and tree structure by document ID.',
      parameters: valibotSchema(GetDocumentInputSchema),
      // @ts-expect-error AI SDK tool types incompatible with exactOptionalPropertyTypes
      execute: getDocumentExecute,
    }),

    getNodeContent: tool({
      description: 'Get the full content of a specific node by its ID.',
      parameters: valibotSchema(GetNodeContentInputSchema),
      // @ts-expect-error AI SDK tool types incompatible with exactOptionalPropertyTypes
      execute: getNodeContentExecute,
    }),

    listDocuments: tool({
      description: 'List all indexed documents with their metadata.',
      parameters: valibotSchema(ListDocumentsInputSchema),
      // @ts-expect-error AI SDK tool types incompatible with exactOptionalPropertyTypes
      execute: listDocumentsExecute,
    }),
  }
}

/**
 * Format tree structure for display
 */
function formatTreeStructure(
  nodes: Array<{
    nodeId: string
    title: string
    summary?: string
    nodes?: unknown[]
  }>,
  depth: number = 0
): string {
  const lines: string[] = []

  for (const node of nodes) {
    const indent = '  '.repeat(depth)
    const summary = node.summary ? ` - ${node.summary}` : ''
    lines.push(`${indent}[${node.nodeId}] ${node.title}${summary}`)

    if (node.nodes && Array.isArray(node.nodes)) {
      lines.push(
        formatTreeStructure(
          node.nodes as Array<{
            nodeId: string
            title: string
            summary?: string
            nodes?: unknown[]
          }>,
          depth + 1
        )
      )
    }
  }

  return lines.join('\n')
}
