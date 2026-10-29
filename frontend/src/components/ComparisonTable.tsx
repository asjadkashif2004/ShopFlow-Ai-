import { Check, Minus } from 'lucide-react'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import type { Category, Recommendation } from '../api/types'
import { cn, formatPrice, formatSpec } from '../lib/format'
import { fadeUp } from '../lib/motion'
import { ProductVisual } from './ui'

/** Indices holding the best value, or none when every value is equal. */
function bestIndices(values: Array<number | null>, better: 'higher' | 'lower'): number[] {
  const nums = values.filter((v): v is number => v !== null)
  if (nums.length < 2 || nums.every((v) => v === nums[0])) return []
  const target = better === 'higher' ? Math.max(...nums) : Math.min(...nums)
  return values.flatMap((v, i) => (v === target ? [i] : []))
}

export function ComparisonTable({ recs, category }: { recs: Recommendation[]; category: Category }) {
  const rows: Array<{ label: string; cells: ReactNode[]; best: number[] }> = [
    {
      label: 'Price',
      cells: recs.map((r) => formatPrice(r.product.price)),
      best: bestIndices(recs.map((r) => r.product.price), 'lower'),
    },
    {
      label: 'Rating',
      cells: recs.map((r) => `${r.product.rating.toFixed(1)}★`),
      best: bestIndices(recs.map((r) => r.product.rating), 'higher'),
    },
    {
      label: 'Match score',
      cells: recs.map((r) => `${r.score}/100`),
      best: bestIndices(recs.map((r) => r.score), 'higher'),
    },
    ...category.specs.map((def) => {
      const values = recs.map((r) => r.product.specs[def.key])
      const cells = values.map((v) =>
        def.type === 'bool' ? (
          v ? (
            <Check aria-label="Yes" className="size-4 text-emerald-500" strokeWidth={2.5} />
          ) : (
            <Minus aria-label="No" className="size-4 text-slate-300" />
          )
        ) : (
          formatSpec(def, v)
        ),
      )
      const best = def.better ? bestIndices(values.map((v) => (typeof v === 'number' ? v : null)), def.better) : []
      return { label: def.label, cells, best }
    }),
  ]

  return (
    <motion.section variants={fadeUp} className="overflow-hidden rounded-2xl bg-white shadow-soft ring-1 ring-slate-200/80">
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <h3 className="text-[15px] font-semibold tracking-tight text-ink-900">Side by side</h3>
        <span className="flex items-center gap-1.5 text-xs text-slate-400">
          <span className="size-1.5 rounded-full bg-emerald-400" />
          Best in row
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-sm">
          <thead>
            <tr className="border-y border-slate-100 bg-slate-50/70">
              <th scope="col" className="w-36 px-5 py-3 text-left text-xs font-medium text-slate-400">
                Spec
              </th>
              {recs.map((r) => (
                <th key={r.product.id} scope="col" className="px-4 py-3 text-left">
                  <div className="flex items-center gap-2.5">
                    <ProductVisual category={r.product.category} size="xs" className="size-8 shrink-0 rounded-lg" />
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium text-slate-400">#{r.rank}</div>
                      <div className="max-w-[10rem] truncate font-semibold text-ink-900" title={r.product.name}>
                        {r.product.name}
                      </div>
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-slate-100 last:border-0">
                <th scope="row" className="px-5 py-2.5 text-left font-normal text-slate-500">
                  {row.label}
                </th>
                {row.cells.map((cell, i) => {
                  const best = row.best.includes(i)
                  return (
                    <td key={i} className={cn('px-4 py-2.5 tabular-nums', best ? 'font-semibold text-emerald-700' : 'text-slate-700')}>
                      <span className="inline-flex items-center gap-1.5">
                        {best && <span aria-hidden className="size-1.5 rounded-full bg-emerald-400" />}
                        {cell}
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.section>
  )
}
