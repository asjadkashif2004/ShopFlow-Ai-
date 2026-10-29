import { demoApi, demoConfig } from '../demo/demoApi'
import type { ApiHandle } from './client'
import { liveApi } from './live'
import type { AppConfig } from './types'

let handle: Promise<ApiHandle> | null = null

/**
 * Uses the FastAPI backend when it answers /api/config, otherwise the in-browser demo.
 * Set VITE_API_MODE=demo or VITE_API_MODE=live to force one.
 */
export function getApi(): Promise<ApiHandle> {
  handle ??= resolveApi()
  return handle
}

async function resolveApi(): Promise<ApiHandle> {
  const forced = import.meta.env.VITE_API_MODE as string | undefined
  if (forced !== 'demo') {
    try {
      const res = await fetch('/api/config', { signal: AbortSignal.timeout(2500) })
      const type = res.headers.get('content-type') ?? ''
      if (res.ok && type.includes('application/json')) {
        const config = (await res.json()) as Omit<AppConfig, 'mode'>
        return { api: liveApi, config: { ...config, mode: 'live' } }
      }
    } catch {
      /* backend not running */
    }
    if (forced === 'live') throw new Error('The ShopPilot backend is not reachable.')
  }
  return { api: demoApi, config: demoConfig }
}
