import {
  BrainCircuit,
  Check,
  ChevronDown,
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
import { useEffect, useState, type ReactNode } from 'react'
import type { AgentDetail, AgentId, ScoreBreakdown } from '../api/types'
import { useMediaQuery } from '../hooks/useMediaQuery'
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
  const hasDetails = AGENT_ORDER.some((a) => agents[a].detail)

  // On phones, fold the panel once the mission is done so the results come into view.
  const small = useMediaQuery('(max-width: 1023px)')
  const [expanded, setExpanded] = useState(true)
  useEffect(() => {
    if (status === 'running') setExpanded(true)
    if (status === 'done' && small) {
      const t = setTimeout(() => setExpanded(false), 900)
      return () => clearTimeout(t)
    }
  }, [status, small])
  const collapsible = small && status === 'done'
  const showBody = !collapsible || expanded

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

        <AnimatePresence initial={false}>
          {showBody && (
            <motion.div
              key="body"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.45, ease: EASE }}
              className="-mx-1 overflow-hidden px-1"
            >
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

              {status === 'done' && hasDetails && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}
                  className="mt-4 text-center text-[11px] text-white/40"
                >
                  Open any agent to see exactly what it did
                </motion.p>
              )}

              <AnimatePresence>{result && <Weights weights={result.weights} />}</AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

        {collapsible && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            className="mt-4 flex w-full items-center justify-between gap-3 rounded-xl bg-white/[0.05] px-3.5 py-2.5 text-left text-xs text-white/70 ring-1 ring-white/10 transition-colors hover:bg-white/[0.08]"
          >
            <span>
              {expanded
                ? 'Hide agent details'
                : `${stats.analyzed} analyzed → ${stats.withinBudget} ${intent?.maxPrice != null ? 'in budget' : 'matches'} · see how the agents decided`}
            </span>
            <ChevronDown aria-hidden className={cn('size-4 shrink-0 transition-transform duration-300', expanded && 'rotate-180')} />
          </button>
        )}
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
            <AnimatedNumber value={r.value} className="text-sm font-semibold text-white" />
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
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (s === 'running' || s === 'idle') setOpen(false)
  }, [s])
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

      <div className="min-w-0 flex-1">
        <button
          type="button"
          disabled={!agent.detail}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={agent.detail ? open : undefined}
          className={cn(
            '-mx-2 -my-0.5 block w-[calc(100%+1rem)] rounded-lg px-2 py-1 text-left transition-colors',
            agent.detail && 'cursor-pointer hover:bg-white/[0.05]',
          )}
        >
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn('truncate text-sm font-medium', s === 'idle' || s === 'skipped' ? 'text-white/45' : 'text-white')}>
              {meta.name}
            </span>
            <AnimatePresence>
              {s === 'done' && agent.engine && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  title={`Handled by ${agent.engine}`}
                  className="shrink-0 rounded-md bg-white/[0.07] px-1.5 py-px text-[10px] font-medium tracking-wide text-white/65 ring-1 ring-white/10"
                >
                  {agent.engine}
                </motion.span>
              )}
            </AnimatePresence>
          </span>
          {s === 'running' && <span className="text-[11px] font-medium text-accent-200">working…</span>}
          {s === 'done' && agent.durationMs !== null && (
            <span className="flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-white/40">
              {(agent.durationMs / 1000).toFixed(2)}s
              {agent.detail && (
                <ChevronDown aria-hidden className={cn('size-3.5 transition-transform duration-300', open && 'rotate-180')} />
              )}
            </span>
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
        </button>
        <AnimatePresence initial={false}>
          {open && agent.detail && (
            <motion.div
              key="detail"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: EASE }}
              className="overflow-hidden"
            >
              <DetailPanel detail={agent.detail} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </li>
  )
}

type Rule = [RegExp, string]

const HIGHLIGHT: Record<AgentDetail['language'], Rule[]> = {
  json: [
    [/"(?:[^"\\]|\\.)*"(?=\s*:)/y, 'text-accent-200'],
    [/"(?:[^"\\]|\\.)*"/y, 'text-emerald-200'],
    [/\b(?:true|false|null)\b|-?\d+(?:\.\d+)?/y, 'text-amber-200'],
  ],
  sql: [
    [/'(?:[^']|'')*'/y, 'text-emerald-200'],
    [/\b(?:select|from|where|and|order by|any)\b/iy, 'text-accent-200'],
    [/::float8|@>|->>/y, 'text-sky-200'],
    [/\b\d+(?:\.\d+)?\b/y, 'text-amber-200'],
  ],
  text: [
    [/✓/y, 'text-emerald-300'],
    [/✕/y, 'text-rose-300'],
    [/#\d+/y, 'text-accent-200'],
    [/\+\$[\d,.]+/y, 'text-rose-200'],
  ],
}

/** Tiny tokenizer: colours keys, strings, numbers and keywords. */
function highlight(content: string, language: AgentDetail['language']): ReactNode[] {
  const rules = HIGHLIGHT[language]
  const out: ReactNode[] = []
  let plain = ''
  let i = 0
  while (i < content.length) {
    let matched = false
    for (const [re, cls] of rules) {
      re.lastIndex = i
      const m = re.exec(content)
      if (m && m[0].length) {
        if (plain) out.push(plain)
        plain = ''
        out.push(
          <span key={i} className={cls}>
            {m[0]}
          </span>,
        )
        i += m[0].length
        matched = true
        break
      }
    }
    if (!matched) plain += content[i++]
  }
  if (plain) out.push(plain)
  return out
}

function DetailPanel({ detail }: { detail: AgentDetail }) {
  return (
    <div className="mt-2 overflow-hidden rounded-xl bg-ink-950/70 ring-1 ring-white/10">
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2">
        <span className="text-[10px] font-semibold uppercase leading-snug tracking-[0.12em] text-white/50">{detail.label}</span>
        <span className="shrink-0 rounded bg-white/[0.06] px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-white/40">
          {detail.language}
        </span>
      </div>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-3 py-2.5 font-mono text-[11px] leading-relaxed text-white/80 [overflow-wrap:anywhere]">
        {highlight(detail.content, detail.language)}
      </pre>
    </div>
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
            <span className="ml-auto font-medium tabular-nums text-white/75">{Math.round(weights[p.key] * 100)}%</span>
          </span>
        ))}
      </div>
    </motion.div>
  )
}
