/**
 * In-browser SQLite — the real SQLite engine compiled to WebAssembly (sql.js).
 * Used when the site runs without the server API (e.g. a static Vercel deploy): same schema,
 * same writes, same Data Vault. The database is saved on this device (IndexedDB) so it
 * survives reloads, and can be downloaded as a standard .db file.
 */
import type { Database, SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import * as R from './records'

const IDB_NAME = 'shield-sqlite'
const IDB_STORE = 'files'
const IDB_KEY = 'shield.db'

/* ── tiny IndexedDB key/value for the database bytes ── */
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function loadBytes(): Promise<Uint8Array | null> {
  try {
    const db = await idb()
    return await new Promise((resolve) => {
      const req = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(IDB_KEY)
      req.onsuccess = () => resolve((req.result as Uint8Array | undefined) ?? null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null // private mode / storage blocked: start fresh each visit
  }
}
async function saveBytes(bytes: Uint8Array) {
  try {
    const db = await idb()
    db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(bytes, IDB_KEY)
  } catch {
    /* storage blocked — keep working in memory */
  }
}

/** Adapt a sql.js Database to the shared `Sql` interface. */
function adapt(d: Database): R.Sql {
  const all = <T>(sql: string, params: R.Param[] = []) => {
    const stmt = d.prepare(sql)
    try {
      stmt.bind(params)
      const rows: T[] = []
      while (stmt.step()) rows.push(stmt.getAsObject() as T)
      return rows
    } finally {
      stmt.free()
    }
  }
  return {
    exec: (sql) => d.exec(sql),
    run: (sql, params = []) => {
      d.run(sql, params)
      const id = d.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0]
      return { lastId: Number(id ?? 0) }
    },
    all,
  }
}

let ready: Promise<{ SQL: SqlJsStatic; raw: Database; sql: R.Sql }> | null = null

function open() {
  if (!ready) {
    ready = (async () => {
      const { default: initSqlJs } = await import('sql.js')
      // (@types/sql.js describes a newer release; useOldExtensionFunctions is ignored by 1.13)
      const SQL = await initSqlJs({ locateFile: () => wasmUrl, useOldExtensionFunctions: false })
      const saved = await loadBytes()
      const raw = saved ? new SQL.Database(saved) : new SQL.Database()
      raw.exec('PRAGMA foreign_keys = ON;')
      const sql = adapt(raw)
      R.setup(sql) // create tables and refresh reference data
      void saveBytes(raw.export())
      return { SQL, raw, sql }
    })()
  }
  return ready
}

// writes are applied in order and saved after each one
let chain: Promise<unknown> = Promise.resolve()

export const localDb = {
  record(ev: R.DbEvent) {
    chain = chain.then(async () => {
      const { raw, sql } = await open()
      R.record(sql, ev)
      await saveBytes(raw.export())
    })
    return chain
  },
  async summary() {
    const { sql } = await open()
    return R.summary(sql, 'shield.db (in this browser)', 'browser')
  },
  async table(name: string, limit = 50) {
    const { sql } = await open()
    return { rows: R.tableRows(sql, name, limit) as Record<string, string | number | null>[] }
  },
  /** Runs on a throwaway copy, so a console query can never change the real data. */
  async query(text: string) {
    const { SQL, raw } = await open()
    const q = R.cleanQuery(text)
    const copy = new SQL.Database(raw.export())
    try {
      const t0 = performance.now()
      const rows = adapt(copy).all<Record<string, string | number | null>>(q).slice(0, 500)
      return { rows, ms: Math.round((performance.now() - t0) * 100) / 100 }
    } finally {
      copy.close()
    }
  },
  async bytes() {
    await chain
    const { raw } = await open()
    return raw.export()
  },
}
