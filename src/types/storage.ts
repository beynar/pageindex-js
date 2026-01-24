import type { IndexedDocument, PageContent } from './document.js'

/**
 * Stored item types
 */
export type StoredItemType = 'document' | 'content' | 'metadata'

/**
 * Base stored item
 */
export interface StoredItem {
  type: StoredItemType
  data: unknown
  createdAt: Date
  updatedAt: Date
}

/**
 * Stored document
 */
export interface StoredDocument extends StoredItem {
  type: 'document'
  data: IndexedDocument
}

/**
 * Stored page content
 */
export interface StoredContent extends StoredItem {
  type: 'content'
  data: PageContent
}

/**
 * Query for listing items
 */
export interface ListQuery {
  /** Filter by item type */
  type?: StoredItemType

  /** Filter by prefix */
  prefix?: string

  /** Maximum items to return */
  limit?: number

  /** Offset for pagination */
  offset?: number
}

/**
 * Storage driver interface - implement this for custom storage backends
 *
 * Key format conventions:
 * - Documents: `doc:{documentId}`
 * - Content: `content:{documentId}:{pageIndex}`
 * - Metadata: `meta:{key}`
 */
export interface StorageDriver {
  /**
   * Get an item by key
   */
  get(key: string): Promise<StoredItem | null>

  /**
   * Set an item
   */
  set(key: string, value: StoredItem): Promise<void>

  /**
   * Delete an item
   */
  delete(key: string): Promise<boolean>

  /**
   * List keys matching query
   */
  list(query?: ListQuery): Promise<string[]>

  /**
   * Check if key exists
   */
  exists(key: string): Promise<boolean>

  /**
   * Get multiple items by keys
   */
  getMany(keys: string[]): Promise<Map<string, StoredItem | null>>

  /**
   * Set multiple items
   */
  setMany(items: Map<string, StoredItem>): Promise<void>

  /**
   * Delete multiple items
   */
  deleteMany(keys: string[]): Promise<number>

  /**
   * Clear all items (use with caution)
   */
  clear?(): Promise<void>
}

/**
 * Storage key helpers
 */
export const StorageKeys = {
  document: (id: string) => `doc:${id}`,
  content: (docId: string, pageIndex: number) => `content:${docId}:${pageIndex}`,
  metadata: (key: string) => `meta:${key}`,

  parseDocumentKey: (key: string): string | null => {
    const match = key.match(/^doc:(.+)$/)
    return match?.[1] ?? null
  },

  parseContentKey: (key: string): { docId: string; pageIndex: number } | null => {
    const match = key.match(/^content:(.+):(\d+)$/)
    if (!match) return null
    return {
      docId: match[1]!,
      pageIndex: parseInt(match[2]!, 10),
    }
  },
} as const
