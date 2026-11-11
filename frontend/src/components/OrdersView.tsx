import { ArrowRight, Package } from 'lucide-react'
import { motion } from 'motion/react'
import type { AppConfig, Order } from '../api/types'
import { cn, formatDate, formatPrice } from '../lib/format'
import { EASE } from '../lib/motion'
import { ProductVisual } from './ui'

function subtitle(config: AppConfig | null) {
  if (!config || config.mode === 'demo') return 'Simulated orders, saved in this browser.'
  const where =
    config.database === 'postgres' || config.database === 'supabase' ? 'Saved in Supabase.' : 'Saved on the server until it restarts.'
  return config.paypalMode === 'sandbox'
    ? `${where} Payments are captured through PayPal Sandbox, so no real money moves.`
    : `${where} Payments are simulated until PayPal Sandbox keys are added.`
}

export function OrdersView({ orders, config, onShop }: { orders: Order[]; config: AppConfig | null; onShop: () => void }) {
  const total = orders.filter((o) => o.status === 'COMPLETED').reduce((sum, o) => sum + o.amount, 0)
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, transition: { duration: 0.2 } }}
      transition={{ duration: 0.4, ease: EASE }}
      className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink-900">Orders</h1>
          <p className="mt-1 text-sm text-slate-500">{subtitle(config)}</p>
        </div>
        {orders.length > 0 && (
          <div className="rounded-2xl bg-white px-4 py-3 text-right shadow-soft ring-1 ring-slate-200/80">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Total spent</p>
            <p className="text-lg font-semibold tabular-nums text-ink-900">{formatPrice(total)}</p>
          </div>
        )}
      </div>

      {orders.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4, ease: EASE }}
          className="mt-10 flex flex-col items-center rounded-3xl bg-white px-6 py-16 text-center shadow-soft ring-1 ring-slate-200/80"
        >
          <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <Package aria-hidden className="size-6" strokeWidth={1.75} />
          </span>
          <p className="mt-4 font-semibold text-ink-900">No orders yet</p>
          <p className="mt-1 max-w-xs text-sm text-slate-500">Run a mission, pick a product and check out with PayPal Sandbox.</p>
          <button
            type="button"
            onClick={onShop}
            className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-ink-900 px-5 text-sm font-semibold text-white hover:bg-ink-700"
          >
            Start shopping
            <ArrowRight aria-hidden className="size-4" />
          </button>
        </motion.div>
      ) : (
        <ul className="mt-8 space-y-3">
          {orders.map((o, i) => (
            <motion.li
              key={o.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.4, ease: EASE }}
              className="flex flex-wrap items-center gap-4 rounded-2xl bg-white p-4 shadow-soft ring-1 ring-slate-200/80"
            >
              <ProductVisual category={o.category} image={o.image} size="xs" className="size-12 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-ink-900">{o.productName}</p>
                <p className="text-xs text-slate-500">
                  {o.brand} · {formatDate(o.createdAt)}
                </p>
              </div>
              <div className="hidden text-right sm:block">
                <p className="text-[11px] text-slate-400">Transaction</p>
                <p className="font-mono text-xs text-slate-600">{o.captureId ?? '—'}</p>
              </div>
              <span
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1',
                  o.status === 'COMPLETED' && 'bg-emerald-50 text-emerald-700 ring-emerald-200/70',
                  o.status === 'CREATED' && 'bg-slate-50 text-slate-600 ring-slate-200',
                  o.status === 'FAILED' && 'bg-rose-50 text-rose-700 ring-rose-200/70',
                )}
              >
                {o.status}
              </span>
              <span className="w-20 text-right font-semibold tabular-nums text-ink-900">{formatPrice(o.amount)}</span>
            </motion.li>
          ))}
        </ul>
      )}
    </motion.div>
  )
}
