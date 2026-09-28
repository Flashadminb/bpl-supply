import { useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/useAsync'
import {
  createAnnouncement,
  getSetting,
  listAnnouncements,
  retireAnnouncement,
  setSetting,
} from '../../lib/api'
import { readableError } from '../../lib/supabase'
import { EmptyState, ErrorBox, Loading, Spinner } from '../../components/ui'
import { fmtDateTime } from '../../lib/format'
import { MeetingPlanner } from '../../components/MeetingPlanner'
import { describeWindow } from '../../lib/meetingWindow'
import type { NoticeLevel } from '../../lib/types'

/**
 * ประกาศและแจ้งเตือน
 *
 * สามแท็บที่เปิดสิทธิ์ไม่เท่ากัน ตามที่เจ้าของระบบกำหนด
 *   ป้ายประกาศ — เจ้าของ แอดมิน ผู้ตรวจสอบ
 *   นัดประชุม  — เจ้าของ ผู้ตรวจสอบ (แอดมินไม่เห็น)
 *   กฎเวลา     — เจ้าของ ผู้ตรวจสอบ (แอดมินไม่เห็น)
 *
 * กฎเวลาเป็นค่าตั้งต้นกลาง ใช้ตอนสร้างนัดใหม่เท่านั้น
 * นัดที่ประกาศไปแล้วถือกติกาของตัวเองติดตัวไว้ ไม่เปลี่ยนตามทีหลัง
 * ไม่งั้นคนที่เช็คชื่อทันแล้วอาจกลายเป็นสายย้อนหลังโดยไม่รู้ตัว
 */

const LEVELS: { key: NoticeLevel; label: string; hint: string }[] = [
  { key: 'urgent', label: 'ด่วน', hint: 'แดง · ขึ้นบนสุดเสมอ' },
  { key: 'warn', label: 'เตือน', hint: 'เหลือง · เรื่องที่ต้องรีบทำ' },
  { key: 'info', label: 'ทั่วไป', hint: 'ขาว · แจ้งให้ทราบ' },
]

type Tab = 'board' | 'meet' | 'rules'

export default function Notices() {
  const { can, profile } = useAuth()
  // แอดมินเห็นเฉพาะป้ายประกาศ ส่วนนัดประชุมกับกฎเวลาเป็นของเจ้าของกับผู้ตรวจสอบ
  const mayMeet = can('admin') || Boolean(profile?.can_dispatch)

  const [tab, setTab] = useState<Tab>('board')
  const feed = useAsync(() => listAnnouncements(true), [])

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [level, setLevel] = useState<NoticeLevel>('info')
  const [days, setDays] = useState(3)
  const [notify, setNotify] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const rules = useAsync(
    async () => ({
      open: (await getSetting<number>('meeting_open_before_min')) ?? 15,
      late: (await getSetting<number>('meeting_late_after_min')) ?? 10,
    }),
    [],
  )
  const [openMin, setOpenMin] = useState<number | null>(null)
  const [lateMin, setLateMin] = useState<number | null>(null)
  const [ruleBusy, setRuleBusy] = useState(false)

  /** ตัวอย่างกรอบเวลาของนัดบ่ายสอง — คิดด้วย Date ทั้งก้อน ไม่แยกชั่วโมงกับนาที */
  const sample = (() => {
    const at = new Date()
    at.setHours(14, 0, 0, 0)
    return describeWindow(at, openMin ?? rules.data?.open ?? 15, lateMin ?? rules.data?.late ?? 10)
  })()

  const rows = feed.data ?? []
  const live = rows.filter((a) => new Date(a.expires_at) > new Date())
  const past = rows.filter((a) => new Date(a.expires_at) <= new Date())

  async function post() {
    if (!title.trim()) {
      setErr('ต้องใส่หัวข้อประกาศ')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      await createAnnouncement({ title, body, level, days, notify })
      setTitle('')
      setBody('')
      setLevel('info')
      setDays(3)
      setNotify(true)
      setDone(notify ? 'ประกาศแล้ว · แจ้งเตือนกำลังทยอยส่ง' : 'ประกาศแล้ว · ไม่ได้ส่งแจ้งเตือน')
      feed.reload()
    } catch (e) {
      setErr(readableError(e))
    } finally {
      setBusy(false)
    }
  }

  async function retire(id: string) {
    setErr(null)
    try {
      await retireAnnouncement(id)
      feed.reload()
    } catch (e) {
      setErr(readableError(e))
    }
  }

  async function saveRules() {
    setRuleBusy(true)
    setErr(null)
    try {
      await setSetting('meeting_open_before_min', openMin ?? rules.data?.open ?? 15)
      await setSetting('meeting_late_after_min', lateMin ?? rules.data?.late ?? 10)
      setDone('บันทึกกฎเวลาแล้ว · มีผลกับนัดที่สร้างหลังจากนี้')
      rules.reload()
    } catch (e) {
      setErr(readableError(e))
    } finally {
      setRuleBusy(false)
    }
  }

  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: 'board', label: 'ป้ายประกาศ', show: true },
    { key: 'meet', label: 'นัดประชุม', show: mayMeet },
    { key: 'rules', label: 'กฎเวลาเช็คชื่อ', show: mayMeet },
  ]

  return (
    <div className="mx-auto max-w-[900px]">
      <h1 className="mb-4 font-display text-lg">ประกาศและแจ้งเตือน</h1>

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.key}
              type="button"
              className={`h-tap rounded-btn px-3 text-sm ${
                tab === t.key ? 'bg-ink text-white' : 'btn-soft'
              }`}
              onClick={() => {
                setErr(null)
                setDone(null)
                setTab(t.key)
              }}
            >
              {t.label}
            </button>
          ))}
      </div>

      {done && (
        <p className="mb-3 rounded-card bg-success-bg px-3 py-2 text-sm text-success-txt">
          {done}
          <button type="button" className="ml-2 underline" onClick={() => setDone(null)}>
            ปิด
          </button>
        </p>
      )}
      {err && (
        <div className="mb-3">
          <ErrorBox message={err} />
        </div>
      )}

      {/* ====================================================== ป้ายประกาศ */}
      {tab === 'board' && (
        <>
          <section className="panel mb-4 p-4">
            <h2 className="mb-3 font-display text-md">ประกาศเรื่องใหม่</h2>

            <label className="label" htmlFor="an-title">
              หัวข้อ
            </label>
            <input
              id="an-title"
              className="input"
              placeholder="เช่น งดเบิกของวันนี้"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />

            <label className="label mt-3" htmlFor="an-body">
              รายละเอียด (ไม่บังคับ)
            </label>
            <textarea
              id="an-body"
              rows={3}
              className="input py-2"
              placeholder="เช่น ระบบกำลังตรวจนับสต็อก เบิกได้อีกครั้งพรุ่งนี้ 08:00"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />

            <p className="label mt-3">ระดับความสำคัญ</p>
            <div className="flex flex-wrap gap-2">
              {LEVELS.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  title={l.hint}
                  className={`chip ${level === l.key ? 'chip-on' : ''}`}
                  onClick={() => setLevel(l.key)}
                >
                  {l.label}
                </button>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-4">
              <span>
                <label className="label" htmlFor="an-days">
                  หายเองใน (วัน)
                </label>
                <input
                  id="an-days"
                  type="number"
                  min={1}
                  max={60}
                  className="input w-[120px]"
                  value={days}
                  onChange={(e) => setDays(Math.max(Number(e.target.value) || 1, 1))}
                />
              </span>
              <label className="flex items-center gap-2 pb-2">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={notify}
                  onChange={(e) => setNotify(e.target.checked)}
                />
                <span className="text-sm">ส่งแจ้งเตือนเข้ามือถือทุกคน</span>
              </label>
            </div>

            <p className="mt-2 text-xs text-ink-400">
              ประกาศจะหายจากหน้าแอพเองเมื่อครบกำหนด ไม่ต้องมาตามลบ
              <br />
              หน้าแรกโชว์สามเรื่องแรก ที่เหลือพับไว้ใต้ปุ่ม — ป้ายที่ค้างเป็นสิบอันคือป้ายที่ไม่มีใครอ่าน
              <br />
              คนที่เปิดรับแจ้งเตือนไว้เท่านั้นที่จะได้เสียงเด้ง ส่วนป้ายในแอพทุกคนเห็นหมด
            </p>

            <div className="mt-4 flex justify-end">
              <button type="button" className="btn-primary" disabled={busy} onClick={() => void post()}>
                {busy ? <Spinner /> : null} ประกาศ
              </button>
            </div>
          </section>

          {feed.loading && <Loading />}
          {feed.error && <ErrorBox message={feed.error} onRetry={feed.reload} />}

          {!feed.loading && live.length === 0 && (
            <EmptyState title="ยังไม่มีประกาศที่ใช้งานอยู่" hint="ประกาศใหม่ได้จากกล่องด้านบน" />
          )}

          {live.length > 0 && (
            <section className="panel overflow-x-auto p-2">
              <h2 className="px-2 pb-2 pt-1 font-display text-md">กำลังแสดงอยู่</h2>
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-ink-500">
                  <tr className="border-b border-line">
                    <th className="p-2 font-medium">ระดับ</th>
                    <th className="p-2 font-medium">เรื่อง</th>
                    <th className="p-2 font-medium">หายเมื่อ</th>
                    <th className="p-2 font-medium">แจ้งเตือน</th>
                    <th className="p-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {live.map((a) => (
                    <tr key={a.id} className="border-b border-line align-top last:border-0">
                      <td className="p-2">
                        <span
                          className={
                            a.level === 'urgent'
                              ? 'badge-dang'
                              : a.level === 'warn'
                                ? 'badge-warn'
                                : 'badge-mute'
                          }
                        >
                          {LEVELS.find((l) => l.key === a.level)?.label ?? a.level}
                        </span>
                      </td>
                      <td className="p-2">
                        <p className="font-display">{a.title}</p>
                        {a.body && (
                          <p className="whitespace-pre-line text-xs text-ink-400">{a.body}</p>
                        )}
                      </td>
                      <td className="p-2 text-xs text-ink-500">{fmtDateTime(a.expires_at)}</td>
                      <td className="p-2 text-xs text-ink-500">{a.notify ? 'ส่งแล้ว' : 'ไม่ส่ง'}</td>
                      <td className="p-2 text-right">
                        <button
                          type="button"
                          className="btn-soft h-tap px-3 text-sm"
                          onClick={() => void retire(a.id)}
                        >
                          เก็บตอนนี้
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {past.length > 0 && (
            <section className="panel mt-3 p-2">
              <h2 className="px-2 pb-2 pt-1 font-display text-md text-ink-500">
                หมดอายุแล้ว {past.length} เรื่อง
              </h2>
              <ul className="space-y-1 px-2 pb-2 text-sm text-ink-400">
                {past.slice(0, 20).map((a) => (
                  <li key={a.id}>
                    {a.title} · {fmtDateTime(a.expires_at)}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {/* ====================================================== นัดประชุม */}
      {tab === 'meet' && mayMeet && (
        <section className="panel p-4">
          <MeetingPlanner onChanged={() => setDone('ปรับรายการนัดแล้ว')} />
        </section>
      )}

      {/* ==================================================== กฎเวลาเช็คชื่อ */}
      {tab === 'rules' && mayMeet && (
        <section className="panel p-4">
          <h2 className="mb-1 font-display text-md">กฎเวลาเช็คชื่อ</h2>
          <p className="mb-3 text-sm text-ink-500">
            ค่าตั้งต้นที่ใช้ตอนสร้างนัดใหม่ · ปรับรายนัดได้ตอนกดประกาศ
          </p>

          {rules.loading && <Loading />}
          {rules.data && (
            <>
              <div className="flex flex-wrap gap-4">
                <span>
                  <label className="label" htmlFor="r-open">
                    เปิดให้เช็คชื่อก่อนเวลา (นาที)
                  </label>
                  <input
                    id="r-open"
                    type="number"
                    min={0}
                    max={240}
                    className="input w-[160px]"
                    value={openMin ?? rules.data.open}
                    onChange={(e) => setOpenMin(Math.max(Number(e.target.value) || 0, 0))}
                  />
                  <span className="mt-1 block text-xs text-ink-400">
                    ใส่ 0 = กดก่อนเวลาไม่ได้ ต้องรอให้ถึงเวลานัดก่อน
                  </span>
                </span>
                <span>
                  <label className="label" htmlFor="r-late">
                    เลยเวลากี่นาทีถือว่าสาย
                  </label>
                  <input
                    id="r-late"
                    type="number"
                    min={0}
                    max={240}
                    className="input w-[160px]"
                    value={lateMin ?? rules.data.late}
                    onChange={(e) => setLateMin(Math.max(Number(e.target.value) || 0, 0))}
                  />
                  <span className="mt-1 block text-xs text-ink-400">
                    ใส่ 0 = ต้องตรงเวลาเป๊ะ เลยวินาทีเดียวก็สาย
                  </span>
                </span>
              </div>

              <div className="mt-3 rounded-card bg-brand-50 px-3 py-2 text-sm text-ink-700">
                ถ้านัดบ่ายสอง (14:00) ด้วยค่านี้จะได้ว่า
                <br />
                <b>{sample.line}</b>
              </div>

              <p className="mt-2 text-xs text-ink-400">
                พอถึงเวลาที่เช็คได้ ระบบจะเด้งเตือนทุกคนอีกรอบว่า “เช็คชื่อได้แล้ว”
                พร้อมบอกว่าเช็คได้ถึงกี่โมง — นาฬิกาเดินทุก 5 นาที แจ้งเตือนจึงคลาดได้ถึง 5 นาที
                <br />
                นัดที่ประกาศไปแล้วถือกติกาของตัวเองติดตัวไว้ การแก้ตรงนี้ไม่ย้อนไปเปลี่ยนของเก่า —
                ไม่งั้นคนที่เช็คชื่อทันแล้วอาจกลายเป็นสายย้อนหลังโดยไม่รู้ตัว
              </p>

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={ruleBusy}
                  onClick={() => void saveRules()}
                >
                  {ruleBusy ? <Spinner /> : null} บันทึกกฎเวลา
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {!mayMeet && tab !== 'board' && (
        <EmptyState title="เข้าไม่ได้" hint="ส่วนนี้เปิดให้เจ้าของระบบและผู้ตรวจสอบเท่านั้น" />
      )}
    </div>
  )
}
