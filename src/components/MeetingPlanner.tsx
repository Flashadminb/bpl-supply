import { useState } from 'react'
import { describeWindow } from '../lib/meetingWindow'
import { AudiencePicker, EMPTY_AUDIENCE, type Audience } from './AudiencePicker'
import { useAsync } from '../lib/useAsync'
import { cancelMeetingEvent, createMeetingEvent, deleteMeetingEvent, listUpcomingMeetings } from '../lib/api'
import { readableError } from '../lib/supabase'
import { Spinner } from './ui'
import type { MeetingEvent } from '../lib/types'

/**
 * นัดประชุมและประกาศ
 *
 * ช่อง "ใครต้องเข้า" เป็นข้อความอิสระ ไม่ใช่ดรอปดาวน์เลือกตำแหน่ง
 * เพราะโครงตำแหน่งหน้างานจริง (sup, lead, หัวหน้าไลน์) ไม่ได้อยู่ในระบบนี้
 * ถ้าไปทำตารางตำแหน่งขึ้นมา ก็ต้องคอยตามอัปเดตทุกครั้งที่คนย้ายงาน
 * พิมพ์เป็นข้อความแล้วให้คนอ่านเอง ตรงกับที่ใช้จริงและไม่มีวันล้าสมัย
 *
 * แจ้งเตือนส่งหาทุกคนรอบเดียวตอนประกาศ ไม่ได้เลือกส่งเฉพาะคนที่เกี่ยว
 * เพราะระบบไม่รู้ว่าใครเป็น sup การเลือกส่งจึงแปลว่าจะพลาดคนที่ต้องมา
 * ส่งให้หมดแล้วเขียนให้ชัดว่าใครเกี่ยว ปลอดภัยกว่าเดาแล้วพลาด
 */

/** ค่าเริ่มต้นของช่องเวลา — พรุ่งนี้ 09:00 ตามเวลาไทย */
function defaultWhen(): string {
  const d = new Date(Date.now() + 864e5)
  const th = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }))
  th.setHours(9, 0, 0, 0)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${th.getFullYear()}-${p(th.getMonth() + 1)}-${p(th.getDate())}T09:00`
}

const whenTH = (iso: string) =>
  new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))

/** แถบประกาศที่ทุกคนเห็น — ขึ้นในกล่องเช็คอิน */
export function MeetingNotices({ rows }: { rows: MeetingEvent[] }) {
  const live = rows.filter((e) => !e.cancelled_at)
  if (live.length === 0) return null

  return (
    <section className="mb-3 space-y-2">
      {live.map((e) => (
        <div key={e.id} className="rounded-card border border-brand-300 bg-brand-50 p-3">
          <p className="font-display text-ink">{e.title}</p>
          <p className="text-sm text-ink-700">
            {whenTH(e.meet_at)}
            {e.place ? ` · ${e.place}` : ''}
          </p>
          {e.audience && (
            <p className="mt-1 rounded-btn bg-ink px-2 py-1 text-sm text-white">
              ผู้เข้าร่วม: {e.audience}
            </p>
          )}
          {e.note && <p className="mt-1 text-sm text-ink-500">{e.note}</p>}
          <p className="mt-1 text-xs text-ink-400">ประกาศโดย {e.created_by_name}</p>
        </div>
      ))}
    </section>
  )
}

/** ฟอร์มนัดประชุม — เห็นเฉพาะแอดมิน เจ้าของระบบ และผู้ตรวจสอบ */
export function MeetingPlanner({ onChanged }: { onChanged?: () => void }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [when, setWhen] = useState(defaultWhen())
  const [audience, setAudience] = useState('')
  const [place, setPlace] = useState('')
  const [note, setNote] = useState('')
  /**
   * กรอบเวลาเช็คชื่อรายนัด
   *
   * null = ใช้ค่ากลางที่ตั้งไว้ในหน้าเว็บ ซึ่งเป็นสิ่งที่คนส่วนใหญ่ต้องการ
   * จึงซ่อนไว้ใต้ปุ่ม ไม่ยัดให้กรอกทุกครั้งที่นัดประชุม
   */
  /**
   * ใครต้องเข้าประชุม
   *
   * free  = พิมพ์เอาเองในช่อง "ใครต้องเข้า" (ของเดิม) — ไม่มีรายชื่อจึงนับขาดไม่ได้
   * all   = ทุกคนในระบบ
   * picked= เลือกแผนกหรือรายคน
   *
   * สองแบบหลังเท่านั้นที่รู้ว่าใครควรมา จึงบอกได้ว่าใครขาด
   */
  const [audMode, setAudMode] = useState<'free' | 'list'>('free')
  const [aud, setAud] = useState<Audience>(EMPTY_AUDIENCE)
  const [detail, setDetail] = useState(false)
  const [openBefore, setOpenBefore] = useState<number | null>(null)
  const [lateAfter, setLateAfter] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const events = useAsync(() => listUpcomingMeetings(10), [done])

  async function save() {
    if (!title.trim() || !when) return
    setBusy(true)
    setError(null)
    try {
      // ช่อง datetime-local ให้เวลาท้องถิ่นของเครื่อง ซึ่งหน้างานอยู่ไทยอยู่แล้ว
      await createMeetingEvent({
        title,
        meetAt: new Date(when).toISOString(),
        audience,
        place,
        note,
        openBefore,
        lateAfter,
        mode: audMode === 'free' ? 'free' : aud.mode,
        deptCodes: aud.deptCodes,
        userIds: aud.userIds,
      })
      setTitle('')
      setAudience('')
      setPlace('')
      setNote('')
      setWhen(defaultWhen())
      setDetail(false)
      setAudMode('free')
      setAud(EMPTY_AUDIENCE)
      setOpenBefore(null)
      setLateAfter(null)
      setOpen(false)
      setDone(new Date().toISOString())
      onChanged?.()
    } catch (e) {
      setError(readableError(e))
    } finally {
      setBusy(false)
    }
  }

  async function act(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      setDone(new Date().toISOString())
      onChanged?.()
    } catch (e) {
      setError(readableError(e))
    } finally {
      setBusy(false)
    }
  }

  const rows = events.data ?? []

  return (
    <section className="mt-5 rounded-card border border-line p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-display">นัดประชุม</p>
        <button
          type="button"
          className={`chip ${open ? 'chip-on' : ''}`}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'ปิดฟอร์ม' : '+ นัดใหม่'}
        </button>
      </div>

      {open && (
        <>
          <div className="space-y-2">
            <input
              className="input"
              aria-label="เรื่องที่ประชุม"
              placeholder="เรื่องที่ประชุม"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <input
              className="input"
              aria-label="วันและเวลา"
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
            <div className="rounded-card border border-line p-3">
              <p className="label">ใครต้องเข้าประชุม</p>
              <div className="mb-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`chip ${audMode === 'free' ? 'chip-on' : ''}`}
                  onClick={() => setAudMode('free')}
                >
                  พิมพ์เอง
                </button>
                <button
                  type="button"
                  className={`chip ${audMode === 'list' ? 'chip-on' : ''}`}
                  onClick={() => setAudMode('list')}
                >
                  เลือกจากรายชื่อ
                </button>
              </div>

              {audMode === 'free' ? (
                <>
                  <input
                    className="input"
                    aria-label="ใครต้องเข้า"
                    placeholder="ใครต้องเข้า เช่น sup และ lead"
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-ink-400">
                    แจ้งเตือนไปหาทุกคน และระบบไม่รู้ว่าใครควรมา จึงบอกไม่ได้ว่าใครขาดประชุม
                  </p>
                </>
              ) : (
                <>
                  <AudiencePicker
                    value={aud}
                    onChange={setAud}
                    allHint="ทุกคนในระบบต้องเข้า และนับขาดได้ทุกคน"
                  />
                  <p className="mt-1 text-xs text-ink-400">
                    แบบนี้ระบบรู้รายชื่อที่ต้องมา จึงจับได้ว่าใครมาสายและใครขาด
                  </p>
                </>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                className="input"
                aria-label="สถานที่"
                placeholder="สถานที่"
                value={place}
                onChange={(e) => setPlace(e.target.value)}
              />
              <input
                className="input"
                aria-label="หมายเหตุ"
                placeholder="หมายเหตุ"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>

          {/* ตั้งกรอบเวลาเฉพาะนัดนี้ — ซ่อนไว้ เพราะปกติใช้ค่ากลางก็พอ */}
          <button
            type="button"
            className="mt-2 min-h-tap text-sm underline decoration-line-2"
            onClick={() => setDetail((v) => !v)}
          >
            {detail ? 'ซ่อนการตั้งเวลาเช็คชื่อ' : 'ตั้งเวลาเช็คชื่อเฉพาะนัดนี้'}
          </button>

          {detail && (
            <div className="mt-2 rounded-card border border-line bg-surface-2 p-3">
              <div className="grid grid-cols-2 gap-2">
                <span>
                  <label className="label" htmlFor="mw-open">
                    เช็คก่อนเวลาได้ (นาที)
                  </label>
                  <input
                    id="mw-open"
                    type="number"
                    min={0}
                    max={240}
                    className="input"
                    placeholder="ใช้ค่ากลาง"
                    value={openBefore ?? ''}
                    onChange={(e) =>
                      setOpenBefore(e.target.value === '' ? null : Math.max(Number(e.target.value) || 0, 0))
                    }
                  />
                  <span className="mt-1 block text-xs text-ink-400">
                    0 = กดก่อนไม่ได้ ต้องรอถึงเวลานัด
                  </span>
                </span>
                <span>
                  <label className="label" htmlFor="mw-late">
                    เลยเวลาได้ (นาที)
                  </label>
                  <input
                    id="mw-late"
                    type="number"
                    min={0}
                    max={240}
                    className="input"
                    placeholder="ใช้ค่ากลาง"
                    value={lateAfter ?? ''}
                    onChange={(e) =>
                      setLateAfter(e.target.value === '' ? null : Math.max(Number(e.target.value) || 0, 0))
                    }
                  />
                  <span className="mt-1 block text-xs text-ink-400">
                    0 = ต้องตรงเวลาเป๊ะ เลยวินาทีเดียวก็สาย
                  </span>
                </span>
              </div>

              {when && (openBefore !== null || lateAfter !== null) && (
                <p className="mt-2 rounded-btn bg-brand-50 px-3 py-2 text-sm text-ink-700">
                  {describeWindow(new Date(when), openBefore ?? 15, lateAfter ?? 10).line}
                </p>
              )}

              <p className="mt-2 text-xs text-ink-400">
                เว้นว่างไว้ = ใช้ค่ากลางที่ตั้งในหน้าเว็บ · ตั้งแล้วนัดนี้ถือค่านี้ติดตัวไปตลอด
              </p>
            </div>
          )}

          {error && (
            <p className="mt-2 rounded-btn bg-danger-bg px-3 py-2 text-sm text-danger-txt">{error}</p>
          )}

          <button
            type="button"
            className="btn-primary mt-3 w-full py-3"
            disabled={busy || !title.trim() || !when}
            onClick={() => void save()}
          >
            {busy ? <Spinner /> : null} ประกาศและแจ้งเตือนทุกคน
          </button>
          <p className="mt-1 text-center text-xs text-ink-400">
            ทุกคนจะได้รับแจ้งเตือนทันที · คนที่ไม่ใช่ตำแหน่งที่ระบุจะได้รู้ว่าไม่ต้องมา
            <br />
            และจะเด้งอีกรอบตอนถึงเวลาที่เช็คชื่อได้
          </p>
        </>
      )}

      {rows.length > 0 && (
        <ul className="mt-3 max-h-[180px] space-y-1 overflow-y-auto">
          {rows.map((e) => (
            <li
              key={e.id}
              className={`rounded-card border px-3 py-2 ${
                e.cancelled_at ? 'border-line bg-surface-2 opacity-60' : 'border-line bg-surface'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-display text-sm">
                    {e.title}
                    {e.cancelled_at ? ' · ยกเลิกแล้ว' : ''}
                  </p>
                  <p className="text-xs text-ink-500">
                    {whenTH(e.meet_at)}
                    {e.place ? ` · ${e.place}` : ''}
                    {e.audience ? ` · ${e.audience}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {!e.cancelled_at && (
                    <button
                      type="button"
                      className="btn-soft h-tap px-2 text-xs"
                      disabled={busy}
                      onClick={() => void act(() => cancelMeetingEvent(e.id))}
                    >
                      ยกเลิก
                    </button>
                  )}
                  <button
                    type="button"
                    className="h-tap rounded-btn bg-danger px-2 text-xs text-white"
                    disabled={busy}
                    onClick={() => void act(() => deleteMeetingEvent(e.id))}
                  >
                    ลบ
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
