import { useMemo, useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import { listOpenBorrowings } from '../../lib/api'
import { EmptyState, ErrorBox, Loading } from '../../components/ui'
import { fmtDateTime, relativeAge } from '../../lib/format'
import type { OpenBorrowing } from '../../lib/types'

/** เกินกี่ชั่วโมงถึงถือว่าค้างนานผิดปกติ — 1 กะทำงานคือ 9 ชั่วโมง */
const SHIFT_HOURS = 9
const LATE_HOURS = SHIFT_HOURS * 2

const hoursSince = (iso: string) => (Date.now() - Date.parse(iso)) / 3_600_000

type SortKey = 'oldest' | 'newest' | 'person' | 'item'

export default function Outstanding() {
  const feed = useAsync(() => listOpenBorrowings(false), [])
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('oldest')
  const [lateOnly, setLateOnly] = useState(false)

  const all = feed.data ?? []

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    const out = all.filter((b) => {
      if (lateOnly && hoursSince(b.created_at) < LATE_HOURS) return false
      if (!s) return true
      return `${b.item_name} ${b.sku} ${b.ref_no} ${b.requester_name} ${b.requester_code}`.toLowerCase().includes(s)
    })
    const by: Record<SortKey, (a: OpenBorrowing, b: OpenBorrowing) => number> = {
      oldest: (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
      newest: (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
      person: (a, b) => a.requester_name.localeCompare(b.requester_name, 'th'),
      item: (a, b) => a.item_name.localeCompare(b.item_name, 'th'),
    }
    return [...out].sort(by[sort])
  }, [all, search, sort, lateOnly])

  const units = rows.reduce((n, b) => n + b.qty_open, 0)
  const late = all.filter((b) => hoursSince(b.created_at) >= LATE_HOURS)
  const oldest = [...all].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0]

  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-lg">ของค้างคืน</h1>
        <button type="button" className="btn-soft h-tap px-3 text-sm" onClick={feed.reload}>
          รีเฟรช
        </button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-card border border-line bg-surface p-4">
          <p className="text-sm text-ink-500">รายการค้าง</p>
          <p className="mt-1 font-display text-xl leading-none">{all.length}</p>
        </div>
        <div className="rounded-card border border-line bg-surface p-4">
          <p className="text-sm text-ink-500">จำนวนชิ้น</p>
          <p className="mt-1 font-display text-xl leading-none">{all.reduce((n, b) => n + b.qty_open, 0)}</p>
        </div>
        <div
          className={`rounded-card border p-4 ${
            late.length > 0 ? 'border-danger/25 bg-danger-bg' : 'border-line bg-surface'
          }`}
        >
          <p className="text-sm text-ink-500">ค้างเกิน {LATE_HOURS} ชม.</p>
          <p className="mt-1 font-display text-xl leading-none">{late.length}</p>
          <p className="mt-1 text-xs text-ink-400">ประมาณ 2 กะทำงาน</p>
        </div>
        <div className="rounded-card border border-line bg-surface p-4">
          <p className="text-sm text-ink-500">ค้างนานสุด</p>
          <p className="mt-1 font-display text-xl leading-none">
            {oldest ? relativeAge(oldest.created_at) : '—'}
          </p>
          {oldest && <p className="mt-1 truncate text-xs text-ink-400">{oldest.item_name}</p>}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="input max-w-[280px]"
          type="search"
          placeholder="ค้นหาชื่อคน รหัสพนักงาน ชื่อของ หรือเลขที่"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="input h-tap max-w-[190px]"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="เรียงลำดับ"
        >
          <option value="oldest">ค้างนานสุดก่อน</option>
          <option value="newest">เพิ่งเบิกก่อน</option>
          <option value="person">เรียงตามคน</option>
          <option value="item">เรียงตามชื่อของ</option>
        </select>
        <button
          type="button"
          className={`chip ${lateOnly ? 'chip-on' : ''}`}
          onClick={() => setLateOnly((v) => !v)}
        >
          เฉพาะที่ค้างเกิน {LATE_HOURS} ชม.
        </button>
      </div>

      {feed.loading && <Loading />}
      {feed.error && <ErrorBox message={feed.error} onRetry={feed.reload} />}

      {!feed.loading && rows.length === 0 && (
        <EmptyState
          title={all.length === 0 ? 'ไม่มีของค้างคืน' : 'ไม่พบรายการตามเงื่อนไข'}
          hint={all.length === 0 ? 'ของประเภทยืม-คืนที่ยังไม่ได้คืนจะขึ้นที่นี่' : 'ลองล้างคำค้นหรือตัวกรอง'}
        />
      )}

      {rows.length > 0 && (
        <>
          <section className="panel overflow-x-auto p-2">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="text-ink-500">
                <tr className="border-b border-line">
                  <th className="p-2 font-medium">ของ</th>
                  <th className="p-2 font-medium">ผู้เบิก</th>
                  <th className="p-2 font-medium">เบิกเมื่อ</th>
                  <th className="p-2 font-medium">ค้างมาแล้ว</th>
                  <th className="p-2 font-medium">เบิก / คืนแล้ว / ค้าง</th>
                  <th className="p-2 font-medium">เลขที่</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => {
                  const hrs = hoursSince(b.created_at)
                  const isLate = hrs >= LATE_HOURS
                  return (
                    <tr
                      key={b.requisition_item_id}
                      className={`border-b border-line last:border-0 ${isLate ? 'bg-danger-bg/40' : ''}`}
                    >
                      <td className="p-2">
                        <p>{b.item_name}</p>
                        <p className="font-mono text-xs text-ink-400">
                          {b.sku}
                          {b.shelf_code ? ` · ชั้น ${b.shelf_code}` : ''}
                        </p>
                      </td>
                      <td className="p-2">
                        {b.requester_name}
                        <span className="ml-1 font-mono text-xs text-ink-400">{b.requester_code}</span>
                        {(b.requester_dept || b.requester_sub_dept) && (
                          <p className="text-xs text-ink-400">
                            {b.requester_dept}
                            {b.requester_sub_dept ? ` · ${b.requester_sub_dept}` : ''}
                          </p>
                        )}
                      </td>
                      <td className="p-2 text-ink-500">{fmtDateTime(b.created_at)}</td>
                      <td className="p-2">
                        <span className={isLate ? 'badge-dang' : hrs >= SHIFT_HOURS ? 'badge-warn' : 'badge-mute'}>
                          {relativeAge(b.created_at)}
                        </span>
                      </td>
                      <td className="p-2 font-display">
                        {b.qty_taken} / {b.qty_returned} /{' '}
                        <b className={isLate ? 'text-danger-txt' : 'text-warn-txt'}>{b.qty_open}</b> {b.unit}
                      </td>
                      <td className="p-2 font-mono text-xs">{b.ref_no}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>

          <p className="mt-2 text-sm text-ink-500">
            แสดง {rows.length} รายการ รวม {units} ชิ้น
            {lateOnly ? ' (เฉพาะที่ค้างนาน)' : ''}
          </p>
        </>
      )}

      <p className="mt-4 rounded-card bg-brand-50 px-3 py-2 text-sm text-warn-txt">
        หน้านี้เห็นของค้างของทุกคนในฮับ · รายการจะหายเองเมื่อคืนครบจำนวน
        <br />
        แถวสีแดงคือค้างเกิน {LATE_HOURS} ชั่วโมง (ประมาณ 2 กะ) — ควรตามถามเจ้าตัว
      </p>
    </div>
  )
}
