import { useEffect, useMemo, useRef, useState } from 'react'
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
import { EvidenceImg } from '../../components/EvidenceThumbs'
import { fmtDateTime } from '../../lib/format'
import type { MeetingRow, MeetingStatus } from '../../lib/types'

/**
 * หลักฐานการเข้าประชุม — คลังรูปที่ตรวจแล้ว
 *
 * แยกจากหน้า "รายชื่อประชุม" ซึ่งเป็นคิวรอตรวจ
 * พอกดยืนยันในหน้านั้น รายการจะหลุดจากคิวแล้วมาโผล่ที่นี่
 * เหมือนฝั่งสิ้นเปลืองที่แยกหน้าอนุมัติออกจากหน้าหลักฐาน
 *
 * ดรอปดาวน์ชุดเดียวกับหน้าหลักฐานสิ้นเปลือง — เดือน วัน คน สถานะ
 * เพราะคนที่เปิดสองหน้านี้เป็นคนเดียวกัน ไม่ควรต้องเรียนรู้สองแบบ
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

/** รูปย่อโหลดเมื่อเลื่อนมาถึง — รูปวิ่งผ่าน Edge Function จึงนับเข้าโควตาทุกใบ */
function LazyThumb({ fileId, alt, onOpen }: { fileId: string; alt: string; onOpen: () => void }) {
  const boxRef = useRef<HTMLButtonElement>(null)
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    const el = boxRef.current
    if (!el || seen) return
    const io = new IntersectionObserver(
      (e) => {
        if (e.some((x) => x.isIntersecting)) {
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
      className="block aspect-square w-full overflow-hidden rounded-card border border-line bg-surface-2"
      onClick={onOpen}
    >
      {seen ? (
        <EvidenceImg fileId={fileId} enabled alt={alt} className="h-full w-full object-cover" />
      ) : null}
    </button>
  )
}

export default function MeetingEvidence() {
  const [month, setMonth] = useState(todayTH().slice(0, 7))
  const [day, setDay] = useState('')
  const [who, setWho] = useState('')
  const [status, setStatus] = useState<MeetingStatus | ''>('confirmed')
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [big, setBig] = useState<MeetingRow | null>(null)
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
          รูปที่ตรวจแล้ว เก็บไว้ย้อนดู · รายการที่ยังไม่ได้ตรวจอยู่ในหน้า รายชื่อประชุม
        </p>
      </div>

      {/* ตัวกรองชุดเดียวกับหน้าหลักฐานสิ้นเปลือง */}
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
            <option value="confirmed">ยืนยันแล้ว</option>
            <option value="rejected">ไม่นับ</option>
            <option value="pending">รอตรวจ</option>
            <option value="">ทุกสถานะ</option>
          </select>
        </div>

        <input
          className="input h-tap max-w-[240px]"
          type="search"
          placeholder="ค้นหาชื่อหรือเลขที่"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <span className="text-sm text-ink-500">{shown.length} รายการ</span>
      </div>

      {error && <div className="mb-3"><ErrorBox message={error} /></div>}

      {picked.size > 0 && (
        <div className="sticky top-0 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-card border border-ink bg-ink px-3 py-2 text-white">
          <span className="font-display">เลือกไว้ {picked.size} รายการ</span>
          <span className="flex-1" />
          <button
            type="button"
            className="btn-soft h-tap px-3 text-sm"
            disabled={busy}
            onClick={() => void run(() => setMeetingStatus([...picked], 'confirmed'))}
          >
            ยืนยัน
          </button>
          <button
            type="button"
            className="btn-soft h-tap px-3 text-sm"
            disabled={busy}
            onClick={() => void run(() => setMeetingStatus([...picked], 'rejected'))}
          >
            ตีตก
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
          title="ไม่มีหลักฐานตามตัวกรอง"
          hint="ลองเปลี่ยนเดือน หรือเปลี่ยนสถานะเป็น ทุกสถานะ"
        />
      )}

      {shown.length > 0 && (
        <>
          <button
            type="button"
            className="btn-soft mb-3 h-tap px-3 text-sm"
            onClick={() => setPicked(allPicked ? new Set() : new Set(shown.map((m) => m.id)))}
          >
            {allPicked ? 'ล้างที่เลือกทั้งหมด' : `เลือกทั้งหมด ${shown.length} รายการ`}
          </button>

          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
            {shown.map((m) => (
              <li
                key={m.id}
                className={`rounded-card border p-2 ${
                  picked.has(m.id) ? 'border-ink bg-surface-2' : 'border-line bg-surface'
                }`}
              >
                <LazyThumb
                  fileId={m.file_id}
                  alt={`เซลฟี่ของ ${m.full_name}`}
                  onOpen={() => setBig(m)}
                />
                <p className="mt-1 truncate text-sm font-medium">{m.full_name}</p>
                <p className="truncate text-xs text-ink-400">
                  {fmtDateTime(m.created_at)}
                </p>
                <div className="mt-1 flex items-center justify-between gap-1">
                  <span className={`${STATUS_CLASS[m.status]} text-[10px]`}>
                    {STATUS_TH[m.status]}
                  </span>
                  <input
                    type="checkbox"
                    aria-label={`เลือก ${m.full_name}`}
                    className="h-5 w-5"
                    checked={picked.has(m.id)}
                    onChange={() => toggle(m.id)}
                  />
                </div>
              </li>
            ))}
          </ul>
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
              {big.dept_code ? ` · ${big.dept_code}` : ''} ·{' '}
              <span className={STATUS_CLASS[big.status]}>{STATUS_TH[big.status]}</span>
            </p>
            {big.decided_by_name && (
              <p className="text-xs text-ink-400">
                ตรวจโดย {big.decided_by_name}
                {big.decided_at ? ` · ${fmtDateTime(big.decided_at)}` : ''}
                {big.decide_note ? ` · ${big.decide_note}` : ''}
              </p>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="h-tap rounded-btn bg-danger px-3 text-sm text-white"
                disabled={busy}
                onClick={() => {
                  setPicked(new Set([big.id]))
                  setBig(null)
                  setConfirmDelete(true)
                }}
              >
                ลบถาวร
              </button>
              <button
                type="button"
                className="btn-soft"
                disabled={busy}
                onClick={() => void run(() => setMeetingStatus([big.id], 'rejected'))}
              >
                ตีตก
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() => void run(() => setMeetingStatus([big.id], 'confirmed'))}
              >
                ยืนยัน
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* ------------------------------------------------------- ยืนยันการลบ */}
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="ลบถาวร">
        <p className="rounded-btn bg-danger-bg px-3 py-3 text-sm text-danger-txt">
          กำลังจะลบ {picked.size} รายการออกจากระบบถาวร กู้คืนไม่ได้
        </p>
        {/* บอกตรง ๆ ว่าลบตรงนี้ไม่ได้ลบทุกที่ ไม่งั้นจะเข้าใจว่าหลักฐานหายหมดแล้ว */}
        <p className="mt-2 text-sm text-ink-500">
          รูปใน Google Drive และแถวที่เคยส่งขึ้น Google Sheet ไปแล้วจะยังอยู่
          <br />
          ถ้าอยากเก็บร่องรอยว่าใครตัดสินว่าไม่นับ ให้กด “ตีตก” แทนการลบ
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
            {busy ? <Spinner /> : null} ลบถาวร {picked.size} รายการ
          </button>
        </div>
      </Modal>
    </div>
  )
}
