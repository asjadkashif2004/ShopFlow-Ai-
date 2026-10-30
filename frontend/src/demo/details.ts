// "Show your work" text for each agent in demo mode.
// Mirrors backend/app/engine.py (intent_plan_text, sql_preview, budget_detail, compare_detail, explain_facts).

import type { Intent, MissionResult, Product, Recommendation, Requirement } from '../api/types'
import { formatBudget, formatCount, formatPrice } from '../lib/format'

function planItem(r: Requirement): Record<string, unknown> {
  if (r.tag) return { tag: r.tag }
  if (r.direction) return { spec: r.spec, direction: r.direction }
  if (r.min !== undefined) return { spec: r.spec, min: r.min }
  return { spec: r.spec, equals: r.equals }
}

/** JSON's default separators, with a space after ':' and ',' like Python's json.dumps. */
const dump = (v: unknown) => JSON.stringify(v).replace(/":/g, '": ').replace(/,"/g, ', "')

export function intentPlanText(intent: Intent): string {
  const arr = (kind: 'must' | 'prefer') => {
    const items = intent.requirements.filter((r) => r.kind === kind).map((r) => dump(planItem(r)))
    return items.length ? `[\n    ${items.join(',\n    ')}\n  ]` : '[]'
  }
  return [
    '{',
    `  "category": ${dump(intent.category)},`,
    `  "maxPrice": ${dump(intent.maxPrice)},`,
    `  "must": ${arr('must')},`,
    `  "prefer": ${arr('prefer')},`,
    `  "emphasis": ${dump(intent.emphasis)}`,
    '}',
  ].join('\n')
}

export function sqlPreview(slug: string, musts: Requirement[]): string {
  const q = (s: unknown) => String(s).replace(/'/g, "''")
  const lines = ['select id, name, price, rating', 'from products', `where category = '${q(slug)}'`]
  for (const r of musts) {
    if (r.tag) lines.push(`  and '${q(r.tag)}' = any(tags)`)
    else if (r.equals !== undefined) lines.push(`  and specs @> '${q(dump({ [r.spec!]: r.equals }))}'`)
    else if (r.min !== undefined) lines.push(`  and (specs ->> '${q(r.spec)}')::float8 >= ${r.min}`)
  }
  lines.push('order by price;')
  return lines.join('\n')
}

function line(name: string, right: string, width = 26) {
  const n = name.length <= width ? name : `${name.slice(0, width - 1)}…`
  return `${n.padEnd(width)} ${right.padStart(9)}`
}

export function budgetDetail(withinRaw: Product[], over: Product[], maxPrice: number | null): string {
  const within = [...withinRaw].sort((a, b) => a.price - b.price)
  if (maxPrice === null) {
    return ['No budget given, so every match stays in.', '', ...within.map((p) => `✓ ${line(p.name, formatPrice(p.price))}`)].join('\n')
  }
  return [
    `Budget: ${formatBudget(maxPrice)}`,
    '',
    ...within.map((p) => `✓ ${line(p.name, formatPrice(p.price))}`),
    ...over.map((p) => `✕ ${line(p.name, formatPrice(p.price))}  +${formatPrice(p.price - maxPrice)}`),
  ].join('\n')
}

export function compareDetail(result: MissionResult): string {
  const w = result.weights
  const rows = [
    `Weights  ${Object.entries(w)
      .map(([k, v]) => `${k} ${Math.round(v * 100)}%`)
      .join(' · ')}`,
    '',
  ]
  for (const r of result.recommendations) {
    const b = r.breakdown
    rows.push(`#${r.rank} ${line(r.product.name, String(r.score), 24)}`)
    rows.push(`   value ${b.value} · rating ${b.rating} · fit ${b.fit} · specs ${b.specs}`)
  }
  if (!result.recommendations.length) rows.push('Nothing within budget to rank.')
  return rows.join('\n')
}

export function explainFacts(result: MissionResult): Record<string, unknown> {
  const max = result.intent.maxPrice
  const note = (price: number) => {
    if (max === null) return undefined
    const diff = max - price
    if (Math.abs(diff) < 0.005) return `exactly your ${formatBudget(max)} budget`
    return diff > 0 ? `${formatPrice(diff)} under your ${formatBudget(max)} budget` : `${formatPrice(-diff)} over your ${formatBudget(max)} budget`
  }
  const brief = (r: Recommendation) => ({
    name: r.product.name,
    price: formatPrice(r.product.price),
    budgetNote: note(r.product.price),
    rating: `${r.product.rating.toFixed(1)}★ from ${formatCount(r.product.reviewCount)} reviews`,
    reasons: r.reasons,
    [r.rank > 1 ? 'versusTopPick' : 'caveats']: r.tradeoffs.map((t) => t.text),
  })
  const [top, ...alts] = result.recommendations
  return {
    shopperRequest: result.query,
    understood: result.intent.summary,
    budget: max !== null ? formatBudget(max) : undefined,
    topPick: top ? brief(top) : undefined,
    alternatives: alts.map(brief),
  }
}
