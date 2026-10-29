import { ArrowRight, LoaderCircle, Sparkles } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { cn } from '../lib/format'

interface Props {
  size: 'lg' | 'md'
  defaultValue?: string
  onSubmit: (query: string) => void
  autoFocus?: boolean
  busy?: boolean
}

export function SearchBox({ size, defaultValue = '', onSubmit, autoFocus, busy }: Props) {
  const [value, setValue] = useState(defaultValue)
  useEffect(() => setValue(defaultValue), [defaultValue])
  const lg = size === 'lg'

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) onSubmit(value)
      }}
      className={cn(
        'group relative flex w-full items-center rounded-2xl bg-white shadow-soft ring-1 ring-slate-200 transition-all duration-300',
        'focus-within:shadow-lift focus-within:ring-2 focus-within:ring-accent-300',
        lg ? 'h-16 pl-5 pr-2' : 'h-12 pl-4 pr-1.5',
      )}
    >
      <Sparkles aria-hidden className={cn('shrink-0 text-accent-500', lg ? 'size-5' : 'size-4')} />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="What are you shopping for?"
        placeholder={lg ? 'e.g. Wireless headphones under $100 with noise cancelling' : 'Describe what you need…'}
        autoFocus={autoFocus}
        enterKeyHint="search"
        className={cn(
          'min-w-0 flex-1 bg-transparent px-3 text-ink-900 placeholder:text-slate-400 focus:outline-none',
          lg ? 'text-base sm:text-[17px]' : 'text-[15px]',
        )}
      />
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
