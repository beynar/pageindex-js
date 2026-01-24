/**
 * Direct LLM test to isolate performance issues
 * Run with: DEBUG=pageindex bun test tests/llm-direct.test.ts
 */
import { describe, test, expect } from 'bun:test'
import * as v from 'valibot'

const hasCerebrasKey = !!process.env.CEREBRAS_API_KEY
const describeCerebras = hasCerebrasKey ? describe : describe.skip

describeCerebras('Direct Cerebras LLM Test', () => {
  test('raw generateText call', async () => {
    const { cerebras } = await import('@ai-sdk/cerebras')
    const { generateText } = await import('ai')

    console.log('Starting raw generateText...')
    const start = Date.now()

    const result = await generateText({
      model: cerebras('gpt-oss-120b'),
      prompt: 'Say "hello" and nothing else.',
      maxTokens: 10,
    })

    console.log(`Raw generateText completed in ${Date.now() - start}ms`)
    console.log('Result:', result.text)

    expect(result.text.toLowerCase()).toContain('hello')
  }, 30000)

  test('raw generateObject call', async () => {
    const { cerebras } = await import('@ai-sdk/cerebras')
    const { generateObject } = await import('ai')
    const { valibotSchema } = await import('@ai-sdk/valibot')

    console.log('Starting raw generateObject...')
    const start = Date.now()

    const result = await generateObject({
      model: cerebras('gpt-oss-120b'),
      prompt: 'Generate a simple greeting.',
      schema: valibotSchema(v.object({
        greeting: v.string(),
      })),
      maxTokens: 50,
    })

    console.log(`Raw generateObject completed in ${Date.now() - start}ms`)
    console.log('Result:', result.object)

    expect(result.object.greeting).toBeDefined()
  }, 30000)

  test('LLMClient chatJSON call', async () => {
    const { cerebras } = await import('@ai-sdk/cerebras')
    const { LLMClient } = await import('../src/llm/client')

    const client = new LLMClient(cerebras('gpt-oss-120b'))

    console.log('Starting LLMClient chatJSON...')
    const start = Date.now()

    const result = await client.chatJSON(
      'You are a helpful assistant.',
      'Generate a simple greeting.',
      v.object({
        greeting: v.string(),
      })
    )

    console.log(`LLMClient chatJSON completed in ${Date.now() - start}ms`)
    console.log('Result:', result)

    expect(result.greeting).toBeDefined()
  }, 30000)

  test('summary generation (like postprocess)', async () => {
    const { cerebras } = await import('@ai-sdk/cerebras')
    const { LLMClient } = await import('../src/llm/client')
    const { NodeSummarySchema, nodeSummaryPrompt } = await import(
      '../src/llm/prompts/summary'
    )

    const client = new LLMClient(cerebras('gpt-oss-120b'))

    console.log('Starting summary generation...')
    const start = Date.now()

    const { system, user } = nodeSummaryPrompt(
      'Authentication',
      'Users authenticate using OAuth 2.0 with JWT tokens.',
      false
    )

    const result = await client.chatJSON(system, user, NodeSummarySchema)

    console.log(`Summary generation completed in ${Date.now() - start}ms`)
    console.log('Result:', result)

    expect(result.summary).toBeDefined()
  }, 30000)
})
