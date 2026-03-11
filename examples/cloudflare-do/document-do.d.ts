import { DurableObject } from "cloudflare:workers";
import { type DocumentInput, type DocumentSummary, type SearchResult, type SearchOptions, type IndexResult } from "pageindex";
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
export declare class DocumentDO extends DurableObject<Env> {
    private docIndex;
    /**
     * Lazily initialize the DocumentIndex
     * This ensures the index is only created when needed
     */
    private getDocIndex;
    /**
     * Index a document
     * Processes the document and stores the tree structure in DO's SQLite
     */
    index(document: DocumentInput): Promise<IndexResult>;
    /**
     * Search within this document
     * Uses the pageindex search engine to find relevant nodes
     */
    search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
    /**
     * Get document summary
     * Returns metadata useful for document selection in multi-doc search
     */
    getSummary(): Promise<DocumentSummary | null>;
    /**
     * Get content for a range of pages
     * Used to retrieve the actual text content of search results
     */
    getContent(startIndex: number, endIndex: number): Promise<string>;
    /**
     * Clear the document from storage
     * Called when deleting a document
     */
    clear(): Promise<void>;
}
//# sourceMappingURL=document-do.d.ts.map