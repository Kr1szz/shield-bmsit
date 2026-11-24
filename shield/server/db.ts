/**
 * S.H.I.E.L.D. records — SQLite 3 database.
 *
 * Uses Node's built-in SQLite driver (`node:sqlite`, Node 22.5+), so there is nothing native to install.
 * The file lives at `data/shield.db` and is a standard SQLite 3 database: open it with the
 * `sqlite3` CLI, DB Browser for SQLite, or any SQLite tool.
 *
 * Reference tables (heroes, abilities, combos, villains, missions) are seeded from `src/data`.
 * Activity tables (deployments, battles, battle_damage, mission_events, activity_log) are written
 * by the app as you play, through the `/api` routes in `server/api.ts`.
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { HEROES, powerScore } from '../src/data/heroes'
import { MISSIONS, VILLAINS } from '../src/data/missions'

export const DB_PATH = resolve(process.cwd(), 'data', 'shield.db')

const SCHEMA = /* sql */ `
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

let db: DatabaseSync | null = null
let ro: DatabaseSync | null = null

function seed(d: DatabaseSync) {
  const hero = d.prepare(`
    INSERT INTO heroes (id, name, real_name, role, base, clearance, power, speed, intelligence, durability, combat, power_score, doomsday, bio)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, real_name=excluded.real_name, role=excluded.role, base=excluded.base,
      clearance=excluded.clearance, power=excluded.power, speed=excluded.speed, intelligence=excluded.intelligence,
      durability=excluded.durability, combat=excluded.combat, power_score=excluded.power_score, doomsday=excluded.doomsday, bio=excluded.bio`)
  const ability = d.prepare(`
    INSERT INTO abilities (hero_id, slot, name, kind, damage, description) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(hero_id, slot) DO UPDATE SET name=excluded.name, kind=excluded.kind, damage=excluded.damage, description=excluded.description`)
  const combo = d.prepare(`
    INSERT INTO combos (hero_id, name, hits, bonus, description) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(hero_id) DO UPDATE SET name=excluded.name, hits=excluded.hits, bonus=excluded.bonus, description=excluded.description`)
  const villain = d.prepare(`
    INSERT INTO villains (id, name, title, hp, attack, moves) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, title=excluded.title, hp=excluded.hp, attack=excluded.attack, moves=excluded.moves`)
  // missions: keep live status/threat if the row already exists
  const mission = d.prepare(`
    INSERT INTO missions (id, codename, villain_id, location, lat, lng, base_threat, current_threat, unlock_after, briefing, objective)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET codename=excluded.codename, villain_id=excluded.villain_id, location=excluded.location,
      lat=excluded.lat, lng=excluded.lng, base_threat=excluded.base_threat, unlock_after=excluded.unlock_after,
      briefing=excluded.briefing, objective=excluded.objective`)

  d.exec('BEGIN')
  try {
    for (const h of HEROES) {
      const s = h.stats
      hero.run(h.id, h.name, h.realName, h.role, h.base, h.clearance, s.power, s.speed, s.intelligence, s.durability, s.combat, powerScore(h), h.doomsday ? 1 : 0, h.bio)
      h.abilities.forEach((a, i) => ability.run(h.id, 'QWE'[i], a.name, a.kind, a.damage, a.description))
      combo.run(h.id, h.combo.name, h.combo.hits, h.combo.bonus, h.combo.description)
    }
    for (const v of VILLAINS) villain.run(v.id, v.name, v.title, v.hp, v.attack, JSON.stringify(v.moves))
    for (const m of MISSIONS) mission.run(m.id, m.codename, m.villainId, m.location, m.lat, m.lng, m.threat, m.threat, m.unlockAfter ?? null, m.briefing, m.objective)
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
}

/** Read-write connection (created + seeded on first use). */
export function getDb() {
  if (db) return db
  mkdirSync(dirname(DB_PATH), { recursive: true })
  db = new DatabaseSync(DB_PATH, { enableForeignKeyConstraints: true })
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec(SCHEMA)
  seed(db)
  return db
}

/** Read-only connection for the SQL console — writes are rejected by SQLite itself. */
export function getReadOnlyDb() {
  if (ro) return ro
  getDb()
  ro = new DatabaseSync(DB_PATH, { readOnly: true })
  return ro
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

export function record(ev: DbEvent) {
  const d = getDb()
  const event = d.prepare('INSERT INTO mission_events (mission_id, event, value) VALUES (?, ?, ?)')
  const recallAll = d.prepare("UPDATE deployments SET recalled_at = datetime('now') WHERE mission_id = ? AND recalled_at IS NULL")
  const setStatus = d.prepare('UPDATE missions SET status = ? WHERE id = ?')

  d.exec('BEGIN')
  try {
    switch (ev.type) {
      case 'deploy': {
        const ins = d.prepare('INSERT INTO deployments (mission_id, hero_id) VALUES (?, ?)')
        ev.heroIds.forEach((h) => ins.run(ev.missionId, h))
        setStatus.run('In Progress', ev.missionId)
        event.run(ev.missionId, 'deploy', ev.heroIds.join(','))
        break
      }
      case 'recall':
        recallAll.run(ev.missionId)
        d.prepare("UPDATE missions SET status = 'Pending' WHERE id = ? AND status != 'Completed'").run(ev.missionId)
        event.run(ev.missionId, 'recall', '')
        break
      case 'status':
        setStatus.run(ev.status, ev.missionId)
        if (ev.status === 'Pending') recallAll.run(ev.missionId)
        event.run(ev.missionId, 'status', ev.status)
        break
      case 'threat':
        d.prepare('UPDATE missions SET current_threat = ? WHERE id = ?').run(ev.threat, ev.missionId)
        event.run(ev.missionId, 'threat', ev.threat)
        break
      case 'battle': {
        const m = d.prepare('SELECT villain_id FROM missions WHERE id = ?').get(ev.missionId) as { villain_id: string } | undefined
        if (!m) throw new Error(`unknown mission ${ev.missionId}`)
        const total = Object.values(ev.damage).reduce((a, b) => a + b, 0)
        const res = d.prepare('INSERT INTO battles (mission_id, villain_id, outcome, rounds, total_damage) VALUES (?, ?, ?, ?, ?)')
          .run(ev.missionId, m.villain_id, ev.won ? 'win' : 'loss', ev.rounds, total)
        const dmg = d.prepare('INSERT INTO battle_damage (battle_id, hero_id, damage) VALUES (?, ?, ?)')
        for (const [hero, v] of Object.entries(ev.damage)) dmg.run(res.lastInsertRowid, hero, v)
        setStatus.run(ev.won ? 'Completed' : 'Pending', ev.missionId)
        if (!ev.won) recallAll.run(ev.missionId)
        event.run(ev.missionId, 'status', ev.won ? 'Completed' : 'Pending')
        break
      }
      case 'log':
        d.prepare('INSERT INTO activity_log (text, tone) VALUES (?, ?)').run(ev.text, ev.tone)
        break
      case 'reset':
        // wipe play history, keep reference data
        d.exec(`DELETE FROM battle_damage; DELETE FROM battles; DELETE FROM deployments; DELETE FROM mission_events; DELETE FROM activity_log;
                UPDATE missions SET status = 'Pending', current_threat = base_threat;`)
        break
    }
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
  // fold the WAL back into shield.db so the file is always complete on its own (copy it, open it anywhere)
  d.exec('PRAGMA wal_checkpoint(PASSIVE)')
}

/* ───────────────────────── reads for the Data Vault ───────────────────────── */

export function summary() {
  const d = getDb()
  const objects = d.prepare("SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'").all() as { name: string; type: string; sql: string }[]
  const byName = new Map(objects.map((o) => [o.name, o]))
  const version = (d.prepare('SELECT sqlite_version() AS v').get() as { v: string }).v
  return {
    file: 'data/shield.db',
    sqliteVersion: version,
    tables: TABLES.filter((t) => byName.has(t)).map((t) => {
      const o = byName.get(t)!
      const count = (d.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n
      const columns = (d.prepare(`PRAGMA table_info("${t}")`).all() as { name: string; type: string; pk: number }[]).map((c) => ({ name: c.name, type: c.type, pk: !!c.pk }))
      return { name: t, type: o.type, rows: count, columns, sql: o.sql }
    }),
  }
}

export function tableRows(name: string, limit = 50) {
  if (!(TABLES as readonly string[]).includes(name)) throw new Error('Unknown table')
  const order = ['deployments', 'battles', 'mission_events', 'activity_log'].includes(name) ? ' ORDER BY id DESC' : ''
  return getDb().prepare(`SELECT * FROM "${name}"${order} LIMIT ?`).all(Math.min(500, Math.max(1, limit)))
}

/** Run one read-only statement from the console. */
export function query(sql: string) {
  const text = sql.trim().replace(/;\s*$/, '')
  if (!text) throw new Error('Empty query')
  if (text.includes(';')) throw new Error('One statement at a time')
  const t0 = performance.now()
  const rows = getReadOnlyDb().prepare(text).all().slice(0, 500)
  return { rows, ms: Math.round((performance.now() - t0) * 100) / 100 }
}
