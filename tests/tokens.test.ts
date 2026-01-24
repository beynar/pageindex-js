import { describe, test, expect } from 'bun:test'
import {
  countTokens,
  truncateToTokens,
  splitIntoChunks,
  fitsInBudget,
  getTokenStats,
} from '../src/llm/tokens'

describe('Token Utilities', () => {
  describe('countTokens', () => {
    test('counts tokens in simple text', () => {
      const count = countTokens('Hello, world!')
      expect(count).toBeGreaterThan(0)
    })

    test('empty string returns 0', () => {
      expect(countTokens('')).toBe(0)
    })

    test('longer text has more tokens', () => {
      const short = countTokens('Hello')
      const long = countTokens('Hello, this is a longer sentence with more words.')

      expect(long).toBeGreaterThan(short)
    })
  })

  describe('truncateToTokens', () => {
    test('returns original if under limit', () => {
      const text = 'Hello, world!'
      const result = truncateToTokens(text, 1000)
      expect(result).toBe(text)
    })

    test('truncates long text', () => {
      const text = 'This is a very long text. '.repeat(100)
      const result = truncateToTokens(text, 10)

      expect(countTokens(result)).toBeLessThanOrEqual(10)
    })
  })

  describe('splitIntoChunks', () => {
    test('returns single chunk if under limit', () => {
      const text = 'Short text'
      const chunks = splitIntoChunks(text, 1000)

      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toBe(text)
    })

    test('splits long text into multiple chunks', () => {
      const text = 'This is some text. '.repeat(100)
      const chunks = splitIntoChunks(text, 50)

      expect(chunks.length).toBeGreaterThan(1)
      chunks.forEach((chunk) => {
        expect(countTokens(chunk)).toBeLessThanOrEqual(50)
      })
    })
  })

  describe('fitsInBudget', () => {
    test('returns true for text under budget', () => {
      expect(fitsInBudget('Hello', 100)).toBe(true)
    })

    test('returns false for text over budget', () => {
      const longText = 'word '.repeat(1000)
      expect(fitsInBudget(longText, 10)).toBe(false)
    })
  })

  describe('getTokenStats', () => {
    test('returns complete stats', () => {
      const stats = getTokenStats('Hello world, this is a test.')

      expect(stats.tokens).toBeGreaterThan(0)
      expect(stats.characters).toBe(28)
      expect(stats.words).toBe(6)
      expect(stats.avgTokensPerWord).toBeGreaterThan(0)
    })

    test('handles empty string', () => {
      const stats = getTokenStats('')

      expect(stats.tokens).toBe(0)
      expect(stats.characters).toBe(0)
      expect(stats.words).toBe(0)
      expect(stats.avgTokensPerWord).toBe(0)
    })
  })
})
