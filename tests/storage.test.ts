import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createSQLiteStorage } from "../src/storage/sqlite";
import type { StoredItem } from "../src/storage/driver";

describe("SQLiteStorage", () => {
	let storage: ReturnType<typeof createSQLiteStorage>;

	beforeEach(() => {
		storage = createSQLiteStorage(":memory:");
		storage.initialize();
	});

	afterEach(() => {
		storage.close();
	});

	test("get returns null for non-existent key", async () => {
		const result = await storage.get("non-existent");
		expect(result).toBeNull();
	});

	test("set and get work correctly", async () => {
		const item: StoredItem = {
			type: "document",
			data: { test: "data" },
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		await storage.set("key1", item);
		const result = await storage.get("key1");

		expect(result).not.toBeNull();
		expect(result?.type).toBe("document");
		expect(result?.data).toEqual({ test: "data" });
	});

	test("delete removes item", async () => {
		const item: StoredItem = {
			type: "document",
			data: {},
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		await storage.set("key1", item);
		expect(await storage.exists("key1")).toBe(true);

		const deleted = await storage.delete("key1");
		expect(deleted).toBe(true);
		expect(await storage.exists("key1")).toBe(false);
	});

	test("list returns all keys", async () => {
		const item: StoredItem = {
			type: "document",
			data: {},
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		await storage.set("doc:1", item);
		await storage.set("doc:2", item);
		await storage.set("content:1:0", { ...item, type: "content" });

		const allKeys = await storage.list();
		expect(allKeys).toHaveLength(3);
		expect(allKeys).toContain("doc:1");
		expect(allKeys).toContain("doc:2");
		expect(allKeys).toContain("content:1:0");
	});

	test("list with prefix filter", async () => {
		const item: StoredItem = {
			type: "document",
			data: {},
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		await storage.set("doc:1", item);
		await storage.set("doc:2", item);
		await storage.set("content:1:0", { ...item, type: "content" });

		const docKeys = await storage.list({ prefix: "doc:" });
		expect(docKeys).toHaveLength(2);
		expect(docKeys).toContain("doc:1");
		expect(docKeys).toContain("doc:2");
	});

	test("list with type filter", async () => {
		const docItem: StoredItem = {
			type: "document",
			data: {},
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		const contentItem: StoredItem = {
			type: "content",
			data: {},
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		await storage.set("doc:1", docItem);
		await storage.set("content:1:0", contentItem);
		await storage.set("content:1:1", contentItem);

		const contentKeys = await storage.list({ type: "content" });
		expect(contentKeys).toHaveLength(2);
	});

	test("getMany returns map of items", async () => {
		const item1: StoredItem = {
			type: "document",
			data: { id: 1 },
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		const item2: StoredItem = {
			type: "document",
			data: { id: 2 },
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		await storage.set("key1", item1);
		await storage.set("key2", item2);

		const results = await storage.getMany(["key1", "key2", "key3"]);

		expect(results.get("key1")?.data).toEqual({ id: 1 });
		expect(results.get("key2")?.data).toEqual({ id: 2 });
		expect(results.get("key3")).toBeNull();
	});

	test("setMany sets multiple items", async () => {
		const items = new Map<string, StoredItem>([
			[
				"key1",
				{
					type: "document",
					data: { id: 1 },
					createdAt: new Date(),
					updatedAt: new Date(),
				},
			],
			[
				"key2",
				{
					type: "document",
					data: { id: 2 },
					createdAt: new Date(),
					updatedAt: new Date(),
				},
			],
		]);

		await storage.setMany(items);

		expect(await storage.exists("key1")).toBe(true);
		expect(await storage.exists("key2")).toBe(true);
	});

	test("deleteMany removes multiple items", async () => {
		const item: StoredItem = {
			type: "document",
			data: {},
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		await storage.set("key1", item);
		await storage.set("key2", item);
		await storage.set("key3", item);

		const count = await storage.deleteMany(["key1", "key2"]);
		expect(count).toBe(2);
		expect(await storage.exists("key1")).toBe(false);
		expect(await storage.exists("key2")).toBe(false);
		expect(await storage.exists("key3")).toBe(true);
	});

	test("clear removes all items", async () => {
		const item: StoredItem = {
			type: "document",
			data: {},
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		await storage.set("key1", item);
		await storage.set("key2", item);

		await storage.clear();

		const allKeys = await storage.list();
		expect(allKeys).toHaveLength(0);
	});
});

describe("createSQLiteStorage", () => {
	test("creates SQLiteStorage instance", () => {
		const storage = createSQLiteStorage(":memory:");
		expect(storage).toBeDefined();
		storage.close();
	});
});
