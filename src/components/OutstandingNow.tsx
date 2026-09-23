import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AssetHolding, OpenBorrowing } from '../lib/types'
import { fmtDateTime, relativeAge } from '../lib/format'

/**
 * ตอนนี้มีอะไรออกไปแล้วยังไม่กลับมาบ้าง
 *
 * รวมสองฝั่งไว้ที่เดียวเพราะคำถามหน้างานเป็นคำถามเดียวกัน
 * "ของหายไปไหน ใครถืออยู่" — แต่ติดป้ายแยกไว้ให้รู้ว่าคนละระบบ
 *
 * เรียงของที่เลยเวลามาก่อน แล้วค่อยไล่ตามอายุ
 * กดแถวไหนก็เด้งไปหน้าที่กดคืนแทนได้
 */

type Row = {
  key: string
  kind: 'asset' | 'item'
  to: string
  title: string
  who: string
  sub: string
  since: string
  late: boolean
  lateBy: string | null
  sortAt: number
}

/** ของยืม-คืนฝั่งสิ้นเปลืองไม่มีเวลาคืนตายตัว ถือว่าเกินเมื่อข้ามสองกะ */
const LATE_HOURS = 18

function gap(from: number, to: number): string {
  const mins = Math.max(0, Math.round((to - from) / 60000))
  if (mins < 60) return `${mins} นาที`
  const h = mins / 60
  return h < 24 ? `${h.toFixed(1)} ชม.` : `${Math.floor(h / 24)} วัน`
}

export function OutstandingNow({
  holdings,
  borrowings,
}: {
  holdings: AssetHolding[]
  borrowings: OpenBorrowing[]
}) {
  const [tab, setTab] = useState<'all' | 'asset' | 'item'>('all')
  const now = Date.now()

  const rows = useMemo(() => {
    const out: Row[] = []

    for (const h of holdings) {
      const due = h.due_at ? Date.parse(h.due_at) : null
      const late = due !== null && now > due
      out.push({
        key: `a-${h.out_item_id}`,
        kind: 'asset',
        to: '/admin/assets-out',
        title: `${h.asset_code} · ${h.type_name}`,
        who: h.holder_name,
        sub: [h.holder_code, h.holder_dept, h.holder_sub_dept].filter(Boolean).join(' · '),
        since: `เบิก ${fmtDateTime(h.taken_at)}`,
        late,
        lateBy: late && due !== null ? gap(due, now) : null,
        sortAt: Date.parse(h.taken_at),
      })
    }

    for (const b of borrowings) {
      const took = Date.parse(b.created_at)
      const late = now - took >= LATE_HOURS * 3600_000
      out.push({
        key: `i-${b.requisition_item_id}`,
        kind: 'item',
        to: '/admin/outstanding',
        title: `${b.item_name} ${b.qty_open} ${b.unit}`,
        who: b.requester_name,
        sub: [b.requester_code, b.requester_dept, b.ref_no].filter(Boolean).join(' · '),
        since: `เบิก ${fmtDateTime(b.created_at)} · ${relativeAge(b.created_at)}`,
        late,
        lateBy: late ? gap(took + LATE_HOURS * 3600_000, now) : null,
        sortAt: took,
      })
    }

    return out
      .filter((r) => (tab === 'all' ? true : r.kind === tab))
      .sort((a, b) => Number(b.late) - Number(a.late) || a.sortAt - b.sortAt)
  }, [holdings, borrowings, tab, now])

  const lateCount = rows.filter((r) => r.late).length

  return (
    <section className="panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-md">ตอนนี้ยังไม่ได้คืน</h2>
          <span aria-hidden className="mt-1 block h-[3px] w-10 rounded-pill bg-accent-500" />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`chip ${tab === 'all' ? 'chip-on' : ''}`}
            onClick={() => setTab('all')}
          >
            ทั้งหมด {holdings.length + borrowings.length}
          </button>
          <button
            type="button"
            className={`chip ${tab === 'asset' ? 'chip-on' : ''}`}
            onClick={() => setTab('asset')}
          >
            Asset {holdings.length}
          </button>
          <button
            type="button"
            className={`chip ${tab === 'item' ? 'chip-on' : ''}`}
            onClick={() => setTab('item')}
          >
            สิ้นเปลือง {borrowings.length}
          </button>
        </div>
      </div>

      {lateCount > 0 && (
        <p className="mb-2 rounded-btn bg-danger-bg px-3 py-2 text-sm text-danger-txt">
          เลยเวลาแล้ว {lateCount} รายการ — กดที่แถวเพื่อไปตามหรือคืนแทน
        </p>
      )}

      <ul className="max-h-[440px] space-y-[6px] overflow-y-auto pr-1">
        {rows.map((r) => (
          <li key={r.key}>
            <Link
              to={r.to}
              className={`block rounded-card border px-3 py-2 ${
                r.late
                  ? 'border-danger/25 bg-danger-bg hover:brightness-95'
                  : 'border-line bg-surface hover:bg-surface-2'
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="min-w-0 truncate font-display text-base">{r.title}</span>
                <span className={`shrink-0 text-xs ${r.kind === 'asset' ? 'badge-warn' : 'badge-mute'}`}>
                  {r.kind === 'asset' ? 'Asset' : 'สิ้นเปลือง'}
                </span>
              </div>
              <p className="truncate text-sm">
                {r.who}
                {r.sub && <span className="text-ink-400"> · {r.sub}</span>}
              </p>
              <p className={`text-xs ${r.late ? 'text-danger-txt' : 'text-ink-400'}`}>
                {r.since}
                {r.lateBy && ` · เลยมาแล้ว ${r.lateBy}`}
              </p>
            </Link>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="rounded-card bg-success-bg px-3 py-6 text-center text-sm text-success-txt">
            คืนครบแล้ว ไม่มีของค้างอยู่ข้างนอก
          </li>
        )}
      </ul>
    </section>
  )
}
