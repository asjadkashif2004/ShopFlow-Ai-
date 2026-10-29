import type { SpecDef, SpecValue } from '../api/types'

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

/** $79.99 */
export const formatPrice = (n: number) => usd.format(n)

/** $100 for whole numbers, $79.99 otherwise. */
export const formatBudget = (n: number) =>
  Number.isInteger(n) ? `$${n.toLocaleString('en-US')}` : usd.format(n)

export const formatCount = (n: number) => n.toLocaleString('en-US')

export function formatSpec(def: SpecDef, v: SpecValue | undefined): string {
  if (v === null || v === undefined) return '—'
  if (def.type === 'bool') return v ? 'Yes' : 'No'
  if (typeof v === 'number') {
    if (def.key === 'storageGb') return v >= 1000 ? `${v / 1000} TB` : `${v} GB`
    const num = v >= 10000 ? v.toLocaleString('en-US') : String(v)
    if (!def.unit) return num
    if (def.unit === '"') return `${num}"`
    return `${num} ${def.unit}`
  }
  return String(v)
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** "a", "a and b", "a, b and c" */
export function joinList(items: string[]) {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** Lowercase the first letter unless the word is an acronym like "USB-C" or "OLED". */
export function lowerFirst(s: string) {
  return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s
}

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}
