import { useMemo, useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import { DateRangePicker } from '../../components/DateRangePicker'
import { EmptyState, ErrorBox, Loading } from '../../components/ui'
import { fmtDateTime } from '../../lib/format'
import { BREAK_AUDIT_TH, listBreakAudit, type BreakAuditRow } from '../../lib/breakPass'

/**
 * ประวัติการแก้ไขบัตรเบรค
 *
 * ตอบคำถามเดียวคือ ใครทำอะไรกับใบไหน เมื่อไหร่ และบอกเหตุผลว่าอะไร
 *
 * ของที่บันทึกมาจาก trigger ที่ตัวตาราง break_passes ไม่ใช่จากหน้าจอ
 * แปลว่าทุกทางที่แก้ข้อมูลถูกบันทึกหมด รวมถึงการแก้มือจาก SQL Editor
 * ถ้าให้แต่ละปุ่มเขียน log เอง วันหนึ่งจะมีปุ่มใหม่ที่คนเขียนลืมใส่
 * แล้วประวัติจะมีรูโดยไม่มีใครรู้ว่ามีรู
 *
 * หน้านี้ลบอะไรไม่ได้เลยโดยตั้งใจ ประวัติที่ลบได้ไม่ใช่ประวัติ
 */

function dayKey(offset = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}

const ACTIONS: { code: string; label: string }[] = [
  { code: '', label: 'ทุกการกระทำ' },
  { code: 'edit', label: 'แก้ไข' },
  { code: 'close', label: 'ปิดใบ' },
  { code: 'reopen', label: 'เปิดใบกลับ' },
  { code: 'delete', label: 'ลบทิ้ง' },
]

function Pill({ a }: { a: BreakAuditRow['action'] }) {
  const cls =
    a === 'delete' ? 'badge-dang' : a === 'edit' ? 'badge-warn' : a === 'reopen' ? 'badge-warn' : 'badge-mute'
  return <span className={cls}>{BREAK_AUDIT_TH[a] ?? a}</span>
}

export default function BreakAudit() {
  const [from, setFrom] = useState(dayKey(-30))
  const [to, setTo] = useState(dayKey())
  const [action, setAction] = useState('')
  const [q, setQ] = useState('')

  const feed = useAsync(() => listBreakAudit({ from, to, action, q }), [from, to, action, q])
  const rows = feed.data ?? []

  const sum = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.action, (m.get(r.action) ?? 0) + 1)
    const people = new Set(rows.map((r) => r.by_name)).size
    return { m, people }
  }, [rows])

  return (
    <div className="mx-auto max-w-[1200px]">
      <div className="mb-4">
        <h1 className="font-display text-xl">ประวัติการแก้ไขบัตรเบรค</h1>
        <p className="mt-1 text-sm text-ink-500">
          ใครแก้ ใครปิด ใครลบ · บันทึกจากฝั่งฐานข้อมูลทุกครั้งที่ข้อมูลเปลี่ยน ไม่ว่าจะแก้จากหน้าไหน
          <br />
          หน้านี้ลบอะไรไม่ได้โดยตั้งใจ ประวัติที่ลบได้ไม่ใช่ประวัติ
        </p>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <DateRangePicker from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b) }} />
        <select className="input h-tap max-w-[180px]" aria-label="การกระทำ" value={action} onChange={(e) => setAction(e.target.value)}>
          {ACTIONS.map((a) => (
            <option key={a.code} value={a.code}>
              {a.label}
            </option>
          ))}
        </select>
        <input
          className="input h-tap max-w-[260px]"
          type="search"
          placeholder="ค้นรหัสบัตร เลขใบ ชื่อคนแก้ หรือเหตุผล"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {feed.loading && <Loading />}
      {feed.error && <ErrorBox message={feed.error} onRetry={feed.reload} />}

      {feed.data && rows.length === 0 && (
        <EmptyState
          title="ยังไม่มีการแก้ไขในช่วงนี้"
          hint="ถ้ามีคนแก้สถานะ แก้เวลา ปิดใบ หรือลบใบ รายการจะขึ้นที่นี่ทันที"
        />
      )}

      {rows.length > 0 && (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <span className="chip">ทั้งหมด {rows.length.toLocaleString('th-TH')} ครั้ง</span>
            <span className="chip">คนที่แก้ {sum.people} คน</span>
            {ACTIONS.filter((a) => a.code && sum.m.get(a.code)).map((a) => (
              <span key={a.code} className="chip">
                {a.label} {sum.m.get(a.code)}
              </span>
            ))}
          </div>

          <section className="panel overflow-x-auto p-2">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="text-ink-500">
                <tr className="border-b border-line">
                  <th className="w-[150px] px-3 py-2 font-medium">เมื่อไหร่</th>
                  <th className="w-[110px] px-3 py-2 font-medium">ทำอะไร</th>
                  <th className="w-[110px] px-3 py-2 font-medium">บัตร</th>
                  <th className="px-3 py-2 font-medium">แก้ช่องไหน · จากอะไรเป็นอะไร</th>
                  <th className="px-3 py-2 font-medium">เหตุผล</th>
                  <th className="w-[180px] px-3 py-2 font-medium">ใครทำ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line-2 last:border-0">
                    <td className="px-3 py-2 text-xs text-ink-500">{fmtDateTime(r.at)}</td>
                    <td className="px-3 py-2">
                      <Pill a={r.action} />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs font-bold">{r.card_code ?? '—'}</td>
                    <td className="px-3 py-2">
                      {r.field && <span className="font-semibold">{r.field}</span>}
                      {r.field && ' · '}
                      <span className="text-ink-500">{r.before_val || '—'}</span>
                      <span className="mx-1">→</span>
                      <span className="font-semibold">{r.after_val || '—'}</span>
                      {r.ref_no && <span className="block text-xs text-ink-400">{r.ref_no}</span>}
                    </td>
                    <td className="px-3 py-2">
                      {r.reason || <span className="text-ink-400">ไม่ได้ระบุ</span>}
                    </td>
                    <td className="px-3 py-2">
                      {r.by_name}
                      {r.by_code && <span className="block text-xs text-ink-400">{r.by_code}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <p className="mt-2 text-xs text-ink-400">
            แสดงได้สูงสุด 300 รายการต่อครั้ง · ถ้าเต็มให้แคบช่วงวันลง
          </p>
        </>
      )}
    </div>
  )
}
