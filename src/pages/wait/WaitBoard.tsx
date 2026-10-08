import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAsync } from '../../lib/useAsync'
import { readableError } from '../../lib/supabase'
import {
  cancelWaitTruck,
  doneWaitTruck,
  listWaitBoard,
  listWaitDone,
  listWaitTruckKpi,
  undoneWaitTruck,
  waitTruckCounts,
  WAIT_CANCEL_REASONS,
  type WaitTruckRow,
} from '../../lib/waitTrucks'
import { Modal } from '../../components/ui'
import { useAlarmPref, useTruckAlarm } from '../trucks/alarm'
import { AlarmGate, EdgeGlow, worstStage } from '../trucks/alert-ui'
import { playWaitAlarm, WAIT_ALARM_PREF } from './waitAlarm'
import { UploadBox } from './UploadBox'
import {
  BG,
  CARD,
  clock,
  Chip,
  DIM,
  FLASH_MS,
  FlashBell,
  RING_MS,
  INSET,
  UploadChip,
  LINE,
  liveState,
  nf,
  Parcels,
  PhoneIcon,
  Pill,
  secLeft,
  STATE_COLOR,
  Timer,
  WaitAlarmChip,
  WaitLogo,
} from './parts'

/**
 * กระดานรถรอลงงาน · หน้าที่หน้างานเปิดค้างไว้ทั้งกะ
 *
 * หน้านี้ทำสามอย่างเท่านั้น — กดลงงานเสร็จ กดยกเลิก กดโทรหาคนขับ
 * ทุกอย่างที่ไม่ได้ช่วยสามอย่างนั้นคือสิ่งที่ต้องเล็กลงหรือหายไป
 *
 * การ์ดถูกบีบให้เตี้ยที่สุดเท่าที่ยังใส่ข้อมูลครบ
 * เพราะกระดานที่เห็นสิบคันในจอเดียว มีประโยชน์กว่ากระดานที่เห็นสามคันแต่สวย
 * ปุ่มเล็กลงแต่ยังสูง 44px ตามกติกาเรื่องคนใส่ถุงมือ
 */

export default function WaitBoard() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const board = useAsync(listWaitBoard, [])
  const counts = useAsync(waitTruckCounts, [])
  const kpi = useAsync(listWaitTruckKpi, [])

  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [phone, setPhone] = useState<WaitTruckRow | null>(null)
  const [cancelling, setCancelling] = useState<WaitTruckRow | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [picked, setPicked] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const alarm = useAlarmPref(WAIT_ALARM_PREF)
  /** เหลือกี่วินาทีก่อนเด้งไปจอทีวี · null = ยังไม่นับถอยหลัง */
  const [idleLeft, setIdleLeft] = useState<number | null>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') {
        board.reload()
        counts.reload()
      }
    }, 60_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * ไม่แตะอะไรเกิน 20 วินาที แล้วเด้งไปจอทีวีเอง
   *
   * กระดานนี้ถูกเปิดค้างบนจอที่ตั้งไว้เฉย ๆ บ่อยกว่าถูกใช้กด
   * ปล่อยไว้เฉย ๆ มันควรกลายเป็นจอทีวี ซึ่งอ่านจากไกลได้
   *
   * หยุดนับเมื่อมีกล่องเปิดอยู่ หรือกำลังพิมพ์ค้นหา เพราะนั่นคือกำลังใช้งานจริง
   * และขึ้นนับถอยหลังห้าวินาทีสุดท้ายให้เห็นก่อน · จอที่เปลี่ยนเองโดยไม่บอก
   * คือจอที่คนคิดว่าเสีย แล้วก็จะเลิกใช้
   */
  const paused = picked !== null || phone !== null || cancelling !== null || showDone || q !== ''

  useEffect(() => {
    if (paused) {
      setIdleLeft(null)
      return
    }
    let left = 20
    setIdleLeft(null)
    const bump = () => {
      left = 20
      setIdleLeft(null)
    }
    const evs: (keyof DocumentEventMap)[] = ['pointerdown', 'keydown', 'wheel', 'touchstart']
    evs.forEach((e) => document.addEventListener(e, bump, { passive: true }))

    const t = setInterval(() => {
      left -= 1
      if (left <= 0) {
        nav('/wait/tv')
        return
      }
      setIdleLeft(left <= 5 ? left : null)
    }, 1000)

    return () => {
      clearInterval(t)
      evs.forEach((e) => document.removeEventListener(e, bump))
    }
  }, [paused, nav])

  // มาจากปุ่มอัปไฟล์บนจอทีวี · เปิดช่องเลือกไฟล์ให้เลย ไม่ต้องกดซ้ำ
  useEffect(() => {
    if (params.get('upload') === '1') {
      setParams({}, { replace: true })
      fileRef.current?.click()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rows = board.data ?? []

  const live = useMemo(
    () => rows.map((r) => ({ r, sec: secLeft(r, now) })).sort((a, b) => a.sec - b.sec),
    [rows, now],
  )

  const fired = useTruckAlarm(
    useMemo(() => live.map(({ r, sec }) => ({ id: r.id, sec })), [live]),
    alarm.on,
    playWaitAlarm,
  )
  /** คันที่กำลังเตือนอยู่ตอนนี้ · ขึ้นกระดิ่งสั่น */
  const ringing = useMemo(
    () => new Set(now - fired.at < RING_MS ? fired.ids : []),
    [fired, now],
  )
  /** คันที่เพิ่งเตือนไปเมื่อครู่ · ขึ้นจุดกระพริบเฉย ๆ */
  const flashing = useMemo(
    () => new Set(now - fired.at < FLASH_MS ? fired.ids : []),
    [fired, now],
  )

  /**
   * ค้นหาจากทุกช่องที่คนน่าจะจำได้
   *
   * หน้างานจำได้คนละอย่าง บางคนจำทะเบียน บางคนจำสาขาต้นทาง
   * บางคนถือใบที่มีแต่บาร์โค้ด · บังคับให้ค้นได้ช่องเดียวคือบังคับให้เขาเลื่อนหา
   */
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase()
    if (!k) return live
    return live.filter(({ r }) =>
      [r.from_station, r.plate, r.truck_barcode, r.vehicle_type, r.driver_name, r.carrier].some(
        (v) => (v ?? '').toLowerCase().includes(k),
      ),
    )
  }, [live, q])

  const onBoardCodes = useMemo(() => new Set(rows.map((r) => r.truck_barcode)), [rows])

  const tally = useMemo(() => {
    let over = 0
    let warn = 0
    let wait = 0
    let doJob = 0
    let nondo = 0
    /**
     * นับเฉพาะคันที่ไฟล์บอก DO มาจริง
     *
     * ถ้าไม่มีคันไหนบอกเลย หัวกระดานขึ้นขีด ไม่ใช่เลขศูนย์
     * ศูนย์คือคำตอบ ส่วนไม่รู้คือยังไม่มีคำตอบ · ตอบศูนย์แทนไฟล์เมื่อไหร่
     * วันหนึ่งจะมีคนวางกำลังคนตามตัวเลขที่เราแต่งขึ้นเอง
     */
    let known = 0
    for (const { r, sec } of live) {
      const st = liveState(r, sec)
      if (st === 'overdue') over++
      else if (st === 'warn') warn++
      else wait++
      if (r.parcels_do != null) {
        doJob += r.parcels_do
        nondo += r.parcels_nondo ?? 0
        known++
      }
    }
    return { over, warn, wait, doJob: known ? doJob : null, nondo: known ? nondo : null }
  }, [live])

  async function act(id: number, fn: () => Promise<unknown>) {
    setBusy(id)
    setErr(null)
    try {
      await fn()
      board.reload()
      counts.reload()
    } catch (e) {
      setErr(readableError(e))
    } finally {
      setBusy(null)
    }
  }

  function reloadAll() {
    board.reload()
    counts.reload()
  }

  return (
    <>
      <div className="min-h-dvh pb-24 text-white" style={{ background: BG }}>
        <EdgeGlow stage={worstStage(live.map(({ sec }) => ({ sec })))} />
        <AlarmGate open={!alarm.asked} onEnable={() => void alarm.turnOn()} onSkip={alarm.decline} />

        <header className="sticky top-0 z-20 px-3 pb-2 pt-3" style={{ background: BG }}>
          <div className="mx-auto w-full max-w-5xl">
            <div className="mb-2 flex items-center gap-2">
              <button
                onClick={() => nav('/')}
                aria-label="กลับหน้าแรกของแอพ"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[18px] font-extrabold"
                style={{ background: CARD, border: `1px solid ${LINE}`, color: '#EAF0F7' }}
              >
                ←
              </button>
              <span className="min-w-0 flex-1 truncate">
                <WaitLogo size={19} />
              </span>
              <WaitAlarmChip on={alarm.on} onTurnOn={() => void alarm.turnOn()} compact />
              <HeadBtn onClick={() => fileRef.current?.click()} tone="go">
                อัปไฟล์
              </HeadBtn>
              <HeadBtn onClick={() => nav('/wait/stats')}>แดชบอร์ด</HeadBtn>
              <HeadBtn onClick={() => nav('/wait/history')}>ประวัติ</HeadBtn>
              <HeadBtn onClick={() => nav('/wait/tv')}>ทีวี</HeadBtn>
            </div>

            {/*
              บนมือถือเป็นตารางสามช่องสองแถว ไม่ใช่บีบหกใบลงแถวเดียว
              ของเดิมใช้ flex-1 ทุกใบ พอจอกว้าง 390px ป้ายโดนบีบจนตัวหนังสือขาด
              เหลือ "เ.. 0" กับ "กำ 0" และตัวเลขสองใบทับกัน
            */}
            <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Chip label="เกินเวลา" n={tally.over} color="#E5484D" />
              <Chip label="เฝ้าระวัง" n={tally.warn} color="#E8B931" />
              <Chip label="กำลังรอ" n={tally.wait} color="#2F7FE0" />
              <Chip label="DO" n={nf(tally.doJob)} color="#17566E" sub="ชิ้น" />
              <Chip label="ไม่ใช่ DO" n={nf(tally.nondo)} color="#3D2C66" sub="ชิ้น" />
              {/* กินเต็มแถวบนมือถือ เพราะข้างในมีทั้งวันที่ เวลา และนานแค่ไหนแล้ว */}
              <span className="col-span-2 flex sm:col-span-3 lg:col-span-1">
                <UploadChip at={counts.data?.last_import} now={now} size="board" />
              </span>
            </div>

            <div className="relative">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ค้นหา สาขา ทะเบียน บาร์โค้ด ประเภทรถ ชื่อคนขับ"
                className="h-11 w-full rounded-xl pl-9 pr-9 text-sm font-bold outline-none"
                style={{ background: CARD, border: `1px solid ${LINE}`, color: '#EAF0F7' }}
              />
              <span
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px]"
                style={{ color: DIM }}
              >
                ⌕
              </span>
              {q !== '' && (
                <button
                  onClick={() => setQ('')}
                  aria-label="ล้างคำค้น"
                  className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg"
                  style={{ color: DIM }}
                >
                  ×
                </button>
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl px-3">
          {err && (
            <div
              className="mb-3 rounded-xl p-3 text-sm font-bold"
              style={{ background: '#3A1416', border: '1px solid #E5484D', color: '#FFD9DA' }}
            >
              {err}
            </div>
          )}

          {board.loading && rows.length === 0 && (
            <p className="py-16 text-center text-sm" style={{ color: DIM }}>
              กำลังโหลดกระดาน…
            </p>
          )}

          {board.error && (
            <div className="rounded-2xl p-4 text-center" style={{ background: CARD }}>
              <p className="text-sm font-bold" style={{ color: '#FFB4B6' }}>
                {board.error}
              </p>
              <button
                onClick={board.reload}
                className="mt-3 h-11 rounded-xl px-5 text-sm font-bold"
                style={{ background: INSET, border: `1px solid ${LINE}` }}
              >
                ลองใหม่
              </button>
            </div>
          )}

          {!board.loading && !board.error && rows.length === 0 && (
            <div className="rounded-2xl p-8 text-center" style={{ background: CARD }}>
              <p className="text-base font-bold">ยังไม่มีรถรอลงงาน</p>
              <p className="mt-1 text-sm" style={{ color: DIM }}>
                โหลดไฟล์รายงานจากระบบบริษัทแล้วโยนเข้ามาได้เลย
              </p>
              <button
                onClick={() => fileRef.current?.click()}
                className="mt-4 h-12 rounded-xl px-6 text-sm font-extrabold"
                style={{ background: '#2F7FE0' }}
              >
                อัปไฟล์
              </button>
            </div>
          )}

          {rows.length > 0 && shown.length === 0 && (
            <p className="py-10 text-center text-sm" style={{ color: DIM }}>
              ไม่เจอคันที่ตรงกับ “{q}”
            </p>
          )}

          <div className="space-y-2">
            {shown.map(({ r, sec }) => (
              <TruckRow
                key={r.id}
                r={r}
                sec={sec}
                busy={busy === r.id}
                flash={flashing.has(r.id)}
            ringing={ringing.has(r.id)}
                onDone={() => void act(r.id, () => doneWaitTruck(r.id))}
                onPhone={() => setPhone(r)}
                onCancel={() => setCancelling(r)}
              />
            ))}
          </div>

          <button
            onClick={() => setShowDone(true)}
            className="mt-5 h-12 w-full rounded-xl text-sm font-bold"
            style={{ background: CARD, border: `1px solid ${LINE}`, color: DIM }}
          >
            ดูคันที่ลงงานเสร็จแล้ว
            {counts.data ? ` · รอบนี้ ${counts.data.done} คัน` : ''}
          </button>
        </main>

        {idleLeft !== null && (
          <button
            onClick={() => setIdleLeft(null)}
            className="fixed inset-x-0 bottom-0 z-30 flex h-12 items-center justify-center gap-2 text-[14px] font-extrabold"
            style={{ background: '#2F7FE0', color: '#fff' }}
          >
            จะไปจอทีวีในอีก {idleLeft} วินาที · แตะตรงไหนก็ได้เพื่ออยู่ต่อ
          </button>
        )}

        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) setPicked(f)
          }}
        />
      </div>

      {/*
        กล่องเด้งอยู่นอก div ที่ตั้ง text-white ไว้ โดยตั้งใจ
        Modal ใช้พื้นขาวของแอพ ถ้าอยู่ข้างในจะสืบสีขาวลงไปด้วย
        แล้วตัวหนังสือจะกลายเป็นขาวบนขาว ซึ่งมองไม่เห็นเลย
      */}
      {picked && (
        <UploadBox
          file={picked}
          kpi={kpi.data ?? []}
          onBoard={onBoardCodes}
          onClose={() => setPicked(null)}
          onImported={reloadAll}
        />
      )}

      {phone && <PhoneCard r={phone} onClose={() => setPhone(null)} />}

      {cancelling && (
        <CancelBox
          r={cancelling}
          onClose={() => setCancelling(null)}
          onDone={(reason) => {
            const id = cancelling.id
            setCancelling(null)
            void act(id, () => cancelWaitTruck(id, reason))
          }}
        />
      )}

      {showDone && <DoneList onClose={() => setShowDone(false)} onChanged={reloadAll} />}
    </>
  )
}

function HeadBtn({
  children,
  onClick,
  tone,
}: {
  children: React.ReactNode
  onClick: () => void
  tone?: 'go'
}) {
  return (
    <button
      onClick={onClick}
      className="h-11 shrink-0 rounded-xl px-3 text-[13px] font-extrabold"
      style={
        tone === 'go'
          ? { background: '#2F7FE0', color: '#fff' }
          : { background: CARD, border: `1px solid ${LINE}`, color: '#EAF0F7' }
      }
    >
      {children}
    </button>
  )
}

/**
 * หนึ่งคัน · บีบเป็นแถวเดียวบนจอกว้าง ตกบรรทัดเองบนมือถือ
 *
 * ปุ่มลงงานเสร็จย้ายมาอยู่ขวาคู่กับยกเลิกตามที่เจ้าของระบบสั่ง
 * ของเดิมเป็นแถบเขียวเต็มความกว้าง ซึ่งกินที่เท่ากับข้อมูลอีกหนึ่งบรรทัด
 * และทำให้เห็นรถน้อยลงหนึ่งคันต่อจอโดยไม่ได้อะไรกลับมา
 *
 * ข้อมูลยังครบเหมือนเดิม แค่เรียงใหม่ให้กวาดตาจากซ้ายไปขวาได้รวดเดียว
 * เวลาที่ต้องเสร็จก่อนเป็นสีเหลือง เพราะเป็นตัวเลขที่คนเอาไปเทียบกับนาฬิกาบนผนัง
 */
function TruckRow({
  r,
  sec,
  busy,
  flash,
  ringing,
  onDone,
  onPhone,
  onCancel,
}: {
  r: WaitTruckRow
  sec: number
  busy: boolean
  flash: boolean
  /** กำลังเตือนอยู่จริง ๆ ตอนนี้ · กระดิ่งสั่นเฉพาะตอนนี้เท่านั้น */
  ringing: boolean
  onDone: () => void
  onPhone: () => void
  onCancel: () => void
}) {
  const st = liveState(r, sec)

  return (
    <article
      className="relative overflow-hidden rounded-xl"
      style={{ background: CARD, border: `1px solid ${LINE}` }}
    >
      <span className="absolute inset-y-0 left-0 w-[5px]" style={{ background: STATE_COLOR[st] }} />

      {/*
        บนมือถือเรียงลงเป็นชั้น ชื่อสถานีอยู่บนสุดเพราะเป็นสิ่งที่คนหา
        จอกว้างค่อยยุบเป็นแถวเดียว โดยสลับให้นาฬิกาไปอยู่ซ้ายสุด
        ใช้ order สลับ แทนที่จะเขียนการ์ดสองชุด ซึ่งวันหนึ่งจะแก้ไม่ครบทั้งสองที่
      */}
      <div className="flex flex-col gap-2 py-2 pl-4 pr-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
        {/* ① ชื่อสถานี กับ สถานะ */}
        <div className="order-1 flex items-center gap-2 sm:order-2 sm:min-w-[170px] sm:flex-1">
          {flash && <FlashBell size={14} ringing={ringing} />}
          <h2 className="min-w-0 flex-1 truncate text-[16px] font-extrabold sm:text-[15px]">
            {r.from_station ?? 'ไม่ระบุสถานีก่อนหน้า'}
          </h2>
          <Pill state={st} size={11} />
        </div>

        {/* ② นาฬิกา กับ เวลา */}
        <div className="order-2 flex shrink-0 items-center gap-3 sm:order-1">
          <Timer sec={sec} size={30} />
          <div className="leading-tight">
            <div className="text-[10px] font-bold" style={{ color: DIM }}>
              ถึง · เสร็จก่อน
            </div>
            <div className="font-mono text-[14px] font-extrabold">
              {clock(r.arrived_at)}
              <span style={{ color: DIM }}> · </span>
              <span style={{ color: sec < 0 ? '#FF8A8A' : '#FFD479' }}>{clock(r.due_at)}</span>
            </div>
          </div>
        </div>

        {/* ③ ป้ายประจำคัน */}
        <div className="order-3 flex flex-wrap items-center gap-x-2 gap-y-1 sm:order-3 sm:w-full lg:w-auto">
          <span
            className="rounded-md px-[6px] py-[2px] text-[13px] font-extrabold"
            style={{ background: '#1C2430', color: '#9FB4CC' }}
          >
            {r.vehicle_type ?? '—'}
          </span>
          <span className="text-[13px] font-extrabold">{r.plate ?? '—'}</span>
          <span className="text-[11px]" style={{ color: DIM }}>
            {r.truck_barcode}
          </span>
          <Parcels all={r.parcels_all} doJob={r.parcels_do} nondo={r.parcels_nondo} size={12} />
        </div>

        {/* ④ สามปุ่มที่หน้านี้มีไว้ทำ */}
        <div className="order-4 flex shrink-0 items-center gap-2 sm:ml-auto">
          <button
            onClick={onPhone}
            aria-label="ดูชื่อและเบอร์พนักงานขับรถ"
            className="flex h-11 w-11 items-center justify-center rounded-lg"
            style={{ background: INSET, border: `1px solid ${LINE}` }}
          >
            <PhoneIcon size={17} />
          </button>
          <button
            disabled={busy}
            onClick={onDone}
            className="h-11 flex-1 rounded-lg px-3 text-[13px] font-extrabold disabled:opacity-50 sm:flex-none"
            style={{ background: '#25A35A', color: '#fff' }}
          >
            {busy ? '…' : 'ลงงานเสร็จ'}
          </button>
          <button
            disabled={busy}
            onClick={onCancel}
            className="h-11 rounded-lg px-3 text-[12px] font-bold disabled:opacity-50"
            style={{ background: INSET, border: `1px solid ${LINE}`, color: '#FFB4B6' }}
          >
            ยกเลิก
          </button>
        </div>
      </div>
    </article>
  )
}

function PhoneCard({ r, onClose }: { r: WaitTruckRow; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const tel = (r.driver_phone ?? '').replace(/[^0-9+]/g, '')

  return (
    <Modal open onClose={onClose} title="พนักงานขับรถ">
      <div className="space-y-3">
        <p className="text-xl font-extrabold">{r.driver_name ?? 'ไม่มีชื่อในไฟล์'}</p>
        <p className="font-mono text-2xl font-extrabold tracking-wide">{r.driver_phone ?? '—'}</p>

        <div className="rounded-xl p-3 text-sm" style={{ background: '#F3F5F8' }}>
          <Line k="บริษัทรถ" v={r.carrier} />
          <Line k="ทะเบียน" v={r.plate} />
          <Line k="บาร์โค้ดรถ" v={r.truck_barcode} />
          <Line k="เส้นทาง" v={r.route_name} />
          <Line k="พัสดุทั้งหมด" v={nf(r.parcels_all)} />
          <Line k="งาน DO" v={nf(r.parcels_do)} />
          <Line k="ไม่ใช่งาน DO" v={nf(r.parcels_nondo)} />
        </div>

        {tel !== '' && (
          <div className="grid grid-cols-2 gap-2">
            <a
              href={`tel:${tel}`}
              className="flex h-12 items-center justify-center rounded-xl text-sm font-extrabold text-white"
              style={{ background: '#25A35A' }}
            >
              โทรเลย
            </a>
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(tel).then(() => setCopied(true))
              }}
              className="h-12 rounded-xl text-sm font-bold"
              style={{ background: '#E8ECF2' }}
            >
              {copied ? 'คัดลอกแล้ว' : 'คัดลอกเบอร์'}
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}

function Line({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="flex justify-between gap-3 py-[3px]">
      <span className="shrink-0 text-ink-500">{k}</span>
      <span className="min-w-0 break-all text-right font-bold">{v ?? '—'}</span>
    </div>
  )
}

function CancelBox({
  r,
  onClose,
  onDone,
}: {
  r: WaitTruckRow
  onClose: () => void
  onDone: (reason: string) => void
}) {
  const [reason, setReason] = useState('')

  return (
    <Modal open onClose={onClose} title={`ยกเลิก ${r.truck_barcode}`}>
      <p className="mb-3 text-sm text-ink-500">
        แถวนี้ไม่ถูกลบ ยังอยู่ในสถิติว่าถูกยกเลิกพร้อมเหตุผลและชื่อคนกด
      </p>

      <div className="mb-3 flex flex-wrap gap-2">
        {WAIT_CANCEL_REASONS.map((x) => (
          <button
            key={x}
            onClick={() => setReason(x)}
            className="h-11 rounded-xl px-3 text-sm font-bold"
            style={
              reason === x
                ? { background: '#1F2937', color: '#fff' }
                : { background: '#EEF1F5', color: '#1F2937' }
            }
          >
            {x}
          </button>
        ))}
      </div>

      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="หรือพิมพ์เหตุผลเอง"
        className="w-full rounded-xl border p-3 text-sm"
      />

      <button
        disabled={reason.trim() === ''}
        onClick={() => onDone(reason.trim())}
        className="mt-3 h-12 w-full rounded-xl text-sm font-extrabold text-white disabled:opacity-40"
        style={{ background: '#E5484D' }}
      >
        {reason.trim() === '' ? 'ต้องใส่เหตุผลก่อน' : 'ยืนยันยกเลิก'}
      </button>
    </Modal>
  )
}

function DoneList({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const since = useMemo(() => new Date(Date.now() - 24 * 3600_000).toISOString(), [])
  const done = useAsync(() => listWaitDone(since), [since])
  const rows = done.data ?? []
  const [busy, setBusy] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function undo(id: number) {
    setBusy(id)
    setErr(null)
    try {
      await undoneWaitTruck(id)
      done.reload()
      onChanged()
    } catch (e) {
      setErr(readableError(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal open onClose={onClose} title="ลงงานเสร็จแล้ว 24 ชั่วโมงที่ผ่านมา">
      {done.loading && <p className="py-6 text-center text-sm text-ink-500">กำลังโหลด…</p>}
      {done.error && <p className="py-6 text-center text-sm text-danger">{done.error}</p>}
      {err && <p className="py-2 text-center text-sm text-danger">{err}</p>}
      {!done.loading && rows.length === 0 && (
        <p className="py-6 text-center text-sm text-ink-500">ยังไม่มีคันที่กดเสร็จ</p>
      )}

      <div className="max-h-[60vh] space-y-2 overflow-y-auto">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-2 rounded-xl border p-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{r.from_station ?? r.truck_barcode}</p>
              <p className="truncate text-[12px] text-ink-500">
                {r.vehicle_type} · ถึง {clock(r.arrived_at)} · เสร็จ{' '}
                {r.done_at ? clock(r.done_at) : '—'} ·{' '}
                <span
                  className="font-bold"
                  style={{ color: r.state === 'done_ontime' ? '#167C45' : '#C32F34' }}
                >
                  {r.state === 'done_ontime' ? 'ทันเวลา' : 'ไม่ทัน'}
                </span>
              </p>
            </div>
            <button
              disabled={busy === r.id}
              onClick={() => void undo(r.id)}
              className="h-11 shrink-0 rounded-lg px-3 text-[12px] font-bold disabled:opacity-50"
              style={{ background: '#EEF1F5' }}
            >
              {busy === r.id ? 'กำลังเอากลับ…' : 'เอากลับขึ้นกระดาน'}
            </button>
          </div>
        ))}
      </div>
    </Modal>
  )
}
