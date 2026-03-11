/**
 * Core Primitives - Stateless, per-document operations
 *
 * These are the building blocks for custom implementations.
 * Use these when you need fine-grained control over the indexing
 * and search pipeline.
 *
 * @packageDocumentation
 */

// Tree building and processing
export {
	TreeBuilder,
	createTreeBuilder,
	type TreeBuildResult,
} from "../tree/builder.js";

export { TreePostProcessor, createPostProcessor } from "../tree/postprocess.js";

// Search engine
export { TreeSearchEngine, createSearchEngine } from "../search/engine.js";

// Content retrieval
export {
	ContentRetriever,
	createRetriever,
	type RetrievalResult,
	type RetrievalOptions,
} from "../search/retrieval.js";

// Tree navigation utilities
export {
	getAllNodes,
	getLeafNodes,
	findNodeById,
	getNodePath,
	traverseTree,
	isLeafNode,
	getNodeDepth,
	getParentNode,
	getSiblingNodes,
	getAncestorNodes,
	getDescendantNodes,
	countNodes,
	getTreeDepth,
	treeToFlatList,
	getNodesAtDepth,
	findNodesByTitle,
	findNodesContainingPage,
} from "../tree/navigation.js";

// LLM utilities
export {
	countTokens,
	truncateToTokens,
	splitIntoChunks,
} from "../llm/tokens.js";

// Re-export types for convenience
export type {
	TreeNode,
	TreeNodeWithText,
	TreeNodeWithoutText,
	TocEntry,
	SearchResult,
	SearchResultWithText,
	SearchResultWithoutText,
	TreeVisitor,
	TraverseOptions,
} from "../types/tree.js";

export type {
	DocumentInput,
	IndexedDocument,
	IndexResult,
	IndexingStats,
	PageContent,
} from "../types/document.js";

export type { ProcessingOptions, SearchOptions } from "../types/config.js";
