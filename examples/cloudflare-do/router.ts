// router.ts - Hono router with all API endpoints

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { Orchestrator } from './orchestrator'
import type { Env } from './types'

export function createRouter() {
  const router = new Hono<{ Bindings: Env }>()

  // Lazy orchestrator per request
  const getOrchestrator = (env: Env) => new Orchestrator(env)

  // ─────────────────────────────────────────────────────────────
  // Document Management
  // ─────────────────────────────────────────────────────────────

  // Index a new document
  router.post(
    '/documents',
    zValidator(
      'json',
      z.object({
        name: z.string(),
        type: z.enum(['pdf', 'markdown']),
        content: z.string(), // base64 for PDF, raw for markdown
        collection: z.string().optional().default('default'),
        metadata: z.record(z.unknown()).optional(),
      })
    ),
    async (c) => {
      const body = c.req.valid('json')
      const orchestrator = getOrchestrator(c.env)

      const result = await orchestrator.indexDocument(
        {
          name: body.name,
          type: body.type,
          content:
            body.type === 'pdf'
              ? Uint8Array.from(atob(body.content), (char) => char.charCodeAt(0))
              : body.content,
          metadata: body.metadata,
        },
        body.collection
      )

      return c.json(result, 201)
    }
  )

  // List documents
  router.get('/documents', async (c) => {
    const collection = c.req.query('collection') ?? 'default'
    const limit = parseInt(c.req.query('limit') ?? '50')
    const cursor = c.req.query('cursor')

    const orchestrator = getOrchestrator(c.env)
    const result = await orchestrator.listDocuments({ collection, limit, cursor })

    return c.json(result)
  })

  // Get document details
  router.get('/documents/:id', async (c) => {
    const id = c.req.param('id')
    const orchestrator = getOrchestrator(c.env)

    const doc = await orchestrator.getDocument(id)
    if (!doc) {
      return c.json({ error: 'Document not found' }, 404)
    }

    return c.json(doc)
  })

  // Delete document
  router.delete('/documents/:id', async (c) => {
    const id = c.req.param('id')
    const orchestrator = getOrchestrator(c.env)

    await orchestrator.deleteDocument(id)
    return c.json({ success: true })
  })

  // ─────────────────────────────────────────────────────────────
  // Search
  // ─────────────────────────────────────────────────────────────

  // Search across documents
  router.post(
    '/search',
    zValidator(
      'json',
      z.object({
        query: z.string(),
        collection: z.string().optional().default('default'),
        maxDocuments: z.number().optional().default(20),
        maxResults: z.number().optional().default(10),
      })
    ),
    async (c) => {
      const body = c.req.valid('json')
      const orchestrator = getOrchestrator(c.env)

      const results = await orchestrator.search(body.query, body.collection, {
        maxDocuments: body.maxDocuments,
        maxResults: body.maxResults,
      })

      return c.json({ results })
    }
  )

  // Search single document
  router.post(
    '/documents/:id/search',
    zValidator(
      'json',
      z.object({
        query: z.string(),
        maxResults: z.number().optional().default(5),
      })
    ),
    async (c) => {
      const id = c.req.param('id')
      const body = c.req.valid('json')
      const orchestrator = getOrchestrator(c.env)

      const results = await orchestrator.searchDocument(id, body.query, {
        maxResults: body.maxResults,
      })

      return c.json({ results })
    }
  )

  // ─────────────────────────────────────────────────────────────
  // Health check
  // ─────────────────────────────────────────────────────────────

  router.get('/health', (c) => {
    return c.json({ status: 'ok', timestamp: Date.now() })
  })

  return router
}
