import { Check, Plus } from 'lucide-react'
import type { Hero } from '../data/types'
import { powerScore } from '../data/heroes'
import { Portrait } from './ui'

/** One roster line in the personnel index. */
export default function HeroRow({ hero, index, selected, deployed, focused, onFocus, onOpen, onToggle }: {
  hero: Hero
  index: number
  selected: boolean
  deployed: boolean
  focused: boolean
  onFocus: () => void
  onOpen: () => void
  onToggle: () => void
}) {
  return (
    <li
      data-reveal
      onMouseEnter={onFocus}
      className={`group grid grid-cols-[40px_56px_1fr_auto] items-center gap-4 border-t-2 border-ink py-3 md:grid-cols-[40px_1fr_110px_56px_auto] ${focused ? 'bg-ink text-bone' : ''}`}
    >
      <span className={`font-mono text-[11px] ${focused ? 'text-marvel' : 'text-ink/50'}`}>{String(index + 1).padStart(3, '0')}</span>
      <Portrait src={hero.image} alt="" className="h-14 w-14 md:hidden" focus={hero.focus} color={selected} />
      <button onClick={onOpen} onFocus={onFocus} className="min-w-0 text-left" aria-label={`Open ${hero.name} file`}>
        <span className="display block text-[clamp(1.1rem,1.9vw,1.6rem)] leading-tight">{hero.name}</span>
        <span className="label block opacity-60">
          {hero.realName} · {hero.role}
          {hero.doomsday && <span className="ml-2 bg-marvel px-1 text-bone opacity-100">Doomsday</span>}
        </span>
      </button>
      <span className="label hidden md:block">
        {deployed ? <span className="bg-marvel px-1 text-bone">Deployed</span> : `LV-${hero.clearance}`}
      </span>
      <span className="display hidden text-2xl md:block">{powerScore(hero)}</span>
      <button
        onClick={onToggle}
        disabled={deployed && !selected}
        aria-pressed={selected}
        aria-label={selected ? `Remove ${hero.name} from team` : `Add ${hero.name} to team`}
        className={`grid h-10 w-10 place-items-center border-2 disabled:cursor-not-allowed disabled:border-dashed disabled:opacity-40 ${
          selected ? 'border-marvel bg-marvel text-bone' : focused ? 'border-bone hover:bg-bone hover:text-ink' : 'border-ink hover:bg-ink hover:text-bone'
        }`}
      >
        {selected ? <Check size={16} /> : <Plus size={16} />}
      </button>
    </li>
  )
}
