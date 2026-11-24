/**
 * Database client for the app. Two engines, same SQLite schema (src/lib/records.ts):
 *   - server:  the /api routes (server/api.ts) writing data/shield.db — when running `npm run dev` / `preview`
 *   - browser: SQLite in WebAssembly (src/lib/localDb.ts), saved on this device — when there's no API,
 *              e.g. a static Vercel deploy
 * The engine is picked once, on first use. Writes are fire-and-forget: the UI never waits on them.
 */
import type { DbEvent, DbSummary, TableInfo } from './records'

export type { DbEvent, DbSummary, TableInfo }
export type Row = Record<string, string | number | null>

type Engine = 'server' | 'browser'
let engine: Promise<Engine> | null = null

/** Server if /api answers with JSON, otherwise the in-browser engine. */
function pick(): Promise<Engine> {
  if (!engine) {
    engine = fetch('/api/health', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return 'browser' as const
        const body = (await r.json()) as { ok?: boolean }
        return body.ok ? ('server' as const) : ('browser' as const)
      })
      .catch(() => 'browser' as const)
  }
  return engine
}

const local = () => import('./localDb').then((m) => m.localDb)

const listeners = new Set<() => void>()
/** Subscribe to "the database just changed" — the Data Vault uses it to refresh live. */
export const onDbWrite = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

// keep writes in order so e.g. deploy lands before the battle that follows it
let queue: Promise<unknown> = Promise.resolve()

export function record(ev: DbEvent) {
  queue = queue
    .then(async () => {
      if ((await pick()) === 'server') {
        await fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ev) })
      } else {
        await (await local()).record(ev)
      }
    })
    .then(() => listeners.forEach((fn) => fn()))
    .catch(() => {})
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json()
  if (!res.ok) throw new Error(body.error ?? res.statusText)
  return body as T
}

export const api = {
  engine: pick,
  summary: async (): Promise<DbSummary> =>
    (await pick()) === 'server' ? fetch('/api/db').then((r) => json<DbSummary>(r)) : (await local()).summary(),
  table: async (name: string, limit = 50): Promise<{ rows: Row[] }> =>
    (await pick()) === 'server'
      ? fetch(`/api/db/${encodeURIComponent(name)}?limit=${limit}`).then((r) => json<{ rows: Row[] }>(r))
      : (await local()).table(name, limit),
  query: async (sql: string): Promise<{ rows: Row[]; ms: number }> =>
    (await pick()) === 'server'
      ? fetch('/api/db/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql }) }).then((r) =>
          json<{ rows: Row[]; ms: number }>(r),
        )
      : (await local()).query(sql),
  /** Save the whole database as shield.db. */
  download: async () => {
    let blob: Blob
    if ((await pick()) === 'server') {
      blob = await (await fetch('/api/db.sqlite')).blob()
    } else {
      const bytes = await (await local()).bytes()
      blob = new Blob([bytes.slice().buffer], { type: 'application/vnd.sqlite3' })
    }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'shield.db'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  },
}
