import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { useAsync } from '../../lib/useAsync'
import { listAllItemsForAdmin, listCategories } from '../../lib/api'
import { ErrorBox, Loading } from '../../components/ui'
import type { Item } from '../../lib/types'

type Size = 'sm' | 'md' | 'lg'

const SIZES: Record<Size, { label: string; mm: number; cols: string; qr: number }> = {
  sm: { label: 'เล็ก · 8 ดวงต่อแถว', mm: 32, cols: 'grid-cols-8', qr: 128 },
  md: { label: 'กลาง · 5 ดวงต่อแถว', mm: 50, cols: 'grid-cols-5', qr: 192 },
  lg: { label: 'ใหญ่ · 3 ดวงต่อแถว', mm: 80, cols: 'grid-cols-3', qr: 256 },
}

/** ค่าที่เข้ารหัสใน QR — ใช้ qr_payload ถ้ามี ไม่มีก็ใช้ SKU ตรงกับที่หน้าสแกนค้นหา */
const payloadOf = (i: Item) => i.qr_payload || i.sku

function QrCell({ item, size }: { item: Item; size: Size }) {
  const [src, setSrc] = useState<string | null>(null)
  const cfg = SIZES[size]

  useEffect(() => {
    let alive = true
    QRCode.toDataURL(payloadOf(item), {
      width: cfg.qr,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#1A1712', light: '#FFFFFF' },
    })
      .then((d) => alive && setSrc(d))
      .catch(() => alive && setSrc(null))
    return () => {
      alive = false
    }
  }, [item.id, cfg.qr])

  return (
    <div className="qr-label flex break-inside-avoid flex-col items-center rounded-card border border-line bg-white p-2 text-center">
      {src ? (
        <img src={src} alt={`QR ${item.sku}`} className="h-auto w-full" />
      ) : (
        <div className="aspect-square w-full bg-surface-2" />
      )}
      <p className="mt-1 w-full truncate font-display text-[11px] font-semibold leading-tight text-ink">
        {item.name}
      </p>
      <p className="w-full truncate font-mono text-[9px] leading-tight text-ink-500">{item.sku}</p>
      {item.shelf_code && (
        <p className="mt-[2px] rounded bg-brand-500 px-2 font-display text-[11px] font-semibold leading-tight text-ink">
          {item.shelf_code}
        </p>
      )}
    </div>
  )
}

export default function QrLabels() {
  const items = useAsync(() => listAllItemsForAdmin(), [])
  const cats = useAsync(() => listCategories(), [])

  const [size, setSize] = useState<Size>('md')
  const [cat, setCat] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<number>>(new Set())

  const pool = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (items.data ?? []).filter((i) => {
      if (!i.is_active) return false
      if (cat && i.category_id !== cat) return false
      if (s && !`${i.name} ${i.sku} ${i.shelf_code ?? ''}`.toLowerCase().includes(s)) return false
      return true
    })
  }, [items.data, cat, search])

  const chosen = useMemo(() => pool.filter((i) => picked.has(i.id)), [pool, picked])

  function toggle(id: number) {
    setPicked((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="mx-auto max-w-[1180px]">
      {/* ตอนสั่งพิมพ์ ซ่อนทุกอย่างยกเว้นแผ่นป้าย */}
      <style>{`
        @media print {
          body { background: #fff; }
          .no-print, aside, header, nav { display: none !important; }
          .print-sheet { padding: 0 !important; border: 0 !important; }
          .qr-label { border: 1px solid #999 !important; page-break-inside: avoid; }
          @page { margin: 8mm; }
        }
      `}</style>

      <div className="no-print">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-lg">พิมพ์ QR ติดชั้นวาง</h1>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setPicked(new Set(pool.map((i) => i.id)))}
            >
              เลือกทั้งหมด ({pool.length})
            </button>
            <button type="button" className="btn-ghost" onClick={() => setPicked(new Set())}>
              ล้าง
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={chosen.length === 0}
              onClick={() => window.print()}
            >
              พิมพ์ {chosen.length} ดวง
            </button>
          </div>
        </div>

        <p className="mb-4 rounded-card bg-brand-50 px-3 py-2 text-sm text-warn-txt">
          QR เก็บค่าเดียวกับที่หน้าสแกนใช้ค้นหา (ช่อง <b>รหัสใน QR</b> ถ้าเว้นว่างจะใช้ SKU แทน)
          <br />
          แนะนำพิมพ์ลงสติกเกอร์แล้วเคลือบใสทับ กันน้ำกันฝุ่นในคลัง · ถ้าสแกนไม่ติดให้พิมพ์ขนาดใหญ่ขึ้น
        </p>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            className="input max-w-[280px]"
            type="search"
            placeholder="ค้นหาชื่อ SKU ชั้นวาง"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="input h-tap max-w-[200px]"
            value={cat ?? ''}
            onChange={(e) => setCat(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">ทุกหมวด</option>
            {(cats.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="mx-1 h-6 w-px bg-line-2" />
          {(Object.keys(SIZES) as Size[]).map((k) => (
            <button
              key={k}
              type="button"
              className={`chip ${size === k ? 'chip-on' : ''}`}
              onClick={() => setSize(k)}
            >
              {SIZES[k].label}
            </button>
          ))}
        </div>

        {items.loading && <Loading />}
        {items.error && <ErrorBox message={items.error} onRetry={items.reload} />}

        <section className="panel mb-4 max-h-[320px] overflow-y-auto p-2">
          <table className="w-full text-left text-sm">
            <tbody>
              {pool.map((i) => (
                <tr key={i.id} className="border-b border-line last:border-0">
                  <td className="w-10 p-2">
                    <input
                      type="checkbox"
                      aria-label={`เลือก ${i.name}`}
                      className="h-5 w-5 accent-[var(--yellow-500)]"
                      checked={picked.has(i.id)}
                      onChange={() => toggle(i.id)}
                    />
                  </td>
                  <td className="p-2">{i.name}</td>
                  <td className="p-2 font-mono text-xs text-ink-400">{i.sku}</td>
                  <td className="p-2 font-mono text-xs">{i.shelf_code ?? '—'}</td>
                  <td className="p-2 font-mono text-xs text-ink-400">
                    {i.qr_payload ? 'มีรหัส QR เอง' : 'ใช้ SKU'}
                  </td>
                </tr>
              ))}
              {!items.loading && pool.length === 0 && (
                <tr>
                  <td className="py-6 text-center text-ink-400">ไม่พบวัสดุตามเงื่อนไข</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <h2 className="mb-2 font-display text-md">
          ตัวอย่างก่อนพิมพ์ {chosen.length > 0 && <span className="text-ink-400">({chosen.length} ดวง)</span>}
        </h2>
        {chosen.length === 0 && (
          <p className="mb-4 rounded-card border border-dashed border-line-2 p-6 text-center text-sm text-ink-400">
            ติ๊กเลือกวัสดุด้านบนก่อน แล้วป้ายจะขึ้นตรงนี้
          </p>
        )}
      </div>

      <div className={`print-sheet grid gap-2 ${SIZES[size].cols}`}>
        {chosen.map((i) => (
          <QrCell key={i.id} item={i} size={size} />
        ))}
      </div>
    </div>
  )
}
