import { useEffect, useLayoutEffect, useRef } from 'react'
import gsap from 'gsap'
import { X } from 'lucide-react'
import type { Hero } from '../data/types'
import { powerScore } from '../data/heroes'
import { Portrait, reducedMotion, StatBar } from './ui'
import { AvengersA } from './Navbar'

/** Personnel spec sheet. Ink on bone, one red stamp. */
export default function Dossier({ hero, selected, deployed, onClose, onToggle }: {
  hero: Hero
  selected: boolean
  deployed: boolean
  onClose: () => void
  onToggle: () => void
}) {
  const panel = useRef<HTMLDivElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    if (reducedMotion() || !panel.current) return
    const ctx = gsap.context(() => {
      gsap.fromTo(panel.current, { clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)', duration: 0.45, ease: 'power3.out' })
      gsap.fromTo('.dossier-stamp', { scale: 2.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.2, delay: 0.5, ease: 'power3.out' })
    }, panel)
    return () => ctx.revert()
  }, [hero.id])

  useEffect(() => {
    closeBtn.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const s = hero.stats
  const fileNo = `AVG-${String(hero.clearance)}${hero.id.length}-${hero.name.slice(0, 3).toUpperCase()}`

  return (
    <div data-lenis-prevent className="fixed inset-0 z-50 overflow-y-auto bg-ink/85 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={`${hero.name} file`}>
      <div ref={panel} onClick={(e) => e.stopPropagation()} className="slab grid-paper relative mx-auto my-8 w-full max-w-4xl">
        <div className="flex items-center justify-between border-b-2 border-ink px-4 py-2">
          <span className="label flex items-center gap-3">
            <AvengersA className="h-5 w-4 text-ink" /> Personnel file · {fileNo}
          </span>
          <button ref={closeBtn} onClick={onClose} className="grid h-8 w-8 place-items-center border-2 border-ink hover:bg-ink hover:text-bone" aria-label="Close file">
            <X size={16} />
          </button>
        </div>

        <div className="grid md:grid-cols-[280px_1fr]">
          <div className="border-b-2 border-ink md:border-r-2 md:border-b-0">
            <Portrait src={hero.image} alt={hero.name} className="aspect-[3/4] w-full" focus={hero.focus} color />
            <dl className="label grid grid-cols-[96px_1fr] gap-y-1 p-4">
              <dt className="text-ink/50">Name</dt><dd className="font-bold">{hero.realName}</dd>
              <dt className="text-ink/50">Role</dt><dd className="font-bold">{hero.role}</dd>
              <dt className="text-ink/50">Base</dt><dd className="font-bold">{hero.base}</dd>
              <dt className="text-ink/50">Clearance</dt><dd className="font-bold">Level {hero.clearance}</dd>
            </dl>
          </div>

          <div className="relative p-6 md:p-8">
            <span className="dossier-stamp display absolute top-6 right-6 -rotate-6 border-4 border-marvel px-2 text-xl text-marvel">Classified</span>
            <p className="label text-ink/60">{hero.doomsday ? <><span className="bg-ink px-1 text-bone">Doomsday recruit</span> · Avengers: Doomsday response</> : 'Avengers Initiative'}</p>
            <h3 className="display mt-2 text-[clamp(2.5rem,6vw,4.5rem)]">{hero.name}</h3>
            <p className="display-thin text-[clamp(2.5rem,6vw,4.5rem)]">{powerScore(hero)}<span className="label ml-2 align-top">rating</span></p>
            <p className="mt-6 max-w-prose text-[15px] leading-6">
              {hero.bio} Known weaknesses: <span className="bg-ink px-1 text-ink select-none">withheld by order</span> — see addendum <span className="bg-ink px-1 text-ink select-none">7-C</span>.
            </p>

            <div className="mt-8 grid gap-x-8 gap-y-3 sm:grid-cols-2">
              <StatBar label="Power" value={s.power} />
              <StatBar label="Speed" value={s.speed} />
              <StatBar label="Intelligence" value={s.intelligence} />
              <StatBar label="Durability" value={s.durability} />
              <StatBar label="Combat" value={s.combat} red />
            </div>

            <table className="mt-8 w-full text-left">
              <thead>
                <tr className="label border-b-2 border-ink text-ink/60">
                  <th className="py-1 font-normal">Ability</th><th className="py-1 font-normal">Type</th><th className="py-1 text-right font-normal">Dmg</th>
                </tr>
              </thead>
              <tbody>
                {hero.abilities.map((a) => (
                  <tr key={a.name} className="border-b border-ink/20 align-top">
                    <td className="py-2 pr-4">
                      <p className="font-semibold">{a.name}</p>
                      <p className="text-sm text-ink/70">{a.description}</p>
                    </td>
                    <td className="label py-2">{a.kind}</td>
                    <td className="display py-2 text-right text-xl">{a.damage || '+HP'}</td>
                  </tr>
                ))}
                <tr className="align-top">
                  <td className="py-2 pr-4">
                    <p className="font-semibold"><span className="mr-2 bg-marvel px-1 text-bone">Combo</span>{hero.combo.name}</p>
                    <p className="text-sm text-ink/70">{hero.combo.description} Triggered by {hero.abilities[0].name} then {hero.abilities[1].name} on the next round.</p>
                  </td>
                  <td className="label py-2">{hero.combo.hits} hits</td>
                  <td className="display py-2 text-right text-xl">×{hero.combo.bonus}</td>
                </tr>
              </tbody>
            </table>

            <button onClick={onToggle} disabled={deployed && !selected} className={`btn mt-8 w-full justify-center ${selected ? '' : 'btn-red'}`}>
              {deployed && !selected ? 'Currently deployed' : selected ? 'Remove from strike team' : 'Add to strike team'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
