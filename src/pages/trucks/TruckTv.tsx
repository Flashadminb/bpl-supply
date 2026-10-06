import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAsync } from '../../lib/useAsync'
import {
  listTruckBoard,
  releaseTruck,
  secondsLeft,
  seqByBranch,
  truckCounts,
  type TruckBoardRow,
} from '../../lib/trucks'
import { Countdown, DAY_TH, dmy, hm, MiniGrid, p2, StatCard, tone, ZoneCards } from './parts'
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

/**
 * กล่องถามปล่อยรถปิดเองใน 20 วินาที
 *
 * จอนี้ไม่มีคนเฝ้า ถ้ามีใครเดินชนแล้วกล่องค้าง จอจะหยุดทำงานไปทั้งกะ
 * ของที่เปิดเองไม่ได้ ต้องปิดเองได้เสมอ
 */
const ASK_SEC = 20
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

  /* จิ้มกรอบไหนก็ถามว่าจะปล่อยคันนั้นไหม · ไม่มีปุ่มเพิ่ม กรอบทั้งใบคือปุ่ม */
  const [ask, setAsk] = useState<number | null>(null)
  const [askLeft, setAskLeft] = useState(ASK_SEC)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (ask === null) return
    setAskLeft(ASK_SEC)
    const t = setInterval(() => setAskLeft((n) => n - 1), 1000)
    return () => clearInterval(t)
  }, [ask])
  useEffect(() => {
    if (ask !== null && askLeft <= 0) setAsk(null)
  }, [ask, askLeft])

  /**
   * สลับหน้าเอง หรือค้างไว้จนกว่าจะกดสลับ
   *
   * ค่าเก็บในเครื่อง ไม่ใช่ในฐานข้อมูล
   * เพราะจอทีวีที่แขวนในคลังกับมือถือที่เปิดดูเฉย ๆ ควรตั้งคนละแบบได้
   */
  /**
   * โหมดเต็มจอ
   *
   * จอที่แขวนในคลังไม่ได้ต่อคีย์บอร์ด การจะกด F11 จึงไม่มีทางเกิดขึ้นจริง
   * ปุ่มบนหน้าจึงเป็นทางเดียวที่คนตั้งจอจะเข้าโหมดเต็มจอได้
   */
  const [full, setFull] = useState(false)
  useEffect(() => {
    const f = () => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', f)
    return () => document.removeEventListener('fullscreenchange', f)
  }, [])

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
    // กล่องเปิดอยู่ห้ามสลับหน้า คนกำลังตัดสินใจอยู่
    if (!auto || ask !== null) return
    const t = setInterval(() => setPage((p) => (p + 1) % 2), ROTATE_MS)
    return () => clearInterval(t)
  }, [auto, ask])

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
        zone: r.zone,
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
    zone: x.r.zone,
  }))
  const askRow = ask === null ? null : (live.find((x) => x.r.id === ask) ?? null)
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
              <Card key={r.id} row={r} sec={sec} seq={seq.get(r.id)} onPick={setAsk} />
            ))}
          </div>
          {mini.length > BIG_CARDS && (
            <div className="mt-4">
              <MiniGrid
                rows={mini.slice(BIG_CARDS)}
                now={now}
                title="คันอื่นที่อยู่ในคลัง"
                onPick={setAsk}
                byZone
              />
            </div>
          )}
        </>
      ) : (
        <>
          {/* กิมิกของหน้านี้ · บอกตรง ๆ ว่าต้องเร่งคันไหน ไม่ต้องให้แปลจากตัวเลขเอง */}
          {urgent.some((x) => x.sec <= 20 * 60) && (
            <div className="mb-4">
              <UrgentRail items={urgent} big onPick={setAsk} />
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

          <div className="mb-4">
            <p className="mb-2 text-xl font-bold">แยกตามโซน</p>
            <ZoneCards rows={live.map((x) => ({ zone: x.r.zone, sec: x.sec }))} />
          </div>

          {/* ทุกคันที่อยู่ในคลัง · แยกหัวข้อตามโซน และย่อลงเองตามจำนวน */}
          <MiniGrid rows={mini} now={now} title="ทุกคันที่อยู่ในคลังตอนนี้" onPick={setAsk} byZone />
        </>
      )}

      {/* ───────── ถามก่อนปล่อย ───────── */}
      {askRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: 'rgba(0,0,0,.8)' }}
          onClick={() => setAsk(null)}
        >
          <div
            className="w-full max-w-[640px] rounded-2xl p-7 text-center"
            style={{ background: '#141B24', border: `3px solid ${tone(askRow.sec)}` }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-2xl font-bold" style={{ color: '#AFC0D4' }}>
              ปล่อยรถคันนี้ใช่ไหม
            </p>
            <p className="mt-2 flex flex-wrap items-baseline justify-center gap-x-3 text-4xl">
              {askRow.r.zone && (
                <span
                  className="rounded-md px-2 font-mono text-2xl font-extrabold"
                  style={{ background: '#1B2430', color: '#7FD1FF' }}
                >
                  {askRow.r.zone}
                </span>
              )}
              {askRow.r.branch_code && (
                <span className="font-mono font-extrabold" style={{ color: '#FFC400' }}>
                  {askRow.r.branch_code}
                </span>
              )}
              <span className="font-extrabold">{askRow.r.branch_name}</span>
            </p>
            <p className="mt-2 text-lg" style={{ color: '#AFC0D4' }}>
              ถึงคลัง {hm(new Date(askRow.r.arrived_at))} {dmy(new Date(askRow.r.arrived_at))} · ควรออก{' '}
              <b style={{ color: '#F0F4F9' }}>{hm(new Date(askRow.r.due_at))}</b>
            </p>
            <div className="mt-4 flex justify-center">
              <Countdown sec={askRow.sec} size={58} showSec />
            </div>

            {err && (
              <p className="mt-3 rounded-lg px-3 py-2 text-base" style={{ background: 'rgba(255,92,92,.14)', color: '#FF9A9A' }}>
                {err}
              </p>
            )}

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                className="h-tap flex-1 rounded-lg text-lg font-bold"
                style={{ background: '#1B2430', color: '#F0F4F9' }}
                onClick={() => setAsk(null)}
              >
                ยังไม่ปล่อย
              </button>
              <button
                type="button"
                className="h-tap flex-1 rounded-lg text-lg font-extrabold"
                style={{ background: '#FFC400', color: '#0B0E11', opacity: busy ? 0.6 : 1 }}
                disabled={busy}
                onClick={() => {
                  setBusy(true)
                  setErr(null)
                  void releaseTruck(askRow.r.id)
                    .then(() => {
                      setDone(`${askRow.r.branch_code ?? ''} ${askRow.r.branch_name}`.trim())
                      setAsk(null)
                      setTick((n) => n + 1)
                      window.setTimeout(() => setDone(null), 6000)
                    })
                    .catch((e) => setErr((e as Error).message))
                    .finally(() => setBusy(false))
                }}
              >
                {busy ? 'กำลังปล่อย…' : 'ปล่อยรถ'}
              </button>
            </div>
            <p className="mt-3 text-sm" style={{ color: '#5A646F' }}>
              ไม่กดอะไร กล่องนี้จะปิดเองใน {Math.max(0, askLeft)} วินาที
            </p>
          </div>
        </div>
      )}

      {done && (
        <div
          className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-xl px-6 py-3 text-xl font-extrabold"
          style={{ background: '#17311F', border: '2px solid #35D98A', color: '#8FE8BC' }}
        >
          ✓ ปล่อย {done} แล้ว
        </div>
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
        <button
          type="button"
          className="h-tap rounded-lg px-5 text-base font-bold"
          style={{ background: '#1B2430', color: '#F0F4F9' }}
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen()
            else void document.documentElement.requestFullscreen().catch(() => {})
          }}
        >
          {full ? 'ออกจากเต็มจอ' : 'เต็มจอ'}
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
function Card({
  row,
  sec,
  seq,
  onPick,
}: {
  row: TruckBoardRow
  sec: number
  seq?: number
  onPick?: (id: number) => void
}) {
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
      className={`${col} rounded-2xl px-5 py-5 ${onPick ? 'cursor-pointer active:opacity-80' : ''}`}
      role={onPick ? 'button' : undefined}
      tabIndex={onPick ? 0 : undefined}
      onClick={onPick ? () => onPick(row.id) : undefined}
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
        {row.zone && (
          <span
            className="rounded-md px-2 font-mono text-xl font-extrabold"
            style={{ background: '#1B2430', color: '#7FD1FF' }}
          >
            {row.zone}
          </span>
        )}
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

          {/*
            เวลาที่ต้องออกคือตัวเลขที่ใช้ตัดสินใจ ไม่ใช่ข้อมูลประกอบ
            ตัวเหลืองบนพื้นดำยังจมหายไปกับตัวเลขอื่นบนจอที่เหลืองเหมือนกัน
            กลับสีเป็นพื้นเหลืองตัวดำ จึงเป็นก้อนเดียวบนการ์ดที่สว่างกว่าทุกอย่างรอบตัว
          */}
          <div className="mt-1.5 inline-flex items-baseline gap-2 rounded-md px-2 py-1"
               style={{ background: '#FFC400', color: '#0B0E11' }}>
            <span style={{ fontSize: Math.round(size * 0.22), fontWeight: 700 }}>ต้องออก</span>
            <span className="font-mono font-extrabold" style={{ fontSize: Math.round(size * 0.56) }}>
              {hm(due)}
            </span>
            <span style={{ fontSize: Math.round(size * 0.24), fontWeight: 700 }}>{dmy(due)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
