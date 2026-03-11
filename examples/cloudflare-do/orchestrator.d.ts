import type { Env, DocumentInput, DocumentSummary, ListOptions, SearchOptions, SearchResultWithDocument, IndexResult, DocumentListResponse } from './types';
/**
 * Orchestrator handles multi-document operations by coordinating
 * between the D1 global index and individual Document DOs.
 */
export declare class Orchestrator {
    private env;
    constructor(env: Env);
    /**
     * Index a new document by creating a Document DO and storing metadata in D1
     */
    indexDocument(document: DocumentInput, collection: string): Promise<IndexResult>;
    /**
     * Get document details from the global index
     */
    getDocument(id: string): Promise<DocumentSummary | null>;
    /**
     * List documents with pagination
     */
    listDocuments(options: ListOptions): Promise<DocumentListResponse>;
    /**
     * Delete a document from both DO and global index
     */
    deleteDocument(id: string): Promise<void>;
    /**
     * Search across multiple documents in a collection
     * Fan out search to Document DOs in parallel and aggregate results
     */
    search(query: string, collection: string, options?: SearchOptions): Promise<SearchResultWithDocument[]>;
    /**
     * Search within a single document
     */
    searchDocument(id: string, query: string, options?: {
        maxResults?: number;
    }): Promise<SearchResultWithDocument[]>;
}
//# sourceMappingURL=orchestrator.d.ts.map