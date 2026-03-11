import type {
	PageIndexConfig,
	ResolvedConfig,
	SearchOptions,
} from "./types/config.js";
import type {
	DocumentInput,
	IndexedDocument,
	IndexResult,
} from "./types/document.js";
import type {
	SearchResultWithText,
	SearchResultWithoutText,
	TreeNode,
} from "./types/tree.js";
import type { StoredDocument } from "./types/storage.js";
import { resolveConfig } from "./types/config.js";
import { StorageKeys } from "./types/storage.js";
import { createTools, type PageIndexTools } from "./tools/internal.js";
import { createDocumentIndex, type DocumentIndex } from "./document/index.js";

/**
 * PageIndex instance interface
 */
export interface PageIndex {
	/**
	 * Index a document and store its tree structure
	 */
	index(document: DocumentInput): Promise<IndexResult>;

	/**
	 * Search indexed documents using LLM reasoning.
	 * By default (includeText: true), fetches full text content for each result.
	 *
	 * @example
	 * ```ts
	 * // Default: text is included
	 * const results = await pageIndex.search(query)
	 * results[0].node.text // string
	 *
	 * // Explicit: skip text fetching
	 * const results = await pageIndex.search(query, { includeText: false })
	 * results[0].node.text // undefined
	 * ```
	 */
	search<TIncludeText extends boolean = true>(
		query: string,
		options?: SearchOptions & { includeText?: TIncludeText },
	): Promise<
		TIncludeText extends false
			? SearchResultWithoutText[]
			: SearchResultWithText[]
	>;

	/**
	 * Search and retrieve content from matching nodes
	 */
	retrieve(
		query: string,
		options?: SearchOptions,
	): Promise<{ results: SearchResultWithText[]; context: string }>;

	/**
	 * Get an indexed document by ID
	 */
	getDocument(id: string): Promise<IndexedDocument | null>;

	/**
	 * Get tree structure for a document
	 */
	getTree(id: string): Promise<TreeNode[] | null>;

	/**
	 * Delete an indexed document
	 */
	deleteDocument(id: string): Promise<boolean>;

	/**
	 * List all indexed documents
	 */
	listDocuments(): Promise<IndexedDocument[]>;

	/**
	 * Get the resolved configuration
	 */
	readonly config: ResolvedConfig;

	/**
	 * AI SDK tools for use with generateText/streamText.
	 * Use these to let an LLM search and retrieve from indexed documents.
	 *
	 * @example
	 * ```ts
	 * const result = await generateText({
	 *   model: openai('gpt-4o'),
	 *   tools: pageIndex.tools,
	 *   prompt: 'Find information about authentication',
	 * })
	 * ```
	 */
	readonly tools: PageIndexTools;
}

// Re-export config type for convenience
export type { PageIndexConfig };

/**
 * Create a PageIndex instance
 *
 * This is a multi-document coordinator that internally uses DocumentIndex
 * instances for each document. For single-document use cases or custom
 * orchestration, consider using createDocumentIndex directly.
 *
 * @example
 * ```ts
 * import { createPageIndex } from 'pageindex'
 * import { openai } from '@ai-sdk/openai'
 * import { createMemoryStorage } from 'pageindex/storage'
 *
 * const pageIndex = createPageIndex({
 *   model: openai('gpt-4o'),
 *   storage: createMemoryStorage(),
 *   processing: {
 *     addNodeSummary: true,
 *     contentStorage: 'auto',
 *   },
 * })
 *
 * // Index a document
 * const result = await pageIndex.index({
 *   name: 'my-document',
 *   type: 'markdown',
 *   content: '# Hello\n\nWorld',
 * })
 *
 * // Search
 * const results = await pageIndex.search('What is this about?')
 * ```
 */
export function createPageIndex(config: PageIndexConfig): PageIndex {
	const resolved = resolveConfig(config);

	// Internal registry of document indexes (lazy-loaded)
	const docIndexes = new Map<string, DocumentIndex>();

	/**
	 * Get or create a DocumentIndex for a given document ID
	 */
	function getDocIndex(docId: string): DocumentIndex {
		if (!docIndexes.has(docId)) {
			docIndexes.set(
				docId,
				createDocumentIndex({
					model: resolved.model,
					storage: resolved.storage,
					processing: resolved.processing,
					search: resolved.search,
					documentId: docId,
				}),
			);
		}
		return docIndexes.get(docId)!;
	}

	// Create the instance first (tools need reference to it)
	const instance: PageIndex = {
		config: resolved,
		tools: null as unknown as PageIndexTools, // Will be set below

		async index(document: DocumentInput): Promise<IndexResult> {
			// Create a new DocumentIndex without a pre-set ID
			// It will generate one during indexing
			const docIndex = createDocumentIndex({
				model: resolved.model,
				storage: resolved.storage,
				processing: resolved.processing,
				search: resolved.search,
			});

			const result = await docIndex.index(document);

			// Cache the index for future operations
			if (docIndex.documentId) {
				docIndexes.set(docIndex.documentId, docIndex);
			}

			return result;
		},

		async search<TIncludeText extends boolean = true>(
			query: string,
			options?: SearchOptions & { includeText?: TIncludeText },
		): Promise<
			TIncludeText extends false
				? SearchResultWithoutText[]
				: SearchResultWithText[]
		> {
			const mergedOptions = { ...resolved.search, ...options };
			const includeText = mergedOptions.includeText ?? true;

			// Get documents to search
			let docsToSearch: IndexedDocument[];
			if (mergedOptions.documentIds && mergedOptions.documentIds.length > 0) {
				const docs = await Promise.all(
					mergedOptions.documentIds.map((id) => this.getDocument(id)),
				);
				docsToSearch = docs.filter((d): d is IndexedDocument => d !== null);
			} else {
				docsToSearch = await this.listDocuments();
			}

			if (docsToSearch.length === 0) {
				return [];
			}

			// Search each document using its DocumentIndex
			type TaggedResult = SearchResultWithText & { _docId: string };
			const allResults: TaggedResult[] = [];

			for (const doc of docsToSearch) {
				const docIndex = getDocIndex(doc.id);
				const results = await docIndex.search(query, {
					...mergedOptions,
					includeText: true, // Always fetch text, we'll strip if needed
				});

				// Tag results with document ID
				for (const result of results) {
					allResults.push({ ...result, _docId: doc.id } as TaggedResult);
				}
			}

			// Sort by score and limit
			allResults.sort((a, b) => b.score - a.score);
			const limitedResults = allResults.slice(0, mergedOptions.maxResults);

			// Strip text if not requested
			if (!includeText) {
				const resultsWithoutText = limitedResults.map(
					({ _docId, ...result }) => ({
						score: result.score,
						path: result.path,
						reasoning: result.reasoning,
						node: {
							title: result.node.title,
							nodeId: result.node.nodeId,
							startIndex: result.node.startIndex,
							endIndex: result.node.endIndex,
							summary: result.node.summary,
							prefixSummary: result.node.prefixSummary,
						},
					}),
				) as SearchResultWithoutText[];
				return resultsWithoutText as TIncludeText extends false
					? SearchResultWithoutText[]
					: SearchResultWithText[];
			}

			// Remove internal _docId and return
			const finalResults: SearchResultWithText[] = limitedResults.map(
				({ _docId, ...result }) => result,
			);
			return finalResults as TIncludeText extends false
				? SearchResultWithoutText[]
				: SearchResultWithText[];
		},

		async retrieve(
			query: string,
			options?: SearchOptions,
		): Promise<{ results: SearchResultWithText[]; context: string }> {
			// Always include text for retrieve
			const results = (await this.search(query, {
				...options,
				includeText: true,
			})) as SearchResultWithText[];

			if (results.length === 0) {
				return { results: [], context: "" };
			}

			// Build context from results
			const contextParts: string[] = [];
			for (const result of results) {
				if (result.node.text) {
					contextParts.push(`## ${result.node.title}\n\n${result.node.text}`);
				}
			}

			return {
				results,
				context: contextParts.join("\n\n---\n\n"),
			};
		},

		async getDocument(id: string): Promise<IndexedDocument | null> {
			const key = StorageKeys.document(id);
			const item = await resolved.storage.get(key);
			if (!item || item.type !== "document") return null;
			return (item as StoredDocument).data;
		},

		async getTree(id: string): Promise<TreeNode[] | null> {
			const doc = await this.getDocument(id);
			return doc?.structure ?? null;
		},

		async deleteDocument(id: string): Promise<boolean> {
			const docIndex = getDocIndex(id);
			const isIndexed = await docIndex.isIndexed();

			if (!isIndexed) return false;

			await docIndex.clear();
			docIndexes.delete(id);

			return true;
		},

		async listDocuments(): Promise<IndexedDocument[]> {
			const keys = await resolved.storage.list({ prefix: "doc:" });
			const items = await resolved.storage.getMany(keys);

			const documents: IndexedDocument[] = [];
			for (const item of items.values()) {
				if (item?.type === "document") {
					documents.push((item as StoredDocument).data);
				}
			}

			return documents;
		},
	};

	// Set up tools with reference to the instance
	(instance as { tools: PageIndexTools }).tools = createTools(instance);

	return instance;
}
