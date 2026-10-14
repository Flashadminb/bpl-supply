/**
 * ชุดสีและตัวช่วยของจอกลางคลัง
 *
 * ใช้ร่วมกันห้าจอ · ของค้างส่งออก · พัสดุค้างเกิน 24 ชม · ปล่อยรถ · รถรอลงงาน · จับคู่
 * เจ้าของระบบสั่งว่าทุกจอต้อง "เป็นฟิลเดียวกัน" จึงรวมไว้ที่เดียว
 * ไม่ก็อปไปวางทีละหน้า เพราะวันที่ใครปรับสีจอหนึ่ง อีกสี่จอจะเพี้ยนตามไม่ได้
 * แล้วจอที่แขวนอยู่ข้างกันในคลังจะดูเป็นคนละระบบ
 *
 * ─────────────────────────────────────────────────────────────────
 * ทำไมค่าสีเป็น var() ไม่ใช่รหัสสีตรง ๆ
 *
 * เจ้าของระบบขอให้สลับพื้นขาวได้ ซึ่งไม่ใช่แค่กลับพื้นกับตัวอักษร
 * สีที่อ่านออกบนพื้นดำหลายสีอ่านไม่ออกเลยบนพื้นขาว
 * เหลือง #FFC400 บนขาวแทบมองไม่เห็น เขียวอ่อนกับแดงอ่อนก็เช่นกัน
 * ทั้งสองธีมจึงต้องมีค่าของตัวเองทุกสี ไม่ใช่ค่าเดียวแล้วปรับความสว่าง
 *
 * ใช้ตัวแปร CSS เพราะโค้ดหน้าจอที่เขียนไว้แล้วทั้งห้าหน้าไม่ต้องแก้เลยสักบรรทัด
 * มันอ่าน C.panel เหมือนเดิม แค่ค่าข้างในกลายเป็นตัวแปรที่เบราว์เซอร์สลับให้เอง
 * ค่าจริงของทั้งสองธีมอยู่ใน index.css
 * ─────────────────────────────────────────────────────────────────
 */

export const C = {
  bg: 'var(--b-bg)',
  panel: 'var(--b-panel)',
  panel2: 'var(--b-panel2)',
  groove: 'var(--b-groove)',
  line: 'var(--b-line)',
  line2: 'var(--b-line2)',
  ink: 'var(--b-ink)',
  mute: 'var(--b-mute)',
  faint: 'var(--b-faint)',
  chip: 'var(--b-chip)',
  brand: 'var(--b-brand)',
  red: 'var(--b-red)',
  redBg: 'var(--b-red-bg)',
  redInk: 'var(--b-red-ink)',
  amber: 'var(--b-amber)',
  amberBg: 'var(--b-amber-bg)',
  amberInk: 'var(--b-amber-ink)',
  greenBg: 'var(--b-green-bg)',
  greenInk: 'var(--b-green-ink)',
  green: 'var(--b-green)',
  /* สายหลัก ฟ้า · สายรอง เหลือง · สามเฉดต่อสาย ไว้ไล่สีให้แท่งนูน
     บนพื้นขาวเฉด Hi กับ Lo สลับทิศกัน เพราะ "เด่น" บนพื้นดำคือสว่าง
     แต่บนพื้นขาวคือเข้ม · ค่าจริงจัดการให้แล้วใน index.css */
  lh: 'var(--b-lh)',
  lhHi: 'var(--b-lh-hi)',
  lhLo: 'var(--b-lh-lo)',
  fd: 'var(--b-fd)',
  fdHi: 'var(--b-fd-hi)',
  fdLo: 'var(--b-fd-lo)',
  /** พื้นของชิปเลขพัสดุ · เข้มกว่าการ์ดหนึ่งขั้นเสมอไม่ว่าธีมไหน */
  slot: 'var(--b-slot)',
}

/**
 * การ์ดมาตรฐาน · ลอยขึ้นจากพื้นเล็กน้อย
 *
 * พื้นดำใช้ไล่สีกับเงาเข้มเพื่อให้การ์ดดูนูน
 * พื้นขาวใช้เงาบางกับเส้นขอบคมแทน เพราะเงาเข้มบนขาวดูเลอะไม่ได้ดูนูน
 * ต่างกันพอให้ทั้งสองธีมดูตั้งใจ ไม่ใช่ธีมเดียวที่ถูกกลับสี
 */
export const CARD: React.CSSProperties = {
  borderRadius: 16,
  border: `1px solid ${C.line2}`,
  background: 'var(--b-card)',
  boxShadow: 'var(--b-card-shadow)',
}

export const field: React.CSSProperties = {
  background: C.panel2,
  border: `1px solid ${C.line}`,
  color: C.ink,
}

/* แท็บที่เลือกอยู่ใช้เหลืองเข้มพอให้ตัวอักษรดำอ่านออกทั้งสองธีม
   จึงไม่ได้ใช้ C.brand ที่สลับค่าตามธีม เพราะบนพื้นขาวมันเข้มจนตัวดำจม */
export const tabOn: React.CSSProperties = { background: 'var(--b-tab-on)', color: '#111', fontWeight: 800 }
export const tabOff: React.CSSProperties = {
  background: 'var(--b-tab-off)',
  color: C.mute,
  border: `1px solid ${C.line2}`,
}

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


/* ------------------------------------------------------------- ธีมจอ */

/**
 * จอกลางคลังสลับพื้นขาว-ดำได้
 *
 * เก็บไว้ในเครื่องของแต่ละคน ไม่ได้เก็บในฐานข้อมูล
 * เพราะจอที่แขวนในคลังกับมือถือที่เดินถือไปด้วยต้องการคนละแบบ
 * จอแขวนในที่ไฟสลัวใช้พื้นดำสบายตากว่าและกินไฟน้อยกว่า
 * ส่วนคนที่เปิดกลางแดดหรือจะแคปส่งไลน์ต้องการพื้นขาว
 *
 * ตั้งไว้ที่ documentElement เพื่อให้ทุกจอที่เปิดในเครื่องเดียวกันเป็นธีมเดียวกัน
 * และไม่ต้องส่งค่าธีมลงไปทุกชั้นของหน้าจอ
 */
export type BoardTheme = 'dark' | 'light'

const THEME_KEY = 'bpl.board.theme'

export function boardTheme(): BoardTheme {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    /* โหมดส่วนตัวอ่านไม่ได้ · ตกมาใช้พื้นดำซึ่งเป็นของเดิม */
    return 'dark'
  }
}

export function setBoardTheme(t: BoardTheme): void {
  try {
    if (t === 'dark') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, t)
  } catch {
    /* เก็บไม่ได้ก็ยังสลับได้ แค่จำไม่ได้ข้ามการรีเฟรช */
  }
  applyBoardTheme(t)
}

export function applyBoardTheme(t: BoardTheme): void {
  if (typeof document === 'undefined') return
  if (t === 'light') document.documentElement.setAttribute('data-board', 'light')
  else document.documentElement.removeAttribute('data-board')
}
