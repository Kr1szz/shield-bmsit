import { lazy, Suspense, useEffect, useRef } from 'react'
import Lenis from 'lenis'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { TopBar, IndexNav, MarvelLogo, AvengersA } from './components/Navbar'
import { Toast } from './components/ui'
import Reticle from './components/Reticle'
import Finale from './components/Finale'
import { MISSIONS } from './data/missions'
import { useShieldStore } from './store/useShieldStore'
import Landing from './sections/Landing'
import Hero from './sections/Hero'
import Dashboard from './sections/Dashboard'
import Database from './sections/Database'
import TeamFormation from './sections/TeamFormation'
import MissionControl from './sections/MissionControl'
import BattleSim from './sections/BattleSim'
import MissionStatus from './sections/MissionStatus'
import DataVault from './sections/DataVault'
import FuryComms from './components/FuryComms'
import { fury } from './lib/fury'

const ThreatGlobe = lazy(() => import('./components/ThreatGlobe'))

function Marquee() {
  const items = [...MISSIONS, ...MISSIONS]
  return (
    <div className="overflow-hidden border-b-2 border-ink bg-marvel py-2 text-bone">
      <div className="marquee flex w-max gap-10 whitespace-nowrap">
        {items.map((m, i) => (
          <span key={i} className="label font-bold">
            ▲ {m.codename} / {m.location} / {m.threat}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Inertial smooth scrolling on desktop, kept in sync with ScrollTrigger. Anchor links glide too. */
function useSmoothScroll(active: boolean) {
  useEffect(() => {
    if (!active || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !window.matchMedia('(pointer: fine)').matches) return
    document.documentElement.style.scrollBehavior = 'auto'
    const lenis = new Lenis({ duration: 1.15, easing: (t) => 1 - Math.pow(1 - t, 4), anchors: { offset: -64 } })
    lenis.on('scroll', ScrollTrigger.update)
    ;(window as unknown as { __lenis?: Lenis }).__lenis = lenis
    const raf = (time: number) => lenis.raf(time * 1000)
    gsap.ticker.add(raf)
    gsap.ticker.lagSmoothing(0)
    return () => {
      gsap.ticker.remove(raf)
      lenis.destroy()
      delete (window as unknown as { __lenis?: Lenis }).__lenis
      document.documentElement.style.scrollBehavior = ''
    }
  }, [active])
}

/** One-second heartbeat for mission escalation. */
function useThreatClock() {
  const tick = useShieldStore((s) => s.tick)
  useEffect(() => {
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [tick])
}

export default function App() {
  const view = useShieldStore((s) => s.view)
  const finished = useShieldStore((s) => s.finishedAt)
  const globeWrap = useRef<HTMLDivElement>(null)
  useThreatClock()
  useSmoothScroll(view === 'console' && !finished)

  // the Director checks in when the console comes up (once per session)
  useEffect(() => {
    if (view !== 'console') return
    try {
      if (sessionStorage.getItem('shield-fury-hello')) return
    } catch { /* storage blocked — just greet */ }
    const id = setTimeout(() => {
      try { sessionStorage.setItem('shield-fury-hello', '1') } catch { /* ignore */ }
      fury('welcome')
    }, 1800)
    return () => clearTimeout(id)
  }, [view])

  // dev-only hook for automated checks (finale preview, etc.)
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __shield: unknown }).__shield = useShieldStore
  }, [])

  return (
    <>
      <a href="#command" className="label sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-marvel focus:px-3 focus:py-2 focus:text-bone">
        Skip to dashboard
      </a>

      {/* the 3D world behind everything */}
      <div ref={globeWrap} className="fixed inset-0 z-0">
        <Suspense fallback={null}>
          <ThreatGlobe />
        </Suspense>
      </div>

      {view === 'landing' ? (
        <Landing globeWrap={globeWrap} />
      ) : (
        <>
          <TopBar />
          {/* main lets pointer events fall through to the 3D globe; only real content catches them */}
          <main className="pointer-events-none relative z-10">
            <Hero />
            <div className="pointer-events-auto mx-auto max-w-[1440px] px-2 md:px-6">
              <div className="border-2 border-ink bg-bone">
                <Marquee />
                <div className="grid md:grid-cols-[220px_1fr]">
                  <IndexNav />
                  <div className="min-w-0">
                    <Dashboard />
                    <Database />
                    <TeamFormation />
                    <MissionControl />
                    <BattleSim />
                    <MissionStatus />
                    <DataVault />
                  </div>
                </div>
              </div>
            </div>

            <footer className="pointer-events-auto px-4 py-16 text-bone md:px-8">
              <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
                <div className="flex items-end gap-6">
                  <AvengersA className="h-24 w-20 text-marvel" />
                  <p className="text-[clamp(2.5rem,7vw,6rem)]">
                    <span className="display block">Whatever</span>
                    <span className="display-thin block">it takes.</span>
                  </p>
                </div>
                <div className="flex flex-col items-start gap-3 md:items-end">
                  <div className="border-2 border-bone px-4 py-3 md:text-right">
                    <p className="label text-marvel">Built by team</p>
                    <p className="display text-[clamp(1.8rem,3.5vw,2.75rem)] leading-none">Breakpoints</p>
                    <p className="label mt-2 text-bone/80">Devika Menon · Gopalkrishna J S</p>
                  </div>
                  <MarvelLogo className="h-8" />
                  <p className="label max-w-xs text-bone/60 md:text-right">
                    Fan-made hackathon project. Marvel, the Avengers and all characters are trademarks of Marvel. Character art from the Marvel Database (Fandom).
                  </p>
                </div>
              </div>
            </footer>
          </main>
          {finished && <Finale />}
        </>
      )}
      <Toast />
      {view === 'console' && <FuryComms />}
      <Reticle />
    </>
  )
}
