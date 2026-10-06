import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAsync } from '../../lib/useAsync'
import { listTruckBoard, secondsLeft, seqByBranch, truckCounts, type TruckBoardRow } from '../../lib/trucks'
import { Countdown, DAY_TH, Density, dmy, hm, MiniGrid, p2, StatCard, tone } from './parts'
import { useAlarmPref, useTruckAlarm } from './alarm'
import { AlarmChip, AlarmGate, EdgeGlow, UrgentRail, worstStage } from './alert-ui'

/**
 * โหมดจอทีวี — เปิดค้างบนจอในคลัง
 *
 * คนอ่านจอนี้จากระยะสามถึงห้าเมตร ไม่ใช่ระยะมือถือ
 * ทุกอย่างจึงใหญ่กว่าหน้ากระดานราวสองเท่า
 *
 * ขนาดการ์ดไม่เท่ากันโดยตั้งใจ
 * คันที่เลยกำหนดได้กรอบใหญ่สุดและอยู่บนสุด รองลงมาคือคันที่ใกล้หมดเวลา
 * คันที่ยังเขียวได้ขนาดเดิม เพราะมันไม่ใช่สิ่งที่ต้องทำอะไรตอนนี้
 * จอที่ทุกอย่างใหญ่เท่ากันคือจอที่ไม่ได้บอกว่าให้ไปทำอะไรก่อน
 */

const ROTATE_MS = 20_000
const AUTO_KEY = 'truck.tv.auto'

/**
 * คันที่ได้การ์ดใหญ่ · ที่เหลือไม่ได้หายไปไหน ลงไปอยู่ช่องเล็กด้านล่างครบทุกคัน
 * เกินหกใบแล้วการ์ดจะเล็กลงจนเสียเหตุผลที่ทำให้มันใหญ่ตั้งแต่แรก
 */
const BIG_CARDS = 6

export default function TruckTv() {
  const nav = useNavigate()
  const [tick, setTick] = useState(0)
  const board = useAsync(() => listTruckBoard(), [tick])
  const counts = useAsync(() => truckCounts(), [tick])

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

  /**
   * สลับหน้าเอง หรือค้างไว้จนกว่าจะกดสลับ
   *
   * ค่าเก็บในเครื่อง ไม่ใช่ในฐานข้อมูล
   * เพราะจอทีวีที่แขวนในคลังกับมือถือที่เปิดดูเฉย ๆ ควรตั้งคนละแบบได้
   */
  // จอแคบ = มือถือ · เช็กตอนหมุนเครื่องด้วย ไม่ใช่เช็กครั้งเดียวตอนเปิด
  const [narrow, setNarrow] = useState(() => window.innerWidth < 768)
  const [force, setForce] = useState(false)
  useEffect(() => {
    const f = () => setNarrow(window.innerWidth < 768)
    window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [])

  const [auto, setAuto] = useState(() => localStorage.getItem(AUTO_KEY) !== 'off')
  const [page, setPage] = useState(0)
  useEffect(() => {
    if (!auto) return
    const t = setInterval(() => setPage((p) => (p + 1) % 2), ROTATE_MS)
    return () => clearInterval(t)
  }, [auto])

  const live = useMemo(
    () =>
      (board.data ?? [])
        .map((r) => ({ r, sec: secondsLeft(r.due_at, now) }))
        // เลยกำหนดมากสุดขึ้นก่อน · ยิ่งติดลบมากยิ่งอยู่บน
        .sort((a, b) => a.sec - b.sec),
    [board.data, now],
  )
  // สาขาเดียวกันที่มีหลายคันจอดพร้อมกัน ต้องแยกออกจากกันได้ด้วยตา
  const seq = useMemo(() => seqByBranch(board.data ?? []), [board.data])

  const big = live.slice(0, BIG_CARDS)
  const mini = useMemo(
    () =>
      live.map(({ r, sec }) => ({
        id: r.id,
        name: r.branch_name,
        code: r.branch_code,
        due: r.due_at,
        sec,
        seq: seq.get(r.id),
      })),
    [live, seq],
  )

  const c = counts.data
  const over = live.filter((x) => x.sec < 0).length
  const soon = live.filter((x) => x.sec >= 0 && x.sec <= 20 * 60).length

  /* เสียงเตือน · จอนี้แขวนอยู่ในคลัง เสียงจึงสำคัญกว่าบนมือถือด้วยซ้ำ */
  const pref = useAlarmPref()
  const alarmItems = live.map((x) => ({ id: x.r.id, sec: x.sec }))
  useTruckAlarm(alarmItems, pref.on)
  const urgent = live.map((x) => ({
    id: x.r.id,
    code: x.r.branch_code,
    name: x.r.branch_name,
    due: x.r.due_at,
    sec: x.sec,
  }))
  const clock = new Date(now)

  /**
   * มือถือไม่ใช่กลุ่มเป้าหมายของหน้านี้
   *
   * ทุกอย่างบนจอนี้ถูกขยายไว้ให้อ่านจากระยะสามถึงห้าเมตร
   * พอมาอยู่บนจอกว้างสี่ร้อยพิกเซล มันกลายเป็นหน้าที่ต้องเลื่อนตลอดและอ่านยากกว่าหน้ากระดาน
   * ซึ่งมีตัวเลขชุดเดียวกันครบอยู่แล้ว
   *
   * ไม่ปิดตายเพราะมีกรณีที่เสียบมือถือเข้าทีวีแล้วอยากได้หน้านี้จริง ๆ
   * แค่ถามก่อนหนึ่งครั้ง แล้วพาไปหน้าที่เหมาะกว่าให้เป็นทางหลัก
   */
  if (narrow && !force) {
    return (
      <div
        className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center"
        style={{ background: '#0B0E11', color: '#F0F4F9' }}
      >
        <span
          className="rounded-lg px-3 py-1.5 text-lg font-extrabold"
          style={{ background: '#FFC400', color: '#0B0E11' }}
        >
          FLASH
        </span>
        <p className="text-xl font-bold">โหมดจอทีวีทำไว้สำหรับจอใหญ่</p>
        <p className="text-sm leading-relaxed" style={{ color: '#AFC0D4' }}>
          ตัวเลขบนหน้านี้ถูกขยายไว้ให้อ่านจากกลางคลัง บนมือถือจะต้องเลื่อนตลอดและอ่านยากกว่า
          <br />
          หน้ากระดานมีตัวเลขชุดเดียวกันครบ และกดปล่อยรถได้ด้วย
        </p>
        <button
          type="button"
          className="h-tap w-full max-w-[280px] rounded-lg text-base font-extrabold"
          style={{ background: '#FFC400', color: '#0B0E11' }}
          onClick={() => nav('/trucks', { replace: true })}
        >
          ไปหน้ากระดาน
        </button>
        <button
          type="button"
          className="text-sm underline"
          style={{ color: '#7D8B9B' }}
          onClick={() => setForce(true)}
        >
          เสียบจอทีวีอยู่ · เปิดโหมดจอทีวีต่อ
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-dvh px-7 py-6" style={{ background: '#0B0E11', color: '#F0F4F9' }}>
      <EdgeGlow stage={worstStage(live)} />
      <AlarmGate open={!pref.on && !pref.asked} onEnable={() => void pref.turnOn()} onSkip={pref.decline} />

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
        <>
          <div className="grid grid-cols-12 gap-4">
            {big.map(({ r, sec }) => (
              <Card key={r.id} row={r} sec={sec} seq={seq.get(r.id)} />
            ))}
          </div>
          {mini.length > BIG_CARDS && (
            <div className="mt-4">
              <MiniGrid rows={mini.slice(BIG_CARDS)} now={now} title="คันอื่นที่อยู่ในคลัง" />
            </div>
          )}
        </>
      ) : (
        <>
          {/* กิมิกของหน้านี้ · บอกตรง ๆ ว่าต้องเร่งคันไหน ไม่ต้องให้แปลจากตัวเลขเอง */}
          {urgent.some((x) => x.sec <= 20 * 60) && (
            <div className="mb-4">
              <UrgentRail items={urgent} big max={3} />
            </div>
          )}

          {/* การ์ดตัวเลขรวม · ตัวที่ต้องลงไปทำอะไรจะกระพริบ */}
          <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
            <StatCard label="อยู่ในคลัง" n={c?.in_hub ?? live.length} color="#FBFBFB" />
            <StatCard
              label="เลยกำหนด"
              n={c?.late ?? over}
              color="#FF5C5C"
              ring="rgba(255,92,92,.45)"
              blink={(c?.late ?? over) > 0}
            />
            <StatCard
              label="ใกล้หมดเวลา"
              n={c?.soon ?? soon}
              color="#FFB038"
              ring="rgba(255,176,56,.4)"
              blink={(c?.soon ?? soon) > 0}
            />
            <StatCard
              label="ปล่อยไปแล้ว"
              n={c?.done ?? 0}
              color="#35D98A"
              foot={c ? undefined : 'เริ่มนับใหม่ได้ที่หลังบ้าน'}
            />

            {/*
              แยกผลออกเป็นสองใบ ตัวเล็กกว่าสี่ใบแรก

              สี่ใบแรกตอบว่าตอนนี้ต้องไปทำอะไร สองใบนี้ตอบว่าที่ทำไปแล้วผลเป็นยังไง
              คนละคำถามกัน และคำถามหลังไม่เร่งด่วนเท่า จึงไม่ควรกินพื้นที่เท่ากัน
            */}
            <StatCard
              label="ออกตรงเวลา"
              n={c?.on_time ?? 0}
              color="#35D98A"
              size={42}
              foot={c && c.done > 0 ? `${Math.round((c.on_time / c.done) * 100)}% ของที่ปล่อยไป` : undefined}
            />
            <StatCard
              label="ออกเกินเวลา"
              n={c ? c.done - c.on_time : 0}
              color="#FF5C5C"
              ring="rgba(255,92,92,.45)"
              size={42}
              foot={
                c && c.done > 0
                  ? `${Math.round(((c.done - c.on_time) / c.done) * 100)}% ของที่ปล่อยไป`
                  : undefined
              }
            />
          </div>

          <div className="mb-4 rounded-2xl p-5" style={{ background: '#121820' }}>
            <p className="mb-3 text-xl font-bold">รถครบกำหนดช่วงไหนบ้าง</p>
            <Density secs={live.map((x) => x.sec)} now={now} big />
          </div>

          {/* ทุกคันที่อยู่ในคลัง · ช่องย่อลงเองตามจำนวนเพื่อให้จบในหน้าเดียว */}
          <MiniGrid rows={mini} now={now} title="ทุกคันที่อยู่ในคลังตอนนี้" />
        </>
      )}

      {/* ───────── แถบควบคุม ───────── */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="h-tap rounded-lg px-6 text-lg font-extrabold"
          style={{ background: '#FFC400', color: '#0B0E11' }}
          onClick={() => nav('/trucks?kiosk=1')}
        >
          กรอกข้อมูล
        </button>
        <button
          type="button"
          className="h-tap rounded-lg px-5 text-base font-bold"
          style={{ background: '#1B2430', color: '#F0F4F9' }}
          onClick={() => setPage((p) => (p + 1) % 2)}
        >
          สลับหน้า
        </button>
        <AlarmChip on={pref.on} onClick={() => void pref.turnOn()} />
        <label
          className="h-tap flex cursor-pointer items-center gap-3 rounded-lg px-4 text-base"
          style={{ background: '#1B2430', color: '#AFC0D4' }}
        >
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={auto}
            onChange={(e) => {
              setAuto(e.target.checked)
              localStorage.setItem(AUTO_KEY, e.target.checked ? 'on' : 'off')
            }}
          />
          สลับเองทุก 20 วินาที
        </label>
        <span className="flex-1" />
        <span className="text-base" style={{ color: '#5A646F' }}>
          {auto ? 'กำลังสลับหน้าเอง' : 'ค้างหน้านี้ไว้จนกว่าจะกดสลับ'}
        </span>
      </div>
    </div>
  )
}

/**
 * การ์ดหนึ่งคัน
 *
 * ขนาดมาจากความเร่งด่วน ไม่ใช่ลำดับในรายการ
 * เวลาถึงคลังกับเวลาที่ควรออกเป็นค่าที่บันทึกไว้แล้ว ต้องนิ่งสนิท
 * ควรออกตัวใหญ่กว่าถึงคลัง เพราะมันคือตัวเลขที่ใช้ตัดสินใจ อีกตัวแค่บอกที่มา
 */
function Card({ row, sec, seq }: { row: TruckBoardRow; sec: number; seq?: number }) {
  const late = sec < 0
  const near = !late && sec <= 20 * 60
  const col = late
    ? 'col-span-12 xl:col-span-6'
    : near
      ? 'col-span-6 xl:col-span-4'
      : 'col-span-6 xl:col-span-3'
  const size = late ? 92 : near ? 64 : 46
  const c = tone(sec)
  const arr = new Date(row.arrived_at)
  const due = new Date(row.due_at)

  return (
    <div
      className={`${col} rounded-2xl px-5 py-5`}
      style={{
        background: '#121820',
        borderLeft: `${late ? 10 : near ? 7 : 5}px solid ${c}`,
        outline: late ? `2px solid ${c}55` : undefined,
      }}
    >
      {/*
        ตัวย่อตัวใหญ่เท่าชื่อไทย และมาก่อน

        หน้างานเรียกสาขาด้วยตัวย่อเป็นหลัก ชื่อไทยไว้ยืนยันซ้ำว่าไม่ได้อ่านผิดสาขา
        ของที่ใช้ตัดสินใจจึงต้องไม่เล็กกว่าของที่ใช้ยืนยัน
      */}
      <div
        className={`flex flex-wrap items-baseline gap-x-3 ${
          late ? 'text-4xl' : near ? 'text-2xl' : 'text-xl'
        }`}
      >
        {row.branch_code && (
          <span className="font-mono font-extrabold" style={{ color: '#FFC400' }}>
            {row.branch_code}
          </span>
        )}
        <span className="truncate font-extrabold">{row.branch_name}</span>
        {seq && seq > 1 && (
          <span
            className={`rounded-md px-2 font-extrabold ${late ? 'text-2xl' : 'text-lg'}`}
            style={{ background: '#FFC400', color: '#0B0E11' }}
          >
            คันที่ {seq}
          </span>
        )}
        {late && (
          <span className="ml-auto whitespace-nowrap text-xl font-extrabold" style={{ color: '#FF5C5C' }}>
            เลยกำหนด
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
        <Countdown sec={sec} size={size} showSec />

        <div className="leading-tight">
          <div style={{ color: '#7D8B9B', fontSize: Math.round(size * 0.2) }}>ถึงคลัง</div>
          <div className="font-mono font-bold" style={{ color: '#AFC0D4', fontSize: Math.round(size * 0.3) }}>
            {hm(arr)} <span style={{ fontSize: Math.round(size * 0.21) }}>{dmy(arr)}</span>
          </div>

          <div className="mt-1" style={{ color: '#7D8B9B', fontSize: Math.round(size * 0.2) }}>
            ควรออก
          </div>
          <div
            className="font-mono font-extrabold"
            style={{ color: '#FFC400', fontSize: Math.round(size * 0.52) }}
          >
            {hm(due)}{' '}
            <span style={{ fontSize: Math.round(size * 0.26), color: '#AFC0D4' }}>{dmy(due)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
