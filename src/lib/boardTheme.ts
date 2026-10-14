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

/**
 * ไล่สีพื้นตามอันดับ · อันดับแรกเข้มสุดแล้วจางลงเรื่อย ๆ
 *
 * ไว้ใช้กับรายการที่เรียงจากมากไปน้อยอยู่แล้ว เพื่อให้ตาจับหัวแถวได้ก่อนอ่านตัวเลข
 * ใช้กำลังสองไม่ใช่เส้นตรง เพราะที่คนต้องรีบไปทำคือสามสี่อันดับแรก
 * ถ้าไล่เป็นเส้นตรง อันดับกลาง ๆ จะยังเข้มพอ ๆ กับหัวแถวจนแยกไม่ออกว่าอันไหนด่วนกว่า
 *
 * จางหายทางขวาเสมอ เพื่อไม่ให้พื้นไปทับตัวเลขที่ชิดขวา
 */
export function heat(i: number, n: number, rgb = '79,163,227'): string {
  if (n <= 1) return 'transparent'
  const t = 1 - i / (n - 1)
  const a = 0.015 + t * t * 0.215
  return `linear-gradient(90deg, rgba(${rgb},${a.toFixed(3)}), rgba(${rgb},0) 88%)`
}

/**
 * ไล่สีแดงไปเขียวตามอันดับ ไม่ใช่ตามจำนวน
 *
 * ถ้าไล่ตามจำนวน วันที่อันดับหนึ่งมีพันชิ้นและที่เหลือมีสิบ
 * ทุกอันที่เหลือจะเขียวเหมือนกันหมดจนแยกไม่ออกว่าอันไหนมากกว่ากัน
 * ซึ่งเป็นสิ่งเดียวที่คนมองจออยากรู้
 *
 * ไล่ตามอันดับทำให้บนสุดแดงเสมอและไล่ลงมาเป็นขั้น
 * ไม่ว่าตัวเลขจริงจะห่างกันแค่ไหน · ตรงตามที่เจ้าของระบบสั่งไว้ตอนทำจอโซน
 */
export function heatRank(i: number, n: number): { bg: string; bar: string } {
  const t = n > 1 ? i / (n - 1) : 0
  const hue = Math.round(t * 120)
  return {
    bg: `hsla(${hue}, 80%, 50%, ${(0.3 - t * 0.17).toFixed(3)})`,
    bar: `hsl(${hue}, 85%, ${Math.round(60 - t * 8)}%)`,
  }
}

/** สีของไล่เฉด · ฟ้าสำหรับของค้างทั่วไป แดงสำหรับของที่ต้องรีบ */
export const HEAT_BLUE = '79,163,227'
export const HEAT_RED = '226,75,74'
