import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAsync } from '../../lib/useAsync'
import {
  listWaitBoard,
  listWaitDone,
  waitTruckCounts,
  type WaitCounts,
  type WaitTruckRow,
} from '../../lib/waitTrucks'
import { useAlarmPref, useTruckAlarm } from '../trucks/alarm'
import { AlarmGate, EdgeGlow, worstStage } from '../trucks/alert-ui'
import { playWaitAlarm, WAIT_ALARM_PREF } from './waitAlarm'
import { p2 } from '../trucks/parts'
import {
  BG,
  CARD,
  clock,
  DIM,
  FLASH_MS,
  FlashBell,
  INSET,
  LastUpdate,
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

export default function WaitTv() {
  const nav = useNavigate()
  const board = useAsync(listWaitBoard, [])
  const counts = useAsync(waitTruckCounts, [])
  const since = useMemo(() => new Date(Date.now() - 24 * 3600_000).toISOString(), [])
  const done = useAsync(() => listWaitDone(since), [since])

  const [now, setNow] = useState(() => Date.now())
  const [page, setPage] = useState(0)
  const [auto, setAuto] = useState(() => localStorage.getItem(AUTO_PREF) !== 'off')
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

  return (
    <div className="min-h-dvh overflow-hidden px-5 py-4 text-white" style={{ background: BG }}>
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
        <BoardPage live={live} loading={board.loading} flashing={flashing} />
      ) : (
        <StatsPage live={live} counts={counts.data} done={done.data ?? []} />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ หัวจอ */

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
    <header className="mb-3">
      <div className="flex items-end gap-4">
        <WaitLogo size={28} />
        <div className="flex flex-1 gap-3">
          <TvChip label="เกินเวลา" n={over} color="#E5484D" />
          <TvChip label="เฝ้าระวัง" n={warn} color="#E8B931" />
          {/* ชื่อเดิมคือ "กำลังรอทั้งหมด" ซึ่งอ่านแล้วนึกว่านับเฉพาะคันที่ยังไม่ถึงเวลา
              จริง ๆ มันคือรถที่รอลงงานทั้งกระดาน · กดลงงานเสร็จแล้วเลขนี้จะลด */}
          <TvChip label="รถรอลงงานทั้งหมด" n={live.length} color="#2F7FE0" />
          <TvChip label="DO" n={nf(counts?.wait_do ?? 0)} color="#17566E" />
          <TvChip label="ไม่ใช่ DO" n={nf(counts?.wait_nondo ?? 0)} color="#3D2C66" />
        </div>
        <div className="text-right">
          <div className="font-mono text-[32px] font-extrabold leading-none">
            {p2(d.getHours())}:{p2(d.getMinutes())}
          </div>
          <div className="mt-1 flex justify-end gap-1">
            {PAGES.map((_, i) => (
              <span
                key={i}
                className="block h-[6px] rounded-full transition-all"
                style={{ width: i === page ? 26 : 10, background: i === page ? '#EAF0F7' : '#39434F' }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <TvBtn onClick={() => onGo('/wait')}>← กระดานหน้างาน</TvBtn>
        <TvBtn onClick={() => onGo('/wait?upload=1')}>อัปไฟล์</TvBtn>

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

        <span className="ml-3">
          <LastUpdate at={counts?.last_import} now={now} size={13} />
        </span>

        <span className="ml-auto">
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
      className="flex min-w-0 flex-1 items-baseline justify-between gap-2 rounded-xl px-3 py-2"
      style={{ background: color, color: dark ? '#1A1405' : '#fff' }}
    >
      <span className="truncate text-[14px] font-bold opacity-90">{label}</span>
      <span className="text-[28px] font-extrabold leading-none">{n}</span>
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

/**
 * ขนาดการ์ดไล่ตามความสำคัญ
 *
 * เวลางานเยอะ ทุกการ์ดเท่ากันหมดคือกระดานที่ไม่ได้บอกอะไรเลยนอกจาก "มีงานเยอะ"
 * คันที่เกินเวลาแล้วต้องใหญ่กว่าคันที่ยังมีเวลาเหลือ โดยไม่ต้องอ่านตัวเลข
 *
 * ใช้การกินช่องในตารางแทนการย่อตัวอักษร เพราะตัวอักษรที่เล็กลง
 * คือตัวอักษรที่อ่านไม่ออกจากกลางคลัง ซึ่งเท่ากับไม่มีอยู่
 *   เกินเวลา   กินสองช่อง ตัวใหญ่สุด
 *   เฝ้าระวัง  กินหนึ่งช่อง ตัวกลาง
 *   กำลังรอ    กินหนึ่งช่อง ตัวเล็กสุด
 */
function BoardPage({
  live,
  loading,
  flashing,
}: {
  live: { r: WaitTruckRow; sec: number }[]
  loading: boolean
  flashing: Set<number>
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

  const n = live.length
  const cols = n <= 2 ? 2 : n <= 6 ? 3 : 4

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {live.map(({ r, sec }) => {
        const st = liveState(r, sec)
        const big = st === 'overdue'
        const mid = st === 'warn'
        return (
          <TvCard
            key={r.id}
            r={r}
            sec={sec}
            span={big && cols > 1 ? 2 : 1}
            scale={big ? 1 : mid ? 0.82 : 0.68}
            flash={flashing.has(r.id)}
          />
        )
      })}
    </div>
  )
}

function TvCard({
  r,
  sec,
  span,
  scale,
  flash,
}: {
  r: WaitTruckRow
  sec: number
  span: number
  scale: number
  flash: boolean
}) {
  const st = liveState(r, sec)
  const px = (n: number) => Math.round(n * scale)

  return (
    <article
      className="relative overflow-hidden rounded-2xl"
      style={{ background: CARD, border: `1px solid ${LINE}`, gridColumn: `span ${span}` }}
    >
      <Strip color={STATE_COLOR[st]} />
      <div className="py-3 pl-5 pr-3">
        <div className="flex items-start gap-2">
          {flash && <FlashBell size={px(20)} />}
          <h2 className="min-w-0 flex-1 font-extrabold leading-tight" style={{ fontSize: px(26) }}>
            {r.from_station ?? 'ไม่ระบุสถานี'}
          </h2>
          <Pill state={st} size={px(15)} />
        </div>

        <div className="mt-2 flex items-center justify-between gap-3">
          {/*
            เวลาที่ต้องเสร็จก่อนเป็นตัวเลขที่คนเอาไปเทียบกับนาฬิกาบนผนัง
            จึงทำเป็นป้ายสีเหลืองแยกออกมา ไม่ใช่ตัวหนังสือจาง ๆ ต่อท้ายเวลารถถึง
          */}
          <div className="shrink-0">
            <div className="text-[11px] font-bold" style={{ color: DIM }}>รถถึงจริง</div>
            <div className="font-mono font-extrabold" style={{ fontSize: px(22) }}>
              {clock(r.arrived_at)}
            </div>
            <div
              className="mt-1 inline-flex items-baseline gap-1 rounded-lg px-2 py-[2px]"
              style={{ background: sec < 0 ? '#3A1416' : '#2A2206' }}
            >
              <span className="text-[10px] font-bold" style={{ color: sec < 0 ? '#FFB4B6' : '#D9C78A' }}>
                เสร็จก่อน
              </span>
              <span
                className="font-mono font-extrabold"
                style={{ fontSize: px(20), color: sec < 0 ? '#FF8A8A' : '#FFD479' }}
              >
                {clock(r.due_at)}
              </span>
            </div>
          </div>
          <Timer sec={sec} size={px(46)} />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span
            className="rounded-md px-2 py-[2px] font-extrabold"
            style={{ background: '#1C2430', color: '#9FB4CC', fontSize: px(17) }}
          >
            {r.vehicle_type ?? '—'}
          </span>
          <span className="font-extrabold" style={{ fontSize: px(17) }}>{r.plate ?? '—'}</span>
          <span style={{ color: DIM, fontSize: px(13) }}>{r.truck_barcode}</span>
          <Parcels all={r.parcels_all} doJob={r.parcels_do} nondo={r.parcels_nondo} size={px(15)} />
        </div>
      </div>
    </article>
  )
}

/* -------------------------------------------------------------- หน้าที่สอง */

/**
 * หน้าสถิติ
 *
 * เรียงจากคำถามที่หน้างานถามจริง ไล่จากบนลงล่าง
 *   ① ตอนนี้เหลืองานเท่าไหร่ และทำไปได้เท่าไหร่แล้ว
 *   ② ประเภทรถที่ยังค้างอยู่ — ใช้วางกำลังคนหน้าสายพาน
 *   ③ พัสดุที่ลงไปแล้ว แยก DO กับไม่ใช่ DO
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
    const m = new Map<string, { n: number; pcs: number; doJob: number; over: number; warn: number }>()
    for (const { r, sec } of live) {
      const k = r.vehicle_type ?? '—'
      const cur = m.get(k) ?? { n: 0, pcs: 0, doJob: 0, over: 0, warn: 0 }
      cur.n++
      cur.pcs += r.parcels_all ?? 0
      cur.doJob += r.parcels_do ?? 0
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

  return (
    <div className="space-y-3">
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
          n={pct(c?.on_time ?? 0, doneN)}
          sub={`${c?.on_time ?? 0} จาก ${doneN} คัน`}
          color="#35D98A"
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* ② ประเภทรถที่ยังค้าง · การ์ดเด่นตามที่สั่ง */}
        <section className="rounded-2xl p-4" style={{ background: CARD, border: `1px solid ${LINE}` }}>
          <h3 className="mb-3 text-[20px] font-extrabold">ประเภทรถที่รอลงงานอยู่ตอนนี้</h3>
          {byType.length === 0 ? (
            <p style={{ color: DIM }}>ไม่มีรถรออยู่</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
              {byType.map(([t, v]) => (
                <div
                  key={t}
                  className="rounded-xl p-3"
                  style={{
                    background: INSET,
                    border: `1px solid ${v.over > 0 ? '#E5484D' : LINE}`,
                  }}
                >
                  <div className="flex items-baseline justify-between">
                    <span
                      className="rounded-md px-2 py-[2px] text-[16px] font-extrabold"
                      style={{ background: '#1C2430', color: '#9FB4CC' }}
                    >
                      {t}
                    </span>
                    <span className="text-[36px] font-extrabold leading-none">{v.n}</span>
                  </div>
                  <div className="mt-1 text-[13px]" style={{ color: DIM }}>
                    {nf(v.pcs)} ชิ้น · DO {nf(v.doJob)}
                  </div>
                  <div className="mt-1 flex gap-2 text-[13px] font-bold">
                    {v.over > 0 && <span style={{ color: '#FF8A8A' }}>เกิน {v.over}</span>}
                    {v.warn > 0 && <span style={{ color: '#FFD479' }}>เฝ้าระวัง {v.warn}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ③ พัสดุ · แท่งเทียบ DO กับไม่ใช่ DO */}
        <section className="rounded-2xl p-4" style={{ background: CARD, border: `1px solid ${LINE}` }}>
          <h3 className="mb-3 text-[20px] font-extrabold">พัสดุที่ลงไปแล้วในรอบนี้</h3>
          <div className="text-[46px] font-extrabold leading-none">
            {nf(c?.done_parcels ?? 0)}
            <span className="ml-2 text-[16px] font-bold" style={{ color: DIM }}>ชิ้น</span>
          </div>
          <Split
            doJob={c?.done_do ?? 0}
            nondo={c?.done_nondo ?? 0}
          />

          <h3 className="mb-2 mt-5 text-[16px] font-extrabold" style={{ color: DIM }}>
            ที่ยังค้างอยู่
          </h3>
          <div className="text-[30px] font-extrabold leading-none">
            {nf(c?.wait_parcels ?? 0)}
            <span className="ml-2 text-[14px] font-bold" style={{ color: DIM }}>ชิ้น</span>
          </div>
          <Split doJob={c?.wait_do ?? 0} nondo={c?.wait_nondo ?? 0} />
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
    <div className="rounded-2xl p-3" style={{ background: CARD, border: `1px solid ${LINE}` }}>
      <div className="text-[13px] font-bold" style={{ color: DIM }}>{label}</div>
      <div className="mt-1 text-[40px] font-extrabold leading-none" style={{ color }}>{n}</div>
      {sub && <div className="mt-1 text-[12px]" style={{ color: DIM }}>{sub}</div>}
    </div>
  )
}

/** แท่งเดียวแบ่งสองสี · เห็นสัดส่วน DO ต่อไม่ใช่ DO ได้โดยไม่ต้องคิดเลข */
function Split({ doJob, nondo }: { doJob: number; nondo: number }) {
  const sum = doJob + nondo
  const w = sum > 0 ? Math.round((doJob / sum) * 100) : 0
  return (
    <>
      <div className="mt-2 flex h-4 overflow-hidden rounded-full" style={{ background: '#2A323C' }}>
        <div style={{ width: `${w}%`, background: '#2BA7D8' }} />
        <div style={{ width: `${100 - w}%`, background: '#8B5CF6' }} />
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
    <div className="max-h-[38vh] overflow-auto">
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
              ? Math.max(0, Math.round((new Date(r.done_at).getTime() - new Date(r.due_at).getTime()) / 60000))
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
                <td className="whitespace-nowrap px-2 py-[6px] font-extrabold"
                    style={{ color: ok ? '#35D98A' : '#FF8A8A' }}>
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
