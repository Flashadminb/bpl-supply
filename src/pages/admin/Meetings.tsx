import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAsync } from '../../lib/useAsync'
import {
  deleteMeetings,
  listMeetingDays,
  listMeetings,
  meetingStats,
  setMeetingStatus,
} from '../../lib/api'
import { readableError } from '../../lib/supabase'
import { EmptyState, ErrorBox, Loading, Modal, Spinner } from '../../components/ui'
import { EvidenceImg } from '../../components/EvidenceThumbs'
import { fmtDateTime } from '../../lib/format'
import type { MeetingRow, MeetingStatus } from '../../lib/types'

/**
 * รายชื่อประชุม — หน้าตรวจสอบ
 *
 * สองมุมของข้อมูลเดียวกัน แยกแท็บเพราะตอบคนละคำถาม
 *   รายชื่อ    "วันนี้ใครมาบ้าง และรูปน่าเชื่อถือไหม"
 *   สรุปรายคน  "เดือนนี้ใครมากี่ครั้ง และใครไม่เคยมาเลย"
 *
 * สรุปรายคนนับคนที่ไม่เคยเช็คอินด้วย เพราะคำถามจริงคือ "ใครหาย"
 * ถ้าโชว์แต่คนที่มา คนที่ไม่มาจะไม่ปรากฏตัวที่ไหนเลย
 */

const STATUS_TH: Record<MeetingStatus, string> = {
  pending: 'รอตรวจ',
  confirmed: 'ยืนยันแล้ว',
  rejected: 'ไม่นับ',
}

const STATUS_CLASS: Record<MeetingStatus, string> = {
  pending: 'badge-mute',
  confirmed: 'badge-ok',
  rejected: 'badge-dang',
}

/** วันนี้ตามเวลาไทย ในรูปแบบ YYYY-MM-DD */
const todayTH = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())

/** วันแรกและวันสุดท้ายของเดือนที่ให้มา (YYYY-MM) */
function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` }
}

/** ย้อนหลัง 18 เดือนให้เลือก — พอสำหรับดูข้ามปี โดยไม่ยาวจนหาไม่เจอ */
function monthOptions(): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = []
  const now = new Date()
  for (let i = 0; i < 18; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    out.push({
      key,
      label: new Intl.DateTimeFormat('th-TH', {
        year: 'numeric',
        month: 'long',
        timeZone: 'UTC',
      }).format(d),
    })
  }
  return out
}

/**
 * รูปย่อที่โหลดเมื่อเลื่อนมาถึงเท่านั้น
 *
 * รูปหลักฐานวิ่งผ่าน Edge Function ไม่ได้ต่อตรงกับ Drive
 * ถ้าโหลดทุกแถวพร้อมกัน เปิดดูทั้งเดือนทีเดียวกินหลายเมกะไบต์
 * ซึ่งนับเข้าโควตา egress ของ Supabase ทั้งก้อน
 * โหลดเฉพาะที่ตาเห็นจริงทำให้ค่านี้เหลือไม่ถึงสิบเปอร์เซ็นต์
 */
function LazyThumb({ fileId, alt, onOpen }: { fileId: string; alt: string; onOpen: () => void }) {
  const boxRef = useRef<HTMLButtonElement>(null)
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    const el = boxRef.current
    if (!el || seen) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true)
          io.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [seen])

  return (
    <button
      ref={boxRef}
      type="button"
      className="block h-[54px] w-[54px] overflow-hidden rounded-card border border-line bg-surface-2"
      onClick={onOpen}
    >
      {seen ? (
        <EvidenceImg fileId={fileId} enabled alt={alt} className="h-full w-full object-cover" />
      ) : null}
    </button>
  )
}

const dayLabelTH = (day: string) =>
  new Intl.DateTimeFormat('th-TH', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`))

export default function Meetings() {
  const nav = useNavigate()
  const [tab, setTab] = useState<'list' | 'stats'>('list')
  const [month, setMonth] = useState(todayTH().slice(0, 7))
  // เริ่มที่วันนี้ ไม่ใช่ทั้งเดือน เพราะคำถามแรกคือ 'วันนี้ใครมา' และโหลดเบากว่ามาก
  // คิวรอตรวจไม่ควรผูกกับวันเดียว ของเมื่อวานที่ยังไม่ได้ตรวจต้องเห็นด้วย
  const [day, setDay] = useState('')
  const [status, setStatus] = useState<MeetingStatus | ''>('pending')
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [big, setBig] = useState<MeetingRow | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [rejectNote, setRejectNote] = useState('')
  const [deleting, setDeleting] = useState(false)

  const range = useMemo(() => monthRange(month), [month])
  const months = useMemo(() => monthOptions(), [])

  const days = useAsync(() => listMeetingDays(), [])
  const rows = useAsync(
    () =>
      listMeetings(
        day
          ? { fromDay: day, toDay: day, status: status || undefined }
          : { fromDay: range.from, toDay: range.to, status: status || undefined },
      ),
    [day, range.from, range.to, status],
  )
  const stats = useAsync(() => meetingStats(range.from, range.to), [range.from, range.to])

  const all = rows.data ?? []

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return all
    return all.filter((m) =>
      `${m.full_name} ${m.employee_code} ${m.dept_code ?? ''} ${m.sub_dept ?? ''} ${m.ref_no}`
        .toLowerCase()
        .includes(q),
    )
  }, [all, search])

  const statRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = stats.data ?? []
    if (!q) return list
    return list.filter((s) =>
      `${s.full_name} ${s.employee_code} ${s.dept_code ?? ''} ${s.sub_dept ?? ''}`
        .toLowerCase()
        .includes(q),
    )
  }, [stats.data, search])

  // วันที่ที่มีคนเช็คอิน เฉพาะในเดือนที่เลือก
  const dayOptions = useMemo(
    () => (days.data ?? []).filter((d) => d.startsWith(month)),
    [days.data, month],
  )

  const allPicked = shown.length > 0 && shown.every((m) => picked.has(m.id))

  function toggle(id: string) {
    setPicked((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setPicked(allPicked ? new Set() : new Set(shown.map((m) => m.id)))
  }

  async function apply(next: MeetingStatus, note?: string) {
    if (picked.size === 0) return
    setBusy(true)
    setError(null)
    try {
      await setMeetingStatus([...picked], next, note)
      setPicked(new Set())
      setRejecting(false)
      setRejectNote('')
      rows.reload()
      stats.reload()
      // ตรวจแล้วของหลุดจากคิวนี้ไปอยู่หน้าหลักฐาน พาไปดูเลยจะได้ไม่งงว่าหายไปไหน
      if (next === 'confirmed') nav('/admin/meeting-evidence')
    } catch (e) {
      setError(readableError(e))
    } finally {
      setBusy(false)
    }
  }

  const pendingCount = all.filter((m) => m.status === 'pending').length

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-lg">รายชื่อประชุม</h1>
          <p className="text-sm text-ink-500">
            คิวรอตรวจ · กดยืนยันแล้วรายการจะย้ายไปอยู่หน้า หลักฐานการเข้าประชุม
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`chip ${tab === 'list' ? 'chip-on' : ''}`}
            onClick={() => setTab('list')}
          >
            รายชื่อ {all.length > 0 ? `(${all.length})` : ''}
          </button>
          <button
            type="button"
            className={`chip ${tab === 'stats' ? 'chip-on' : ''}`}
            onClick={() => setTab('stats')}
          >
            สรุปรายคน
          </button>
          <button type="button" className="btn-soft h-tap px-3 text-sm" onClick={() => { rows.reload(); stats.reload() }}>
            รีเฟรช
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------ ตัวกรอง */}
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div>
          <label className="label mb-1" htmlFor="mt-month">
            เดือน
          </label>
          <select
            id="mt-month"
            className="input h-tap max-w-[180px]"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value)
              setDay('')
              setPicked(new Set())
            }}
          >
            {months.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label mb-1" htmlFor="mt-day">
            วันที่
          </label>
          <select
            id="mt-day"
            className="input h-tap max-w-[220px]"
            value={day}
            onChange={(e) => {
              setDay(e.target.value)
              setPicked(new Set())
            }}
          >
            <option value="">ทั้งเดือน</option>
            {dayOptions.map((d) => (
              <option key={d} value={d}>
                {dayLabelTH(d)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label mb-1" htmlFor="mt-status">
            สถานะ
          </label>
          <select
            id="mt-status"
            className="input h-tap max-w-[150px]"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as MeetingStatus | '')
              setPicked(new Set())
            }}
          >
            <option value="">ทุกสถานะ</option>
            <option value="pending">รอตรวจ</option>
            <option value="confirmed">ยืนยันแล้ว</option>
            <option value="rejected">ไม่นับ</option>
          </select>
        </div>

        <input
          className="input h-tap max-w-[260px]"
          type="search"
          placeholder="ค้นหาชื่อ รหัสพนักงาน หรือแผนก"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {pendingCount > 0 && tab === 'list' && (
          <span className="rounded-pill bg-warn-bg px-3 py-2 text-sm text-warn-txt">
            รอตรวจ {pendingCount} รายการ
          </span>
        )}
      </div>

      {error && <div className="mb-3"><ErrorBox message={error} /></div>}

      {/* ------------------------------------------------------------ รายชื่อ */}
      {tab === 'list' && (
        <>
          {picked.size > 0 && (
            <div className="sticky top-0 z-20 mb-2 flex flex-wrap items-center gap-2 rounded-card border border-ink bg-ink px-3 py-2 text-white">
              <span className="font-display">เลือกไว้ {picked.size} รายการ</span>
              <span className="flex-1" />
              <button
                type="button"
                className="btn-primary h-tap px-3 text-sm"
                disabled={busy}
                onClick={() => void apply('confirmed')}
              >
                {busy ? <Spinner /> : null} ยืนยันเข้าประชุม
              </button>
              <button
                type="button"
                className="btn-soft h-tap px-3 text-sm"
                disabled={busy}
                onClick={() => setRejecting(true)}
              >
                ตีตก / ไม่นับ
              </button>
              <button
                type="button"
                className="h-tap rounded-btn bg-danger px-3 text-sm text-white"
                disabled={busy}
                onClick={() => setDeleting(true)}
              >
                ลบถาวร
              </button>
              <button
                type="button"
                className="min-h-tap px-2 text-sm underline"
                onClick={() => setPicked(new Set())}
              >
                ล้าง
              </button>
            </div>
          )}

          {rows.loading && <Loading />}
          {rows.error && <ErrorBox message={rows.error} onRetry={rows.reload} />}

          {!rows.loading && shown.length === 0 && (
            <EmptyState
              title="ไม่มีการเช็คอินตามตัวกรอง"
              hint="ลองเปลี่ยนเดือน หรือเลือก ทั้งเดือน แทนการเจาะวันเดียว"
            />
          )}

          {shown.length > 0 && (
            <section className="panel overflow-x-auto p-2">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="text-ink-500">
                  <tr className="border-b border-line">
                    <th className="w-[44px] px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label="เลือกทั้งหมด"
                        className="h-5 w-5"
                        checked={allPicked}
                        onChange={toggleAll}
                      />
                    </th>
                    <th className="w-[84px] px-3 py-2 font-medium">รูป</th>
                    <th className="w-[150px] px-3 py-2 font-medium">วันเวลา</th>
                    <th className="px-3 py-2 font-medium">ชื่อ</th>
                    <th className="w-[160px] px-3 py-2 font-medium">แผนก / กะ</th>
                    <th className="w-[120px] px-3 py-2 font-medium">สถานะ</th>
                    <th className="w-[210px] px-3 py-2 font-medium">ผลการตรวจ</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((m) => (
                    <tr key={m.id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2 align-top">
                        <input
                          type="checkbox"
                          aria-label={`เลือก ${m.full_name}`}
                          className="h-5 w-5"
                          checked={picked.has(m.id)}
                          onChange={() => toggle(m.id)}
                        />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <LazyThumb
                          fileId={m.file_id}
                          alt={`เซลฟี่ของ ${m.full_name}`}
                          onOpen={() => setBig(m)}
                        />
                      </td>
                      <td className="px-3 py-2 align-top text-ink-500">
                        {fmtDateTime(m.created_at)}
                        <p className="font-mono text-xs text-ink-400">{m.ref_no}</p>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <p className="truncate">{m.full_name}</p>
                        <p className="font-mono text-xs text-ink-400">{m.employee_code}</p>
                        {m.note && <p className="text-xs text-ink-500">“{m.note}”</p>}
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-ink-500">
                        {m.dept_code ?? '—'}
                        {m.sub_dept ? ` · ${m.sub_dept}` : ''}
                        {m.shift_start && m.shift_end && (
                          <p>
                            กะ {m.shift_start.slice(0, 5)}–{m.shift_end.slice(0, 5)}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <span className={STATUS_CLASS[m.status]}>{STATUS_TH[m.status]}</span>
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-ink-500">
                        {m.decided_by_name ? (
                          <>
                            <p>
                              {m.decided_by_name} · {m.decided_at ? fmtDateTime(m.decided_at) : ''}
                            </p>
                            {m.decide_note && <p className="text-danger-txt">{m.decide_note}</p>}
                          </>
                        ) : (
                          <span className="text-ink-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}

      {/* --------------------------------------------------------- สรุปรายคน */}
      {tab === 'stats' && (
        <>
          {stats.loading && <Loading />}
          {stats.error && <ErrorBox message={stats.error} onRetry={stats.reload} />}

          {statRows.length > 0 && (
            <section className="panel overflow-x-auto p-2">
              <p className="px-3 py-2 text-sm text-ink-500">
                {months.find((m) => m.key === month)?.label} · เรียงจากคนที่เข้ามากที่สุด
                <br />
                คนที่ยืนยัน 0 ครั้งคือคนที่ยังไม่มีหลักฐานว่าเข้าประชุมเลยในเดือนนี้
              </p>
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="text-ink-500">
                  <tr className="border-b border-line">
                    <th className="px-3 py-2 font-medium">ชื่อ</th>
                    <th className="w-[124px] px-3 py-2 font-medium">รหัสพนักงาน</th>
                    <th className="w-[150px] px-3 py-2 font-medium">แผนก</th>
                    <th className="w-[110px] px-3 py-2 font-medium">ยืนยันแล้ว</th>
                    <th className="w-[100px] px-3 py-2 font-medium">รอตรวจ</th>
                    <th className="w-[90px] px-3 py-2 font-medium">ไม่นับ</th>
                    <th className="w-[160px] px-3 py-2 font-medium">ล่าสุด</th>
                  </tr>
                </thead>
                <tbody>
                  {statRows.map((s) => (
                    <tr key={s.user_id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2">{s.full_name}</td>
                      <td className="px-3 py-2 font-mono text-xs">{s.employee_code}</td>
                      <td className="px-3 py-2 text-ink-500">
                        {s.dept_code ?? '—'}
                        {s.sub_dept ? ` · ${s.sub_dept}` : ''}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`font-display ${s.confirmed > 0 ? 'text-success-txt' : 'text-ink-300'}`}
                        >
                          {s.confirmed}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-warn-txt">{s.pending || ''}</td>
                      <td className="px-3 py-2 text-danger-txt">{s.rejected || ''}</td>
                      <td className="px-3 py-2 text-xs text-ink-500">
                        {s.last_at ? fmtDateTime(s.last_at) : <span className="text-ink-300">ยังไม่เคยเช็คอิน</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}

      {/* ---------------------------------------------------------- ดูรูปใหญ่ */}
      <Modal
        open={Boolean(big)}
        onClose={() => setBig(null)}
        title={big ? `${big.full_name} · ${fmtDateTime(big.created_at)}` : ''}
      >
        {big && (
          <>
            <EvidenceImg fileId={big.file_id} enabled className="w-full rounded-card" />
            <p className="mt-2 text-sm text-ink-500">
              <span className="font-mono">{big.employee_code}</span>
              {big.dept_code ? ` · ${big.dept_code}` : ''}
              {big.shift_start && big.shift_end
                ? ` · กะ ${big.shift_start.slice(0, 5)}–${big.shift_end.slice(0, 5)}`
                : ''}
            </p>
            {/* เวลาบนรูปมาจากนาฬิกาเครื่อง เวลาข้างบนมาจากเซิร์ฟเวอร์
                ถ้าสองอันห่างกันมาก แปลว่าเครื่องนั้นตั้งเวลาเอง */}
            <p className="mt-1 rounded-btn bg-surface-2 px-3 py-2 text-xs text-ink-500">
              เทียบเวลาที่ปั๊มบนรูปกับเวลาด้านบนได้ ถ้าห่างกันมากแปลว่านาฬิกาเครื่องนั้นถูกตั้งเอง
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="btn-soft"
                disabled={busy}
                onClick={() => {
                  setPicked(new Set([big.id]))
                  setBig(null)
                  setRejecting(true)
                }}
              >
                ตีตก
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() => {
                  setPicked(new Set([big.id]))
                  setBig(null)
                  void setMeetingStatus([big.id], 'confirmed')
                    .then(() => {
                      setPicked(new Set())
                      rows.reload()
                      stats.reload()
                    })
                    .catch((e) => setError(readableError(e)))
                }}
              >
                ยืนยันเข้าประชุม
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* ------------------------------------------------------- ลบถาวร */}
      <Modal open={deleting} onClose={() => setDeleting(false)} title="ลบถาวร">
        <p className="rounded-btn bg-danger-bg px-3 py-3 text-sm text-danger-txt">
          กำลังจะลบ {picked.size} รายการออกจากระบบถาวร กู้คืนไม่ได้
        </p>
        <p className="mt-2 text-sm text-ink-500">
          รูปใน Google Drive และแถวที่เคยส่งขึ้น Google Sheet ไปแล้วจะยังอยู่
          <br />
          ถ้าอยากเก็บร่องรอยว่าใครตัดสินว่าไม่นับ ให้กด “ตีตก” แทน
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => setDeleting(false)}>
            ยกเลิก
          </button>
          <button
            type="button"
            className="h-tap rounded-btn bg-danger px-4 text-white"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setError(null)
              void deleteMeetings([...picked])
                .then(() => {
                  setPicked(new Set())
                  setDeleting(false)
                  rows.reload()
                  stats.reload()
                })
                .catch((e) => setError(readableError(e)))
                .finally(() => setBusy(false))
            }}
          >
            {busy ? <Spinner /> : null} ลบถาวร {picked.size} รายการ
          </button>
        </div>
      </Modal>

      {/* ------------------------------------------------------------ ตีตก */}
      <Modal open={rejecting} onClose={() => setRejecting(false)} title={`ตีตก ${picked.size} รายการ`}>
        <p className="text-sm text-ink-500">
          รายการที่ตีตกจะไม่ถูกลบทิ้ง ยังเก็บไว้เป็นหลักฐานพร้อมชื่อคนตัดสินและเหตุผล
        </p>
        <label className="label mt-3" htmlFor="mt-why">
          เหตุผล
        </label>
        <input
          id="mt-why"
          className="input"
          placeholder="เช่น รูปไม่ใช่หน้าห้องประชุม / ไม่ได้เข้าร่วมจริง"
          value={rejectNote}
          onChange={(e) => setRejectNote(e.target.value)}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => setRejecting(false)}>
            ยกเลิก
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => void apply('rejected', rejectNote)}
          >
            {busy ? <Spinner /> : null} ยืนยันตีตก
          </button>
        </div>
      </Modal>
    </div>
  )
}
