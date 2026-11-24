import { useEffect, useState } from 'react'
import { Menu, X, RotateCcw, Volume2, VolumeX, ArrowUp, Mic, MicOff } from 'lucide-react'
import { useFury } from '../lib/fury'
import { useShieldStore } from '../store/useShieldStore'

export const SECTIONS = [
  { id: 'command', label: 'Command', n: '01' },
  { id: 'database', label: 'Database', n: '02' },
  { id: 'assemble', label: 'Assemble', n: '03' },
  { id: 'missions', label: 'Missions', n: '04' },
  { id: 'battle', label: 'Battle', n: '05' },
  { id: 'status', label: 'Status', n: '06' },
  { id: 'vault', label: 'Data vault', n: '07' },
]

export function MarvelLogo({ className = 'h-6' }: { className?: string }) {
  return <img src="/logos/marvel.svg" alt="Marvel" className={className} />
}

/** Avengers "A" — rendered through a mask so it takes currentColor. */
export function AvengersA({ className = 'h-8 w-7' }: { className?: string }) {
  return <span role="img" aria-label="Avengers" className={`logo-mask inline-block ${className}`} style={{ ['--src' as string]: 'url(/logos/avengers-a.svg)' }} />
}

export function AvengersWordmark({ className = 'h-8 w-28' }: { className?: string }) {
  return <span role="img" aria-label="The Avengers" className={`logo-mask inline-block ${className}`} style={{ ['--src' as string]: 'url(/logos/avengers-wordmark.svg)' }} />
}

export function useActiveSection() {
  const [active, setActive] = useState<string | null>(null)
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => e.isIntersecting && setActive(e.target.id))
      },
      { rootMargin: '-45% 0px -50% 0px' },
    )
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id)
      if (el) io.observe(el)
    })
    return () => io.disconnect()
  }, [])
  return active
}

/** Fixed top HUD: logos, a thin rule with a triangle marker that tracks scroll progress. */
export function TopBar() {
  const [open, setOpen] = useState(false)
  const [p, setP] = useState(0)
  const reset = useShieldStore((s) => s.reset)
  const teamSize = useShieldStore((s) => s.team.length)
  const sound = useShieldStore((s) => s.sound)
  const toggleSound = useShieldStore((s) => s.toggleSound)
  const voice = useFury((s) => s.voice)
  const toggleVoice = useFury((s) => s.toggleVoice)
  const setView = useShieldStore((s) => s.setView)

  useEffect(() => {
    const on = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      setP(max > 0 ? window.scrollY / max : 0)
    }
    on()
    window.addEventListener('scroll', on, { passive: true })
    window.addEventListener('resize', on)
    return () => {
      window.removeEventListener('scroll', on)
      window.removeEventListener('resize', on)
    }
  }, [])

  return (
    <nav className="fixed inset-x-0 top-0 z-40 bg-ink text-bone">
      <div className="flex h-14 items-center gap-4 px-4 md:gap-8 md:px-8">
        <a href="#top" onClick={(e) => { e.preventDefault(); setView('landing') }} className="flex shrink-0 items-center gap-3" aria-label="Home" data-cursor="Home">
          <MarvelLogo className="h-6" />
          <AvengersA className="h-7 w-6 text-bone" />
        </a>
        {/* HUD rule */}
        <div className="relative hidden h-6 flex-1 md:block" aria-hidden>
          <div className="absolute inset-x-0 top-1/2 border-t border-bone/40" />
          {Array.from({ length: 41 }).map((_, i) => (
            <span key={i} className="absolute top-1/2 w-px bg-bone/40" style={{ left: `${i * 2.5}%`, height: i % 5 ? 4 : 10, transform: 'translateY(-50%)' }} />
          ))}
          <span className="absolute top-0 -translate-x-1/2" style={{ left: `${p * 100}%` }}>
            <svg width="14" height="12" viewBox="0 0 14 12"><path d="M0 0 H14 L7 12 Z" fill="var(--color-marvel)" /></svg>
          </span>
        </div>
        <span className="label hidden tabular-nums lg:block">{String(Math.round(p * 100)).padStart(3, '0')}%</span>
        <a href="#assemble" className="label ml-auto border border-bone px-2 py-1 md:ml-0">
          Team {teamSize}/6
        </a>
        <button onClick={toggleSound} aria-pressed={sound} aria-label={sound ? 'Mute sound' : 'Turn sound on'} data-cursor={sound ? 'Mute' : 'Sound on'} className={sound ? 'text-marvel' : 'text-bone/70 hover:text-bone'}>
          {sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
        </button>
        <button
          onClick={toggleVoice}
          aria-pressed={voice}
          aria-label={voice ? 'Turn off Director voice' : 'Turn on Director voice'}
          title={voice ? 'Director voice: on (browser text-to-speech)' : 'Director voice: off — click to have Fury read his lines aloud'}
          data-cursor={voice ? 'Voice off' : 'Voice on'}
          className={`label flex items-center gap-1.5 border px-2 py-1 ${voice ? 'border-marvel bg-marvel text-bone' : 'border-bone/40 text-bone/70 hover:border-bone hover:text-bone'}`}
        >
          {voice ? <Mic size={13} /> : <MicOff size={13} />}
          <span className="hidden sm:inline">Voice {voice ? 'on' : 'off'}</span>
        </button>
        <button onClick={reset} title="Reset console" aria-label="Reset console" data-cursor="Reset" className="hidden text-bone/70 hover:text-marvel md:block">
          <RotateCcw size={15} />
        </button>
        <button className="md:hidden" onClick={() => setOpen((o) => !o)} aria-label="Toggle menu" aria-expanded={open}>
          {open ? <X /> : <Menu />}
        </button>
      </div>
      {open && (
        <div className="border-t border-bone/20 px-4 pb-4 md:hidden">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} onClick={() => setOpen(false)} className="label flex gap-4 border-b border-bone/15 py-3">
              <span className="text-marvel">{s.n}</span> {s.label}
            </a>
          ))}
          <button onClick={() => { reset(); setOpen(false) }} className="label mt-3 flex items-center gap-2 text-marvel">
            <RotateCcw size={13} /> Reset console
          </button>
        </div>
      )}
    </nav>
  )
}

/** Sticky left index inside the bone panel. Active item is an outlined box. */
export function IndexNav() {
  const active = useActiveSection()
  return (
    <aside className="hidden border-r-2 border-ink md:block">
      <div className="sticky top-14 flex flex-col gap-8 p-6">
        <div>
          <AvengersWordmark className="h-10 w-full text-ink" />
          <p className="label mt-3 text-ink/60">S.H.I.E.L.D. field manual · rev. 7.4</p>
        </div>
        <ul className="flex flex-col gap-2">
          {SECTIONS.map((s) => {
            const on = active === s.id
            return (
              <li key={s.id}>
                <a href={`#${s.id}`} className={`display inline-flex gap-2 text-[15px] leading-5 ${on ? 'boxed px-1 text-marvel' : 'text-ink/45 hover:text-ink'}`}>
                  <span className="font-mono text-[11px] font-normal">{s.n}</span>
                  {s.label}
                </a>
              </li>
            )
          })}
        </ul>
        <button
          onClick={() => {
            const lenis = (window as unknown as { __lenis?: { scrollTo: (t: number, o?: object) => void } }).__lenis
            if (lenis) lenis.scrollTo(0, { duration: 1.2 })
            else window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
          className="label group flex items-start gap-2 text-left text-ink/60 hover:text-ink"
          data-cursor="Globe"
        >
          <ArrowUp size={13} className="mt-0.5 shrink-0 text-marvel transition-transform group-hover:-translate-y-0.5" />
          <span>Threat globe — drag to rotate, click a red beacon to open its mission.</span>
        </button>
      </div>
    </aside>
  )
}
