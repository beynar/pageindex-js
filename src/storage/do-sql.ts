/**
 * SQLite storage driver for Cloudflare Durable Objects
 * Works with the DO's sql property (synchronous SQLite API)
 */
import type { StorageDriver, StoredItem, ListQuery } from "./driver.js";

/**
 * SQL cursor interface - matches Cloudflare's SqlStorageCursor
 */
export interface SqlStorageCursor<T = Record<string, unknown>> {
	toArray(): T[];
	one(): T | null;
	raw(): unknown[][];
	readonly columnNames: string[];
	readonly rowsRead: number;
	readonly rowsWritten: number;
}

/**
 * SQL executor interface - compatible with DO's storage.sql
 */
export interface DOSQLExecutor {
	exec<T = Record<string, unknown>>(
		sql: string,
		...params: unknown[]
	): SqlStorageCursor<T>;
}

export interface DOStorageOptions {
	prefix?: string;
}

/**
 * SQLite row type for DO storage
 */
interface DOSQLiteRow {
	key: string;
	type: string;
	data: string;
	created_at: string;
	updated_at: string;
}

export function createDOStorage(
	sql: DOSQLExecutor,
	options?: DOStorageOptions,
): StorageDriver {
	const prefix = options?.prefix ?? "pageindex_";

	// Validate prefix to prevent SQL injection
	if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(prefix)) {
		throw new Error(
			"Invalid prefix: must start with letter/underscore and contain only alphanumeric/underscore",
		);
	}

	const tableName = `${prefix}storage`;

	// Initialize schema (call this once)
	sql.exec(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      key TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
	sql.exec(
		`CREATE INDEX IF NOT EXISTS idx_${prefix}type ON ${tableName}(type)`,
	);

	// Helper to deserialize row to StoredItem
	function rowToItem(row: DOSQLiteRow): StoredItem | null {
		try {
			return {
				type: row.type as StoredItem["type"],
				data: JSON.parse(row.data),
				createdAt: new Date(row.created_at),
				updatedAt: new Date(row.updated_at),
			};
		} catch (error) {
			console.warn(
				`[DO-SQL] Failed to parse data for key "${row.key}":`,
				error,
			);
			return null;
		}
	}

	return {
		async get(key: string): Promise<StoredItem | null> {
			const row = sql
				.exec<DOSQLiteRow>(`SELECT * FROM ${tableName} WHERE key = ?`, key)
				.one();
			if (!row) return null;
			return rowToItem(row);
		},

		async set(key: string, value: StoredItem): Promise<void> {
			sql.exec(
				`INSERT OR REPLACE INTO ${tableName} (key, type, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
				key,
				value.type,
				JSON.stringify(value.data),
				value.createdAt.toISOString(),
				value.updatedAt.toISOString(),
			);
		},

		async delete(key: string): Promise<boolean> {
			const countRow = sql
				.exec<{
					count: number;
				}>(`SELECT COUNT(*) as count FROM ${tableName} WHERE key = ?`, key)
				.one();
			if (!countRow || countRow.count === 0) return false;
			sql.exec(`DELETE FROM ${tableName} WHERE key = ?`, key);
			return true;
		},

		async list(query?: ListQuery): Promise<string[]> {
			let sqlQuery = `SELECT key FROM ${tableName}`;
			const params: unknown[] = [];
			const conditions: string[] = [];

			if (query?.type) {
				conditions.push("type = ?");
				params.push(query.type);
			}
			if (query?.prefix) {
				conditions.push("key LIKE ?");
				params.push(`${query.prefix}%`);
			}

			if (conditions.length > 0) {
				sqlQuery += ` WHERE ${conditions.join(" AND ")}`;
			}

			sqlQuery += " ORDER BY key";

			if (query?.limit) {
				sqlQuery += " LIMIT ?";
				params.push(query.limit);
			}
			if (query?.offset) {
				sqlQuery += " OFFSET ?";
				params.push(query.offset);
			}

			const rows = sql.exec<{ key: string }>(sqlQuery, ...params).toArray();
			return rows.map((r) => r.key);
		},

		async exists(key: string): Promise<boolean> {
			const countRow = sql
				.exec<{
					count: number;
				}>(`SELECT COUNT(*) as count FROM ${tableName} WHERE key = ?`, key)
				.one();
			return countRow ? countRow.count > 0 : false;
		},

		async getMany(keys: string[]): Promise<Map<string, StoredItem | null>> {
			const result = new Map<string, StoredItem | null>();

			if (keys.length === 0) {
				return result;
			}

			for (const key of keys) {
				result.set(key, await this.get(key));
			}
			return result;
		},

		async setMany(items: Map<string, StoredItem>): Promise<void> {
			if (items.size === 0) return;

			for (const [key, value] of items) {
				await this.set(key, value);
			}
		},

		async deleteMany(keys: string[]): Promise<number> {
			if (keys.length === 0) return 0;

			let deleted = 0;
			for (const key of keys) {
				if (await this.delete(key)) deleted++;
			}
			return deleted;
		},

		async clear(): Promise<void> {
			sql.exec(`DELETE FROM ${tableName}`);
		},
	};
}
