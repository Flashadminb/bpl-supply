import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { countOsScanExportRows, exportToSheet, listOsScans } from '../../lib/api'
import { useAsync } from '../../lib/useAsync'
import { DateRangePicker } from '../../components/DateRangePicker'
import { EmptyState, ErrorBox, Loading, Spinner } from '../../components/ui'
import { fmtDateTime } from '../../lib/format'
import type { OsScanResult } from '../../lib/types'

/**
 * ประวัติการสแกนบัตร OS — เจ้าของระบบและผู้ตรวจสอบ
 *
 * เรียงใหม่สุดขึ้นก่อน เพราะคำถามที่ถามบ่อยสุดคือ "เมื่อกี้เกิดอะไรขึ้น"
 * ไม่ใช่ "เดือนที่แล้วเป็นยังไง" ซึ่งค่อยกรองเอาทีหลังได้
 */

const RESULT_TH: Record<OsScanResult, string> = {
  ok: 'ผ่าน',
  revoked: 'บัตรถูกยกเลิก',
  unknown: 'ไม่รู้จักบัตร',
  inactive: 'ปิดการใช้งาน',
}

const resultClass = (r: OsScanResult) =>
  r === 'ok' ? 'badge bg-success-bg text-success-txt' : 'badge bg-danger-bg text-danger-txt'

const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

export default function OsScans() {
  const [from, setFrom] = useState(todayISO())
  const [to, setTo] = useState(todayISO())
  const [onlyFlagged, setOnlyFlagged] = useState(false)
  const [guard, setGuard] = useState('')

  const range = useMemo(
    () => ({
      fromISO: new Date(`${from}T00:00:00`).toISOString(),
      toISO: new Date(`${to}T23:59:59`).toISOString(),
    }),
    [from, to],
  )

  const scans = useAsync(
    () => listOsScans({ ...range, onlyFlagged, limit: 500 }),
    [range, onlyFlagged],
  )

  const rows = scans.data ?? []
  const guards = useMemo(
    () => [...new Set(rows.map((r) => r.guard_name).filter(Boolean))] as string[],
    [rows],
  )
  const shown = guard ? rows.filter((r) => r.guard_name === guard) : rows

  const ok = rows.filter((r) => r.result === 'ok').length
  const flagged = rows.filter((r) => r.flagged_at).length

  /**
   * ส่งลงชีต — ส่งเฉพาะช่วงวันที่ที่เลือกอยู่ ไม่ได้ส่งทั้งหมดทุกครั้ง
   *
   * ประวัติสแกนโตวันละหลายร้อยแถว ยิงทั้งก้อนทุกครั้งจะช้าขึ้นเรื่อย ๆ
   * และชน quota ของ Sheets ในที่สุด
   *
   * แต่การส่งเฉพาะช่วงมีกับดัก คือของที่ค้างอยู่นอกช่วงจะไม่มีวันถูกส่ง
   * โดยที่หน้าจอไม่ได้บอกอะไรเลย จึงนับของค้างทั้งหมดมาเทียบแล้วขึ้นป้ายเตือน
   */
  const pendingRange = useAsync(() => countOsScanExportRows(range), [range])
  const pendingAll = useAsync(() => countOsScanExportRows(), [])
  const outside = Math.max(0, (pendingAll.data ?? 0) - (pendingRange.data ?? 0))

  const [pushing, setPushing] = useState(false)
  const [pushed, setPushed] = useState<string | null>(null)
  const [pushErr, setPushErr] = useState<string | null>(null)

  async function pushSheet() {
    setPushing(true)
    setPushed(null)
    setPushErr(null)
    try {
      const res = await exportToSheet({ scope: 'osscan', from: range.fromISO, to: range.toISO })
      setPushed(`เพิ่มใหม่ ${res.appended} แถว · อัปของเดิม ${res.updated} แถว · ${res.sheet}`)
      pendingRange.reload()
      pendingAll.reload()
    } catch (e) {
      setPushErr(e instanceof Error ? e.message : 'ส่งลงชีตไม่สำเร็จ')
    } finally {
      setPushing(false)
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl">ประวัติการสแกนบัตร OS</h1>
          <p className="text-sm text-ink-400">
            สแกน {rows.length} ครั้ง · ผ่าน {ok} · มีปัญหา {rows.length - ok}
            {flagged > 0 && ` · รปภ แจ้งไม่ตรง ${flagged}`}
          </p>
        </div>
        <span className="flex flex-wrap gap-2">
          <button type="button" className="btn-ghost" onClick={pushSheet} disabled={pushing}>
            {pushing ? <Spinner /> : 'ส่งลง Google Sheet'}
            {!pushing && (pendingRange.data ?? 0) > 0 && (
              <span className="rounded-pill bg-brand-500 px-2 font-display text-xs text-ink">
                {(pendingRange.data ?? 0) > 99 ? '99+' : pendingRange.data}
              </span>
            )}
          </button>
          <Link to="/admin/os" className="btn-ghost">
            กลับไปรายชื่อ
          </Link>
        </span>
      </div>

      {pushed && (
        <div className="mb-3 rounded-card border border-success/25 bg-success-bg p-3 text-sm text-success-txt">
          ส่งลงชีตแล้ว · {pushed}
          <button type="button" className="ml-2 underline" onClick={() => setPushed(null)}>
            ปิด
          </button>
        </div>
      )}

      {pushErr && <ErrorBox message={pushErr} onRetry={pushSheet} />}

      {outside > 0 && (
        <p className="mb-3 rounded-card border border-warn/30 bg-warn-bg p-3 text-sm text-warn-txt">
          ยังมีอีก {outside} ครั้งที่ยังไม่ได้ส่งลงชีต แต่อยู่นอกช่วงวันที่ที่เลือกอยู่ —
          ต้องขยายช่วงวันที่ก่อน ถึงจะกดส่งของพวกนั้นได้
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t) }} />
        <button
          type="button"
          className={`chip ${onlyFlagged ? 'chip-on' : ''}`}
          onClick={() => setOnlyFlagged((v) => !v)}
        >
          เฉพาะที่ รปภ แจ้งไม่ตรง
        </button>
        {guards.length > 1 && (
          <select
            className="input w-[190px]"
            value={guard}
            onChange={(e) => setGuard(e.target.value)}
            aria-label="กรองตาม รปภ"
          >
            <option value="">รปภ ทุกคน</option>
            {guards.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        )}
      </div>

      {scans.loading && <Loading />}
      {scans.error && <ErrorBox message={scans.error} onRetry={scans.reload} />}

      {!scans.loading && shown.length === 0 && (
        <EmptyState
          title="ไม่มีการสแกนในช่วงนี้"
          hint={onlyFlagged ? 'ลองปิดตัวกรองหรือขยายช่วงวันที่' : 'ลองขยายช่วงวันที่'}
        />
      )}

      {shown.length > 0 && (
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th className="px-3 py-2">เวลา</th>
                <th className="px-3 py-2">OS</th>
                <th className="px-3 py-2">สังกัด</th>
                <th className="px-3 py-2">เครื่อง</th>
                <th className="px-3 py-2">ผล</th>
                <th className="px-3 py-2">รปภ ที่สแกน</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr
                  key={r.id}
                  className={`border-b border-line last:border-0 ${
                    r.flagged_at ? 'bg-danger-bg/40' : ''
                  }`}
                >
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                    {fmtDateTime(r.scanned_at)}
                  </td>
                  <td className="px-3 py-2">
                    {r.full_name ?? <span className="text-ink-400">ไม่รู้จัก</span>}
                    <span className="block font-mono text-xs text-ink-400">
                      {r.os_code ?? (r.full_name ? '—' : r.token.slice(0, 10) + '…')}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-500">{r.affiliation ?? '—'}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.phone_model ?? '—'}
                    <span className="block break-all font-mono text-ink-400">{r.imei ?? '—'}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={resultClass(r.result)}>{RESULT_TH[r.result]}</span>
                    {r.flag_reason && (
                      <span className="mt-1 block text-xs font-medium text-danger-txt">
                        รปภ แจ้ง: {r.flag_reason}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-500">
                    {r.guard_name ?? '—'}
                    <span className="block font-mono text-ink-400">{r.guard_code ?? ''}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-ink-400">
        เก็บรายครั้งย้อนหลัง 90 วัน เกินนั้นยุบเป็นสรุปรายวันอัตโนมัติ
        เพื่อไม่ให้ฐานข้อมูลโตไปเรื่อย ๆ · แถวที่ รปภ แจ้งไม่ตรงไม่ถูกยุบ เก็บไว้ตลอด
      </p>
    </div>
  )
}
