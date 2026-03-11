// document-do.ts - Document Durable Object implementation

import { DurableObject } from "cloudflare:workers";
import {
	createDocumentIndex,
	type DocumentIndex,
	type DocumentInput,
	type DocumentSummary,
	type SearchResult,
	type SearchOptions,
	type IndexResult,
} from "pageindex";
import { createDOStorage } from "pageindex/storage";
import { openai } from "@ai-sdk/openai";
import type { Env } from "./types";

/**
 * Document Durable Object
 *
 * Each document gets its own DO instance with:
 * - Isolated SQLite storage for the document's tree structure and content
 * - Its own pageindex DocumentIndex instance
 * - Automatic persistence through DO's SQLite storage
 *
 * The DO acts as a thin wrapper around pageindex's DocumentIndex,
 * exposing the necessary methods to the Orchestrator.
 */
export class DocumentDO extends DurableObject<Env> {
	private docIndex: DocumentIndex | null = null;

	/**
	 * Lazily initialize the DocumentIndex
	 * This ensures the index is only created when needed
	 */
	private getDocIndex(): DocumentIndex {
		if (!this.docIndex) {
			this.docIndex = createDocumentIndex({
				model: openai("gpt-4o", {
					apiKey: this.env.OPENAI_API_KEY,
				}),
				storage: createDOStorage(this.ctx.storage.sql),
				documentId: this.ctx.id.toString(),
				processing: {
					addNodeSummary: true,
					addDocDescription: true,
					extractReferences: true, // Enable reference extraction
				},
			});
		}
		return this.docIndex;
	}

	// ─────────────────────────────────────────────────────────────
	// Public Methods (called by Orchestrator via stub)
	// ─────────────────────────────────────────────────────────────

	/**
	 * Index a document
	 * Processes the document and stores the tree structure in DO's SQLite
	 */
	async index(document: DocumentInput): Promise<IndexResult> {
		return this.getDocIndex().index(document);
	}

	/**
	 * Search within this document
	 * Uses the pageindex search engine to find relevant nodes
	 */
	async search(
		query: string,
		options?: SearchOptions,
	): Promise<SearchResult[]> {
		return this.getDocIndex().search(query, options);
	}

	/**
	 * Get document summary
	 * Returns metadata useful for document selection in multi-doc search
	 */
	async getSummary(): Promise<DocumentSummary | null> {
		return this.getDocIndex().getSummary();
	}

	/**
	 * Get content for a range of pages
	 * Used to retrieve the actual text content of search results
	 */
	async getContent(startIndex: number, endIndex: number): Promise<string> {
		return this.getDocIndex().getContent(startIndex, endIndex);
	}

	/**
	 * Clear the document from storage
	 * Called when deleting a document
	 */
	async clear(): Promise<void> {
		return this.getDocIndex().clear();
	}
}
