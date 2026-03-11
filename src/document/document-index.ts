import type {
	DocumentInput,
	IndexedDocument,
	IndexResult,
} from "../types/document.js";
import type { TreeNode, SearchResult } from "../types/tree.js";
import type { StoredDocument, StoredContent } from "../types/storage.js";
import type { SearchOptions, ContentStorage } from "../types/config.js";
import { DEFAULT_PROCESSING_OPTIONS } from "../types/config.js";
import { StorageKeys } from "../types/storage.js";
import { TreeBuilder } from "../tree/builder.js";
import { TreePostProcessor } from "../tree/postprocess.js";
import { TreeSearchEngine } from "../search/engine.js";
import type {
	DocumentIndex,
	DocumentIndexConfig,
	DocumentSummary,
} from "./types.js";

/**
 * Generate a unique document ID
 */
function generateDocId(name: string): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).substring(2, 8);
	const safeName = name
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "-")
		.substring(0, 20);
	return `${safeName}-${timestamp}-${random}`;
}

/**
 * Create a single-document index
 *
 * This is the Layer 2 API for single-document operations.
 * It provides a focused API for indexing, searching, and retrieving content
 * from a single document, with all storage scoped to that document.
 *
 * @example
 * ```ts
 * import { createDocumentIndex } from 'pageindex'
 * import { openai } from '@ai-sdk/openai'
 * import { createMemoryStorage } from 'pageindex/storage'
 *
 * const docIndex = createDocumentIndex({
 *   model: openai('gpt-4o'),
 *   storage: createMemoryStorage(),
 * })
 *
 * // Index a document
 * const result = await docIndex.index({
 *   name: 'my-document',
 *   type: 'markdown',
 *   content: '# Hello\n\nWorld',
 * })
 *
 * // Search within this document
 * const results = await docIndex.search('What is this about?')
 *
 * // Get document summary for orchestration
 * const summary = await docIndex.getSummary()
 * ```
 */
export function createDocumentIndex(
	config: DocumentIndexConfig,
): DocumentIndex {
	const processingOptions = config.processing ?? {};
	const searchDefaults = config.search ?? {};

	const builder = new TreeBuilder(config.model, processingOptions);
	const postProcessor = new TreePostProcessor(config.model, processingOptions);
	const searchEngine = new TreeSearchEngine(config.model);

	let documentId: string | null = config.documentId ?? null;

	/**
	 * Determine if content should be stored separately based on contentStorage option
	 */
	function shouldStoreSeparately(pageCount: number): boolean {
		const contentStorage: ContentStorage =
			processingOptions.contentStorage ??
			DEFAULT_PROCESSING_OPTIONS.contentStorage;
		const autoThreshold =
			processingOptions.autoStoragePageThreshold ??
			DEFAULT_PROCESSING_OPTIONS.autoStoragePageThreshold;

		if (contentStorage === "inline") {
			return false;
		}
		if (contentStorage === "separate") {
			return true;
		}
		// 'auto': use inline for small docs, separate for large
		return pageCount >= autoThreshold;
	}

	return {
		get documentId() {
			return documentId;
		},

		async index(document: DocumentInput): Promise<IndexResult> {
			const startTime = Date.now();

			// Generate ID if not provided
			if (!documentId) {
				documentId = generateDocId(document.name);
			}

			// Build tree structure
			const buildResult = await builder.build(document);

			// Post-process (summaries, descriptions)
			const processResult = await postProcessor.process(
				buildResult.tree,
				buildResult.pages,
			);

			// Determine content storage strategy
			const storeSeparately = shouldStoreSeparately(
				buildResult.stats.pageCount,
			);

			if (storeSeparately) {
				// Store page content separately
				const contentItems = new Map<string, StoredContent>();
				for (const page of buildResult.pages) {
					const key = StorageKeys.content(documentId, page.index);
					contentItems.set(key, {
						type: "content",
						data: {
							documentId: documentId,
							index: page.index,
							text: page.text,
							tokenCount: page.tokenCount,
						},
						createdAt: new Date(),
						updatedAt: new Date(),
					});
				}
				await config.storage.setMany(contentItems);

				// Strip text from tree nodes (stored separately)
				postProcessor.stripText(processResult.tree);
			}
			// If not storeSeparately, text stays inline in tree nodes

			// Create indexed document
			const indexedDoc: IndexedDocument = {
				id: documentId!,
				name: document.name,
				type: document.type,
				structure: processResult.tree,
				pageCount: buildResult.stats.pageCount,
				tokenCount: buildResult.stats.tokenCount,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			if (processResult.description) {
				indexedDoc.description = processResult.description;
			}

			if (document.metadata) {
				indexedDoc.metadata = document.metadata;
			}

			// Store document
			await config.storage.set(StorageKeys.document(documentId), {
				type: "document",
				data: indexedDoc,
				createdAt: new Date(),
				updatedAt: new Date(),
			});

			const durationMs = Date.now() - startTime;

			return {
				document: indexedDoc,
				stats: {
					...buildResult.stats,
					llmCalls: 0, // TODO: Track this
					llmTokensUsed: 0, // TODO: Track this
					durationMs,
				},
			};
		},

		async search(
			query: string,
			options?: SearchOptions,
		): Promise<SearchResult[]> {
			const tree = await this.getTree();
			if (!tree) return [];

			const mergedOptions = { ...searchDefaults, ...options };
			const results = await searchEngine.search(query, tree, mergedOptions);

			// Populate text content for results
			for (const result of results) {
				if (result.node.text === undefined) {
					result.node.text = await this.getContent(
						result.node.startIndex,
						result.node.endIndex,
					);
				}
			}

			return results;
		},

		async getDocument(): Promise<IndexedDocument | null> {
			if (!documentId) return null;
			const item = await config.storage.get(StorageKeys.document(documentId));
			if (!item || item.type !== "document") return null;
			return (item as StoredDocument).data;
		},

		async getTree(): Promise<TreeNode[] | null> {
			const doc = await this.getDocument();
			return doc?.structure ?? null;
		},

		async getContent(startIndex: number, endIndex: number): Promise<string> {
			if (!documentId) return "";

			const contentKeys: string[] = [];
			for (let i = startIndex; i <= endIndex; i++) {
				contentKeys.push(StorageKeys.content(documentId, i));
			}

			const items = await config.storage.getMany(contentKeys);
			const parts: string[] = [];

			for (let i = startIndex; i <= endIndex; i++) {
				const item = items.get(StorageKeys.content(documentId, i));
				if (item?.type === "content") {
					parts.push((item as StoredContent).data.text);
				}
			}

			return parts.join("\n\n");
		},

		async getSummary(): Promise<DocumentSummary | null> {
			const doc = await this.getDocument();
			if (!doc) return null;

			const summary: DocumentSummary = {
				id: doc.id,
				name: doc.name,
				type: doc.type,
				pageCount: doc.pageCount,
				tokenCount: doc.tokenCount,
				topLevelNodes: doc.structure.map((node) => {
					const entry: { nodeId: string; title: string; summary?: string } = {
						nodeId: node.nodeId,
						title: node.title,
					};
					if (node.summary) {
						entry.summary = node.summary;
					}
					return entry;
				}),
			};

			if (doc.description) {
				summary.description = doc.description;
			}

			return summary;
		},

		async isIndexed(): Promise<boolean> {
			if (!documentId) return false;
			return config.storage.exists(StorageKeys.document(documentId));
		},

		async clear(): Promise<void> {
			if (!documentId) return;

			const doc = await this.getDocument();
			if (!doc) return;

			// Delete content entries (if they exist - they may not if inline storage was used)
			const contentKeys: string[] = [];
			for (let i = 0; i < doc.pageCount; i++) {
				contentKeys.push(StorageKeys.content(documentId, i));
			}
			await config.storage.deleteMany(contentKeys);

			// Delete document
			await config.storage.delete(StorageKeys.document(documentId));

			documentId = null;
		},
	};
}
