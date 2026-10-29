import { PayPalButtons, PayPalScriptProvider, usePayPalScriptReducer } from '@paypal/react-paypal-js'
import { Check, CircleCheck, Copy, LoaderCircle, Lock, ShieldCheck, TriangleAlert, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import type { ApiHandle } from '../api/client'
import type { Intent, Order, Recommendation } from '../api/types'
import { cn, formatBudget, formatDate, formatPrice } from '../lib/format'
import { EASE } from '../lib/motion'
import { ProductVisual, Rating } from './ui'

interface Props {
  rec: Recommendation | null
  intent: Intent | null
  missionId: string | null
  handle: ApiHandle | null
  onClose: () => void
  onComplete: (order: Order) => void
  onViewOrders: () => void
}

type Step = 'review' | 'processing' | 'success'

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Payment could not be completed. Nothing was charged.')

export function CheckoutModal({ rec, intent, missionId, handle, onClose, onComplete, onViewOrders }: Props) {
  const [step, setStep] = useState<Step>('review')
  const [order, setOrder] = useState<Order | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stage, setStage] = useState(0)

  useEffect(() => {
    if (!rec) return
    setStep('review')
    setOrder(null)
    setError(null)
    setStage(0)
  }, [rec])

  useEffect(() => {
    if (!rec) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && step !== 'processing') onClose()
    }
    window.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [rec, step, onClose])

  const complete = (o: Order) => {
    setOrder(o)
    setStep('success')
    onComplete(o)
  }

  const runDemo = async () => {
    if (!handle || !rec) return
    setError(null)
    setStep('processing')
    setStage(1)
    try {
      const { paypalOrderId } = await handle.api.createOrder(rec.product.id, missionId)
      setStage(2)
      await new Promise((r) => setTimeout(r, 750))
      setStage(3)
      complete(await handle.api.captureOrder(paypalOrderId))
    } catch (e) {
      setError(errorText(e))
      setStep('review')
      setStage(0)
    }
  }

  return (
    <AnimatePresence>
      {rec && (
        <motion.div
          key="checkout"
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/45 backdrop-blur-sm sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onClick={() => step !== 'processing' && onClose()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="checkout-title"
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 48, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 32, opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', bounce: 0.16, duration: 0.55 }}
            className="relative max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
          >
            <button
              type="button"
              onClick={onClose}
              disabled={step === 'processing'}
              aria-label="Close checkout"
              className="absolute right-4 top-4 z-10 flex size-9 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-ink-900 disabled:opacity-40"
            >
              <X className="size-5" />
            </button>

            <AnimatePresence mode="wait" initial={false}>
              {step === 'success' && order ? (
                <Receipt key="receipt" order={order} demo={handle?.config.mode !== 'live'} onClose={onClose} onViewOrders={onViewOrders} />
              ) : (
                <motion.div
                  key="review"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25 }}
                  className="grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
                >
                  <OrderSummary rec={rec} intent={intent} live={handle?.config.mode === 'live'} />

                  <div className="p-6 sm:p-8">
                    <div className="flex items-center justify-between gap-3 pr-10">
                      <h3 className="text-lg font-semibold tracking-tight text-ink-900">Payment</h3>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200/70">
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                        Sandbox
                      </span>
                    </div>

                    <AnimatePresence>
                      {error && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-4 flex gap-2.5 rounded-xl bg-rose-50 p-3 text-sm text-rose-700 ring-1 ring-rose-200/70">
                            <TriangleAlert aria-hidden className="mt-px size-4 shrink-0" />
                            {error}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div className="mt-5">
                      {handle?.config.mode === 'live' ? (
                        handle.config.paypalClientId ? (
                          <LivePayPal
                            clientId={handle.config.paypalClientId}
                            currency={handle.config.currency}
                            busy={step === 'processing'}
                            onCreate={async () => {
                              setError(null)
                              const { paypalOrderId } = await handle.api.createOrder(rec.product.id, missionId)
                              return paypalOrderId
                            }}
                            onApprove={async (orderId) => {
                              setStep('processing')
                              try {
                                complete(await handle.api.captureOrder(orderId))
                              } catch (e) {
                                setError(errorText(e))
                                setStep('review')
                              }
                            }}
                            onCancel={() => setError('Payment cancelled. Nothing was charged.')}
                            onError={() => setError('PayPal could not start the payment. Please try again.')}
                          />
                        ) : (
                          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-200">
                            The server has no PayPal client ID yet. Add PAYPAL_CLIENT_ID to enable checkout.
                          </p>
                        )
                      ) : (
                        <DemoPayment stage={stage} busy={step === 'processing'} price={rec.product.price} onPay={runDemo} />
                      )}
                    </div>

                    <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-xs text-slate-400">
                      <Lock aria-hidden className="size-3" />
                      Test transaction. No real money moves.
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function OrderSummary({ rec, intent, live }: { rec: Recommendation; intent: Intent | null; live: boolean }) {
  const p = rec.product
  const max = intent?.maxPrice ?? null
  const withinBudget = max === null || p.price <= max
  return (
    <div className="border-b border-slate-100 bg-slate-50/70 p-6 sm:p-8 md:border-b-0 md:border-r">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Review your order</p>
      <h2 id="checkout-title" className="mt-1 pr-10 text-xl font-semibold tracking-tight text-ink-900 md:pr-0">
        Ready when you are
      </h2>

      <div className="mt-5 flex gap-4 rounded-2xl bg-white p-3 ring-1 ring-slate-200/80">
        <ProductVisual category={p.category} size="sm" className="size-16 shrink-0 rounded-xl" />
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink-900">{p.name}</p>
          <p className="text-xs text-slate-500">{p.brand}</p>
          <Rating rating={p.rating} reviews={p.reviewCount} small className="mt-1" />
        </div>
      </div>

      <dl className="mt-5 space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-slate-500">Item</dt>
          <dd className="tabular-nums text-slate-700">{formatPrice(p.price)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-500">Shipping</dt>
          <dd className="text-emerald-600">Free</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-500">Tax</dt>
          <dd className="tabular-nums text-slate-700">{formatPrice(0)}</dd>
        </div>
        <div className="flex justify-between border-t border-slate-200 pt-3 text-base font-semibold text-ink-900">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatPrice(p.price)}</dd>
        </div>
      </dl>

      <ul className="mt-6 space-y-2.5 text-sm">
        <li className={cn('flex gap-2.5', withinBudget ? 'text-slate-600' : 'text-amber-700')}>
          {withinBudget ? (
            <CircleCheck aria-hidden className="mt-px size-4 shrink-0 text-emerald-500" />
          ) : (
            <TriangleAlert aria-hidden className="mt-px size-4 shrink-0 text-amber-500" />
          )}
          {max === null
            ? 'No budget set for this mission'
            : withinBudget
              ? `Within your ${formatBudget(max)} budget`
              : `${formatPrice(p.price - max)} over your ${formatBudget(max)} budget`}
        </li>
        <li className="flex gap-2.5 text-slate-600">
          <CircleCheck aria-hidden className="mt-px size-4 shrink-0 text-emerald-500" />
          {live ? 'Price is checked again on the server' : 'Price locked from the catalog'}
        </li>
        <li className="flex gap-2.5 text-slate-600">
          <ShieldCheck aria-hidden className="mt-px size-4 shrink-0 text-accent-500" />
          You approve every payment. ShopPilot never pays on its own.
        </li>
      </ul>
    </div>
  )
}

function LivePayPal({
  clientId,
  currency,
  busy,
  onCreate,
  onApprove,
  onCancel,
  onError,
}: {
  clientId: string
  currency: string
  busy: boolean
  onCreate: () => Promise<string>
  onApprove: (orderId: string) => Promise<void>
  onCancel: () => void
  onError: () => void
}) {
  return (
    <PayPalScriptProvider options={{ clientId, currency, intent: 'capture', components: 'buttons' }}>
      <PayPalButtonsWithLoader busy={busy} onCreate={onCreate} onApprove={onApprove} onCancel={onCancel} onError={onError} />
    </PayPalScriptProvider>
  )
}

function PayPalButtonsWithLoader({
  busy,
  onCreate,
  onApprove,
  onCancel,
  onError,
}: Omit<Parameters<typeof LivePayPal>[0], 'clientId' | 'currency'>) {
  const [{ isPending }] = usePayPalScriptReducer()
  return (
    <div className="relative">
      {isPending && <div className="skeleton h-[46px] rounded-md" />}
      <PayPalButtons
        style={{ layout: 'vertical', shape: 'rect', color: 'gold', label: 'paypal', height: 46 }}
        disabled={busy}
        createOrder={onCreate}
        onApprove={(data) => onApprove(data.orderID)}
        onCancel={onCancel}
        onError={onError}
      />
      {busy && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-xl bg-white/85 text-sm font-medium text-slate-600 backdrop-blur-sm">
          <LoaderCircle aria-hidden className="size-4 animate-spin text-accent-500" />
          Capturing payment…
        </div>
      )}
    </div>
  )
}

const DEMO_STEPS = ['Create the PayPal order', 'Buyer approves in PayPal', 'Capture the payment']

function DemoPayment({ stage, busy, price, onPay }: { stage: number; busy: boolean; price: number; onPay: () => void }) {
  return (
    <div>
      <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200/70">
        <p className="text-sm font-semibold text-ink-900">Demo checkout</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          PayPal Sandbox keys aren't connected yet, so this runs the same three steps in your browser. Once the keys
          are added, the official PayPal button appears here instead.
        </p>
        <ol className="mt-4 space-y-2.5">
          {DEMO_STEPS.map((label, i) => {
            const n = i + 1
            const state = stage > n || (stage === 3 && n === 3 && !busy) ? 'done' : stage === n ? 'active' : 'todo'
            return (
              <li key={label} className="flex items-center gap-2.5 text-sm">
                <span
                  className={cn(
                    'flex size-5 items-center justify-center rounded-full transition-colors duration-300',
                    state === 'done' && 'bg-emerald-500 text-white',
                    state === 'active' && 'bg-accent-50 text-accent-600 ring-1 ring-accent-200',
                    state === 'todo' && 'bg-white text-slate-300 ring-1 ring-slate-200',
                  )}
                >
                  {state === 'done' ? (
                    <Check aria-hidden className="size-3" strokeWidth={3} />
                  ) : state === 'active' ? (
                    <LoaderCircle aria-hidden className="size-3 animate-spin" />
                  ) : (
                    <span className="text-[10px] font-semibold">{n}</span>
                  )}
                </span>
                <span className={state === 'todo' ? 'text-slate-400' : 'text-slate-700'}>{label}</span>
              </li>
            )
          })}
        </ol>
      </div>
      <motion.button
        type="button"
        whileTap={{ scale: 0.98 }}
        onClick={onPay}
        disabled={busy}
        className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-ink-900 text-sm font-semibold text-white shadow-lift transition-colors hover:bg-ink-700 disabled:cursor-wait disabled:bg-ink-700"
      >
        {busy ? (
          <>
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
            Processing…
          </>
        ) : (
          <>
            <Lock aria-hidden className="size-4 text-white/60" />
            Simulate sandbox payment · {formatPrice(price)}
          </>
        )}
      </motion.button>
    </div>
  )
}

function Receipt({ order, demo, onClose, onViewOrders }: { order: Order; demo: boolean; onClose: () => void; onViewOrders: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
      className="px-6 py-10 text-center sm:px-12 sm:py-12"
    >
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', bounce: 0.45, duration: 0.6 }}
        className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-50 ring-8 ring-emerald-50/60"
      >
        <svg viewBox="0 0 24 24" className="size-8 text-emerald-500" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.25, duration: 0.45, ease: 'easeOut' }} />
        </svg>
      </motion.div>
      <h2 id="checkout-title" className="mt-5 text-2xl font-semibold tracking-tight text-ink-900">
        Payment complete
      </h2>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-slate-500">
        Your order for {order.productName} is confirmed.{' '}
        {demo ? 'This was a simulated sandbox payment.' : 'Paid with PayPal Sandbox, so no real money moved.'}
      </p>

      <dl className="mx-auto mt-8 max-w-md divide-y divide-slate-200/70 rounded-2xl bg-slate-50/70 text-left text-sm ring-1 ring-slate-200/70">
        <ReceiptRow label="Amount" value={formatPrice(order.amount)} />
        <ReceiptRow
          label="Status"
          value={
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200/70">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              {order.status}
            </span>
          }
        />
        <ReceiptRow label="PayPal order" value={order.paypalOrderId} mono copy />
        {order.captureId && <ReceiptRow label="Transaction" value={order.captureId} mono copy />}
        <ReceiptRow label="Date" value={formatDate(order.createdAt)} />
      </dl>

      <div className="mt-8 flex flex-col-reverse justify-center gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onViewOrders}
          className="h-11 rounded-xl px-5 text-sm font-semibold text-ink-900 ring-1 ring-slate-200 transition-colors hover:bg-slate-50"
        >
          View orders
        </button>
        <button
          type="button"
          onClick={onClose}
          className="h-11 rounded-xl bg-ink-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-ink-700"
        >
          Keep shopping
        </button>
      </div>
    </motion.div>
  )
}

function ReceiptRow({ label, value, mono, copy }: { label: string; value: ReactNode; mono?: boolean; copy?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className={cn('flex min-w-0 items-center gap-2 text-ink-900', mono && 'font-mono text-xs')}>
        <span className="truncate">{value}</span>
        {copy && typeof value === 'string' && (
          <button
            type="button"
            aria-label={`Copy ${label}`}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(value)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              } catch {
                /* clipboard blocked */
              }
            }}
            className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-white hover:text-ink-900"
          >
            {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
          </button>
        )}
      </dd>
    </div>
  )
}
