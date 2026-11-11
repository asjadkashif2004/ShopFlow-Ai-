// Shared contract between the UI and the backend.
// The FastAPI backend will send exactly these shapes, so keep them in sync.

export type SpecValue = string | number | boolean | null

export interface SpecDef {
  key: string
  label: string
  type: 'text' | 'number' | 'bool'
  unit?: string
  better?: 'higher' | 'lower'
}

export interface Category {
  slug: string
  name: string
  singular: string
  keySpecs: string[]
  specs: SpecDef[]
}

export interface Product {
  id: string
  category: string
  name: string
  brand: string
  price: number
  rating: number
  reviewCount: number
  stock: number
  description: string
  specs: Record<string, SpecValue>
  tags: string[]
  image?: ProductImage | null
}

/** Product photo (Unsplash) with the photographer credit. */
export interface ProductImage {
  url: string
  credit?: string
  creditUrl?: string
}

export interface Catalog {
  categories: Category[]
  products: Product[]
}

/** One thing the shopper asked for, e.g. "noise cancelling" (must) or "long battery" (prefer). */
export interface Requirement {
  id: string
  label: string
  /** Words that mean the same thing when the query is rebuilt for a refinement. */
  phrase: string
  kind: 'must' | 'prefer'
  /** "is wireless" vs "has noise cancelling", so explanations read naturally. Defaults to "has". */
  verb?: 'is' | 'has'
  spec?: string
  equals?: SpecValue
  min?: number
  tag?: string
  direction?: 'higher' | 'lower'
}

export interface Intent {
  category: string | null
  maxPrice: number | null
  requirements: Requirement[]
  /** Weight boosts, e.g. the shopper said "cheap" or "top rated". */
  emphasis: { value: boolean; rating: boolean }
  summary: string
}

export type AgentId = 'intent' | 'search' | 'budget' | 'compare' | 'explain'

/** "Show your work" for one agent: the intent JSON, the SQL it ran, the scores… */
export interface AgentDetail {
  label: string
  language: 'json' | 'sql' | 'text'
  content: string
}

export interface MissionStats {
  analyzed: number
  inCategory: number
  matched: number
  withinBudget: number
}

export interface ScoreBreakdown {
  value: number
  rating: number
  fit: number
  specs: number
}

/** A plus or minus compared with another option, e.g. "$15 cheaper" (pro) or "10 h less battery" (con). */
export interface Tradeoff {
  tone: 'pro' | 'con'
  text: string
}

export interface Recommendation {
  rank: number
  product: Product
  score: number
  breakdown: ScoreBreakdown
  reasons: string[]
  tradeoffs: Tradeoff[]
  overBudget: boolean
}

export interface Refinement {
  label: string
  query: string
  kind: 'cheaper' | 'budget' | 'spec' | 'rating' | 'category'
}

export interface MissionResult {
  missionId: string
  query: string
  intent: Intent
  category: Category | null
  recommendations: Recommendation[]
  nearMisses: Recommendation[]
  summary: string
  /** Shown when no recommendation could be made (unknown category, nothing matches). */
  notice: string | null
  refinements: Refinement[]
  weights: ScoreBreakdown
}

export type MissionEvent =
  | { type: 'mission_started'; missionId: string; query: string; catalogSize: number }
  | { type: 'agent_started'; agent: AgentId; message: string }
  /** engine: what did the work, e.g. "gpt-oss-120b", "SQL", "rules". detail: the agent's work, shown on click. */
  | { type: 'agent_completed'; agent: AgentId; message: string; durationMs: number; engine?: string; detail?: AgentDetail }
  | { type: 'intent'; intent: Intent }
  | { type: 'stats'; stats: Partial<MissionStats> }
  | { type: 'result'; result: MissionResult }
  | { type: 'mission_completed'; durationMs: number }
  | { type: 'error'; message: string }

export type OrderStatus = 'CREATED' | 'COMPLETED' | 'FAILED'

export interface Order {
  id: string
  paypalOrderId: string
  captureId: string | null
  productId: string
  productName: string
  brand: string
  category: string
  amount: number
  currency: string
  status: OrderStatus
  missionId: string | null
  paymentMode?: 'sandbox' | 'simulated'
  createdAt: string
  image?: ProductImage | null
}

export interface AppConfig {
  /** demo = everything simulated in the browser; live = the FastAPI backend. */
  mode: 'demo' | 'live'
  /** sandbox = real PayPal Sandbox buttons; simulated = no PayPal keys yet. */
  paypalMode: 'sandbox' | 'simulated'
  paypalClientId: string | null
  currency: string
  catalogSize: number
  database: 'postgres' | 'supabase' | 'memory' | 'browser'
  /** Set when the database isn't fully set up, e.g. "run supabase/shoppilot_setup.sql". */
  databaseNote?: string | null
  /** e.g. "groq:openai/gpt-oss-120b" or "rules" */
  ai: string
}
