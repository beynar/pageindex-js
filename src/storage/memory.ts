import type { StorageDriver, StoredItem, ListQuery } from './driver.js'

/**
 * In-memory storage driver for development and testing
 */
export class MemoryStorage implements StorageDriver {
  private store = new Map<string, StoredItem>()

  async get(key: string): Promise<StoredItem | null> {
    return this.store.get(key) ?? null
  }

  async set(key: string, value: StoredItem): Promise<void> {
    this.store.set(key, value)
  }

  async delete(key: string): Promise<boolean> {
    return this.store.delete(key)
  }

  async list(query?: ListQuery): Promise<string[]> {
    let keys = Array.from(this.store.keys())

    if (query?.prefix) {
      keys = keys.filter((k) => k.startsWith(query.prefix!))
    }

    if (query?.type) {
      keys = keys.filter((k) => {
        const item = this.store.get(k)
        return item?.type === query.type
      })
    }

    // Apply pagination correctly: slice(offset, offset + limit)
    const offset = query?.offset ?? 0
    const limit = query?.limit ?? keys.length

    return keys.slice(offset, offset + limit)
  }

  async exists(key: string): Promise<boolean> {
    return this.store.has(key)
  }

  async getMany(keys: string[]): Promise<Map<string, StoredItem | null>> {
    const result = new Map<string, StoredItem | null>()
    for (const key of keys) {
      result.set(key, this.store.get(key) ?? null)
    }
    return result
  }

  async setMany(items: Map<string, StoredItem>): Promise<void> {
    for (const [key, value] of items) {
      this.store.set(key, value)
    }
  }

  async deleteMany(keys: string[]): Promise<number> {
    let count = 0
    for (const key of keys) {
      if (this.store.delete(key)) {
        count++
      }
    }
    return count
  }

  async clear(): Promise<void> {
    this.store.clear()
  }

  /** Get store size (for testing) */
  get size(): number {
    return this.store.size
  }
}

/**
 * Create an in-memory storage driver
 */
export function createMemoryStorage(): StorageDriver {
  return new MemoryStorage()
}
