import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { MISSIONS, missionById, villainById } from '../data/missions'
import { HEROES, heroById } from '../data/heroes'
import type { Mission, MissionStatus, Threat } from '../data/types'
import { sfx, setSfxEnabled } from '../lib/sfx'
import { record } from '../lib/db'
import { fury } from '../lib/fury'

export const MIN_TEAM = 4
export const MAX_TEAM = 6
/** A pending mission escalates one threat level after this long. */
export const ESCALATE_MS = 120_000
export const THREAT_ORDER: Threat[] = ['LOW', 'MEDIUM', 'HIGH', 'OMEGA']

export interface LogEntry {
  id: number
  time: string
  text: string
  tone: 'info' | 'warn' | 'ok' | 'alert'
}

export interface CampaignStats {
  battles: number
  rounds: number
  losses: number
  damage: Record<string, number>
}

interface ShieldState {
  view: 'landing' | 'console'
  sound: boolean
  team: string[]
  assignments: Record<string, string[]>
  status: Record<string, MissionStatus>
  threat: Record<string, Threat>
  /** epoch ms when each pending mission next escalates */
  escalateAt: Record<string, number>
  clockPaused: boolean
  /** remaining ms per mission captured when the clock was paused */
  pausedLeft: Record<string, number>
  startedAt: number
  finishedAt: number | null
  stats: CampaignStats
  log: LogEntry[]
  toast: { text: string; tone: LogEntry['tone']; key: number } | null
  focusMission: string | null
  battleId: string | null

  setView: (v: 'landing' | 'console') => void
  toggleSound: () => void
  toggleTeam: (heroId: string) => void
  clearTeam: () => void
  /** Pick a random, role-balanced team of 4–6 from available heroes. */
  randomTeam: () => string[]
  /** Random team → random open mission → deploy. Returns the mission id (or null). */
  randomBattle: () => string | null
  assignTeam: (missionId: string) => boolean
  unassign: (missionId: string) => void
  setStatus: (missionId: string, status: MissionStatus) => void
  resolveBattle: (missionId: string, won: boolean, rounds: number, damage: Record<string, number>) => void
  tick: () => void
  toggleClock: () => void
  setFocusMission: (id: string | null) => void
  setBattle: (id: string | null) => void
  notify: (text: string, tone?: LogEntry['tone']) => void
  completeAll: () => void
  reset: () => void
}

const stamp = () => new Date().toLocaleTimeString('en-GB', { hour12: false })

const initialStatus = (): Record<string, MissionStatus> =>
  Object.fromEntries(MISSIONS.map((m) => [m.id, 'Pending' as MissionStatus]))
const initialThreat = (): Record<string, Threat> => Object.fromEntries(MISSIONS.map((m) => [m.id, m.threat]))
const initialClock = (now = Date.now()): Record<string, number> =>
  // stagger so missions don't all escalate on the same tick
  Object.fromEntries(MISSIONS.map((m, i) => [m.id, now + ESCALATE_MS + i * 17_000]))
const emptyStats = (): CampaignStats => ({ battles: 0, rounds: 0, losses: 0, damage: {} })

const seedLog: LogEntry[] = [
  { id: 4, time: '06:14:20', text: 'Ultimatum broadcast intercepted from Latveria.', tone: 'alert' },
  { id: 3, time: '06:12:44', text: 'Temporal distortion detected over Shinjuku.', tone: 'warn' },
  { id: 2, time: '06:09:02', text: 'Bifrost signature above Oslo fjord.', tone: 'alert' },
  { id: 1, time: '06:01:17', text: 'Helicarrier Iliad online. All systems nominal.', tone: 'info' },
]

/** Hero ids currently tied up on a mission that isn't finished. */
export const deployedHeroIds = (s: Pick<ShieldState, 'assignments' | 'status'>) => {
  const ids = new Set<string>()
  for (const [mid, heroes] of Object.entries(s.assignments)) {
    if (s.status[mid] !== 'Completed') heroes.forEach((h) => ids.add(h))
  }
  return ids
}

export const completedCount = (s: Pick<ShieldState, 'status'>) => MISSIONS.filter((m) => s.status[m.id] === 'Completed').length

/** Final-boss missions are sealed until enough others are done. */
export const isSealed = (s: Pick<ShieldState, 'status'>, m: Mission) =>
  !!m.unlockAfter && completedCount(s) < m.unlockAfter

/** How many levels a mission has escalated above its starting threat. */
export const escalation = (s: Pick<ShieldState, 'threat'>, m: Mission) =>
  THREAT_ORDER.indexOf(s.threat[m.id] ?? m.threat) - THREAT_ORDER.indexOf(m.threat)

export const useShieldStore = create<ShieldState>()(
  persist(
    (set, get) => {
      const push = (text: string, tone: LogEntry['tone'] = 'info') => {
        set((s) => ({
          log: [{ id: Date.now() + Math.random(), time: stamp(), text, tone }, ...s.log].slice(0, 40),
          toast: { text, tone, key: Date.now() },
        }))
        sfx(tone === 'alert' ? 'alarm' : tone === 'warn' ? 'deny' : tone === 'ok' ? 'confirm' : 'blip')
        record({ type: 'log', text, tone })
      }

      return {
        view: typeof sessionStorage !== 'undefined' && sessionStorage.getItem('shield-view') === 'console' ? 'console' : 'landing',
        sound: false,
        team: [],
        assignments: {},
        status: initialStatus(),
        threat: initialThreat(),
        escalateAt: initialClock(),
        clockPaused: false,
        pausedLeft: {},
        startedAt: Date.now(),
        finishedAt: null,
        stats: emptyStats(),
        log: seedLog,
        toast: null,
        focusMission: null,
        battleId: null,

        notify: push,
        setView: (view) => {
          sessionStorage.setItem('shield-view', view)
          set({ view })
        },
        toggleSound: () => {
          const on = !get().sound
          setSfxEnabled(on)
          set({ sound: on })
          sfx('confirm')
        },

        toggleTeam: (heroId) => {
          const { team } = get()
          if (team.includes(heroId)) {
            set({ team: team.filter((t) => t !== heroId) })
            sfx('blip')
            return
          }
          if (deployedHeroIds(get()).has(heroId)) {
            push(`${heroById(heroId).name} is already deployed on another mission.`, 'warn')
            return
          }
          if (team.length >= MAX_TEAM) {
            push(`Strike team is full — ${MAX_TEAM} heroes maximum.`, 'warn')
            fury('teamFull')
            return
          }
          set({ team: [...team, heroId] })
          sfx('select')
        },

        clearTeam: () => set({ team: [] }),

        randomTeam: () => {
          const busy = deployedHeroIds(get())
          const pool = HEROES.filter((h) => !busy.has(h.id)).sort(() => Math.random() - 0.5)
          if (pool.length < MIN_TEAM) {
            push(`Only ${pool.length} heroes free — recall a team first.`, 'warn')
            return []
          }
          const size = Math.min(pool.length, MIN_TEAM + Math.floor(Math.random() * (MAX_TEAM - MIN_TEAM + 1)))
          // one of each role first for synergy, then fill
          const picked: string[] = []
          const roles = new Set<string>()
          for (const h of pool) if (picked.length < size && !roles.has(h.role)) { picked.push(h.id); roles.add(h.role) }
          for (const h of pool) if (picked.length < size && !picked.includes(h.id)) picked.push(h.id)
          set({ team: picked })
          sfx('confirm')
          return picked
        },

        randomBattle: () => {
          const s = get()
          const open = MISSIONS.filter((m) => s.status[m.id] === 'Pending' && !isSealed(s, m))
          if (!open.length) {
            push('No open missions left to fight.', 'warn')
            return null
          }
          if (get().team.length < MIN_TEAM && get().randomTeam().length < MIN_TEAM) return null
          const m = open[Math.floor(Math.random() * open.length)]
          if (!get().assignTeam(m.id)) return null
          set({ battleId: null })
          set({ battleId: m.id })
          return m.id
        },

        assignTeam: (missionId) => {
          const s = get()
          const m = missionById(missionId)
          if (isSealed(s, m)) {
            push(`${m.codename} is sealed. Complete ${m.unlockAfter} other missions first.`, 'warn')
            return false
          }
          if (s.team.length < MIN_TEAM) {
            push(`Select at least ${MIN_TEAM} heroes before deploying.`, 'warn')
            return false
          }
          if (s.status[missionId] === 'Completed') {
            push(`${m.codename} is already completed.`, 'warn')
            return false
          }
          const busy = s.team.filter((h) => deployedHeroIds(s).has(h))
          if (busy.length) {
            push(`${busy.map((b) => heroById(b).name).join(', ')} already deployed.`, 'warn')
            return false
          }
          set({
            assignments: { ...s.assignments, [missionId]: [...(s.assignments[missionId] ?? []), ...s.team] },
            status: { ...s.status, [missionId]: 'In Progress' },
            team: [],
          })
          record({ type: 'deploy', missionId, heroIds: s.team })
          push(`Team deployed to ${m.codename} — ${m.location}.`, 'ok')
          sfx('deploy')
          const names = s.team.map((h) => heroById(h).name)
          fury('deploy', { team: names.length > 2 ? `${names.slice(0, 2).join(', ')} and the rest` : names.join(' and '), mission: m.codename, location: m.location })
          return true
        },

        unassign: (missionId) => {
          const s = get()
          const { [missionId]: _removed, ...rest } = s.assignments
          void _removed
          const pending = s.status[missionId] !== 'Completed'
          set({
            assignments: rest,
            status: { ...s.status, [missionId]: pending ? 'Pending' : 'Completed' },
            escalateAt: pending ? { ...s.escalateAt, [missionId]: Date.now() + ESCALATE_MS } : s.escalateAt,
          })
          record({ type: 'recall', missionId })
          push(`Team recalled from ${missionById(missionId).codename}.`, 'info')
          fury('recall', { mission: missionById(missionId).codename })
        },

        setStatus: (missionId, status) => {
          const s = get()
          const m = missionById(missionId)
          if (status === 'In Progress' && !(s.assignments[missionId]?.length)) {
            push(`Assign a team to ${m.codename} before starting it.`, 'warn')
            return
          }
          const next = { ...s.status, [missionId]: status }
          set({
            status: next,
            escalateAt: status === 'Pending' ? { ...s.escalateAt, [missionId]: Date.now() + ESCALATE_MS } : s.escalateAt,
            finishedAt: completedCount({ status: next }) === MISSIONS.length ? Date.now() : null,
          })
          record({ type: 'status', missionId, status })
          push(`${m.codename} → ${status}.`, status === 'Completed' ? 'ok' : 'info')
        },

        resolveBattle: (missionId, won, rounds, damage) => {
          const s = get()
          const m = missionById(missionId)
          const merged = { ...s.stats.damage }
          for (const [k, v] of Object.entries(damage)) merged[k] = (merged[k] ?? 0) + v
          const stats = { battles: s.stats.battles + 1, rounds: s.stats.rounds + rounds, losses: s.stats.losses + (won ? 0 : 1), damage: merged }
          record({ type: 'battle', missionId, won, rounds, damage })
          const villain = villainById(m.villainId).name
          if (won) {
            const next = { ...s.status, [missionId]: 'Completed' as MissionStatus }
            const done = completedCount({ status: next }) === MISSIONS.length
            const unlocked = MISSIONS.some((x) => x.unlockAfter && isSealed(s, x) && !isSealed({ status: next }, x))
            set({ status: next, stats, finishedAt: done ? Date.now() : null })
            push(`Victory at ${m.location}. ${m.codename} completed.`, 'ok')
            sfx('win')
            if (done) fury('allClear')
            else {
              fury('win', { villain, mission: m.codename })
              if (unlocked) setTimeout(() => fury('doomUnlocked'), 5000)
            }
          } else {
            const { [missionId]: _r, ...rest } = s.assignments
            void _r
            set({
              assignments: rest,
              status: { ...s.status, [missionId]: 'Pending' },
              escalateAt: { ...s.escalateAt, [missionId]: Date.now() + ESCALATE_MS },
              stats,
            })
            push(`Team forced to retreat from ${m.codename}. Mission reset to Pending.`, 'alert')
            fury('loss', { villain, mission: m.codename })
          }
        },

        /** Called once a second: escalate any pending mission whose clock ran out. */
        tick: () => {
          const s = get()
          if (s.clockPaused || s.view !== 'console' || s.finishedAt) return
          const now = Date.now()
          let threat = s.threat
          let escalateAt = s.escalateAt
          for (const m of MISSIONS) {
            if (s.status[m.id] !== 'Pending' || isSealed(s, m)) continue
            if ((escalateAt[m.id] ?? Infinity) > now) continue
            const cur = threat[m.id] ?? m.threat
            const idx = THREAT_ORDER.indexOf(cur)
            escalateAt = { ...escalateAt, [m.id]: now + ESCALATE_MS }
            if (idx < THREAT_ORDER.length - 1) {
              const nextT = THREAT_ORDER[idx + 1]
              threat = { ...threat, [m.id]: nextT }
              set({ threat, escalateAt })
              record({ type: 'threat', missionId: m.id, threat: nextT })
              push(`${m.codename} escalated to ${nextT}. ${m.location} is getting worse.`, nextT === 'OMEGA' ? 'alert' : 'warn')
              fury(nextT === 'OMEGA' ? 'omega' : 'escalate', { mission: m.codename, threat: nextT, location: m.location })
            } else {
              set({ escalateAt })
            }
          }
        },

        toggleClock: () => {
          const s = get()
          const now = Date.now()
          if (s.clockPaused) {
            const escalateAt = { ...s.escalateAt }
            for (const [id, left] of Object.entries(s.pausedLeft)) escalateAt[id] = now + left
            set({ clockPaused: false, escalateAt, pausedLeft: {} })
          } else {
            const pausedLeft = Object.fromEntries(Object.entries(s.escalateAt).map(([id, t]) => [id, Math.max(0, t - now)]))
            set({ clockPaused: true, pausedLeft })
          }
          sfx('blip')
        },

        setFocusMission: (id) => set({ focusMission: id }),
        setBattle: (id) => set({ battleId: id }),

        /** Dev/test helper: mark everything complete to preview the finale. */
        completeAll: () => set({ status: Object.fromEntries(MISSIONS.map((m) => [m.id, 'Completed' as MissionStatus])), finishedAt: Date.now() }),

        reset: () => {
          set({
            team: [],
            assignments: {},
            status: initialStatus(),
            threat: initialThreat(),
            escalateAt: initialClock(),
            clockPaused: false,
            pausedLeft: {},
            startedAt: Date.now(),
            finishedAt: null,
            stats: emptyStats(),
            log: seedLog,
            focusMission: null,
            battleId: null,
          })
          record({ type: 'reset' })
          push('Command console reset.', 'info')
          fury('reset')
        },
      }
    },
    {
      name: 'shield-command-v2',
      partialize: (s) => ({
        sound: s.sound,
        team: s.team,
        assignments: s.assignments,
        status: s.status,
        threat: s.threat,
        escalateAt: s.escalateAt,
        clockPaused: s.clockPaused,
        pausedLeft: s.pausedLeft,
        startedAt: s.startedAt,
        finishedAt: s.finishedAt,
        stats: s.stats,
        log: s.log,
      }),
      onRehydrateStorage: () => (s) => setSfxEnabled(!!s?.sound),
    },
  ),
)
