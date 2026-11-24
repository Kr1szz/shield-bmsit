/**
 * WebAudio sound design — everything is synthesised live, no audio files.
 * Signal chain: voices → (dry + generated-impulse reverb) → compressor → master.
 * Silent unless enabled from the sound toggle.
 */
export type Cue =
  | 'blip' | 'select' | 'confirm' | 'deny' | 'alarm'
  | 'hit' | 'heavy' | 'heal' | 'whoosh' | 'win' | 'lose'
  | 'combo' | 'radio' | 'deploy'

let enabled = false
let ctx: AudioContext | null = null
let bus: { dry: GainNode; wet: GainNode } | null = null

export const setSfxEnabled = (on: boolean) => {
  enabled = on
}
export const sfxEnabled = () => enabled

/** Exponentially-decaying stereo noise = a cheap, decent room/hall impulse. */
function impulse(a: AudioContext, seconds: number, decay: number) {
  const len = Math.floor(a.sampleRate * seconds)
  const buf = a.createBuffer(2, len, a.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
  }
  return buf
}

function ac() {
  if (!ctx) {
    ctx = new AudioContext()
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -16
    comp.knee.value = 12
    comp.ratio.value = 4
    comp.attack.value = 0.003
    comp.release.value = 0.2
    const master = ctx.createGain()
    master.gain.value = 0.9
    comp.connect(master).connect(ctx.destination)

    const verb = ctx.createConvolver()
    verb.buffer = impulse(ctx, 2.2, 3)
    const wet = ctx.createGain()
    wet.gain.value = 0.28
    wet.connect(verb).connect(comp)
    const dry = ctx.createGain()
    dry.connect(comp)
    bus = { dry, wet }
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** Route a node to the dry bus and (optionally) the reverb send. */
function out(node: AudioNode, send = 0.5) {
  node.connect(bus!.dry)
  if (send > 0) {
    const s = ctx!.createGain()
    s.gain.value = send
    node.connect(s).connect(bus!.wet)
  }
}

interface ToneOpts {
  type?: OscillatorType
  gain?: number
  at?: number
  slideTo?: number
  attack?: number
  send?: number
  /** low-pass cutoff — softens square/saw */
  cutoff?: number
  detune?: number
}

function tone(freq: number, dur: number, o: ToneOpts = {}) {
  const a = ac()
  const t = a.currentTime + (o.at ?? 0)
  const osc = a.createOscillator()
  const g = a.createGain()
  osc.type = o.type ?? 'sine'
  osc.frequency.setValueAtTime(freq, t)
  if (o.detune) osc.detune.value = o.detune
  if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t + dur)
  const peak = o.gain ?? 0.08
  const atk = o.attack ?? 0.004
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + atk)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  let node: AudioNode = osc.connect(g)
  if (o.cutoff) {
    const f = a.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = o.cutoff
    node = g.connect(f)
  }
  out(node, o.send ?? 0.4)
  osc.start(t)
  osc.stop(t + dur + 0.05)
}

interface NoiseOpts {
  gain?: number
  at?: number
  type?: BiquadFilterType
  freq?: number
  freqTo?: number
  q?: number
  send?: number
  attack?: number
}

function noise(dur: number, o: NoiseOpts = {}) {
  const a = ac()
  const t = a.currentTime + (o.at ?? 0)
  const buf = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * dur)), a.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  const src = a.createBufferSource()
  src.buffer = buf
  const f = a.createBiquadFilter()
  f.type = o.type ?? 'lowpass'
  f.frequency.setValueAtTime(o.freq ?? 4000, t)
  if (o.freqTo) f.frequency.exponentialRampToValueAtTime(o.freqTo, t + dur)
  f.Q.value = o.q ?? 0.8
  const g = a.createGain()
  const peak = o.gain ?? 0.1
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + (o.attack ?? 0.005))
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  out(src.connect(f).connect(g), o.send ?? 0.3)
  src.start(t)
}

/** Sub-bass body thump: sine with a fast pitch drop. */
const thump = (at = 0, from = 150, to = 40, dur = 0.35, gain = 0.5) =>
  tone(from, dur, { type: 'sine', gain, at, slideTo: to, send: 0.15, attack: 0.002 })

/** Brass-ish stab: detuned saws through a low-pass. */
function brass(freq: number, dur: number, at = 0, gain = 0.05) {
  for (const det of [-8, 0, 7]) tone(freq, dur, { type: 'sawtooth', gain, at, detune: det, cutoff: 1800, attack: 0.03, send: 0.55 })
}

export function sfx(cue: Cue) {
  if (!enabled || typeof window === 'undefined') return
  try {
    switch (cue) {
      case 'blip':
        tone(1320, 0.06, { type: 'triangle', gain: 0.05, send: 0.2 })
        return
      case 'select':
        tone(880, 0.07, { type: 'triangle', gain: 0.06, send: 0.3 })
        tone(1320, 0.1, { type: 'triangle', gain: 0.05, at: 0.05, send: 0.4 })
        return
      case 'confirm':
        tone(659, 0.18, { type: 'sine', gain: 0.09 })
        tone(988, 0.35, { type: 'sine', gain: 0.08, at: 0.08, send: 0.6 })
        tone(1976, 0.25, { type: 'sine', gain: 0.02, at: 0.08, send: 0.6 })
        return
      case 'deny':
        tone(140, 0.22, { type: 'square', gain: 0.06, cutoff: 900, send: 0.1 })
        tone(147, 0.22, { type: 'square', gain: 0.06, cutoff: 900, send: 0.1 })
        return
      case 'alarm':
        // two-tone klaxon with a rising sweep
        for (let i = 0; i < 2; i++) {
          tone(620, 0.22, { type: 'sawtooth', gain: 0.05, at: i * 0.46, slideTo: 880, cutoff: 2400, send: 0.5 })
          tone(880, 0.22, { type: 'sawtooth', gain: 0.05, at: i * 0.46 + 0.23, slideTo: 620, cutoff: 2400, send: 0.5 })
        }
        return
      case 'hit':
        noise(0.09, { type: 'bandpass', freq: 1800, q: 1.2, gain: 0.35, send: 0.2 })
        noise(0.04, { type: 'highpass', freq: 5000, gain: 0.12, send: 0.1 })
        thump(0, 180, 55, 0.18, 0.45)
        return
      case 'heavy':
        // explosion: crack → low rumble sweep → sub boom
        noise(0.05, { type: 'highpass', freq: 3000, gain: 0.3, send: 0.2 })
        noise(1.1, { type: 'lowpass', freq: 2200, freqTo: 120, gain: 0.4, send: 0.5 })
        thump(0, 120, 30, 0.7, 0.7)
        thump(0.04, 70, 28, 0.6, 0.4)
        return
      case 'heal':
        ;[784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.6, { type: 'sine', gain: 0.045, at: i * 0.07, send: 0.8 }))
        noise(0.8, { type: 'bandpass', freq: 6000, q: 3, gain: 0.03, send: 0.8, attack: 0.2 })
        return
      case 'whoosh':
        noise(0.7, { type: 'bandpass', freq: 300, freqTo: 3500, q: 1.5, gain: 0.18, attack: 0.25, send: 0.4 })
        return
      case 'deploy':
        // jet launch: rising roar + engine tone
        noise(1.2, { type: 'bandpass', freq: 200, freqTo: 2400, q: 0.9, gain: 0.22, attack: 0.3, send: 0.4 })
        tone(80, 1.1, { type: 'sawtooth', gain: 0.05, slideTo: 260, cutoff: 700, attack: 0.3, send: 0.3 })
        return
      case 'combo':
        // charge-up sweep then a wide impact
        tone(220, 0.35, { type: 'sawtooth', gain: 0.05, slideTo: 1760, cutoff: 3000, attack: 0.02, send: 0.5 })
        noise(0.35, { type: 'bandpass', freq: 500, freqTo: 6000, q: 2, gain: 0.12, attack: 0.3, send: 0.4 })
        brass(196, 0.5, 0.33, 0.04)
        brass(294, 0.5, 0.33, 0.035)
        thump(0.33, 140, 35, 0.5, 0.6)
        return
      case 'radio':
        // comms squelch: click + band-limited hiss
        noise(0.02, { type: 'highpass', freq: 2000, gain: 0.25, send: 0 })
        noise(0.16, { type: 'bandpass', freq: 2500, q: 2.5, gain: 0.08, at: 0.02, send: 0.05 })
        tone(1800, 0.05, { type: 'square', gain: 0.02, at: 0.17, cutoff: 3000, send: 0 })
        return
      case 'win':
        // fanfare: G – C – E – G (held), brass + bell
        ;[[392, 0], [523, 0.16], [659, 0.32]].forEach(([f, at]) => brass(f, 0.22, at, 0.04))
        brass(784, 1.0, 0.5, 0.045)
        brass(523, 1.0, 0.5, 0.03)
        tone(1568, 1.2, { type: 'sine', gain: 0.03, at: 0.5, send: 0.9 })
        thump(0.5, 110, 45, 0.5, 0.4)
        return
      case 'lose':
        // falling minor line over a low drone
        ;[392, 349, 311, 262].forEach((f, i) => tone(f, 0.45, { type: 'triangle', gain: 0.07, at: i * 0.22, send: 0.7 }))
        tone(65, 1.6, { type: 'sawtooth', gain: 0.05, cutoff: 300, attack: 0.2, send: 0.6 })
        return
    }
  } catch {
    /* audio unavailable — ignore */
  }
}
