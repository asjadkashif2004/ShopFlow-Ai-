import type { AppConfig, MissionEvent, Order } from './types'

export interface ShopApi {
  /** Streams agent progress as events, ending with `result` and `mission_completed`. */
  runMission(query: string, onEvent: (e: MissionEvent) => void, signal: AbortSignal): Promise<void>
  /** Creates a PayPal (Sandbox) order on the server. The price comes from the database, never the browser. */
  createOrder(productId: string, missionId: string | null): Promise<{ paypalOrderId: string }>
  /** Captures the order after the buyer approves it in PayPal. */
  captureOrder(paypalOrderId: string): Promise<Order>
  listOrders(): Promise<Order[]>
}

export interface ApiHandle {
  api: ShopApi
  config: AppConfig
}
