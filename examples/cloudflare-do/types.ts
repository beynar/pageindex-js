// types.ts - Shared types for the DO implementation

import type {
	DurableObjectNamespace,
	D1Database,
} from "@cloudflare/workers-types";

/**
 * Cloudflare Worker environment bindings
 */
export interface Env {
	/** Document Durable Object namespace */
	DOCUMENT_DO: DurableObjectNamespace;
	/** D1 database for global index */
	DB: D1Database;
	/** OpenAI API key for LLM operations */
	OPENAI_API_KEY: string;
}

/**
 * Document input for indexing
 */
export interface DocumentInput {
	name: string;
	type: "pdf" | "markdown";
	content: string | Uint8Array;
	metadata?: Record<string, unknown>;
}

/**
 * Options for listing documents
 */
export interface ListOptions {
	collection: string;
	limit: number;
	cursor?: string;
}

/**
 * Options for search operations
 */
export interface SearchOptions {
	maxDocuments?: number;
	maxResults?: number;
}

/**
 * Document summary for selection and display
 */
export interface DocumentSummary {
	id: string;
	name: string;
	type: string;
	description?: string;
	pageCount: number;
	tokenCount: number;
	topLevelNodes: Array<{
		nodeId: string;
		title: string;
		summary?: string;
	}>;
}

/**
 * Search result with document context
 */
export interface SearchResultWithDocument {
	documentId: string;
	documentName: string;
	nodeId: string;
	title: string;
	text: string;
	score: number;
	path: string[];
	startIndex: number;
	endIndex: number;
}

/**
 * Index result stats
 */
export interface IndexStats {
	pageCount: number;
	tokenCount: number;
	nodeCount: number;
	llmCalls: number;
	llmTokensUsed: number;
	durationMs: number;
}

/**
 * Result from indexing a document
 */
export interface IndexResult {
	id: string;
	stats: IndexStats;
}

/**
 * Document list response
 */
export interface DocumentListResponse {
	documents: Array<{
		id: string;
		name: string;
		type: string;
		createdAt: number;
	}>;
	nextCursor?: string;
}

/**
 * Search response
 */
export interface SearchResponse {
	results: SearchResultWithDocument[];
}
