/**
 * `/api` routes, mounted inside Vite's dev and preview servers — `npm run dev` starts the
 * site and the SQLite-backed API together, no second process.
 *
 *   GET  /api/health            → { ok, file, sqliteVersion }
 *   GET  /api/db                → table list with row counts, columns and CREATE statements
 *   GET  /api/db/:table?limit=  → rows of one table/view
 *   POST /api/db/query {sql}    → one read-only SELECT (runs on a read-only connection)
 *   POST /api/events  {type...} → app activity (deploy, recall, status, threat, battle, log, reset)
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { DB_PATH, getDb, query, record, summary, tableRows, type DbEvent } from './db'

const EVENT_TYPES = new Set(['deploy', 'recall', 'status', 'threat', 'battle', 'log', 'reset'])

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 64_000) throw new Error('Body too large')
  }
  return raw ? JSON.parse(raw) : {}
}

async function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const url = new URL(req.url ?? '/', 'http://local')
  if (!url.pathname.startsWith('/api/')) return next()
  const path = url.pathname.slice(4) // strip "/api"
  try {
    if (req.method === 'GET' && path === '/health') {
      const s = summary()
      return send(res, 200, { ok: true, file: s.file, sqliteVersion: s.sqliteVersion })
    }
    if (req.method === 'GET' && path === '/db') return send(res, 200, summary())
    if (req.method === 'GET' && path.startsWith('/db/')) {
      const name = decodeURIComponent(path.slice(4))
      return send(res, 200, { rows: tableRows(name, Number(url.searchParams.get('limit') ?? 50)) })
    }
    if (req.method === 'POST' && path === '/db/query') {
      const body = await readJson(req)
      if (typeof body.sql !== 'string') return send(res, 400, { error: 'Missing sql' })
      return send(res, 200, query(body.sql))
    }
    if (req.method === 'POST' && path === '/events') {
      const body = await readJson(req)
      if (typeof body.type !== 'string' || !EVENT_TYPES.has(body.type)) return send(res, 400, { error: 'Unknown event' })
      record(body as unknown as DbEvent)
      return send(res, 200, { ok: true })
    }
    return send(res, 404, { error: 'Not found' })
  } catch (e) {
    return send(res, 400, { error: e instanceof Error ? e.message : String(e) })
  }
}

export function shieldApi(): Plugin {
  return {
    name: 'shield-sqlite-api',
    configureServer(server) {
      getDb()
      server.config.logger.info(`  \x1b[31m▲\x1b[0m SQLite database: ${DB_PATH}`)
      server.middlewares.use((req, res, next) => void handle(req, res, next))
    },
    configurePreviewServer(server) {
      getDb()
      server.middlewares.use((req, res, next) => void handle(req, res, next))
    },
  }
}
