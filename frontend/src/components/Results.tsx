import { CircleDollarSign, Compass, Info, LoaderCircle, RotateCcw, SlidersHorizontal, Sparkles, Star, TrendingDown, TriangleAlert } from 'lucide-react'
import { motion } from 'motion/react'
import type { Recommendation, Refinement } from '../api/types'
import { AGENT_ORDER, type MissionState } from '../hooks/useMission'
import { fadeUp, stagger } from '../lib/motion'
import { ComparisonTable } from './ComparisonTable'
import { AlternativeCard, NearMissCallout, TopPickCard } from './ProductCards'
import { SectionTitle } from './ui'

interface Props {
  state: MissionState
  onBuy: (rec: Recommendation) => void
  onRefine: (query: string) => void
  onRetry: () => void
}

export function Results({ state, onBuy, onRefine, onRetry }: Props) {
  const { status, result, error } = state

  if (status === 'error') return <ErrorCard message={error ?? 'Something went wrong.'} onRetry={onRetry} />
  if (!result) {
    const running = AGENT_ORDER.map((id) => state.agents[id]).find((a) => a.status === 'running')
    return <ResultsSkeleton message={running?.message ?? 'Starting the mission…'} />
  }

  const { recommendations: recs, nearMisses, category, intent } = result
  const [top, ...alts] = recs
  const budgetRefinement = result.refinements.find((r) => r.kind === 'budget')

  return (
    <motion.div key={result.missionId} initial="hidden" animate="show" variants={stagger(0.1)} className="space-y-5">
      {result.summary && <SummaryCard text={result.summary} />}
      {result.notice && <NoticeCard text={result.notice} />}
      {result.refinements.length > 0 && <RefineBar items={result.refinements} onRefine={onRefine} />}

      {top && category && <TopPickCard rec={top} category={category} intent={intent} onBuy={onBuy} />}

      {top && nearMisses[0] && intent.maxPrice !== null && (
        <NearMissCallout rec={nearMisses[0]} maxPrice={intent.maxPrice} refinement={budgetRefinement} onRefine={onRefine} />
      )}

      {alts.length > 0 && (
        <motion.section variants={fadeUp}>
          <SectionTitle>Other strong options</SectionTitle>
          <div className="grid gap-4 md:grid-cols-2">
            {alts.map((a) => (
              <AlternativeCard key={a.product.id} rec={a} onBuy={onBuy} />
            ))}
          </div>
        </motion.section>
      )}

      {!top && nearMisses.length > 0 && (
        <motion.section variants={fadeUp}>
          <SectionTitle>Closest options, over your budget</SectionTitle>
          <div className="grid gap-4 md:grid-cols-2">
            {nearMisses.map((a) => (
              <AlternativeCard key={a.product.id} rec={a} onBuy={onBuy} label="Over budget" />
            ))}
          </div>
        </motion.section>
      )}

      {recs.length > 1 && category && <ComparisonTable recs={recs} category={category} />}
    </motion.div>
  )
}

function SummaryCard({ text }: { text: string }) {
  const words = text.split(' ')
  return (
    <motion.section variants={fadeUp} className="relative overflow-hidden rounded-2xl bg-white p-5 shadow-soft ring-1 ring-slate-200/80 sm:p-6">
      <div aria-hidden className="absolute inset-y-0 left-0 w-1 bg-linear-to-b from-accent-500 to-sky-400" />
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-600">
        <Sparkles aria-hidden className="size-3.5" />
        ShopPilot's take
      </div>
      <motion.p
        className="mt-2.5 text-[15px] leading-relaxed text-slate-700 sm:text-base"
        initial="hidden"
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.018, delayChildren: 0.15 } } }}
        aria-label={text}
      >
        {words.map((w, i) => (
          <motion.span
            key={i}
            aria-hidden
            variants={{ hidden: { opacity: 0, filter: 'blur(3px)' }, show: { opacity: 1, filter: 'blur(0px)' } }}
            transition={{ duration: 0.35 }}
          >
            {w}{' '}
          </motion.span>
        ))}
      </motion.p>
    </motion.section>
  )
}

function NoticeCard({ text }: { text: string }) {
  return (
    <motion.div variants={fadeUp} className="flex gap-3 rounded-2xl bg-white p-5 shadow-soft ring-1 ring-slate-200/80">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
        <Info aria-hidden className="size-4" />
      </span>
      <div>
        <p className="text-sm font-semibold text-ink-900">No perfect match yet</p>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">{text}</p>
      </div>
    </motion.div>
  )
}

const REFINE_ICONS: Record<Refinement['kind'], typeof TrendingDown> = {
  cheaper: TrendingDown,
  budget: CircleDollarSign,
  spec: SlidersHorizontal,
  rating: Star,
  category: Compass,
}

function RefineBar({ items, onRefine }: { items: Refinement[]; onRefine: (q: string) => void }) {
  return (
    <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Refine</span>
      {items.map((r) => {
        const Icon = REFINE_ICONS[r.kind]
        return (
          <motion.button
            key={r.label}
            type="button"
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => onRefine(r.query)}
            title={r.query}
            className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-soft ring-1 ring-slate-200 transition-colors hover:text-accent-700 hover:ring-accent-300"
          >
            <Icon aria-hidden className="size-3.5" />
            {r.label}
          </motion.button>
        )
      })}
    </motion.div>
  )
}

function ResultsSkeleton({ message }: { message: string }) {
  return (
    <div className="space-y-5" aria-busy="true">
      <div className="rounded-2xl bg-white p-5 shadow-soft ring-1 ring-slate-200/80 sm:p-6">
        <div className="flex items-center gap-2.5">
          <LoaderCircle aria-hidden className="size-4 animate-spin text-accent-500" />
          <motion.span
            key={message}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-sm font-medium text-slate-600"
          >
            {message}
          </motion.span>
        </div>
        <div className="mt-4 space-y-2">
          <div className="skeleton h-3 w-11/12 rounded" />
          <div className="skeleton h-3 w-9/12 rounded" />
        </div>
      </div>
      <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/80">
        <div className="grid md:grid-cols-[15rem_1fr]">
          <div className="skeleton h-48 md:h-[24rem]" />
          <div className="space-y-3 p-7">
            <div className="skeleton h-3 w-28 rounded" />
            <div className="skeleton h-7 w-2/3 rounded-md" />
            <div className="skeleton h-3 w-32 rounded" />
            <div className="skeleton mt-6 h-3 w-full rounded" />
            <div className="skeleton h-3 w-10/12 rounded" />
            <div className="flex gap-2 pt-3">
              <div className="skeleton h-6 w-20 rounded-lg" />
              <div className="skeleton h-6 w-24 rounded-lg" />
              <div className="skeleton h-6 w-16 rounded-lg" />
            </div>
          </div>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="skeleton h-40 rounded-2xl" />
        <div className="skeleton h-40 rounded-2xl" />
      </div>
    </div>
  )
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-start gap-4 rounded-2xl bg-white p-6 shadow-soft ring-1 ring-rose-200 sm:flex-row sm:items-center"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-500">
        <TriangleAlert aria-hidden className="size-5" />
      </span>
      <div className="flex-1">
        <p className="font-semibold text-ink-900">The mission stopped</p>
        <p className="mt-0.5 text-sm text-slate-600">{message}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-2 rounded-xl bg-ink-900 px-4 py-2 text-sm font-semibold text-white hover:bg-ink-700"
      >
        <RotateCcw aria-hidden className="size-4" />
        Try again
      </button>
    </motion.div>
  )
}
