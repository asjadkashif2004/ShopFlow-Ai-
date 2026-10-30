import { Navigation, Receipt, Search } from 'lucide-react'
import { motion } from 'motion/react'
import type { AppConfig } from '../api/types'
import { cn } from '../lib/format'

interface Props {
  active: 'shop' | 'orders'
  ordersCount: number
  config: AppConfig | null
  onLogo: () => void
  onShop: () => void
  onOrders: () => void
}

export function Logo() {
  return (
    <span className="relative flex size-8 items-center justify-center rounded-[10px] bg-ink-900 shadow-sm ring-1 ring-ink-700">
      <Navigation aria-hidden className="size-4 fill-white text-white" strokeWidth={2} />
      <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-accent-400 ring-2 ring-white" />
    </span>
  )
}

const DB_LABEL = { postgres: 'Supabase', supabase: 'Supabase', memory: 'in-memory', browser: 'browser' } as const

function ModeBadge({ config }: { config: AppConfig | null }) {
  if (!config) return null
  const live = config.mode === 'live'
  const sandbox = config.paypalMode === 'sandbox'
  const ai = config.ai.startsWith('groq:') ? `Groq ${config.ai.split('/').pop()}` : 'rules'
  const title = live
    ? `Live backend · AI: ${ai} · Database: ${DB_LABEL[config.database]} · Payments: ${sandbox ? 'PayPal Sandbox' : 'simulated until PayPal keys are added'}` +
      (config.databaseNote ? `\n${config.databaseNote}` : '')
    : 'Demo mode: the agents and checkout are simulated in your browser.'
  return (
    <span
      title={title}
      className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200"
    >
      <span className={cn('size-1.5 rounded-full', live ? (sandbox ? 'bg-emerald-500' : 'bg-sky-500') : 'bg-amber-400')} />
      <span className="sm:hidden">{live ? 'Live' : 'Demo'}</span>
      <span className="hidden sm:inline">{live ? (sandbox ? 'Live · PayPal Sandbox' : 'Live · test payments') : 'Demo mode'}</span>
    </span>
  )
}

export function Header({ active, ordersCount, config, onLogo, onShop, onOrders }: Props) {
  const tabs = [
    { id: 'shop' as const, label: 'Shop', Icon: Search, onClick: onShop },
    { id: 'orders' as const, label: 'Orders', Icon: Receipt, onClick: onOrders, count: ordersCount },
  ]
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/75 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:gap-3 sm:px-6">
        <button type="button" onClick={onLogo} className="flex items-center gap-2.5 rounded-lg" aria-label="ShopPilot home">
          <Logo />
          <span className="text-[17px] font-semibold tracking-tight text-ink-900">ShopPilot</span>
          <span className="rounded-md bg-accent-50 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-accent-600 ring-1 ring-accent-100">
            AI
          </span>
        </button>

        <nav className="ml-1 flex items-center gap-1 sm:ml-8" aria-label="Main">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={t.onClick}
              aria-current={active === t.id ? 'page' : undefined}
              aria-label={t.label}
              className={cn(
                'relative rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors sm:px-3',
                active === t.id ? 'text-ink-900' : 'text-slate-500 hover:text-ink-900',
              )}
            >
              {active === t.id && (
                <motion.span
                  layoutId="nav-pill"
                  className="absolute inset-0 rounded-lg bg-slate-100"
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.5 }}
                />
              )}
              <span className="relative flex items-center gap-1.5">
                <t.Icon aria-hidden className="size-4" />
                <span className="hidden sm:inline">{t.label}</span>
                {t.count ? (
                  <span className="min-w-4 rounded-full bg-ink-900 px-1.5 text-center text-[10px] leading-4 text-white">
                    {t.count}
                  </span>
                ) : null}
              </span>
            </button>
          ))}
        </nav>

        <div className="ml-auto">
          <ModeBadge config={config} />
        </div>
      </div>
    </header>
  )
}
