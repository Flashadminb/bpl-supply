import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAsync } from '../../lib/useAsync'
import { listWaitLog, LOG_EVENT_TH, type WaitLogEvent } from '../../lib/waitTrucks'
import { DateRangePicker } from '../../components/DateRangePicker'
import { BG, CARD, DIM, INSET, LINE, WaitLogo } from './parts'
import { p2 } from '../trucks/parts'

/**
 * ประวัติว่าใครทำอะไร · แบบเดียวกับหน้าประวัติของตารางปล่อยรถ
 *
 * ไม่มีตารางล็อกแยกในฐานข้อมูล · วิว wait_truck_log_rows แตกแถวของรถหนึ่งคัน
 * ออกเป็นหลายบรรทัดตามเหตุการณ์ที่เกิดกับมัน
 *
 * หน้านี้มีไว้ตอบคำถามเดียว — "คันนี้ใครกด และกดตอนไหน"
 * ซึ่งเป็นคำถามที่จะถูกถามตอนตัวเลขในรายงานไม่ตรงกับที่หัวหน้าจำได้
 */

const EVENT_COLOR: Record<WaitLogEvent, string> = {
  import: '#2F7FE0',
  done: '#25A35A',
  cancel: '#E5484D',
}

const todayKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${p2(dt.getMonth() + 1)}-${p2(dt.getDate())}`
}

const stamp = (iso: string) => {
  const d = new Date(iso)
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)} ${p2(d.getHours())}:${p2(d.getMinutes())}`
}

export default function WaitLog() {
  const nav = useNavigate()
  const [from, setFrom] = useState(() => addDays(todayKey(), -2))
  const [to, setTo] = useState(todayKey)
  const [kinds, setKinds] = useState<Set<WaitLogEvent>>(
    () => new Set<WaitLogEvent>(['import', 'done', 'cancel']),
  )
  const [q, setQ] = useState('')

  const log = useAsync(() => listWaitLog(from, to), [from, to])
  const all = log.data ?? []

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase()
    return all.filter(
      (r) =>
        kinds.has(r.event) &&
        (k === '' ||
          [r.truck_barcode, r.from_station, r.plate, r.vehicle_type, r.who].some((v) =>
            (v ?? '').toLowerCase().includes(k),
          )),
    )
  }, [all, kinds, q])

  function toggle(e: WaitLogEvent) {
    setKinds((s) => {
      const next = new Set(s)
      if (next.has(e)) next.delete(e)
      else next.add(e)
      return next
    })
  }

  return (
    <div className="min-h-dvh px-3 pb-20 pt-3 text-white" style={{ background: BG }}>
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => nav('/wait')}
            className="h-11 shrink-0 rounded-xl px-3 text-[13px] font-bold"
            style={{ background: CARD, border: `1px solid ${LINE}` }}
          >
            ← กระดาน
          </button>
          <WaitLogo size={18} title="ประวัติรถรอลงงาน" />
          <span className="ml-auto">
            <DateRangePicker
              from={from}
              to={to}
              onChange={(a, b) => {
                setFrom(a)
                setTo(b)
              }}
            />
          </span>
        </header>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          {(Object.keys(LOG_EVENT_TH) as WaitLogEvent[]).map((e) => {
            const on = kinds.has(e)
            return (
              <button
                key={e}
                onClick={() => toggle(e)}
                className="h-11 rounded-xl px-3 text-[13px] font-bold"
                style={
                  on
                    ? { background: EVENT_COLOR[e], color: '#fff' }
                    : { background: CARD, border: `1px solid ${LINE}`, color: DIM }
                }
              >
                {LOG_EVENT_TH[e]}
              </button>
            )
          })}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหา บาร์โค้ด ทะเบียน สาขา หรือชื่อคนกด"
            className="h-11 min-w-[220px] flex-1 rounded-xl px-3 text-sm font-bold outline-none"
            style={{ background: CARD, border: `1px solid ${LINE}`, color: '#EAF0F7' }}
          />
        </div>

        {log.loading && <p className="py-16 text-center text-sm" style={{ color: DIM }}>กำลังโหลด…</p>}
        {log.error && (
          <p className="py-16 text-center text-sm" style={{ color: '#FFB4B6' }}>{log.error}</p>
        )}

        {!log.loading && !log.error && shown.length === 0 && (
          <p className="py-16 text-center text-sm" style={{ color: DIM }}>
            ช่วงนี้ยังไม่มีประวัติ
          </p>
        )}

        {shown.length > 0 && (
          <div className="overflow-x-auto rounded-2xl" style={{ background: CARD, border: `1px solid ${LINE}` }}>
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr style={{ color: DIM }}>
                  {['เมื่อไหร่', 'ทำอะไร', 'ประเภท', 'ทะเบียน', 'สถานีก่อนหน้า', 'บาร์โค้ด', 'ผล', 'ใครกด'].map(
                    (h) => (
                      <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-bold">{h}</th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={`${r.truck_id}-${r.event}-${i}`} className="border-t" style={{ borderColor: LINE }}>
                    <td className="whitespace-nowrap px-3 py-2 font-mono font-bold">{stamp(r.at)}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span
                        className="rounded-md px-2 py-[2px] text-[12px] font-extrabold"
                        style={{ background: EVENT_COLOR[r.event], color: '#fff' }}
                      >
                        {LOG_EVENT_TH[r.event]}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-extrabold">{r.vehicle_type ?? '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-extrabold">{r.plate ?? '—'}</td>
                    <td className="max-w-[240px] truncate px-3 py-2">{r.from_station ?? '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2" style={{ color: DIM }}>{r.truck_barcode}</td>
                    <td className="px-3 py-2">
                      {r.event === 'done' &&
                        (r.late_min === 0 ? (
                          <span className="font-bold" style={{ color: '#35D98A' }}>ทันเวลา</span>
                        ) : (
                          <span className="font-bold" style={{ color: '#FF8A8A' }}>
                            เกิน {r.late_min} นาที
                          </span>
                        ))}
                      {r.event === 'cancel' && (
                        <span style={{ color: '#FFB4B6' }}>{r.reason ?? '—'}</span>
                      )}
                    </td>
                    <td className="max-w-[160px] truncate px-3 py-2" style={{ color: DIM }}>
                      {r.who ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-center text-[12px]" style={{ color: DIM }}>
          แสดง {shown.length} บรรทัด จากทั้งหมด {all.length} บรรทัดในช่วงที่เลือก
        </p>

        <div className="mt-4 rounded-xl p-3 text-[12px]" style={{ background: INSET, color: DIM }}>
          ประวัตินี้อ่านจากแถวของรถโดยตรง ไม่ได้เก็บเป็นตารางล็อกแยก
          จึงไม่มีทางที่ประวัติกับกระดานจะไม่ตรงกัน
        </div>
      </div>
    </div>
  )
}
