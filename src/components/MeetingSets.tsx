import { useState } from 'react'
import { useAsync } from '../lib/useAsync'
import { clearAttendance, listMeetingEvents, meetingRoster, setAttendance } from '../lib/api'
import { EmptyState, ErrorBox, Loading, Spinner } from './ui'
import { fmtDateTime } from '../lib/format'
import type { AttendState, MeetingEvent, RosterRow } from '../lib/types'

/**
 * รายชื่อเข้าประชุมแบบ "เซตตามนัด"
 *
 * ของเดิมเป็นรายการใบเช็คอินเรียงกันยาว ๆ ปนทุกนัด
 * ซึ่งตอบคำถามที่ถามจริงไม่ได้เลย คือ "ประชุมเมื่อวานใครมาใครไม่มา"
 * ต้องมานั่งไล่ว่าใบไหนของนัดไหน แล้วคนที่ไม่มาก็ไม่มีใบ จึงหายไปจากสายตา
 *
 * ตัวนี้ตั้งต้นจากนัด ไม่ได้ตั้งต้นจากใบ
 * เปิดนัดหนึ่งแล้วเห็นรายชื่อทุกคนที่ถูกเรียก ทั้งคนที่มาและคนที่ไม่มา
 * พร้อมเวลาที่ส่งจริง และห่างจากเวลานัดเท่าไหร่
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
        />
      ))}
    </div>
  )
}

function MeetingSet({
  event,
  open,
  onToggle,
}: {
  event: MeetingEvent
  open: boolean
  onToggle: () => void
}) {
  // โหลดรายชื่อเฉพาะตอนกาง · นัดหนึ่งมีได้เป็นร้อยคน ดึงทุกนัดพร้อมกันคือเน็ตฮับตาย
  const roster = useAsync(() => (open ? meetingRoster(event.id) : Promise.resolve([])), [open, event.id])
  const rows = roster.data ?? []

  const n = {
    ontime: rows.filter((r) => r.state === 'ontime').length,
    late: rows.filter((r) => r.state === 'late').length,
    excused: rows.filter((r) => r.state === 'excused').length,
    absent: rows.filter((r) => r.state === 'absent').length,
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
            {event.closed_at ? <span className="ml-2 badge-mute">ปิดแล้ว</span> : null}
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
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

function RosterLine({
  row,
  meetAt,
  eventId,
  onChanged,
}: {
  row: RosterRow
  meetAt: string
  eventId: string
  onChanged: () => void
}) {
  const [edit, setEdit] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const g = gap(row.checked_at, meetAt)
  const changed = row.state !== row.raw_state || Boolean(row.changed_at)

  function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setErr(null)
    void fn()
      .then(() => {
        setEdit(false)
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
              </>
            ) : (
              <span className="text-danger-txt">ยังไม่ส่งเช็คอิน</span>
            )}
          </span>
        </span>

        <span className={STATE_CLASS[row.state]}>{STATE_TH[row.state]}</span>

        <button
          type="button"
          className="btn-ghost px-3 py-1 text-xs"
          onClick={() => setEdit(!edit)}
        >
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

      {edit && (
        <div className="mt-2 rounded-btn bg-ink/5 p-2">
          <input
            className="input mb-2"
            placeholder="โน้ต (ไม่บังคับ) เช่น รถติดมาก แจ้งล่วงหน้าแล้ว"
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
                className="btn-ghost ml-auto px-3 py-1.5 text-xs"
                onClick={() => run(() => clearAttendance(eventId, row.user_id))}
              >
                ถอนการแก้ · กลับไปใช้ค่าที่ระบบคำนวณ
              </button>
            )}
          </div>
          {err && <p className="mt-2 text-xs text-danger-txt">{err}</p>}
        </div>
      )}
    </li>
  )
}
