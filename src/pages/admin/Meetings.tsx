import { useMemo, useState } from 'react'
import { DateRangePicker } from '../../components/DateRangePicker'
import { MeetingSets } from '../../components/MeetingSets'
import { useAsync } from '../../lib/useAsync'
import { meetingStats } from '../../lib/api'
import { EmptyState, ErrorBox, Loading } from '../../components/ui'
import { fmtDateTime } from '../../lib/format'

/**
 * รายชื่อประชุม — หน้าตรวจสอบ
 *
 * สองมุมของข้อมูลเดียวกัน แยกแท็บเพราะตอบคนละคำถาม
 *   ใบเช็คอิน  "ประชุมนัดนี้ใครมา ใครสาย ใครขาด และรูปน่าเชื่อถือไหม"
 *   สรุปรายคน  "เดือนนี้ใครมากี่ครั้ง และใครไม่เคยมาเลย"
 *
 * เดิมมีสามแท็บ เพราะใบเช็คอินกับรายชื่อตามนัดแยกกันอยู่
 * ซึ่งทำให้ของที่ต้องดูพร้อมกันอยู่คนละที่ — รูปกับโน้ตอยู่ฝั่งใบ
 * แต่คนที่ขาดประชุมโผล่แค่ฝั่งตามนัด เพราะคนที่ไม่มาไม่มีใบ
 * ตอนนี้รวมเป็นแผ่นเดียวต่อนัด อยู่ใน MeetingSets
 *
 * สรุปรายคนนับคนที่ไม่เคยเช็คอินด้วย เพราะคำถามจริงคือ "ใครหาย"
 * ถ้าโชว์แต่คนที่มา คนที่ไม่มาจะไม่ปรากฏตัวที่ไหนเลย
 */

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

export default function Meetings() {
  // ตั้งต้นที่ใบเช็คอิน เพราะคำถามแรกคือ "ประชุมนี้ใครมาใครไม่มา"
  const [tab, setTab] = useState<'sets' | 'stats'>('sets')
  const [month, setMonth] = useState(todayTH().slice(0, 7))
  // ช่วงวันแบบปฏิทิน · ว่าง = ใช้ทั้งเดือนตามเดิม
  const [fromDay, setFromDay] = useState('')
  const [toDay, setToDay] = useState('')
  const [search, setSearch] = useState('')

  const range = useMemo(() => monthRange(month), [month])
  const months = useMemo(() => monthOptions(), [])

  const stats = useAsync(() => meetingStats(range.from, range.to), [range.from, range.to])

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

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-lg">รายชื่อประชุม</h1>
          <p className="text-sm text-ink-500">
            เปิดนัดแล้วจบงานของนัดนั้นในที่เดียว · ดูรูป แก้สถานะ ปิดประชุม
            <br />
            ใบที่ยืนยันแล้วจะไปอยู่หน้า หลักฐานการเข้าประชุม
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`chip ${tab === 'sets' ? 'chip-on' : ''}`}
            onClick={() => setTab('sets')}
          >
            ใบเช็คอิน
          </button>
          <button
            type="button"
            className={`chip ${tab === 'stats' ? 'chip-on' : ''}`}
            onClick={() => setTab('stats')}
          >
            สรุปรายคน
          </button>
          <button
            type="button"
            className="btn-soft h-tap px-3 text-sm"
            onClick={() => stats.reload()}
          >
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
              setFromDay('')
              setToDay('')
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
          <DateRangePicker
            from={fromDay || range.from}
            to={toDay || range.to}
            label="ช่วงวันที่"
            onChange={(f, t) => {
              setFromDay(f)
              setToDay(t)
            }}
          />
        </div>

        <input
          className="input h-tap max-w-[260px]"
          type="search"
          placeholder="ค้นหาชื่อ รหัสพนักงาน หรือแผนก"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* --------------------------------------------------------- ใบเช็คอิน */}
      {tab === 'sets' && <MeetingSets from={fromDay || range.from} to={toDay || range.to} />}

      {/* --------------------------------------------------------- สรุปรายคน */}
      {tab === 'stats' && (
        <>
          {stats.loading && <Loading />}
          {stats.error && <ErrorBox message={stats.error} onRetry={stats.reload} />}

          {!stats.loading && !stats.error && statRows.length === 0 && (
            <EmptyState
              title="ไม่มีข้อมูลตามตัวกรอง"
              hint="ลองเปลี่ยนเดือน หรือล้างคำค้นหา"
            />
          )}

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
                        {s.last_at ? (
                          fmtDateTime(s.last_at)
                        ) : (
                          <span className="text-ink-300">ยังไม่เคยเช็คอิน</span>
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
    </div>
  )
}
