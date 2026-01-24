import { encode, decode, encodeChat } from 'gpt-tokenizer'
import { encode as encodeO200k, encodeChat as encodeChatO200k } from 'gpt-tokenizer/encoding/o200k_base'

/**
 * Check if a model uses o200k_base encoding (gpt-4o, o1, o3 models)
 */
function usesO200kEncoding(model?: string): boolean {
  if (!model) return false
  const lowerModel = model.toLowerCase()
  return (
    lowerModel.includes('gpt-4o') ||
    lowerModel.includes('chatgpt-4o') ||
    lowerModel.startsWith('o1') ||
    lowerModel.startsWith('o3')
  )
}

/**
 * Count tokens in a string using GPT tokenizer
 * Uses o200k_base for gpt-4o/o1/o3 models, cl100k_base for others
 *
 * @param text - The text to count tokens for
 * @param model - Optional model name to determine encoding (e.g., 'gpt-4o', 'gpt-4')
 */
export function countTokens(text: string, model?: string): number {
  if (usesO200kEncoding(model)) {
    return encodeO200k(text).length
  }
  return encode(text).length
}

/**
 * Count tokens in chat messages
 * Uses o200k_base for gpt-4o/o1/o3 models, cl100k_base for others
 *
 * @param messages - Array of chat messages
 * @param model - Model name to determine encoding (defaults to 'gpt-4o')
 */
export function countChatTokens(
  messages: Array<{ role: string; content: string }>,
  model: string = 'gpt-4o'
): number {
  const formattedMessages = messages.map((m) => ({
    role: m.role as 'system' | 'user' | 'assistant',
    content: m.content,
  }))

  if (usesO200kEncoding(model)) {
    return encodeChatO200k(formattedMessages, model as 'gpt-4o').length
  }
  return encodeChat(formattedMessages, model as 'gpt-4').length
}

/**
 * Truncate text to fit within token limit
 */
export function truncateToTokens(text: string, maxTokens: number): string {
  const tokens = encode(text)
  if (tokens.length <= maxTokens) {
    return text
  }
  return decode(tokens.slice(0, maxTokens))
}

/**
 * Split text into chunks of approximately equal token count
 */
export function splitIntoChunks(
  text: string,
  maxTokensPerChunk: number
): string[] {
  const tokens = encode(text)

  if (tokens.length <= maxTokensPerChunk) {
    return [text]
  }

  const chunks: string[] = []
  let start = 0

  while (start < tokens.length) {
    const end = Math.min(start + maxTokensPerChunk, tokens.length)
    chunks.push(decode(tokens.slice(start, end)))
    start = end
  }

  return chunks
}

/**
 * Estimate if content fits within token budget
 */
export function fitsInBudget(text: string, budget: number): boolean {
  return countTokens(text) <= budget
}

/**
 * Get token stats for a text
 */
export interface TokenStats {
  tokens: number
  characters: number
  words: number
  avgTokensPerWord: number
}

export function getTokenStats(text: string): TokenStats {
  const tokens = countTokens(text)
  const characters = text.length
  const words = text.split(/\s+/).filter(Boolean).length

  return {
    tokens,
    characters,
    words,
    avgTokensPerWord: words > 0 ? tokens / words : 0,
  }
}
