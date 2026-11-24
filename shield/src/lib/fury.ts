/**
 * Director's commentary — a gruff, Nick Fury–style handler on the comms.
 * Lines are written for this project. Each call shows the line on the Director's comms panel
 * and, when sound is on, reads it aloud with the browser's speech synthesis (no audio files).
 */
import { create } from 'zustand'
import { sfx, sfxEnabled } from './sfx'

export type FuryEvent =
  | 'welcome' | 'deploy' | 'recall' | 'escalate' | 'omega'
  | 'battleStart' | 'combo' | 'heroDown' | 'villainLow' | 'teamLow'
  | 'win' | 'loss' | 'retreat' | 'doomUnlocked' | 'allClear' | 'teamFull' | 'reset'

type Vars = Record<string, string | number | undefined>

const LINES: Record<FuryEvent, string[]> = {
  welcome: [
    "This is Director Fury. Seven threats, one helicarrier, and you. Don't make me regret it.",
    "Console's live. The world's on fire in seven places. Pick your people and get to work.",
    "Morning, Commander. Nobody's coming to save us. That's the job. Ours.",
  ],
  deploy: [
    "{team} wheels up for {mission}. Bring them home.",
    "Team's in the air. {mission}. I want a sitrep the second boots hit the ground.",
    "Good. {mission} just got a lot more crowded. Let's keep it that way.",
    "Deploying to {location}. Clock's running, people.",
  ],
  recall: [
    "Pulling them out of {mission}? Fine. Just make sure the next plan is better.",
    "Recall confirmed. A retreat's only a mistake if you don't learn from it.",
  ],
  escalate: [
    "{mission} just went to {threat}. Sitting still is a decision too, Commander.",
    "You hear that? That's {location} getting worse while we talk.",
    "{mission} is escalating. Somebody get me a team on that.",
  ],
  omega: [
    "{mission} is OMEGA. I need it handled. Not soon. Now.",
    "We're out of time on {mission}. Every second costs lives.",
  ],
  battleStart: [
    "Eyes on {villain}. You know what to do. Do it.",
    "{villain}'s in range. No speeches. Hit hard, hit first.",
    "That's {villain}. I've seen the file. Don't let it get personal.",
    "Contact. {villain}. Make it quick, make it clean.",
  ],
  combo: [
    "Now that's teamwork. {hero}, do that again.",
    "{combo}. I'll be putting that in the report.",
    "{hero} just reminded me why I signed off on this program.",
    "That's how you finish a play. Nice work, {hero}.",
  ],
  heroDown: [
    "{hero} is down! Cover that position.",
    "We lost {hero}. Don't you dare let it be for nothing.",
    "Medics on {hero}. Everybody else, keep swinging.",
  ],
  villainLow: [
    "{villain} is on the ropes. Finish it.",
    "They're bleeding. Don't let up now.",
    "One more push. End this.",
  ],
  teamLow: [
    "Your team's running on fumes. Patch them up or pull them out.",
    "I'm reading critical vitals across the board. Watch yourselves.",
  ],
  win: [
    "{villain} is down. Good work. Don't get comfortable.",
    "{mission} is clear. That's one less fire. Next.",
    "Threat neutralised. Take a breath. Then take the next one.",
  ],
  loss: [
    "We lost {mission}. Regroup. We go again.",
    "That's on all of us. Rebuild the team and get back out there.",
    "{villain} won the round. Not the war.",
  ],
  retreat: [
    "Falling back from {mission}. Live to fight. Then fight.",
  ],
  doomUnlocked: [
    "Latveria just went quiet. That's never good. Doom is ready for you, Commander.",
    "Doom's out of his castle. Every Avenger, every recruit. This is what we've been preparing for.",
  ],
  allClear: [
    "All threats neutralised. The world won't thank you. I will.",
    "Seven for seven. I've got nothing to yell about. Enjoy it, it won't last.",
  ],
  teamFull: [
    "Six is the limit. I don't have the jets for more.",
  ],
  reset: [
    "Wiping the board. Fresh start, same stakes.",
  ],
}

/** Events that can cut in over whatever's playing. */
const PRIORITY = new Set<FuryEvent>(['welcome', 'battleStart', 'win', 'loss', 'retreat', 'doomUnlocked', 'allClear', 'omega', 'heroDown', 'villainLow'])
const COOLDOWN_MS = 4500

export interface FuryLine {
  text: string
  event: FuryEvent
  key: number
}

export const useFury = create<{ line: FuryLine | null; voice: boolean; toggleVoice: () => void }>((set, get) => ({
  line: null,
  // AI voice is opt-in: off until the user turns it on (choice remembered per browser)
  voice: (() => {
    try { return localStorage.getItem('shield-fury-voice') === 'on' } catch { return false }
  })(),
  toggleVoice: () => {
    const voice = !get().voice
    try { localStorage.setItem('shield-fury-voice', voice ? 'on' : 'off') } catch { /* private mode */ }
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.cancel()
      // confirm by voice, so it's obvious it works (also unlocks speech in browsers that need a click first)
      if (voice) speak('Voice channel open.')
    }
    set({ voice })
  },
}))

let lastAt = 0
const lastIdx: Partial<Record<FuryEvent, number>> = {}

function pick(ev: FuryEvent) {
  const pool = LINES[ev]
  let i = Math.floor(Math.random() * pool.length)
  if (pool.length > 1 && i === lastIdx[ev]) i = (i + 1) % pool.length
  lastIdx[ev] = i
  return pool[i]
}

const fill = (s: string, v: Vars) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''))

/* ── voice ── */
let chosen: SpeechSynthesisVoice | null | undefined
function voice() {
  if (chosen !== undefined) return chosen
  const all = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'))
  if (!all.length) return null // voices load async — try again next time
  // deep, natural-sounding English voices first
  const prefs = [/guy/i, /christopher/i, /davis/i, /eric/i, /roger/i, /andrew/i, /brian/i, /david/i, /mark/i, /george/i, /daniel/i, /male/i]
  for (const p of prefs) {
    const v = all.find((x) => p.test(x.name) && /natural|online|neural/i.test(x.name)) ?? all.find((x) => p.test(x.name))
    if (v) return (chosen = v)
  }
  return (chosen = all[0])
}
if (typeof speechSynthesis !== 'undefined') speechSynthesis.onvoiceschanged = () => { chosen = undefined }

function speak(text: string) {
  if (typeof speechSynthesis === 'undefined') return
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  const v = voice()
  if (v) u.voice = v
  u.pitch = 0.55
  u.rate = 0.98
  u.volume = 1
  // let the squelch land first
  setTimeout(() => speechSynthesis.speak(u), 220)
}

/** Fury reacts to something. Low-priority lines are rate-limited so he doesn't talk over himself. */
export function fury(ev: FuryEvent, vars: Vars = {}) {
  const now = Date.now()
  if (!PRIORITY.has(ev) && now - lastAt < COOLDOWN_MS) return
  lastAt = now
  const text = fill(pick(ev), vars)
  useFury.setState({ line: { text, event: ev, key: now } })
  // text always shows; squelch follows the sound toggle; speech follows the separate voice toggle
  if (sfxEnabled()) sfx('radio')
  if (useFury.getState().voice) speak(text)
}
