import type { ShopApi } from '../api/client'
import type { AgentDetail, AgentId, AppConfig, MissionEvent, Order } from '../api/types'
import { formatBudget } from '../lib/format'
import { budgetDetail, compareDetail, explainFacts, intentPlanText, sqlPreview } from './details'
import { applyBudget, buildResult, catalog, parseIntent, searchCatalog } from './engine'

export const demoConfig: AppConfig = {
  mode: 'demo',
  paypalMode: 'simulated',
  paypalClientId: null,
  currency: 'USD',
  catalogSize: catalog.products.length,
  database: 'browser',
  ai: 'rules',
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const id = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(id)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

const ORDERS_KEY = 'shoppilot.demo.orders'
let memoryOrders: Order[] = []

function loadOrders(): Order[] {
  try {
    const raw = localStorage.getItem(ORDERS_KEY)
    return raw ? (JSON.parse(raw) as Order[]) : memoryOrders
  } catch {
    return memoryOrders
  }
}

function saveOrders(orders: Order[]) {
  memoryOrders = orders
  try {
    localStorage.setItem(ORDERS_KEY, JSON.stringify(orders))
  } catch {
    /* private mode: keep in memory */
  }
}

/** PayPal order and capture IDs are 17 upper-case letters and digits. */
function paypalStyleId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'
  return Array.from({ length: 17 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

const pending = new Map<string, { productId: string; missionId: string | null }>()

export const demoApi: ShopApi = {
  async runMission(query, onEvent, signal) {
    const started = performance.now()
    const missionId = `demo_${Date.now().toString(36)}`
    const emit = (e: MissionEvent) => {
      if (!signal.aborted) onEvent(e)
    }
    const timers = new Map<AgentId, number>()
    const begin = (agent: AgentId, message: string) => {
      timers.set(agent, performance.now())
      emit({ type: 'agent_started', agent, message })
    }
    const finish = (agent: AgentId, message: string, detail?: AgentDetail, engine?: string) =>
      emit({
        type: 'agent_completed',
        agent,
        message,
        durationMs: Math.round(performance.now() - (timers.get(agent) ?? performance.now())),
        detail,
        engine,
      })

    emit({ type: 'mission_started', missionId, query, catalogSize: catalog.products.length })

    // 1. Intent
    begin('intent', 'Reading your request…')
    await sleep(700, signal)
    const intent = parseIntent(query)
    emit({ type: 'intent', intent })
    finish(
      'intent',
      intent.category ? intent.summary : "Couldn't tell which product type you want",
      { label: 'Parsed in your browser (demo rules)', language: 'json', content: intentPlanText(intent) },
      'rules',
    )

    if (!intent.category) {
      emit({ type: 'result', result: buildResult(missionId, query, intent) })
      emit({ type: 'mission_completed', durationMs: Math.round(performance.now() - started) })
      return
    }

    // 2. Search
    begin('search', `Scanning ${catalog.products.length} products…`)
    emit({ type: 'stats', stats: { analyzed: catalog.products.length } })
    await sleep(550, signal)
    const { category, inCategory, matched } = searchCatalog(intent)
    emit({ type: 'stats', stats: { inCategory: inCategory.length } })
    await sleep(450, signal)
    emit({ type: 'stats', stats: { matched: matched.length } })
    const mustCount = intent.requirements.filter((r) => r.kind === 'must').length
    finish(
      'search',
      mustCount
        ? `${inCategory.length} ${category!.name.toLowerCase()} found · ${matched.length} have every must-have`
        : `${inCategory.length} ${category!.name.toLowerCase()} found`,
      {
        label: 'Equivalent SQL (the demo filters in your browser)',
        language: 'sql',
        content: sqlPreview(category!.slug, intent.requirements.filter((r) => r.kind === 'must')),
      },
    )

    // 3. Budget
    begin(
      'budget',
      intent.maxPrice !== null ? `Checking prices against ${formatBudget(intent.maxPrice)}…` : 'No budget given, keeping every match',
    )
    await sleep(600, signal)
    const { within, over } = applyBudget(matched, intent)
    emit({ type: 'stats', stats: { withinBudget: within.length } })
    finish(
      'budget',
      intent.maxPrice !== null ? `${within.length} within budget · ${over.length} over` : `${within.length} options in range`,
      { label: 'Price check', language: 'text', content: budgetDetail(within, over, intent.maxPrice) },
    )

    // 4. Compare
    begin('compare', 'Scoring value, rating, fit and specs…')
    await sleep(850, signal)
    const result = buildResult(missionId, query, intent)
    const top = result.recommendations[0]
    finish('compare', top ? `Ranked ${within.length} · top score ${top.score}/100` : 'Nothing left to rank', {
      label: 'Scores (0–100)',
      language: 'text',
      content: compareDetail(result),
    })

    // 5. Explain
    begin('explain', 'Writing the recommendation…')
    await sleep(650, signal)
    emit({ type: 'result', result })
    finish(
      'explain',
      top ? `Picked ${top.product.name}` : 'Suggested next steps',
      top
        ? { label: 'Template write-up from these facts', language: 'json', content: JSON.stringify(explainFacts(result), null, 2) }
        : undefined,
      top ? 'template' : undefined,
    )

    emit({ type: 'mission_completed', durationMs: Math.round(performance.now() - started) })
  },

  async createOrder(productId, missionId) {
    await new Promise((r) => setTimeout(r, 450))
    const paypalOrderId = paypalStyleId()
    pending.set(paypalOrderId, { productId, missionId })
    return { paypalOrderId }
  },

  async captureOrder(paypalOrderId) {
    await new Promise((r) => setTimeout(r, 900))
    const info = pending.get(paypalOrderId)
    const product = catalog.products.find((p) => p.id === info?.productId)
    if (!info || !product) throw new Error('Order not found. Please start checkout again.')
    pending.delete(paypalOrderId)
    const order: Order = {
      id: `ord_${Date.now().toString(36)}`,
      paypalOrderId,
      captureId: paypalStyleId(),
      productId: product.id,
      productName: product.name,
      brand: product.brand,
      category: product.category,
      image: product.image ?? null,
      amount: product.price,
      currency: 'USD',
      status: 'COMPLETED',
      missionId: info.missionId,
      paymentMode: 'simulated',
      createdAt: new Date().toISOString(),
    }
    saveOrders([order, ...loadOrders()])
    return order
  },

  async listOrders() {
    return loadOrders()
  },
}
