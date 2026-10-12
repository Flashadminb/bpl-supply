import { supabase, readableError } from './supabase'
import { readXlsx } from './xlsx'

/**
 * พัสดุค้างเกิน 24 ชม — ของที่นอนอยู่ในฮับเกินกรอบเวลา รายชิ้น
 *
 * คนละเรื่องกับของค้างส่งออก
 *   ของค้างส่งออก      นับเป็นจำนวนต่อสาขา ตอบว่าสาขาไหนค้างเยอะ
 *   พัสดุค้างเกิน 24 ชม รายชิ้นพร้อมเลขพัสดุ ตอบว่าต้องไปตามของชิ้นไหน
 *
 * ไฟล์ต้นทางกรองมาให้แล้วว่าเกิน 24 ชม · ชิ้นที่ค้างน้อยสุดในไฟล์แรกคือ 25.2 ชม
 * ชื่อหน้าจึงมาจากเนื้อหาในไฟล์ ไม่ได้มาจากชื่อไฟล์ซึ่งเป็นรหัสล้วน
 *
 * สิ่งที่เจ้าของระบบสั่งให้เน้นคือ "ยกเลิกการส่งต่อพัสดุ" และต้องเห็นครบทุกเลข
 * ในหน้าเดียวโดยไม่ตัด ส่วนอย่างอื่นเลื่อนลงไปดูได้
 */

export const CANCEL = 'ยกเลิกการส่งต่อพัสดุ'

export interface P24Row {
  tracking: string
  dest: string
  /** โซน D0x · ใช้ตารางเดียวกับของค้างส่งออก ตั้งที่หลังบ้านที่เดิม */
  zone: string | null
  action: string
  last_at: string | null
  in_wh_at: string | null
  actor: string | null
  province: string | null
}

export interface P24Snapshot {
  id: number
  data_at: string
  uploaded_at: string
  file_name: string | null
  row_count: number
  cancel_count: number
  prev_at: string | null
  prev_rows: number | null
  prev_cancel: number | null
}

export interface P24Board {
  snapshot: P24Snapshot | null
  rows: P24Row[]
}

export interface P24Run {
  id: number
  data_at: string
  uploaded_at: string
  file_name: string | null
  row_count: number
  cancel_count: number
}

/* ------------------------------------------------------------- อ่านไฟล์ */

/** เวลาในไฟล์เป็นเวลาไทยแต่ไม่ได้เขียนโซนไว้ · ปักให้ชัด ไม่งั้นเบราว์เซอร์เดาเอง */
function thToIso(s: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s ?? '').trim())
  if (!m) return null
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}+07:00`
}

/**
 * หาคอลัมน์จากชื่อหัวตาราง ไม่ใช่จากตำแหน่ง
 *
 * ไฟล์รุ่นหน้าสลับคอลัมน์เมื่อไหร่ก็ได้ และเคยสลับมาแล้วในไฟล์ของค้างส่งออก
 * จับจากข้อความในหัวจึงทนกว่า · เทียบแบบ "มีคำนี้อยู่ในหัว" ไม่ใช่เท่ากันเป๊ะ
 * เพราะหัวจริงมีช่องว่างท้ายบรรทัดปนมาด้วย
 */
function findCol(head: string[], ...needles: string[]): number {
  for (const n of needles) {
    const i = head.findIndex((h) => h.replace(/\s+/g, '').includes(n.replace(/\s+/g, '')))
    if (i >= 0) return i
  }
  return -1
}

export interface ParsedP24 {
  dataAt: string
  rows: Record<string, unknown>[]
  cancel: number
  /** ชิ้นที่เก่าสุดค้างมากี่ชั่วโมง · ไว้โชว์ตอนยืนยันก่อนบันทึก */
  oldestHours: number
}

export async function parseP24(file: File): Promise<ParsedP24> {
  const sheet = await readXlsx(file)
  const rows = sheet.rows
  if (rows.length < 2) throw new Error('ไฟล์นี้ไม่มีข้อมูล')

  const head = (rows[0] ?? []).map((x) => String(x ?? ''))
  const cTrack = findCol(head, 'เลขพัสดุ')
  const cDest = findCol(head, 'สาขาปลายทาง')
  const cAction = findCol(head, 'การดำเนินการล่าสุด')
  const cLastAt = findCol(head, 'เวลาที่ดำเนินการล่าสุด')
  const cInWh = findCol(head, 'เวลารับพัสดุเข้าคลัง')
  const cActor = findCol(head, 'สาขา/หัวหน้าสาขา', 'ที่ดำเนินการล่าสุด')
  const cProv = findCol(head, 'จังหวัด-ที่อยู่ผู้รับ', 'จังหวัด')

  if (cTrack < 0 || cDest < 0 || cAction < 0) {
    throw new Error('ไฟล์นี้ไม่มีคอลัมน์ เลขพัสดุ สาขาปลายทาง หรือการดำเนินการล่าสุด')
  }

  const out: Record<string, unknown>[] = []
  const seen = new Set<string>()
  let maxAt = ''
  let oldest = Infinity

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? []
    const tracking = String(r[cTrack] ?? '').trim()
    if (!tracking || tracking === '--') continue
    if (seen.has(tracking)) continue
    seen.add(tracking)

    const lastAt = cLastAt >= 0 ? thToIso(String(r[cLastAt] ?? '')) : null
    const inAt = cInWh >= 0 ? thToIso(String(r[cInWh] ?? '')) : null
    const clean = (v: unknown) => {
      const s = String(v ?? '').trim()
      return s === '--' || s === '' ? null : s
    }

    if (lastAt && lastAt > maxAt) maxAt = lastAt
    if (inAt) oldest = Math.min(oldest, new Date(inAt).getTime())

    out.push({
      tracking,
      dest: clean(r[cDest]) ?? '',
      action: clean(r[cAction]) ?? '',
      last_at: lastAt,
      in_wh_at: inAt,
      actor: cActor >= 0 ? clean(r[cActor]) : null,
      province: cProv >= 0 ? clean(r[cProv]) : null,
    })
  }

  if (!out.length) throw new Error('ไฟล์นี้ไม่มีแถวที่มีเลขพัสดุ')
  if (!maxAt) throw new Error('ไฟล์นี้ไม่มีเวลาดำเนินการล่าสุด จึงบอกไม่ได้ว่าเป็นข้อมูลรอบไหน')

  const cancel = out.filter((x) => x.action === CANCEL).length
  const oldestHours = oldest === Infinity ? 0 : Math.round((new Date(maxAt).getTime() - oldest) / 36e5)

  return { dataAt: maxAt, rows: out, cancel, oldestHours }
}

/* ---------------------------------------------------------------- เรียก */

export async function importP24(p: ParsedP24, fileName: string) {
  const { data, error } = await supabase.rpc('parcel24_import', {
    p: { data_at: p.dataAt, file_name: fileName, rows: p.rows },
  })
  if (error) throw new Error(readableError(error))
  return data as { id: number; is_new: boolean; rows: number; cancel: number }
}

export async function p24Board(): Promise<P24Board> {
  const { data, error } = await supabase.rpc('parcel24_board')
  if (error) throw new Error(readableError(error))
  return (data ?? { snapshot: null, rows: [] }) as P24Board
}

export async function undoP24(id: number) {
  const { error } = await supabase.rpc('parcel24_undo', { p_id: id })
  if (error) throw new Error(readableError(error))
}

export async function p24Runs(): Promise<P24Run[]> {
  const { data, error } = await supabase.rpc('parcel24_runs')
  if (error) throw new Error(readableError(error))
  return (data ?? []) as P24Run[]
}

/* ------------------------------------------------------------ จัดข้อมูล */

export interface P24Group {
  dest: string
  zone: string | null
  rows: P24Row[]
}

/** จัดกลุ่มตามสาขา เรียงจากสาขาที่มีเยอะสุด · ใช้ทั้งกับทั้งก้อนและกับเฉพาะที่ยกเลิก */
export function byDest(rows: P24Row[]): P24Group[] {
  const m = new Map<string, P24Group>()
  for (const r of rows) {
    const k = r.dest || '(ไม่ระบุสาขา)'
    const g = m.get(k) ?? { dest: k, zone: r.zone, rows: [] }
    if (!g.zone && r.zone) g.zone = r.zone
    g.rows.push(r)
    m.set(k, g)
  }
  return [...m.values()].sort((a, b) => b.rows.length - a.rows.length || a.dest.localeCompare(b.dest))
}

/** นับว่าการดำเนินการล่าสุดมีกี่แบบ แบบละกี่ชิ้น · ว่างนับเป็นยังไม่มีใครทำ */
export function byAction(rows: P24Row[]): { action: string; n: number }[] {
  const m = new Map<string, number>()
  for (const r of rows) {
    const k = r.action || 'ยังไม่มีการดำเนินการ'
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m.entries()].map(([action, n]) => ({ action, n })).sort((a, b) => b.n - a.n)
}

/** ค้างมากี่ชั่วโมง นับจากเวลารับเข้าคลัง เทียบกับเวลาของไฟล์ ไม่ใช่นาฬิกาเครื่อง */
export function heldHours(r: P24Row, dataAt: string): number | null {
  if (!r.in_wh_at) return null
  return Math.floor((new Date(dataAt).getTime() - new Date(r.in_wh_at).getTime()) / 36e5)
}
