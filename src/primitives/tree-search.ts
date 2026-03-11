/**
 * Tree Search Primitive
 *
 * Re-exports the TreeSearchEngine for searching document trees.
 */

export { TreeSearchEngine, createSearchEngine } from '../search/engine.js'

// Re-export SearchResult from types
export type { SearchResult } from '../types/tree.js'
