import type { ReqStatus } from './types'

const TZ = 'Asia/Bangkok'

/** วันที่แบบไทย 22 ก.ย. 69 14:05 */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('th-TH', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  )
}

/** หัวกลุ่มในหน้าประวัติ: วันนี้ / เมื่อวาน / 20 ก.ย. 2569 */
export function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const key = (x: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(x)
  const diffDays = Math.round(
    (Date.parse(key(today)) - Date.parse(key(d))) / 86_400_000,
  )
  if (diffDays === 0) return 'วันนี้'
  if (diffDays === 1) return 'เมื่อวาน'
  return new Intl.DateTimeFormat('th-TH', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' }).format(d)
}

export function relativeAge(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000))
  if (mins < 60) return `${mins} นาที`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} ชม.`
  return `${Math.floor(hrs / 24)} วัน`
}

export const STATUS_TH: Record<ReqStatus, string> = {
  pending: 'รออนุมัติ',
  approved: 'อนุมัติแล้ว',
  partial: 'อนุมัติบางส่วน',
  rejected: 'ปฏิเสธ',
}

export function statusClass(s: ReqStatus): string {
  switch (s) {
    case 'approved':
      return 'badge-ok'
    case 'pending':
      return 'badge-warn'
    case 'rejected':
      return 'badge-dang'
    default:
      return 'badge-mute'
  }
}
