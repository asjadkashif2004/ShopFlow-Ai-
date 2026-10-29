import type { ShopApi } from './client'
import type { MissionEvent, Order } from './types'

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      detail = body.detail ?? body.message ?? detail
    } catch {
      /* not JSON */
    }
    throw new Error(typeof detail === 'string' ? detail : 'Request failed')
  }
  return res.json() as Promise<T>
}

/** Reads a text/event-stream response from a POST request (EventSource only supports GET). */
async function readEventStream(res: Response, onEvent: (e: MissionEvent) => void) {
  if (!res.ok || !res.body) throw new Error(`Mission failed: ${res.status}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      const data = chunk
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('\n')
      if (data) onEvent(JSON.parse(data) as MissionEvent)
    }
  }
}

export const liveApi: ShopApi = {
  async runMission(query, onEvent, signal) {
    const res = await fetch('/api/missions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ query }),
      signal,
    })
    await readEventStream(res, onEvent)
  },

  async createOrder(productId, missionId) {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, missionId }),
    })
    return json<{ paypalOrderId: string }>(res)
  },

  async captureOrder(paypalOrderId) {
    const res = await fetch(`/api/orders/${encodeURIComponent(paypalOrderId)}/capture`, { method: 'POST' })
    return json<Order>(res)
  },

  async listOrders() {
    return json<Order[]>(await fetch('/api/orders'))
  },
}
