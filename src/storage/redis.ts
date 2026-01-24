import type { StorageDriver, StoredItem, ListQuery } from './driver.js'

/**
 * SCAN result from Redis
 */
interface ScanResult {
  cursor: string
  keys: string[]
}

/**
 * Redis client interface (compatible with ioredis, redis, upstash)
 */
interface RedisClient {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<unknown>
  del(key: string | string[]): Promise<number>
  keys(pattern: string): Promise<string[]>
  exists(key: string | string[]): Promise<number>
  mget(...keys: string[]): Promise<(string | null)[]>
  // SCAN support (optional - falls back to KEYS if not available)
  scan?(cursor: string | number, options?: { match?: string; count?: number }): Promise<ScanResult | [string, string[]]>
  scanIterator?(options?: { match?: string; count?: number }): AsyncIterable<string>
}

/**
 * Redis storage driver
 */
export class RedisStorage implements StorageDriver {
  constructor(
    private client: RedisClient,
    private prefix: string = 'pageindex:'
  ) {}

  private prefixKey(key: string): string {
    return `${this.prefix}${key}`
  }

  private unprefixKey(key: string): string {
    return key.startsWith(this.prefix) ? key.slice(this.prefix.length) : key
  }

  /**
   * Get all keys matching pattern using SCAN (non-blocking) or KEYS (fallback)
   * SCAN is preferred for production as it doesn't block the Redis server
   */
  private async getAllKeys(pattern: string): Promise<string[]> {
    // Try scanIterator first (ioredis style)
    if (this.client.scanIterator) {
      const keys: string[] = []
      for await (const key of this.client.scanIterator({ match: pattern, count: 100 })) {
        keys.push(key)
      }
      return keys
    }

    // Try scan method (node-redis / upstash style)
    if (this.client.scan) {
      const keys: string[] = []
      let cursor: string = '0'

      do {
        const result = await this.client.scan(cursor, { match: pattern, count: 100 })
        
        // Handle different response formats
        if (Array.isArray(result)) {
          // node-redis returns [cursor, keys]
          cursor = result[0]
          keys.push(...result[1])
        } else {
          // upstash returns { cursor, keys }
          cursor = result.cursor
          keys.push(...result.keys)
        }
      } while (cursor !== '0')

      return keys
    }

    // Fallback to KEYS (blocking - not recommended for production with large datasets)
    console.warn('[Redis] SCAN not available, falling back to KEYS command (may block on large datasets)')
    return this.client.keys(pattern)
  }

  async get(key: string): Promise<StoredItem | null> {
    try {
      const value = await this.client.get(this.prefixKey(key))
      if (!value) return null

      const item = JSON.parse(value) as StoredItem
      // Restore Date objects without mutating
      return {
        ...item,
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt),
      }
    } catch (error) {
      console.warn(`[Redis] Failed to parse value for key "${key}":`, error)
      return null
    }
  }

  async set(key: string, value: StoredItem): Promise<void> {
    await this.client.set(this.prefixKey(key), JSON.stringify(value))
  }

  async delete(key: string): Promise<boolean> {
    const result = await this.client.del(this.prefixKey(key))
    return result > 0
  }

  async list(query?: ListQuery): Promise<string[]> {
    const pattern = query?.prefix
      ? `${this.prefix}${query.prefix}*`
      : `${this.prefix}*`

    const keys = await this.getAllKeys(pattern)
    let unprefixed = keys.map((k) => this.unprefixKey(k))

    // Filter by type if specified
    if (query?.type) {
      const filtered: string[] = []
      for (const key of unprefixed) {
        const item = await this.get(key)
        if (item?.type === query.type) {
          filtered.push(key)
        }
      }
      unprefixed = filtered
    }

    // Apply pagination
    const offset = query?.offset ?? 0
    const limit = query?.limit ?? unprefixed.length

    return unprefixed.slice(offset, offset + limit)
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(this.prefixKey(key))
    return result > 0
  }

  async getMany(keys: string[]): Promise<Map<string, StoredItem | null>> {
    const result = new Map<string, StoredItem | null>()

    if (keys.length === 0) {
      return result
    }

    const prefixedKeys = keys.map((k) => this.prefixKey(k))
    const values = await this.client.mget(...prefixedKeys)

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      const value = values[i]

      if (key === undefined) continue

      if (value) {
        try {
          const item = JSON.parse(value) as StoredItem
          result.set(key, {
            ...item,
            createdAt: new Date(item.createdAt),
            updatedAt: new Date(item.updatedAt),
          })
        } catch (error) {
          console.warn(`[Redis] Failed to parse value for key "${key}":`, error)
          result.set(key, null)
        }
      } else {
        result.set(key, null)
      }
    }

    return result
  }

  async setMany(items: Map<string, StoredItem>): Promise<void> {
    // Redis doesn't have mset for complex values, so we set in parallel
    await Promise.all(
      Array.from(items.entries()).map(([key, value]) => this.set(key, value))
    )
  }

  async deleteMany(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0
    const prefixedKeys = keys.map((k) => this.prefixKey(k))
    return this.client.del(prefixedKeys)
  }

  async clear(): Promise<void> {
    const keys = await this.getAllKeys(`${this.prefix}*`)
    if (keys.length > 0) {
      await this.client.del(keys)
    }
  }
}

/**
 * Create a Redis storage driver
 */
export function createRedisStorage(
  client: RedisClient,
  prefix?: string
): StorageDriver {
  return new RedisStorage(client, prefix)
}
