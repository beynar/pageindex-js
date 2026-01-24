/**
 * Tool schemas for AI SDK integration.
 *
 * Tools are available directly on PageIndex instances via `pageIndex.tools`.
 *
 * @example
 * ```ts
 * import { createPageIndex, createMemoryStorage } from 'pageindex'
 * import { generateText } from 'ai'
 * import { openai } from '@ai-sdk/openai'
 *
 * const pageIndex = createPageIndex({
 *   model: openai('gpt-4o'),
 *   storage: createMemoryStorage(),
 * })
 *
 * // Index a document
 * await pageIndex.index({ name: 'doc', type: 'markdown', content: '...' })
 *
 * // Use tools with generateText
 * const result = await generateText({
 *   model: openai('gpt-4o'),
 *   tools: pageIndex.tools,
 *   prompt: 'Find information about authentication',
 * })
 * ```
 */

// Re-export schemas for advanced use cases
export * from './schemas.js'

// Re-export types
export type { PageIndexTools } from './internal.js'
