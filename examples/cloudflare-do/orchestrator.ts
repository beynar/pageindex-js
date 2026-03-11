// orchestrator.ts - Orchestration logic for multi-doc operations

import type {
  Env,
  DocumentInput,
  DocumentSummary,
  ListOptions,
  SearchOptions,
  SearchResultWithDocument,
  IndexResult,
  DocumentListResponse,
} from './types'

/**
 * Orchestrator handles multi-document operations by coordinating
 * between the D1 global index and individual Document DOs.
 */
export class Orchestrator {
  constructor(private env: Env) {}

  // ─────────────────────────────────────────────────────────────
  // Document Management
  // ─────────────────────────────────────────────────────────────

  /**
   * Index a new document by creating a Document DO and storing metadata in D1
   */
  async indexDocument(
    document: DocumentInput,
    collection: string
  ): Promise<IndexResult> {
    // Create new Document DO
    const doId = this.env.DOCUMENT_DO.newUniqueId()
    const stub = this.env.DOCUMENT_DO.get(doId)

    // Index document in the DO
    const result = await stub.index(document)

    // Get summary for global index
    const summary = await stub.getSummary()

    // Store in D1 global index
    await this.env.DB.prepare(
      `
      INSERT INTO documents (
        id, collection, name, type, description,
        page_count, token_count, summary, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
      .bind(
        doId.toString(),
        collection,
        document.name,
        document.type,
        summary?.description ?? null,
        summary?.pageCount ?? 0,
        summary?.tokenCount ?? 0,
        JSON.stringify(summary),
        Date.now()
      )
      .run()

    return {
      id: doId.toString(),
      stats: result.stats,
    }
  }

  /**
   * Get document details from the global index
   */
  async getDocument(id: string): Promise<DocumentSummary | null> {
    const row = await this.env.DB.prepare(`SELECT * FROM documents WHERE id = ?`)
      .bind(id)
      .first()

    if (!row) return null

    return JSON.parse(row.summary as string)
  }

  /**
   * List documents with pagination
   */
  async listDocuments(options: ListOptions): Promise<DocumentListResponse> {
    let query = `
      SELECT id, name, type, created_at
      FROM documents
      WHERE collection = ?
    `
    const params: unknown[] = [options.collection]

    if (options.cursor) {
      query += ` AND created_at < ?`
      params.push(parseInt(options.cursor))
    }

    query += ` ORDER BY created_at DESC LIMIT ?`
    params.push(options.limit + 1)

    const result = await this.env.DB.prepare(query)
      .bind(...params)
      .all()
    const rows = result.results ?? []

    const hasMore = rows.length > options.limit
    const documents = rows.slice(0, options.limit).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      type: row.type as string,
      createdAt: row.created_at as number,
    }))

    return {
      documents,
      nextCursor: hasMore
        ? String(documents[documents.length - 1]?.createdAt)
        : undefined,
    }
  }

  /**
   * Delete a document from both DO and global index
   */
  async deleteDocument(id: string): Promise<void> {
    // Delete from DO
    const stub = this.env.DOCUMENT_DO.get(this.env.DOCUMENT_DO.idFromString(id))
    await stub.clear()

    // Delete from global index
    await this.env.DB.prepare(`DELETE FROM documents WHERE id = ?`).bind(id).run()
  }

  // ─────────────────────────────────────────────────────────────
  // Search
  // ─────────────────────────────────────────────────────────────

  /**
   * Search across multiple documents in a collection
   * Fan out search to Document DOs in parallel and aggregate results
   */
  async search(
    query: string,
    collection: string,
    options: SearchOptions = {}
  ): Promise<SearchResultWithDocument[]> {
    const maxDocuments = options.maxDocuments ?? 20
    const maxResults = options.maxResults ?? 10

    // Get document IDs from global index
    // TODO: Add embedding-based pre-selection here for smarter document selection
    const docs = await this.env.DB.prepare(
      `
      SELECT id, name FROM documents
      WHERE collection = ?
      ORDER BY created_at DESC
      LIMIT ?
    `
    )
      .bind(collection, maxDocuments)
      .all()

    if (!docs.results?.length) {
      return []
    }

    // Fan out search to Document DOs in parallel
    const searchResults = await Promise.all(
      docs.results.map(async (row) => {
        try {
          const stub = this.env.DOCUMENT_DO.get(
            this.env.DOCUMENT_DO.idFromString(row.id as string)
          )
          const results = await stub.search(query)

          // Tag results with document info
          return results.map((r: Record<string, unknown>) => ({
            ...r,
            documentId: row.id as string,
            documentName: row.name as string,
          }))
        } catch (error) {
          console.error(`Search failed for ${row.id}:`, error)
          return []
        }
      })
    )

    // Merge and rank by score
    return searchResults
      .flat()
      .sort((a, b) => (b.score as number) - (a.score as number))
      .slice(0, maxResults) as SearchResultWithDocument[]
  }

  /**
   * Search within a single document
   */
  async searchDocument(
    id: string,
    query: string,
    options: { maxResults?: number } = {}
  ): Promise<SearchResultWithDocument[]> {
    // Get document name for the response
    const doc = await this.env.DB.prepare(`SELECT name FROM documents WHERE id = ?`)
      .bind(id)
      .first()

    if (!doc) {
      throw new Error(`Document not found: ${id}`)
    }

    const stub = this.env.DOCUMENT_DO.get(this.env.DOCUMENT_DO.idFromString(id))
    const results = await stub.search(query, options)

    // Tag results with document info
    return results.map((r: Record<string, unknown>) => ({
      ...r,
      documentId: id,
      documentName: doc.name as string,
    })) as SearchResultWithDocument[]
  }
}
