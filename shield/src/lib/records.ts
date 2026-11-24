/**
 * S.H.I.E.L.D. records — the SQLite schema and every read/write the app makes.
 *
 * Engine-agnostic: the same SQL runs on
 *   - the server, through Node's built-in `node:sqlite` (server/db.ts → data/shield.db), and
 *   - the browser, through sql.js — SQLite compiled to WebAssembly (src/lib/localDb.ts),
 *     used when the site is deployed without the API (e.g. a static Vercel deploy).
 * Each side passes in a tiny adapter (`Sql`) over its driver.
 */
import { HEROES, powerScore } from '../data/heroes'
import { MISSIONS, VILLAINS } from '../data/missions'

export type Param = string | number | null
export interface Sql {
  exec(sql: string): void
  run(sql: string, params?: Param[]): { lastId: number }
  all<T = Record<string, Param>>(sql: string, params?: Param[]): T[]
}
const get = <T>(db: Sql, sql: string, params?: Param[]) => db.all<T>(sql, params)[0] as T | undefined

export const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS heroes (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  real_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('Powerhouse','Tech','Mystic','Tactician','Infiltrator','Marksman')),
  base          TEXT NOT NULL,
  clearance     INTEGER NOT NULL CHECK (clearance BETWEEN 1 AND 10),
  power         INTEGER NOT NULL,
  speed         INTEGER NOT NULL,
  intelligence  INTEGER NOT NULL,
  durability    INTEGER NOT NULL,
  combat        INTEGER NOT NULL,
  power_score   INTEGER NOT NULL,
  doomsday      INTEGER NOT NULL DEFAULT 0,
  bio           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS abilities (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  hero_id      TEXT NOT NULL REFERENCES heroes(id) ON DELETE CASCADE,
  slot         TEXT NOT NULL CHECK (slot IN ('Q','W','E')),
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('attack','special','support')),
  damage       INTEGER NOT NULL,
  description  TEXT NOT NULL,
  UNIQUE (hero_id, slot)
);

CREATE TABLE IF NOT EXISTS combos (
  hero_id      TEXT PRIMARY KEY REFERENCES heroes(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  hits         INTEGER NOT NULL,
  bonus        REAL NOT NULL,
  description  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS villains (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  title   TEXT NOT NULL,
  hp      INTEGER NOT NULL,
  attack  INTEGER NOT NULL,
  moves   TEXT NOT NULL            -- JSON array
);

CREATE TABLE IF NOT EXISTS missions (
  id              TEXT PRIMARY KEY,
  codename        TEXT NOT NULL,
  villain_id      TEXT NOT NULL REFERENCES villains(id),
  location        TEXT NOT NULL,
  lat             REAL NOT NULL,
  lng             REAL NOT NULL,
  base_threat     TEXT NOT NULL CHECK (base_threat IN ('LOW','MEDIUM','HIGH','OMEGA')),
  current_threat  TEXT NOT NULL CHECK (current_threat IN ('LOW','MEDIUM','HIGH','OMEGA')),
  status          TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','In Progress','Completed')),
  unlock_after    INTEGER,
  briefing        TEXT NOT NULL,
  objective       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deployments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id   TEXT NOT NULL REFERENCES missions(id),
  hero_id      TEXT NOT NULL REFERENCES heroes(id),
  deployed_at  TEXT NOT NULL DEFAULT (datetime('now')),
  recalled_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_deployments_active ON deployments(mission_id) WHERE recalled_at IS NULL;

CREATE TABLE IF NOT EXISTS battles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id    TEXT NOT NULL REFERENCES missions(id),
  villain_id    TEXT NOT NULL REFERENCES villains(id),
  outcome       TEXT NOT NULL CHECK (outcome IN ('win','loss')),
  rounds        INTEGER NOT NULL,
  total_damage  INTEGER NOT NULL,
  fought_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS battle_damage (
  battle_id  INTEGER NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
  hero_id    TEXT NOT NULL REFERENCES heroes(id),
  damage     INTEGER NOT NULL,
  PRIMARY KEY (battle_id, hero_id)
);

CREATE TABLE IF NOT EXISTS mission_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id  TEXT NOT NULL REFERENCES missions(id),
  event       TEXT NOT NULL,     -- status | threat | deploy | recall
  value       TEXT NOT NULL,
  at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity_log (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  text  TEXT NOT NULL,
  tone  TEXT NOT NULL CHECK (tone IN ('info','warn','ok','alert')),
  at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Handy views for the judges' demo
CREATE VIEW IF NOT EXISTS hero_leaderboard AS
  SELECT h.name, h.role, COUNT(DISTINCT bd.battle_id) AS battles, COALESCE(SUM(bd.damage), 0) AS total_damage,
         SUM(CASE WHEN b.outcome = 'win' THEN 1 ELSE 0 END) AS wins
  FROM heroes h
  LEFT JOIN battle_damage bd ON bd.hero_id = h.id
  LEFT JOIN battles b ON b.id = bd.battle_id
  GROUP BY h.id
  ORDER BY total_damage DESC;

CREATE VIEW IF NOT EXISTS active_deployments AS
  SELECT m.codename, m.status, h.name AS hero, d.deployed_at
  FROM deployments d
  JOIN missions m ON m.id = d.mission_id
  JOIN heroes h ON h.id = d.hero_id
  WHERE d.recalled_at IS NULL AND m.status != 'Completed';
`

/** Tables shown in the Data Vault, in display order. */
export const TABLES = [
  'heroes', 'abilities', 'combos', 'villains', 'missions',
  'deployments', 'battles', 'battle_damage', 'mission_events', 'activity_log',
  'hero_leaderboard', 'active_deployments',
] as const

function tx(db: Sql, fn: () => void) {
  db.exec('BEGIN')
  try {
    fn()
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

/** Create tables/views and upsert the reference data from src/data (safe to run every start). */
export function setup(db: Sql) {
  db.exec(SCHEMA)
  tx(db, () => {
    for (const h of HEROES) {
      const s = h.stats
      db.run(
        `INSERT INTO heroes (id, name, real_name, role, base, clearance, power, speed, intelligence, durability, combat, power_score, doomsday, bio)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, real_name=excluded.real_name, role=excluded.role, base=excluded.base,
           clearance=excluded.clearance, power=excluded.power, speed=excluded.speed, intelligence=excluded.intelligence,
           durability=excluded.durability, combat=excluded.combat, power_score=excluded.power_score, doomsday=excluded.doomsday, bio=excluded.bio`,
        [h.id, h.name, h.realName, h.role, h.base, h.clearance, s.power, s.speed, s.intelligence, s.durability, s.combat, powerScore(h), h.doomsday ? 1 : 0, h.bio],
      )
      h.abilities.forEach((a, i) =>
        db.run(
          `INSERT INTO abilities (hero_id, slot, name, kind, damage, description) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(hero_id, slot) DO UPDATE SET name=excluded.name, kind=excluded.kind, damage=excluded.damage, description=excluded.description`,
          [h.id, 'QWE'[i], a.name, a.kind, a.damage, a.description],
        ),
      )
      db.run(
        `INSERT INTO combos (hero_id, name, hits, bonus, description) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(hero_id) DO UPDATE SET name=excluded.name, hits=excluded.hits, bonus=excluded.bonus, description=excluded.description`,
        [h.id, h.combo.name, h.combo.hits, h.combo.bonus, h.combo.description],
      )
    }
    for (const v of VILLAINS) {
      db.run(
        `INSERT INTO villains (id, name, title, hp, attack, moves) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, title=excluded.title, hp=excluded.hp, attack=excluded.attack, moves=excluded.moves`,
        [v.id, v.name, v.title, v.hp, v.attack, JSON.stringify(v.moves)],
      )
    }
    // missions: keep live status/threat if the row already exists
    for (const m of MISSIONS) {
      db.run(
        `INSERT INTO missions (id, codename, villain_id, location, lat, lng, base_threat, current_threat, unlock_after, briefing, objective)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET codename=excluded.codename, villain_id=excluded.villain_id, location=excluded.location,
           lat=excluded.lat, lng=excluded.lng, base_threat=excluded.base_threat, unlock_after=excluded.unlock_after,
           briefing=excluded.briefing, objective=excluded.objective`,
        [m.id, m.codename, m.villainId, m.location, m.lat, m.lng, m.threat, m.threat, m.unlockAfter ?? null, m.briefing, m.objective],
      )
    }
  })
}

/* ───────────────────────── writes from the app ───────────────────────── */

export type DbEvent =
  | { type: 'deploy'; missionId: string; heroIds: string[] }
  | { type: 'recall'; missionId: string }
  | { type: 'status'; missionId: string; status: 'Pending' | 'In Progress' | 'Completed' }
  | { type: 'threat'; missionId: string; threat: 'LOW' | 'MEDIUM' | 'HIGH' | 'OMEGA' }
  | { type: 'battle'; missionId: string; won: boolean; rounds: number; damage: Record<string, number> }
  | { type: 'log'; text: string; tone: 'info' | 'warn' | 'ok' | 'alert' }
  | { type: 'reset' }

export const EVENT_TYPES = new Set(['deploy', 'recall', 'status', 'threat', 'battle', 'log', 'reset'])

export function record(db: Sql, ev: DbEvent) {
  const event = (mission: string, kind: string, value: string) =>
    db.run('INSERT INTO mission_events (mission_id, event, value) VALUES (?, ?, ?)', [mission, kind, value])
  const recallAll = (mission: string) =>
    db.run("UPDATE deployments SET recalled_at = datetime('now') WHERE mission_id = ? AND recalled_at IS NULL", [mission])
  const setStatus = (status: string, mission: string) => db.run('UPDATE missions SET status = ? WHERE id = ?', [status, mission])

  tx(db, () => {
    switch (ev.type) {
      case 'deploy':
        ev.heroIds.forEach((h) => db.run('INSERT INTO deployments (mission_id, hero_id) VALUES (?, ?)', [ev.missionId, h]))
        setStatus('In Progress', ev.missionId)
        event(ev.missionId, 'deploy', ev.heroIds.join(','))
        break
      case 'recall':
        recallAll(ev.missionId)
        db.run("UPDATE missions SET status = 'Pending' WHERE id = ? AND status != 'Completed'", [ev.missionId])
        event(ev.missionId, 'recall', '')
        break
      case 'status':
        setStatus(ev.status, ev.missionId)
        if (ev.status === 'Pending') recallAll(ev.missionId)
        event(ev.missionId, 'status', ev.status)
        break
      case 'threat':
        db.run('UPDATE missions SET current_threat = ? WHERE id = ?', [ev.threat, ev.missionId])
        event(ev.missionId, 'threat', ev.threat)
        break
      case 'battle': {
        const m = get<{ villain_id: string }>(db, 'SELECT villain_id FROM missions WHERE id = ?', [ev.missionId])
        if (!m) throw new Error(`unknown mission ${ev.missionId}`)
        const total = Object.values(ev.damage).reduce((a, b) => a + b, 0)
        const { lastId } = db.run('INSERT INTO battles (mission_id, villain_id, outcome, rounds, total_damage) VALUES (?, ?, ?, ?, ?)', [
          ev.missionId, m.villain_id, ev.won ? 'win' : 'loss', ev.rounds, total,
        ])
        for (const [hero, v] of Object.entries(ev.damage)) db.run('INSERT INTO battle_damage (battle_id, hero_id, damage) VALUES (?, ?, ?)', [lastId, hero, v])
        setStatus(ev.won ? 'Completed' : 'Pending', ev.missionId)
        if (!ev.won) recallAll(ev.missionId)
        event(ev.missionId, 'status', ev.won ? 'Completed' : 'Pending')
        break
      }
      case 'log':
        db.run('INSERT INTO activity_log (text, tone) VALUES (?, ?)', [ev.text, ev.tone])
        break
      case 'reset':
        // wipe play history, keep reference data
        db.exec(`DELETE FROM battle_damage; DELETE FROM battles; DELETE FROM deployments; DELETE FROM mission_events; DELETE FROM activity_log;
                 UPDATE missions SET status = 'Pending', current_threat = base_threat;`)
        break
    }
  })
}

/* ───────────────────────── reads for the Data Vault ───────────────────────── */

export interface TableInfo {
  name: string
  type: 'table' | 'view'
  rows: number
  columns: { name: string; type: string; pk: boolean }[]
  sql: string
}
export interface DbSummary {
  file: string
  engine: 'server' | 'browser'
  sqliteVersion: string
  tables: TableInfo[]
}

export function summary(db: Sql, file: string, engine: DbSummary['engine']): DbSummary {
  const objects = db.all<{ name: string; type: 'table' | 'view'; sql: string }>(
    "SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'",
  )
  const byName = new Map(objects.map((o) => [o.name, o]))
  const version = get<{ v: string }>(db, 'SELECT sqlite_version() AS v')!.v
  return {
    file,
    engine,
    sqliteVersion: version,
    tables: TABLES.filter((t) => byName.has(t)).map((t) => {
      const o = byName.get(t)!
      const count = get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM "${t}"`)!.n
      const columns = db.all<{ name: string; type: string; pk: number }>(`PRAGMA table_info("${t}")`).map((c) => ({ name: c.name, type: c.type, pk: !!c.pk }))
      return { name: t, type: o.type, rows: count, columns, sql: o.sql }
    }),
  }
}

export function tableRows(db: Sql, name: string, limit = 50) {
  if (!(TABLES as readonly string[]).includes(name)) throw new Error('Unknown table')
  const order = ['deployments', 'battles', 'mission_events', 'activity_log'].includes(name) ? ' ORDER BY id DESC' : ''
  return db.all(`SELECT * FROM "${name}"${order} LIMIT ?`, [Math.min(500, Math.max(1, limit))])
}

/** Normalise a console query; the caller runs it on a connection that can't write. */
export function cleanQuery(sql: string) {
  const text = sql.trim().replace(/;\s*$/, '')
  if (!text) throw new Error('Empty query')
  if (text.includes(';')) throw new Error('One statement at a time')
  return text
}
