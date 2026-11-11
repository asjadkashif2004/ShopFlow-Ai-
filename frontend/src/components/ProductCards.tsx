import { ArrowRight, Check, CircleCheck, Info, Lock, Minus, Plus, Trophy } from 'lucide-react'
import { motion } from 'motion/react'
import type { Category, Intent, Product, Recommendation, Refinement } from '../api/types'
import { cn, formatBudget, formatPrice, formatSpec } from '../lib/format'
import { EASE, fadeUp } from '../lib/motion'
import { SCORE_PARTS } from './MissionControl'
import { ProductVisual, Rating, ScoreRing } from './ui'

function specHighlights(p: Product, category: Category, limit: number) {
  const out: Array<{ label: string; value: string | null }> = []
  for (const def of category.specs) {
    const v = p.specs[def.key]
    if (v === null || v === undefined) continue
    if (def.type === 'bool') {
      if (v) out.push({ label: def.label, value: null })
    } else out.push({ label: def.label, value: formatSpec(def, v) })
  }
  return out.slice(0, limit)
}

export function BuyButton({ onClick, label = 'Buy with PayPal', className }: { onClick: () => void; label?: string; className?: string }) {
  return (
    <motion.button
      type="button"
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={cn(
        'group inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-ink-900 px-6 text-sm font-semibold text-white shadow-lift transition-colors hover:bg-ink-700',
        className,
      )}
    >
      <Lock aria-hidden className="size-4 text-white/60" />
      {label}
      <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5" />
    </motion.button>
  )
}

export function TopPickCard({
  rec,
  category,
  intent,
  onBuy,
}: {
  rec: Recommendation
  category: Category
  intent: Intent
  onBuy: (rec: Recommendation) => void
}) {
  const p = rec.product
  const under = intent.maxPrice !== null ? intent.maxPrice - p.price : null
  return (
    <motion.article variants={fadeUp} className="overflow-hidden rounded-3xl bg-white shadow-lift ring-1 ring-slate-200/80">
      <div>
        <div className="relative">
          <ProductVisual
            category={p.category}
            brand={p.brand}
            image={p.image}
            alt={p.name}
            size="lg"
            className="h-60 sm:h-72 lg:h-80"
          />
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.4, ease: EASE }}
            className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-ink-900/90 px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg backdrop-blur"
          >
            <Trophy aria-hidden className="size-3.5 text-amber-300" />
            Top pick
          </motion.div>
        </div>

        <div className="min-w-0 p-5 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                {p.brand} · {category.singular}
              </p>
              <h3 className="mt-1 text-2xl font-semibold tracking-tight text-ink-900 sm:text-[1.7rem]">{p.name}</h3>
              <Rating rating={p.rating} reviews={p.reviewCount} className="mt-2" />
            </div>
            <ScoreRing score={rec.score} size={68} />
          </div>

          <p className="mt-3 text-sm leading-relaxed text-slate-600">{p.description}</p>

          <ul className="mt-4 flex flex-wrap gap-1.5">
            {specHighlights(p, category, 5).map((s) => (
              <li key={s.label} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1 text-xs ring-1 ring-slate-200/70">
                {s.value === null ? (
                  <>
                    <Check aria-hidden className="size-3 text-emerald-500" strokeWidth={3} />
                    <span className="font-medium text-slate-700">{s.label}</span>
                  </>
                ) : (
                  <>
                    <span className="text-slate-400">{s.label}</span>
                    <span className="font-medium text-slate-700">{s.value}</span>
                  </>
                )}
              </li>
            ))}
          </ul>

          <div className="mt-6 grid gap-5 sm:grid-cols-[minmax(0,1fr)_12.5rem]">
            <div>
              <h4 className="text-sm font-semibold text-ink-900">Why it's the pick</h4>
              <ul className="mt-2.5 space-y-2">
                {rec.reasons.map((r, i) => (
                  <motion.li
                    key={r}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3 + i * 0.08, duration: 0.4, ease: EASE }}
                    className="flex gap-2.5 text-sm leading-snug text-slate-700"
                  >
                    <CircleCheck aria-hidden className="mt-px size-4 shrink-0 text-emerald-500" />
                    {r}
                  </motion.li>
                ))}
              </ul>
              {rec.tradeoffs.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Worth knowing</h4>
                  <ul className="mt-2 space-y-1.5">
                    {rec.tradeoffs.map((t) => (
                      <li key={t.text} className="flex gap-2.5 text-sm leading-snug text-slate-600">
                        <Info aria-hidden className="mt-px size-4 shrink-0 text-amber-500" />
                        {t.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <ScoreBreakdownBars rec={rec} />
          </div>

          <div className="mt-6 flex flex-col gap-4 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-3xl font-semibold tracking-tight tabular-nums text-ink-900">{formatPrice(p.price)}</div>
              <div className="mt-1 flex flex-wrap gap-x-3 text-xs font-medium">
                {under !== null && under >= 0 && (
                  <span className="text-emerald-600">{under >= 1 ? `${formatPrice(under)} under your budget` : 'Right at your budget'}</span>
                )}
                {p.stock <= 12 && <span className="text-amber-600">Only {p.stock} left</span>}
              </div>
            </div>
            <BuyButton onClick={() => onBuy(rec)} className="w-full sm:w-auto" />
          </div>
        </div>
      </div>
    </motion.article>
  )
}

function ScoreBreakdownBars({ rec }: { rec: Recommendation }) {
  return (
    <div className="self-start rounded-2xl bg-slate-50/80 p-4 ring-1 ring-slate-200/60">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Score breakdown</h4>
      {SCORE_PARTS.map((part, i) => {
        const v = rec.breakdown[part.key]
        return (
          <div key={part.key} className="mt-3">
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">{part.label}</span>
              <span className="font-semibold tabular-nums text-slate-700">{v}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200/70">
              <motion.div
                className={cn('h-full rounded-full', part.bar)}
                initial={{ width: 0 }}
                animate={{ width: `${v}%` }}
                transition={{ duration: 0.8, ease: EASE, delay: 0.35 + i * 0.08 }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function AlternativeCard({
  rec,
  onBuy,
  label,
}: {
  rec: Recommendation
  onBuy: (rec: Recommendation) => void
  label?: string
}) {
  const p = rec.product
  return (
    <motion.article
      variants={fadeUp}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-soft ring-1 ring-slate-200/80 transition-shadow hover:shadow-lift"
    >
      <div className="flex gap-4 p-4">
        <ProductVisual category={p.category} image={p.image} size="sm" className="size-20 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {label ?? `Option #${rec.rank}`}
              </span>
              <h4 className="truncate font-semibold text-ink-900" title={p.name}>
                {p.name}
              </h4>
            </div>
            <ScoreRing score={rec.score} size={44} label="" />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-lg font-semibold tabular-nums text-ink-900">{formatPrice(p.price)}</span>
            <Rating rating={p.rating} reviews={p.reviewCount} small />
          </div>
        </div>
      </div>

      {rec.tradeoffs.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Compared with the top pick</p>
          <ul className="mt-2 space-y-1.5">
            {rec.tradeoffs.map((t) => (
              <li key={t.text} className="flex items-start gap-2 text-sm leading-snug text-slate-600">
                {t.tone === 'pro' ? (
                  <Plus aria-hidden className="mt-0.5 size-3.5 shrink-0 text-emerald-500" strokeWidth={2.5} />
                ) : (
                  <Minus aria-hidden className="mt-0.5 size-3.5 shrink-0 text-rose-400" strokeWidth={2.5} />
                )}
                {t.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
        {rec.overBudget ? (
          <span className="text-xs font-medium text-amber-600">Over your budget</span>
        ) : (
          <span className="text-xs text-slate-400">{p.stock} in stock</span>
        )}
        <button
          type="button"
          onClick={() => onBuy(rec)}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-ink-900 ring-1 ring-slate-200 transition-colors hover:bg-slate-50"
        >
          Choose this
          <ArrowRight aria-hidden className="size-3.5" />
        </button>
      </div>
    </motion.article>
  )
}

export function NearMissCallout({
  rec,
  maxPrice,
  refinement,
  onRefine,
}: {
  rec: Recommendation
  maxPrice: number
  refinement?: Refinement
  onRefine: (query: string) => void
}) {
  const p = rec.product
  return (
    <motion.div
      variants={fadeUp}
      className="flex flex-col gap-4 rounded-2xl bg-amber-50/80 p-4 ring-1 ring-amber-200/70 sm:flex-row sm:items-center"
    >
      <ProductVisual category={p.category} image={p.image} size="xs" className="size-12 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-amber-950">Just over budget: {p.name}</p>
        <p className="mt-0.5 text-amber-900/75">
          {p.rating}★ · {formatPrice(p.price)} · {formatPrice(p.price - maxPrice)} over your {formatBudget(maxPrice)} budget
        </p>
      </div>
      {refinement && (
        <button
          type="button"
          onClick={() => onRefine(refinement.query)}
          className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-amber-950 ring-1 ring-amber-200 transition-colors hover:bg-amber-100/60"
        >
          {refinement.label}
        </button>
      )}
    </motion.div>
  )
}
