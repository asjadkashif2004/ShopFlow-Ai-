// Demo version of the ShopPilot agent pipeline, running fully in the browser.
// The FastAPI backend will do the same steps (with Groq for the intent and the
// write-up), so the UI works identically in demo and live mode.

import catalogJson from '../../../data/catalog.seed.json'
import type {
  Catalog,
  Category,
  Intent,
  MissionResult,
  Product,
  Recommendation,
  Refinement,
  Requirement,
  ScoreBreakdown,
  SpecDef,
  SpecValue,
  Tradeoff,
} from '../api/types'
import { formatBudget, formatCount, formatPrice, formatSpec, joinList, lowerFirst } from '../lib/format'

export const catalog = catalogJson as unknown as Catalog

const categoryBySlug = new Map(catalog.categories.map((c) => [c.slug, c]))
export const getCategory = (slug: string) => categoryBySlug.get(slug) ?? null

const tagsByCategory = new Map<string, Set<string>>()
for (const p of catalog.products) {
  const set = tagsByCategory.get(p.category) ?? new Set<string>()
  p.tags.forEach((t) => set.add(t))
  tagsByCategory.set(p.category, set)
}

/* ------------------------------------------------------------------ */
/* Intent agent: turn the shopper's words into structured needs        */
/* ------------------------------------------------------------------ */

const CATEGORY_PATTERNS: Array<[string, RegExp]> = [
  ['headphones', /\b(head ?phones?|ear ?buds?|headsets?|earphones?|buds)\b/],
  ['mice', /\b(mouse|mice)\b/],
  ['keyboards', /\b(keyboards?)\b/],
  ['monitors', /\b(monitors?|displays?|screens?)\b/],
  ['smartwatches', /\b(smart ?watch(es)?|watch(es)?|fitness trackers?|trackers?|fitness bands?)\b/],
  ['laptops', /\b(laptops?|notebooks?|ultrabooks?|chromebooks?)\b/],
]

/** Pick the category word that appears first: "monitor for my laptop" → monitors. */
function detectCategory(q: string): string | null {
  let best: { slug: string; index: number } | null = null
  for (const [slug, re] of CATEGORY_PATTERNS) {
    const m = re.exec(q)
    if (m && (best === null || m.index < best.index)) best = { slug, index: m.index }
  }
  return best?.slug ?? null
}

function parseBudget(q: string): number | null {
  const range = q.match(/between\s*\$?\s*(\d[\d,]*)\s*(?:and|-|to)\s*\$?\s*(\d[\d,]*)/)
  if (range) return Number(range[2].replace(/,/g, ''))
  const patterns = [
    /(?:under|below|less than|max(?:imum)?|up to|within|no more than|cheaper than|budget(?: of| is)?:?|<)\s*(?:\$|usd\s*)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?\b/,
    /\$\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?\b/,
    /(\d[\d,]*(?:\.\d+)?)\s*(k)?\s*(?:dollars|usd|bucks)\b/,
  ]
  for (const re of patterns) {
    const m = q.match(re)
    if (!m) continue
    let n = parseFloat(m[1].replace(/,/g, ''))
    if (m[2]) n *= 1000
    if (n > 0) return n
  }
  return null
}

const hasSpec = (c: Category, key: string) => c.specs.some((s) => s.key === key)
const must = (id: string, label: string, phrase: string, extra: Partial<Requirement>): Requirement => ({
  id,
  label,
  phrase,
  kind: 'must',
  ...extra,
})
const prefer = (id: string, label: string, phrase: string, extra: Partial<Requirement>): Requirement => ({
  id,
  label,
  phrase,
  kind: 'prefer',
  ...extra,
})

type Builder = (c: Category, m: RegExpMatchArray) => Requirement | null

const RULES: Array<[RegExp, Builder]> = [
  [/\bwired\b/, (c) => (hasSpec(c, 'wireless') ? must('wired', 'Wired', 'wired', { spec: 'wireless', equals: false, verb: 'is' }) : null)],
  [
    /\b(wireless|bluetooth|cordless)\b/,
    (c) =>
      hasSpec(c, 'wireless') ? must('wireless', 'Wireless', 'wireless', { spec: 'wireless', equals: true, verb: 'is' }) : null,
  ],
  [/\b(ear ?buds?|in[- ]ear|buds)\b/, (c) => (hasSpec(c, 'form') ? must('form', 'In-ear', 'in-ear', { spec: 'form', equals: 'In-ear', verb: 'is' }) : null)],
  [/\bover[- ]ear\b/, (c) => (hasSpec(c, 'form') ? must('form', 'Over-ear', 'over-ear', { spec: 'form', equals: 'Over-ear', verb: 'is' }) : null)],
  [/\bon[- ]ear\b/, (c) => (hasSpec(c, 'form') ? must('form', 'On-ear', 'on-ear', { spec: 'form', equals: 'On-ear', verb: 'is' }) : null)],
  [
    /noise[- ]?cancel|\banc\b/,
    (c) => (hasSpec(c, 'anc') ? must('anc', 'Noise cancelling', 'noise cancelling', { spec: 'anc', equals: true }) : null),
  ],
  [
    /\bmechanical\b/,
    (c) =>
      hasSpec(c, 'mechanical')
        ? must('mechanical', 'Mechanical', 'mechanical', { spec: 'mechanical', equals: true, verb: 'is' })
        : null,
  ],
  [
    /hot[- ]?swap/,
    (c) => (hasSpec(c, 'hotSwap') ? must('hotswap', 'Hot-swap switches', 'hot-swap', { spec: 'hotSwap', equals: true }) : null),
  ],
  [
    /\b(4k|uhd|2160p?)\b/,
    (c) => (hasSpec(c, 'resolution') ? must('4k', '4K resolution', '4K', { spec: 'resolution', equals: '3840×2160' }) : null),
  ],
  [
    /\b(1440p|qhd)\b/,
    (c) =>
      hasSpec(c, 'resolution') ? must('qhd', '1440p resolution', '1440p', { spec: 'resolution', equals: '2560×1440' }) : null,
  ],
  [/\boled\b/, (c) => (hasSpec(c, 'panel') ? must('oled', 'OLED panel', 'OLED', { spec: 'panel', equals: 'OLED' }) : null)],
  [
    /\b(\d{2,3})\s?hz\b/,
    (c, m) =>
      hasSpec(c, 'refreshHz') ? must('hz', `${m[1]} Hz+ refresh`, `${m[1]}Hz`, { spec: 'refreshHz', min: Number(m[1]) }) : null,
  ],
  [/usb[- ]?c/, (c) => (hasSpec(c, 'usbCWatts') ? must('usbc', 'USB-C power', 'USB-C', { spec: 'usbCWatts', min: 1 }) : null)],
  [/\bgps\b/, (c) => (hasSpec(c, 'gps') ? must('gps', 'Built-in GPS', 'GPS', { spec: 'gps', equals: true }) : null)],
  [
    /tap[- ]to[- ]pay|\bnfc\b|contactless/,
    (c) => (hasSpec(c, 'nfcPay') ? must('nfc', 'Tap to pay', 'tap to pay', { spec: 'nfcPay', equals: true }) : null),
  ],
  [
    /\b(\d{1,2})\s?gb\b/,
    (c, m) =>
      hasSpec(c, 'ramGb') ? must('ram', `${m[1]} GB+ memory`, `${m[1]}GB RAM`, { spec: 'ramGb', min: Number(m[1]) }) : null,
  ],
  [/\b(mic|microphone|calls?)\b/, (c) => (hasSpec(c, 'mic') ? prefer('mic', 'Built-in mic', 'mic', { spec: 'mic', equals: true }) : null)],
  [/\brgb\b/, (c) => (hasSpec(c, 'rgb') ? prefer('rgb', 'RGB lighting', 'RGB', { spec: 'rgb', equals: true }) : null)],
  [
    /battery|all[- ]day|long[- ]lasting/,
    (c) => {
      const key = hasSpec(c, 'batteryDays') ? 'batteryDays' : hasSpec(c, 'batteryHours') ? 'batteryHours' : null
      return key ? prefer('battery', 'Long battery', 'long battery', { spec: key, direction: 'higher' }) : null
    },
  ],
  [
    /\b(light|lightweight|lighter|portable|ultralight|featherweight)\b/,
    (c) => {
      const key = hasSpec(c, 'weightKg') ? 'weightKg' : hasSpec(c, 'weightG') ? 'weightG' : null
      return key ? prefer('light', 'Lightweight', 'lightweight', { spec: key, direction: 'lower' }) : null
    },
  ],
  [
    /high[- ]refresh|smooth|fast refresh/,
    (c) =>
      hasSpec(c, 'refreshHz')
        ? prefer('refresh', 'High refresh rate', 'high refresh rate', { spec: 'refreshHz', direction: 'higher' })
        : null,
  ],
]

/** Use-case words become "prefer" tags: they boost a product without filtering others out. */
const TAG_RULES: Array<[RegExp, string, string, string]> = [
  [/\b(gaming|gamers?|games?|fps|esports?)\b/, 'gaming', 'For gaming', 'for gaming'],
  [/\b(run|runs|running|runners?|jogging|marathons?)\b/, 'running', 'For running', 'for running'],
  [/\b(coding|programming|programmers?|developers?|code)\b/, 'coding', 'For coding', 'for coding'],
  [/\b(students?|school|college|university)\b/, 'student', 'For students', 'for students'],
  [/\b(office|work|working|productivity|business)\b/, 'office', 'For work', 'for work'],
  [/\b(travel|traveling|travelling|flights?|commute|commuting|trips?)\b/, 'travel', 'For travel', 'for travel'],
  [/\b(fitness|workouts?|gym|training)\b/, 'fitness', 'For workouts', 'for workouts'],
  [/\b(hiking|hikes?|outdoors?|trails?)\b/, 'hiking', 'For the outdoors', 'for hiking'],
  [/\b(creative|design|designers?|photos?|video|editing)\b/, 'creative', 'For creative work', 'for creative work'],
  [/\b(quiet|silent)\b/, 'quiet', 'Quiet', 'quiet'],
  [/\b(ergonomic|wrist|vertical)\b/, 'ergonomic', 'Ergonomic', 'ergonomic'],
  [/\b(kids?|children|child)\b/, 'kids', 'For kids', 'for kids'],
]

const TAG_PRAISE: Record<string, string> = {
  gaming: 'Built for gaming',
  running: 'Built for running',
  coding: 'Great for coding',
  student: 'Popular with students',
  office: 'Made for work',
  travel: 'Travel-friendly',
  fitness: 'Made for workouts',
  hiking: 'Trail-ready',
  creative: 'Made for creative work',
  quiet: 'Quiet in use',
  ergonomic: 'Ergonomic design',
  kids: 'Designed for kids',
}

const VALUE_RE = /\b(cheap|cheapest|cheaper|affordable|inexpensive|bargain|budget[- ]friendly|best value|value for money)\b/
const RATING_RE = /\b(top[- ]rated|best[- ]rated|highest[- ]rated|well[- ]reviewed|best reviewed|great reviews)\b/

export function parseIntent(query: string): Intent {
  const q = query.toLowerCase()
  const slug = detectCategory(q)
  const category = slug ? getCategory(slug) : null
  const maxPrice = parseBudget(q)
  const requirements: Requirement[] = []

  if (category) {
    const add = (r: Requirement | null) => {
      if (r && !requirements.some((x) => x.id === r.id)) requirements.push(r)
    }
    for (const [re, build] of RULES) {
      const m = q.match(re)
      if (m) add(build(category, m))
    }
    const tags = tagsByCategory.get(category.slug)
    for (const [re, tag, label, phrase] of TAG_RULES) {
      if (re.test(q) && tags?.has(tag)) add(prefer(`tag:${tag}`, label, phrase, { tag }))
    }
    // "wired" and "wireless" together: trust "wireless".
    if (requirements.some((r) => r.id === 'wireless')) {
      const i = requirements.findIndex((r) => r.id === 'wired')
      if (i >= 0) requirements.splice(i, 1)
    }
  }

  const intent: Intent = {
    category: category?.slug ?? null,
    maxPrice,
    requirements,
    emphasis: { value: VALUE_RE.test(q), rating: RATING_RE.test(q) },
    summary: '',
  }
  intent.summary = summarizeIntent(intent, category)
  return intent
}

/** "is wireless and has noise cancelling" (or "be wireless and have …" with base verbs). */
function mustClause(reqs: Requirement[], base = false): string {
  const is = reqs.filter((r) => r.verb === 'is').map((r) => lowerFirst(r.label))
  const has = reqs.filter((r) => r.verb !== 'is').map((r) => lowerFirst(r.label))
  const parts: string[] = []
  if (is.length) parts.push(`${base ? 'be' : 'is'} ${joinList(is)}`)
  if (has.length) parts.push(`${base ? 'have' : 'has'} ${joinList(has)}`)
  return parts.join(' and ')
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

function summarizeIntent(intent: Intent, category: Category | null): string {
  if (!category) return 'Product type not recognised'
  const parts = [category.name]
  if (intent.maxPrice !== null) parts.push(`under ${formatBudget(intent.maxPrice)}`)
  const musts = intent.requirements.filter((r) => r.kind === 'must')
  const prefs = intent.requirements.filter((r) => r.kind === 'prefer').map((r) => lowerFirst(r.label))
  if (musts.length) parts.push(`must ${mustClause(musts, true)}`)
  if (prefs.length) parts.push(`prefers ${joinList(prefs)}`)
  return parts.join(' · ')
}

/* ------------------------------------------------------------------ */
/* Search + budget agents                                              */
/* ------------------------------------------------------------------ */

export function meets(p: Product, r: Requirement): boolean {
  if (r.tag) return p.tags.includes(r.tag)
  if (!r.spec) return true
  const v = p.specs[r.spec]
  if (r.equals !== undefined) return v === r.equals
  if (r.min !== undefined) return typeof v === 'number' && v >= r.min
  return true
}

export function searchCatalog(intent: Intent) {
  const category = intent.category ? getCategory(intent.category) : null
  const inCategory = category ? catalog.products.filter((p) => p.category === category.slug) : []
  const musts = intent.requirements.filter((r) => r.kind === 'must')
  const matched = inCategory.filter((p) => musts.every((r) => meets(p, r)))
  return { category, inCategory, matched }
}

export function applyBudget(matched: Product[], intent: Intent) {
  if (intent.maxPrice === null) return { within: matched, over: [] as Product[] }
  const max = intent.maxPrice
  return {
    within: matched.filter((p) => p.price <= max),
    over: matched.filter((p) => p.price > max).sort((a, b) => a.price - b.price),
  }
}

/* ------------------------------------------------------------------ */
/* Comparison agent: transparent, deterministic scoring                */
/* ------------------------------------------------------------------ */

export const DEFAULT_WEIGHTS: ScoreBreakdown = { value: 0.25, rating: 0.3, fit: 0.25, specs: 0.2 }

export function weightsFor(intent: Intent): ScoreBreakdown {
  if (intent.emphasis.value) return { value: 0.4, rating: 0.25, fit: 0.2, specs: 0.15 }
  if (intent.emphasis.rating) return { value: 0.2, rating: 0.45, fit: 0.2, specs: 0.15 }
  return DEFAULT_WEIGHTS
}

interface DirKey {
  key: string
  direction: 'higher' | 'lower'
}

function directionalKeys(intent: Intent, category: Category): DirKey[] {
  const fromPrefs = intent.requirements
    .filter((r) => r.direction && r.spec)
    .map((r) => ({ key: r.spec!, direction: r.direction! }))
  if (fromPrefs.length) return fromPrefs
  return category.keySpecs.flatMap((key) => {
    const def = category.specs.find((s) => s.key === key)
    return def?.better ? [{ key, direction: def.better }] : []
  })
}

const num = (v: SpecValue | undefined) => (typeof v === 'number' ? v : null)
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n))
const roundSmart = (n: number) => (Math.abs(n) < 10 ? Math.round(n * 10) / 10 : Math.round(n))

/** Each directional spec is normalised across the group to 40–100, then averaged. */
function specScores(products: Product[], keys: DirKey[]) {
  const out = new Map<string, number>(products.map((p) => [p.id, keys.length ? 0 : 70]))
  for (const { key, direction } of keys) {
    const vals = products.map((p) => num(p.specs[key])).filter((v): v is number => v !== null)
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    for (const p of products) {
      const v = num(p.specs[key])
      let norm = 0
      if (v !== null) norm = max === min ? 1 : direction === 'higher' ? (v - min) / (max - min) : (max - v) / (max - min)
      out.set(p.id, (out.get(p.id) ?? 0) + (40 + 60 * norm) / keys.length)
    }
  }
  return out
}

interface Scored {
  product: Product
  score: number
  breakdown: ScoreBreakdown
}

function scoreAll(products: Product[], intent: Intent, category: Category, weights: ScoreBreakdown): Scored[] {
  if (!products.length) return []
  const keys = directionalKeys(intent, category)
  const specMap = specScores(products, keys)
  // Without a budget, compare prices against the group's median so "cheap" actually matters.
  const sorted = products.map((p) => p.price).sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const ref = intent.maxPrice ?? median * 1.25
  const prefs = intent.requirements.filter((r) => r.kind === 'prefer' && !r.direction)
  return products
    .map((p) => {
      const value = clamp(100 - (p.price / ref) * 50)
      const rating = clamp(((p.rating - 3) / 2) * 100) * (0.85 + 0.15 * Math.min(1, p.reviewCount / 2000))
      const fit = prefs.length ? (prefs.filter((r) => meets(p, r)).length / prefs.length) * 100 : 100
      const specs = specMap.get(p.id) ?? 70
      const score = value * weights.value + rating * weights.rating + fit * weights.fit + specs * weights.specs
      return {
        product: p,
        score: Math.round(score),
        breakdown: {
          value: Math.round(value),
          rating: Math.round(rating),
          fit: Math.round(fit),
          specs: Math.round(specs),
        },
      }
    })
    .sort((a, b) => b.score - a.score || a.product.price - b.product.price)
}

/* ------------------------------------------------------------------ */
/* Explainer: reasons, trade-offs and the written summary              */
/* ------------------------------------------------------------------ */

function bestPhrase(def: SpecDef) {
  if (def.key.startsWith('battery')) return 'Longest battery'
  if (def.key.startsWith('weight')) return 'Lightest'
  if (def.key === 'refreshHz') return 'Highest refresh rate'
  if (def.key === 'responseMs') return 'Fastest response'
  if (def.key === 'ramGb') return 'Most memory'
  return `Best ${lowerFirst(def.label)}`
}

/** "lasts 40 h", "weighs 58 g", "runs at 165 Hz" */
function specClause(def: SpecDef, v: SpecValue | undefined) {
  const val = formatSpec(def, v ?? null)
  if (def.key.startsWith('battery')) return `lasts ${val} on a charge`
  if (def.key.startsWith('weight')) return `weighs just ${val}`
  if (def.key === 'refreshHz') return `runs at ${val}`
  if (def.key === 'responseMs') return `responds in ${val}`
  if (def.key === 'ramGb') return `has ${val} of memory`
  return `has ${lowerFirst(def.label)} of ${val}`
}

function betterClause(def: SpecDef, v: SpecValue | undefined) {
  const val = formatSpec(def, v ?? null)
  if (def.key.startsWith('battery')) return `lasts longer (${val})`
  if (def.key.startsWith('weight')) return `is lighter (${val})`
  if (def.key === 'refreshHz') return `is faster (${val})`
  return `has a better ${lowerFirst(def.label)} (${val})`
}

function reasonsFor(p: Product, pool: Product[], intent: Intent, category: Category, keys: DirKey[]) {
  const out: string[] = []
  const musts = intent.requirements.filter((r) => r.kind === 'must')
  if (musts.length) out.push(capitalize(mustClause(musts)))

  for (const { key, direction } of keys) {
    const def = category.specs.find((s) => s.key === key)
    const v = num(p.specs[key])
    if (!def || v === null) continue
    const vals = pool.map((x) => num(x.specs[key])).filter((x): x is number => x !== null)
    const best = direction === 'higher' ? Math.max(...vals) : Math.min(...vals)
    if (vals.length > 1 && v === best) out.push(`${bestPhrase(def)} of your matches: ${formatSpec(def, v)}`)
    else if (vals.length > 1) {
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length
      out.push(`${def.label}: ${formatSpec(def, v)} (group average ${formatSpec(def, roundSmart(avg))})`)
    } else out.push(`${def.label}: ${formatSpec(def, v)}`)
  }

  const bestRating = Math.max(...pool.map((x) => x.rating))
  if (pool.length > 1 && p.rating === bestRating)
    out.push(`Top-rated match: ${p.rating}★ from ${formatCount(p.reviewCount)} reviews`)
  else out.push(`Rated ${p.rating}★ by ${formatCount(p.reviewCount)} buyers`)

  if (intent.maxPrice !== null && p.price <= intent.maxPrice) {
    const under = intent.maxPrice - p.price
    out.push(
      under < 1
        ? `Right at your ${formatBudget(intent.maxPrice)} budget`
        : `${formatPrice(under)} under your ${formatBudget(intent.maxPrice)} budget`,
    )
  } else if (pool.length > 1 && p.price === Math.min(...pool.map((x) => x.price))) {
    out.push('Lowest price of your matches')
  }

  for (const r of intent.requirements) {
    if (r.tag && p.tags.includes(r.tag) && TAG_PRAISE[r.tag]) out.push(TAG_PRAISE[r.tag])
  }
  return out.slice(0, 5)
}

/** How option `p` compares with the top pick. */
function compareTo(p: Product, top: Product, category: Category, keys: DirKey[], intent: Intent): Tradeoff[] {
  const out: Tradeoff[] = []
  const dp = p.price - top.price
  if (dp <= -1) out.push({ tone: 'pro', text: `${formatPrice(-dp)} cheaper` })
  else if (dp >= 1) out.push({ tone: 'con', text: `${formatPrice(dp)} more` })

  for (const { key, direction } of keys) {
    const def = category.specs.find((s) => s.key === key)
    const a = num(p.specs[key])
    const b = num(top.specs[key])
    if (!def || a === null || b === null || a === b) continue
    const better = direction === 'higher' ? a > b : a < b
    out.push({ tone: better ? 'pro' : 'con', text: `${def.label}: ${formatSpec(def, a)} vs ${formatSpec(def, b)}` })
  }

  const dr = Math.round((p.rating - top.rating) * 10) / 10
  if (dr >= 0.1) out.push({ tone: 'pro', text: `Higher rated: ${p.rating}★ vs ${top.rating}★` })
  else if (dr <= -0.1) out.push({ tone: 'con', text: `Lower rated: ${p.rating}★ vs ${top.rating}★` })

  const mustSpecs = new Set(intent.requirements.filter((r) => r.kind === 'must').map((r) => r.spec))
  let boolDiffs = 0
  for (const def of category.specs) {
    if (def.type !== 'bool' || mustSpecs.has(def.key) || boolDiffs >= 2) continue
    const a = p.specs[def.key]
    const b = top.specs[def.key]
    if (typeof a !== 'boolean' || typeof b !== 'boolean' || a === b) continue
    out.push(a ? { tone: 'pro', text: `Adds ${lowerFirst(def.label)}` } : { tone: 'con', text: `No ${lowerFirst(def.label)}` })
    boolDiffs++
  }
  return out.slice(0, 4)
}

/** Honest caveats for the top pick, so the recommendation doesn't read like an ad. */
function topCaveats(top: Product, alts: Product[], category: Category, keys: DirKey[]): Tradeoff[] {
  const out: Tradeoff[] = []
  const cheaper = alts.filter((a) => top.price - a.price >= 5).sort((a, b) => a.price - b.price)[0]
  if (cheaper) out.push({ tone: 'con', text: `${cheaper.name} is ${formatPrice(top.price - cheaper.price)} cheaper` })
  for (const { key, direction } of keys) {
    const def = category.specs.find((s) => s.key === key)
    const t = num(top.specs[key])
    if (!def || t === null) continue
    const beat = alts.find((a) => {
      const v = num(a.specs[key])
      return v !== null && (direction === 'higher' ? v > t : v < t)
    })
    if (beat)
      out.push({
        tone: 'con',
        text: `${def.label} trails ${beat.name} (${formatSpec(def, t)} vs ${formatSpec(def, beat.specs[key])})`,
      })
  }
  return out.slice(0, 2)
}

function writeSummary(top: Recommendation, alts: Recommendation[], intent: Intent, category: Category, keys: DirKey[]) {
  const p = top.product
  const clauses: string[] = []
  const musts = intent.requirements.filter((r) => r.kind === 'must')
  if (musts.length) clauses.push(mustClause(musts))
  const k = keys[0]
  const def = k ? category.specs.find((s) => s.key === k.key) : undefined
  if (def && num(p.specs[def.key]) !== null) clauses.push(specClause(def, p.specs[def.key]))
  clauses.push(`is rated ${p.rating}★ by ${formatCount(p.reviewCount)} buyers`)

  let s = `${p.name} is my pick: it ${joinList(clauses)}.`
  if (intent.maxPrice !== null && p.price <= intent.maxPrice && intent.maxPrice - p.price >= 1) {
    s += ` At ${formatPrice(p.price)}, it comes in ${formatPrice(intent.maxPrice - p.price)} under your budget.`
  }
  const cheaper = alts.filter((a) => a.product.price < p.price - 1).sort((a, b) => a.product.price - b.product.price)[0]
  if (cheaper) s += ` If you'd rather save, ${cheaper.product.name} costs ${formatPrice(cheaper.product.price)}.`
  if (def && k) {
    const t = num(p.specs[def.key])
    const better = alts.find((a) => {
      const v = num(a.product.specs[def.key])
      return v !== null && t !== null && (k.direction === 'higher' ? v > t : v < t)
    })
    if (better && better !== cheaper)
      s += ` ${better.product.name} ${betterClause(def, better.product.specs[def.key])} but scores lower overall.`
  }
  return s
}

/* ------------------------------------------------------------------ */
/* Refinements: one-click follow-up searches                           */
/* ------------------------------------------------------------------ */

interface QueryOpts {
  maxPrice?: number | null
  addPhrase?: string
  drop?: string
  rating?: boolean
}

function buildQuery(intent: Intent, category: Category, opts: QueryOpts = {}) {
  const reqs = intent.requirements.filter((r) => r.id !== opts.drop)
  const musts = reqs.filter((r) => r.kind === 'must').map((r) => r.phrase)
  const prefs = reqs.filter((r) => r.kind === 'prefer').map((r) => r.phrase)
  if (opts.addPhrase) prefs.push(opts.addPhrase)
  const rating = opts.rating ?? intent.emphasis.rating
  const lead = [rating ? 'top rated' : '', intent.emphasis.value ? 'affordable' : '', ...musts, category.singular]
    .filter(Boolean)
    .join(' ')
  const budget = opts.maxPrice !== undefined ? opts.maxPrice : intent.maxPrice
  let q = lead
  if (budget) q += ` under ${formatBudget(budget)}`
  if (prefs.length) q += `, ${prefs.join(', ')}`
  return q
}

const EXAMPLE_BUDGETS: Record<string, number> = {
  headphones: 100,
  mice: 50,
  keyboards: 80,
  monitors: 300,
  smartwatches: 200,
  laptops: 800,
}

function refinementsFor(intent: Intent, category: Category, recs: Recommendation[], nearMisses: Recommendation[]) {
  const out: Refinement[] = []
  const top = recs[0]?.product
  if (top) {
    const target = Math.floor((top.price - 1) / 5) * 5
    if (target >= 5)
      out.push({ kind: 'cheaper', label: `Cheaper, under ${formatBudget(target)}`, query: buildQuery(intent, category, { maxPrice: target }) })
  }
  if (intent.maxPrice !== null && nearMisses[0]) {
    const nb = Math.ceil(nearMisses[0].product.price / 10) * 10
    out.push({ kind: 'budget', label: `Raise budget to ${formatBudget(nb)}`, query: buildQuery(intent, category, { maxPrice: nb }) })
  }
  const has = (id: string) => intent.requirements.some((r) => r.id === id)
  const specIdeas: Array<[boolean, string, string, string]> = [
    [hasSpec(category, 'batteryHours') || hasSpec(category, 'batteryDays'), 'battery', 'Longer battery', 'long battery'],
    [hasSpec(category, 'weightG') || hasSpec(category, 'weightKg'), 'light', 'Lighter', 'lightweight'],
    [hasSpec(category, 'refreshHz'), 'refresh', 'Higher refresh rate', 'high refresh rate'],
  ]
  let added = 0
  for (const [ok, id, label, phrase] of specIdeas) {
    if (recs.length && ok && !has(id) && added < 2) {
      out.push({ kind: 'spec', label, query: buildQuery(intent, category, { addPhrase: phrase }) })
      added++
    }
  }
  if (!recs.length) {
    for (const r of intent.requirements.filter((x) => x.kind === 'must').slice(0, 2)) {
      out.push({ kind: 'spec', label: `Without “${lowerFirst(r.label)}”`, query: buildQuery(intent, category, { drop: r.id }) })
    }
  }
  if (!intent.emphasis.rating && recs.length)
    out.push({ kind: 'rating', label: 'Favor top rated', query: buildQuery(intent, category, { rating: true }) })
  return out.slice(0, 5)
}

function categoryExamples(): Refinement[] {
  return catalog.categories.map((c) => ({
    kind: 'category' as const,
    label: `${c.name} under ${formatBudget(EXAMPLE_BUDGETS[c.slug] ?? 100)}`,
    query: `${c.singular} under ${formatBudget(EXAMPLE_BUDGETS[c.slug] ?? 100)}`,
  }))
}

/* ------------------------------------------------------------------ */
/* Put it all together                                                 */
/* ------------------------------------------------------------------ */

export function buildResult(missionId: string, query: string, intent: Intent): MissionResult {
  const weights = weightsFor(intent)
  const { category, inCategory, matched } = searchCatalog(intent)

  if (!category) {
    return {
      missionId,
      query,
      intent,
      category: null,
      recommendations: [],
      nearMisses: [],
      summary: '',
      notice:
        "I couldn't tell which kind of product you're after. Mention one, like headphones, a mouse, a keyboard, a monitor, a smartwatch or a laptop.",
      refinements: categoryExamples(),
      weights,
    }
  }

  const { within, over } = applyBudget(matched, intent)
  const keys = directionalKeys(intent, category)
  const top3 = scoreAll(within, intent, category, weights).slice(0, 3)

  const recommendations: Recommendation[] = top3.map((s, i) => ({
    rank: i + 1,
    product: s.product,
    score: s.score,
    breakdown: s.breakdown,
    reasons: reasonsFor(s.product, within, intent, category, keys),
    tradeoffs:
      i === 0
        ? topCaveats(s.product, top3.slice(1).map((x) => x.product), category, keys)
        : compareTo(s.product, top3[0].product, category, keys, intent),
    overBudget: false,
  }))

  let nearMisses: Recommendation[] = []
  if (intent.maxPrice !== null && over.length) {
    // With matches in budget, only mention close calls. With none, show the cheapest options.
    const candidates = within.length ? over.filter((p) => p.price <= intent.maxPrice! * 1.6) : over.slice(0, 3)
    nearMisses = scoreAll(candidates, intent, category, weights)
      .slice(0, recommendations.length ? 1 : 3)
      .map((s, i) => ({
        rank: i + 1,
        product: s.product,
        score: s.score,
        breakdown: s.breakdown,
        reasons: reasonsFor(s.product, [...within, ...candidates], intent, category, keys),
        tradeoffs: recommendations[0] ? compareTo(s.product, recommendations[0].product, category, keys, intent) : [],
        overBudget: true,
      }))
  }

  let notice: string | null = null
  const musts = intent.requirements.filter((r) => r.kind === 'must').map((r) => lowerFirst(r.label))
  if (!matched.length) {
    notice = `None of the ${inCategory.length} ${category.name.toLowerCase()} in the catalog has all of these: ${musts.join(', ')}. Try dropping one.`
  } else if (!within.length && intent.maxPrice !== null) {
    const nearest = over[0]
    notice = `Nothing that fits costs ${formatBudget(intent.maxPrice)} or less. The closest is ${nearest.name} at ${formatPrice(nearest.price)}.`
  }

  return {
    missionId,
    query,
    intent,
    category,
    recommendations,
    nearMisses,
    summary: recommendations.length
      ? writeSummary(recommendations[0], recommendations.slice(1), intent, category, keys)
      : '',
    notice,
    refinements: refinementsFor(intent, category, recommendations, nearMisses),
    weights,
  }
}
