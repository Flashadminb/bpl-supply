import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAsync } from '../../lib/useAsync'
import { listMeetingEvents, meetingByDept, meetingDaily, meetingStats } from '../../lib/api'
import { ErrorBox, Loading } from '../../components/ui'
import { BarsH, Columns, DataTable, Stat, type Datum } from '../../components/charts'
import { fmtDateTime } from '../../lib/format'

/**
 * แดชบอร์ดประชุม
 *
 * ตอบสามคำถามที่ต่างกัน
 *   วันไหนคนมาเยอะมาน้อย  — กราฟรายวัน
 *   แผนกไหนมากันครบ       — แท่งรายแผนก
 *   ใครไม่เคยมาเลย        — ตารางรายคน เรียงจากน้อยไปมาก
 *
 * ตัวสุดท้ายสำคัญที่สุดและหาที่อื่นไม่ได้ จึงเรียงกลับด้านจากหน้าตรวจสอบ
 * หน้านั้นเรียงคนที่มาบ่อยขึ้นก่อนเพราะกำลังไล่ตรวจรูป
 * หน้านี้เรียงคนที่ไม่มาขึ้นก่อนเพราะกำลังหาว่าใครต้องตาม
 *
 * ตัวเลขทั้งหมดนับที่ฐานข้อมูล ไม่ได้ดึงทุกแถวมานับในเบราว์เซอร์
 */

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

const dayShort = (day: string) => {
  const [, m, d] = day.split('-')
  return `${d}/${m}`
}

export default function MeetingReport() {
  const [month, setMonth] = useState(todayTH().slice(0, 7))
  const range = useMemo(() => monthRange(month), [month])
  const months = useMemo(() => monthOptions(), [])

  const daily = useAsync(() => meetingDaily(range.from, range.to), [range.from, range.to])
  const byDept = useAsync(() => meetingByDept(range.from, range.to), [range.from, range.to])
  const people = useAsync(() => meetingStats(range.from, range.to), [range.from, range.to])
  const events = useAsync(() => listMeetingEvents(range.from, range.to), [range.from, range.to])

  const days = daily.data ?? []
  const depts = byDept.data ?? []
  const persons = people.data ?? []
  const plans = events.data ?? []

  const totals = useMemo(() => {
    const confirmed = days.reduce((n, d) => n + d.confirmed, 0)
    const pending = days.reduce((n, d) => n + d.pending, 0)
    const rejected = days.reduce((n, d) => n + d.rejected, 0)
    const came = persons.filter((p) => p.confirmed > 0).length
    const never = persons.filter((p) => p.total === 0).length
    return { confirmed, pending, rejected, came, never, staff: persons.length }
  }, [days, persons])

  const dailyChart: Datum[] = days.map((d) => ({
    label: d.day,
    value: d.confirmed,
    sub: dayShort(d.day),
  }))

  const deptChart: Datum[] = depts.map((d) => ({ label: d.dept_code, value: d.confirmed }))

  /** คนที่ยังไม่เคยเช็คอินเลยในเดือนนี้ — เรียงขึ้นก่อน เพราะเป็นคนที่ต้องตาม */
  const missing = useMemo(
    () => [...persons].sort((a, b) => a.confirmed - b.confirmed || a.full_name.localeCompare(b.full_name, 'th')),
    [persons],
  )

  return (
    <div className="mx-auto max-w-[1300px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-lg">แดชบอร์ดประชุม</h1>
          <p className="text-sm text-ink-500">สรุปการเข้าประชุมรายเดือน</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input h-tap max-w-[180px]"
            value={month}
            aria-label="เดือน"
            onChange={(e) => setMonth(e.target.value)}
          >
            {months.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
          <Link to="/admin/meetings" className="text-sm underline">
            ไปคิวรอตรวจ
          </Link>
          <Link to="/admin/meeting-evidence" className="text-sm underline">
            ไปหน้าหลักฐาน
          </Link>
        </div>
      </div>

      {(daily.loading || people.loading) && <Loading />}
      {daily.error && <ErrorBox message={daily.error} onRetry={daily.reload} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="เช็คอินที่ยืนยันแล้ว" value={totals.confirmed} hint="ครั้ง" />
        <Stat
          label="รอตรวจ"
          value={totals.pending}
          hint={totals.pending > 0 ? 'ยังไม่ได้กดยืนยัน' : 'ตรวจครบแล้ว'}
          tone={totals.pending > 0 ? 'warn' : 'ok'}
        />
        <Stat label="ตีตก" value={totals.rejected} hint="ไม่นับ" tone={totals.rejected > 0 ? 'danger' : undefined} />
        <Stat label="คนที่เข้าอย่างน้อย 1 ครั้ง" value={totals.came} hint={`จาก ${totals.staff} คน`} />
        <Stat
          label="ไม่เคยเช็คอินเลย"
          value={totals.never}
          hint="ในเดือนนี้"
          tone={totals.never > 0 ? 'danger' : 'ok'}
        />
        <Stat label="นัดที่ประกาศไว้" value={plans.length} hint="ครั้ง" />
      </div>

      <div className="mt-3 panel p-4">
        <h3 className="mb-1 font-display">เช็คอินต่อวัน</h3>
        <p className="mb-3 text-sm text-ink-400">นับเฉพาะที่ยืนยันแล้ว · ชี้ที่แท่งเพื่อดูตัวเลข</p>
        <Columns data={dailyChart} unit="คน" />
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <div className="panel p-4">
          <h3 className="mb-1 font-display">แยกตามแผนก</h3>
          <p className="mb-3 text-sm text-ink-400">จำนวนครั้งที่ยืนยันแล้วในเดือนนี้</p>
          <BarsH data={deptChart} unit="ครั้ง" />
          <DataTable rows={deptChart} head={['แผนก', 'ครั้ง']} />
        </div>

        <div className="panel p-4">
          <h3 className="mb-1 font-display">นัดประชุมที่ประกาศไว้</h3>
          <p className="mb-3 text-sm text-ink-400">ประกาศจากในแอพ · แจ้งเตือนทุกคนแล้ว</p>
          <ul className="space-y-2 text-sm">
            {plans.map((e) => (
              <li key={e.id} className="border-b border-line pb-2 last:border-0">
                <p className={`font-display ${e.cancelled_at ? 'text-ink-300 line-through' : ''}`}>
                  {e.title}
                </p>
                <p className="text-xs text-ink-400">
                  {fmtDateTime(e.meet_at)}
                  {e.place ? ` · ${e.place}` : ''}
                  {e.audience ? ` · ${e.audience}` : ''}
                </p>
              </li>
            ))}
            {plans.length === 0 && (
              <li className="py-4 text-center text-ink-400">ยังไม่มีนัดในเดือนนี้</li>
            )}
          </ul>
        </div>
      </div>

      <section className="mt-3 panel overflow-x-auto p-4">
        <h3 className="mb-1 font-display">รายคน — คนที่เข้าน้อยที่สุดขึ้นก่อน</h3>
        <p className="mb-3 text-sm text-ink-400">
          คนที่ยืนยัน 0 ครั้งคือคนที่ยังไม่มีหลักฐานว่าเข้าประชุมเลยในเดือนนี้
        </p>
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-ink-500">
            <tr className="border-b border-line">
              <th className="px-3 py-2 font-medium">ชื่อ</th>
              <th className="w-[124px] px-3 py-2 font-medium">รหัสพนักงาน</th>
              <th className="w-[150px] px-3 py-2 font-medium">แผนก</th>
              <th className="w-[110px] px-3 py-2 font-medium">ยืนยันแล้ว</th>
              <th className="w-[100px] px-3 py-2 font-medium">รอตรวจ</th>
              <th className="w-[160px] px-3 py-2 font-medium">ล่าสุด</th>
            </tr>
          </thead>
          <tbody>
            {missing.map((s) => (
              <tr
                key={s.user_id}
                className={`border-b border-line last:border-0 ${
                  s.confirmed === 0 ? 'bg-danger-bg/40' : ''
                }`}
              >
                <td className="px-3 py-2">{s.full_name}</td>
                <td className="px-3 py-2 font-mono text-xs">{s.employee_code}</td>
                <td className="px-3 py-2 text-ink-500">
                  {s.dept_code ?? '—'}
                  {s.sub_dept ? ` · ${s.sub_dept}` : ''}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`font-display ${s.confirmed > 0 ? 'text-success-txt' : 'text-danger-txt'}`}
                  >
                    {s.confirmed}
                  </span>
                </td>
                <td className="px-3 py-2 text-warn-txt">{s.pending || ''}</td>
                <td className="px-3 py-2 text-xs text-ink-500">
                  {s.last_at ? fmtDateTime(s.last_at) : <span className="text-ink-300">ไม่เคย</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
