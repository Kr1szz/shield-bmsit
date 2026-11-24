import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { Swords, Zap, Shield, Play, Pause, Flag, RotateCcw, Dices } from 'lucide-react'
import { MISSIONS, missionById, villainById } from '../data/missions'
import { heroById } from '../data/heroes'
import type { Ability, Mission } from '../data/types'
import { escalation, useShieldStore } from '../store/useShieldStore'
import { Portrait, Scramble, ThreatMark, useReveal, reducedMotion, useRandomBattle } from '../components/ui'
import { sfx } from '../lib/sfx'
import { fury } from '../lib/fury'

const SPECIAL_COOLDOWN = 3
const VILLAIN_DELAY = 650

interface Fighter {
  id: string
  hp: number
  max: number
  acted: boolean
  cooldown: number
  /** Kind of this hero's previous action — attack → special next round triggers the combo */
  last: Ability['kind'] | null
}

const comboReady = (f: Fighter) => f.last === 'attack' && f.cooldown === 0

interface Battle {
  missionId: string
  heroes: Fighter[]
  villainHp: number
  villainMax: number
  villainAtk: number
  aoeEvery: number
  round: number
  shield: number
  damage: Record<string, number>
  log: { text: string; tone: 'hero' | 'villain' | 'sys' }[]
  outcome: 'win' | 'loss' | null
}

interface VillainEvents {
  aoe: boolean
  hits: { id: string; dmg: number }[]
  kos: string[]
}

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const INTRO_LINE: Record<string, string> = {
  doom: 'Doom does not kneel.',
  thanos: 'Dread it. Run from it.',
  ultron: 'There are no strings on me.',
  loki: 'I am burdened with glorious purpose.',
  hela: 'Kneel before your queen.',
  'red-skull': 'Hail Hydra.',
  kang: 'I have already won.',
}

function newBattle(m: Mission, heroIds: string[], level: number): Battle {
  const v = villainById(m.villainId)
  const scale = 1 + 0.2 * Math.max(0, level)
  const hp = Math.round(v.hp * scale)
  return {
    missionId: m.id,
    heroes: heroIds.map((id) => {
      const max = Math.round(70 + heroById(id).stats.durability * 0.6)
      return { id, hp: max, max, acted: false, cooldown: 0, last: null }
    }),
    villainHp: hp,
    villainMax: hp,
    villainAtk: Math.round(v.attack * scale),
    aoeEvery: v.id === 'doom' ? 2 : 3,
    round: 1,
    shield: 0,
    damage: {},
    log: [{ text: `Round 1. ${v.name} is in range${level > 0 ? ` (escalated +${level * 20}%)` : ''}. Choose a hero and an ability.`, tone: 'sys' }],
    outcome: null,
  }
}

/** Pure villain turn — returns the new state plus what happened, so FX can be played separately. */
function villainTurn(state: Battle): [Battle, VillainEvents] {
  const v = villainById(missionById(state.missionId).villainId)
  const alive = state.heroes.filter((h) => h.hp > 0)
  const aoe = state.round % state.aoeEvery === 0
  const move = v.moves[Math.floor(Math.random() * v.moves.length)]
  const mult = 1 - state.shield
  const log = [...state.log]
  const hits: VillainEvents['hits'] = []
  let heroes = state.heroes

  if (aoe) {
    heroes = heroes.map((h) => {
      if (h.hp <= 0) return h
      const dmg = Math.round(state.villainAtk * 0.6 * rand(0.85, 1.15) * mult)
      hits.push({ id: h.id, dmg })
      return { ...h, hp: Math.max(0, h.hp - dmg) }
    })
    log.unshift({ text: `${v.name} unleashes ${move} on the whole team${state.shield ? ' (partially blocked)' : ''}.`, tone: 'villain' })
  } else {
    const target = alive[Math.floor(Math.random() * alive.length)]
    const dmg = Math.round(state.villainAtk * rand(1, 1.5) * mult)
    hits.push({ id: target.id, dmg })
    heroes = heroes.map((h) => (h.id === target.id ? { ...h, hp: Math.max(0, h.hp - dmg) } : h))
    log.unshift({ text: `${v.name} hits ${heroById(target.id).name} with ${move} for ${dmg}.`, tone: 'villain' })
  }
  const kos = heroes.filter((h, i) => h.hp === 0 && state.heroes[i].hp > 0).map((h) => h.id)
  kos.forEach((id) => log.unshift({ text: `${heroById(id).name} is down.`, tone: 'sys' }))

  if (!heroes.some((h) => h.hp > 0)) {
    log.unshift({ text: 'All heroes down. Mission failed.', tone: 'sys' })
    return [{ ...state, heroes, log, outcome: 'loss' }, { aoe, hits, kos }]
  }
  const round = state.round + 1
  log.unshift({ text: `— Round ${round} —`, tone: 'sys' })
  return [
    { ...state, heroes: heroes.map((h) => ({ ...h, acted: false, cooldown: Math.max(0, h.cooldown - 1) })), round, shield: 0, log },
    { aoe, hits, kos },
  ]
}

function HpBar({ hp, max, red = false, thick = false }: { hp: number; max: number; red?: boolean; thick?: boolean }) {
  const n = thick ? 40 : 16
  const on = Math.ceil(Math.max(0, hp / max) * n)
  return (
    <div className={`flex gap-[2px] ${thick ? 'h-4' : 'h-2'}`} aria-label={`${hp} of ${max} HP`}>
      {Array.from({ length: n }).map((_, i) => (
        <span key={i} className={`flex-1 ${i < on ? (red ? 'bg-marvel' : 'bg-bone') : 'bg-bone/15'}`} />
      ))}
    </div>
  )
}

/* ───────────────────────── FX helpers (DOM, outside React) ───────────────────────── */

function rel(arena: HTMLElement, el: Element) {
  const a = arena.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  return { x: r.left - a.left, y: r.top - a.top, w: r.width, h: r.height, cx: r.left - a.left + r.width / 2, cy: r.top - a.top + r.height / 2 }
}

function spawn(layer: HTMLElement, css: Partial<CSSStyleDeclaration>, cls = '') {
  const el = document.createElement('div')
  el.className = `pointer-events-none absolute ${cls}`
  Object.assign(el.style, css)
  layer.appendChild(el)
  return el
}

const Fx = {
  floatText(arena: HTMLElement, layer: HTMLElement, target: Element | null, text: string, red = false) {
    if (!target) return
    const r = rel(arena, target)
    const el = spawn(layer, { left: `${r.cx + rand(-24, 24)}px`, top: `${r.y + r.h * 0.3}px`, transform: 'translateX(-50%)' }, `display text-4xl whitespace-nowrap px-1 ${red ? 'bg-ink text-marvel' : 'text-bone'}`)
    el.textContent = text
    gsap.fromTo(el, { y: 0, opacity: 1 }, { y: -90, opacity: 0, duration: 1.1, ease: 'power2.out', onComplete: () => el.remove() })
  },
  beam(arena: HTMLElement, layer: HTMLElement, from: Element, to: Element, heavy: boolean) {
    const a = rel(arena, from)
    const b = rel(arena, to)
    const dx = b.cx - a.cx
    const dy = b.cy - a.cy
    const len = Math.hypot(dx, dy)
    const el = spawn(layer, {
      left: `${a.cx}px`, top: `${a.cy}px`, width: `${len}px`, height: heavy ? '14px' : '6px',
      transformOrigin: '0 50%', transform: `translateY(-50%) rotate(${Math.atan2(dy, dx)}rad)`,
    }, heavy ? 'bg-marvel' : 'bg-bone')
    gsap.timeline({ onComplete: () => el.remove() })
      .fromTo(el, { scaleX: 0 }, { scaleX: 1, duration: 0.14, ease: 'power3.out' })
      .to(el, { scaleY: 0, duration: 0.16, ease: 'power3.out' }, '+=0.06')
  },
  hitFrame(el: Element | null, push = 14) {
    if (!el) return
    gsap.fromTo(el, { x: push, filter: 'brightness(2.4)' }, { x: 0, filter: 'brightness(1)', duration: 0.5, ease: 'elastic.out(1, 0.45)' })
  },
  shockwave(arena: HTMLElement, layer: HTMLElement, target: Element) {
    const r = rel(arena, target)
    const s = Math.min(r.w, r.h) * 0.6
    for (let i = 0; i < 2; i++) {
      const el = spawn(layer, { left: `${r.cx - s / 2}px`, top: `${r.cy - s / 2}px`, width: `${s}px`, height: `${s}px`, border: '4px solid var(--color-marvel)' })
      gsap.fromTo(el, { scale: 0.2, opacity: 1 }, { scale: 1.9, opacity: 0, duration: 0.5, delay: i * 0.1, ease: 'power3.out', onComplete: () => el.remove() })
    }
  },
  invert(arena: HTMLElement) {
    gsap.fromTo(arena, { filter: 'brightness(2)' }, { filter: 'brightness(1)', duration: 0.35, ease: 'power2.out' })
  },
  slash(arena: HTMLElement, layer: HTMLElement, target: Element) {
    const r = rel(arena, target)
    for (let i = 0; i < 3; i++) {
      const el = spawn(layer, {
        left: `${r.x - r.w * 0.1}px`, top: `${r.y + r.h * (0.25 + i * 0.22)}px`, width: `${r.w * 1.2}px`, height: '5px',
        transformOrigin: '0 50%', transform: 'rotate(-28deg)',
      }, 'bg-marvel')
      gsap.timeline({ delay: i * 0.05, onComplete: () => el.remove() })
        .fromTo(el, { scaleX: 0 }, { scaleX: 1, duration: 0.1, ease: 'power3.out' })
        .to(el, { opacity: 0, duration: 0.2, ease: 'power3.out' }, '+=0.1')
    }
  },
  sweep(arena: HTMLElement, layer: HTMLElement, grid: Element) {
    const r = rel(arena, grid)
    const el = spawn(layer, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: '10px' }, 'bg-marvel')
    gsap.fromTo(el, { y: 0 }, { y: r.h - 10, duration: 0.45, ease: 'power3.out', onComplete: () => el.remove() })
    const wash = spawn(layer, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, background: 'var(--color-marvel)', mixBlendMode: 'multiply' })
    gsap.fromTo(wash, { opacity: 0.8 }, { opacity: 0, duration: 0.5, ease: 'power3.out', onComplete: () => wash.remove() })
  },
  shake(el: Element) {
    gsap.fromTo(el, { x: -14 }, { x: 0, duration: 0.6, ease: 'elastic.out(1, 0.35)' })
  },
  brackets(arena: HTMLElement, layer: HTMLElement, targets: Element[]) {
    targets.forEach((t) => {
      const r = rel(arena, t)
      const el = spawn(layer, { left: `${r.x - 6}px`, top: `${r.y - 6}px`, width: `${r.w + 12}px`, height: `${r.h + 12}px` })
      el.innerHTML = ['top-0 left-0 border-t-4 border-l-4', 'top-0 right-0 border-t-4 border-r-4', 'bottom-0 left-0 border-b-4 border-l-4', 'bottom-0 right-0 border-b-4 border-r-4']
        .map((c) => `<span class="absolute h-5 w-5 border-bone ${c}"></span>`).join('')
      gsap.timeline({ onComplete: () => el.remove() })
        .fromTo(el, { scale: 1.25 }, { scale: 1, duration: 0.2, ease: 'power3.out' })
        .to(el, { opacity: 0, duration: 0.2, ease: 'power3.out' }, '+=0.35')
    })
  },
  /** Split an element's area into tiles of its image and drop them. */
  shatter(arena: HTMLElement, layer: HTMLElement, target: Element, src: string, focus: string, cols: number, rows: number) {
    const r = rel(arena, target)
    const holder = spawn(layer, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` })
    const tiles: HTMLElement[] = []
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const t = document.createElement('div')
        t.className = 'absolute inset-0'
        const top = (y / rows) * 100
        const left = (x / cols) * 100
        t.style.clipPath = `inset(${top}% ${100 - left - 100 / cols}% ${100 - top - 100 / rows}% ${left}%)`
        t.innerHTML = `<img src="${src}" alt="" style="width:100%;height:100%;object-fit:cover;object-position:${focus}" />`
        holder.appendChild(t)
        tiles.push(t)
      }
    }
    gsap.to(tiles, {
      y: () => rand(r.h * 0.4, r.h * 1.1),
      x: () => rand(-40, 40),
      rotation: () => rand(-25, 25),
      opacity: 0,
      duration: 1.1,
      ease: 'power2.in',
      stagger: { each: 0.012, from: 'random' },
      onComplete: () => holder.remove(),
    })
  },
  comboBanner(arena: HTMLElement, layer: HTMLElement, name: string) {
    const el = spawn(layer, { left: '50%', top: '38%', transform: 'translate(-50%, -50%) rotate(-4deg)' }, 'z-30 whitespace-nowrap border-4 border-bone bg-marvel px-4 py-1 text-center text-bone')
    el.innerHTML = `<span class="label block">Combo finisher</span><span class="display block text-[clamp(1.6rem,4vw,3rem)] leading-none">${name.replace(/[<>&]/g, '')}</span>`
    gsap.timeline({ onComplete: () => el.remove() })
      .fromTo(el, { scale: 2.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.22, ease: 'power3.out' })
      .to(el, { opacity: 0, y: -30, duration: 0.3, ease: 'power2.in' }, '+=0.75')
    gsap.fromTo(arena, { x: 10 }, { x: 0, duration: 0.4, ease: 'elastic.out(1, 0.4)' })
  },
  glitch(arena: HTMLElement, layer: HTMLElement) {
    const h = arena.offsetHeight
    for (let i = 0; i < 10; i++) {
      const el = spawn(layer, { left: '0px', top: `${rand(0, h)}px`, width: `${rand(30, 100)}%`, height: `${rand(4, 24)}px` }, i % 2 ? 'bg-marvel' : 'bg-bone')
      gsap.fromTo(el, { x: rand(-60, 60), opacity: 1 }, { x: rand(-60, 60), opacity: 0, duration: 0.6, delay: rand(0, 0.3), ease: 'power3.out', onComplete: () => el.remove() })
    }
    gsap.fromTo(arena, { x: -16 }, { x: 0, duration: 0.6, ease: 'power3.out' })
  },
}

/* ───────────────────────── VS intro ───────────────────────── */

function VsSplash({ b, onDone }: { b: Battle; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const v = villainById(missionById(b.missionId).villainId)

  useLayoutEffect(() => {
    if (reducedMotion()) {
      onDone()
      return
    }
    sfx('whoosh')
    const ctx = gsap.context(() => {
      gsap.timeline({ onComplete: onDone })
        .fromTo('.vs-hero', { xPercent: -120, opacity: 0 }, { xPercent: 0, opacity: 1, duration: 0.6, ease: 'expo.out', stagger: 0.06 })
        .fromTo('.vs-villain', { xPercent: 110 }, { xPercent: 0, duration: 0.7, ease: 'expo.out' }, '-=0.5')
        .fromTo('.vs-mark', { scale: 3, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.45, ease: 'back.out(2.2)', onStart: () => sfx('heavy') })
        .fromTo('.vs-line', { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.35, ease: 'power3.out' })
        .to(ref.current, { opacity: 0, scale: 1.04, duration: 0.45, ease: 'power2.in' }, '+=0.8')
    }, ref)
    return () => ctx.revert()
  }, [onDone])

  return (
    <div ref={ref} onClick={onDone} className="absolute inset-0 z-30 grid cursor-pointer grid-cols-[1fr_auto_1fr] items-stretch overflow-hidden bg-ink" data-cursor="Skip">
      <div className="grid grid-cols-2 content-center gap-[2px] p-2 sm:grid-cols-3">
        {b.heroes.map((f) => (
          <div key={f.id} className="vs-hero aspect-[3/4] border-2 border-bone">
            <Portrait src={heroById(f.id).image} alt={heroById(f.id).name} focus={heroById(f.id).focus} color hover={false} className="h-full w-full" />
          </div>
        ))}
      </div>
      <div className="flex flex-col items-center justify-center gap-4 px-2">
        <span className="vs-mark display text-[clamp(3rem,9vw,8rem)] text-marvel">VS</span>
      </div>
      <div className="vs-villain relative border-l-2 border-bone">
        <Portrait src={v.image} alt={v.name} focus={v.focus} color hover={false} className="absolute inset-0" />
        <div className="absolute inset-x-0 bottom-0 bg-ink p-3">
          <p className="display text-2xl sm:text-4xl">{v.name}</p>
          <p className="vs-line label mt-1 bg-marvel px-2 text-bone">{INTRO_LINE[v.id] ?? v.title}</p>
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────── Section ───────────────────────── */

export default function BattleSim() {
  const ref = useReveal<HTMLElement>()
  const battleId = useShieldStore((s) => s.battleId)
  const setBattleId = useShieldStore((s) => s.setBattle)
  const status = useShieldStore((s) => s.status)
  const assignments = useShieldStore((s) => s.assignments)
  const threat = useShieldStore((s) => s.threat)
  const resolve = useShieldStore((s) => s.resolveBattle)
  const randomBattle = useRandomBattle()

  const [b, setB] = useState<Battle | null>(null)
  const [intro, setIntro] = useState(false)
  const [busy, setBusy] = useState(false)
  const [activeHero, setActiveHero] = useState<string | null>(null)
  const [auto, setAuto] = useState(false)
  const arena = useRef<HTMLDivElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const villainEl = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const bRef = useRef<Battle | null>(null)
  bRef.current = b
  /** Director lines that should only play once per battle */
  const said = useRef({ villainLow: false, teamLow: false })

  const engageable = MISSIONS.filter((m) => status[m.id] === 'In Progress' && assignments[m.id]?.length)
  const heroEl = (id: string) => arena.current?.querySelector(`[data-fighter="${id}"]`) ?? null
  const fxReady = () => !!arena.current && !!layer.current && !reducedMotion()

  // (re)start a battle when the selected mission changes
  useEffect(() => {
    if (battleId && status[battleId] === 'In Progress' && assignments[battleId]?.length) {
      const m = missionById(battleId)
      const nb = newBattle(m, assignments[battleId], escalation({ threat }, m))
      ;[villainById(m.villainId).image, ...nb.heroes.map((h) => heroById(h.id).image)].forEach((src) => { new Image().src = src })
      setB(nb)
      setIntro(true)
      said.current = { villainLow: false, teamLow: false }
      fury('battleStart', { villain: villainById(m.villainId).name, mission: m.codename })
      setBusy(false)
      setActiveHero(null)
      setAuto(false)
    } else if (!battleId) {
      setB(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battleId])

  const endIntro = useCallback(() => setIntro(false), [])

  const playVillain = useCallback((ev: VillainEvents) => {
    if (!fxReady()) return
    const A = arena.current!
    const L = layer.current!
    gsap.fromTo(villainEl.current, { scale: 1.05 }, { scale: 1, duration: 0.5, ease: 'elastic.out(1, 0.5)' })
    if (ev.aoe && grid.current) {
      Fx.sweep(A, L, grid.current)
      sfx('heavy')
    } else {
      sfx('hit')
    }
    ev.hits.forEach(({ id, dmg }) => {
      const el = heroEl(id)
      if (!el) return
      if (!ev.aoe) Fx.slash(A, L, el)
      Fx.hitFrame(el, -10)
      Fx.floatText(A, L, el, `-${dmg}`, true)
    })
    ev.kos.forEach((id) => fury('heroDown', { hero: heroById(id).name }))
    ev.kos.forEach((id) => {
      const el = heroEl(id)
      const h = heroById(id)
      if (el) Fx.shatter(A, L, el.querySelector('.pt') ?? el, h.image, h.focus ?? '50% 25%', 3, 4)
    })
    Fx.shake(A)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const act = useCallback((heroId: string, ability: Ability) => {
    const prev = bRef.current
    if (!prev || prev.outcome || busy || intro) return
    const f = prev.heroes.find((h) => h.id === heroId)
    if (!f || f.hp <= 0 || f.acted) return
    if (ability.kind === 'special' && f.cooldown > 0) return
    const hero = heroById(heroId)
    let state: Battle = { ...prev, log: [...prev.log], damage: { ...prev.damage } }
    const A = arena.current
    const L = layer.current
    const el = heroEl(heroId)
    const fx = fxReady()

    if (fx && el) gsap.fromTo(el, { y: 0 }, { y: -18, duration: 0.16, yoyo: true, repeat: 1, ease: 'power2.out' })

    if (ability.kind === 'support') {
      const heal = Math.round(10 + hero.stats.intelligence * 0.1)
      state.heroes = state.heroes.map((h) => (h.hp > 0 ? { ...h, hp: Math.min(h.max, h.hp + heal) } : h))
      state.shield = Math.min(0.6, state.shield + 0.3)
      state.log.unshift({ text: `${hero.name} uses ${ability.name}: team +${heal} HP, next hit reduced.`, tone: 'hero' })
      if (fx) {
        const alive = state.heroes.filter((h) => h.hp > 0).map((h) => heroEl(h.id)).filter(Boolean) as Element[]
        Fx.brackets(A!, L!, alive)
        alive.forEach((t) => Fx.floatText(A!, L!, t, `+${heal}`))
      }
      sfx('heal')
    } else {
      const special = ability.kind === 'special'
      const combo = special && f.last === 'attack'
      const crit = Math.random() < hero.stats.combat / 600
      const dmg = Math.round(ability.damage * (0.8 + hero.stats.power / 250) * rand(0.85, 1.15) * (crit ? 1.6 : 1) * (combo ? hero.combo.bonus : 1))
      state.villainHp = Math.max(0, state.villainHp - dmg)
      if (combo) fury('combo', { hero: hero.name, combo: hero.combo.name })
      if (state.villainHp > 0 && state.villainHp / state.villainMax < 0.25 && !said.current.villainLow) {
        said.current.villainLow = true
        setTimeout(() => fury('villainLow', { villain: villainById(missionById(state.missionId).villainId).name }), combo ? 4800 : 600)
      }
      state.damage[heroId] = (state.damage[heroId] ?? 0) + dmg
      state.log.unshift(
        combo
          ? { text: `COMBO! ${hero.name}: ${hero.abilities[0].name} → ${ability.name} → ${hero.combo.name}. ${hero.combo.hits} hits for ${dmg}${crit ? ' (critical!)' : ''}.`, tone: 'hero' }
          : { text: `${hero.name} → ${ability.name} for ${dmg}${crit ? ' (critical!)' : ''}.`, tone: 'hero' },
      )
      if (combo && fx && el && villainEl.current) {
        // multi-hit finisher: one beam + impact per hit, damage split across them
        const n = hero.combo.hits
        const parts = Array.from({ length: n }, (_, i) => (i < n - 1 ? Math.floor(dmg / n) : dmg - Math.floor(dmg / n) * (n - 1)))
        Fx.comboBanner(A!, L!, hero.combo.name)
        sfx('combo')
        parts.forEach((p, i) => {
          setTimeout(() => {
            if (!villainEl.current || !arena.current || !layer.current) return
            const last = i === n - 1
            Fx.beam(arena.current, layer.current, el, villainEl.current, last)
            Fx.hitFrame(villainEl.current, last ? 30 : 12)
            Fx.floatText(arena.current, layer.current, villainEl.current, `-${p}`, last)
            if (last) {
              Fx.invert(arena.current)
              Fx.shockwave(arena.current, layer.current, villainEl.current)
              sfx('heavy')
            } else sfx('hit')
          }, 260 + i * 150)
        })
      } else if (fx && el && villainEl.current) {
        Fx.beam(A!, L!, el, villainEl.current, special)
        setTimeout(() => {
          if (!villainEl.current || !arena.current || !layer.current) return
          Fx.hitFrame(villainEl.current, special ? 26 : 14)
          Fx.floatText(arena.current, layer.current, villainEl.current, `${crit ? 'CRIT ' : ''}-${dmg}`, crit || special)
          if (special) {
            Fx.invert(arena.current)
            Fx.shockwave(arena.current, layer.current, villainEl.current)
          }
        }, 140)
      }
      if (!combo) sfx(special || crit ? 'heavy' : 'hit')
    }
    state.heroes = state.heroes.map((h) => (h.id === heroId ? { ...h, acted: true, last: ability.kind, cooldown: ability.kind === 'special' ? SPECIAL_COOLDOWN : h.cooldown } : h))

    if (state.villainHp <= 0) {
      state.log.unshift({ text: `${villainById(missionById(state.missionId).villainId).name} defeated. Threat neutralised.`, tone: 'sys' })
      state = { ...state, outcome: 'win' }
      bRef.current = state
      setB(state)
      setActiveHero(null)
      return
    }
    bRef.current = state
    setB(state)
    setActiveHero(null)

    // villain answers as its own beat
    if (state.heroes.every((h) => h.hp <= 0 || h.acted)) {
      setBusy(true)
      setTimeout(() => {
        const cur = bRef.current
        if (!cur || cur.outcome) return setBusy(false)
        const [next, ev] = villainTurn(cur)
        bRef.current = next
        setB(next)
        requestAnimationFrame(() => playVillain(ev))
        const alive = next.heroes.filter((h) => h.hp > 0)
        if (!next.outcome && !said.current.teamLow && alive.length && alive.reduce((a, h) => a + h.hp / h.max, 0) / alive.length < 0.35) {
          said.current.teamLow = true
          fury('teamLow')
        }
        setTimeout(() => setBusy(false), 450)
      }, VILLAIN_DELAY)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, intro, playVillain])

  // Auto-battle: special if ready, support if team hurt, else attack
  useEffect(() => {
    if (!auto || !b || b.outcome || busy || intro) return
    const id = setTimeout(() => {
      const next = b.heroes.find((h) => h.hp > 0 && !h.acted)
      if (!next) return
      const hero = heroById(next.id)
      const hurt = b.heroes.filter((h) => h.hp > 0).some((h) => h.hp / h.max < 0.4)
      // set up combos: hold the special until the hero has just attacked
      const pick = comboReady(next) || (next.cooldown === 0 && next.last !== 'attack' && Math.random() < 0.25)
        ? hero.abilities[1]
        : hurt && Math.random() < 0.6 ? hero.abilities[2] : hero.abilities[0]
      act(next.id, pick)
    }, reducedMotion() ? 120 : 520)
    return () => clearTimeout(id)
  }, [auto, b, act, busy, intro])

  // Outcome → FX + store, once
  const reported = useRef<string | null>(null)
  useEffect(() => {
    if (!b?.outcome || reported.current === b.missionId + b.round + b.outcome) return
    reported.current = b.missionId + b.round + b.outcome
    setAuto(false)
    if (fxReady()) {
      if (b.outcome === 'win' && villainEl.current) {
        const v = villainById(missionById(b.missionId).villainId)
        const pt = villainEl.current.querySelector('.pt')
        if (pt) {
          Fx.shatter(arena.current!, layer.current!, pt, v.image, v.focus ?? '50% 25%', 6, 8)
          gsap.set(pt, { visibility: 'hidden' })
        }
      } else {
        Fx.glitch(arena.current!, layer.current!)
      }
      gsap.fromTo('.battle-stamp', { scale: 2.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.25, delay: 0.5, ease: 'power3.out' })
    }
    if (b.outcome === 'loss') sfx('lose')
    resolve(b.missionId, b.outcome === 'win', b.round, b.damage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b, resolve])

  // Keyboard: 1–6 pick hero, Q/W/E ability, Space toggles auto (only while arena is on screen)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cur = bRef.current
      if (!cur || cur.outcome || intro || !arena.current) return
      const r = arena.current.getBoundingClientRect()
      if (r.bottom < 0 || r.top > window.innerHeight) return
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      const n = Number(e.key)
      if (n >= 1 && n <= cur.heroes.length) {
        const f = cur.heroes[n - 1]
        if (f.hp > 0 && !f.acted) setActiveHero(f.id)
        return
      }
      const k = e.key.toLowerCase()
      if (activeHero && ['q', 'w', 'e'].includes(k)) {
        act(activeHero, heroById(activeHero).abilities['qwe'.indexOf(k)])
        return
      }
      if (e.key === ' ') {
        e.preventDefault()
        setAuto((a) => !a)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [act, activeHero, intro])

  const retreat = () => {
    if (!b) return
    resolve(b.missionId, false, b.round, b.damage)
    fury('retreat', { mission: missionById(b.missionId).codename })
    setB(null)
    setBattleId(null)
  }

  const mission = b ? missionById(b.missionId) : null
  const villain = mission ? villainById(mission.villainId) : null
  const selected = b?.heroes.find((h) => h.id === activeHero)

  return (
    <section id="battle" ref={ref} className="bg-ink px-4 py-16 text-bone md:px-12 md:py-24">
      <header className="mb-12 grid gap-6 md:grid-cols-12">
        <div data-reveal className="label flex gap-4 md:col-span-12">
          <span className="bg-marvel px-2 text-bone">05</span>
          <span>Battle simulation</span>
          <span className="hidden flex-1 border-b border-bone/30 md:block" />
        </div>
        <h2 data-reveal className="md:col-span-8">
          <Scramble text="Engage" className="display block text-[clamp(2.5rem,6vw,4.5rem)]" />
          <span className="display-thin block text-[clamp(2.5rem,6vw,4.5rem)] text-marvel">the threat</span>
        </h2>
        <p data-reveal className="max-w-sm text-[15px] leading-6 text-bone/80 md:col-span-4 md:self-end">
          Turn-based. Each hero acts once per round, then the villain strikes back and every few rounds hits the whole team.
          Keys: <b>1–6</b> hero, <b>Q W E</b> ability, <b>Space</b> auto.
        </p>
      </header>

      {!b || !mission || !villain ? (
        <div data-reveal className="border-2 border-bone p-8 md:p-12">
          {engageable.length ? (
            <>
              <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                <p className="label">Select an operation to engage</p>
                <button onClick={randomBattle} className="btn btn-red" data-cursor="Roll"><Dices size={14} /> Random battle</button>
              </div>
              <div className="flex flex-wrap gap-3">
                {engageable.map((m) => (
                  <button key={m.id} onClick={() => setBattleId(m.id)} className="btn btn-inv" data-cursor="Engage">
                    <Swords size={14} /> {m.codename} · {threat[m.id] ?? m.threat}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="display text-4xl">Arena offline</p>
              <p className="mt-3 max-w-md text-bone/70">Deploy a team of at least four heroes to a mission, then press Engage to start a battle here.</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button onClick={randomBattle} className="btn btn-red" data-cursor="Roll"><Dices size={14} /> Random battle</button>
                <a href="#missions" className="btn btn-inv">Go to missions</a>
              </div>
            </>
          )}
        </div>
      ) : (
        <div ref={arena} className="relative">
          <div ref={layer} className="pointer-events-none absolute inset-0 z-20 overflow-visible" aria-hidden />
          {intro && <VsSplash b={b} onDone={endIntro} />}

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-y-2 border-bone py-3">
            <div className="flex items-center gap-4">
              <ThreatMark threat={threat[mission.id] ?? mission.threat} />
              <span className="display text-xl">{mission.codename}</span>
              <span className="label text-bone/60">Round {String(b.round).padStart(2, '0')}</span>
              {busy && <span className="label bg-marvel px-1 text-bone">Enemy turn</span>}
            </div>
            {!b.outcome && (
              <div className="flex gap-2">
                <button onClick={() => setAuto((a) => !a)} className="btn btn-inv">{auto ? <Pause size={14} /> : <Play size={14} />} {auto ? 'Pause' : 'Auto-battle'}</button>
                <button onClick={retreat} className="btn btn-red"><Flag size={14} /> Retreat</button>
              </div>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-12">
            <div ref={villainEl} className="relative border-2 border-bone lg:col-span-5">
              <div className="relative aspect-[4/5] sm:aspect-[16/10] lg:aspect-auto lg:h-full lg:min-h-[520px]">
                <Portrait src={villain.image} alt={villain.name} className="absolute inset-0" focus={villain.focus} color={b.outcome !== 'win'} hover={false} />
                {b.outcome && (
                  <span className={`battle-stamp display absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2 -rotate-6 border-4 px-3 text-3xl ${b.outcome === 'win' ? 'border-bone bg-ink text-bone' : 'border-marvel bg-ink text-marvel'}`}>
                    {b.outcome === 'win' ? 'Neutralised' : 'Retreat'}
                  </span>
                )}
                <div className="absolute inset-x-0 bottom-0 bg-ink p-4">
                  <p className="label text-marvel">{villain.title}</p>
                  <p className={`display text-4xl ${b.outcome === 'win' ? 'line-through decoration-4' : ''}`}>{villain.name}</p>
                  <div className="mt-3"><HpBar hp={b.villainHp} max={b.villainMax} red thick /></div>
                  <p className="label mt-1 text-bone/60">{b.villainHp} / {b.villainMax} HP · ATK {b.villainAtk}</p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-6 lg:col-span-7">
              <div ref={grid} className="grid grid-cols-2 border-t-2 border-l-2 border-bone sm:grid-cols-3">
                {b.heroes.map((f, i) => {
                  const h = heroById(f.id)
                  const down = f.hp <= 0
                  const isActive = activeHero === f.id
                  return (
                    <button
                      key={f.id}
                      data-fighter={f.id}
                      data-cursor={down ? undefined : 'Select'}
                      disabled={down || f.acted || !!b.outcome || auto || busy || intro}
                      onClick={() => setActiveHero(isActive ? null : f.id)}
                      className={`relative border-r-2 border-b-2 border-bone text-left disabled:cursor-not-allowed ${isActive ? 'bg-marvel' : 'bg-ink'} ${down ? 'opacity-30' : ''}`}
                    >
                      <div className="relative h-28">
                        <Portrait src={h.image} alt={h.name} className="h-full w-full" focus={h.focus} color={!down && !f.acted} hover={false} />
                        <span className="label absolute top-0 left-0 bg-ink px-1">{i + 1}</span>
                        {f.acted && !down && <span className="label absolute top-0 right-0 bg-bone px-1 text-ink">Acted</span>}
                        {!f.acted && !down && comboReady(f) && <span className="label absolute top-0 right-0 bg-marvel px-1 text-bone">Combo</span>}
                        {down && <span className="display absolute inset-0 grid place-items-center bg-ink/70 text-2xl text-marvel">Down</span>}
                      </div>
                      <div className="p-2">
                        <p className="display truncate text-sm">{h.name}</p>
                        <div className="mt-1"><HpBar hp={f.hp} max={f.max} red={f.hp / f.max < 0.35} /></div>
                        <p className="label mt-1 text-bone/60">{f.hp}/{f.max} · {b.damage[f.id] ?? 0} dmg</p>
                      </div>
                    </button>
                  )
                })}
              </div>

              <div className="min-h-[120px] border-2 border-bone p-4">
                {b.outcome ? (
                  <div>
                    <p className={`display text-[clamp(2rem,5vw,3.5rem)] ${b.outcome === 'win' ? '' : 'text-marvel'}`}>
                      {b.outcome === 'win' ? 'Threat neutralised' : 'Mission failed'}
                    </p>
                    <p className="mt-2 text-sm text-bone/70">
                      {b.outcome === 'win' ? `${mission.codename} is marked Completed in ${b.round} rounds. Your heroes are free for the next deployment.` : `${mission.codename} is back to Pending. Assemble a stronger team and try again.`}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button onClick={() => { setB(null); setBattleId(null) }} className="btn btn-inv"><RotateCcw size={14} /> Back to operations</button>
                      <button onClick={randomBattle} className="btn btn-red" data-cursor="Roll"><Dices size={14} /> Next random battle</button>
                    </div>
                  </div>
                ) : selected ? (
                  <div>
                    <p className="label mb-3">
                      {heroById(selected.id).name} — choose an ability
                      {comboReady(selected)
                        ? <span className="ml-2 bg-marvel px-1 text-bone">Combo ready: W → {heroById(selected.id).combo.name}</span>
                        : <span className="ml-2 text-bone/50">Combo: Q, then W next round</span>}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {heroById(selected.id).abilities.map((a, ai) => {
                        const Icon = a.kind === 'attack' ? Swords : a.kind === 'special' ? Zap : Shield
                        const cd = a.kind === 'special' && selected.cooldown > 0
                        return (
                          <button key={a.name} disabled={cd || busy} onClick={() => act(selected.id, a)} className={`btn justify-start ${a.kind === 'special' ? 'btn-red' : 'btn-inv'}`} data-cursor={a.kind === 'support' ? 'Heal' : 'Strike'}>
                            <span className="border border-current px-1 text-[10px]">{'QWE'[ai]}</span>
                            <Icon size={14} />
                            <span className="truncate">{a.name}</span>
                            <span className="ml-auto">{cd ? `${selected.cooldown}R` : a.damage ? a.damage : '+HP'}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="label py-6">
                    {busy ? <>{villain.name} is attacking<span className="blink">_</span></> : auto ? <>Auto-battle running<span className="blink">_</span></> : 'Select a hero to act (or press 1–6)'}
                  </p>
                )}
              </div>

              <ul data-lenis-prevent className="scrollbar-thin h-40 overflow-y-auto border-2 border-bone/30 p-3 font-mono text-[11px] leading-5" aria-live="polite">
                {b.log.map((l, i) => (
                  <li key={b.log.length - i} className={l.tone === 'villain' ? 'text-marvel' : l.tone === 'sys' ? 'text-bone/50' : ''}>
                    {l.tone === 'hero' ? '> ' : l.tone === 'villain' ? '! ' : '# '}{l.text}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
