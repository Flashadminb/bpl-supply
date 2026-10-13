import { supabase, readableError } from './supabase'
import { maybeDate, readXlsx } from './xlsx'

/**
 * จับคู่ — เอาเลขพัสดุไปต่อกับรายละเอียดสินค้า
 *
 * ระบบต้นทางออกรายงานมาสองใบที่ต่อกันไม่ได้เอง
 *   ไฟล์รายละเอียด  23 ช่อง หัวตารางไทย แต่ไม่มีชื่อสินค้า
 *   ไฟล์สินค้า      2 ช่อง ไม่มีหัวตาราง เลขพัสดุ + ชื่อสินค้า
 * ทั้งคู่ผูกกันด้วยเลขพัสดุ และเลขในไฟล์สินค้ามีอยู่ในไฟล์รายละเอียดครบทุกเลข
 *
 * คนละเรื่องกับงาน 24 ชั่วโมง
 *   งาน 24  ไฟล์ต้นทางกรองมาให้แล้วว่าเกินกรอบเวลา ตอบว่าต้องไปตามของชิ้นไหน
 *   งาน 48  ไฟล์คือของทั้งคลัง ตอบว่าของชิ้นที่กำลังหาอยู่คืออะไรและอยู่ตรงไหน
 */

/** ฮับเรา · เทียบแบบตัดช่องว่างทิ้ง เพราะในไฟล์เขียน "21 BPL_BHUB-บางพลี" */
export const MY_HUB = '21BPL'

/** กี่แถวต่อการส่งขึ้นฐานข้อมูลหนึ่งครั้ง */
const CHUNK = 2000

/** กี่แถวต่อหน้าของตาราง · มากกว่านี้คนก็เลื่อนไม่ไหวและเน็ตในฮับก็ไม่ไหว */
export const PAGE = 300

/** ตัวอักษรจีนช่วงหลัก · ไว้ชี้ว่าชื่อสินค้าอันไหนต้องเอาไปแปล */
export const CJK = /[一-鿿]/

/* ------------------------------------------------------------- ชนิดข้อมูล */

export interface P48Row {
  tracking: string
  detail: string | null
  cust_type: string | null
  dest_branch: string | null
  weight: string | null
  picked_at: string | null
  last_action: string | null
  bag_no: string | null
}

export interface P48Found {
  total: number
  /** ทั้งรอบมีกี่ชิ้น ก่อนกรอง · ไว้เขียนว่า "เจอ 1,976 จาก 54,834" */
  all: number
  rows: P48Row[]
}

export interface P48Card {
  id: number
  at: string
  file: string | null
  rows: number
  file_rows: number
  by: string
  code: string
}

export interface P48Stats {
  parcel?: P48Card
  product?: P48Card
  matched: number
  can_undo_parcel: boolean
  can_undo_product: boolean
}

export interface P48Facet {
  v: string
  n: number
}

export interface P48Facets {
  dest: P48Facet[]
  action: P48Facet[]
  prov: P48Facet[]
  cust: P48Facet[]
}

export interface P48Filter {
  q?: string
  cust?: string
  dest?: string
  action?: string
  prov?: string
  /** ค้างกี่ชั่วโมงขึ้นไป · 0 คือไม่กรอง */
  age?: number
  bag?: boolean
  nop?: boolean
  cn?: boolean
  limit?: number
  offset?: number
}

export type P48Kind = 'parcel' | 'product'

export interface P48Parsed {
  kind: P48Kind
  fileName: string
  /** แถวทั้งหมดในไฟล์ ก่อนกรองฮับ */
  fileRows: number
  /** แถวที่จะส่งขึ้นจริง */
  rows: Record<string, unknown>[]
  /** ตัดทิ้งเพราะเป็นของฮับอื่น */
  other: number
}

/* ------------------------------------------------------------- แกะไฟล์ */

function findCol(head: string[], ...needles: string[]): number {
  for (const n of needles) {
    const i = head.findIndex((h) => h.replace(/\s+/g, '').includes(n.replace(/\s+/g, '')))
    if (i >= 0) return i
  }
  return -1
}

const clean = (v: unknown): string | null => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim()
  return s === '' || s === '--' || s === '-' ? null : s
}

/** ข้อความเวลาจากไฟล์ เป็น ISO · ผ่านตัวแปลงเลขซีเรียลก่อนเสมอ */
function toIso(v: unknown): string | null {
  const s = maybeDate(String(v ?? '').trim())
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null
  const d = new Date(s.replace(' ', 'T') + '+07:00')
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * ไฟล์นี้เป็นใบไหน · ดูจากเนื้อในล้วน ๆ ไม่ดูชื่อไฟล์
 *
 * เจ้าของระบบขอให้ลากสองไฟล์มาวางพร้อมกันแล้วระบบแยกเอง เพราะชื่อไฟล์ที่
 * ระบบต้นทางตั้งมาเป็นรหัสสุ่ม (d4c48322a93584c0...) ซึ่งบอกอะไรไม่ได้เลย
 *
 * แยกได้ชัดเพราะสองใบนี้ไม่เหมือนกันเลยสักอย่าง
 *   ใบรายละเอียด มีหัวตารางคำว่า "เลขพัสดุ" และมีช่องเกินสิบช่อง
 *   ใบสินค้า     มีสองช่อง ไม่มีหัวตาราง แถวแรกเป็นข้อมูลเลย
 * ถ้าไม่เข้าทั้งสองแบบ จะไม่เดา · บอกไปตรง ๆ ว่าแยกไม่ออก
 */
export function sniffKind(rows: string[][]): P48Kind | null {
  const head = (rows[0] ?? []).map((x) => String(x ?? ''))
  const wide = head.filter(Boolean).length
  if (findCol(head, 'เลขพัสดุ', '运单号') >= 0 && wide >= 8) return 'parcel'

  /* ใบสินค้าไม่มีหัวตาราง จึงต้องดูว่าแถวจริง ๆ หน้าตาเป็นยังไง
     สองช่อง ช่องแรกเป็นเลขพัสดุ ช่องที่สองเป็นข้อความยาว ๆ */
  const sample = rows.slice(0, 40).filter((r) => (r ?? []).filter(Boolean).length > 0)
  if (!sample.length) return null
  const two = sample.every((r) => (r ?? []).filter(Boolean).length <= 2)
  const looksTracking = sample.filter((r) => /^[A-Z0-9-]{9,}$/i.test(String(r[0] ?? '').trim())).length
  if (two && looksTracking >= Math.max(3, Math.floor(sample.length * 0.6))) return 'product'

  return null
}

/** แกะไฟล์ใบรายละเอียด · กรองเหลือเฉพาะของฮับเราตั้งแต่ในเครื่อง */
function parseParcels(rows: string[][], fileName: string): P48Parsed {
  const head = (rows[0] ?? []).map((x) => String(x ?? ''))

  const c = {
    tracking: findCol(head, 'เลขพัสดุ', '运单号'),
    status: findCol(head, 'สถานะพัสดุ'),
    cod: findCol(head, 'COD'),
    weight: findCol(head, 'น้ำหนัก'),
    eta: findCol(head, 'เวลาที่คาดว่าจะออกเดินทาง'),
    arrived: findCol(head, 'เวลาถึงตามจริง'),
    scanOut: findCol(head, 'เวลาสแกนพัสดุออกคลัง'),
    bag: findCol(head, 'เลขแบ็กกิ้ง', 'เลขถุงแบ๊กกิ้ง', '集包号'),
    hold: findCol(head, 'สาเหตุพัสดุคงคลัง'),
    action: findCol(head, 'การดำเนินการล่าสุด'),
    lastAt: findCol(head, 'เวลาที่ดำเนินการล่าสุด'),
    actor: findCol(head, 'หมายเลขโทรศัพท์ผู้ที่ดำเนินการ'),
    mgr: findCol(head, 'หมายเลขโทรศัพท์ผู้จัดการสาขา'),
    next: findCol(head, 'ชื่อสาขาต่อไป'),
    recv: findCol(head, 'สาขาที่รับพัสดุ'),
    picked: findCol(head, 'เวลาเข้ารับสินค้า'),
    hub: findCol(head, 'HUBปลายทาง', '目的地分拨'),
    dest: findCol(head, 'สาขาปลายทาง', '目的地网点'),
    prov: findCol(head, 'จังหวัด-ที่อยู่ผู้รับ', 'จังหวัดผู้รับ'),
    dist: findCol(head, 'อำเภอ/เขต'),
    post: findCol(head, 'รหัสไปรษณีย์'),
    cust: findCol(head, 'ประเภทลูกค้า'),
    customer: findCol(head, 'ลูกค้า'),
  }

  const missing: string[] = []
  if (c.tracking < 0) missing.push('เลขพัสดุ')
  if (c.picked < 0) missing.push('เวลาเข้ารับสินค้า')
  if (missing.length) {
    const seen = head.filter(Boolean).slice(0, 10).join(' / ')
    throw new Error(`ไฟล์รายละเอียดไม่มีคอลัมน์ ${missing.join(' และ ')} · หัวตารางที่เจอคือ ${seen}`)
  }

  const out: Record<string, unknown>[] = []
  const seen = new Set<string>()
  let other = 0

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? []
    const tracking = String(r[c.tracking] ?? '').trim()
    if (!tracking || tracking === '--') continue
    if (seen.has(tracking)) continue
    seen.add(tracking)

    /* ของฮับอื่นตัดทิ้งตั้งแต่ในเครื่อง ไม่ส่งขึ้นฐานข้อมูลเลย
       ไฟล์เต็มมี 78,476 แถว เป็นของเรา 54,834 ที่เหลือเปลืองทั้งที่เก็บและเน็ต */
    if (c.hub >= 0) {
      const hub = String(r[c.hub] ?? '').replace(/\s+/g, '')
      if (!hub.includes(MY_HUB)) {
        other++
        continue
      }
    }

    out.push({
      tracking,
      status: clean(r[c.status]),
      cod: clean(r[c.cod]),
      weight: clean(r[c.weight]),
      eta_out_at: toIso(r[c.eta]),
      arrived_at: toIso(r[c.arrived]),
      scan_out_at: toIso(r[c.scanOut]),
      bag_no: clean(r[c.bag]),
      hold_reason: clean(r[c.hold]),
      last_action: clean(r[c.action]),
      last_at: toIso(r[c.lastAt]),
      actor_phone: clean(r[c.actor]),
      mgr_phone: clean(r[c.mgr]),
      next_branch: clean(r[c.next]),
      recv_branch: clean(r[c.recv]),
      picked_at: toIso(r[c.picked]),
      hub: clean(r[c.hub]),
      dest_branch: clean(r[c.dest]),
      province: clean(r[c.prov]),
      district: clean(r[c.dist]),
      postcode: clean(r[c.post]),
      cust_type: clean(r[c.cust]),
      customer: clean(r[c.customer]),
    })
  }

  /* กรองแล้วไม่เหลือเลย แปลว่าชื่อฮับในไฟล์เปลี่ยน ไม่ใช่ว่าไม่มีของ
     ถ้าปล่อยผ่าน จอจะว่างโดยไม่มีใครรู้ว่าเพราะอะไร */
  if (!out.length && other > 0) {
    throw new Error(
      `ไฟล์นี้มี ${other} แถว แต่ไม่มีแถวไหนที่ HUBปลายทางเป็นฮับเราเลย · ` +
        'ค่าที่อยากได้คือ 21 BPL_BHUB-บางพลี · ชื่อฮับในไฟล์อาจเปลี่ยนไป',
    )
  }
  if (!out.length) throw new Error('ไฟล์รายละเอียดนี้ไม่มีแถวที่มีเลขพัสดุ')

  return { kind: 'parcel', fileName, fileRows: rows.length - 1, rows: out, other }
}

/**
 * แกะไฟล์ใบสินค้า · ไม่มีหัวตาราง แถวแรกเป็นข้อมูลเลย
 *
 * ไฟล์ที่ได้มาจริงหัวตารางเป็นคำว่า "0" กับ "1" ซึ่งคือเลขคอลัมน์ ไม่ใช่ชื่อ
 * แต่ไฟล์รุ่นหน้าอาจไม่มีแถวนั้นเลย จึงดูเป็นรายแถวว่าช่องแรกหน้าตาเป็น
 * เลขพัสดุไหม แถวไหนไม่ใช่ก็ข้าม แทนที่จะตัดแถวแรกทิ้งแบบตายตัว
 */
function parseProducts(rows: string[][], fileName: string): P48Parsed {
  const out: Record<string, unknown>[] = []
  const seen = new Set<string>()

  for (const r of rows) {
    const t = String(r?.[0] ?? '').trim()
    if (!t || !/^[A-Z0-9-]{9,}$/i.test(t)) continue
    if (seen.has(t)) continue
    seen.add(t)
    out.push({ t, d: String(r?.[1] ?? '').replace(/\s+/g, ' ').trim() })
  }

  if (!out.length) throw new Error('ไฟล์สินค้านี้ไม่มีแถวที่ช่องแรกเป็นเลขพัสดุเลย')

  return { kind: 'product', fileName, fileRows: rows.length, rows: out, other: 0 }
}

/** อ่านไฟล์หนึ่งใบแล้วบอกว่าเป็นใบไหนพร้อมแถวที่พร้อมส่ง */
export async function parseP48(file: File): Promise<P48Parsed> {
  const sheet = await readXlsx(file)
  const rows = sheet.rows
  if (rows.length < 2) throw new Error(`${file.name} · ไฟล์นี้ไม่มีข้อมูล`)

  const kind = sniffKind(rows)
  if (!kind) {
    const head = (rows[0] ?? []).filter(Boolean).slice(0, 8).join(' / ')
    throw new Error(
      `${file.name} · แยกไม่ออกว่าเป็นไฟล์รายละเอียดหรือไฟล์สินค้า · ` +
        `หัวตารางที่เจอคือ ${head || '(ว่าง)'}`,
    )
  }

  return kind === 'parcel' ? parseParcels(rows, file.name) : parseProducts(rows, file.name)
}

/* ------------------------------------------------------------- ส่งขึ้น */

/**
 * ส่งรอบหนึ่งขึ้นฐานข้อมูล · เปิดรอบ แบ่งส่งเป็นก้อน แล้วปิดรอบ
 *
 * ของเดิมยังเป็นรอบที่ทุกคนเห็นจนกว่าจะปิดรอบใหม่สำเร็จ
 * เน็ตหลุดกลางทางจึงไม่ทำให้จอว่าง แค่มีรอบค้างที่ไม่มีใครหยิบไปใช้
 * และรอบค้างจะถูกเก็บกวาดเองตอนอัปครั้งถัดไป
 */
export async function importP48(
  p: P48Parsed,
  onProgress?: (done: number, total: number) => void,
): Promise<{ rows: number }> {
  const { data: run, error: e1 } = await supabase.rpc('p48_begin', {
    p_kind: p.kind,
    p_file: p.fileName,
    p_file_rows: p.fileRows,
  })
  if (e1) throw new Error(readableError(e1))

  const fn = p.kind === 'parcel' ? 'p48_put_parcels' : 'p48_put_products'
  for (let i = 0; i < p.rows.length; i += CHUNK) {
    const slice = p.rows.slice(i, i + CHUNK)
    const { error } = await supabase.rpc(fn, { p_run: run, p_rows: slice })
    if (error) throw new Error(readableError(error))
    onProgress?.(Math.min(i + CHUNK, p.rows.length), p.rows.length)
  }

  const { data, error: e2 } = await supabase.rpc('p48_end', { p_run: run })
  if (e2) throw new Error(readableError(e2))
  return data as { rows: number }
}

/* ------------------------------------------------------------- อ่าน */

export async function p48Stats(): Promise<P48Stats> {
  const { data, error } = await supabase.rpc('p48_stats')
  if (error) throw new Error(readableError(error))
  return (data ?? { matched: 0, can_undo_parcel: false, can_undo_product: false }) as P48Stats
}

export async function p48Facets(): Promise<P48Facets> {
  const { data, error } = await supabase.rpc('p48_facets')
  if (error) throw new Error(readableError(error))
  return (data ?? { dest: [], action: [], prov: [], cust: [] }) as P48Facets
}

export async function p48Search(f: P48Filter): Promise<P48Found> {
  const { data, error } = await supabase.rpc('p48_search', { p: f })
  if (error) throw new Error(readableError(error))
  return (data ?? { total: 0, all: 0, rows: [] }) as P48Found
}

export async function p48One(tracking: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.rpc('p48_one', { p_tracking: tracking })
  if (error) throw new Error(readableError(error))
  return (data ?? null) as Record<string, unknown> | null
}

export async function p48Undo(kind: P48Kind) {
  const { error } = await supabase.rpc('p48_undo', { p_kind: kind })
  if (error) throw new Error(readableError(error))
}

/* ------------------------------------------------------------- ตัวช่วยหน้าจอ */

/** ค้างมากี่ชั่วโมง นับจากเวลาเข้ารับสินค้า */
export function heldHours(pickedAt: string | null | undefined, now = Date.now()): number | null {
  if (!pickedAt) return null
  const t = new Date(pickedAt).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((now - t) / 36e5)
}

/** ตัดรหัสในวงเล็บหน้าชื่อสาขาออก · "(TH01120274)2PCU_BDC-ประชาอุทิศ" อ่านยาก */
export function shortName(s: string | null | undefined): string {
  return String(s ?? '').replace(/^\(([^)]*)\)\s*/, '')
}

/**
 * ชื่อช่องภาษาไทยของทุกคอลัมน์ที่เก็บไว้ · ใช้ในแผงขวาและตอนคัดลอกทั้งใบ
 *
 * เรียงตามลำดับที่คนอ่าน ไม่ใช่ลำดับคอลัมน์ในไฟล์
 * ชื่อตรงกับหัวตารางในไฟล์ต้นทาง เพื่อให้คนที่เปิดไฟล์คู่กันเทียบได้ทันที
 */
export const P48_FIELDS: { key: string; label: string; group: string; mono?: boolean }[] = [
  { key: 'hub', label: 'HUBปลายทาง', group: 'ปลายทาง' },
  { key: 'dest_branch', label: 'สาขาปลายทาง', group: 'ปลายทาง' },
  { key: 'province', label: 'จังหวัด-ที่อยู่ผู้รับ', group: 'ปลายทาง' },
  { key: 'district', label: 'อำเภอ/เขต-ที่อยู่ผู้รับ', group: 'ปลายทาง' },
  { key: 'postcode', label: 'รหัสไปรษณีย์', group: 'ปลายทาง', mono: true },
  { key: 'next_branch', label: 'ชื่อสาขาต่อไป', group: 'ปลายทาง' },

  { key: 'weight', label: 'น้ำหนัก', group: 'ของ', mono: true },
  { key: 'cod', label: 'COD', group: 'ของ', mono: true },
  { key: 'bag_no', label: 'เลขแบ็กกิ้ง', group: 'ของ', mono: true },
  { key: 'hold_reason', label: 'สาเหตุพัสดุคงคลัง', group: 'ของ' },

  { key: 'picked_at', label: 'เวลาเข้ารับสินค้า', group: 'เวลา', mono: true },
  { key: 'arrived_at', label: 'เวลาถึงตามจริง', group: 'เวลา', mono: true },
  { key: 'scan_out_at', label: 'เวลาสแกนพัสดุออกคลัง', group: 'เวลา', mono: true },
  { key: 'eta_out_at', label: 'เวลาที่คาดว่าจะออกเดินทาง', group: 'เวลา', mono: true },
  { key: 'last_at', label: 'เวลาที่ดำเนินการล่าสุด', group: 'เวลา', mono: true },

  { key: 'status', label: 'สถานะพัสดุ', group: 'การดำเนินการ' },
  { key: 'last_action', label: 'การดำเนินการล่าสุด', group: 'การดำเนินการ' },
  { key: 'recv_branch', label: 'สาขาที่รับพัสดุ', group: 'การดำเนินการ' },
  { key: 'actor_phone', label: 'เบอร์ผู้ดำเนินการล่าสุด', group: 'การดำเนินการ', mono: true },
  { key: 'mgr_phone', label: 'เบอร์ผู้จัดการสาขา', group: 'การดำเนินการ', mono: true },

  { key: 'cust_type', label: 'ประเภทลูกค้า', group: 'ลูกค้า' },
  { key: 'customer', label: 'ลูกค้า', group: 'ลูกค้า' },
]

export const P48_GROUPS = ['ปลายทาง', 'ของ', 'เวลา', 'การดำเนินการ', 'ลูกค้า']
