import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAsync } from '../../lib/useAsync'
import {
  cancelWaitTruck,
  doneWaitTruck,
  listWaitBoard,
  listWaitDone,
  waitTruckCounts,
  WAIT_CANCEL_REASONS,
  type WaitCounts,
  type WaitTruckRow,
} from '../../lib/waitTrucks'
import { readableError } from '../../lib/supabase'
import { useAlarmPref, useTruckAlarm } from '../trucks/alarm'
import { AlarmGate, EdgeGlow, worstStage } from '../trucks/alert-ui'
import { playWaitAlarm, WAIT_ALARM_PREF } from './waitAlarm'
import { DAY_TH, dmy, p2 } from '../trucks/parts'
import {
  BG,
  CARD,
  clock,
  DIM,
  FLASH_MS,
  FlashBell,
  INSET,
  UploadChip,
  LINE,
  liveState,
  nf,
  Parcels,
  pct,
  Pill,
  secLeft,
  STATE_COLOR,
  Strip,
  Timer,
  WaitAlarmChip,
  WaitLogo,
} from './parts'

/**
 * จอทีวีรถรอลงงาน
 *
 * แขวนไว้ให้คนอ่านจากอีกฝั่งของคลัง ไม่มีใครมากดอะไรบนจอนี้ตอนทำงาน
 * แถวปุ่มมีไว้ตอนตั้งจอ ตอนอยากค้างหน้าสถิติ และตอนเปิดจากมือถือ
 *
 * สองหน้าสลับกันทุก 20 วินาที ปลดการสลับได้ และกดเลือกหน้าเองได้
 */

const FLIP_MS = 20_000

const PAGES = ['กระดาน', 'สถิติ'] as const

/** จำไว้ว่าจอนี้ให้สลับเองหรือเปล่า · จอทีวีไม่มีใครมาตั้งใหม่ทุกเช้า */
const AUTO_PREF = 'wait.tv.auto'

const DO_COLOR = '#2BA7D8'
const NONDO_COLOR = '#8B5CF6'

export default function WaitTv() {
  const nav = useNavigate()
  const board = useAsync(listWaitBoard, [])
  const counts = useAsync(waitTruckCounts, [])
  const since = useMemo(() => new Date(Date.now() - 24 * 3600_000).toISOString(), [])
  const done = useAsync(() => listWaitDone(since), [since])

  const [now, setNow] = useState(() => Date.now())
  const [page, setPage] = useState(0)
  const [auto, setAuto] = useState(() => localStorage.getItem(AUTO_PREF) !== 'off')
  /**
   * คันที่เพิ่งถูกแตะบนจอ
   *
   * จอทีวีแขวนอยู่ตรงที่คนทำงานยืนอยู่แล้ว การบังคับให้เดินไปหยิบมือถือ
   * เปิดกระดาน หาคันเดิมให้เจอ แล้วค่อยกด คือสามขั้นที่ไม่ได้ให้อะไรเลย
   * แตะที่การ์ดแล้วกดได้เลยเหมือนจอปล่อยรถ
   */
  const [ask, setAsk] = useState<number | null>(null)
  const alarm = useAlarmPref(WAIT_ALARM_PREF)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  /**
   * นับเวลาใหม่ทุกครั้งที่หน้าเปลี่ยน ไม่ใช่เดินนาฬิกาตัวเดียวทิ้งไว้
   *
   * ถ้าใช้ตัวจับเวลาตัวเดียว คนที่กดสลับหน้าเองตอนวินาทีที่ 19
   * จะโดนเด้งกลับในอีกหนึ่งวินาที ซึ่งเหมือนปุ่มเสีย
   */
  useEffect(() => {
    if (!auto) return
    const t = setTimeout(() => setPage((p) => (p + 1) % PAGES.length), FLIP_MS)
    return () => clearTimeout(t)
  }, [auto, page])

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') {
        board.reload()
        counts.reload()
        done.reload()
      }
    }, 60_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const live = useMemo(
    () => (board.data ?? []).map((r) => ({ r, sec: secLeft(r, now) })).sort((a, b) => a.sec - b.sec),
    [board.data, now],
  )

  const fired = useTruckAlarm(
    useMemo(() => live.map(({ r, sec }) => ({ id: r.id, sec })), [live]),
    alarm.on,
    playWaitAlarm,
  )
  const flashing = useMemo(
    () => new Set(now - fired.at < FLASH_MS ? fired.ids : []),
    [fired, now],
  )

  const askRow = ask == null ? null : live.find((x) => x.r.id === ask) ?? null

  return (
    <div className="min-h-dvh px-5 py-4 text-white" style={{ background: BG }}>
      <EdgeGlow stage={worstStage(live.map(({ sec }) => ({ sec })))} />
      <AlarmGate open={!alarm.asked} onEnable={() => void alarm.turnOn()} onSkip={alarm.decline} />

      <TvHead
        now={now}
        page={page}
        live={live}
        counts={counts.data}
        auto={auto}
        onPage={setPage}
        onAuto={(v) => {
          setAuto(v)
          localStorage.setItem(AUTO_PREF, v ? 'on' : 'off')
        }}
        alarmOn={alarm.on}
        onAlarmOn={() => void alarm.turnOn()}
        onGo={nav}
      />

      {page === 0 ? (
        <BoardPage
          live={live}
          loading={board.loading}
          flashing={flashing}
          onTap={(id) => setAsk(id)}
        />
      ) : (
        <StatsPage live={live} counts={counts.data} done={done.data ?? []} />
      )}

      {askRow && (
        <ActSheet
          r={askRow.r}
          sec={askRow.sec}
          onClose={() => setAsk(null)}
          onChanged={() => {
            setAsk(null)
            board.reload()
            counts.reload()
            done.reload()
          }}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ หัวจอ */

/**
 * หัวจอ
 *
 * ชื่อจออยู่บรรทัดของตัวเองเต็มความกว้าง ไม่ได้แชร์แถวกับตัวเลข
 * ของเดิมโลโก้เบียดอยู่ซ้ายสุดของแถบตัวเลข ซึ่งทำให้ทั้งแถวอ่านเป็นก้อนเดียว
 * คนที่เดินผ่านต้องใช้เวลาแยกเองว่าอันไหนชื่อจอ อันไหนตัวเลข
 */
function TvHead({
  now,
  page,
  live,
  counts,
  auto,
  onPage,
  onAuto,
  alarmOn,
  onAlarmOn,
  onGo,
}: {
  now: number
  page: number
  live: { r: WaitTruckRow; sec: number }[]
  counts: WaitCounts | null
  auto: boolean
  onPage: (p: number) => void
  onAuto: (v: boolean) => void
  alarmOn: boolean
  onAlarmOn: () => void
  onGo: (to: string) => void
}) {
  const d = new Date(now)
  let over = 0
  let warn = 0
  for (const { r, sec } of live) {
    const st = liveState(r, sec)
    if (st === 'overdue') over++
    else if (st === 'warn') warn++
  }

  return (
    <header className="mb-4">
      <div className="mb-3 flex items-center justify-between gap-4">
        <WaitLogo size={34} />
        {/*
          วันที่อยู่คู่กับเวลาเสมอ · จอนี้แขวนค้างข้ามคืน และรอบตัดวันคือตีสาม
          เห็นแต่เวลาอย่างเดียวตอนตีสองครึ่ง จะแยกไม่ออกว่ายังเป็นของเมื่อวาน
          หรือข้ามมาเป็นของวันใหม่แล้ว
        */}
        <span className="flex items-baseline gap-4">
          <span className="text-[22px] font-bold" style={{ color: DIM }}>
            {DAY_TH[d.getDay()]} {dmy(d)}
          </span>
          <span className="font-mono text-[40px] font-extrabold leading-none">
            {p2(d.getHours())}:{p2(d.getMinutes())}
          </span>
        </span>
      </div>

      <div className="flex gap-3">
        <TvChip label="เกินเวลา" n={over} color="#E5484D" />
        <TvChip label="เฝ้าระวัง" n={warn} color="#E8B931" />
        {/* ชื่อเดิมคือ "กำลังรอทั้งหมด" ซึ่งอ่านแล้วนึกว่านับเฉพาะคันที่ยังไม่ถึงเวลา
            จริง ๆ มันคือรถที่รอลงงานทั้งกระดาน · กดลงงานเสร็จแล้วเลขนี้จะลด */}
        <TvChip label="รถรอลงงานทั้งหมด" n={live.length} color="#2F7FE0" />
        <TvChip label="DO" n={nf(counts?.wait_do)} color="#17566E" />
        <TvChip label="ไม่ใช่ DO" n={nf(counts?.wait_nondo)} color="#3D2C66" />
        <UploadChip at={counts?.last_import} now={now} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <TvBtn onClick={() => onGo('/wait')}>← กระดานหน้างาน</TvBtn>
        <TvBtn onClick={() => onGo('/wait?upload=1')}>อัปไฟล์</TvBtn>
        <TvBtn onClick={() => onGo('/wait/history')}>ประวัติ</TvBtn>

        <span className="mx-1 h-6 w-px" style={{ background: LINE }} />

        {PAGES.map((label, i) => (
          <TvBtn key={label} onClick={() => onPage(i)} active={page === i}>
            {i + 1}. {label}
          </TvBtn>
        ))}

        <button
          type="button"
          onClick={() => onAuto(!auto)}
          className="flex h-11 items-center gap-2 rounded-xl px-3 text-[13px] font-bold"
          style={{
            background: auto ? '#15301F' : '#1B2430',
            color: auto ? '#8FE3B4' : '#8A97A6',
            border: `1px solid ${auto ? '#25A35A' : LINE}`,
          }}
        >
          <span
            className="flex h-5 w-5 items-center justify-center rounded-[5px] text-[13px] font-extrabold"
            style={{
              background: auto ? '#25A35A' : 'transparent',
              border: `2px solid ${auto ? '#25A35A' : '#55616F'}`,
              color: '#fff',
            }}
          >
            {auto ? '✓' : ''}
          </span>
          สลับหน้าเองทุก 20 วิ
        </button>

        <span className="ml-auto flex items-center gap-3">
          <span className="flex gap-1">
            {PAGES.map((_, i) => (
              <span
                key={i}
                className="block h-[6px] rounded-full transition-all"
                style={{ width: i === page ? 26 : 10, background: i === page ? '#EAF0F7' : '#39434F' }}
              />
            ))}
          </span>
          <WaitAlarmChip on={alarmOn} onTurnOn={onAlarmOn} compact />
        </span>
      </div>
    </header>
  )
}

function TvChip({ label, n, color }: { label: string; n: number | string; color: string }) {
  const dark = color === '#E8B931'
  return (
    <div
      className="flex min-w-0 flex-1 items-baseline justify-between gap-2 rounded-xl px-4 py-2"
      style={{ background: color, color: dark ? '#1A1405' : '#fff' }}
    >
      <span className="truncate text-[15px] font-bold opacity-90">{label}</span>
      <span className="text-[30px] font-extrabold leading-none">{n}</span>
    </div>
  )
}

function TvBtn({
  children,
  onClick,
  active,
}: {
  children: React.ReactNode
  onClick: () => void
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-11 shrink-0 rounded-xl px-3 text-[13px] font-bold"
      style={
        active
          ? { background: '#EAF0F7', color: '#101316' }
          : { background: CARD, border: `1px solid ${LINE}`, color: '#AFC0D4' }
      }
    >
      {children}
    </button>
  )
}

/* ------------------------------------------------------------- หน้าที่หนึ่ง */

function BoardPage({
  live,
  loading,
  flashing,
  onTap,
}: {
  live: { r: WaitTruckRow; sec: number }[]
  loading: boolean
  flashing: Set<number>
  onTap: (id: number) => void
}) {
  if (loading && live.length === 0) {
    return <p className="py-24 text-center text-2xl" style={{ color: DIM }}>กำลังโหลด…</p>
  }
  if (live.length === 0) {
    return (
      <p className="py-24 text-center text-[40px] font-extrabold" style={{ color: '#35D98A' }}>
        ไม่มีรถรอลงงาน
      </p>
    )
  }

  /**
   * ใหญ่ไล่ลงมาตามความด่วน แล้วที่เหลือเป็นแถวตารางยาว
   *
   * คันที่ด่วนที่สุดได้เต็มความกว้างหนึ่งใบ รองลงมาอีกสองใบวางคู่กัน
   * ที่เหลือเป็นแถวยาวบรรทัดละคัน ซึ่งใส่ข้อมูลครบเท่าการ์ดทุกช่อง
   *
   * ทำแบบนี้เพราะวันที่รถเยอะ การ์ดใหญ่เท่ากันหมดคือกระดานที่หาคันที่ต้องรีบไม่เจอ
   * ต้องเลื่อนจอทั้งหน้าเพื่อดูว่ามีอะไรบ้าง ซึ่งจอทีวีเลื่อนไม่ได้
   * แถวยาวกินที่น้อยกว่าการ์ดสามเท่า แต่ยังอ่านออกจากกลางคลัง
   */
  const hero = live[0]
  const second = live.slice(1, 3)
  const rest = live.slice(3)

  return (
    <div className="space-y-3">
      <TvCard
        r={hero.r}
        sec={hero.sec}
        scale={1}
        flash={flashing.has(hero.r.id)}
        onTap={() => onTap(hero.r.id)}
      />

      {second.length > 0 && (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${second.length}, minmax(0, 1fr))` }}
        >
          {second.map(({ r, sec }) => (
            <TvCard
              key={r.id}
              r={r}
              sec={sec}
              scale={0.82}
              flash={flashing.has(r.id)}
              onTap={() => onTap(r.id)}
            />
          ))}
        </div>
      )}

      {rest.length > 0 && (
        <div className="space-y-2">
          {rest.map(({ r, sec }) => (
            <TvStrip
              key={r.id}
              r={r}
              sec={sec}
              flash={flashing.has(r.id)}
              onTap={() => onTap(r.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * แถวตารางยาว · หนึ่งบรรทัดต่อหนึ่งคัน
 *
 * ข้อมูลครบเท่าการ์ดใหญ่ทุกช่อง แค่เรียงเป็นคอลัมน์แทนการวางซ้อนกัน
 * ตากวาดลงเป็นแนวตั้งได้ ซึ่งเป็นวิธีหาของในรายการยาวที่เร็วที่สุด
 */
function TvStrip({
  r,
  sec,
  flash,
  onTap,
}: {
  r: WaitTruckRow
  sec: number
  flash: boolean
  onTap: () => void
}) {
  const st = liveState(r, sec)
  return (
    <article
      onClick={onTap}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onTap()
      }}
      className="relative flex cursor-pointer items-center gap-3 overflow-hidden rounded-xl py-2 pl-5 pr-3 transition-transform active:scale-[.99]"
      style={{ background: CARD, border: `1px solid ${LINE}` }}
    >
      <span className="absolute inset-y-0 left-0 w-[6px]" style={{ background: STATE_COLOR[st] }} />

      {flash && <FlashBell size={15} />}

      <h3 className="min-w-[230px] max-w-[330px] flex-1 truncate text-[20px] font-extrabold">
        {r.from_station ?? 'ไม่ระบุสถานี'}
      </h3>

      <Badge text={r.vehicle_type ?? '—'} size={17} bg="#1C2430" fg="#9FB4CC" />
      <Badge text={r.plate ?? '—'} size={17} bg="#1B2430" fg="#EAF0F7" />
      <Parcels all={r.parcels_all} doJob={r.parcels_do} nondo={r.parcels_nondo} size={15} />

      <span className="font-mono text-[13px]" style={{ color: DIM }}>{r.truck_barcode}</span>

      <span className="ml-auto flex shrink-0 items-center gap-3">
        <span className="text-right leading-tight">
          <span className="block text-[10px] font-bold" style={{ color: DIM }}>ถึง · เสร็จก่อน</span>
          <span className="block font-mono text-[16px] font-extrabold">
            {clock(r.arrived_at)}
            <span style={{ color: DIM }}> · </span>
            <span style={{ color: sec < 0 ? '#FF8A8A' : '#FFD479' }}>{clock(r.due_at)}</span>
          </span>
        </span>
        <Timer sec={sec} size={30} />
        <Pill state={st} size={12} />
      </span>
    </article>
  )
}

/**
 * การ์ดหนึ่งคัน
 *
 * ประเภทรถ ทะเบียน และจำนวนชิ้น ย้ายขึ้นมาอยู่แถวบนคู่กับชื่อสถานี
 * เพราะสามอย่างนี้คือสิ่งที่คนใช้ชี้ว่า "คันนั้นแหละ" ตอนยืนอยู่หน้าลาน
 * ของเดิมอยู่บรรทัดล่างสุดปนกับบาร์โค้ด ซึ่งต้องกวาดตาลงไปหา
 *
 * บาร์โค้ดอยู่ที่เดิมล่างสุด เพราะไม่มีใครอ่านมันจากระยะไกล
 * มันถูกใช้ตอนเทียบกับใบที่ถืออยู่ในมือเท่านั้น
 */
function TvCard({
  r,
  sec,
  scale,
  flash,
  onTap,
}: {
  r: WaitTruckRow
  sec: number
  scale: number
  flash: boolean
  onTap: () => void
}) {
  const st = liveState(r, sec)
  const px = (n: number) => Math.round(n * scale)

  return (
    <article
      onClick={onTap}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onTap()
      }}
      className="relative cursor-pointer overflow-hidden rounded-2xl transition-transform active:scale-[.985]"
      style={{
        background: CARD,
        border: `1px solid ${LINE}`,
        minHeight: Math.round(230 * scale),
      }}
    >
      <Strip color={STATE_COLOR[st]} />

      <div className="flex h-full flex-col gap-3 py-4 pl-6 pr-4">
        {/* ① แถวบน · ชื่อสถานี แล้วป้ายประจำคัน แล้วสถานะ */}
        <div className="flex items-start gap-3">
          {flash && <FlashBell size={px(20)} />}
          <h2
            className="min-w-0 flex-1 font-extrabold leading-tight"
            style={{ fontSize: px(27) }}
          >
            {r.from_station ?? 'ไม่ระบุสถานี'}
          </h2>

          <div className="flex shrink-0 items-center" style={{ gap: px(8) }}>
            <Badge text={r.vehicle_type ?? '—'} size={px(22)} bg="#1C2430" fg="#9FB4CC" />
            <Badge text={r.plate ?? '—'} size={px(22)} bg="#1B2430" fg="#EAF0F7" />
            {/*
              สามตัวเลขพัสดุอยู่ติดกันเพราะเป็นสมการเดียวกัน ทั้งหมด − DO = ไม่ใช่ DO
              ของเดิมเลขทั้งหมดอยู่บนสุด ส่วน DO ไปอยู่ล่างสุดคนละมุมการ์ด
              คนจึงไม่เห็นว่ามันเกี่ยวกัน แล้วก็ไม่เคยเอาสองตัวหลังไปใช้เลย
            */}
            <Parcels
              all={r.parcels_all}
              doJob={r.parcels_do}
              nondo={r.parcels_nondo}
              size={px(20)}
            />
          </div>

          <Pill state={st} size={px(15)} />
        </div>

        {/* ② แถวกลาง · เวลา กับ นาฬิกา */}
        <div className="flex flex-1 items-center justify-between gap-3">
          <div className="shrink-0">
            <div className="text-[11px] font-bold" style={{ color: DIM }}>รถถึงจริง</div>
            <div className="font-mono font-extrabold" style={{ fontSize: px(24) }}>
              {clock(r.arrived_at)}
            </div>
            {/*
              เวลาที่ต้องเสร็จก่อนเป็นตัวเลขที่คนเอาไปเทียบกับนาฬิกาบนผนัง
              จึงทำเป็นป้ายสีแยกออกมา ไม่ใช่ตัวหนังสือจาง ๆ ต่อท้ายเวลารถถึง
            */}
            <div
              className="mt-1 inline-flex items-baseline gap-1 rounded-lg px-2 py-[3px]"
              style={{ background: sec < 0 ? '#3A1416' : '#2A2206' }}
            >
              <span
                className="text-[11px] font-bold"
                style={{ color: sec < 0 ? '#FFB4B6' : '#D9C78A' }}
              >
                เสร็จก่อน
              </span>
              <span
                className="font-mono font-extrabold"
                style={{ fontSize: px(21), color: sec < 0 ? '#FF8A8A' : '#FFD479' }}
              >
                {clock(r.due_at)}
              </span>
            </div>
          </div>
          <Timer sec={sec} size={px(48)} />
        </div>

        {/* ③ แถวล่าง · บาร์โค้ดอยู่ที่เดิม ต่อด้วยงาน DO */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-mono" style={{ color: DIM, fontSize: px(14) }}>
            {r.truck_barcode}
          </span>
          {r.driver_name && (
            <span className="ml-auto truncate" style={{ color: DIM, fontSize: px(14) }}>
              {r.driver_name}
            </span>
          )}
        </div>
      </div>
    </article>
  )
}

/** ป้ายข้อความประจำคัน · ประเภทรถกับทะเบียน ใช้ขนาดเดียวกันเพราะเด่นเท่ากัน */
function Badge({
  text,
  size,
  bg,
  fg,
}: {
  text: string
  size: number
  bg: string
  fg: string
}) {
  return (
    <span
      className="rounded-lg font-extrabold leading-none"
      style={{
        background: bg,
        color: fg,
        fontSize: size,
        padding: `${Math.round(size * 0.16)}px ${Math.round(size * 0.36)}px`,
        border: `1px solid ${LINE}`,
      }}
    >
      {text}
    </span>
  )
}

/* -------------------------------------------------------------- หน้าที่สอง */

/**
 * หน้าสถิติ · เต็มจอ
 *
 * เรียงจากคำถามที่หน้างานถามจริง ไล่จากบนลงล่าง
 *   ① ตอนนี้เหลืองานเท่าไหร่ และทำไปได้เท่าไหร่แล้ว
 *   ② ประเภทรถที่ยังค้างอยู่ — ใช้วางกำลังคนหน้าสายพาน จึงต้องเด่นที่สุดในหน้านี้
 *   ③ ทันเวลากี่เปอร์เซ็นต์ และพัสดุแบ่ง DO เท่าไหร่
 *   ④ คันไหนลงเสร็จไปแล้วบ้าง เสร็จกี่โมง เกินไปกี่นาที
 */
function StatsPage({
  live,
  counts,
  done,
}: {
  live: { r: WaitTruckRow; sec: number }[]
  counts: WaitCounts | null
  done: WaitTruckRow[]
}) {
  const byType = useMemo(() => {
    const m = new Map<
      string,
      { n: number; pcs: number; doJob: number; known: number; over: number; warn: number }
    >()
    for (const { r, sec } of live) {
      const k = r.vehicle_type ?? '—'
      const cur = m.get(k) ?? { n: 0, pcs: 0, doJob: 0, known: 0, over: 0, warn: 0 }
      cur.n++
      cur.pcs += r.parcels_all ?? 0
      if (r.parcels_do != null) {
        cur.doJob += r.parcels_do
        cur.known++
      }
      const st = liveState(r, sec)
      if (st === 'overdue') cur.over++
      else if (st === 'warn') cur.warn++
      m.set(k, cur)
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n)
  }, [live])

  const c = counts
  const total = c?.all_trucks ?? live.length
  const doneN = c?.done ?? 0
  const late = c?.done_late ?? 0
  const onTime = c?.on_time ?? 0
  const maxType = Math.max(1, ...byType.map(([, v]) => v.n))

  return (
    <div className="flex flex-col gap-4" style={{ minHeight: 'calc(100dvh - 210px)' }}>
      {/* ① ยอดรวมของรอบ */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Big label="รถทั้งหมดในรอบนี้" n={total} sub="รอ + ลงแล้ว" color="#EAF0F7" />
        <Big label="ยังรอลงงาน" n={live.length} color="#2F7FE0" />
        <Big label="ลงงานแล้ว" n={doneN} color="#25A35A" />
        <Big
          label="ลงแล้วแต่เกินเวลา"
          n={late}
          sub={doneN > 0 ? `${pct(late, doneN)} ของที่ลงแล้ว` : undefined}
          color="#E5484D"
        />
        <Big
          label="ทันเวลา"
          n={pct(onTime, doneN)}
          sub={`${onTime} จาก ${doneN} คัน`}
          color="#35D98A"
        />
      </div>

      <div className="grid flex-1 gap-4" style={{ gridTemplateColumns: 'minmax(0, 1.55fr) minmax(0, 1fr)' }}>
        {/* ② ประเภทรถ · เด่นที่สุดในหน้านี้ ตัวเลขใหญ่ พร้อมแท่งเทียบกัน */}
        <section className="flex flex-col rounded-2xl p-5" style={{ background: CARD, border: `1px solid ${LINE}` }}>
          <h3 className="mb-4 text-[24px] font-extrabold">ประเภทรถที่รอลงงานอยู่ตอนนี้</h3>
          {byType.length === 0 ? (
            <p style={{ color: DIM }}>ไม่มีรถรออยู่</p>
          ) : (
            <div className="flex flex-1 flex-col justify-around gap-3">
              {byType.map(([t, v]) => (
                <div key={t} className="flex items-center gap-4">
                  <span
                    className="w-[92px] shrink-0 rounded-lg py-2 text-center text-[24px] font-extrabold"
                    style={{ background: '#1C2430', color: '#9FB4CC', border: `1px solid ${LINE}` }}
                  >
                    {t}
                  </span>

                  <span className="w-[70px] shrink-0 text-right text-[46px] font-extrabold leading-none">
                    {v.n}
                  </span>
                  <span className="shrink-0 text-[14px] font-bold" style={{ color: DIM }}>
                    คัน
                  </span>

                  <div className="min-w-0 flex-1">
                    {/* แท่งยาวตามจำนวนคัน · ส่วนแดงคือคันที่เกินเวลาไปแล้ว */}
                    <div className="h-7 overflow-hidden rounded-lg" style={{ background: INSET }}>
                      <div
                        className="flex h-full"
                        style={{ width: `${Math.round((v.n / maxType) * 100)}%` }}
                      >
                        <div style={{ flex: v.over, background: '#E5484D' }} />
                        <div style={{ flex: v.warn, background: '#E8B931' }} />
                        <div style={{ flex: Math.max(0, v.n - v.over - v.warn), background: '#2F7FE0' }} />
                      </div>
                    </div>
                    <div className="mt-1 flex gap-3 text-[13px] font-bold">
                      <span style={{ color: '#FFD479' }}>{nf(v.pcs)} ชิ้น</span>
                      <span style={{ color: '#7BD8FF' }}>
                        DO {v.known > 0 ? nf(v.doJob) : '—'}
                      </span>
                      {v.over > 0 && <span style={{ color: '#FF8A8A' }}>เกิน {v.over}</span>}
                      {v.warn > 0 && <span style={{ color: '#E8B931' }}>เฝ้าระวัง {v.warn}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ③ วงแหวนทันเวลา กับ พัสดุแบ่ง DO */}
        <section className="flex flex-col gap-4">
          <div
            className="flex flex-1 items-center gap-5 rounded-2xl p-5"
            style={{ background: CARD, border: `1px solid ${LINE}` }}
          >
            <Ring done={onTime} total={doneN} />
            <div className="min-w-0">
              <h3 className="text-[20px] font-extrabold">ลงงานทันเวลา</h3>
              <p className="mt-1 text-[14px]" style={{ color: DIM }}>
                นับจากคันที่กดเสร็จแล้วในรอบนี้
              </p>
              <div className="mt-3 space-y-1 text-[15px] font-bold">
                <p style={{ color: '#35D98A' }}>ทันเวลา {onTime} คัน</p>
                <p style={{ color: '#FF8A8A' }}>ไม่ทัน {late} คัน</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl p-5" style={{ background: CARD, border: `1px solid ${LINE}` }}>
            <h3 className="text-[20px] font-extrabold">พัสดุที่ลงไปแล้วในรอบนี้</h3>
            <div className="mt-1 text-[44px] font-extrabold leading-none">
              {nf(c?.done_parcels ?? 0)}
              <span className="ml-2 text-[16px] font-bold" style={{ color: DIM }}>ชิ้น</span>
            </div>
            <Split doJob={c?.done_do ?? null} nondo={c?.done_nondo ?? null} />

            <h3 className="mt-4 text-[15px] font-extrabold" style={{ color: DIM }}>
              ที่ยังค้างอยู่
            </h3>
            <div className="text-[28px] font-extrabold leading-none">
              {nf(c?.wait_parcels ?? 0)}
              <span className="ml-2 text-[14px] font-bold" style={{ color: DIM }}>ชิ้น</span>
            </div>
            <Split doJob={c?.wait_do ?? null} nondo={c?.wait_nondo ?? null} />
          </div>
        </section>
      </div>

      {/* ④ ประวัติคันที่ลงเสร็จ */}
      <section className="rounded-2xl p-4" style={{ background: CARD, border: `1px solid ${LINE}` }}>
        <h3 className="mb-2 text-[20px] font-extrabold">คันที่ลงงานเสร็จแล้ว</h3>
        <DoneTable rows={done} />
      </section>
    </div>
  )
}

function Big({
  label,
  n,
  sub,
  color,
}: {
  label: string
  n: number | string
  sub?: string
  color: string
}) {
  return (
    <div className="rounded-2xl p-4" style={{ background: CARD, border: `1px solid ${LINE}` }}>
      <div className="text-[14px] font-bold" style={{ color: DIM }}>{label}</div>
      <div className="mt-1 text-[44px] font-extrabold leading-none" style={{ color }}>{n}</div>
      {sub && <div className="mt-1 text-[12px]" style={{ color: DIM }}>{sub}</div>}
    </div>
  )
}

/**
 * วงแหวนร้อยละ
 *
 * วาดเองด้วย SVG ไม่ดึงไลบรารีกราฟเข้ามาเพื่อวงเดียว
 * ไลบรารีกราฟตัวเล็กสุดก็ยังหนักกว่าทั้งหน้านี้รวมกัน และหน้างานเน็ตไม่นิ่ง
 */
function Ring({ done, total }: { done: number; total: number }) {
  const size = 150
  const sw = 18
  const r = (size - sw) / 2
  const circ = 2 * Math.PI * r
  const ratio = total > 0 ? done / total : 0
  const color = total === 0 ? '#39434F' : ratio >= 0.9 ? '#25A35A' : ratio >= 0.7 ? '#E8B931' : '#E5484D'

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1F2731" strokeWidth={sw} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeDasharray={`${circ * ratio} ${circ}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray .6s ease' }}
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#EAF0F7"
        fontSize={34}
        fontWeight={800}
      >
        {total > 0 ? Math.round(ratio * 100) + '%' : '—'}
      </text>
    </svg>
  )
}

/**
 * แท่งเดียวแบ่งสองสี · เห็นสัดส่วน DO ต่อไม่ใช่ DO ได้โดยไม่ต้องคิดเลข
 *
 * ค่าว่างแปลว่าไฟล์ที่นำเข้ายังไม่ได้บอก DO มา ซึ่งไม่เหมือนกับศูนย์
 * ศูนย์คือคำตอบ ส่วนไม่รู้คือยังไม่มีคำตอบ · วาดแท่งให้ทั้งที่ไม่รู้
 * คือการตอบแทนไฟล์ แล้ววันหนึ่งจะมีคนวางกำลังคนตามแท่งที่เราแต่งขึ้นเอง
 */
function Split({ doJob, nondo }: { doJob: number | null; nondo: number | null }) {
  if (doJob == null && nondo == null) {
    return (
      <p className="mt-2 text-[13px] font-bold" style={{ color: DIM }}>
        ไฟล์ที่นำเข้ายังไม่ได้บอกงาน DO · อัปไฟล์รอบใหม่แล้วตัวเลขจะขึ้นเอง
      </p>
    )
  }
  const d = doJob ?? 0
  const nd = nondo ?? 0
  const sum = d + nd
  const w = sum > 0 ? Math.round((d / sum) * 100) : 0
  return (
    <>
      <div className="mt-2 flex h-4 overflow-hidden rounded-full" style={{ background: '#2A323C' }}>
        <div style={{ width: `${w}%`, background: DO_COLOR }} />
        <div style={{ width: `${100 - w}%`, background: NONDO_COLOR }} />
      </div>
      <div className="mt-2 flex gap-4 text-[14px] font-bold">
        <span style={{ color: '#7BD8FF' }}>DO {nf(doJob)}</span>
        <span style={{ color: '#C4A2FF' }}>ไม่ใช่ DO {nf(nondo)}</span>
      </div>
    </>
  )
}

/**
 * ตารางคันที่ลงเสร็จ
 *
 * เป็นตารางจริง ไม่ใช่การ์ด เพราะคนอ่านหน้านี้กำลังไล่เทียบหลายคันพร้อมกัน
 * ตาต้องกวาดลงเป็นคอลัมน์ได้ ซึ่งการ์ดทำไม่ได้
 */
function DoneTable({ rows }: { rows: WaitTruckRow[] }) {
  if (rows.length === 0) {
    return <p style={{ color: DIM }}>ยังไม่มีคันที่กดลงงานเสร็จ</p>
  }
  const head = ['ประเภท', 'ทะเบียน', 'สถานีก่อนหน้า', 'ถึง', 'ต้องเสร็จ', 'เสร็จจริง', 'ผล', 'ชิ้น', 'DO', 'ไม่ DO', 'คนกด']
  return (
    <div className="max-h-[30vh] overflow-auto">
      <table className="w-full text-[14px]">
        <thead className="sticky top-0" style={{ background: CARD }}>
          <tr style={{ color: DIM }}>
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-2 py-1 text-left font-bold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const lateMin = r.done_at
              ? Math.max(
                  0,
                  Math.round(
                    (new Date(r.done_at).getTime() - new Date(r.due_at).getTime()) / 60000,
                  ),
                )
              : 0
            const ok = r.state === 'done_ontime'
            return (
              <tr key={r.id} className="border-t" style={{ borderColor: LINE }}>
                <td className="whitespace-nowrap px-2 py-[6px] font-extrabold">{r.vehicle_type ?? '—'}</td>
                <td className="whitespace-nowrap px-2 py-[6px] font-extrabold">{r.plate ?? '—'}</td>
                <td className="max-w-[260px] truncate px-2 py-[6px]">{r.from_station ?? '—'}</td>
                <td className="whitespace-nowrap px-2 py-[6px] font-mono">{clock(r.arrived_at)}</td>
                <td className="whitespace-nowrap px-2 py-[6px] font-mono" style={{ color: '#FFD479' }}>
                  {clock(r.due_at)}
                </td>
                <td className="whitespace-nowrap px-2 py-[6px] font-mono font-extrabold">
                  {r.done_at ? clock(r.done_at) : '—'}
                </td>
                <td
                  className="whitespace-nowrap px-2 py-[6px] font-extrabold"
                  style={{ color: ok ? '#35D98A' : '#FF8A8A' }}
                >
                  {ok ? 'ทันเวลา' : `เกิน ${lateMin} นาที`}
                </td>
                <td className="whitespace-nowrap px-2 py-[6px] font-bold" style={{ color: '#FFD479' }}>
                  {nf(r.parcels_all)}
                </td>
                <td className="whitespace-nowrap px-2 py-[6px] font-bold" style={{ color: '#7BD8FF' }}>
                  {nf(r.parcels_do)}
                </td>
                <td className="whitespace-nowrap px-2 py-[6px] font-bold" style={{ color: '#C4A2FF' }}>
                  {nf(r.parcels_nondo)}
                </td>
                <td className="max-w-[160px] truncate px-2 py-[6px]" style={{ color: DIM }}>
                  {r.done_by_name ?? '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------- กล่องสั่งงานบนจอ */

/**
 * แตะการ์ดบนจอทีวีแล้วสั่งงานได้เลย
 *
 * ทำแบบเดียวกับจอปล่อยรถ · จอแขวนอยู่ตรงที่คนทำงานยืนอยู่แล้ว
 * การบังคับให้เดินไปหยิบมือถือ เปิดกระดาน หาคันเดิมให้เจอ แล้วค่อยกด
 * คือสามขั้นที่ไม่ได้ให้อะไรเลยนอกจากโอกาสกดผิดคัน
 *
 * ตัวหนังสือในกล่องนี้ใหญ่กว่ากล่องบนมือถือ เพราะคนกดยืนห่างจากจอ
 * และยังต้องอ่านให้แน่ว่ากดถูกคันก่อนกด
 */
function ActSheet({
  r,
  sec,
  onClose,
  onChanged,
}: {
  r: WaitTruckRow
  sec: number
  onClose: () => void
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [why, setWhy] = useState<string | null>(null)

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setErr(null)
    try {
      await fn()
      onChanged()
    } catch (e) {
      setErr(readableError(e))
      setBusy(false)
    }
  }

  const tel = (r.driver_phone ?? '').replace(/[^0-9+]/g, '')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,.8)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[720px] rounded-2xl p-6 text-white"
        style={{ background: '#141B24', border: `2px solid ${STATE_COLOR[liveState(r, sec)]}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <h2 className="min-w-0 flex-1 text-[30px] font-extrabold leading-tight">
            {r.from_station ?? 'ไม่ระบุสถานี'}
          </h2>
          <Pill state={liveState(r, sec)} size={16} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Badge text={r.vehicle_type ?? '—'} size={24} bg="#1C2430" fg="#9FB4CC" />
          <Badge text={r.plate ?? '—'} size={24} bg="#1B2430" fg="#EAF0F7" />
          <Parcels all={r.parcels_all} doJob={r.parcels_do} nondo={r.parcels_nondo} size={22} />
        </div>

        <p className="mt-2 font-mono text-[15px]" style={{ color: DIM }}>
          {r.truck_barcode}
          {r.driver_name && ` · ${r.driver_name}`}
          {r.driver_phone && ` · ${r.driver_phone}`}
        </p>

        <div className="mt-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-[13px] font-bold" style={{ color: DIM }}>รถถึงจริง · เสร็จก่อน</div>
            <div className="font-mono text-[26px] font-extrabold">
              {clock(r.arrived_at)}
              <span style={{ color: DIM }}> · </span>
              <span style={{ color: sec < 0 ? '#FF8A8A' : '#FFD479' }}>{clock(r.due_at)}</span>
            </div>
          </div>
          <Timer sec={sec} size={54} />
        </div>

        {err && (
          <p
            className="mt-4 rounded-lg px-3 py-2 text-[16px] font-bold"
            style={{ background: 'rgba(255,92,92,.14)', color: '#FF9A9A' }}
          >
            {err}
          </p>
        )}

        {why === null ? (
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              disabled={busy}
              onClick={() => void run(() => doneWaitTruck(r.id))}
              className="h-14 min-w-[200px] flex-1 rounded-xl text-[20px] font-extrabold disabled:opacity-50"
              style={{ background: '#25A35A', color: '#fff' }}
            >
              {busy ? 'กำลังบันทึก…' : 'ลงงานเสร็จ'}
            </button>
            {tel !== '' && (
              <a
                href={`tel:${tel}`}
                className="flex h-14 items-center justify-center rounded-xl px-5 text-[17px] font-bold"
                style={{ background: INSET, border: `1px solid ${LINE}`, color: '#EAF0F7' }}
              >
                โทรหาคนขับ
              </a>
            )}
            <button
              disabled={busy}
              onClick={() => setWhy('')}
              className="h-14 rounded-xl px-5 text-[17px] font-bold disabled:opacity-50"
              style={{ background: INSET, border: `1px solid ${LINE}`, color: '#FFB4B6' }}
            >
              ยกเลิกคันนี้
            </button>
            <button
              onClick={onClose}
              className="h-14 rounded-xl px-5 text-[17px] font-bold"
              style={{ background: '#1B2430', color: DIM }}
            >
              ปิด
            </button>
          </div>
        ) : (
          <div className="mt-5">
            <p className="mb-2 text-[16px] font-bold">เลือกเหตุผลที่ยกเลิก</p>
            <div className="mb-3 flex flex-wrap gap-2">
              {WAIT_CANCEL_REASONS.map((x) => (
                <button
                  key={x}
                  onClick={() => setWhy(x)}
                  className="h-12 rounded-xl px-4 text-[16px] font-bold"
                  style={
                    why === x
                      ? { background: '#EAF0F7', color: '#101316' }
                      : { background: INSET, border: `1px solid ${LINE}`, color: '#EAF0F7' }
                  }
                >
                  {x}
                </button>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setWhy(null)}
                className="h-14 flex-1 rounded-xl text-[17px] font-bold"
                style={{ background: '#1B2430', color: DIM }}
              >
                ย้อนกลับ
              </button>
              <button
                disabled={busy || why.trim() === ''}
                onClick={() => void run(() => cancelWaitTruck(r.id, why))}
                className="h-14 flex-1 rounded-xl text-[18px] font-extrabold disabled:opacity-40"
                style={{ background: '#E5484D', color: '#fff' }}
              >
                {why.trim() === '' ? 'ต้องเลือกเหตุผลก่อน' : 'ยืนยันยกเลิก'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
