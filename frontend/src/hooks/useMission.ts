import { useCallback, useReducer, useRef } from 'react'
import { getApi } from '../api'
import type { AgentId, Intent, MissionEvent, MissionResult, MissionStats } from '../api/types'

export type AgentStatus = 'idle' | 'running' | 'done' | 'skipped'

export interface AgentState {
  status: AgentStatus
  message: string
  durationMs: number | null
  engine: string | null
}

export interface MissionState {
  status: 'idle' | 'running' | 'done' | 'error'
  query: string
  missionId: string | null
  catalogSize: number
  intent: Intent | null
  agents: Record<AgentId, AgentState>
  stats: MissionStats
  result: MissionResult | null
  error: string | null
  durationMs: number | null
}

export const AGENT_ORDER: AgentId[] = ['intent', 'search', 'budget', 'compare', 'explain']

const freshAgents = (): Record<AgentId, AgentState> =>
  Object.fromEntries(AGENT_ORDER.map((id) => [id, { status: 'idle', message: '', durationMs: null, engine: null }])) as Record<
    AgentId,
    AgentState
  >

const emptyStats: MissionStats = { analyzed: 0, inCategory: 0, matched: 0, withinBudget: 0 }

const initial: MissionState = {
  status: 'idle',
  query: '',
  missionId: null,
  catalogSize: 0,
  intent: null,
  agents: freshAgents(),
  stats: emptyStats,
  result: null,
  error: null,
  durationMs: null,
}

type Action =
  | { type: 'start'; query: string }
  | { type: 'event'; event: MissionEvent }
  | { type: 'fail'; message: string }
  | { type: 'reset' }

function reducer(state: MissionState, action: Action): MissionState {
  switch (action.type) {
    case 'start':
      return { ...initial, agents: freshAgents(), status: 'running', query: action.query }
    case 'reset':
      return { ...initial, agents: freshAgents() }
    case 'fail':
      return { ...state, status: 'error', error: action.message }
    case 'event': {
      const e = action.event
      switch (e.type) {
        case 'mission_started':
          return { ...state, missionId: e.missionId, catalogSize: e.catalogSize }
        case 'agent_started':
          return {
            ...state,
            agents: { ...state.agents, [e.agent]: { status: 'running', message: e.message, durationMs: null, engine: null } },
          }
        case 'agent_completed':
          return {
            ...state,
            agents: {
              ...state.agents,
              [e.agent]: { status: 'done', message: e.message, durationMs: e.durationMs, engine: e.engine ?? null },
            },
          }
        case 'intent':
          return { ...state, intent: e.intent }
        case 'stats':
          return { ...state, stats: { ...state.stats, ...e.stats } }
        case 'result':
          return { ...state, result: e.result }
        case 'mission_completed': {
          const agents = { ...state.agents }
          for (const id of AGENT_ORDER) {
            if (agents[id].status === 'idle')
              agents[id] = { status: 'skipped', message: 'Not needed', durationMs: null, engine: null }
          }
          return { ...state, agents, status: 'done', durationMs: e.durationMs }
        }
        case 'error':
          return { ...state, status: 'error', error: e.message }
      }
      return state
    }
  }
}

export function useMission() {
  const [state, dispatch] = useReducer(reducer, initial)
  const controller = useRef<AbortController | null>(null)

  const start = useCallback(async (query: string) => {
    const q = query.trim()
    if (!q) return
    controller.current?.abort()
    const ctrl = new AbortController()
    controller.current = ctrl
    dispatch({ type: 'start', query: q })
    try {
      const { api } = await getApi()
      await api.runMission(q, (event) => dispatch({ type: 'event', event }), ctrl.signal)
    } catch (err) {
      if (ctrl.signal.aborted) return
      dispatch({ type: 'fail', message: err instanceof Error ? err.message : 'Something went wrong.' })
    }
  }, [])

  const reset = useCallback(() => {
    controller.current?.abort()
    dispatch({ type: 'reset' })
  }, [])

  return { state, start, reset }
}
