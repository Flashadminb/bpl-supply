import { useMemo, useState } from 'react'
import { listMyRequisitions } from '../../lib/api'
import { useAsync } from '../../lib/useAsync'
import { StaffPage, TopBar } from '../../components/Shell'
import { EmptyState, ErrorBox, Loading } from '../../components/ui'
import { SyncBar, syncMapFromRows } from '../../components/SyncBar'
import { STATUS_TH, dayLabel, fmtTime, statusClass } from '../../lib/format'
import type { Requisition } from '../../lib/types'

type Filter = 'all' | 'pending' | 'approved' | 'returned'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'pending', label: 'รออนุมัติ' },
  { key: 'approved', label: 'อนุมัติแล้ว' },
  { key: 'returned', label: 'ของยืม-คืน' },
]

/** ประวัติของพนักงาน — ห้ามมีลิงก์เปิดรูปหลักฐาน */
export default function History() {
  const [filter, setFilter] = useState<Filter>('all')
  const all = useAsync(() => listMyRequisitions(100), [])

  const groups = useMemo(() => {
    const rows = (all.data ?? []).filter((r) => {
      if (filter === 'pending') return r.status === 'pending'
      if (filter === 'approved') return r.status === 'approved' || r.status === 'partial'
      if (filter === 'returned') return (r.requisition_items ?? []).length > 0 && r.status !== 'rejected'
      return true
    })
    const map = new Map<string, Requisition[]>()
    for (const r of rows) {
      const k = dayLabel(r.created_at)
      const arr = map.get(k)
      if (arr) arr.push(r)
      else map.set(k, [r])
    }
    return [...map.entries()]
  }, [all.data, filter])

  return (
    <>
      <TopBar title="ประวัติการเบิก" back="/" />
      <StaffPage>
        <div className="no-bar -mx-3 flex gap-2 overflow-x-auto px-3 pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`chip shrink-0 ${filter === f.key ? 'chip-on' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {all.loading && <Loading />}
        {all.error && <ErrorBox message={all.error} onRetry={all.reload} />}
        {!all.loading && !all.error && groups.length === 0 && (
          <EmptyState title="ยังไม่มีรายการในหมวดนี้" />
        )}

        {groups.map(([day, rows]) => (
          <section key={day} className="mt-4">
            <h2 className="mb-2 text-sm font-medium text-ink-500">{day}</h2>
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={r.id} className="card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm">{r.ref_no}</span>
                    <span className={statusClass(r.status)}>{STATUS_TH[r.status]}</span>
                  </div>
                  <p className="mt-[2px] text-xs text-ink-400">
                    {fmtTime(r.created_at)} · {r.requisition_items?.length ?? 0} รายการ ·{' '}
                    {(r.requisition_items ?? []).reduce((n, l) => n + l.qty_requested, 0)} ชิ้น
                    {r.purpose ? ` · ${r.purpose}` : ''}
                  </p>

                  <ul className="mt-2 space-y-1 border-t border-line pt-2">
                    {(r.requisition_items ?? []).map((l) => (
                      <li key={l.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate text-ink-700">{l.items?.name ?? `#${l.item_id}`}</span>
                        <span className="shrink-0 text-ink-500">
                          {l.status === 'rejected' ? (
                            <span className="text-danger-txt">ไม่อนุมัติ</span>
                          ) : (
                            `${l.qty_approved ?? l.qty_requested} ${l.items?.unit ?? ''}`
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {r.reject_reason && (
                    <p className="mt-2 rounded-btn bg-danger-bg px-2 py-1 text-xs text-danger-txt">
                      เหตุผล: {r.reject_reason}
                    </p>
                  )}

                  <div className="mt-2">
                    <SyncBar states={syncMapFromRows(r.sync_log)} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </StaffPage>
    </>
  )
}
