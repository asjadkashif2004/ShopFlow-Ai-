import { Headphones, Keyboard, Laptop, Monitor, Mouse, Package, Watch, type LucideIcon } from 'lucide-react'

export interface CategoryMeta {
  Icon: LucideIcon
  /** Gradient stops for the product tile (use with bg-linear-to-br). */
  tile: string
  /** Icon color on the tile. */
  ink: string
  /** Small tinted badge. */
  soft: string
}

const META: Record<string, CategoryMeta> = {
  headphones: { Icon: Headphones, tile: 'from-violet-100 via-white to-indigo-100', ink: 'text-violet-500', soft: 'bg-violet-50 text-violet-600' },
  mice: { Icon: Mouse, tile: 'from-sky-100 via-white to-cyan-100', ink: 'text-sky-500', soft: 'bg-sky-50 text-sky-600' },
  keyboards: { Icon: Keyboard, tile: 'from-amber-100 via-white to-orange-100', ink: 'text-amber-500', soft: 'bg-amber-50 text-amber-600' },
  monitors: { Icon: Monitor, tile: 'from-emerald-100 via-white to-teal-100', ink: 'text-emerald-500', soft: 'bg-emerald-50 text-emerald-600' },
  smartwatches: { Icon: Watch, tile: 'from-rose-100 via-white to-pink-100', ink: 'text-rose-500', soft: 'bg-rose-50 text-rose-600' },
  laptops: { Icon: Laptop, tile: 'from-slate-200 via-white to-blue-100', ink: 'text-slate-500', soft: 'bg-slate-100 text-slate-600' },
}

const FALLBACK: CategoryMeta = { Icon: Package, tile: 'from-slate-100 via-white to-slate-200', ink: 'text-slate-400', soft: 'bg-slate-100 text-slate-600' }

export const metaFor = (slug: string | null | undefined): CategoryMeta => (slug && META[slug]) || FALLBACK
