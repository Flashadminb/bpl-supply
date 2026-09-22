import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CartLine, Item } from './types'

const KEY = 'bpl.cart.v1'

interface CartValue {
  lines: CartLine[]
  purpose: string
  note: string
  count: number
  units: number
  setPurpose: (v: string) => void
  setNote: (v: string) => void
  add: (item: Item, qty?: number) => void
  setQty: (itemId: number, qty: number) => void
  remove: (itemId: number) => void
  clear: () => void
  qtyOf: (itemId: number) => number
}

const Ctx = createContext<CartValue | null>(null)

interface Persisted {
  lines: CartLine[]
  purpose: string
  note: string
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { lines: [], purpose: '', note: '' }
    const parsed = JSON.parse(raw) as Partial<Persisted>
    return {
      lines: Array.isArray(parsed.lines) ? parsed.lines : [],
      purpose: parsed.purpose ?? '',
      note: parsed.note ?? '',
    }
  } catch {
    return { lines: [], purpose: '', note: '' }
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Persisted>(load)

  // ปิดแอปแล้วเปิดใหม่ตะกร้าต้องยังอยู่
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      /* โควตาเต็ม — ไม่ใช่เรื่องคอขาดบาดตาย */
    }
  }, [state])

  const add = useCallback((item: Item, qty = 1) => {
    setState((s) => {
      const found = s.lines.find((l) => l.item_id === item.id)
      const next = found
        ? s.lines.map((l) =>
            l.item_id === item.id ? { ...l, qty: Math.min(l.qty + qty, item.qty_on_hand) } : l,
          )
        : [
            ...s.lines,
            {
              item_id: item.id,
              sku: item.sku,
              name: item.name,
              unit: item.unit,
              shelf_code: item.shelf_code,
              qty_on_hand: item.qty_on_hand,
              is_returnable: item.is_returnable,
              requires_approval: item.requires_approval,
              qty: Math.min(qty, item.qty_on_hand),
            } satisfies CartLine,
          ]
      return { ...s, lines: next }
    })
  }, [])

  const setQty = useCallback((itemId: number, qty: number) => {
    setState((s) => ({
      ...s,
      lines:
        qty <= 0
          ? s.lines.filter((l) => l.item_id !== itemId)
          : s.lines.map((l) =>
              l.item_id === itemId ? { ...l, qty: Math.min(qty, l.qty_on_hand) } : l,
            ),
    }))
  }, [])

  const value = useMemo<CartValue>(() => {
    const count = state.lines.length
    const units = state.lines.reduce((n, l) => n + l.qty, 0)
    return {
      lines: state.lines,
      purpose: state.purpose,
      note: state.note,
      count,
      units,
      setPurpose: (v) => setState((s) => ({ ...s, purpose: v })),
      setNote: (v) => setState((s) => ({ ...s, note: v })),
      add,
      setQty,
      remove: (itemId) => setState((s) => ({ ...s, lines: s.lines.filter((l) => l.item_id !== itemId) })),
      clear: () => setState({ lines: [], purpose: '', note: '' }),
      qtyOf: (itemId) => state.lines.find((l) => l.item_id === itemId)?.qty ?? 0,
    }
  }, [state, add, setQty])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useCart(): CartValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useCart ต้องอยู่ภายใน CartProvider')
  return v
}
