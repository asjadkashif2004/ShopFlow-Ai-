import {
  BrainCircuit,
  Check,
  CircleDollarSign,
  LoaderCircle,
  Plus,
  Radar,
  Scale,
  SlidersHorizontal,
  Sparkles,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { AgentId, ScoreBreakdown } from '../api/types'
import { AGENT_ORDER, type AgentState, type MissionState } from '../hooks/useMission'
import { metaFor } from '../lib/categoryMeta'
import { cn, formatBudget } from '../lib/format'
import { EASE } from '../lib/motion'
import { AnimatedNumber } from './ui'

const AGENTS: Record<AgentId, { name: string; Icon: LucideIcon; idle: string }> = {
  intent: { name: 'Intent Agent', Icon: BrainCircuit, idle: 'Understands your request' },
  search: { name: 'Search Agent', Icon: Radar, idle: 'Scans the catalog' },
  budget: { name: 'Budget Agent', Icon: Wallet, idle: 'Checks every price' },
  compare: { name: 'Comparison Agent', Icon: Scale, idle: 'Scores and ranks the options' },
  explain: { name: 'Explainer', Icon: Sparkles, idle: 'Writes the recommendation' },
}

export const SCORE_PARTS: Array<{ key: keyof ScoreBreakdown; label: string; bar: string; dot: string }> = [
  { key: 'value', label: 'Value', bar: 'bg-emerald-400', dot: 'bg-emerald-300' },
  { key: 'rating', label: 'Rating', bar: 'bg-amber-400', dot: 'bg-amber-300' },
  { key: 'fit', label: 'Fit', bar: 'bg-accent-400', dot: 'bg-accent-300' },
  { key: 'specs', label: 'Specs', bar: 'bg-sky-400', dot: 'bg-sky-300' },
]

export function MissionControl({ state }: { state: MissionState }) {
  const { status, query, intent, agents, stats, catalogSize, durationMs, result } = state
  const finished = AGENT_ORDER.filter((a) => agents[a].status === 'done' || agents[a].status === 'skipped').length
  const running = AGENT_ORDER.some((a) => agents[a].status === 'running')
  const progress = status === 'done' ? 1 : (finished + (running ? 0.5 : 0)) / AGENT_ORDER.length

  return (
    <div className="relative overflow-hidden rounded-3xl bg-ink-900 text-white shadow-lift ring-1 ring-white/10">
      <div aria-hidden className="bg-grid absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_75%)]" />
      <div aria-hidden className="absolute -right-24 -top-28 size-80 rounded-full bg-accent-500/25 blur-3xl" />
      <div aria-hidden className="absolute -bottom-32 -left-24 size-72 rounded-full bg-sky-500/10 blur-3xl" />

      <div className="relative p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">
            <Radar aria-hidden className="size-3.5" />
            Mission control
          </div>
          <StatusPill status={status} durationMs={durationMs} />
        </div>

        <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/10">
          <motion.div
            className="h-full rounded-full bg-linear-to-r from-accent-400 via-sky-300 to-emerald-300"
            initial={{ width: 0 }}
            animate={{ width: `${progress * 100}%` }}
            transition={{ duration: 0.6, ease: EASE }}
          />
        </div>

        <p className="mt-4 text-[15px] leading-snug text-white/90">“{query}”</p>

        <IntentChips intent={intent} />

        <Funnel
          stats={stats}
          total={catalogSize || stats.analyzed || 60}
          categoryName={intent?.category ? intent.category[0].toUpperCase() + intent.category.slice(1) : undefined}
          hasBudget={intent?.maxPrice != null}
        />

        <ol className="mt-6" aria-label="Agent progress">
          {AGENT_ORDER.map((id, i) => (
            <AgentRow key={id} id={id} agent={agents[id]} last={i === AGENT_ORDER.length - 1} />
          ))}
        </ol>

        <AnimatePresence>{result && <Weights weights={result.weights} />}</AnimatePresence>
      </div>
    </div>
  )
}

function StatusPill({ status, durationMs }: { status: MissionState['status']; durationMs: number | null }) {
  const map = {
    idle: { text: 'Ready', cls: 'bg-white/10 text-white/70' },
    running: { text: 'Running', cls: 'bg-accent-500/20 text-accent-200 ring-1 ring-accent-300/30' },
    done: {
      text: durationMs !== null ? `Complete · ${(durationMs / 1000).toFixed(1)}s` : 'Complete',
      cls: 'bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-300/30',
    },
    error: { text: 'Stopped', cls: 'bg-rose-400/15 text-rose-200 ring-1 ring-rose-300/30' },
  }[status]
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={status}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.2 }}
        className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium', map.cls)}
      >
        {status === 'running' && <LoaderCircle aria-hidden className="size-3 animate-spin" />}
        {status === 'done' && <Check aria-hidden className="size-3" strokeWidth={3} />}
        {map.text}
      </motion.span>
    </AnimatePresence>
  )
}

function IntentChips({ intent }: { intent: MissionState['intent'] }) {
  if (!intent) {
    return (
      <div className="mt-4 flex gap-2">
        {[64, 88, 72].map((w) => (
          <span key={w} className="h-6 animate-pulse rounded-full bg-white/[0.06]" style={{ width: w }} />
        ))}
      </div>
    )
  }
  const m = metaFor(intent.category)
  const chips: Array<{ key: string; label: string; tone: 'cat' | 'budget' | 'must' | 'prefer' }> = []
  if (intent.category) chips.push({ key: 'cat', label: intent.category, tone: 'cat' })
  if (intent.maxPrice !== null) chips.push({ key: 'budget', label: `≤ ${formatBudget(intent.maxPrice)}`, tone: 'budget' })
  for (const r of intent.requirements) chips.push({ key: r.id, label: r.label, tone: r.kind === 'must' ? 'must' : 'prefer' })

  return (
    <motion.ul
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.06 } } }}
      className="mt-4 flex flex-wrap gap-1.5"
      aria-label="What ShopPilot understood"
    >
      {chips.map((c) => (
        <motion.li
          key={c.key}
          variants={{ hidden: { opacity: 0, y: 6, scale: 0.95 }, show: { opacity: 1, y: 0, scale: 1 } }}
          transition={{ duration: 0.3, ease: EASE }}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs',
            c.tone === 'cat' && 'bg-white text-ink-900 font-semibold capitalize',
            c.tone === 'budget' && 'bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-300/25 font-medium',
            c.tone === 'must' && 'bg-white/[0.08] text-white ring-1 ring-white/15',
            c.tone === 'prefer' && 'border border-dashed border-white/25 text-white/70',
          )}
        >
          {c.tone === 'cat' && <m.Icon aria-hidden className="size-3.5" strokeWidth={2} />}
          {c.tone === 'budget' && <CircleDollarSign aria-hidden className="size-3.5" />}
          {c.tone === 'must' && <Check aria-hidden className="size-3" strokeWidth={3} />}
          {c.tone === 'prefer' && <Plus aria-hidden className="size-3" />}
          {c.label}
        </motion.li>
      ))}
      {!intent.category && (
        <li className="rounded-full bg-amber-400/15 px-2.5 py-1 text-xs text-amber-200 ring-1 ring-amber-300/25">
          Product type unclear
        </li>
      )}
    </motion.ul>
  )
}

function Funnel({
  stats,
  total,
  categoryName,
  hasBudget,
}: {
  stats: MissionState['stats']
  total: number
  categoryName?: string
  hasBudget: boolean
}) {
  const rows = [
    { label: 'Products analyzed', value: stats.analyzed, bar: 'from-accent-400 to-accent-300' },
    { label: categoryName ? `${categoryName} in catalog` : 'In category', value: stats.inCategory, bar: 'from-accent-400 to-sky-300' },
    { label: 'Meet must-haves', value: stats.matched, bar: 'from-sky-400 to-sky-300' },
    { label: hasBudget ? 'Within budget' : 'In range', value: stats.withinBudget, bar: 'from-emerald-400 to-emerald-300' },
  ]
  return (
    <div className="mt-6 space-y-3 rounded-2xl bg-white/[0.035] p-4 ring-1 ring-white/[0.08]">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-white/55">{r.label}</span>
            <AnimatedNumber value={r.value} className="font-mono text-sm font-medium text-white" />
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
            <motion.div
              className={cn('h-full rounded-full bg-linear-to-r', r.bar)}
              initial={{ width: 0 }}
              animate={{ width: `${r.value ? Math.max(3, (r.value / total) * 100) : 0}%` }}
              transition={{ duration: 0.9, ease: EASE }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function AgentRow({ id, agent, last }: { id: AgentId; agent: AgentState; last: boolean }) {
  const meta = AGENTS[id]
  const s = agent.status
  const message = agent.message || meta.idle
  return (
    <li className="relative flex gap-3.5 pb-5 last:pb-0">
      {!last && (
        <span aria-hidden className="absolute bottom-0 left-[17.5px] top-10 w-px overflow-hidden bg-white/10">
          <motion.span
            className="absolute inset-x-0 top-0 bg-linear-to-b from-emerald-300 to-accent-300"
            initial={{ height: '0%' }}
            animate={{ height: s === 'done' ? '100%' : '0%' }}
            transition={{ duration: 0.5, ease: EASE }}
          />
        </span>
      )}

      <div className="relative size-9 shrink-0">
        {s === 'running' && (
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-xl bg-accent-400/40"
            animate={{ scale: [1, 1.45], opacity: [0.55, 0] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut' }}
          />
        )}
        <div
          className={cn(
            'relative flex size-9 items-center justify-center rounded-xl ring-1 transition-colors duration-300',
            s === 'done' && 'bg-emerald-400/15 text-emerald-300 ring-emerald-300/30',
            s === 'running' && 'bg-accent-500 text-white ring-accent-300/50 shadow-[0_0_24px_rgba(111,134,247,0.55)]',
            (s === 'idle' || s === 'skipped') && 'bg-white/[0.04] text-white/35 ring-white/10',
          )}
        >
          <AnimatePresence mode="wait" initial={false}>
            {s === 'done' ? (
              <motion.span
                key="done"
                initial={{ scale: 0.3, opacity: 0, rotate: -30 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                transition={{ type: 'spring', bounce: 0.5, duration: 0.5 }}
              >
                <Check aria-hidden className="size-4" strokeWidth={2.75} />
              </motion.span>
            ) : (
              <motion.span key="icon" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.6 }}>
                <meta.Icon aria-hidden className="size-4" strokeWidth={1.75} />
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className={cn('text-sm font-medium', s === 'idle' || s === 'skipped' ? 'text-white/45' : 'text-white')}>
            {meta.name}
          </span>
          {s === 'running' && <span className="text-[11px] font-medium text-accent-200">working…</span>}
          {s === 'done' && agent.durationMs !== null && (
            <span className="font-mono text-[11px] text-white/40">{(agent.durationMs / 1000).toFixed(2)}s</span>
          )}
          {s === 'skipped' && <span className="text-[11px] text-white/30">skipped</span>}
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={message}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22 }}
            className={cn('mt-0.5 text-xs leading-relaxed', s === 'idle' || s === 'skipped' ? 'text-white/30' : 'text-white/60')}
          >
            {message}
          </motion.p>
        </AnimatePresence>
      </div>
    </li>
  )
}

function Weights({ weights }: { weights: ScoreBreakdown }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE, delay: 0.2 }}
      className="mt-6 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10"
    >
      <div className="flex items-center gap-2 text-xs font-medium text-white/75">
        <SlidersHorizontal aria-hidden className="size-3.5" />
        How options are scored
      </div>
      <div className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded-full">
        {SCORE_PARTS.map((p, i) => (
          <motion.div
            key={p.key}
            className={cn('h-full', p.bar)}
            initial={{ width: 0 }}
            animate={{ width: `${weights[p.key] * 100}%` }}
            transition={{ duration: 0.7, ease: EASE, delay: 0.3 + i * 0.08 }}
          />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-white/55">
        {SCORE_PARTS.map((p) => (
          <span key={p.key} className="flex items-center gap-1.5">
            <span className={cn('size-1.5 rounded-full', p.dot)} />
            {p.label}
            <span className="ml-auto font-mono text-white/70">{Math.round(weights[p.key] * 100)}%</span>
          </span>
        ))}
      </div>
    </motion.div>
  )
}
