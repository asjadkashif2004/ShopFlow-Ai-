import { ArrowUpRight, BrainCircuit, Radar, Scale, ShieldCheck, Wallet } from 'lucide-react'
import { motion } from 'motion/react'
import { metaFor } from '../lib/categoryMeta'
import { cn } from '../lib/format'
import { EASE, fadeUp, stagger } from '../lib/motion'
import { SearchBox } from './SearchBox'

const EXAMPLES = [
  { category: 'headphones', text: 'Wireless headphones under $100 with noise cancelling and good battery life' },
  { category: 'mice', text: 'Gaming mouse under $50' },
  { category: 'monitors', text: '4K monitor for coding under $350' },
  { category: 'smartwatches', text: 'Smartwatch with GPS for running under $200' },
  { category: 'keyboards', text: 'Wireless mechanical keyboard under $80' },
  { category: 'laptops', text: 'Lightweight laptop for students under $800' },
]

const BUILT_WITH = ['Groq · gpt-oss-120b', 'Supabase Postgres', 'PayPal Server SDK by APIMatic', 'FastAPI', 'React + Framer Motion']

export function Hero({ onSearch, catalogSize }: { onSearch: (q: string) => void; catalogSize: number }) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      exit={{ opacity: 0, y: -8, transition: { duration: 0.2 } }}
      variants={stagger(0.09, 0.05)}
      className="relative"
    >
      {/* Soft glow + dot texture behind the headline */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[620px] overflow-hidden">
        <div className="absolute left-1/2 top-[-220px] h-[520px] w-[1000px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(76,99,238,0.16),transparent)]" />
        <div className="bg-dots absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black_25%,transparent_70%)]" />
      </div>

      <section className="relative mx-auto max-w-3xl px-4 pt-14 text-center sm:pt-24">
        <motion.div
          variants={fadeUp}
          className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-soft ring-1 ring-slate-200"
        >
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
          Five AI agents. One confident purchase.
        </motion.div>

        <motion.h1
          variants={fadeUp}
          className="mt-6 text-[2.5rem] font-semibold leading-[1.04] tracking-[-0.035em] text-balance text-ink-900 sm:text-[4rem]"
        >
          Tell it what you need.
          <br />
          <span className="bg-linear-to-r from-accent-700 via-accent-500 to-sky-500 bg-clip-text text-transparent">
            It does the research.
          </span>
        </motion.h1>

        <motion.p variants={fadeUp} className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">
          ShopPilot searches the catalog, checks your budget and compares every option, then explains its pick. You
          approve the purchase with PayPal.
        </motion.p>

        <motion.div variants={fadeUp} className="mt-9">
          <SearchBox size="lg" onSubmit={onSearch} autoFocus />
        </motion.div>

        <motion.div variants={fadeUp} className="mt-7">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Try a mission</p>
          <motion.div variants={stagger(0.05, 0.1)} className="mt-3 grid gap-2 text-left sm:grid-cols-2">
            {EXAMPLES.map((ex) => {
              const m = metaFor(ex.category)
              return (
                <motion.button
                  key={ex.text}
                  type="button"
                  variants={fadeUp}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.985 }}
                  onClick={() => onSearch(ex.text)}
                  className="group flex items-center gap-3 rounded-xl bg-white/80 p-2.5 pr-3 text-left text-sm text-slate-700 ring-1 ring-slate-200/80 backdrop-blur transition-shadow hover:shadow-soft hover:ring-slate-300"
                >
                  <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', m.soft)}>
                    <m.Icon aria-hidden className="size-4" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1 leading-snug">{ex.text}</span>
                  <ArrowUpRight
                    aria-hidden
                    className="size-4 shrink-0 text-slate-300 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent-500"
                  />
                </motion.button>
              )
            })}
          </motion.div>
        </motion.div>

        <motion.div
          variants={fadeUp}
          className="mt-10 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-slate-400"
        >
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em]">Built with</span>
          {BUILT_WITH.map((t) => (
            <span key={t} className="font-medium text-slate-500">
              {t}
            </span>
          ))}
        </motion.div>
      </section>

      <HowItWorks catalogSize={catalogSize} />
    </motion.div>
  )
}

function HowItWorks({ catalogSize }: { catalogSize: number }) {
  const steps = [
    { Icon: BrainCircuit, title: 'Intent Agent', text: 'Turns your words into must-haves, nice-to-haves and a budget.' },
    { Icon: Radar, title: 'Search Agent', text: `Scans all ${catalogSize} products and keeps only the ones that qualify.` },
    { Icon: Wallet, title: 'Budget Agent', text: 'Checks every price and flags close calls just over budget.' },
    { Icon: Scale, title: 'Comparison Agent', text: 'Scores value, ratings, fit and specs, and shows its working.' },
    { Icon: ShieldCheck, title: 'You approve', text: 'Nothing is bought until you confirm the payment in PayPal.' },
  ]
  return (
    <section className="relative mx-auto mt-20 max-w-6xl px-4 pb-24 sm:mt-28 sm:px-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-40px' }}
        transition={{ duration: 0.5, ease: EASE }}
        className="text-center"
      >
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">How a mission works</h2>
        <p className="mx-auto mt-2 max-w-lg text-2xl font-semibold tracking-tight text-ink-900">
          Every decision is visible, from your words to the receipt.
        </p>
      </motion.div>
      <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {steps.map((s, i) => {
          const last = i === steps.length - 1
          return (
            <motion.div
              key={s.title}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.5, ease: EASE, delay: i * 0.07 }}
              className="relative rounded-2xl bg-white p-5 shadow-soft ring-1 ring-slate-200/80"
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    'flex size-10 items-center justify-center rounded-xl text-white',
                    last ? 'bg-emerald-500' : 'bg-ink-900',
                  )}
                >
                  <s.Icon aria-hidden className="size-5" strokeWidth={1.75} />
                </span>
                <span className="text-xs font-semibold tabular-nums text-slate-300">0{i + 1}</span>
              </div>
              <h3 className="mt-4 text-[15px] font-semibold text-ink-900">{s.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{s.text}</p>
            </motion.div>
          )
        })}
      </div>
    </section>
  )
}
