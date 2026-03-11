/**
 * PageIndex - Reasoning-based RAG with hierarchical tree indexing
 *
 * @packageDocumentation
 */

// Layer 2: Document operations (primary API for single-document use)
export {
  createDocumentIndex,
  type DocumentIndex,
  type DocumentIndexConfig,
  type DocumentSummary,
} from "./document/index.js";

// Layer 2: Multi-document (backward compat)
export {
  createPageIndex,
  type PageIndex,
  type PageIndexConfig,
} from "./core.js";

// Types
export * from "./types/index.js";

// Storage (also exported from pageindex/storage)
export {
  createD1Storage,
  createSQLiteStorage,
  createDOStorage,
  type DOSQLExecutor,
  type DOStorageOptions,
  type SqlStorageCursor,
} from "./storage/index.js";

// Processing utilities
export { processMarkdown, extractPdfText } from "./processing/index.js";

// Tree utilities
export {
  getAllNodes,
  getLeafNodes,
  findNodeById,
  getNodePath,
  traverseTree,
} from "./tree/index.js";

// Search utilities
export { createSearchEngine, createRetriever } from "./search/index.js";

// LLM utilities
export { countTokens, truncateToTokens, splitIntoChunks } from "./llm/index.js";

// AI SDK Tools (types only - tools available via pageIndex.tools)
export type { PageIndexTools } from "./tools/internal.js";
