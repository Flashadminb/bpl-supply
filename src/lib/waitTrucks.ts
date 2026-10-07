import { supabase, readableError } from './supabase'
import { readXlsx, maybeDate } from './xlsx'

/**
 * รถรอลงงาน — คนละเรื่องกับตารางปล่อยรถ
 *
 * ปล่อยรถคือรถที่จอดอยู่แล้วต้องออกไป · รถรอลงงานคือรถที่มาถึงแล้วรอให้ลงของ
 * สองงานคนละทีม คนละนาฬิกา คนละเกณฑ์ จึงแยกตารางและแยกสิทธิ์กันคนละชุด
 * ที่ใช้ร่วมกันมีสองอย่างคือรอบตัดวันตอนตีสาม กับชิ้นส่วนหน้าจอใน parts.tsx
 *
 * ของเดิมหน้างานทำด้วยไฟล์ Excel ที่มีสูตรนับถอยหลังกับ VBA
 * ซึ่งต้องกดปุ่มเริ่มนาฬิกาเอง และช่องทัน-ไม่ทันเป็นช่องให้ติ๊กมือ
 * ของใหม่นับเองจากเวลารถถึงในไฟล์ และตัดสินทัน-ไม่ทันจากนาฬิกาตอนกด
 */

export type WaitState =
  | 'waiting'
  | 'warn'
  | 'overdue'
  | 'done_ontime'
  | 'done_late'
  | 'cancelled'

export interface WaitTruckRow {
  id: number
  truck_barcode: string
  arrived_at: string
  from_station: string | null
  plate: string | null
  vehicle_type: string | null
  route_name: string | null
  carrier: string | null
  driver_name: string | null
  driver_phone: string | null
  parcels: number | null
  kpi_minutes: number
  due_at: string
  done_at: string | null
  done_by_name: string | null
  cancelled_at: string | null
  cancelled_by_name: string | null
  cancel_reason: string | null
  imported_at: string
  /** บวก = เหลือเท่านี้ · ลบ = เกินมาแล้วเท่านี้ · ของที่จบแล้วหยุดนับตอนกดเสร็จ */
  left_sec: number
  waited_sec: number
  state: WaitState
}

export interface WaitTruckKpi {
  vehicle_type: string
  wait_minutes: number
  unload_minutes: number
  sort_no: number
  is_active: boolean
}

export const STATE_TH: Record<WaitState, string> = {
  waiting: 'กำลังรอ',
  warn: 'เฝ้าระวัง',
  overdue: 'เกินเวลา',
  done_ontime: 'ลงงานเสร็จ ทันเวลา',
  done_late: 'ลงงานเสร็จ ไม่ทัน',
  cancelled: 'ยกเลิก',
}

/** เหตุผลที่ยกเลิกบ่อย ๆ · กดแล้วไม่ต้องพิมพ์ แต่พิมพ์เองได้ */
export const WAIT_CANCEL_REASONS = ['รถไม่ได้เข้าฮับนี้', 'ไฟล์ซ้ำ', 'ยกเลิกเที่ยววิ่ง']

/* ------------------------------------------------------------ แกะประเภทรถ */

/**
 * ประเภทรถจริงซ่อนอยู่ในชื่อเส้นทาง ไม่ได้อยู่ในคอลัมน์ประเภทรถ
 *
 * คอลัมน์ประเภทรถในไฟล์มีแค่ 6W กับ others ซึ่งแยก 6W5 จาก 6W7 ไม่ออก
 * และ others คือ 14W · ใช้ตัดสินเกณฑ์เวลาไม่ได้เลย
 *
 * ของจริงอยู่ในท่อนที่สองของชื่อเส้นทาง เช่น LH-6W7.2-NE6-BPLL
 * ไฟล์ Excel ของหน้างานก็แกะด้วยวิธีเดียวกันในคอลัมน์ R ที่ซ่อนไว้
 * ตัดที่ตัว W หรือ WJ แล้วเอาอีกหนึ่งตัวถัดไป · 6W7.2 เป็น 6W7 · 4WJ2 เป็น 4WJ
 *
 * ทำตามสูตรเดิมของเขาเป๊ะ ๆ เพราะวันแรกที่เปิดใช้ เขาจะเอาสองจอมาวางเทียบกัน
 * ถ้าเราแกะเก่งกว่าเดิม ตัวที่ต่างจะดูเหมือนของใหม่ผิด ไม่ใช่ของเก่าผิด
 */
export function typeFromRoute(route: string | null | undefined): string | null {
  const seg = (route ?? '').split('-')[1]
  if (!seg) return null

  const s = seg.toUpperCase()
  const wj = s.indexOf('WJ')
  const at = wj >= 0 ? wj : s.indexOf('W')
  if (at < 0) return null

  const out = s.slice(0, at + 2)
  // ต้องขึ้นต้นด้วยตัวเลขเสมอ · ท่อนอย่าง WNOO ไม่ใช่ประเภทรถ
  return /^\d{1,2}W/.test(out) ? out : null
}

/* -------------------------------------------------------------- อ่านไฟล์ */

export interface ParsedTruck {
  /** เลขบรรทัดในไฟล์ · ไว้ชี้ให้คนดูว่าแถวไหน */
  line: number
  barcode: string
  /** เวลาไทยพร้อมโซนเวลา · ส่งแบบนี้เสมอ ฝั่งฐานข้อมูลจะได้ไม่ต้องเดา */
  arrived_at: string
  /** ข้อความเวลาตามที่อยู่ในไฟล์ · ไว้โชว์ให้คนเทียบ */
  arrived_text: string
  from_station: string | null
  plate: string | null
  vehicle_type: string | null
  route_name: string | null
  carrier: string | null
  driver_name: string | null
  driver_phone: string | null
  parcels: number | null
}

export interface ParsedFile {
  sheet: string
  rows: ParsedTruck[]
  bad: { line: number; why: string; text: string }[]
}

/**
 * หาคอลัมน์จากชื่อหัวตาราง ไม่ใช่จากตำแหน่ง
 *
 * ถ้าจำว่าบาร์โค้ดอยู่คอลัมน์ที่ห้า แล้ววันหนึ่งบริษัทแทรกคอลัมน์ใหม่เข้ามาหนึ่งช่อง
 * ทุกแถวจะเข้าไปผิดช่องทั้งไฟล์ โดยที่หน้าจอยังขึ้นเขียวว่าอ่านได้ครบ
 *
 * จับจากตัวจีนเป็นหลักเพราะมันคือรหัสของระบบต้นทาง เปลี่ยนยากที่สุด
 * มีคำไทยสำรองไว้ด้วยเผื่อวันหนึ่งเขาตัดตัวจีนออกจากหัวตาราง
 */
const FIELDS = {
  arrived: ['实际到达时间', 'เวลารถถึงจริง'],
  station: ['上一站网点名称', 'สถานีก่อนหน้า'],
  barcode: ['出车凭证', 'บาร์โค้ดรถ'],
  carrier: ['车辆公司名称', 'supplier'],
  plate: ['车牌号', 'เลขทะเบียน'],
  phone: ['司机电话', 'เบอร์โทรพนักงานขับรถ'],
  driver: ['司机姓名', 'ชื่อพนักงานขับรถ'],
  route: ['车线名称', 'ชื่อเส้นทาง'],
  parcels: ['待卸车包裹量', 'ที่ต้องขนถ่าย'],
  hub: ['hub名称', 'ชื่อhub'],
} as const

type FieldKey = keyof typeof FIELDS

function findHeader(rows: string[][]): { at: number; col: Partial<Record<FieldKey, number>> } | null {
  // หัวตารางไม่ได้อยู่บรรทัดแรกเสมอ บางไฟล์มีบรรทัดชื่อรายงานคั่นอยู่ข้างบน
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const cells = rows[r].map((c) => c.toLowerCase().replace(/\s+/g, ''))
    const col: Partial<Record<FieldKey, number>> = {}

    for (const key of Object.keys(FIELDS) as FieldKey[]) {
      const want = FIELDS[key].map((w) => w.toLowerCase().replace(/\s+/g, ''))
      const i = cells.findIndex((c) => c !== '' && want.some((w) => c.includes(w)))
      if (i >= 0) col[key] = i
    }

    // ต้องเจอสองช่องที่ขาดไม่ได้จริง ๆ ถึงจะนับว่าเป็นหัวตาราง
    if (col.arrived !== undefined && col.barcode !== undefined) return { at: r, col }
  }
  return null
}

const p2 = (v: string | number) => String(v).padStart(2, '0')

/**
 * เวลาไทยในไฟล์ เป็นข้อความที่มีโซนเวลาติดไปด้วย
 *
 * ไฟล์เขียนเวลาไว้เปล่า ๆ ซึ่งเป็นเวลาไทย แต่ถ้าส่งเปล่า ๆ ต่อไปฝั่งฐานข้อมูล
 * มันจะอ่านเป็นเวลา UTC แล้วนาฬิกาทั้งกระดานเพี้ยนไปเจ็ดชั่วโมงพร้อมกัน
 * ซึ่งมองไม่ออกจากหน้าจอเลย เพราะทุกคันเพี้ยนเท่ากันหมด
 */
function toThaiIso(text: string): string | null {
  const s = maybeDate(text.trim()).replace(/\//g, '-').trim()

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s)
  if (m) {
    const [, y, mo, d, h, mi, se] = m
    return `${y}-${p2(mo)}-${p2(d)}T${p2(h)}:${mi}:${se ?? '00'}+07:00`
  }

  // วัน/เดือน/ปี แบบที่ Excel ภาษาไทยชอบเขียน
  m = /^(\d{1,2})-(\d{1,2})-(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s)
  if (m) {
    const [, d, mo, y, h, mi, se] = m
    return `${y}-${p2(mo)}-${p2(d)}T${p2(h)}:${mi}:${se ?? '00'}+07:00`
  }

  return null
}

const cell = (row: string[], i: number | undefined): string =>
  i === undefined ? '' : (row[i] ?? '').replace(/ /g, ' ').trim()

const orNull = (v: string): string | null => (v === '' ? null : v)

/**
 * อ่านไฟล์รายงานรายชั่วโมงของบริษัท
 *
 * แถวที่อ่านไม่ออกไม่ถูกทิ้งเงียบ · เก็บไว้โชว์พร้อมเหตุผล
 * เพราะไฟล์ที่อ่านได้ 95 จาก 100 แถวแล้วไม่บอกว่าอีกห้าแถวหายไปไหน
 * คือไฟล์ที่วันหนึ่งจะมีรถหายไปจากกระดานโดยไม่มีใครรู้
 */
export async function parseWaitTruckFile(file: File): Promise<ParsedFile> {
  const sheet = await readXlsx(file)
  const head = findHeader(sheet.rows)
  if (!head) {
    throw new Error('หาหัวตารางในไฟล์ไม่เจอ · ไฟล์นี้ใช่รายงานรถรอลงงานหรือเปล่า')
  }

  const { at, col } = head
  const rows: ParsedTruck[] = []
  const bad: ParsedFile['bad'] = []

  for (let r = at + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r]
    const line = r + 1
    const barcode = cell(row, col.barcode)
    const arrivedText = cell(row, col.arrived)

    // แถวว่างท้ายไฟล์ ข้ามเงียบ ๆ ไม่ใช่ความผิดพลาด
    if (barcode === '' && arrivedText === '') continue

    const summary = row.filter((c) => c !== '').join(' ').slice(0, 80)

    if (barcode === '') {
      bad.push({ line, why: 'ไม่มีบาร์โค้ดรถ', text: summary })
      continue
    }

    const hub = cell(row, col.hub)
    if (hub !== '' && !hub.toUpperCase().includes('BPL')) {
      bad.push({ line, why: 'เป็นรถของฮับ ' + hub, text: summary })
      continue
    }

    const iso = toThaiIso(arrivedText)
    if (!iso) {
      bad.push({ line, why: 'อ่านเวลารถถึงไม่ได้ · ' + (arrivedText || 'ช่องว่าง'), text: summary })
      continue
    }

    const parcels = Number(cell(row, col.parcels).replace(/[^0-9.]/g, ''))
    const route = orNull(cell(row, col.route))

    rows.push({
      line,
      barcode,
      arrived_at: iso,
      arrived_text: arrivedText,
      from_station: orNull(cell(row, col.station)),
      plate: orNull(cell(row, col.plate)),
      vehicle_type: typeFromRoute(route),
      route_name: route,
      carrier: orNull(cell(row, col.carrier)),
      driver_name: orNull(cell(row, col.driver)),
      driver_phone: orNull(cell(row, col.phone)),
      parcels: Number.isFinite(parcels) && parcels > 0 ? Math.round(parcels) : null,
    })
  }

  return { sheet: sheet.name, rows, bad }
}

/* ------------------------------------------------------------------- api */

export async function listWaitTruckKpi(): Promise<WaitTruckKpi[]> {
  const { data, error } = await supabase
    .from('wait_truck_kpi')
    .select('*')
    .order('sort_no')
  if (error) throw new Error(readableError(error))
  return (data ?? []) as WaitTruckKpi[]
}

/** แก้เกณฑ์เวลา · เจ้าของระบบเท่านั้น ซึ่งบังคับที่ RLS ไม่ใช่ที่ปุ่ม */
export async function saveWaitTruckKpi(k: WaitTruckKpi): Promise<void> {
  const { error } = await supabase.from('wait_truck_kpi').upsert({
    vehicle_type: k.vehicle_type.trim().toUpperCase(),
    wait_minutes: k.wait_minutes,
    unload_minutes: k.unload_minutes,
    sort_no: k.sort_no,
    is_active: k.is_active,
  })
  if (error) throw new Error(readableError(error))
}

/** คันที่ยังไม่จบ · เรียงจากคันที่ต้องรีบที่สุด */
export async function listWaitBoard(): Promise<WaitTruckRow[]> {
  const { data, error } = await supabase
    .from('wait_truck_rows')
    .select('*')
    .is('done_at', null)
    .is('cancelled_at', null)
    .order('due_at', { ascending: true })
    .limit(500)
  if (error) throw new Error(readableError(error))
  return (data ?? []) as WaitTruckRow[]
}

/** คันที่จบแล้วในรอบนี้ · ไว้ให้กดย้อนกลับถ้ากดเสร็จผิดคัน */
export async function listWaitDone(sinceIso: string): Promise<WaitTruckRow[]> {
  const { data, error } = await supabase
    .from('wait_truck_rows')
    .select('*')
    .gte('done_at', sinceIso)
    .order('done_at', { ascending: false })
    .limit(300)
  if (error) throw new Error(readableError(error))
  return (data ?? []) as WaitTruckRow[]
}

export interface ImportResult {
  ok: boolean
  batch: string
  added: number
  skipped: number
  rejected_n: number
  rejected: { barcode: string; why: string }[]
}

/**
 * ส่งแถวที่อ่านได้เข้าฐานข้อมูล
 *
 * คันที่ยังรออยู่บนกระดานจะถูกข้าม ไม่ใช่เขียนทับ
 * เพราะหน้างานอัปไฟล์เดิมซ้ำทุกชั่วโมง ถ้าเขียนทับคือรีเซ็ตนาฬิกาทุกชั่วโมง
 * แล้วจะไม่มีคันไหนเกินเวลาเลยสักคันตลอดกาล
 */
export async function importWaitTrucks(rows: ParsedTruck[]): Promise<ImportResult> {
  const payload = rows.map((r) => ({
    barcode: r.barcode,
    arrived_at: r.arrived_at,
    from_station: r.from_station,
    plate: r.plate,
    vehicle_type: r.vehicle_type,
    route_name: r.route_name,
    carrier: r.carrier,
    driver_name: r.driver_name,
    driver_phone: r.driver_phone,
    parcels: r.parcels,
  }))

  const { data, error } = await supabase.rpc('wait_truck_import', { p_rows: payload })
  if (error) throw new Error(readableError(error))
  return data as ImportResult
}

/** ถอนไฟล์ที่เพิ่งอัป · ได้เฉพาะคันที่ยังไม่มีใครแตะ */
export async function undoWaitImport(batch: string): Promise<number> {
  const { data, error } = await supabase.rpc('wait_truck_undo_import', { p_batch: batch })
  if (error) throw new Error(readableError(error))
  return (data as { removed: number }).removed
}

export async function doneWaitTruck(id: number): Promise<{ on_time: boolean; late_min: number }> {
  const { data, error } = await supabase.rpc('wait_truck_done', { p_id: id })
  if (error) throw new Error(readableError(error))
  return data as { on_time: boolean; late_min: number }
}

export async function undoneWaitTruck(id: number): Promise<void> {
  const { error } = await supabase.rpc('wait_truck_undone', { p_id: id })
  if (error) throw new Error(readableError(error))
}

export async function cancelWaitTruck(id: number, reason: string): Promise<void> {
  const { error } = await supabase.rpc('wait_truck_cancel', { p_id: id, p_reason: reason })
  if (error) throw new Error(readableError(error))
}

export interface WaitCounts {
  waiting: number
  overdue: number
  warn: number
  parcels: number
  carried: number
  done: number
  on_time: number
  cycle_start: string
}

export async function waitTruckCounts(): Promise<WaitCounts | null> {
  const { data, error } = await supabase.rpc('wait_truck_counts')
  if (error) throw new Error(readableError(error))
  return (data ?? null) as WaitCounts | null
}

export interface WaitStats {
  from: string
  to: string
  total: number
  on_time: number
  cancelled: number
  parcels: number
  avg_wait: number
  worst: number
  by_day: { day: string; total: number; on_time: number; avg_wait: number }[]
  by_type: {
    vehicle_type: string
    total: number
    on_time: number
    avg_wait: number
    worst: number
  }[]
  by_station: { from_station: string; total: number; on_time: number; avg_wait: number }[]
}

/** ช่วงวันเป็นวันไทยแบบ YYYY-MM-DD รวมปลายทั้งสองข้าง · ตรงกับปฏิทินเลือกช่วงที่หน้าอื่นใช้ */
export async function waitTruckStats(from: string, to: string): Promise<WaitStats | null> {
  const { data, error } = await supabase.rpc('wait_truck_stats', { p_from: from, p_to: to })
  if (error) throw new Error(readableError(error))
  return (data ?? null) as WaitStats | null
}
