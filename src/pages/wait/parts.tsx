import type { ReactNode } from 'react'
import { Countdown, p2 } from '../trucks/parts'
import { Bell } from '../trucks/alert-ui'
import type { WaitState, WaitTruckRow } from '../../lib/waitTrucks'

/**
 * ชิ้นส่วนที่กระดาน จอทีวี และหน้าสถิติของรถรอลงงานใช้ร่วมกัน
 *
 * เหตุผลเดียวกับ trucks/parts.tsx — สีกับนิยามของคำว่า "เฝ้าระวัง"
 * ต้องมาจากที่เดียว ไม่งั้นวันหนึ่งจะมีจอหนึ่งที่เริ่มเหลืองคนละนาทีกับอีกจอ
 * แล้วไม่มีใครรู้ว่าควรเชื่อจอไหน
 *
 * ตัวนับถอยหลังยืมของตารางปล่อยรถมาทั้งก้อน เพราะหน้างานกลุ่มเดียวกัน
 * อ่านสองกระดานนี้สลับกันทั้งกะ นาฬิกาสองแบบคือภาระที่ไม่จำเป็น
 */

export const BG = '#0B0F16'
export const CARD = '#161B22'
export const INSET = '#0F141B'
export const LINE = '#232B36'
export const DIM = '#8A97A6'

/** เฝ้าระวังเริ่มที่ 20 นาที · ต้องตรงกับวิวในฐานข้อมูลและเสียงเตือนขั้นแรก */
export const WARN_SEC = 20 * 60

export const STATE_COLOR: Record<WaitState, string> = {
  overdue: '#E5484D',
  warn: '#E8B931',
  waiting: '#2F7FE0',
  done_ontime: '#25A35A',
  done_late: '#E5484D',
  cancelled: '#55616F',
}

export const STATE_CHIP: Record<WaitState, string> = {
  overdue: 'เกินเวลา',
  warn: 'เฝ้าระวัง',
  waiting: 'กำลังรอ',
  done_ontime: 'ทันเวลา',
  done_late: 'ไม่ทัน',
  cancelled: 'ยกเลิก',
}

/**
 * สถานะที่คิดจากวินาทีที่เหลือในเครื่อง ไม่ใช่ค่าที่โหลดมา
 *
 * ค่าจากฐานข้อมูลถูกตอนโหลด แต่หน้านี้เปิดค้างทั้งกะ
 * ถ้าเชื่อค่าที่โหลดมาอย่างเดียว ป้ายจะยังเขียวอยู่ทั้งที่นาฬิกาติดลบไปแล้วสิบนาที
 */
export function liveState(r: WaitTruckRow, sec: number): WaitState {
  if (r.cancelled_at) return 'cancelled'
  if (r.done_at) return r.state === 'done_late' ? 'done_late' : 'done_ontime'
  if (sec < 0) return 'overdue'
  if (sec <= WARN_SEC) return 'warn'
  return 'waiting'
}

/** วินาทีที่เหลือจริง ณ ตอนนี้ · ของที่จบแล้วหยุดที่เวลาที่กดเสร็จ */
export function secLeft(r: WaitTruckRow, nowMs: number): number {
  const due = new Date(r.due_at).getTime()
  const stop = r.done_at ? new Date(r.done_at).getTime() : nowMs
  return Math.round((due - stop) / 1000)
}

export const clock = (iso: string): string => {
  const d = new Date(iso)
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`
}

/** แคปซูลสถานะ · สีทึบ ตัวหนังสือเข้มบนเหลืองเสมอ ตามกติกาใช้กลางแดด */
export function Pill({ state, size = 13 }: { state: WaitState; size?: number }) {
  const bg = STATE_COLOR[state]
  const dark = state === 'warn'
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full font-extrabold leading-none"
      style={{
        background: bg,
        color: dark ? '#1A1405' : '#fff',
        fontSize: size,
        padding: `${Math.round(size * 0.42)}px ${Math.round(size * 0.85)}px`,
      }}
    >
      {STATE_CHIP[state]}
    </span>
  )
}

/** กล่องข้อมูลจมลงไปในการ์ด · ใช้คู่ รถถึงจริง กับ ต้องเสร็จก่อน */
export function Inset({
  children,
  pad = 10,
  className = '',
}: {
  children: ReactNode
  pad?: number
  className?: string
}) {
  return (
    <div
      className={'rounded-xl ' + className}
      style={{ background: INSET, border: `1px solid ${LINE}`, padding: pad }}
    >
      {children}
    </div>
  )
}

export function Field({
  label,
  value,
  size = 20,
  color = '#EAF0F7',
}: {
  label: string
  value: ReactNode
  size?: number
  color?: string
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-bold leading-none" style={{ color: DIM }}>
        {label}
      </div>
      <div
        className="mt-1 truncate font-extrabold leading-tight"
        style={{ fontSize: size, color }}
      >
        {value}
      </div>
    </div>
  )
}

/**
 * นาฬิกาของการ์ด · ชิ้นที่ใหญ่ที่สุดบนการ์ดเสมอ
 *
 * เคยลองทำให้เวลารถถึงเด่นกว่าแล้วเจ้าของระบบทักทันทีว่านาฬิกาหายไปไหน
 * ซึ่งถูก — คนที่ยืนอยู่หน้ารถต้องการรู้ว่าเหลือเวลาเท่าไหร่ ไม่ใช่รถมาถึงกี่โมง
 * เวลารถถึงเป็นข้อมูลประกอบ จึงอยู่ในกล่องจมด้านข้าง ไม่ใช่กลางการ์ด
 */
export function Timer({ sec, size }: { sec: number; size: number }) {
  return <Countdown sec={sec} size={size} showSec />
}

/** แถบสีด้านซ้ายการ์ด · บอกสถานะได้โดยไม่ต้องอ่านตัวหนังสือ */
export function Strip({ color, radius = 16 }: { color: string; radius?: number }) {
  return (
    <span
      className="absolute inset-y-0 left-0 w-[6px]"
      style={{ background: color, borderTopLeftRadius: radius, borderBottomLeftRadius: radius }}
    />
  )
}

export function Chip({
  label,
  n,
  color,
  sub,
  size = 'md',
}: {
  label: string
  n: number | string
  color: string
  sub?: string
  size?: 'md' | 'lg'
}) {
  const big = size === 'lg'
  const dark = color === '#E8B931'
  return (
    <div
      className="flex min-w-0 flex-1 items-baseline justify-between gap-1 rounded-xl px-3 py-2"
      style={{ background: color, color: dark ? '#1A1405' : '#fff' }}
    >
      {/* ป้ายย่อได้ ตัวเลขย่อไม่ได้ · ของที่ต้องอ่านคือตัวเลข */}
      <span className="min-w-0 truncate text-[12px] font-bold opacity-90">{label}</span>
      <span className="flex shrink-0 items-baseline gap-1">
        <span className="font-extrabold leading-none" style={{ fontSize: big ? 30 : 22 }}>
          {n}
        </span>
        {sub && <span className="text-[11px] font-bold opacity-80">{sub}</span>}
      </span>
    </div>
  )
}

export function PhoneIcon({ size = 18, color = '#EAF0F7' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C11.4 21 3 12.6 3 2.99a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1l-2.22 2.24Z"
        fill={color}
      />
    </svg>
  )
}

export const nf = (n: number | null | undefined): string =>
  n == null ? '—' : n.toLocaleString('th-TH')

/** ร้อยละแบบไม่หารศูนย์ · 0 จาก 0 คือยังไม่มีผล ไม่ใช่ศูนย์เปอร์เซ็นต์ */
export function pct(part: number, total: number): string {
  if (total <= 0) return '—'
  return Math.round((part / total) * 100) + '%'
}

/**
 * ปุ่มเสียงเตือนของกระดานนี้
 *
 * เขียนแยกจากของปล่อยรถเพราะปุ่มนั้นผูกกับชุดเสียงของปล่อยรถไว้ตายตัว
 * กดฟังตัวอย่างแล้วจะได้ยินเสียงผิดกระดาน ซึ่งคือสิ่งที่ตั้งใจเลี่ยงตั้งแต่แรก
 */
export function WaitAlarmChip({
  on,
  onTurnOn,
  onPick,
  compact = false,
}: {
  on: boolean
  onTurnOn: () => void
  /** กดตอนเสียงเปิดอยู่แล้ว · เปิดหน้าต่างเลือกชุดเสียง */
  onPick?: () => void
  compact?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => (on ? onPick?.() : onTurnOn())}
      className="flex h-11 shrink-0 items-center gap-2 rounded-xl px-3 font-bold"
      style={{
        background: on ? '#1B2430' : '#3A2A14',
        color: on ? '#AFC0D4' : '#FFC400',
        fontSize: compact ? 12 : 13,
      }}
    >
      <Bell size={16} color={on ? '#35D98A' : '#FFC400'} ring={!on} />
      {compact ? (on ? 'เสียง' : 'เสียงปิด') : on ? 'เสียงเตือนเปิดอยู่ · กดเลือกเสียง' : 'เสียงเตือนปิดอยู่ · กดเปิด'}
    </button>
  )
}

/** กระดิ่งสั่นอยู่กี่วินาที · เท่ากับช่วงที่เสียงยังดังอยู่พอดี */
export const RING_MS = 8_000

/** จุดกระพริบค้างบนการ์ดกี่วินาทีหลังเตือน · นานพอให้คนที่เพิ่งเงยหน้ายังเห็นทัน */
export const FLASH_MS = 30_000

/**
 * เครื่องหมายบนคันที่เพิ่งเตือน · มีสองระดับ
 *
 *   กำลังเตือนอยู่   กระดิ่งสั่น — คันนี้คือต้นเสียงที่เพิ่งได้ยิน
 *   เตือนไปเมื่อครู่  จุดกระพริบเฉย ๆ ไม่มีกระดิ่ง
 *
 * แยกสองระดับเพราะถ้าทุกคันที่เตือนในสามสิบวินาทีที่ผ่านมาขึ้นกระดิ่งหมด
 * พอได้ยินเสียงแล้วเงยหน้ามา จะเจอกระดิ่งสามสี่ใบ แล้วก็ยังไม่รู้อยู่ดีว่าใบไหนคือต้นเสียง
 * กระดิ่งจึงมีได้เฉพาะช่วงที่เสียงยังดังอยู่ ที่เหลือลดเหลือจุดกระพริบ
 */
export function FlashBell({ size = 22, ringing = true }: { size?: number; ringing?: boolean }) {
  if (!ringing) {
    return (
      <span
        className="inline-block shrink-0 animate-pulse rounded-full"
        style={{
          width: Math.round(size * 0.55),
          height: Math.round(size * 0.55),
          background: '#E5484D',
          boxShadow: '0 0 0 3px rgba(229,72,77,.25)',
        }}
        aria-label="คันนี้เพิ่งมีเสียงเตือนเมื่อครู่"
        title="คันนี้เพิ่งมีเสียงเตือนเมื่อครู่"
      />
    )
  }

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: size + 10,
        height: size + 10,
        background: '#E5484D',
        boxShadow: '0 0 0 4px rgba(229,72,77,.32)',
        animation: 'bplBell 1.1s ease-in-out infinite',
        transformOrigin: 'top center',
      }}
      aria-label="คันนี้กำลังเตือนอยู่"
      title="คันนี้กำลังเตือนอยู่"
    >
      <Bell size={size} color="#fff" ring={false} />
    </span>
  )
}

/**
 * โลโก้หัวจอ · ชุดเดียวกับจอปล่อยรถ
 *
 * เหมือนกันโดยตั้งใจ สองจอนี้แขวนอยู่ในคลังเดียวกันและเป็นระบบเดียวกัน
 * ต่างกันแค่ชื่องาน ซึ่งเป็นสิ่งเดียวที่คนต้องอ่านเพื่อรู้ว่ากำลังดูจอไหน
 */
export function WaitLogo({ title = 'รถรอลงงาน 21BPL', size = 30 }: { title?: string; size?: number }) {
  return (
    <span className="flex items-center gap-3">
      <span
        className="rounded-lg px-3 py-1.5 font-extrabold leading-none"
        style={{ background: '#FFC400', color: '#0B0E11', fontSize: Math.round(size * 0.68) }}
      >
        FLASH
      </span>
      <span className="font-extrabold leading-none" style={{ fontSize: size }}>
        {title}
      </span>
    </span>
  )
}

/**
 * พัสดุสามตัวเลขในแถวเดียว · ทั้งหมด / DO / ไม่ใช่ DO
 *
 * งาน DO กับงานที่ไม่ใช่ DO ไปคนละสายพานและใช้คนไม่เท่ากัน
 * ยอดรวมอย่างเดียวจึงวางกำลังคนไม่ได้ · เจ้าของระบบขอให้สองตัวนี้
 * เด่นเท่ากับประเภทรถและทะเบียน ไม่ใช่ตัวหนังสือเล็ก ๆ ต่อท้าย
 */
/** สีประจำสามตัวเลขพัสดุ · ใช้ชุดเดียวกันทุกจอ จะได้จำสีได้ไม่ต้องอ่านป้าย */
export const PARCEL_TONE = {
  all:   { bg: '#2A2206', line: '#4A3C10', n: '#FFD479', label: '#A8954F' },
  do:    { bg: '#06232E', line: '#10465C', n: '#7BD8FF', label: '#4F8EA8' },
  nondo: { bg: '#1C1033', line: '#3A2470', n: '#C4A2FF', label: '#8E78C0' },
} as const

/**
 * สามตัวเลขพัสดุเรียงติดกัน · ทั้งหมด / DO / ไม่ใช่ DO
 *
 * ต้องอยู่ติดกันและกรอบเหมือนกันทั้งสาม เพราะมันคือสมการเดียวกัน
 *   ทั้งหมด − DO = ไม่ใช่ DO
 * ถ้าตัวหนึ่งเป็นป้ายใหญ่มีกรอบ อีกสองตัวเป็นตัวหนังสือลอย ๆ อยู่คนละมุมการ์ด
 * คนจะไม่เห็นว่ามันเกี่ยวกัน แล้วก็จะไม่เคยเอาสองตัวหลังไปใช้เลย
 *
 * งาน DO คืองานส่งตรง · หักออกจากยอดทั้งหมดแล้วเหลือเท่าไหร่
 * ส่วนต่างนั้นคือของที่ไม่ใช่งานส่งตรง ซึ่งไปคนละสายพานและใช้คนไม่เท่ากัน
 */
export function Parcels({
  all,
  doJob,
  nondo,
  size = 13,
}: {
  all: number | null
  doJob: number | null
  nondo: number | null
  size?: number
}) {
  return (
    <span className="inline-flex items-center" style={{ gap: Math.round(size * 0.26) }}>
      <ParcelTag label="ชิ้น" v={all} tone={PARCEL_TONE.all} size={size} />
      <ParcelTag label="DO" v={doJob} tone={PARCEL_TONE.do} size={size} />
      <ParcelTag label="ไม่ใช่ DO" v={nondo} tone={PARCEL_TONE.nondo} size={size} />
    </span>
  )
}

export function ParcelTag({
  label,
  v,
  tone,
  size,
}: {
  label: string
  v: number | null
  tone: { bg: string; line: string; n: string; label: string }
  size: number
}) {
  return (
    <span
      className="inline-flex items-baseline rounded-lg font-extrabold leading-none"
      style={{
        gap: Math.round(size * 0.22),
        background: tone.bg,
        border: `1px solid ${tone.line}`,
        // กรอบบางที่สุดเท่าที่ยังเห็นว่าเป็นป้าย · รถเยอะแล้วพื้นที่มีค่ากว่าความโปร่ง
        padding: `${Math.round(size * 0.16)}px ${Math.round(size * 0.34)}px`,
      }}
    >
      <span style={{ fontSize: size * 1.08, color: tone.n }}>{nf(v)}</span>
      <span className="font-bold" style={{ fontSize: size * 0.62, color: tone.label }}>
        {label}
      </span>
    </span>
  )
}

/**
 * การ์ดบอกว่าไฟล์ถูกอัปล่าสุดเมื่อไหร่
 *
 * อยู่ในแถวเดียวกับ เกินเวลา เฝ้าระวัง เพราะมันสำคัญเท่ากัน
 * ตัวเลขบนกระดานจะถูกแค่ไหน ขึ้นกับว่าไฟล์ที่อยู่ข้างใต้มันสดแค่ไหน
 * ถ้าอันนี้เป็นตัวหนังสือจาง ๆ อยู่มุมจอ วันหนึ่งจะมีคนรายงานหัวหน้าว่า
 * ไม่มีรถค้าง โดยอ่านจากไฟล์ของเมื่อสามชั่วโมงก่อน ทั้งที่ลานจอดเต็ม
 *
 * หน้างานอัปทุกชั่วโมงอยู่แล้ว เกินหนึ่งชั่วโมงจึงเปลี่ยนเป็นแดง
 */
export function UploadChip({
  at,
  now,
  size = 'tv',
}: {
  at: string | null | undefined
  now: number
  size?: 'tv' | 'board'
}) {
  const big = size === 'tv'
  const d = at ? new Date(at) : null
  const mins = d ? Math.max(0, Math.floor((now - d.getTime()) / 60000)) : -1
  const stale = mins < 0 || mins >= 60

  const ago =
    mins < 0 ? 'ยังไม่เคยอัป'
    : mins < 1 ? 'just now'
    : mins < 60 ? `${mins} min ago`
    : mins < 1440 ? `${Math.floor(mins / 60)} hr ${mins % 60} min ago`
    : `${Math.floor(mins / 1440)} day ago`

  return (
    <div
      className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl"
      style={{
        background: stale ? '#5A1A1D' : '#14323A',
        color: '#fff',
        border: `1px solid ${stale ? '#E5484D' : '#1D6072'}`,
        padding: big ? '8px 16px' : '6px 12px',
      }}
    >
      <span className="min-w-0">
        <span
          className="block font-bold"
          style={{ fontSize: big ? 13 : 11, letterSpacing: 0.6, opacity: 0.85 }}
        >
          LAST UPLOAD
        </span>
        <span className="block font-bold" style={{ fontSize: big ? 13 : 10, opacity: 0.8 }}>
          {d
            ? d.toLocaleString('en-GB', { day: '2-digit', month: 'short' })
            : 'NO FILE YET'}{' '}
          · {ago}
        </span>
      </span>
      <span
        className="shrink-0 font-mono font-extrabold leading-none"
        style={{ fontSize: big ? 30 : 22 }}
      >
        {d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}
      </span>
    </div>
  )
}

/**
 * การ์ดตัวเลขใหญ่ · ใช้บนหน้าสถิติและแดชบอร์ด ไม่ใช่บนกระดาน
 *
 * ทรงตามแบบที่เจ้าของระบบเลือกมา — พื้นสีทึบ หัวข้อเล็กอยู่บน
 * ตัวเลขใหญ่มากอยู่กลาง คำอธิบายเล็กอยู่ล่าง และไอคอนในกรอบจาง ๆ มุมขวา
 *
 * ใหญ่ได้เพราะสองหน้านั้นเป็นหน้าที่นั่งอ่านทีละตัวเลข
 * ส่วนกระดานกับจอทีวีหน้าแรกยังใช้ป้ายเตี้ยเหมือนเดิม
 * เพราะพื้นที่ทุกบรรทัดตรงนั้นต้องเก็บไว้ให้เห็นรถให้ได้มากที่สุด
 */
export function BigStat({
  label,
  value,
  sub,
  icon,
  color,
  dark = true,
}: {
  label: string
  value: string | number
  sub?: string
  icon: string
  /** สีพื้นของการ์ด · ตัวหนังสือเป็นขาวเสมอ จึงต้องเป็นสีเข้มพอ */
  color: string
  /** อยู่บนพื้นดำหรือพื้นสว่าง · มีผลกับเงาเท่านั้น */
  dark?: boolean
}) {
  return (
    <div
      className="flex items-start justify-between gap-3 rounded-2xl px-5 py-4"
      style={{
        background: color,
        color: '#fff',
        boxShadow: dark ? 'none' : '0 6px 18px rgba(16,24,40,.10)',
      }}
    >
      <div className="min-w-0">
        <div className="truncate text-[13px] font-bold" style={{ opacity: 0.88 }}>
          {label}
        </div>
        <div className="mt-2 text-[40px] font-extrabold leading-none">{value}</div>
        {sub && (
          <div className="mt-2 truncate text-[12px] font-bold" style={{ opacity: 0.8 }}>
            {sub}
          </div>
        )}
      </div>
      <span
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[20px]"
        style={{ background: 'rgba(255,255,255,.2)' }}
        aria-hidden
      >
        {icon}
      </span>
    </div>
  )
}
