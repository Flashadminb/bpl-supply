import type { ReactNode } from 'react'
import { Countdown, p2 } from '../trucks/parts'
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
      className="flex min-w-0 flex-1 items-baseline justify-between gap-2 rounded-xl px-3 py-2"
      style={{ background: color, color: dark ? '#1A1405' : '#fff' }}
    >
      <span className="truncate text-[12px] font-bold opacity-90">{label}</span>
      <span className="flex items-baseline gap-1">
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
