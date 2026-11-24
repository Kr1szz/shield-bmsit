import { useEffect, useState } from 'react'
import { Mic, MicOff } from 'lucide-react'
import { useFury } from '../lib/fury'

/** Original line-art badge: a stern face with an eyepatch. */
function DirectorBadge() {
  return (
    <svg viewBox="0 0 40 40" className="h-10 w-10 shrink-0" aria-hidden>
      <rect width="40" height="40" fill="var(--color-ink)" />
      <path d="M11 15 Q20 4 29 15 L29 25 Q20 36 11 25 Z" fill="none" stroke="var(--color-bone)" strokeWidth="2" />
      <path d="M8 13 L32 22" stroke="var(--color-bone)" strokeWidth="1.6" />
      <ellipse cx="15.5" cy="18" rx="4" ry="3" fill="var(--color-bone)" />
      <circle cx="25" cy="19" r="1.4" fill="var(--color-bone)" />
      <path d="M16 28 L24 28" stroke="var(--color-marvel)" strokeWidth="2" />
    </svg>
  )
}

/** Director's comms: types out the latest line, then tucks away. */
export default function FuryComms() {
  const line = useFury((s) => s.line)
  const voice = useFury((s) => s.voice)
  const toggleVoice = useFury((s) => s.toggleVoice)
  const [shown, setShown] = useState('')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!line) return
    setOpen(true)
    setShown('')
    let i = 0
    const type = setInterval(() => {
      i += 2
      setShown(line.text.slice(0, i))
      if (i >= line.text.length) clearInterval(type)
    }, 22)
    const hide = setTimeout(() => setOpen(false), 2600 + line.text.length * 55)
    return () => {
      clearInterval(type)
      clearTimeout(hide)
    }
  }, [line])

  if (!line) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed top-16 right-4 z-50 sm:top-auto sm:bottom-4 w-[min(92vw,400px)] border-2 border-ink bg-bone text-ink shadow-[6px_6px_0_var(--color-marvel)] transition-all duration-300 ${open ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-6 opacity-0'}`}
    >
      <div className="flex items-start gap-3 p-3">
        <DirectorBadge />
        <div className="min-w-0 flex-1">
          <p className="label flex items-center gap-2 font-bold">
            <span className="inline-block h-2 w-2 animate-pulse bg-marvel" />
            Director Fury · secure channel
          </p>
          <p className="mt-1 text-sm leading-5">
            “{shown}
            {shown.length < line.text.length && <span className="blink">_</span>}
            {shown.length >= line.text.length && '”'}
          </p>
        </div>
        <button
          onClick={toggleVoice}
          className="grid h-7 w-7 shrink-0 place-items-center border-2 border-ink hover:bg-ink hover:text-bone"
          aria-label={voice ? 'Turn off Director voice' : 'Turn on Director voice'}
          title={voice ? 'Voice on — click to turn off' : 'Voice off — click to hear the Director'}
        >
          {voice ? <Mic size={13} /> : <MicOff size={13} />}
        </button>
      </div>
    </div>
  )
}
