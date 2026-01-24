import type { StorageDriver, StoredItem, ListQuery } from './driver.js'

/**
 * D1 storage driver for Cloudflare Workers
 * Accepts a D1Database binding directly
 */
export class D1Storage implements StorageDriver {
  constructor(
    private db: D1Database,
    private tableName: string = 'pageindex_storage'
  ) {}

  /**
   * Initialize the storage table
   * Call this once to create the required table and indexes
   */
  async initialize(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        key TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)

    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_type
      ON ${this.tableName} (type)
    `)

    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_key_prefix
      ON ${this.tableName} (key)
    `)
  }

  async get(key: string): Promise<StoredItem | null> {
    const row = await this.db
      .prepare(`SELECT * FROM ${this.tableName} WHERE key = ?`)
      .bind(key)
      .first<D1Row>()

    if (!row) return null
    return this.rowToItem(row)
  }

  async set(key: string, value: StoredItem): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO ${this.tableName} (key, type, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(
        key,
        value.type,
        JSON.stringify(value.data),
        value.createdAt.toISOString(),
        value.updatedAt.toISOString()
      )
      .run()
  }

  async delete(key: string): Promise<boolean> {
    const result = await this.db
      .prepare(`DELETE FROM ${this.tableName} WHERE key = ?`)
      .bind(key)
      .run()

    return result.meta.changes > 0
  }

  async list(query?: ListQuery): Promise<string[]> {
    let sql = `SELECT key FROM ${this.tableName}`
    const params: unknown[] = []
    const conditions: string[] = []

    if (query?.prefix) {
      conditions.push('key LIKE ?')
      params.push(`${query.prefix}%`)
    }

    if (query?.type) {
      conditions.push('type = ?')
      params.push(query.type)
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`
    }

    sql += ' ORDER BY key'

    if (query?.limit) {
      sql += ` LIMIT ?`
      params.push(query.limit)
    }

    if (query?.offset) {
      sql += ` OFFSET ?`
      params.push(query.offset)
    }

    const stmt = this.db.prepare(sql)
    const bound = params.length > 0 ? stmt.bind(...params) : stmt
    const result = await bound.all<{ key: string }>()

    return result.results.map((row) => row.key)
  }

  async exists(key: string): Promise<boolean> {
    const row = await this.db
      .prepare(`SELECT 1 FROM ${this.tableName} WHERE key = ? LIMIT 1`)
      .bind(key)
      .first()

    return row !== null
  }

  async getMany(keys: string[]): Promise<Map<string, StoredItem | null>> {
    const result = new Map<string, StoredItem | null>()

    if (keys.length === 0) {
      return result
    }

    // Initialize all keys with null
    for (const key of keys) {
      result.set(key, null)
    }

    // D1 batch queries for better performance
    const placeholders = keys.map(() => '?').join(', ')
    const queryResult = await this.db
      .prepare(`SELECT * FROM ${this.tableName} WHERE key IN (${placeholders})`)
      .bind(...keys)
      .all<D1Row>()

    for (const row of queryResult.results) {
      result.set(row.key, this.rowToItem(row))
    }

    return result
  }

  async setMany(items: Map<string, StoredItem>): Promise<void> {
    if (items.size === 0) return

    // Use D1 batch for atomic operations
    const statements = Array.from(items.entries()).map(([key, value]) =>
      this.db
        .prepare(
          `INSERT OR REPLACE INTO ${this.tableName} (key, type, data, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(
          key,
          value.type,
          JSON.stringify(value.data),
          value.createdAt.toISOString(),
          value.updatedAt.toISOString()
        )
    )

    await this.db.batch(statements)
  }

  async deleteMany(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0

    const placeholders = keys.map(() => '?').join(', ')
    const result = await this.db
      .prepare(`DELETE FROM ${this.tableName} WHERE key IN (${placeholders})`)
      .bind(...keys)
      .run()

    return result.meta.changes
  }

  async clear(): Promise<void> {
    await this.db.prepare(`DELETE FROM ${this.tableName}`).run()
  }

  private rowToItem(row: D1Row): StoredItem {
    return {
      type: row.type as StoredItem['type'],
      data: JSON.parse(row.data),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }
  }
}

/**
 * D1 row type
 */
interface D1Row {
  key: string
  type: string
  data: string
  created_at: string
  updated_at: string
}

/**
 * Create a D1 storage driver
 *
 * @example
 * ```ts
 * // In your Cloudflare Worker
 * export default {
 *   async fetch(request, env) {
 *     const storage = createD1Storage(env.DB)
 *     await storage.initialize() // Run once to create tables
 *     // ...
 *   }
 * }
 * ```
 */
export function createD1Storage(
  db: D1Database,
  tableName?: string
): D1Storage {
  return new D1Storage(db, tableName)
}
