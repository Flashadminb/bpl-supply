import { useEffect, useMemo, useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import { listTruckBoard, listTruckDone, secondsLeft } from '../../lib/trucks'
import { Countdown, DAY_TH, Density, dmy, hm, p2, tone } from './parts'

/**
 * โหมดจอทีวี — เปิดค้างบนจอในคลัง
 *
 * คนอ่านจอนี้จากระยะสามถึงห้าเมตร ไม่ใช่ระยะมือถือ
 * ทุกอย่างจึงใหญ่กว่าหน้ากระดานราวสองเท่า และไม่มีปุ่มอะไรให้กดเลย
 * จอที่มีปุ่มคือจอที่วันหนึ่งจะมีคนเดินมากดโดยไม่ตั้งใจ
 *
 * โชว์แค่สี่คันที่ด่วนที่สุด ไม่ใช่ทั้งหมด
 * เพราะจอที่แสดงหกสิบคันเท่ากับจอที่ไม่ได้บอกอะไรเลย
 */

const ROTATE_MS = 20_000

export default function TruckTv() {
  const [tick, setTick] = useState(0)
  const board = useAsync(() => listTruckBoard(), [tick])

  const since = useMemo(() => new Date(Date.now() - 24 * 3600_000).toISOString(), [tick])
  const done = useAsync(() => listTruckDone(since, new Date().toISOString()), [since])

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  // จอนี้เปิดค้าง 24 ชั่วโมง ดึงถี่กว่านี้คือกินโควตา egress เปล่า ๆ
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  // สลับหน้าเองทุก 20 วินาที · ไม่มีใครเดินมากดเปลี่ยนหน้าให้
  const [page, setPage] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setPage((p) => (p + 1) % 2), ROTATE_MS)
    return () => clearInterval(t)
  }, [])

  const live = useMemo(
    () =>
      (board.data ?? [])
        .map((r) => ({ r, sec: secondsLeft(r.due_at, now) }))
        .sort((a, b) => a.sec - b.sec),
    [board.data, now],
  )
  const d = done.data ?? []
  const onTime = d.filter((x) => x.on_time).length
  const pct = d.length ? Math.round((onTime / d.length) * 100) : null
  const over = live.filter((x) => x.sec < 0).length
  const clock = new Date(now)

  return (
    <div className="min-h-dvh px-7 py-6" style={{ background: '#0B0E11', color: '#F0F4F9' }}>
      <header className="mb-5 flex items-center gap-4">
        <span
          className="rounded-lg px-3 py-1.5 text-xl font-extrabold"
          style={{ background: '#FFC400', color: '#0B0E11' }}
        >
          FLASH
        </span>
        <span className="text-3xl font-extrabold">ตารางปล่อยรถ 21BPL</span>
        <span className="flex-1" />
        <span className="text-xl" style={{ color: '#AFC0D4' }}>
          {DAY_TH[clock.getDay()]} {dmy(clock)}
        </span>
        <span className="font-mono text-5xl font-extrabold" style={{ color: '#FFC400' }}>
          {hm(clock)}
          <span className="text-2xl">:{p2(clock.getSeconds())}</span>
        </span>
      </header>

      {live.length === 0 ? (
        <p className="py-24 text-center text-3xl" style={{ color: '#AFC0D4' }}>
          ตอนนี้ไม่มีรถในคลัง
        </p>
      ) : page === 0 ? (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {live.slice(0, 4).map(({ r, sec }) => (
            <div
              key={r.id}
              className="rounded-2xl px-5 py-5"
              style={{ background: '#121820', borderLeft: `6px solid ${tone(sec)}` }}
            >
              <div className="truncate text-2xl font-extrabold">{r.branch_name}</div>
              <div className="mb-3 text-sm" style={{ color: '#AFC0D4' }}>
                ควรออก {hm(new Date(r.due_at))} · {dmy(new Date(r.due_at))}
              </div>
              <Countdown sec={sec} size={78} showSec />
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl p-5" style={{ background: '#121820' }}>
          <p className="mb-3 text-xl font-bold">รถครบกำหนดช่วงไหนบ้าง</p>
          <Density secs={live.map((x) => x.sec)} now={now} big />
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-baseline gap-10">
        <span>
          <span className="text-base" style={{ color: '#AFC0D4' }}>
            อยู่ในคลัง{' '}
          </span>
          <span className="text-4xl font-extrabold">{live.length}</span>
          <span className="text-base" style={{ color: '#AFC0D4' }}>
            {' '}
            คัน
          </span>
        </span>
        <span>
          <span className="text-base" style={{ color: '#AFC0D4' }}>
            เลยกำหนด{' '}
          </span>
          <span className="text-4xl font-extrabold" style={{ color: over ? '#FF5C5C' : '#35D98A' }}>
            {over}
          </span>
          <span className="text-base" style={{ color: '#AFC0D4' }}>
            {' '}
            คัน
          </span>
        </span>
        <span>
          <span className="text-base" style={{ color: '#AFC0D4' }}>
            ออกตรงเวลา 24 ชม.{' '}
          </span>
          <span
            className="text-4xl font-extrabold"
            style={{ color: pct === null ? '#AFC0D4' : pct >= 90 ? '#35D98A' : pct >= 80 ? '#FFB038' : '#FF5C5C' }}
          >
            {pct === null ? '—' : `${pct}%`}
          </span>
        </span>
        <span className="flex-1" />
        <span className="text-sm" style={{ color: '#5A646F' }}>
          สลับหน้าเองทุก 20 วินาที
        </span>
      </div>
    </div>
  )
}
