/**
 * ชุดสีและตัวช่วยของจอกลางคลัง
 *
 * ใช้ร่วมกันระหว่างของค้างส่งออกกับพัสดุค้างเกิน 24 ชม เพราะเจ้าของระบบสั่งว่า
 * หน้าใหม่ต้อง "เป็นฟิลเดียวกับของค้างส่งออก"
 *
 * ที่แยกออกมาเป็นไฟล์กลาง ไม่ใช่ก็อปไปวางอีกหน้า เพราะวันที่ใครปรับสีจอหนึ่ง
 * อีกจอจะเพี้ยนตามไม่ได้ แล้วสองจอที่แขวนอยู่ข้างกันในคลังจะดูเป็นคนละระบบ
 *
 * จอพวกนี้ไม่ได้ใช้ token จาก design-tokens.css เพราะนั่นเป็นชุดสีของแอพฝั่ง
 * พนักงานซึ่งเป็นพื้นครีมสว่างสำหรับมือถือกลางแดด ส่วนจอนี้แขวนในคลังที่ไฟสลัว
 * และเปิดค้างทั้งกะ พื้นสว่างจะแสบตาและกินไฟจอมากกว่า
 */

export const C = {
  bg: '#0B0E11',
  panel: '#121820',
  panel2: '#151C26',
  groove: '#0A0E13',
  line: '#243040',
  line2: '#1E2733',
  ink: '#F0F4F9',
  mute: '#AFC0D4',
  faint: '#5A646F',
  chip: '#1B2430',
  brand: '#FFC400',
  red: '#FF5C5C',
  redBg: '#351317',
  redInk: '#FF9A9A',
  amber: '#FFB038',
  amberBg: '#352714',
  amberInk: '#FFC77A',
  greenBg: '#11301F',
  greenInk: '#8FE8BC',
  green: '#35D98A',
  /* สายหลัก ฟ้า · สายรอง เหลือง · สามเฉดต่อสาย ไว้ไล่สีให้แท่งนูน */
  lh: '#4FA3E3',
  lhHi: '#9BD4FF',
  lhLo: '#1E5C92',
  fd: '#F0B21E',
  fdHi: '#FFE089',
  fdLo: '#9A6E06',
}

/** การ์ดมาตรฐาน · ไล่สีอ่อน ๆ กับเงาใต้การ์ด ให้ลอยขึ้นจากพื้น */
export const CARD: React.CSSProperties = {
  borderRadius: 16,
  border: `1px solid ${C.line2}`,
  background:
    'radial-gradient(120% 90% at 50% -20%, rgba(255,255,255,.045), transparent 60%), linear-gradient(180deg, #161D27, #10151C)',
  boxShadow: '0 18px 40px -22px #000, inset 0 1px 0 rgba(255,255,255,.05)',
}

export const field: React.CSSProperties = {
  background: C.panel2,
  border: `1px solid ${C.line}`,
  color: C.ink,
}

export const tabOn: React.CSSProperties = { background: C.brand, color: '#111', fontWeight: 800 }
export const tabOff: React.CSSProperties = { background: '#161E28', color: C.mute, border: `1px solid ${C.line2}` }

export const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
export const p2 = (n: number) => String(n).padStart(2, '0')
export const nf = (n: number) => n.toLocaleString('th-TH')

export function thFull(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getDate()} ${TH_MON[d.getMonth()]} ${String((d.getFullYear() + 543) % 100)} ${p2(d.getHours())}:${p2(d.getMinutes())}`
}
