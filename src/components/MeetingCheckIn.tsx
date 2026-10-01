import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { MeetingWindowCard } from './MeetingWindowCard'
import { useAsync } from '../lib/useAsync'
import { listMyMeetings, listUpcomingMeetings, meetingCheckin, meetingWindow } from '../lib/api'
import { readableError } from '../lib/supabase'
import { fmtDateTime } from '../lib/format'
import { Sheet, Spinner } from './ui'
import { PhotoSteps, shotsToPhotos, type Shot } from './PhotoSteps'
import { stampLines } from '../lib/image'
import { MeetingNotices, MeetingPlanner } from './MeetingPlanner'
import { canAudit } from '../lib/roles'

/**
 * เช็คอินเข้าประชุม — ไอคอนเล็ก ๆ ข้างกระดิ่ง ทุกคนเห็น
 *
 * งานนี้ต้องจบในสองแตะ: เปิด ถ่าย ส่ง
 * จึงไม่มีช่องให้กรอกอะไรเลยนอกจากหมายเหตุที่ไม่บังคับ
 * ชื่อ เวลา แผนก กะ ฐานข้อมูลเติมให้เองจากโปรไฟล์
 *
 * เวลาที่บันทึกเป็นเวลาของเซิร์ฟเวอร์ ไม่ใช่นาฬิกาในเครื่อง
 * ส่วนเวลาที่ปั๊มบนรูปเป็นของเครื่อง มีไว้ให้คนอ่านด้วยตา
 * ถ้าสองอันไม่ตรงกันมาก ๆ แปลว่านาฬิกาเครื่องนั้นถูกตั้งเอง — ผู้ตรวจสอบจะเห็น
 */
export function MeetingCheckIn() {
  const { profile } = useAuth()
  const [open, setOpen] = useState(false)
  const [shots, setShots] = useState<Shot[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ ref: string; at: string; dup: boolean } | null>(null)

  const mine = useAsync(() => (open ? listMyMeetings(10) : Promise.resolve([])), [open, done])
  // ประกาศนัดประชุม ทุกคนเห็น · ฟอร์มนัดเห็นเฉพาะคนที่ตรวจสอบได้
  const [planTick, setPlanTick] = useState(0)
  const events = useAsync(
    () => (open ? listUpcomingMeetings(5) : Promise.resolve([])),
    [open, planTick],
  )
  const mayPlan = canAudit(profile)

  // นัดที่กำลังอยู่ในกรอบเวลา · โหลดตอนเปิดแผ่นเท่านั้น
  const win = useAsync(() => (open ? meetingWindow() : Promise.resolve(null)), [open, done])

  /**
   * ยังไม่ถึงเวลา = ปิดปุ่มส่งไว้ก่อน
   * ฐานข้อมูลปฏิเสธให้อยู่แล้ว แต่ถ้าปล่อยให้กดได้ เขาจะถ่ายรูปเสร็จแล้วค่อยโดนปฏิเสธ
   * ซึ่งเสียเวลาเปล่าและดูเหมือนระบบพัง
   */
  const tooEarly = win.data?.phase === 'soon'

  /**
   * ปิดกล้องเมื่อยังไม่ถึงเวลา หรือไม่มีนัดเลย
   *
   * รอให้โหลดกรอบเวลาเสร็จก่อน ไม่งั้นจอจะวาบเป็นข้อความห้ามแล้วค่อยเปิดกล้อง
   * ซึ่งคนหน้างานจะกดปิดทิ้งไปก่อนที่มันจะเปิด
   */
  const blocked = !win.loading && (tooEarly || !win.data)

  const photos = shotsToPhotos(shots)
  const uploading = shots.some((s) => s.state === 'uploading' || s.state === 'ready')
  const failed = shots.some((s) => s.state === 'failed')
  const ready = photos.length >= 1 && !uploading && !failed

  // ปั๊มเวลาลงบนรูปด้วย ให้ผู้ตรวจสอบเทียบกับเวลาที่ระบบบันทึกได้ด้วยตา
  const stamp = stampLines(
    profile?.full_name ?? '',
    profile?.employee_code ?? '',
    profile?.dept_code ?? profile?.hub_code ?? 'BPL',
    'เช็คอินประชุม',
  )

  function reset() {
    setShots([])
    setNote('')
    setError(null)
    setDone(null)
  }

  async function submit() {
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      const res = await meetingCheckin({
        fileId: photos[0].file_id,
        webLink: photos[0].web_link,
        bytes: photos[0].bytes,
        note: note.trim() || null,
      })
      setDone({ ref: res.ref_no, at: res.created_at, dup: res.duplicate })
      setShots([])
      setNote('')
    } catch (e) {
      setError(readableError(e))
    } finally {
      setBusy(false)
    }
  }

  const history = mine.data ?? []

  return (
    <>
      <button
        type="button"
        aria-label="เช็คอินเข้าประชุม"
        title="เช็คอินเข้าประชุม"
        className="relative flex h-tap w-tap items-center justify-center rounded-btn bg-ink/10 text-lg"
        onClick={() => {
          reset()
          setOpen(true)
        }}
      >
        <span aria-hidden>📋</span>
      </button>

      <Sheet
        open={open}
        title="เช็คอินเข้าประชุม"
        onClose={() => {
          setOpen(false)
          reset()
        }}
      >
        {done ? (
          <>
            <div className="rounded-card border border-success/30 bg-success-bg p-4 text-center">
              <p className="font-display text-md text-success-txt">
                {done.dup ? 'เช็คอินไปแล้วเมื่อสักครู่' : 'เช็คอินเรียบร้อย'}
              </p>
              <p className="mt-1 text-sm text-success-txt">
                {profile?.full_name} · {fmtDateTime(done.at)}
              </p>
              <p className="mt-1 font-mono text-xs text-success-txt opacity-80">{done.ref}</p>
              {done.dup && (
                <p className="mt-2 text-xs text-success-txt">
                  ระบบกันกดซ้ำภายใน 10 นาที จึงใช้ใบเดิม ไม่ได้นับซ้ำ
                </p>
              )}
            </div>
            <button
              type="button"
              className="btn-primary mt-3 w-full py-3"
              onClick={() => {
                setOpen(false)
                reset()
              }}
            >
              เสร็จแล้ว
            </button>
          </>
        ) : (
          <>
            {win.data && <MeetingWindowCard win={win.data} />}

            <MeetingNotices rows={events.data ?? []} />

            {/* ยังไม่ถึงเวลา = ปิดกล้องด้วย ไม่ใช่ปิดแค่ปุ่มส่ง
                PhotoSteps อัปรูปขึ้น Drive ทันทีที่ถ่าย ไม่ได้รอกดส่ง
                ปล่อยให้ถ่ายก่อนเวลาจึงเป็นการอัปรูปที่ใช้ไม่ได้ขึ้นไปกินที่ฟรี ๆ
                และคนถ่ายก็เสียเวลาถ่ายเสร็จแล้วค่อยรู้ว่ากดส่งไม่ได้ */}
            {blocked ? (
              <p className="rounded-card border border-warn/30 bg-warn-bg p-3 text-sm text-warn-txt">
                {tooEarly
                  ? 'ยังไม่ถึงเวลาเช็คชื่อ · กล้องจะเปิดให้เองเมื่อถึงเวลาที่ประกาศไว้'
                  : 'ตอนนี้ไม่มีนัดประชุมที่เช็คชื่อได้ · รอประกาศจากผู้ตรวจสอบ'}
              </p>
            ) : (
              <>
                <p className="mb-3 text-sm text-ink-500">
                  ถ่ายเซลฟี่ตัวเองหนึ่งรูปเป็นหลักฐาน แล้วกดส่ง
                  <br />
                  ชื่อและเวลาระบบบันทึกให้เอง ไม่ต้องกรอกอะไร
                </p>

                <PhotoSteps steps={[]} maxFree={1} stamp={stamp} shots={shots} onShots={setShots} />
              </>
            )}

            <label className="label mt-3" htmlFor="mt-note">
              หมายเหตุ (ไม่บังคับ)
            </label>
            <input
              id="mt-note"
              className="input"
              placeholder="เช่น เข้าสาย 10 นาที"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />

            {error && (
              <p className="mt-3 rounded-btn bg-danger-bg px-3 py-2 text-sm text-danger-txt">
                {error}
              </p>
            )}

            <button
              type="button"
              className="btn-primary mt-4 w-full py-4 text-md"
              disabled={busy || !ready || blocked}
              onClick={() => void submit()}
            >
              {busy ? <Spinner /> : null}
              {tooEarly
                ? 'ยังไม่ถึงเวลาเช็คชื่อ'
                : ready
                  ? win.data?.phase === 'late'
                    ? 'ส่งเช็คอิน (จะบันทึกว่าสาย)'
                    : 'ส่งเช็คอิน'
                  : failed
                    ? 'รูปส่งไม่สำเร็จ กดที่รูปเพื่อลองใหม่'
                    : uploading
                      ? 'กำลังส่งรูป…'
                      : 'ถ่ายรูปก่อน'}
            </button>

            {history.length > 0 && (
              <section className="mt-5">
                <h3 className="mb-2 font-display text-sm text-ink-500">เช็คอินล่าสุดของคุณ</h3>
                <ul className="space-y-1 text-sm">
                  {history.slice(0, 5).map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center justify-between gap-2 rounded-card border border-line px-3 py-2"
                    >
                      <span className="text-ink-700">{fmtDateTime(m.created_at)}</span>
                      <span
                        className={
                          m.status === 'confirmed'
                            ? 'badge-ok'
                            : m.status === 'rejected'
                              ? 'badge-dang'
                              : 'badge-mute'
                        }
                      >
                        {m.status === 'confirmed'
                          ? 'ยืนยันแล้ว'
                          : m.status === 'rejected'
                            ? 'ไม่นับ'
                            : 'รอตรวจ'}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {mayPlan && <MeetingPlanner onChanged={() => setPlanTick((n) => n + 1)} />}
          </>
        )}
      </Sheet>
    </>
  )
}
