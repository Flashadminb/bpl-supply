import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Item } from '../lib/types'

/**
 * รายการสิ้นเปลืองทั้งหมด เรียงจากเหลือน้อยไปมาก
 *
 * ปลอกสีบอกสถานะโดยไม่ต้องอ่านตัวเลข
 *   เหลือเยอะ  เขียวจาง ๆ ปลอกยาว
 *   เริ่มน้อย   เหลือง แล้วส้ม สีเข้มขึ้นเรื่อย ๆ
 *   ต่ำ/หมด    แดงทึบ ปลอกสั้น
 *
 * เทียบกับจุดสั่งซื้อของแต่ละตัว ไม่ได้เทียบกันเอง
 * เพราะกระดาษ 30 รีมกับถุงมือ 30 คู่ ไม่ได้แปลว่าพอเท่ากัน
 */

/** อัตราส่วนต่อจุดสั่งซื้อ — 1.0 คือเท่าจุดสั่งซื้อพอดี */
function ratioOf(i: Item): number {
  const min = Math.max(i.min_qty, 1)
  return i.qty_on_hand / min
}

function look(i: Item): { bar: string; text: string; label: string } {
  if (i.qty_on_hand === 0) {
    return { bar: '#B42318', text: 'text-danger-txt', label: 'หมดแล้ว' }
  }
  const r = ratioOf(i)
  if (r <= 0.5) return { bar: '#D4472F', text: 'text-danger-txt', label: 'ต่ำมาก' }
  if (r <= 1) return { bar: '#EB6834', text: 'text-danger-txt', label: 'ถึงจุดสั่งซื้อ' }
  if (r <= 1.5) return { bar: '#E0A008', text: 'text-warn-txt', label: 'เริ่มน้อย' }
  if (r <= 2.5) return { bar: '#7FBF52', text: 'text-ink-500', label: 'พอใช้' }
  return { bar: '#9FD6B4', text: 'text-ink-400', label: 'เหลือเยอะ' }
}

export function StockLevels({ items }: { items: Item[] }) {
  const [lowOnly, setLowOnly] = useState(false)
  const [q, setQ] = useState('')

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return items
      .filter((i) => i.is_active)
      .filter((i) => (lowOnly ? i.qty_on_hand <= i.min_qty : true))
      .filter((i) => (s ? `${i.name} ${i.sku}`.toLowerCase().includes(s) : true))
      .sort((a, b) => ratioOf(a) - ratioOf(b) || a.qty_on_hand - b.qty_on_hand)
  }, [items, lowOnly, q])

  const lowCount = items.filter((i) => i.is_active && i.qty_on_hand <= i.min_qty).length

  return (
    <section className="panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-md">สิ้นเปลืองคงเหลือ</h2>
          <span aria-hidden className="mt-1 block h-[3px] w-10 rounded-pill bg-accent-500" />
        </div>
        <Link to="/admin/stock" className="text-sm underline">
          ไปหน้าสต็อก
        </Link>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="input max-w-[220px]"
          type="search"
          placeholder="ค้นหาชื่อหรือ SKU"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          type="button"
          className={`chip ${lowOnly ? 'chip-on' : ''}`}
          onClick={() => setLowOnly((v) => !v)}
        >
          เฉพาะที่ต่ำกว่าขั้นต่ำ {lowCount > 0 ? `(${lowCount})` : ''}
        </button>
        <span className="text-sm text-ink-500">เรียงจากเหลือน้อยไปมาก · {rows.length} รายการ</span>
      </div>

      <ul className="max-h-[440px] space-y-[6px] overflow-y-auto pr-1">
        {rows.map((i) => {
          const v = look(i)
          // ปลอกยาวตามสัดส่วน ตัดที่ 3 เท่าของจุดสั่งซื้อ เพื่อให้ตัวที่เหลือเยอะมากไม่กินพื้นที่
          const width = Math.max(4, Math.min(100, (ratioOf(i) / 3) * 100))
          return (
            <li key={i.id}>
              <Link
                to="/admin/stock"
                className="block rounded-card border border-line bg-surface px-3 py-2 hover:bg-surface-2"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-base">{i.name}</span>
                  <span className={`shrink-0 font-display ${v.text}`}>
                    {i.qty_on_hand} {i.unit}
                  </span>
                </div>
                <div className="mt-1 h-[6px] w-full overflow-hidden rounded-pill bg-line">
                  <span
                    aria-hidden
                    className="block h-full rounded-pill"
                    style={{ width: `${width}%`, background: v.bar }}
                  />
                </div>
                <div className="mt-[3px] flex justify-between gap-2 text-xs text-ink-400">
                  <span className="truncate font-mono">{i.sku}</span>
                  <span className={v.text}>
                    {v.label} · ขั้นต่ำ {i.min_qty}
                  </span>
                </div>
              </Link>
            </li>
          )
        })}
        {rows.length === 0 && (
          <li className="py-6 text-center text-sm text-ink-400">ไม่พบรายการตามเงื่อนไข</li>
        )}
      </ul>
    </section>
  )
}
