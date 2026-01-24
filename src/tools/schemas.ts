import * as v from 'valibot'

/**
 * Schema for search tool input
 */
export const SearchInputSchema = v.object({
  query: v.string(),
  documentId: v.optional(v.string()),
  maxResults: v.optional(v.number()),
  minScore: v.optional(v.number()),
  expertKnowledge: v.optional(v.string()),
})

export type SearchInput = v.InferOutput<typeof SearchInputSchema>

/**
 * Schema for get document tool input
 */
export const GetDocumentInputSchema = v.object({
  documentId: v.string(),
})

export type GetDocumentInput = v.InferOutput<typeof GetDocumentInputSchema>

/**
 * Schema for get node content tool input
 */
export const GetNodeContentInputSchema = v.object({
  documentId: v.string(),
  nodeId: v.string(),
})

export type GetNodeContentInput = v.InferOutput<typeof GetNodeContentInputSchema>

/**
 * Schema for list documents tool input
 */
export const ListDocumentsInputSchema = v.object({})

export type ListDocumentsInput = v.InferOutput<typeof ListDocumentsInputSchema>

/**
 * Schema for retrieve tool input (search + assembled context)
 */
export const RetrieveInputSchema = v.object({
  query: v.string(),
  documentId: v.optional(v.string()),
  maxResults: v.optional(v.number()),
  minScore: v.optional(v.number()),
  expertKnowledge: v.optional(v.string()),
})

export type RetrieveInput = v.InferOutput<typeof RetrieveInputSchema>
