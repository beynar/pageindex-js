-- schema.sql - D1 global index schema
-- Run with: wrangler d1 execute pageindex-global --file=schema.sql

-- ─────────────────────────────────────────────────────────────
-- Documents Table
-- Stores metadata for all indexed documents across all collections
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS documents (
  -- Unique document ID (matches the Durable Object ID)
  id TEXT PRIMARY KEY,

  -- Collection for organizing documents (e.g., 'default', 'legal', 'technical')
  collection TEXT NOT NULL,

  -- Document name (original filename)
  name TEXT NOT NULL,

  -- Document type ('pdf' or 'markdown')
  type TEXT NOT NULL,

  -- LLM-generated description of the document content
  description TEXT,

  -- Number of pages in the document
  page_count INTEGER,

  -- Total token count for the document
  token_count INTEGER,

  -- Full document summary as JSON (for quick access without hitting the DO)
  summary TEXT,

  -- Vector embedding for semantic document selection (future use)
  embedding BLOB,

  -- Timestamp when the document was indexed
  created_at INTEGER NOT NULL
);

-- Index for efficient collection queries with time-based ordering
CREATE INDEX IF NOT EXISTS idx_documents_collection
  ON documents(collection, created_at DESC);

-- Index for document name searches
CREATE INDEX IF NOT EXISTS idx_documents_name
  ON documents(name);

-- Index for type filtering
CREATE INDEX IF NOT EXISTS idx_documents_type
  ON documents(type);

-- ─────────────────────────────────────────────────────────────
-- Collections Table
-- Stores metadata about document collections
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS collections (
  -- Collection name (unique identifier)
  name TEXT PRIMARY KEY,

  -- Number of documents in the collection
  document_count INTEGER DEFAULT 0,

  -- Optional metadata as JSON
  metadata TEXT,

  -- Timestamps
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ─────────────────────────────────────────────────────────────
-- Collection Document Count Trigger
-- Automatically updates collection document counts
-- ─────────────────────────────────────────────────────────────

-- Trigger to increment document count on insert
CREATE TRIGGER IF NOT EXISTS increment_collection_count
  AFTER INSERT ON documents
BEGIN
  INSERT INTO collections (name, document_count, created_at, updated_at)
  VALUES (NEW.collection, 1, NEW.created_at, NEW.created_at)
  ON CONFLICT(name) DO UPDATE SET
    document_count = document_count + 1,
    updated_at = NEW.created_at;
END;

-- Trigger to decrement document count on delete
CREATE TRIGGER IF NOT EXISTS decrement_collection_count
  AFTER DELETE ON documents
BEGIN
  UPDATE collections
  SET document_count = document_count - 1,
      updated_at = strftime('%s', 'now') * 1000
  WHERE name = OLD.collection;
END;
