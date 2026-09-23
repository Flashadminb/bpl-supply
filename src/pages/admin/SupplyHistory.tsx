import { useMemo, useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import { listRequisitionsBetween } from '../../lib/api'
import { EmptyState, ErrorBox, Loading } from '../../components/ui'
import { STATUS_TH, fmtDateTime, statusClass } from '../../lib/format'

/**
 * ประวัติการเบิกสิ้นเปลือง — อ่านอย่างเดียว
 *
 * มีไว้ให้ผู้ตรวจสอบไล่ดูว่าใครเบิกอะไรไปเมื่อไหร่ โดยไม่ต้องมีสิทธิ์แอดมิน
 * ไม่มีปุ่มอนุมัติ ไม่มีปุ่มแก้ และไม่มีลิงก์รูปใน Drive
 * (กติกาข้อ 4 ของโปรเจกต์ — คนที่ไม่ใช่แอดมินเปิดรูปหลักฐานไม่ได้)
 *
 * แอดมินกับเจ้าของระบบใช้หน้านี้ได้เหมือนกัน แต่จะได้ภาพครบกว่าที่หน้าหลักฐาน
 */
export default function SupplyHistory() {
  const [days, setDays] = useState(30)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')

  const range = useMemo(() => {
    const to = new Date()
    const from = new Date(Date.now() - days * 864e5)
    return { fromISO: from.toISOString(), toISO: to.toISOString() }
  }, [days])

  const reqs = useAsync(
    () => listRequisitionsBetween(range.fromISO, range.toISO),
    [range.fromISO],
  )

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (reqs.data ?? [])
      .filter((r) => (status ? r.status === status : true))
      .filter((r) => {
        if (!q) return true
        const names = (r.requisition_items ?? []).map((l) => l.items?.name ?? '').join(' ')
        return `${r.ref_no} ${r.profiles?.full_name ?? ''} ${r.profiles?.employee_code ?? ''} ${r.profiles?.dept_code ?? ''} ${names}`
          .toLowerCase()
          .includes(q)
      })
  }, [reqs.data, search, status])

  const units = rows.reduce(
    (n, r) =>
      n + (r.requisition_items ?? []).reduce((m, l) => m + (l.qty_approved ?? l.qty_requested), 0),
    0,
  )

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="mb-4">
        <h1 className="font-display text-lg">ประวัติการเบิกสิ้นเปลือง</h1>
        <p className="text-sm text-ink-500">
          ดูอย่างเดียว · ใครเบิกอะไรไปเมื่อไหร่ จำนวนเท่าไหร่
        </p>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            type="button"
            className={`chip ${days === d ? 'chip-on' : ''}`}
            onClick={() => setDays(d)}
          >
            {d} วัน
          </button>
        ))}
        <select
          className="input h-tap max-w-[160px]"
          value={status}
          aria-label="สถานะ"
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">ทุกสถานะ</option>
          <option value="approved">อนุมัติแล้ว</option>
          <option value="partial">อนุมัติบางส่วน</option>
          <option value="pending">รออนุมัติ</option>
          <option value="rejected">ไม่อนุมัติ</option>
        </select>
        <input
          className="input h-tap max-w-[280px]"
          type="search"
          placeholder="ค้นหาชื่อคน แผนก วัสดุ หรือเลขที่"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-sm text-ink-500">
          {rows.length} ใบ · {units} ชิ้น
        </span>
        <button type="button" className="btn-soft h-tap px-3 text-sm" onClick={reqs.reload}>
          รีเฟรช
        </button>
      </div>

      {reqs.loading && <Loading />}
      {reqs.error && <ErrorBox message={reqs.error} onRetry={reqs.reload} />}

      {!reqs.loading && rows.length === 0 && (
        <EmptyState title="ไม่มีการเบิกตามตัวกรอง" hint="ลองขยายช่วงวัน หรือล้างคำค้น" />
      )}

      {rows.length > 0 && (
        <section className="panel overflow-x-auto p-2">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="text-ink-500">
              <tr className="border-b border-line">
                <th className="w-[130px] px-3 py-2 font-medium">เลขที่</th>
                <th className="w-[150px] px-3 py-2 font-medium">วันเวลา</th>
                <th className="w-[220px] px-3 py-2 font-medium">ผู้เบิก</th>
                <th className="px-3 py-2 font-medium">รายการ</th>
                <th className="w-[130px] px-3 py-2 font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2 align-top font-mono text-xs">{r.ref_no}</td>
                  <td className="px-3 py-2 align-top text-ink-500">{fmtDateTime(r.created_at)}</td>
                  <td className="px-3 py-2 align-top">
                    <p className="truncate">{r.profiles?.full_name ?? '—'}</p>
                    <p className="text-xs text-ink-400">
                      <span className="font-mono">{r.profiles?.employee_code ?? ''}</span>
                      {r.profiles?.dept_code ? ` · ${r.profiles.dept_code}` : ''}
                    </p>
                  </td>
                  <td className="px-3 py-2 align-top text-ink-700">
                    <ul className="space-y-[2px]">
                      {(r.requisition_items ?? []).map((l) => (
                        <li key={l.id} className={l.status === 'rejected' ? 'text-ink-300 line-through' : ''}>
                          {l.items?.name ?? `#${l.item_id}`}{' '}
                          <span className="font-display">
                            {l.qty_approved ?? l.qty_requested}
                          </span>{' '}
                          <span className="text-xs text-ink-400">{l.items?.unit ?? ''}</span>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className={statusClass(r.status)}>{STATUS_TH[r.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
