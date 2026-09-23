import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { useAsync } from '../../lib/useAsync'
import { listAllItemsForAdmin, listAssetTypes, listAssets, listCategories } from '../../lib/api'
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

/** ป้ายหนึ่งดวง ไม่ว่าจะมาจากวัสดุหรือเครื่อง */
interface Label {
  key: string
  /** ค่าที่เข้ารหัสลง QR */
  payload: string
  title: string
  /** บรรทัดรหัสใต้ชื่อ */
  code: string
  /** ป้ายเหลืองท้ายดวง เช่น ชั้นวางหรือแผนก */
  tag: string | null
  note: string
}

function QrCell({ label, size }: { label: Label; size: Size }) {
  const [src, setSrc] = useState<string | null>(null)
  const cfg = SIZES[size]

  useEffect(() => {
    let alive = true
    QRCode.toDataURL(label.payload, {
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
  }, [label.payload, cfg.qr])

  return (
    <div className="qr-label flex break-inside-avoid flex-col items-center rounded-card border border-line bg-white p-2 text-center">
      {src ? (
        <img src={src} alt={`QR ${label.code}`} className="h-auto w-full" />
      ) : (
        <div className="aspect-square w-full bg-surface-2" />
      )}
      <p className="mt-1 w-full truncate font-display text-[11px] font-semibold leading-tight text-ink">
        {label.title}
      </p>
      <p className="w-full truncate font-mono text-[9px] leading-tight text-ink-500">{label.code}</p>
      {label.tag && (
        <p className="mt-[2px] rounded bg-brand-500 px-2 font-display text-[11px] font-semibold leading-tight text-ink">
          {label.tag}
        </p>
      )}
    </div>
  )
}

export default function QrLabels() {
  const items = useAsync(() => listAllItemsForAdmin(), [])
  const cats = useAsync(() => listCategories(), [])
  const assets = useAsync(() => listAssets(), [])
  const types = useAsync(() => listAssetTypes(), [])

  const [mode, setMode] = useState<'items' | 'assets' | 'set'>('items')
  const [setName, setSetName] = useState('')
  const [size, setSize] = useState<Size>('md')
  const [cat, setCat] = useState<number | null>(null)
  const [typeCode, setTypeCode] = useState('')
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const pool = useMemo<Label[]>(() => {
    const q = search.trim().toLowerCase()

    if (mode === 'assets' || mode === 'set') {
      // QR ของเครื่องเก็บรหัสเครื่องตรง ๆ ตรงกับที่หน้าเบิกใช้ค้นหา
      return (assets.data ?? [])
        .filter((a) => {
          if (typeCode && a.type_code !== typeCode) return false
          if (q && !`${a.code} ${a.dept_code ?? ''}`.toLowerCase().includes(q)) return false
          return true
        })
        .map((a) => ({
          key: `a:${a.code}`,
          payload: a.code,
          title: a.asset_types?.name ?? a.type_code,
          code: a.code,
          tag: a.dept_code && a.dept_code !== 'ALL' ? a.dept_code : 'ส่วนกลาง',
          note: a.is_enabled ? 'เปิดให้เบิก' : 'ปิดซ่อม',
        }))
    }

    return (items.data ?? [])
      .filter((i) => {
        if (!i.is_active) return false
        if (cat && i.category_id !== cat) return false
        if (q && !`${i.name} ${i.sku} ${i.shelf_code ?? ''}`.toLowerCase().includes(q)) return false
        return true
      })
      .map((i) => ({
        key: `i:${i.id}`,
        payload: payloadOf(i),
        title: i.name,
        code: i.sku,
        tag: i.shelf_code,
        note: i.qr_payload ? 'มีรหัส QR เอง' : 'ใช้ SKU',
      }))
  }, [mode, items.data, assets.data, cat, typeCode, search])

  const chosen = useMemo(() => pool.filter((l) => picked.has(l.key)), [pool, picked])

  /**
   * ป้ายชุดรวม — หนึ่งดวงเก็บรหัสเครื่องทั้งชุด
   * สแกนทีเดียวติ๊กให้ครบ ไม่ต้องไล่สแกนทีละเครื่อง
   * รูปแบบ BPLSET:ชื่อชุด|รหัส1|รหัส2|… หน้าเบิกอ่านรูปแบบนี้เป็น
   */
  const setLabel = useMemo<Label | null>(() => {
    if (mode !== 'set' || chosen.length === 0) return null
    const name = setName.trim() || `ชุด ${chosen.length} เครื่อง`
    return {
      key: 'set',
      payload: [`BPLSET:${name}`, ...chosen.map((l) => l.code)].join('|'),
      title: name,
      code: `${chosen.length} เครื่อง`,
      tag: chosen[0]?.title ?? null,
      note: 'ชุดรวม',
    }
  }, [mode, chosen, setName])

  function toggle(key: string) {
    setPicked((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
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
          <h1 className="font-display text-lg">พิมพ์ QR</h1>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setPicked(new Set(pool.map((l) => l.key)))}
            >
              เลือกทั้งหมด ({pool.length})
            </button>
            <button type="button" className="btn-ghost" onClick={() => setPicked(new Set())}>
              ล้าง
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={mode === 'set' ? !setLabel : chosen.length === 0}
              onClick={() => window.print()}
            >
              พิมพ์ {mode === 'set' ? (setLabel ? 1 : 0) : chosen.length} ดวง
            </button>
          </div>
        </div>

        <p className="mb-4 rounded-card bg-brand-50 px-3 py-2 text-sm text-warn-txt">
          {mode === 'assets'
            ? 'QR ของเครื่องเก็บรหัสเครื่องตรง ๆ สแกนที่หน้าเบิกแล้วติ๊กเครื่องนั้นให้ทันที'
            : 'QR เก็บค่าเดียวกับที่หน้าสแกนใช้ค้นหา (ช่องรหัสใน QR ถ้าเว้นว่างจะใช้ SKU แทน)'}
          <br />
          แนะนำพิมพ์ลงสติกเกอร์แล้วเคลือบใสทับ กันน้ำกันฝุ่นในคลัง · ถ้าสแกนไม่ติดให้พิมพ์ขนาดใหญ่ขึ้น
        </p>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`chip ${mode === 'items' ? 'chip-on' : ''}`}
            onClick={() => {
              setMode('items')
              setPicked(new Set())
            }}
          >
            วัสดุสิ้นเปลือง
          </button>
          <button
            type="button"
            className={`chip ${mode === 'assets' ? 'chip-on' : ''}`}
            onClick={() => {
              setMode('assets')
              setPicked(new Set())
            }}
          >
            เครื่อง Asset
          </button>
          <button
            type="button"
            className={`chip ${mode === 'set' ? 'chip-on' : ''}`}
            onClick={() => {
              setMode('set')
              setPicked(new Set())
            }}
          >
            QR ชุดรวม
          </button>
          <span className="mx-1 h-6 w-px bg-line-2" />
          <input
            className="input max-w-[280px]"
            type="search"
            placeholder={mode === 'assets' ? 'ค้นหารหัสเครื่อง' : 'ค้นหาชื่อ SKU ชั้นวาง'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {mode === 'items' ? (
            <select
              className="input h-tap max-w-[200px]"
              value={cat ?? ''}
              aria-label="หมวด"
              onChange={(e) => setCat(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">ทุกหมวด</option>
              {(cats.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <select
              className="input h-tap max-w-[200px]"
              value={typeCode}
              aria-label="ประเภทเครื่อง"
              onChange={(e) => setTypeCode(e.target.value)}
            >
              <option value="">ทุกประเภท</option>
              {(types.data ?? []).map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
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

        {mode === 'set' && (
          <div className="mb-3 rounded-card border border-brand-300 bg-brand-50 p-3">
            <p className="font-display">QR ชุดรวม</p>
            <p className="mt-1 text-sm text-warn-txt">
              ติ๊กเครื่องที่หยิบไปด้วยกันประจำ แล้วพิมพ์ป้ายเดียว หน้างานสแกนทีเดียวติ๊กครบทั้งชุด
              ไม่ต้องไล่ทีละเครื่อง
              <br />
              ถ้าเครื่องในชุดไม่ว่าง ระบบจะติ๊กเฉพาะตัวที่ว่าง แล้วบอกว่าตัวไหนติดอยู่กับใคร
            </p>
            <label className="label mt-3" htmlFor="set-name">
              ชื่อชุด
            </label>
            <input
              id="set-name"
              className="input max-w-[320px]"
              placeholder="เช่น ชุดประจำ BULKY กะเช้า"
              value={setName}
              onChange={(e) => setSetName(e.target.value)}
            />
          </div>
        )}

        {(items.loading || assets.loading) && <Loading />}
        {items.error && <ErrorBox message={items.error} onRetry={items.reload} />}
        {assets.error && <ErrorBox message={assets.error} onRetry={assets.reload} />}

        <section className="panel mb-4 max-h-[320px] overflow-y-auto p-2">
          <table className="w-full text-left text-sm">
            <tbody>
              {pool.map((l) => (
                <tr key={l.key} className="border-b border-line last:border-0">
                  <td className="w-10 p-2">
                    <input
                      type="checkbox"
                      aria-label={`เลือก ${l.code}`}
                      className="h-5 w-5 accent-[var(--yellow-500)]"
                      checked={picked.has(l.key)}
                      onChange={() => toggle(l.key)}
                    />
                  </td>
                  <td className="p-2">{l.title}</td>
                  <td className="p-2 font-mono text-xs text-ink-400">{l.code}</td>
                  <td className="p-2 font-mono text-xs">{l.tag ?? '—'}</td>
                  <td className="p-2 font-mono text-xs text-ink-400">{l.note}</td>
                </tr>
              ))}
              {!items.loading && pool.length === 0 && (
                <tr>
                  <td className="py-6 text-center text-ink-400">ไม่พบรายการตามเงื่อนไข</td>
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
            ติ๊กเลือกด้านบนก่อน แล้วป้ายจะขึ้นตรงนี้
          </p>
        )}
      </div>

      <div className={`print-sheet grid gap-2 ${SIZES[size].cols}`}>
        {mode === 'set'
          ? setLabel && <QrCell key="set" label={setLabel} size={size} />
          : chosen.map((l) => <QrCell key={l.key} label={l} size={size} />)}
      </div>
    </div>
  )
}
