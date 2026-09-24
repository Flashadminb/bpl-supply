import { useMemo, useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import {
  deleteMeetings,
  listMeetingDays,
  listMeetings,
  listProfiles,
  setMeetingStatus,
} from '../../lib/api'
import { readableError } from '../../lib/supabase'
import { EmptyState, ErrorBox, Loading, Modal, Spinner } from '../../components/ui'
import { fmtDateTime } from '../../lib/format'
import type { MeetingStatus } from '../../lib/types'

/**
 * หลักฐานการเข้าประชุม — ตารางรายชื่อ
 *
 * คำถามที่หน้านี้ตอบคือ "รหัสนี้คนนี้เข้าประชุมวันนั้นไหม" ซึ่งเป็นคำถามแบบตาราง
 * ไม่ใช่คำถามแบบอัลบั้มรูป จึงไม่โหลดรูปมาแสดงเลย มีแค่ลิงก์ให้กดไปดูใน Drive
 *
 * ผลพลอยได้คือหน้านี้เบามาก รูปหลักฐานวิ่งผ่าน Edge Function ทุกใบ
 * ถ้าโชว์เป็นรูป เปิดดูทั้งเดือนทีเดียวกินหลายเมกะไบต์ต่อการเปิดหนึ่งครั้ง
 * แบบตารางคือไม่กินเลยจนกว่าจะมีคนกดดูจริง
 */

const STATUS_TH: Record<MeetingStatus, string> = {
  pending: 'รอตรวจ',
  confirmed: 'เข้าร่วม',
  rejected: 'ไม่นับ',
}

const STATUS_CLASS: Record<MeetingStatus, string> = {
  pending: 'badge-mute',
  confirmed: 'badge-ok',
  rejected: 'badge-dang',
}

const todayTH = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())

function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` }
}

function monthOptions(): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = []
  const now = new Date()
  for (let i = 0; i < 18; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    out.push({
      key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
      label: new Intl.DateTimeFormat('th-TH', {
        year: 'numeric',
        month: 'long',
        timeZone: 'UTC',
      }).format(d),
    })
  }
  return out
}

const dayLabelTH = (day: string) =>
  new Intl.DateTimeFormat('th-TH', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`))

/** ลิงก์ Drive — ใช้ web_link ที่เก็บไว้ ถ้าไม่มีก็ประกอบจาก file id */
const driveUrl = (fileId: string, webLink: string | null) =>
  webLink || `https://drive.google.com/file/d/${fileId}/view`

export default function MeetingEvidence() {
  const [month, setMonth] = useState(todayTH().slice(0, 7))
  const [day, setDay] = useState('')
  const [who, setWho] = useState('')
  const [status, setStatus] = useState<MeetingStatus | ''>('confirmed')
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const range = useMemo(() => monthRange(month), [month])
  const months = useMemo(() => monthOptions(), [])

  const days = useAsync(() => listMeetingDays(), [])
  const people = useAsync(() => listProfiles(), [])
  const rows = useAsync(
    () =>
      listMeetings(
        day
          ? { fromDay: day, toDay: day, status: status || undefined }
          : { fromDay: range.from, toDay: range.to, status: status || undefined },
      ),
    [day, range.from, range.to, status],
  )

  const all = rows.data ?? []

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all
      .filter((m) => (who ? m.user_id === who : true))
      .filter((m) =>
        q
          ? `${m.full_name} ${m.employee_code} ${m.dept_code ?? ''} ${m.ref_no}`
              .toLowerCase()
              .includes(q)
          : true,
      )
  }, [all, who, search])

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

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      setPicked(new Set())
      setConfirmDelete(false)
      rows.reload()
      days.reload()
    } catch (e) {
      setError(readableError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="mb-4">
        <h1 className="font-display text-lg">หลักฐานการเข้าประชุม</h1>
        <p className="text-sm text-ink-500">
          ตารางรายชื่อว่ารหัสไหนเข้าประชุมวันไหน · อยากดูรูปกดลิงก์ Drive ท้ายแถว
        </p>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div>
          <label className="label mb-1" htmlFor="me-month">เดือน</label>
          <select
            id="me-month"
            className="input h-tap max-w-[180px]"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value)
              setDay('')
              setPicked(new Set())
            }}
          >
            {months.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label mb-1" htmlFor="me-day">วันที่</label>
          <select
            id="me-day"
            className="input h-tap max-w-[220px]"
            value={day}
            onChange={(e) => {
              setDay(e.target.value)
              setPicked(new Set())
            }}
          >
            <option value="">ทั้งเดือน</option>
            {dayOptions.map((d) => (
              <option key={d} value={d}>{dayLabelTH(d)}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label mb-1" htmlFor="me-who">รายคน</label>
          <select
            id="me-who"
            className="input h-tap max-w-[220px]"
            value={who}
            onChange={(e) => setWho(e.target.value)}
          >
            <option value="">ทุกคน</option>
            {(people.data ?? [])
              .filter((p) => p.is_active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name} · {p.employee_code}
                </option>
              ))}
          </select>
        </div>

        <div>
          <label className="label mb-1" htmlFor="me-status">สถานะ</label>
          <select
            id="me-status"
            className="input h-tap max-w-[150px]"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as MeetingStatus | '')
              setPicked(new Set())
            }}
          >
            <option value="confirmed">เข้าร่วม</option>
            <option value="rejected">ไม่นับ</option>
            <option value="pending">รอตรวจ</option>
            <option value="">ทุกสถานะ</option>
          </select>
        </div>

        <input
          className="input h-tap max-w-[240px]"
          type="search"
          placeholder="ค้นหาชื่อ รหัส หรือเลขที่"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <span className="text-sm text-ink-500">{shown.length} รายชื่อ</span>
      </div>

      {error && <div className="mb-3"><ErrorBox message={error} /></div>}

      {picked.size > 0 && (
        <div className="sticky top-0 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-card border border-ink bg-ink px-3 py-2 text-white">
          <span className="font-display">เลือกไว้ {picked.size} รายชื่อ</span>
          <span className="flex-1" />
          <button
            type="button"
            className="btn-soft h-tap px-3 text-sm"
            disabled={busy}
            onClick={() => void run(() => setMeetingStatus([...picked], 'confirmed'))}
          >
            นับเข้าร่วม
          </button>
          <button
            type="button"
            className="btn-soft h-tap px-3 text-sm"
            disabled={busy}
            onClick={() => void run(() => setMeetingStatus([...picked], 'rejected'))}
          >
            ไม่นับ
          </button>
          <button
            type="button"
            className="h-tap rounded-btn bg-danger px-3 text-sm text-white"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
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
          title="ไม่มีรายชื่อตามตัวกรอง"
          hint="ลองเปลี่ยนเดือน หรือเปลี่ยนสถานะเป็น ทุกสถานะ"
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
                    onChange={() =>
                      setPicked(allPicked ? new Set() : new Set(shown.map((m) => m.id)))
                    }
                  />
                </th>
                <th className="w-[124px] px-3 py-2 font-medium">รหัสพนักงาน</th>
                <th className="px-3 py-2 font-medium">ชื่อ</th>
                <th className="w-[160px] px-3 py-2 font-medium">แผนก / กะ</th>
                <th className="w-[150px] px-3 py-2 font-medium">วันเวลาเช็คอิน</th>
                <th className="w-[110px] px-3 py-2 font-medium">สถานะ</th>
                <th className="w-[190px] px-3 py-2 font-medium">ผู้ตรวจ</th>
                <th className="w-[90px] px-3 py-2 font-medium">รูป</th>
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
                  <td className="px-3 py-2 align-top font-mono text-xs">{m.employee_code}</td>
                  <td className="px-3 py-2 align-top">
                    <p className="truncate">{m.full_name}</p>
                    <p className="font-mono text-[10px] text-ink-400">{m.ref_no}</p>
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
                  <td className="px-3 py-2 align-top text-ink-500">{fmtDateTime(m.created_at)}</td>
                  <td className="px-3 py-2 align-top">
                    <span className={STATUS_CLASS[m.status]}>{STATUS_TH[m.status]}</span>
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-ink-500">
                    {m.decided_by_name ? (
                      <>
                        <p className="truncate">{m.decided_by_name}</p>
                        <p>{m.decided_at ? fmtDateTime(m.decided_at) : ''}</p>
                        {m.decide_note && <p className="text-danger-txt">{m.decide_note}</p>}
                      </>
                    ) : (
                      <span className="text-ink-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <a
                      href={driveUrl(m.file_id, m.web_link)}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-soft h-tap px-3 text-sm"
                    >
                      ดูรูป
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ------------------------------------------------------- ยืนยันการลบ */}
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="ลบถาวร">
        <p className="rounded-btn bg-danger-bg px-3 py-3 text-sm text-danger-txt">
          กำลังจะลบ {picked.size} รายชื่อออกจากระบบถาวร กู้คืนไม่ได้
        </p>
        {/* บอกตรง ๆ ว่าลบตรงนี้ไม่ได้ลบทุกที่ ไม่งั้นจะเข้าใจว่าหลักฐานหายหมดแล้ว */}
        <p className="mt-2 text-sm text-ink-500">
          รูปใน Google Drive และแถวที่เคยส่งขึ้น Google Sheet ไปแล้วจะยังอยู่
          <br />
          ถ้าอยากเก็บร่องรอยว่าใครตัดสินว่าไม่นับ ให้กด “ไม่นับ” แทนการลบ
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => setConfirmDelete(false)}>
            ยกเลิก
          </button>
          <button
            type="button"
            className="h-tap rounded-btn bg-danger px-4 text-white"
            disabled={busy}
            onClick={() => void run(() => deleteMeetings([...picked]))}
          >
            {busy ? <Spinner /> : null} ลบถาวร {picked.size} รายชื่อ
          </button>
        </div>
      </Modal>
    </div>
  )
}
