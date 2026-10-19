// Click-to-sort table headers shared by the scheduler tables

import { ReactNode, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import HelpTip from './HelpTip'

export type SortValue = string | number | null | undefined
export type SortAccessors<T, K extends string> = Record<K, (row: T) => SortValue>

export interface SortState<K extends string> {
  key: K
  desc: boolean
}

function compare(a: SortValue, b: SortValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

export function useSortedRows<T, K extends string>(rows: T[], accessors: SortAccessors<T, K>, initial: SortState<K>) {
  const [sort, setSort] = useState<SortState<K>>(initial)

  const sorted = useMemo(() => {
    const get = accessors[sort.key]
    const empty = (v: SortValue) => v === null || v === undefined || v === ''
    return [...rows].sort((ra, rb) => {
      const a = get(ra)
      const b = get(rb)
      // Empty values stay at the bottom in both directions
      if (empty(a) || empty(b)) return Number(empty(a)) - Number(empty(b))
      return sort.desc ? compare(b, a) : compare(a, b)
    })
  }, [rows, accessors, sort])

  // First click on a new column sorts ascending; clicking again flips the direction
  const toggle = (key: K) => setSort(prev => ({ key, desc: prev.key === key ? !prev.desc : false }))

  return { sorted, sort, toggle }
}

interface SortHeaderProps<K extends string> {
  column: K
  sort: SortState<K>
  onSort: (key: K) => void
  children: ReactNode
  help?: string
}

export function SortHeader<K extends string>({ column, sort, onSort, children, help }: SortHeaderProps<K>) {
  const active = sort.key === column
  return (
    <th className={`sortable ${active ? 'sorted' : ''}`} onClick={() => onSort(column)}>
      {children}
      {help && <HelpTip text={help} />}
      {active && (sort.desc ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
    </th>
  )
}
