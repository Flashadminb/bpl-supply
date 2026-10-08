import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAsync } from '../../lib/useAsync'
import {
  listWaitBoard,
  waitTruckCounts,
  type WaitTruckRow,
} from '../../lib/waitTrucks'
import { useAlarmPref, useTruckAlarm } from '../trucks/alarm'
import { playWaitAlarm, WAIT_ALARM_PREF } from './waitAlarm'
import { AlarmGate, EdgeGlow, worstStage } from '../trucks/alert-ui'
import { p2 } from '../trucks/parts'
import {
  BG,
  CARD,
  clock,
  DIM,
  INSET,
  LINE,
  liveState,
  nf,
  pct,
  Pill,
  secLeft,
  STATE_COLOR,
  Strip,
  Timer,
  FLASH_MS,
  FlashBell,
  WaitAlarmChip,
  WaitLogo,
} from './parts'

/**
 * จอทีวีรถรอลงงาน
 *
 * แขวนไว้ให้คนอ่านจากอีกฝั่งของคลัง ไม่มีใครมากดอะไรบนจอนี้
 * ทุกอย่างจึงใหญ่กว่าหน้ากระดานทุกจุด และไม่มีปุ่มสักปุ่ม
 *
 * สองหน้าสลับกันทุก 20 วินาที เหมือนจอปล่อยรถ
 *   หน้าแรก  รถทุกคันที่ยังรอ เรียงจากคันที่ต้องรีบที่สุด
 *   หน้าสอง  สถิติ "ตอนนี้" ไม่ใช่ "วันนี้"
 *
 * เจ้าของระบบย้ำเรื่องนี้ไว้ — ยอดรวมทั้งวันไม่ช่วยคนที่ยืนอยู่หน้ารถ
 * สิ่งที่เขาต้องรู้คือตอนนี้คันไหนรอนานสุด และคันไหนใกล้หมดเวลาสุด
 */

const FLIP_MS = 20_000

const PAGES = ['กระดาน', 'สถิติ'] as const

/** จำไว้ว่าจอนี้ให้สลับเองหรือเปล่า · จอทีวีไม่มีใครมาตั้งใหม่ทุกเช้า */
const AUTO_PREF = 'wait.tv.auto'

export default function WaitTv() {
  const nav = useNavigate()
  const board = useAsync(listWaitBoard, [])
  const counts = useAsync(waitTruckCounts, [])
  const [now, setNow] = useState(() => Date.now())
  const [page, setPage] = useState(0)
  // ค่าเริ่มต้นคือสลับเอง · จอที่แขวนไว้เฉย ๆ ต้องหมุนเองตั้งแต่เสียบปลั๊ก
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
   * ผูกกับ page ไว้ด้วย การกดเองจึงรีเซ็ตเวลาให้อัตโนมัติ
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

  /** คันที่เพิ่งเตือน · หายเองหลัง FLASH_MS เพราะ now เดินทุกวินาที */
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
        <StatsPage live={live} done={counts.data?.done ?? 0} onTime={counts.data?.on_time ?? 0} />
      )}
    </div>
  )
}

/**
 * หัวจอ
 *
 * ปุ่มทั้งแถวนี้ไม่ได้มีไว้ใช้ตอนทำงานปกติ จอทีวีไม่มีใครเดินไปกด
 * มีไว้ตอนตั้งจอ ตอนอยากหยุดดูหน้าสถิตินาน ๆ และตอนเปิดจากมือถือ
 * จึงทำให้เล็กและจางกว่าตัวเลขทุกตัวบนจอ แต่ยังกดติดด้วยนิ้วที่ใส่ถุงมือ
 */
function TvHead({
  now,
  page,
  live,
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
  let pcs = 0
  for (const { r, sec } of live) {
    const st = liveState(r, sec)
    if (st === 'overdue') over++
    else if (st === 'warn') warn++
    pcs += r.parcels ?? 0
  }

  return (
    <header className="mb-4">
      <div className="flex items-end gap-4">
      <WaitLogo size={30} />
      <div className="flex flex-1 gap-3">
        <TvChip label="เกินเวลา" n={over} color="#E5484D" />
        <TvChip label="เฝ้าระวัง" n={warn} color="#E8B931" />
        <TvChip label="กำลังรอทั้งหมด" n={live.length} color="#2F7FE0" />
        <TvChip label="พัสดุยังไม่ลง" n={nf(pcs)} color="#1C2430" />
      </div>
      <div className="text-right">
        <div className="font-mono text-[34px] font-extrabold leading-none">
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
        <TvBtn onClick={() => onGo('/wait/upload')}>อัปไฟล์</TvBtn>

        <span className="mx-1 h-6 w-px" style={{ background: LINE }} />

        {PAGES.map((label, i) => (
          <TvBtn key={label} onClick={() => onPage(i)} active={page === i}>
            {i + 1}. {label}
          </TvBtn>
        ))}

        {/* ติ๊กไว้เป็นค่าเริ่มต้น · ปลดเมื่ออยากค้างหน้าสถิติไว้ดูนาน ๆ */}
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

        <span className="ml-auto">
          <WaitAlarmChip on={alarmOn} onTurnOn={onAlarmOn} compact />
        </span>
      </div>
    </header>
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

function TvChip({ label, n, color }: { label: string; n: number | string; color: string }) {
  const dark = color === '#E8B931'
  return (
    <div
      className="flex min-w-0 flex-1 items-baseline justify-between gap-2 rounded-xl px-4 py-2"
      style={{ background: color, color: dark ? '#1A1405' : '#fff' }}
    >
      <span className="truncate text-[15px] font-bold opacity-90">{label}</span>
      <span className="text-[32px] font-extrabold leading-none">{n}</span>
    </div>
  )
}

/* ------------------------------------------------------------- หน้าที่หนึ่ง */

/**
 * ของเยอะแล้วย่อ ไม่ใช่ตัดทิ้ง
 *
 * วิธีเดียวกับแถบเร่งด่วนของจอปล่อยรถ · คันที่ถูกตัดออกคือคันที่ไม่มีใครเห็นเลย
 * ซึ่งอันตรายกว่าคันที่ตัวเล็กลง
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
  const cols = n <= 3 ? 1 : n <= 8 ? 2 : 3
  const big = n <= 6
  const timer = n <= 3 ? 64 : n <= 8 ? 48 : 36

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {live.map(({ r, sec }) => (
        <TvCard key={r.id} r={r} sec={sec} big={big} timer={timer} flash={flashing.has(r.id)} />
      ))}
    </div>
  )
}

function TvCard({
  r,
  sec,
  big,
  timer,
  flash,
}: {
  r: WaitTruckRow
  sec: number
  big: boolean
  timer: number
  flash: boolean
}) {
  const st = liveState(r, sec)
  return (
    <article
      className="relative overflow-hidden rounded-2xl"
      style={{ background: CARD, border: `1px solid ${LINE}` }}
    >
      <Strip color={STATE_COLOR[st]} />
      <div className="py-3 pl-5 pr-3">
        <div className="flex items-start gap-2">
          <h2
            className="min-w-0 flex-1 font-extrabold leading-tight"
            style={{ fontSize: big ? 24 : 18 }}
          >
            {r.from_station ?? 'ไม่ระบุสถานี'}
          </h2>
          {flash && <FlashBell size={big ? 20 : 16} />}
          <Pill state={st} size={big ? 14 : 12} />
        </div>

        <div className="mt-2 flex items-center justify-between gap-3">
          <div
            className="shrink-0 rounded-xl px-3 py-2"
            style={{ background: INSET, border: `1px solid ${LINE}` }}
          >
            <div className="text-[11px] font-bold" style={{ color: DIM }}>
              ถึง · เสร็จก่อน
            </div>
            <div className="font-mono font-extrabold" style={{ fontSize: big ? 22 : 17 }}>
              {clock(r.arrived_at)} · {clock(r.due_at)}
            </div>
          </div>
          <Timer sec={sec} size={timer} />
        </div>

        <div
          className="mt-2 flex flex-wrap items-center gap-x-3"
          style={{ fontSize: big ? 15 : 13 }}
        >
          <span
            className="rounded-md px-2 py-[2px] font-extrabold"
            style={{ background: '#1C2430', color: '#9FB4CC' }}
          >
            {r.vehicle_type ?? '—'}
          </span>
          <span className="font-bold">{r.plate ?? '—'}</span>
          <span style={{ color: DIM }}>{r.truck_barcode}</span>
          <span className="ml-auto font-extrabold" style={{ color: '#FFD479' }}>
            {nf(r.parcels)} ชิ้น
          </span>
        </div>
      </div>
    </article>
  )
}

/* -------------------------------------------------------------- หน้าที่สอง */

/**
 * สถิติ "ตอนนี้"
 *
 * ไม่มียอดรวมทั้งวันบนจอนี้ เพราะเจ้าของระบบบอกตรง ๆ ว่ามันไม่มีประโยชน์กับหน้างาน
 * สองการ์ดเด่นคือคำถามสองข้อที่คนหน้างานถามกันจริง ๆ ทั้งกะ
 *   คันไหนรอนานสุดแล้ว · คันไหนกำลังจะเกินก่อนเพื่อน
 * ใต้แต่ละการ์ดมีอันดับรองลงมาอีกสามคัน เพราะของจริงไม่ได้มีคันเดียว
 */
function StatsPage({
  live,
  done,
  onTime,
}: {
  live: { r: WaitTruckRow; sec: number }[]
  done: number
  onTime: number
}) {
  const byWait = useMemo(
    () =>
      [...live].sort(
        (a, b) => new Date(a.r.arrived_at).getTime() - new Date(b.r.arrived_at).getTime(),
      ),
    [live],
  )
  const bySoon = live // เรียงตามวินาทีที่เหลืออยู่แล้ว

  const byType = useMemo(() => {
    const m = new Map<string, { n: number; pcs: number; over: number; warn: number }>()
    for (const { r, sec } of live) {
      const k = r.vehicle_type ?? '—'
      const cur = m.get(k) ?? { n: 0, pcs: 0, over: 0, warn: 0 }
      cur.n++
      cur.pcs += r.parcels ?? 0
      const st = liveState(r, sec)
      if (st === 'overdue') cur.over++
      else if (st === 'warn') cur.warn++
      m.set(k, cur)
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n)
  }, [live])

  return (
    <div className="grid gap-3 lg:grid-cols-2" style={{ minHeight: 'calc(100dvh - 180px)', gridAutoRows: '1fr' }}>
      <Hero
        title="คันที่รอนานสุดตอนนี้"
        rows={byWait}
        metric={(x) => waited(x.r)}
        accent="#E5484D"
      />
      <Hero
        title="คันที่ใกล้หมดเวลาสุดตอนนี้"
        rows={bySoon}
        metric={(x) => mmss(x.sec)}
        accent="#E8B931"
      />

      <section className="rounded-2xl p-4" style={{ background: CARD, border: `1px solid ${LINE}` }}>
        <h3 className="mb-2 text-[18px] font-extrabold">ประเภทรถที่รอลงงานอยู่ตอนนี้</h3>
        {byType.length === 0 ? (
          <p style={{ color: DIM }}>ไม่มีรถรออยู่</p>
        ) : (
          <div className="space-y-2">
            {byType.map(([t, v]) => (
              <div
                key={t}
                className="flex items-center gap-3 rounded-xl px-3 py-2"
                style={{ background: INSET }}
              >
                <span
                  className="w-[60px] shrink-0 rounded-md px-2 py-[3px] text-center text-[14px] font-extrabold"
                  style={{ background: '#1C2430', color: '#9FB4CC' }}
                >
                  {t}
                </span>
                <span className="text-[22px] font-extrabold">{v.n}</span>
                <span className="text-[13px]" style={{ color: DIM }}>
                  คัน · {nf(v.pcs)} ชิ้น
                </span>
                <span className="ml-auto flex gap-2 text-[13px] font-bold">
                  {v.over > 0 && (
                    <span style={{ color: '#FF8A8A' }}>เกิน {v.over}</span>
                  )}
                  {v.warn > 0 && (
                    <span style={{ color: '#FFD479' }}>เฝ้าระวัง {v.warn}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl p-4" style={{ background: CARD, border: `1px solid ${LINE}` }}>
        <h3 className="mb-2 text-[18px] font-extrabold">ลงงานเสร็จไปแล้วในรอบนี้</h3>
        <div className="flex items-end gap-6">
          <div>
            <div className="text-[52px] font-extrabold leading-none">{done}</div>
            <div className="text-[13px]" style={{ color: DIM }}>
              คัน · นับตั้งแต่ตีสาม
            </div>
          </div>
          <div>
            <div className="text-[52px] font-extrabold leading-none" style={{ color: '#35D98A' }}>
              {pct(onTime, done)}
            </div>
            <div className="text-[13px]" style={{ color: DIM }}>
              ทันเวลา {onTime} จาก {done}
            </div>
          </div>
        </div>
        <div className="mt-3 h-3 overflow-hidden rounded-full" style={{ background: '#2A323C' }}>
          <div
            className="h-full"
            style={{
              width: done > 0 ? `${Math.round((onTime / done) * 100)}%` : '0%',
              background: '#25A35A',
            }}
          />
        </div>
      </section>
    </div>
  )
}

/** รอมานานเท่าไหร่แล้ว · นับจากเวลารถถึงจริง ไม่ใช่จากเวลาที่อัปไฟล์ */
function waited(r: WaitTruckRow): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(r.arrived_at).getTime()) / 1000))
  return `${Math.floor(s / 3600)}:${p2(Math.floor(s / 60) % 60)}`
}

function mmss(sec: number): string {
  const a = Math.abs(sec)
  return `${sec < 0 ? '−' : ''}${Math.floor(a / 3600)}:${p2(Math.floor(a / 60) % 60)}`
}

function Hero({
  title,
  rows,
  metric,
  accent,
}: {
  title: string
  rows: { r: WaitTruckRow; sec: number }[]
  metric: (x: { r: WaitTruckRow; sec: number }) => string
  accent: string
}) {
  const top = rows[0]
  const rest = rows.slice(1, 4)

  return (
    <section className="rounded-2xl p-4" style={{ background: CARD, border: `1px solid ${LINE}` }}>
      <h3 className="mb-2 text-[18px] font-extrabold">{title}</h3>

      {!top ? (
        <p style={{ color: DIM }}>ไม่มีรถรออยู่</p>
      ) : (
        <>
          <div className="rounded-xl p-3" style={{ background: INSET, border: `1px solid ${accent}` }}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[22px] font-extrabold leading-tight">
                  {top.r.from_station ?? top.r.truck_barcode}
                </p>
                <p className="mt-1 truncate text-[13px]" style={{ color: DIM }}>
                  {top.r.vehicle_type ?? '—'} · ทะเบียน {top.r.plate ?? '—'} ·{' '}
                  {nf(top.r.parcels)} ชิ้น
                </p>
              </div>
              {/* ติดหน่วยไว้เสมอ · 24:40 เปล่า ๆ อ่านเป็นนาทีกับวินาทีได้ง่ายมาก */}
              <span className="flex shrink-0 items-baseline gap-1">
                <span
                  className="font-mono text-[42px] font-extrabold leading-none"
                  style={{ color: accent }}
                >
                  {metric(top)}
                </span>
                <span className="text-[14px] font-bold" style={{ color: DIM }}>
                  ชม.
                </span>
              </span>
            </div>
          </div>

          {rest.length > 0 && (
            <div className="mt-2 space-y-1">
              {rest.map((x, i) => (
                <div key={x.r.id} className="flex items-center gap-2 px-1 text-[14px]">
                  <span className="w-5 shrink-0 text-right font-bold" style={{ color: DIM }}>
                    {i + 2}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {x.r.from_station ?? x.r.truck_barcode}
                  </span>
                  <span className="shrink-0 font-mono font-bold" style={{ color: DIM }}>
                    {metric(x)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
