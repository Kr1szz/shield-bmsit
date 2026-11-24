/**
 * Server-side SQLite: Node's built-in driver (`node:sqlite`, Node 22.5+), nothing native to install.
 * The file lives at `data/shield.db` — a standard SQLite 3 database you can open in any SQLite tool.
 * Schema, seeding and every read/write live in `src/lib/records.ts`, shared with the in-browser
 * fallback (sql.js) used when the site is deployed without this server.
 */
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import * as R from '../src/lib/records'

export const DB_PATH = resolve(process.cwd(), 'data', 'shield.db')
export type { DbEvent } from '../src/lib/records'

// Resolved at runtime (not a static import) so bundling vite.config for `vite build` never loads
// node:sqlite — static builds such as Vercel's work on any Node version.
type DatabaseSync = DatabaseSyncType
const driver = () => process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite')

/** Adapt node:sqlite to the shared `Sql` interface. */
function adapt(d: DatabaseSync): R.Sql {
  return {
    exec: (sql) => d.exec(sql),
    run: (sql, params = []) => ({ lastId: Number(d.prepare(sql).run(...params).lastInsertRowid) }),
    all: <T>(sql: string, params: R.Param[] = []) => d.prepare(sql).all(...params) as T[],
  }
}

let rw: { raw: DatabaseSync; sql: R.Sql } | null = null
let ro: R.Sql | null = null

/** Read-write connection (created + seeded on first use). */
export function getDb() {
  if (rw) return rw.sql
  mkdirSync(dirname(DB_PATH), { recursive: true })
  const raw = new (driver().DatabaseSync)(DB_PATH, { enableForeignKeyConstraints: true })
  raw.exec('PRAGMA journal_mode = WAL;')
  const sql = adapt(raw)
  R.setup(sql)
  rw = { raw, sql }
  return sql
}

/** Read-only connection for the SQL console — writes are rejected by SQLite itself. */
function getReadOnlyDb() {
  if (ro) return ro
  getDb()
  ro = adapt(new (driver().DatabaseSync)(DB_PATH, { readOnly: true }))
  return ro
}

/** Fold the WAL back into shield.db so the file is complete on its own. */
const checkpoint = () => rw?.raw.exec('PRAGMA wal_checkpoint(TRUNCATE)')

export function record(ev: R.DbEvent) {
  R.record(getDb(), ev)
  checkpoint()
}

export const summary = () => R.summary(getDb(), 'data/shield.db', 'server')
export const tableRows = (name: string, limit?: number) => R.tableRows(getDb(), name, limit)

export function query(sql: string) {
  const t0 = performance.now()
  const rows = getReadOnlyDb().all(R.cleanQuery(sql)).slice(0, 500)
  return { rows, ms: Math.round((performance.now() - t0) * 100) / 100 }
}

/** The whole database file, for the Data Vault's download button. */
export function fileBytes() {
  getDb()
  checkpoint()
  return readFileSync(DB_PATH)
}
