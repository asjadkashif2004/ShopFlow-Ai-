import { ArrowRight, LoaderCircle, Mic, Sparkles, Square } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '../lib/format'

interface Props {
  size: 'lg' | 'md'
  defaultValue?: string
  onSubmit: (query: string) => void
  autoFocus?: boolean
  busy?: boolean
}

const ROTATING = [
  'Wireless headphones under $100 with noise cancelling',
  'A gaming mouse under $50',
  'Smartwatch with GPS for running under $200',
  'Lightweight laptop for students under $800',
  'A 4K monitor for coding under $350',
]

/* Minimal typing for the Web Speech API (Chrome, Edge, Safari). */
interface SpeechResultList {
  length: number
  [index: number]: { isFinal: boolean; 0: { transcript: string } }
}
interface Recognizer {
  lang: string
  interimResults: boolean
  continuous: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: { results: SpeechResultList }) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}
type RecognizerCtor = new () => Recognizer

function getRecognizer(): RecognizerCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecognizerCtor; webkitSpeechRecognition?: RecognizerCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function SearchBox({ size, defaultValue = '', onSubmit, autoFocus, busy }: Props) {
  const [value, setValue] = useState(defaultValue)
  const [listening, setListening] = useState(false)
  const [hint, setHint] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const recRef = useRef<Recognizer | null>(null)
  const finalText = useRef('')
  const [canListen] = useState(() => getRecognizer() !== null)
  const lg = size === 'lg'

  useEffect(() => setValue(defaultValue), [defaultValue])

  // Rotate example requests while the big box is empty.
  useEffect(() => {
    if (!lg || value || listening) return
    const t = setInterval(() => setHint((i) => (i + 1) % ROTATING.length), 3200)
    return () => clearInterval(t)
  }, [lg, value, listening])

  // "/" focuses the search box, like most search UIs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      e.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => () => recRef.current?.abort(), [])

  const toggleMic = () => {
    if (listening) {
      recRef.current?.stop()
      return
    }
    const Ctor = getRecognizer()
    if (!Ctor) return
    const rec = new Ctor()
    rec.lang = 'en-US'
    rec.interimResults = true
    rec.continuous = false
    finalText.current = ''
    rec.onresult = (e) => {
      let text = ''
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript
      setValue(text)
      if (e.results[e.results.length - 1].isFinal) finalText.current = text
    }
    rec.onerror = () => setListening(false)
    rec.onend = () => {
      setListening(false)
      const text = finalText.current.trim()
      if (text) onSubmit(text)
    }
    recRef.current = rec
    setListening(true)
    try {
      rec.start()
    } catch {
      setListening(false)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) onSubmit(value)
      }}
      className={cn(
        'group relative flex w-full items-center rounded-2xl bg-white shadow-soft ring-1 ring-slate-200 transition-all duration-300',
        'focus-within:shadow-lift focus-within:ring-2 focus-within:ring-accent-300',
        listening && 'ring-2 ring-rose-300',
        lg ? 'h-16 pl-5 pr-2' : 'h-12 pl-4 pr-1.5',
      )}
    >
      <Sparkles aria-hidden className={cn('shrink-0 text-accent-500', lg ? 'size-5' : 'size-4')} />

      <div className="relative min-w-0 flex-1">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="What are you shopping for?"
          placeholder={listening ? 'Listening…' : lg ? '' : 'Describe what you need…'}
          autoFocus={autoFocus}
          enterKeyHint="search"
          className={cn(
            'w-full bg-transparent px-3 text-ink-900 placeholder:text-slate-400 focus:outline-none',
            lg ? 'text-base sm:text-[17px]' : 'text-[15px]',
          )}
        />
        {lg && !value && !listening && (
          <div aria-hidden className="pointer-events-none absolute inset-y-0 left-3 right-1 flex items-center overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={hint}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.35 }}
                className="truncate text-base text-slate-400 sm:text-[17px]"
              >
                e.g. {ROTATING[hint]}
              </motion.span>
            </AnimatePresence>
          </div>
        )}
      </div>

      {canListen && (
        <motion.button
          type="button"
          whileTap={{ scale: 0.92 }}
          onClick={toggleMic}
          aria-label={listening ? 'Stop listening' : 'Speak your request'}
          aria-pressed={listening}
          title={listening ? 'Stop listening' : 'Speak your request'}
          className={cn(
            'relative mr-1.5 flex shrink-0 items-center justify-center rounded-xl transition-colors',
            lg ? 'size-11' : 'size-9',
            listening ? 'bg-rose-50 text-rose-600' : 'text-slate-400 hover:bg-slate-100 hover:text-ink-900',
          )}
        >
          {listening && (
            <motion.span
              aria-hidden
              className="absolute inset-0 rounded-xl bg-rose-300/40"
              animate={{ scale: [1, 1.35], opacity: [0.6, 0] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }}
            />
          )}
          {listening ? <Square className="relative size-3.5 fill-current" /> : <Mic className={lg ? 'size-5' : 'size-4'} />}
        </motion.button>
      )}

      <motion.button
        type="submit"
        whileTap={{ scale: 0.95 }}
        disabled={!value.trim()}
        aria-label={lg ? 'Start mission' : 'Search'}
        className={cn(
          'flex shrink-0 items-center justify-center gap-2 rounded-xl bg-ink-900 font-semibold text-white transition-colors',
          'hover:bg-ink-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400',
          lg ? 'h-12 px-4 text-sm sm:px-5' : 'h-9 px-3 text-sm',
        )}
      >
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
        <span className="hidden sm:inline">{lg ? 'Start mission' : 'Search'}</span>
      </motion.button>
    </form>
  )
}
