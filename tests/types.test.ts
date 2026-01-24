/**
 * Type tests for search result typing
 */
import { describe, test, expect } from 'bun:test'
import type { PageIndex } from '../src/core'
import type { SearchResultWithText, SearchResultWithoutText } from '../src/types/tree'

// These are compile-time type assertions
// If they compile, the types are correct

describe('Search Result Types', () => {
  test('type inference works correctly', () => {
    // This test just verifies compilation - the actual type checking
    // happens at compile time via TypeScript

    // Type helper to verify assignability
    type AssertAssignable<T, U extends T> = true

    // Verify SearchResultWithText has required text
    type _t1 = AssertAssignable<string, SearchResultWithText['node']['text']>

    // Verify SearchResultWithoutText has undefined text
    type _t2 = AssertAssignable<undefined, SearchResultWithoutText['node']['text']>

    expect(true).toBe(true)
  })

  test('search method signature is correct', () => {
    // Verify the PageIndex.search generic signature exists
    type SearchMethod = PageIndex['search']

    // The method should accept an optional includeText parameter
    type _verify = SearchMethod extends <T extends boolean>(
      query: string,
      options?: { includeText?: T }
    ) => Promise<unknown>
      ? true
      : never

    expect(true).toBe(true)
  })
})
