import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import { Star } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { metaFor } from '../lib/categoryMeta'
import { cn, formatCount } from '../lib/format'
import { EASE } from '../lib/motion'

/* Product tile: a calm category illustration instead of stock photos. */
export function ProductVisual({
  category,
  brand,
  size = 'md',
  className,
}: {
  category: string
  brand?: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}) {
  const m = metaFor(category)
  const iconSize = { xs: 18, sm: 30, md: 44, lg: 76 }[size]
  return (
    <div className={cn('relative flex items-center justify-center overflow-hidden bg-linear-to-br', m.tile, className)}>
      <div aria-hidden className="absolute -right-8 -top-8 size-28 rounded-full bg-white/70 blur-2xl" />
      {size === 'lg' && (
        <div
          aria-hidden
          className="absolute left-1/2 top-1/2 size-40 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/90 bg-white/40 shadow-[inset_0_0_40px_rgba(255,255,255,0.7),0_20px_40px_-20px_rgba(15,23,42,0.18)]"
        />
      )}
      <m.Icon aria-hidden size={iconSize} strokeWidth={size === 'xs' ? 1.75 : 1.25} className={cn('relative drop-shadow-sm', m.ink)} />
      {brand && (size === 'md' || size === 'lg') && (
        <span className="absolute bottom-3 left-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500/80">
          {brand}
        </span>
      )}
    </div>
  )
}

export function Rating({ rating, reviews, small, className }: { rating: number; reviews: number; small?: boolean; className?: string }) {
  return (
    <div className={cn('flex items-center gap-1.5', small ? 'text-xs' : 'text-sm', className)}>
      <Star aria-hidden className={cn('fill-amber-400 text-amber-400', small ? 'size-3.5' : 'size-4')} />
      <span className="font-semibold tabular-nums text-ink-900">{rating.toFixed(1)}</span>
      <span className="tabular-nums text-slate-400">({formatCount(reviews)})</span>
    </div>
  )
}

export function ScoreRing({ score, size = 64, label = 'match' }: { score: number; size?: number; label?: string }) {
  const stroke = size > 50 ? 6 : 4.5
  const r = (size - stroke - 2) / 2
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-label={`Match score ${score} out of 100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-slate-100" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          className="stroke-accent-500"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: score / 100 }}
          transition={{ duration: 1.1, ease: EASE, delay: 0.2 }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className={cn('font-semibold tabular-nums text-ink-900', size > 50 ? 'text-lg' : 'text-sm')}>{score}</span>
        {label && <span className="mt-1 text-[9px] font-semibold uppercase tracking-wider text-slate-400">{label}</span>}
      </div>
    </div>
  )
}

/** Counts up smoothly whenever `value` changes. */
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const mv = useMotionValue(0)
  const text = useTransform(mv, (v) => formatCount(Math.round(v)))
  const reduce = useReducedMotion()
  useEffect(() => {
    if (reduce) {
      mv.set(value)
      return
    }
    const controls = animate(mv, value, { duration: 0.9, ease: EASE })
    return () => controls.stop()
  }, [value, reduce, mv])
  return <motion.span className={cn('tabular-nums', className)}>{text}</motion.span>
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h3 className="text-[15px] font-semibold tracking-tight text-ink-900">{children}</h3>
      {aside}
    </div>
  )
}
