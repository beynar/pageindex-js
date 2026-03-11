// index.ts - Worker entry point

import { Hono } from 'hono'
import { DocumentDO } from './document-do'
import { createRouter } from './router'
import type { Env } from './types'

// Export the Durable Object class for Cloudflare
export { DocumentDO }

// Create the Hono app
const app = new Hono<{ Bindings: Env }>()

// Mount the router
app.route('/', createRouter())

// Export the app as the default worker
export default app
