import type { StorageDriver, StoredItem, ListQuery } from './driver.js'

/**
 * Cloudflare KV binding interface
 */
interface KVNamespace {
  get(key: string, options?: { type?: 'text' | 'json' }): Promise<unknown>
  put(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    keys: Array<{ name: string }>
    list_complete: boolean
    cursor?: string
  }>
}

/**
 * Cloudflare KV storage driver
 */
export class CloudflareKVStorage implements StorageDriver {
  constructor(private kv: KVNamespace) {}

  async get(key: string): Promise<StoredItem | null> {
    try {
      const value = await this.kv.get(key, { type: 'json' })
      if (!value) return null

      // Restore Date objects without mutating
      const item = value as StoredItem
      return {
        ...item,
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt),
      }
    } catch (error) {
      console.warn(`[KV] Failed to parse value for key "${key}":`, error)
      return null
    }
  }

  async set(key: string, value: StoredItem): Promise<void> {
    await this.kv.put(key, JSON.stringify(value))
  }

  async delete(key: string): Promise<boolean> {
    try {
      await this.kv.delete(key)
      return true
    } catch {
      return false
    }
  }

  async list(query?: ListQuery): Promise<string[]> {
    const keys: string[] = []
    let cursor: string | undefined

    do {
      const listOptions: { prefix?: string; limit?: number; cursor?: string } = {
        limit: 1000,
      }
      if (query?.prefix) listOptions.prefix = query.prefix
      if (cursor) listOptions.cursor = cursor

      const result = await this.kv.list(listOptions)

      for (const key of result.keys) {
        keys.push(key.name)
      }

      cursor = result.list_complete ? undefined : result.cursor
    } while (cursor)

    // Filter by type if specified
    let filtered = keys
    if (query?.type) {
      filtered = []
      for (const key of keys) {
        const item = await this.get(key)
        if (item?.type === query.type) {
          filtered.push(key)
        }
      }
    }

    // Apply pagination
    const offset = query?.offset ?? 0
    const limit = query?.limit ?? filtered.length

    return filtered.slice(offset, offset + limit)
  }

  async exists(key: string): Promise<boolean> {
    const value = await this.kv.get(key)
    return value !== null
  }

  async getMany(keys: string[]): Promise<Map<string, StoredItem | null>> {
    const result = new Map<string, StoredItem | null>()
    // KV doesn't support batch get, so we fetch in parallel
    await Promise.all(
      keys.map(async (key) => {
        result.set(key, await this.get(key))
      })
    )
    return result
  }

  async setMany(items: Map<string, StoredItem>): Promise<void> {
    // KV doesn't support batch put, so we set in parallel
    await Promise.all(
      Array.from(items.entries()).map(([key, value]) => this.set(key, value))
    )
  }

  async deleteMany(keys: string[]): Promise<number> {
    let count = 0
    await Promise.all(
      keys.map(async (key) => {
        if (await this.delete(key)) {
          count++
        }
      })
    )
    return count
  }
}

/**
 * Create a Cloudflare KV storage driver
 */
export function createKVStorage(kv: KVNamespace): StorageDriver {
  return new CloudflareKVStorage(kv)
}
