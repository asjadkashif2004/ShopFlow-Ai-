import { ArrowLeft } from 'lucide-react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'
import { getApi } from './api'
import type { ApiHandle } from './api/client'
import type { Order, Recommendation } from './api/types'
import { CheckoutModal } from './components/CheckoutModal'
import { Header } from './components/Header'
import { Hero } from './components/Hero'
import { MissionControl } from './components/MissionControl'
import { OrdersView } from './components/OrdersView'
import { Results } from './components/Results'
import { SearchBox } from './components/SearchBox'
import { useMission, type MissionState } from './hooks/useMission'
import { EASE } from './lib/motion'

type View = 'home' | 'mission' | 'orders'

export default function App() {
  const [view, setView] = useState<View>('home')
  const [handle, setHandle] = useState<ApiHandle | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [checkout, setCheckout] = useState<Recommendation | null>(null)
  const { state, start, reset } = useMission()

  useEffect(() => {
    getApi()
      .then((h) => {
        setHandle(h)
        return h.api.listOrders().then(setOrders)
      })
      .catch(() => {})
  }, [])

  const refreshOrders = useCallback(() => {
    handle?.api.listOrders().then(setOrders).catch(() => {})
  }, [handle])

  const runSearch = (query: string) => {
    setView('mission')
    start(query)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const goHome = () => {
    reset()
    setView('home')
    window.scrollTo({ top: 0 })
  }

  const goOrders = () => {
    setView('orders')
    refreshOrders()
    window.scrollTo({ top: 0 })
  }

  const closeCheckout = useCallback(() => setCheckout(null), [])

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-dvh flex-col overflow-x-clip">
        <Header
          active={view === 'orders' ? 'orders' : 'shop'}
          ordersCount={orders.length}
          mode={handle?.config.mode ?? null}
          onLogo={goHome}
          onShop={() => setView(state.status === 'idle' ? 'home' : 'mission')}
          onOrders={goOrders}
        />

        <main className="flex-1">
          <AnimatePresence mode="wait" initial={false}>
            {view === 'home' && <Hero key="home" onSearch={runSearch} catalogSize={handle?.config.catalogSize ?? 60} />}
            {view === 'mission' && (
              <MissionView key="mission" state={state} onSearch={runSearch} onNewSearch={goHome} onBuy={setCheckout} />
            )}
            {view === 'orders' && <OrdersView key="orders" orders={orders} mode={handle?.config.mode ?? null} onShop={goHome} />}
          </AnimatePresence>
        </main>

        <footer className="border-t border-slate-200/70 bg-white/60">
          <div className="mx-auto flex max-w-7xl flex-col gap-1.5 px-4 py-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p>ShopPilot AI · Built for the PayPal Hackathon</p>
            <p>Payments run in PayPal Sandbox, so no real money moves. The demo catalog uses fictional brands.</p>
          </div>
        </footer>

        <CheckoutModal
          rec={checkout}
          intent={state.result?.intent ?? null}
          missionId={state.missionId}
          handle={handle}
          onClose={closeCheckout}
          onComplete={(o) => setOrders((prev) => [o, ...prev.filter((x) => x.id !== o.id)])}
          onViewOrders={() => {
            setCheckout(null)
            goOrders()
          }}
        />
      </div>
    </MotionConfig>
  )
}

function MissionView({
  state,
  onSearch,
  onNewSearch,
  onBuy,
}: {
  state: MissionState
  onSearch: (q: string) => void
  onNewSearch: () => void
  onBuy: (rec: Recommendation) => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, transition: { duration: 0.2 } }}
      transition={{ duration: 0.4, ease: EASE }}
      className="mx-auto max-w-7xl px-4 pb-20 pt-6 sm:px-6 sm:pt-8"
    >
      <div className="flex items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={onNewSearch}
          aria-label="New mission"
          className="flex h-12 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-white hover:text-ink-900 hover:shadow-soft"
        >
          <ArrowLeft aria-hidden className="size-4" />
          <span className="hidden sm:inline">New mission</span>
        </button>
        <SearchBox size="md" defaultValue={state.query} onSubmit={onSearch} busy={state.status === 'running'} />
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[22rem_minmax(0,1fr)] xl:grid-cols-[24rem_minmax(0,1fr)]">
        <aside>
          <MissionControl state={state} />
        </aside>
        <section aria-live="polite" className="min-w-0">
          <Results state={state} onBuy={onBuy} onRefine={onSearch} onRetry={() => onSearch(state.query)} />
        </section>
      </div>
    </motion.div>
  )
}
