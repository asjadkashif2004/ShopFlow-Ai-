import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import { Star } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { ProductImage } from '../api/types'
import { metaFor } from '../lib/categoryMeta'
import { cn, formatCount } from '../lib/format'
import { EASE } from '../lib/motion'

type VisualSize = 'xs' | 'sm' | 'md' | 'lg'

/* Fixed-size thumbnails get 1x/2x/3x versions; the large tile gets width-based versions. */
const THUMB_PX: Record<Exclude<VisualSize, 'lg'>, number> = { xs: 48, sm: 80, md: 320 }
const LARGE_WIDTHS = [480, 640, 960, 1280, 1600, 2000]
// The top-pick banner spans the results column: at most ~820px wide on desktop.
const LARGE_SIZES = '(min-width: 1024px) 820px, 100vw'

/** Unsplash resizes on its CDN (and serves AVIF/WebP); any other URL is used as-is. */
function photoSrc(url: string, width: number, square: boolean, quality: number) {
  if (!url.startsWith('https://images.unsplash.com/')) return url
  const q = new URLSearchParams({ w: String(width), q: String(quality), auto: 'format', fit: 'crop' })
  if (square) q.set('h', String(width))
  return `${url}?${q}`
}

function photoProps(url: string, size: VisualSize) {
  if (size === 'lg') {
    return {
      src: photoSrc(url, 960, false, 85),
      srcSet: LARGE_WIDTHS.map((w) => `${photoSrc(url, w, false, 85)} ${w}w`).join(', '),
      sizes: LARGE_SIZES,
    }
  }
  const px = THUMB_PX[size]
  return {
    src: photoSrc(url, px * 2, true, 80),
    srcSet: [1, 2, 3].map((d) => `${photoSrc(url, px * d, true, 80)} ${d}x`).join(', '),
  }
}

function creditHref(href: string) {
  // Unsplash asks for a referral tag on links back to the photo.
  return href.startsWith('https://unsplash.com/') ? `${href}?utm_source=shoppilot&utm_medium=referral` : href
}

/* Product tile: the product photo, with the category illustration underneath as placeholder and fallback. */
export function ProductVisual({
  category,
  brand,
  image,
  alt = '',
  size = 'md',
  className,
}: {
  category: string
  brand?: string
  image?: ProductImage | null
  /** Leave empty when the product name is already next to the tile. */
  alt?: string
  size?: VisualSize
  className?: string
}) {
  const m = metaFor(category)
  const iconSize = { xs: 18, sm: 30, md: 44, lg: 76 }[size]
  const url = image?.url
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const showPhoto = !!url && failedUrl !== url
  const loaded = showPhoto && loadedUrl === url
  const big = size === 'md' || size === 'lg'

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

      {showPhoto && (
        <img
          key={url}
          {...photoProps(url, size)}
          alt={alt}
          loading={size === 'lg' ? 'eager' : 'lazy'}
          fetchPriority={size === 'lg' ? 'high' : 'auto'}
          decoding="async"
          draggable={false}
          ref={(el) => {
            // A cached photo can finish before React attaches onLoad.
            if (el?.complete && el.naturalWidth > 0 && loadedUrl !== url) setLoadedUrl(url)
          }}
          onLoad={() => setLoadedUrl(url)}
          onError={() => setFailedUrl(url)}
          className={cn(
            'absolute inset-0 size-full object-cover transition-[opacity,scale] duration-700 ease-out',
            loaded ? 'scale-100 opacity-100' : 'scale-[1.04] opacity-0',
          )}
        />
      )}

      {loaded && big && (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-linear-to-t from-black/55 via-black/15 to-transparent" />
      )}
      {brand && big && (
        <span
          className={cn(
            'absolute bottom-3 left-4 text-[10px] font-semibold uppercase tracking-[0.2em] transition-colors duration-500',
            loaded ? 'text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]' : 'text-slate-500/80',
          )}
        >
          {brand}
        </span>
      )}
      {loaded && size === 'lg' && image?.credit && (
        <a
          href={image.creditUrl ? creditHref(image.creditUrl) : undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute bottom-3 right-4 max-w-[60%] truncate text-[10px] text-white/75 transition-colors hover:text-white"
        >
          Photo: {image.credit} / Unsplash
        </a>
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
