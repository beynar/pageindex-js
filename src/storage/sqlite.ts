import { Database } from 'bun:sqlite'
import type { StorageDriver, StoredItem, ListQuery } from './driver.js'

/**
 * SQLite storage driver using bun:sqlite
 * For local development and testing
 */
export class SQLiteStorage implements StorageDriver {
  private db: Database

  constructor(
    dbPath: string | ':memory:' = ':memory:',
    private tableName: string = 'pageindex_storage'
  ) {
    this.db = new Database(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL')
  }

  /**
   * Initialize the storage table
   * Call this once to create the required table and indexes
   */
  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        key TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_type
      ON ${this.tableName} (type)
    `)

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_key_prefix
      ON ${this.tableName} (key)
    `)
  }

  async get(key: string): Promise<StoredItem | null> {
    const stmt = this.db.prepare<SQLiteRow, [string]>(
      `SELECT * FROM ${this.tableName} WHERE key = ?`
    )
    const row = stmt.get(key)

    if (!row) return null
    return this.rowToItem(row)
  }

  async set(key: string, value: StoredItem): Promise<void> {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO ${this.tableName} (key, type, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    stmt.run(
      key,
      value.type,
      JSON.stringify(value.data),
      value.createdAt.toISOString(),
      value.updatedAt.toISOString()
    )
  }

  async delete(key: string): Promise<boolean> {
    const stmt = this.db.prepare(
      `DELETE FROM ${this.tableName} WHERE key = ?`
    )
    const result = stmt.run(key)
    return result.changes > 0
  }

  async list(query?: ListQuery): Promise<string[]> {
    let sql = `SELECT key FROM ${this.tableName}`
    const params: (string | number)[] = []
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

    const stmt = this.db.prepare<{ key: string }, (string | number)[]>(sql)
    const rows = stmt.all(...params)
    return rows.map((row) => row.key)
  }

  async exists(key: string): Promise<boolean> {
    const stmt = this.db.prepare<{ found: number }, [string]>(
      `SELECT 1 as found FROM ${this.tableName} WHERE key = ? LIMIT 1`
    )
    const row = stmt.get(key)
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

    const placeholders = keys.map(() => '?').join(', ')
    const stmt = this.db.prepare<SQLiteRow, string[]>(
      `SELECT * FROM ${this.tableName} WHERE key IN (${placeholders})`
    )
    const rows = stmt.all(...keys)

    for (const row of rows) {
      result.set(row.key, this.rowToItem(row))
    }

    return result
  }

  async setMany(items: Map<string, StoredItem>): Promise<void> {
    if (items.size === 0) return

    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO ${this.tableName} (key, type, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )

    const transaction = this.db.transaction(() => {
      for (const [key, value] of items) {
        stmt.run(
          key,
          value.type,
          JSON.stringify(value.data),
          value.createdAt.toISOString(),
          value.updatedAt.toISOString()
        )
      }
    })

    transaction()
  }

  async deleteMany(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0

    const placeholders = keys.map(() => '?').join(', ')
    const stmt = this.db.prepare(
      `DELETE FROM ${this.tableName} WHERE key IN (${placeholders})`
    )
    const result = stmt.run(...keys)
    return result.changes
  }

  async clear(): Promise<void> {
    this.db.prepare(`DELETE FROM ${this.tableName}`).run()
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close()
  }

  private rowToItem(row: SQLiteRow): StoredItem | null {
    try {
      return {
        type: row.type as StoredItem['type'],
        data: JSON.parse(row.data),
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
      }
    } catch (error) {
      console.warn(`[SQLite] Failed to parse data for key "${row.key}":`, error)
      return null
    }
  }
}

/**
 * SQLite row type
 */
interface SQLiteRow {
  key: string
  type: string
  data: string
  created_at: string
  updated_at: string
}

/**
 * Create a SQLite storage driver
 *
 * @param dbPath - Path to SQLite database file, or ':memory:' for in-memory
 * @param tableName - Table name for storage (default: 'pageindex_storage')
 *
 * @example
 * ```ts
 * // In-memory database (for testing)
 * const storage = createSQLiteStorage(':memory:')
 * storage.initialize()
 *
 * // File-based database
 * const storage = createSQLiteStorage('./data/pageindex.db')
 * storage.initialize()
 * ```
 */
export function createSQLiteStorage(
  dbPath: string | ':memory:' = ':memory:',
  tableName?: string
): SQLiteStorage {
  return new SQLiteStorage(dbPath, tableName)
}
