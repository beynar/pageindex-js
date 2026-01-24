# Reference Following in PageIndex

> Implementing automatic detection and traversal of in-document references like "see Appendix G" or "refer to Table 5.3".

---

## Overview

Documents frequently contain cross-references that point readers to other sections:

- "See Appendix G for detailed tables"
- "As shown in Table 5.3"
- "Refer to Section 2.1 for definitions"
- "The methodology described in Chapter 4"

Currently, PageIndex relies on the LLM to organically notice these references during search. This document proposes **explicit reference extraction and linking** at index time, enabling deterministic reference traversal during search.

---

## Key Insight: References as Self-Referencing Relations

References are not a separate entity — they're just **edges between nodes**:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Node Graph                                │
│                                                                  │
│   ┌──────────┐                      ┌──────────┐                │
│   │  Node A  │ ──── references ───► │  Node B  │                │
│   │ "...see  │                      │ Appendix │                │
│   │ Appendix │                      │    G     │                │
│   │   G..."  │                      │          │                │
│   └──────────┘                      └──────────┘                │
│        │                                  ▲                      │
│        │ parent_id                        │                      │
│        ▼                                  │ references           │
│   ┌──────────┐                            │                      │
│   │  Node C  │ ───────────────────────────┘                      │
│   │ "Table   │                                                   │
│   │  5.3 in  │                                                   │
│   │ Appendix │                                                   │
│   │   G..."  │                                                   │
│   └──────────┘                                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

This is a **graph structure** overlaid on the tree:
- **Tree edges**: `parent_id` → hierarchical structure
- **Reference edges**: `node_id → node_id` → cross-references

---

## SQL Schema

Since references form a graph (many-to-many relationship), we need SQL storage with proper joins. This feature requires **SQLite, D1, or PostgreSQL** — not simple key-value stores.

### Schema Definition

```sql
-- Nodes table (tree structure)
CREATE TABLE nodes (
  node_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  parent_id TEXT,                    -- Tree edge (self-reference)
  title TEXT NOT NULL,
  summary TEXT,
  start_index INTEGER,
  end_index INTEGER,
  depth INTEGER NOT NULL,
  position INTEGER NOT NULL,         -- Order within parent
  
  FOREIGN KEY (parent_id) REFERENCES nodes(node_id),
  FOREIGN KEY (document_id) REFERENCES documents(id)
);

CREATE INDEX idx_nodes_document ON nodes(document_id);
CREATE INDEX idx_nodes_parent ON nodes(parent_id);

-- References table (graph edges between nodes)
CREATE TABLE node_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_node_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  reference_text TEXT,               -- Original text: "see Appendix G"
  reference_type TEXT,               -- 'section' | 'table' | 'figure' | 'appendix' | 'page'
  confidence REAL DEFAULT 1.0,
  
  FOREIGN KEY (source_node_id) REFERENCES nodes(node_id),
  FOREIGN KEY (target_node_id) REFERENCES nodes(node_id),
  
  UNIQUE(source_node_id, target_node_id)  -- No duplicate edges
);

CREATE INDEX idx_refs_source ON node_references(source_node_id);
CREATE INDEX idx_refs_target ON node_references(target_node_id);

-- Page content (unchanged from current design)
CREATE TABLE pages (
  document_id TEXT NOT NULL,
  page_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER,
  
  PRIMARY KEY (document_id, page_index),
  FOREIGN KEY (document_id) REFERENCES documents(id)
);
```

---

## Recursive CTE for Reference Traversal

The power of SQL: traverse the reference graph with a single query using **recursive Common Table Expressions (CTEs)**.

### Basic Reference Chain

```sql
-- Given a set of starting nodes, find all referenced nodes up to N hops
WITH RECURSIVE reference_chain AS (
  -- Base case: starting nodes (from search results)
  SELECT 
    node_id,
    node_id as origin_node_id,
    0 as depth,
    title,
    '' as path
  FROM nodes
  WHERE node_id IN ('node-001', 'node-005')  -- Initial search results
  
  UNION ALL
  
  -- Recursive case: follow outgoing references
  SELECT 
    n.node_id,
    rc.origin_node_id,
    rc.depth + 1,
    n.title,
    rc.path || ' → ' || r.reference_text
  FROM reference_chain rc
  JOIN node_references r ON r.source_node_id = rc.node_id
  JOIN nodes n ON n.node_id = r.target_node_id
  WHERE rc.depth < 3  -- Max 3 hops to prevent infinite loops
)
SELECT DISTINCT
  node_id,
  origin_node_id,
  depth,
  title,
  path as reference_path
FROM reference_chain
ORDER BY depth, node_id;
```

### Output Example

| node_id | origin_node_id | depth | title | reference_path |
|---------|----------------|-------|-------|----------------|
| node-001 | node-001 | 0 | Financial Assets | |
| node-005 | node-005 | 0 | Revenue Summary | |
| node-042 | node-001 | 1 | Appendix G | → see Appendix G |
| node-015 | node-001 | 1 | Table 5.3 | → as shown in Table 5.3 |
| node-043 | node-042 | 2 | Statistical Tables | → see Appendix G → refer to Statistical Tables |

### Bidirectional Traversal (Follow + Backtrack)

```sql
-- Find all nodes connected to a starting node in either direction
WITH RECURSIVE connected_nodes AS (
  -- Base case
  SELECT node_id, 0 as depth, 'start' as direction
  FROM nodes WHERE node_id = 'node-001'
  
  UNION ALL
  
  -- Forward: follow references FROM this node
  SELECT r.target_node_id, cn.depth + 1, 'forward'
  FROM connected_nodes cn
  JOIN node_references r ON r.source_node_id = cn.node_id
  WHERE cn.depth < 2
  
  UNION ALL
  
  -- Backward: find nodes that reference TO this node
  SELECT r.source_node_id, cn.depth + 1, 'backward'
  FROM connected_nodes cn
  JOIN node_references r ON r.target_node_id = cn.node_id
  WHERE cn.depth < 2
)
SELECT DISTINCT node_id, MIN(depth) as min_depth, direction
FROM connected_nodes
GROUP BY node_id
ORDER BY min_depth;
```

### Full Search Query with References

```sql
-- Complete search: get nodes + their references + content
WITH RECURSIVE reference_chain AS (
  SELECT node_id, 0 as depth
  FROM nodes
  WHERE node_id IN (:search_result_node_ids)
  
  UNION ALL
  
  SELECT r.target_node_id, rc.depth + 1
  FROM reference_chain rc
  JOIN node_references r ON r.source_node_id = rc.node_id
  WHERE rc.depth < 2
)
SELECT 
  n.node_id,
  n.title,
  n.summary,
  n.start_index,
  n.end_index,
  rc.depth as reference_depth,
  -- Aggregate all reference texts that led here
  GROUP_CONCAT(DISTINCT r.reference_text) as via_references,
  -- Aggregate page content
  GROUP_CONCAT(p.content, '\n\n') as content
FROM reference_chain rc
JOIN nodes n ON n.node_id = rc.node_id
LEFT JOIN node_references r ON r.target_node_id = n.node_id
LEFT JOIN pages p ON p.document_id = n.document_id 
  AND p.page_index BETWEEN n.start_index AND n.end_index
GROUP BY n.node_id
ORDER BY rc.depth, n.node_id;
```

---

## Indexing Pipeline

### Step 1: Build Tree (Existing)

```typescript
// Existing PageIndex tree building
const tree = await treeBuilder.build(document)
```

### Step 2: Store Nodes in SQL

```typescript
async function storeNodes(
  db: Database,
  documentId: string,
  tree: TreeNode[]
): Promise<void> {
  const insert = db.prepare(`
    INSERT INTO nodes (node_id, document_id, parent_id, title, summary, 
                       start_index, end_index, depth, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  
  function insertRecursive(nodes: TreeNode[], parentId: string | null, depth: number) {
    nodes.forEach((node, position) => {
      insert.run(
        node.nodeId,
        documentId,
        parentId,
        node.title,
        node.summary ?? null,
        node.startIndex,
        node.endIndex,
        depth,
        position
      )
      if (node.nodes) {
        insertRecursive(node.nodes, node.nodeId, depth + 1)
      }
    })
  }
  
  insertRecursive(tree, null, 0)
}
```

### Step 3: Extract References (LLM)

```typescript
interface RawReference {
  nodeId: string
  referenceText: string      // "see Appendix G"
  targetHint: string         // "Appendix G"
  targetType: 'section' | 'table' | 'figure' | 'appendix' | 'page' | 'unknown'
}

const ReferenceExtractionSchema = z.object({
  references: z.array(z.object({
    referenceText: z.string().describe('Exact text of the reference'),
    targetHint: z.string().describe('What is being referenced'),
    targetType: z.enum(['section', 'table', 'figure', 'appendix', 'page', 'unknown'])
  }))
})

async function extractReferences(
  llm: LLMClient,
  nodeId: string,
  content: string
): Promise<RawReference[]> {
  if (!content || content.length < 50) return []
  
  const result = await llm.chatJSON(
    `Extract all cross-references from this document section.

Look for phrases that point to other parts of the document:
- "see [Section/Appendix/Chapter] X"
- "refer to [Table/Figure] X"
- "as shown/described/detailed in X"
- "per [Section] X"
- "(see page X)"

Only extract explicit references, not general mentions.`,
    
    `Content:\n${content.slice(0, 4000)}`,
    ReferenceExtractionSchema
  )
  
  return result.references.map(r => ({
    nodeId,
    ...r
  }))
}

// Process all nodes
async function extractAllReferences(
  llm: LLMClient,
  db: Database,
  documentId: string
): Promise<RawReference[]> {
  const nodes = db.prepare(`
    SELECT n.node_id, GROUP_CONCAT(p.content, '\n') as content
    FROM nodes n
    LEFT JOIN pages p ON p.document_id = n.document_id
      AND p.page_index BETWEEN n.start_index AND n.end_index
    WHERE n.document_id = ?
    GROUP BY n.node_id
  `).all(documentId)
  
  const allRefs: RawReference[] = []
  
  // Process in batches for efficiency
  const BATCH_SIZE = 10
  for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
    const batch = nodes.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(
      batch.map(n => extractReferences(llm, n.node_id, n.content))
    )
    allRefs.push(...results.flat())
  }
  
  return allRefs
}
```

### Step 4: Resolve References to Node IDs

```typescript
async function resolveReferences(
  llm: LLMClient,
  db: Database,
  documentId: string,
  rawRefs: RawReference[]
): Promise<void> {
  // Get all node titles for matching
  const nodes = db.prepare(`
    SELECT node_id, title, summary FROM nodes WHERE document_id = ?
  `).all(documentId)
  
  const nodeIndex = new Map(nodes.map(n => [n.node_id, n]))
  
  const insert = db.prepare(`
    INSERT OR IGNORE INTO node_references 
      (source_node_id, target_node_id, reference_text, reference_type, confidence)
    VALUES (?, ?, ?, ?, ?)
  `)
  
  for (const ref of rawRefs) {
    // Try exact match first
    let targetNode = nodes.find(n => 
      n.title.toLowerCase().includes(ref.targetHint.toLowerCase())
    )
    let confidence = 1.0
    
    // If no exact match, use LLM to find best match
    if (!targetNode) {
      const nodeList = nodes
        .map(n => `[${n.node_id}] ${n.title}`)
        .join('\n')
      
      const match = await llm.chatJSON(
        `Find the node that best matches this reference.
Return null if no good match exists.`,
        `Reference: "${ref.targetHint}"

Available nodes:
${nodeList}`,
        z.object({
          nodeId: z.string().nullable(),
          confidence: z.number().min(0).max(1)
        })
      )
      
      if (match.nodeId && match.confidence > 0.6) {
        targetNode = nodeIndex.get(match.nodeId)
        confidence = match.confidence
      }
    }
    
    if (targetNode && targetNode.node_id !== ref.nodeId) {
      insert.run(
        ref.nodeId,
        targetNode.node_id,
        ref.referenceText,
        ref.targetType,
        confidence
      )
    }
  }
}
```

### Complete Indexing Flow

```typescript
async function indexDocumentWithReferences(
  document: DocumentInput,
  llm: LLMClient,
  db: Database
): Promise<IndexResult> {
  // 1. Build tree structure (existing PageIndex logic)
  const treeResult = await treeBuilder.build(document)
  
  // 2. Generate document ID
  const documentId = generateDocId(document.name)
  
  // 3. Store document metadata
  await storeDocument(db, documentId, document, treeResult.stats)
  
  // 4. Store tree nodes in SQL
  await storeNodes(db, documentId, treeResult.tree)
  
  // 5. Store page content
  await storePages(db, documentId, treeResult.pages)
  
  // 6. Extract references from content (LLM calls)
  const rawRefs = await extractAllReferences(llm, db, documentId)
  
  // 7. Resolve references to node IDs
  await resolveReferences(llm, db, documentId, rawRefs)
  
  // 8. Log reference stats
  const refCount = db.prepare(`
    SELECT COUNT(*) as count FROM node_references nr
    JOIN nodes n ON n.node_id = nr.source_node_id
    WHERE n.document_id = ?
  `).get(documentId)
  
  return {
    documentId,
    stats: {
      ...treeResult.stats,
      referenceCount: refCount.count
    }
  }
}
```

---

## Search with Reference Following

### SQL-Powered Search

```typescript
async function searchWithReferences(
  query: string,
  documentId: string,
  db: Database,
  llm: LLMClient,
  options?: { maxReferenceDepth?: number }
): Promise<SearchResult[]> {
  const maxDepth = options?.maxReferenceDepth ?? 2
  
  // 1. Standard PageIndex tree search (get initial node IDs)
  const tree = await loadTree(db, documentId)
  const initialResults = await treeSearchEngine.search(query, tree)
  
  if (initialResults.length === 0) return []
  
  const initialNodeIds = initialResults.map(r => r.node.nodeId)
  
  // 2. Expand with references using recursive CTE
  const expanded = db.prepare(`
    WITH RECURSIVE reference_chain AS (
      SELECT 
        node_id,
        node_id as origin_node_id,
        0 as depth
      FROM nodes
      WHERE node_id IN (${initialNodeIds.map(() => '?').join(',')})
      
      UNION ALL
      
      SELECT 
        r.target_node_id,
        rc.origin_node_id,
        rc.depth + 1
      FROM reference_chain rc
      JOIN node_references r ON r.source_node_id = rc.node_id
      WHERE rc.depth < ?
    )
    SELECT 
      n.*,
      rc.depth as reference_depth,
      rc.origin_node_id,
      GROUP_CONCAT(r.reference_text, '; ') as via_references
    FROM reference_chain rc
    JOIN nodes n ON n.node_id = rc.node_id
    LEFT JOIN node_references r ON r.target_node_id = n.node_id
      AND r.source_node_id IN (${initialNodeIds.map(() => '?').join(',')})
    GROUP BY n.node_id
    ORDER BY rc.depth, n.node_id
  `).all(...initialNodeIds, maxDepth, ...initialNodeIds)
  
  // 3. Score referenced nodes
  const results: SearchResult[] = []
  
  for (const row of expanded) {
    const existingResult = initialResults.find(r => r.node.nodeId === row.node_id)
    
    if (existingResult) {
      // Direct match - use existing score
      results.push(existingResult)
    } else {
      // Referenced node - score it
      const node = rowToTreeNode(row)
      const score = await scoreNode(llm, query, node)
      
      if (score > 0.4) {
        results.push({
          node,
          score: score * (0.9 ** row.reference_depth),  // Decay by depth
          path: [row.origin_node_id, row.node_id],
          reasoning: `Referenced via: ${row.via_references}`,
          referenceDepth: row.reference_depth
        })
      }
    }
  }
  
  return results.sort((a, b) => b.score - a.score)
}
```

---

## Cloudflare DO + SQLite Implementation

For the DO architecture, each document's SQLite handles its own reference graph:

```typescript
// In DocumentDO
export class DocumentDO extends DurableObject {
  
  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    // 1. Load tree and do initial search
    const tree = this.loadTree()
    const initial = await this.treeSearch(query, tree)
    
    if (initial.length === 0) return []
    
    const nodeIds = initial.map(r => r.node.nodeId)
    const maxDepth = options?.maxReferenceDepth ?? 2
    
    // 2. Expand with references (recursive CTE)
    const expanded = this.sql.exec(`
      WITH RECURSIVE ref_chain AS (
        SELECT node_id, 0 as depth FROM nodes WHERE node_id IN (${nodeIds.map(() => '?').join(',')})
        UNION ALL
        SELECT r.target_node_id, rc.depth + 1
        FROM ref_chain rc
        JOIN node_references r ON r.source_node_id = rc.node_id
        WHERE rc.depth < ?
      )
      SELECT DISTINCT 
        n.*, 
        MIN(rc.depth) as ref_depth
      FROM ref_chain rc
      JOIN nodes n ON n.node_id = rc.node_id
      GROUP BY n.node_id
    `, ...nodeIds, maxDepth).toArray()
    
    // 3. Score and return
    const results = await this.scoreExpandedResults(query, initial, expanded)
    return results
  }
}
```

---

## Performance Considerations

### Index Creation Cost

| Document Size | Nodes | Reference Extraction LLM Calls | Time |
|---------------|-------|-------------------------------|------|
| 10 pages | ~20 | ~2-4 (batched) | +5s |
| 100 pages | ~100 | ~10-20 (batched) | +30s |
| 500 pages | ~300 | ~30-60 (batched) | +2min |

### Query Performance

Recursive CTEs are efficient in SQLite/PostgreSQL:

| Nodes | References | Max Depth | Query Time |
|-------|------------|-----------|------------|
| 100 | 50 | 2 | <10ms |
| 1,000 | 500 | 2 | <50ms |
| 10,000 | 5,000 | 3 | <200ms |

### Storage Overhead

```
Per document:
- nodes table: ~500 bytes per node
- node_references table: ~100 bytes per reference
- Typical 100-page doc: 100 nodes × 500 + 50 refs × 100 = ~55KB
```

---

## API Changes

### New Index Options

```typescript
interface ProcessingOptions {
  // ... existing
  
  /** Extract and store cross-references between nodes */
  extractReferences?: boolean  // default: true
  
  /** Maximum concurrent reference extraction calls */
  referenceExtractionBatchSize?: number  // default: 10
}
```

### New Search Options

```typescript
interface SearchOptions {
  // ... existing
  
  /** Follow cross-references from result nodes */
  followReferences?: boolean  // default: true
  
  /** Maximum reference hops to follow */
  maxReferenceDepth?: number  // default: 2
}
```

### New Result Fields

```typescript
interface SearchResult {
  // ... existing
  
  /** How many reference hops from original result */
  referenceDepth?: number
  
  /** Reference path that led to this result */
  referencePath?: Array<{
    fromNodeId: string
    toNodeId: string
    referenceText: string
  }>
}
```

---

## Migration Path

### For Existing Documents

```typescript
// Re-index references for existing documents
async function migrateAddReferences(db: Database, llm: LLMClient) {
  const documents = db.prepare('SELECT id FROM documents').all()
  
  for (const doc of documents) {
    console.log(`Extracting references for ${doc.id}...`)
    const rawRefs = await extractAllReferences(llm, db, doc.id)
    await resolveReferences(llm, db, doc.id, rawRefs)
  }
}
```

### Storage Driver Requirements

| Storage Driver | Reference Support |
|----------------|------------------|
| Memory | ❌ No (no SQL) |
| SQLite | ✅ Full support |
| Cloudflare D1 | ✅ Full support |
| Cloudflare KV | ❌ No (no SQL) |
| Redis | ❌ No (no SQL)* |
| DO + SQLite | ✅ Full support |

*Could implement with Redis graph module, but not recommended.

---

## Summary

Reference following transforms PageIndex from a tree-based retrieval system to a **graph-based retrieval system**:

```
Before: Tree (hierarchical)
        ┌── Child 1
Parent ─┼── Child 2
        └── Child 3

After: Tree + Graph (hierarchical + cross-references)
        ┌── Child 1 ──────────┐
Parent ─┼── Child 2           │ reference
        └── Child 3 ◄─────────┘
              │
              │ reference
              ▼
           Appendix G
```

Key implementation points:

1. **Self-referencing relation**: References are just edges in a node graph
2. **SQL required**: Recursive CTEs enable efficient graph traversal
3. **Index-time extraction**: One-time LLM cost, fast queries
4. **Configurable depth**: Prevent infinite loops with max depth
5. **Score decay**: Referenced nodes score slightly lower than direct matches
