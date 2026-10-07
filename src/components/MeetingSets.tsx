import { useEffect, useRef, useState } from 'react'
import { useAsync } from '../lib/useAsync'
import {
  attendBulk,
  clearAttendance,
  closeMeeting,
  deleteMeetings,
  listMeetingEvents,
  meetingPicks,
  meetingRoster,
  reopenMeeting,
  setAttendance,
  setMeetingAudience,
  setMeetingStatus,
  syncMeetingMembers,
} from '../lib/api'
import { AudiencePicker, EMPTY_AUDIENCE, type Audience } from './AudiencePicker'
import { EmptyState, ErrorBox, Loading, Modal, Spinner } from './ui'
import { EvidenceImg } from './EvidenceThumbs'
import { fmtDateTime } from '../lib/format'
import type { AttendState, MeetingEvent, MeetingStatus, RosterRow } from '../lib/types'

/**
 * ใบเช็คอิน — แผ่นเดียวต่อหนึ่งนัด
 *
 * ของเดิมแยกเป็นสองหน้า หน้าหนึ่งเป็นใบเรียงยาว ๆ ปนทุกนัด อีกหน้าเป็นเซตตามนัด
 * ของที่ต้องใช้พร้อมกันอยู่คนละหน้า คือรูปกับโน้ตอยู่หน้าใบ
 * แต่คนที่ขาดประชุมโผล่แค่หน้าเซต เพราะคนที่ไม่มาไม่มีใบ
 * สุดท้ายต้องสลับหน้าไปมาเพื่อตอบคำถามเดียว
 *
 * ตัวนี้เหลือหน้าเดียว ตั้งต้นจากนัด แล้วยกทุกอย่างของหน้าใบเข้ามาในแถวคน
 * เปิดนัดหนึ่งแล้วจบงานของนัดนั้นในที่เดียว ทั้งดูรูป อ่านโน้ตที่เจ้าตัวเขียนมา
 * แก้สถานะ ลบใบที่กดผิด และปิดประชุม
 */

const STATE_TH: Record<AttendState, string> = {
  ontime: 'มาตรงเวลา',
  late: 'มาสาย',
  excused: 'ลา',
  absent: 'ขาด',
  waiting: 'ยังไม่ถึงเวลา',
}

const STATE_CLASS: Record<AttendState, string> = {
  ontime: 'badge-ok',
  late: 'bg-warn-bg text-warn-txt badge',
  excused: 'badge-mute',
  absent: 'badge-dang',
  waiting: 'badge-mute',
}

const SLIP_TH: Record<MeetingStatus, string> = {
  pending: 'ใบรอตรวจ',
  confirmed: 'ใบยืนยันแล้ว',
  rejected: 'ใบไม่นับ',
}

const hhmm = (iso: string) => fmtDateTime(iso).slice(-5)

/**
 * ส่งก่อนหรือหลังเวลานัดกี่นาที
 *
 * late_min จากฐานข้อมูลบอกเฉพาะตอนสาย และนับจากเส้นตายซึ่งเลยเวลานัดไปแล้ว
 * แต่คำถามที่ถามกันจริงคือ "มาก่อนเวลาไหม" ซึ่งต้องเทียบกับเวลานัดตรง ๆ
 */
function gap(checkedAt: string | null, meetAt: string): { text: string; tone: string } | null {
  if (!checkedAt) return null
  const diff = Math.round((new Date(checkedAt).getTime() - new Date(meetAt).getTime()) / 60000)
  if (diff === 0) return { text: 'ตรงเวลาพอดี', tone: 'text-ink-500' }
  if (diff < 0) return { text: `ก่อนเวลา ${Math.abs(diff)} นาที`, tone: 'text-success-txt' }
  return { text: `หลังเวลานัด ${diff} นาที`, tone: 'text-warn-txt' }
}

/**
 * รูปย่อที่โหลดเมื่อเลื่อนมาถึงเท่านั้น
 *
 * รูปหลักฐานวิ่งผ่าน Edge Function ไม่ได้ต่อตรงกับ Drive
 * กางนัดที่มีสี่สิบคนแล้วโหลดทุกรูปพร้อมกันคือกินโควตา egress ของ Supabase ฟรี ๆ
 * ส่วนใหญ่คนเปิดดูจริงแค่ไม่กี่รูปที่สงสัย
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
      className="block h-[54px] w-[54px] shrink-0 overflow-hidden rounded-card border border-line bg-surface-2"
      onClick={onOpen}
      aria-label={`ดูรูปของ ${alt}`}
    >
      {seen ? (
        <EvidenceImg fileId={fileId} enabled alt={alt} className="h-full w-full object-cover" />
      ) : null}
    </button>
  )
}

/**
 * แก้ว่าใครต้องเข้านัดนี้ หลังประกาศไปแล้ว
 *
 * จำเป็นตั้งแต่ 119 ล็อกรายชื่อไว้ตอนประกาศ เพราะถ้าติ๊กผิดแล้วแก้ไม่ได้เลย
 * ก็ต้องยกเลิกนัดแล้วประกาศใหม่ ซึ่งทำให้ใบที่คนส่งมาแล้วหายไปทั้งกอง
 *
 * ปุ่มดึงคนเข้าใหม่แยกไว้ต่างหาก เพราะเป็นคนละเรื่องกัน
 * อันนั้นคือ "ติ๊กถูกแล้วแต่มีคนเข้าใหม่หลังประกาศ" ไม่ได้แปลว่าติ๊กผิด
 */
function AudienceBox({
  event,
  open,
  onClose,
  onDone,
}: {
  event: MeetingEvent
  open: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [aud, setAud] = useState<Audience>(EMPTY_AUDIENCE)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setErr(null)
    setNote(null)
    meetingPicks(event.id)
      .then((p) => setAud({ mode: 'picked', deptCodes: p.deptCodes, userIds: p.userIds }))
      .catch((e) => setErr((e as Error).message))
  }, [open, event.id])

  function run(fn: () => Promise<{ added: number; removed: number; total: number }>) {
    setBusy(true)
    setErr(null)
    void fn()
      .then((r) => {
        setNote(`รายชื่อตอนนี้ ${r.total} คน · เพิ่ม ${r.added} ถอดออก ${r.removed}`)
        onDone()
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setBusy(false))
  }

  return (
    <Modal open={open} onClose={onClose} title={`รายชื่อผู้เข้าประชุม · ${event.title}`}>
      <p className="mb-2 rounded-btn bg-surface-2 px-3 py-2 text-xs text-ink-500">
        รายชื่อถูกล็อกไว้ตั้งแต่ตอนประกาศ คนเข้าใหม่หลังจากนั้นจึงไม่โผล่เอง
        <br />
        คนที่ส่งใบเช็คชื่อมาแล้ว หรือถูกแก้สถานะไว้ จะไม่ถูกถอดออกไม่ว่าติ๊กยังไง
        เพราะหลักฐานของเขาต้องมีเจ้าของเสมอ
      </p>

      <AudiencePicker value={aud} onChange={setAud} pickedOnly />

      {note && (
        <p className="mt-2 rounded-btn bg-success-bg px-3 py-2 text-sm text-success-txt">{note}</p>
      )}
      {err && (
        <div className="mt-2">
          <ErrorBox message={err} />
        </div>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className="btn-soft h-tap px-4 text-sm"
          disabled={busy}
          onClick={() => run(() => syncMeetingMembers(event.id))}
        >
          {busy ? <Spinner /> : null} ดึงคนเข้าใหม่เข้ามา
        </button>
        <button
          type="button"
          className="btn-primary h-tap px-4 text-sm"
          disabled={busy || (aud.deptCodes.length === 0 && aud.userIds.length === 0)}
          onClick={() => run(() => setMeetingAudience(event.id, aud.deptCodes, aud.userIds))}
        >
          {busy ? <Spinner /> : null} บันทึกรายชื่อใหม่
        </button>
      </div>
    </Modal>
  )
}

export function MeetingSets({ from, to }: { from: string; to: string }) {
  const events = useAsync(() => listMeetingEvents(from, to), [from, to])
  const [open, setOpen] = useState<string | null>(null)

  if (events.loading && !events.data) return <Loading />
  if (events.error) return <ErrorBox message={events.error} onRetry={events.reload} />

  const list = (events.data ?? []).filter((e) => !e.cancelled_at)
  if (list.length === 0) {
    return (
      <EmptyState
        title="ไม่มีนัดประชุมในช่วงนี้"
        hint="ลองขยายช่วงวันที่ หรือประกาศนัดใหม่จากหน้าแรก"
      />
    )
  }

  return (
    <div className="space-y-3">
      {list.map((e) => (
        <MeetingSet
          key={e.id}
          event={e}
          open={open === e.id}
          onToggle={() => setOpen(open === e.id ? null : e.id)}
          onEventChanged={events.reload}
        />
      ))}
    </div>
  )
}

function MeetingSet({
  event,
  open,
  onToggle,
  onEventChanged,
}: {
  event: MeetingEvent
  open: boolean
  onToggle: () => void
  onEventChanged: () => void
}) {
  // โหลดรายชื่อเฉพาะตอนกาง · นัดหนึ่งมีได้เป็นร้อยคน ดึงทุกนัดพร้อมกันคือเน็ตฮับตาย
  const roster = useAsync(
    () => (open ? meetingRoster(event.id) : Promise.resolve([])),
    [open, event.id],
  )
  const rows = roster.data ?? []
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [audOpen, setAudOpen] = useState(false)
  const [big, setBig] = useState<RosterRow | null>(null)

  const n = {
    ontime: rows.filter((r) => r.state === 'ontime').length,
    late: rows.filter((r) => r.state === 'late').length,
    excused: rows.filter((r) => r.state === 'excused').length,
    absent: rows.filter((r) => r.state === 'absent').length,
  }

  // คนที่สถานะจะเปลี่ยนถ้ากดเช็คทั้งหมด — ต้องได้อ่านก่อนกด ไม่ใช่กดแล้วค่อยรู้
  const willChange = rows.filter((r) => r.state !== 'ontime')
  const sentOnly = willChange.filter((r) => r.checked_at)
  const pendingSlips = rows.filter((r) => r.checkin_id && r.status === 'pending')

  function run(fn: () => Promise<unknown>, after?: () => void) {
    setBusy(true)
    setErr(null)
    void fn()
      .then(() => {
        roster.reload()
        after?.()
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setBusy(false))
  }

  /**
   * เช็คทั้งหมดในครั้งเดียว
   *
   * ทำสองอย่างพร้อมกันเพราะงานจริงมันเป็นเรื่องเดียว คือ "รับนัดนี้ทั้งแผ่น"
   *   สถานะเข้าประชุม → มาตรงเวลา
   *   ใบที่ยังรอตรวจ   → ยืนยัน จึงขึ้นหน้าหลักฐานการเข้าประชุม
   * แยกให้กดสองที่คือคนจะกดอันเดียวแล้วงงว่าทำไมหลักฐานไม่ขึ้น
   */
  function checkAll(onlyChecked: boolean) {
    const ids = pendingSlips.map((r) => r.checkin_id as string)
    run(
      async () => {
        await attendBulk({ eventId: event.id, state: 'ontime', onlyChecked })
        if (ids.length > 0) await setMeetingStatus(ids, 'confirmed')
      },
      () => setAsking(false),
    )
  }

  return (
    <section className="rounded-card border border-line">
      <button
        type="button"
        className="flex w-full flex-wrap items-center gap-2 p-3 text-left"
        onClick={onToggle}
      >
        <span className="min-w-0 flex-1">
          <span className="block font-display text-md">
            {event.title}
            {event.closed_at ? (
              <span className="ml-2 badge-mute">ปิดแล้ว</span>
            ) : (
              <span className="ml-2 badge bg-warn-bg text-warn-txt">ยังเปิดให้เช็คชื่อ</span>
            )}
          </span>
          <span className="block text-sm text-ink-500">
            {fmtDateTime(event.meet_at)}
            {event.place ? ` · ${event.place}` : ''}
            {event.audience ? ` · ${event.audience}` : ''}
          </span>
        </span>
        {open && rows.length > 0 && (
          <span className="flex flex-wrap gap-1 text-xs">
            <span className="badge-ok">มา {n.ontime}</span>
            {n.late > 0 && <span className="badge bg-warn-bg text-warn-txt">สาย {n.late}</span>}
            {n.excused > 0 && <span className="badge-mute">ลา {n.excused}</span>}
            {n.absent > 0 && <span className="badge-dang">ขาด {n.absent}</span>}
          </span>
        )}
        <span aria-hidden className="text-ink-400">
          {open ? '▴' : '▾'}
        </span>
      </button>

      {open && (
        <div className="border-t border-line-2 p-3">
          {/* แถบจัดการของนัดนี้
              ปุ่มปิดประชุมอยู่ในนัดของมันเอง ไม่ใช่แถบรวมด้านบนหน้า
              เพราะจังหวะที่คนกดปิดคือตอนเปิดดูว่าใครมาครบแล้ว ซึ่งก็คือตรงนี้ */}
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-card bg-surface-2 p-2">
            <button
              type="button"
              className="btn-primary h-tap px-4 text-sm"
              disabled={busy || rows.length === 0}
              onClick={() => setAsking(true)}
            >
              เช็คทั้งหมดว่ามา
            </button>
            <button
              type="button"
              className="btn-soft h-tap px-4 text-sm"
              onClick={() => setAudOpen(true)}
            >
              แก้รายชื่อ · {rows.length} คน
            </button>

            {event.closed_at ? (
              <>
                <span className="min-w-0 flex-1 text-xs text-ink-500">
                  ปิดแล้ว
                  {event.closed_by_name ? ` โดย ${event.closed_by_name}` : ''} ·{' '}
                  {fmtDateTime(event.closed_at)}
                  <br />
                  กล้องเช็คชื่อปิดอยู่ ใครมาทีหลังกดเองไม่ได้ ต้องเปิดใหม่หรือให้หลังบ้านแก้สถานะให้
                </span>
                <button
                  type="button"
                  className="btn-soft h-tap px-4 text-sm"
                  disabled={busy}
                  onClick={() => run(() => reopenMeeting(event.id), onEventChanged)}
                >
                  {busy ? <Spinner /> : null} เปิดเช็คชื่อใหม่
                </button>
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1 text-xs text-warn-txt">
                  กล้องเช็คชื่อยังเปิดอยู่ ใครมาทีหลังก็ยังกดได้เรื่อย ๆ
                  <br />
                  ปิดแล้วรายชื่อและรูปยังอยู่ครบ ปิดแค่ไม่ให้กดเพิ่ม
                </span>
                <button
                  type="button"
                  className="btn-soft h-tap px-4 text-sm"
                  disabled={busy}
                  onClick={() => run(() => closeMeeting(event.id), onEventChanged)}
                >
                  {busy ? <Spinner /> : null} ปิดประชุม
                </button>
              </>
            )}
          </div>

          {err && (
            <div className="mb-2">
              <ErrorBox message={err} />
            </div>
          )}

          {roster.loading && rows.length === 0 ? (
            <Loading label="กำลังโหลดรายชื่อ…" />
          ) : roster.error ? (
            <ErrorBox message={roster.error} onRetry={roster.reload} />
          ) : rows.length === 0 ? (
            <p className="text-sm text-ink-500">
              นัดนี้ไม่ได้ระบุรายชื่อผู้เข้าร่วม จึงบอกไม่ได้ว่าใครขาด
              <br />
              ถ้าอยากได้รายชื่อ ตอนประกาศให้เลือก &ldquo;เจาะจงแผนกหรือรายคน&rdquo;
            </p>
          ) : (
            <ul className="space-y-1.5">
              {rows.map((r) => (
                <RosterLine
                  key={r.user_id}
                  row={r}
                  meetAt={event.meet_at}
                  eventId={event.id}
                  onChanged={roster.reload}
                  onBig={() => setBig(r)}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ถามก่อนเช็คทั้งหมด — กดรับทั้งแผ่นแบบไม่ดูอะไรเลยคือวิธีทำให้คนขาดกลายเป็นคนมา */}
      <Modal open={asking} onClose={() => setAsking(false)} title={`เช็คทั้งหมด · ${event.title}`}>
        {willChange.length === 0 ? (
          <p className="rounded-btn bg-success-bg px-3 py-3 text-sm text-success-txt">
            ทุกคนขึ้นว่ามาตรงเวลาอยู่แล้ว ไม่มีอะไรต้องเช็คเพิ่ม
          </p>
        ) : (
          <>
            <p className="rounded-btn bg-warn-bg px-3 py-3 text-sm text-warn-txt">
              มี {willChange.length} คนที่สถานะจะเปลี่ยนเป็น &ldquo;มาตรงเวลา&rdquo; ถ้ากดต่อ
              <br />
              อ่านก่อนว่ามีใครที่ควรแก้รายคนแทนไหม
            </p>
            <ul className="mt-2 max-h-[40vh] space-y-1 overflow-y-auto">
              {willChange.map((r) => (
                <li
                  key={r.user_id}
                  className="flex flex-wrap items-center gap-2 rounded-btn bg-surface-2 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 flex-1">
                    {r.full_name}
                    <span className="ml-2 font-mono text-xs text-ink-400">{r.employee_code}</span>
                    {r.note && <span className="block text-xs text-ink-500">“{r.note}”</span>}
                  </span>
                  <span className={STATE_CLASS[r.state]}>{STATE_TH[r.state]}</span>
                  {!r.checked_at && (
                    <span className="text-xs text-danger-txt">ไม่ได้เช็คชื่อเข้ามา</span>
                  )}
                </li>
              ))}
            </ul>
            {pendingSlips.length > 0 && (
              <p className="mt-2 text-xs text-ink-500">
                ใบที่ยังรอตรวจอีก {pendingSlips.length} ใบจะถูกยืนยันไปด้วย
                แล้วย้ายไปอยู่หน้าหลักฐานการเข้าประชุม
              </p>
            )}
            {/* คำว่า "ใบ" คือใบเช็คชื่อที่หน้างานกดส่งมาพร้อมรูปในแอพ
                เขียนแยกไว้เพราะสองปุ่มข้างล่างต่างกันตรงนี้จุดเดียว
                และกดผิดปุ่มแปลว่าคนที่ไม่ได้มา กลายเป็นคนมาตรงเวลา */}
            <p className="mt-2 rounded-btn bg-surface-2 px-3 py-2 text-xs text-ink-600">
              <b>สองปุ่มนี้ต่างกันที่เดียว</b> คือจะแตะคนที่ไม่ได้กดเช็คชื่อด้วยไหม
              <br />
              ปุ่มซ้าย แตะเฉพาะคนที่กดเช็คชื่อเข้ามาจริงแล้ว เช่นคนที่ขึ้นสายให้กลายเป็นมาตรงเวลา
              ส่วนคนที่เงียบหายไปเลยยังขึ้นขาดเหมือนเดิม
              <br />
              ปุ่มขวา แตะทุกคนรวมคนที่ไม่เคยกดอะไรเลย ใช้ตอนที่รู้แน่ว่าเขามาจริงแต่ไม่ได้กดในแอพ
            </p>
            <p className="mt-1 text-xs text-ink-500">
              กดแล้วยังย้อนดูได้ว่าเดิมระบบคำนวณไว้ว่าใครสายใครขาด และใครเป็นคนกดแก้
            </p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setAsking(false)}>
                ไปแก้รายคนก่อน
              </button>
              {sentOnly.length > 0 && (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => checkAll(true)}
                >
                  {busy ? <Spinner /> : null} เฉพาะคนที่กดเช็คชื่อแล้ว {sentOnly.length} คน
                </button>
              )}
              {willChange.length > sentOnly.length && (
                <button
                  type="button"
                  className="h-tap rounded-btn bg-danger px-4 text-sm text-white"
                  disabled={busy}
                  onClick={() => checkAll(false)}
                >
                  {busy ? <Spinner /> : null} ทุกคน รวมคนที่ไม่ได้กด {willChange.length} คน
                </button>
              )}
            </div>
          </>
        )}
      </Modal>

      <AudienceBox
        event={event}
        open={audOpen}
        onClose={() => setAudOpen(false)}
        onDone={() => {
          roster.reload()
          onEventChanged()
        }}
      />

      {/* ดูรูปใหญ่ */}
      <Modal
        open={Boolean(big)}
        onClose={() => setBig(null)}
        title={
          big ? `${big.full_name}${big.checked_at ? ` · ${fmtDateTime(big.checked_at)}` : ''}` : ''
        }
      >
        {big?.file_id && (
          <>
            <EvidenceImg fileId={big.file_id} enabled className="w-full rounded-card" />
            <p className="mt-2 text-sm text-ink-500">
              <span className="font-mono">{big.employee_code}</span>
              {big.dept_code ? ` · ${big.dept_code}` : ''}
              {big.ref_no ? ` · ${big.ref_no}` : ''}
            </p>
            {big.note && <p className="mt-1 text-sm">เขาเขียนมาว่า “{big.note}”</p>}
            {/* เวลาบนรูปมาจากนาฬิกาเครื่อง เวลาข้างบนมาจากเซิร์ฟเวอร์
                ถ้าสองอันห่างกันมาก แปลว่าเครื่องนั้นตั้งเวลาเอง */}
            <p className="mt-2 rounded-btn bg-surface-2 px-3 py-2 text-xs text-ink-500">
              เทียบเวลาที่ปั๊มบนรูปกับเวลาด้านบนได้ ถ้าห่างกันมากแปลว่านาฬิกาเครื่องนั้นถูกตั้งเอง
            </p>
          </>
        )}
      </Modal>
    </section>
  )
}

function RosterLine({
  row,
  meetAt,
  eventId,
  onChanged,
  onBig,
}: {
  row: RosterRow
  meetAt: string
  eventId: string
  onChanged: () => void
  onBig: () => void
}) {
  const [edit, setEdit] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [killing, setKilling] = useState(false)

  const g = gap(row.checked_at, meetAt)
  const changed = row.state !== row.raw_state || Boolean(row.changed_at)

  function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setErr(null)
    void fn()
      .then(() => {
        setEdit(false)
        setKilling(false)
        setNote('')
        onChanged()
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setBusy(false))
  }

  const ACTIONS: { label: string; state: Exclude<AttendState, 'waiting'>; cls: string }[] = [
    { label: 'มาตรงเวลา', state: 'ontime', cls: 'border-success/40 text-success-txt' },
    // ยอมรับว่ามา แต่ยังขึ้นว่าสายอยู่ · ไม่ได้ลบความสายทิ้ง แค่บอกว่าเห็นแล้ว
    { label: 'ยอมรับ · ยังขึ้นสาย', state: 'late', cls: 'border-warn/40 text-warn-txt' },
    { label: 'ลา', state: 'excused', cls: 'border-line text-ink-700' },
    { label: 'ขาด', state: 'absent', cls: 'border-danger/40 text-danger-txt' },
  ]

  return (
    <li className="rounded-card border border-line-2 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {row.file_id ? (
          <LazyThumb fileId={row.file_id} alt={row.full_name} onOpen={onBig} />
        ) : (
          <span className="flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-card border border-dashed border-line text-xs text-ink-300">
            ไม่มีรูป
          </span>
        )}

        <span className="min-w-0 flex-1">
          <span className="block text-sm">
            {row.full_name}
            <span className="ml-2 font-mono text-xs text-ink-400">{row.employee_code}</span>
            {row.dept_code && <span className="ml-2 text-xs text-ink-400">{row.dept_code}</span>}
          </span>
          <span className="block text-xs">
            {row.checked_at ? (
              <>
                <span className="text-ink-500">ส่ง {hhmm(row.checked_at)}</span>
                {g && <span className={`ml-2 ${g.tone}`}>{g.text}</span>}
                {row.late_min ? (
                  <span className="ml-2 text-warn-txt">เกินเส้นตาย {row.late_min} นาที</span>
                ) : null}
                {row.ref_no && <span className="ml-2 font-mono text-ink-300">{row.ref_no}</span>}
              </>
            ) : (
              <span className="text-danger-txt">ยังไม่ส่งเช็คอิน</span>
            )}
          </span>
          {/* โน้ตที่เจ้าตัวพิมพ์มาเอง — เหตุผลที่มาสายส่วนใหญ่อยู่ในนี้
              ของเดิมมีแต่ในหน้าใบเช็คอิน คนตรวจจึงไม่เคยเห็นตอนกดตัดสิน */}
          {row.note && (
            <span className="mt-1 block rounded-btn bg-surface-2 px-2 py-1 text-xs text-ink-700">
              เขาเขียนมาว่า “{row.note}”
            </span>
          )}
        </span>

        <span className="flex flex-col items-end gap-1">
          <span className={STATE_CLASS[row.state]}>{STATE_TH[row.state]}</span>
          {row.status && row.status !== 'confirmed' && (
            <span className={row.status === 'rejected' ? 'badge-dang' : 'badge-mute'}>
              {SLIP_TH[row.status]}
            </span>
          )}
        </span>

        <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => setEdit(!edit)}>
          {edit ? 'ปิด' : 'แก้'}
        </button>
      </div>

      {changed && (
        <p className="mt-1 text-xs text-ink-400">
          แก้โดย {row.by_name ?? '—'}
          {row.changed_at ? ` · ${fmtDateTime(row.changed_at)}` : ''}
          {row.reason ? ` · ${row.reason}` : ''}
          {row.raw_state !== row.state ? ` · ระบบคำนวณไว้ว่า ${STATE_TH[row.raw_state]}` : ''}
        </p>
      )}
      {row.decide_note && (
        <p className="mt-1 text-xs text-danger-txt">
          ผลตรวจใบ: {row.decide_note}
          {row.decided_by_name ? ` · ${row.decided_by_name}` : ''}
        </p>
      )}

      {edit && (
        <div className="mt-2 rounded-btn bg-ink/5 p-2">
          <input
            className="input mb-2"
            placeholder="โน้ตของผู้ตรวจสอบ (ไม่บังคับ) เช่น รถติดมาก แจ้งล่วงหน้าแล้ว"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex flex-wrap gap-1.5">
            {ACTIONS.map((a) => (
              <button
                key={a.state}
                type="button"
                disabled={busy}
                className={`rounded-btn border bg-surface px-3 py-1.5 text-xs font-semibold ${a.cls}`}
                onClick={() =>
                  run(() =>
                    setAttendance({
                      eventId,
                      userId: row.user_id,
                      state: a.state,
                      reason: note.trim(),
                    }),
                  )
                }
              >
                {busy ? <Spinner /> : null}
                {a.label}
              </button>
            ))}
            {changed && (
              <button
                type="button"
                disabled={busy}
                className="btn-ghost px-3 py-1.5 text-xs"
                onClick={() => run(() => clearAttendance(eventId, row.user_id))}
              >
                ถอนการแก้ · กลับไปใช้ค่าที่ระบบคำนวณ
              </button>
            )}
          </div>

          {/* จัดการตัวใบ คนละเรื่องกับสถานะมา/ขาด
              สถานะคือ "สรุปว่าคนนี้มาไหม" ส่วนใบคือหลักฐานที่เขาส่งมา */}
          {row.checkin_id && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
              <span className="text-xs text-ink-500">ตัวใบและรูป</span>
              {row.status !== 'confirmed' && (
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-btn border border-success/40 bg-surface px-3 py-1.5 text-xs font-semibold text-success-txt"
                  onClick={() =>
                    run(() => setMeetingStatus([row.checkin_id as string], 'confirmed'))
                  }
                >
                  ยืนยันใบนี้
                </button>
              )}
              {row.status !== 'rejected' && (
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-btn border border-danger/40 bg-surface px-3 py-1.5 text-xs font-semibold text-danger-txt"
                  onClick={() =>
                    run(() =>
                      setMeetingStatus(
                        [row.checkin_id as string],
                        'rejected',
                        note.trim() || undefined,
                      ),
                    )
                  }
                >
                  ตีตก · ไม่นับใบนี้
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                className="btn-ghost ml-auto px-3 py-1.5 text-xs text-danger-txt"
                onClick={() => setKilling(true)}
              >
                ลบใบนี้
              </button>
            </div>
          )}

          {err && <p className="mt-2 text-xs text-danger-txt">{err}</p>}
        </div>
      )}

      {/* ลบใบรายคน
          กดผิดคนเกิดขึ้นจริง และของเดิมต้องไปลบที่หน้าใบเรียงยาวซึ่งหาใบไม่เจอ
          ลบแล้วคนนี้กลับไปเป็น "ยังไม่ส่งเช็คอิน" และกดส่งใหม่ได้ถ้าประชุมยังเปิด */}
      <Modal open={killing} onClose={() => setKilling(false)} title={`ลบใบของ ${row.full_name}`}>
        <p className="rounded-btn bg-danger-bg px-3 py-3 text-sm text-danger-txt">
          ลบใบเช็คอินใบนี้ออกจากระบบถาวร กู้คืนไม่ได้
        </p>
        <p className="mt-2 text-sm text-ink-500">
          ลบแล้วคนนี้จะกลับไปขึ้นว่ายังไม่ส่งเช็คอิน และกดส่งใหม่ได้ถ้าประชุมยังเปิดอยู่
          <br />
          รูปใน Google Drive และแถวที่ส่งขึ้น Google Sheet ไปแล้วจะยังอยู่
          <br />
          ถ้าอยากเก็บร่องรอยว่าใครตัดสินว่าไม่นับ ให้กด &ldquo;ตีตก&rdquo; แทนการลบ
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => setKilling(false)}>
            ยกเลิก
          </button>
          <button
            type="button"
            className="h-tap rounded-btn bg-danger px-4 text-white"
            disabled={busy}
            onClick={() => run(() => deleteMeetings([row.checkin_id as string]))}
          >
            {busy ? <Spinner /> : null} ลบใบนี้
          </button>
        </div>
      </Modal>
    </li>
  )
}
