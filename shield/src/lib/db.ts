/**
 * Client for the SQLite API (server/api.ts). Writes are fire-and-forget: the UI never waits on
 * the database, and if the API isn't there (e.g. a static deploy) the app keeps working from
 * localStorage alone.
 */

export type DbEvent =
  | { type: 'deploy'; missionId: string; heroIds: string[] }
  | { type: 'recall'; missionId: string }
  | { type: 'status'; missionId: string; status: 'Pending' | 'In Progress' | 'Completed' }
  | { type: 'threat'; missionId: string; threat: 'LOW' | 'MEDIUM' | 'HIGH' | 'OMEGA' }
  | { type: 'battle'; missionId: string; won: boolean; rounds: number; damage: Record<string, number> }
  | { type: 'log'; text: string; tone: 'info' | 'warn' | 'ok' | 'alert' }
  | { type: 'reset' }

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
    .then(() => fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ev) }))
    .then(() => listeners.forEach((fn) => fn()))
    .catch(() => {})
}

export interface TableInfo {
  name: string
  type: 'table' | 'view'
  rows: number
  columns: { name: string; type: string; pk: boolean }[]
  sql: string
}
export interface DbSummary {
  file: string
  sqliteVersion: string
  tables: TableInfo[]
}
export type Row = Record<string, string | number | null>

async function json<T>(res: Response): Promise<T> {
  const body = await res.json()
  if (!res.ok) throw new Error(body.error ?? res.statusText)
  return body as T
}

export const api = {
  summary: () => fetch('/api/db').then((r) => json<DbSummary>(r)),
  table: (name: string, limit = 50) => fetch(`/api/db/${encodeURIComponent(name)}?limit=${limit}`).then((r) => json<{ rows: Row[] }>(r)),
  query: (sql: string) =>
    fetch('/api/db/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql }) }).then((r) => json<{ rows: Row[]; ms: number }>(r)),
}
