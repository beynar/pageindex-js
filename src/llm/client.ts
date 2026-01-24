import { generateText, generateObject, type LanguageModel } from 'ai'
import { valibotSchema } from '@ai-sdk/valibot'
import type { GenericSchema, InferOutput } from 'valibot'

/**
 * Finish reason from LLM response
 */
export type FinishReason = 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other' | 'unknown'

/**
 * Result with finish reason for detecting truncated responses
 */
export interface TextResultWithFinishReason {
  text: string
  finishReason: FinishReason
}

/**
 * Chat message for multi-turn conversations
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Options for LLM calls
 */
export interface LLMCallOptions {
  /** Maximum retries on failure */
  maxRetries?: number

  /** Initial backoff delay in ms */
  backoffMs?: number

  /** Temperature (0 = deterministic) */
  temperature?: number

  /** Maximum tokens in response */
  maxTokens?: number

  /** Abort signal for cancellation */
  abortSignal?: AbortSignal
}

const DEFAULT_OPTIONS: Required<Omit<LLMCallOptions, 'abortSignal'>> = {
  maxRetries: 3,
  backoffMs: 500,
  temperature: 0,
  maxTokens: 4096,
}

// Debug logging (enable via DEBUG=pageindex)
const DEBUG = process.env.DEBUG?.includes('pageindex') ?? false
function debug(...args: unknown[]) {
  if (DEBUG) console.log('[pageindex]', ...args)
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Execute with retry logic
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  options: Required<Omit<LLMCallOptions, 'abortSignal'>> & {
    abortSignal?: AbortSignal
  },
  label?: string
): Promise<T> {
  let lastError: Error | undefined
  const start = Date.now()

  for (let attempt = 0; attempt < options.maxRetries; attempt++) {
    try {
      if (options.abortSignal?.aborted) {
        throw new Error('Aborted')
      }
      debug(`${label ?? 'LLM'} attempt ${attempt + 1}...`)
      const result = await fn()
      debug(`${label ?? 'LLM'} completed in ${Date.now() - start}ms`)
      return result
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      debug(`${label ?? 'LLM'} error:`, lastError.message)

      // Don't retry on abort
      if (options.abortSignal?.aborted) {
        throw lastError
      }

      // Don't retry on non-retryable errors
      if (isNonRetryableError(lastError)) {
        throw lastError
      }

      // Exponential backoff
      const delay = options.backoffMs * Math.pow(2, attempt)
      debug(`${label ?? 'LLM'} retrying in ${delay}ms...`)
      await sleep(delay)
    }
  }

  throw lastError ?? new Error('Max retries exceeded')
}

/**
 * Check if error should not be retried
 */
function isNonRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase()
  return (
    message.includes('invalid api key') ||
    message.includes('authentication') ||
    message.includes('unauthorized') ||
    message.includes('invalid request')
  )
}

/**
 * Build call options, only including abortSignal if defined
 */
function buildCallOptions(
  opts: Required<Omit<LLMCallOptions, 'abortSignal'>> & {
    abortSignal?: AbortSignal
  }
) {
  const base = {
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
  }

  if (opts.abortSignal) {
    return { ...base, abortSignal: opts.abortSignal }
  }

  return base
}

/**
 * LLM client wrapper with retry logic
 */
export class LLMClient {
  constructor(
    private model: LanguageModel,
    private defaultOptions: LLMCallOptions = {}
  ) {}

  /**
   * Generate text completion
   */
  async generateText(
    prompt: string,
    options?: LLMCallOptions
  ): Promise<string> {
    const opts = { ...DEFAULT_OPTIONS, ...this.defaultOptions, ...options }

    return withRetry(async () => {
      const result = await generateText({
        model: this.model,
        prompt,
        ...buildCallOptions(opts),
      })
      return result.text
    }, opts)
  }

  /**
   * Generate text with system + user messages
   */
  async chat(
    system: string,
    user: string,
    options?: LLMCallOptions
  ): Promise<string> {
    const opts = { ...DEFAULT_OPTIONS, ...this.defaultOptions, ...options }

    return withRetry(async () => {
      const result = await generateText({
        model: this.model,
        system,
        prompt: user,
        ...buildCallOptions(opts),
      })
      return result.text
    }, opts)
  }

  /**
   * Generate structured JSON output with Valibot schema validation
   */
  async generateJSON<TSchema extends GenericSchema>(
    prompt: string,
    schema: TSchema,
    options?: LLMCallOptions
  ): Promise<InferOutput<TSchema>> {
    const opts = { ...DEFAULT_OPTIONS, ...this.defaultOptions, ...options }

    return withRetry(async () => {
      const result = await generateObject({
        model: this.model,
        prompt,
        schema: valibotSchema(schema),
        ...buildCallOptions(opts),
      })
      return result.object as InferOutput<TSchema>
    }, opts)
  }

  /**
   * Generate structured JSON with system + user messages using Valibot schema
   */
  async chatJSON<TSchema extends GenericSchema>(
    system: string,
    user: string,
    schema: TSchema,
    options?: LLMCallOptions
  ): Promise<InferOutput<TSchema>> {
    const opts = { ...DEFAULT_OPTIONS, ...this.defaultOptions, ...options }

    return withRetry(async () => {
      const result = await generateObject({
        model: this.model,
        system,
        prompt: user,
        schema: valibotSchema(schema),
        ...buildCallOptions(opts),
      })
      return result.object as InferOutput<TSchema>
    }, opts, 'chatJSON')
  }

  /**
   * Generate text with finish reason for detecting truncated responses.
   * Use this when you need to detect if the response was cut off due to max tokens.
   */
  async generateTextWithFinishReason(
    prompt: string,
    options?: LLMCallOptions
  ): Promise<TextResultWithFinishReason> {
    const opts = { ...DEFAULT_OPTIONS, ...this.defaultOptions, ...options }

    return withRetry(async () => {
      const result = await generateText({
        model: this.model,
        prompt,
        ...buildCallOptions(opts),
      })
      return {
        text: result.text,
        finishReason: result.finishReason as FinishReason,
      }
    }, opts, 'generateTextWithFinishReason')
  }

  /**
   * Generate text with finish reason using system + user messages
   */
  async chatWithFinishReason(
    system: string,
    user: string,
    options?: LLMCallOptions
  ): Promise<TextResultWithFinishReason> {
    const opts = { ...DEFAULT_OPTIONS, ...this.defaultOptions, ...options }

    return withRetry(async () => {
      const result = await generateText({
        model: this.model,
        system,
        prompt: user,
        ...buildCallOptions(opts),
      })
      return {
        text: result.text,
        finishReason: result.finishReason as FinishReason,
      }
    }, opts, 'chatWithFinishReason')
  }

  /**
   * Generate text with full message history for multi-turn conversations.
   * Use this for continuing truncated responses or maintaining conversation context.
   */
  async chatWithHistory(
    messages: ChatMessage[],
    options?: LLMCallOptions
  ): Promise<string> {
    const opts = { ...DEFAULT_OPTIONS, ...this.defaultOptions, ...options }

    return withRetry(async () => {
      const result = await generateText({
        model: this.model,
        messages,
        ...buildCallOptions(opts),
      })
      return result.text
    }, opts, 'chatWithHistory')
  }

  /**
   * Generate text with message history and finish reason.
   * Use this for continuing truncated responses while detecting further truncation.
   */
  async chatWithHistoryAndFinishReason(
    messages: ChatMessage[],
    options?: LLMCallOptions
  ): Promise<TextResultWithFinishReason> {
    const opts = { ...DEFAULT_OPTIONS, ...this.defaultOptions, ...options }

    return withRetry(async () => {
      const result = await generateText({
        model: this.model,
        messages,
        ...buildCallOptions(opts),
      })
      return {
        text: result.text,
        finishReason: result.finishReason as FinishReason,
      }
    }, opts, 'chatWithHistoryAndFinishReason')
  }
}

/**
 * Create an LLM client
 */
export function createLLMClient(
  model: LanguageModel,
  options?: LLMCallOptions
): LLMClient {
  return new LLMClient(model, options)
}
