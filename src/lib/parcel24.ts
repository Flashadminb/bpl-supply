import { supabase, readableError } from './supabase'
import { maybeDate, readXlsx } from './xlsx'

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

/**
 * รหัสอังกฤษของระบบต้นทาง เป็นคำไทยที่หน้างานอ่านอยู่แล้ว
 *
 * ไฟล์ที่โหลดมาจากระบบมีสองแบบ แล้วแต่ภาษาที่เลือกตอนกดออกรายงาน
 *   แบบไทย      หัวตารางไทย ค่าก็ไทย — "ยกเลิกการส่งต่อพัสดุ"
 *   แบบจีน-ไทย  หัวตารางจีนต่อไทย แต่ค่ากลับเป็นรหัสดิบ — CANCEL_SHIPMENT_WAREHOUSE
 * ของที่ไม่ได้แปลคือค่าในคอลัมน์การดำเนินการ ซึ่งบังเอิญเป็นคอลัมน์ที่หน้านี้ทั้งหน้าอิงอยู่
 *
 * คำไทยในตารางนี้ไม่ได้แปลเอง · ดึงจากของจริงที่เคยนำเข้าไปแล้วในฐานข้อมูล
 * เทียบกับไฟล์ใหม่ทีละรหัสจากสัดส่วนที่ตรงกัน จึงเป็นคำเดียวกับที่หน้างานเห็นมาตลอด
 * ถ้าแปลเอง หน้าจอจะมีสองคำเรียกของอย่างเดียวกัน แล้วสถิติเทียบรอบก่อนจะพัง
 *
 * รหัสที่ไม่มีในตารางปล่อยผ่านเป็นรหัสดิบ ไม่เดาคำแปล
 * ตัวพิมพ์ใหญ่ทั้งคำบนจอคือสัญญาณให้คนบอกเรามาว่าอันนี้ภาษาไทยว่าอะไร
 * ดีกว่าขึ้นคำไทยที่ผิดแล้วไม่มีใครรู้ว่าผิด
 */
export const P24_ACTION_TH: Record<string, string> = {
  LOSE_PARCEL_TEAM_OPERATION: 'ทีมจัดการพัสดุสูญหายดำเนินการ',
  SEAL: 'แบ๊กกิ้ง',
  ARRIVAL_WAREHOUSE_SCAN: 'สแกนพัสดุเข้าคลัง',
  RECEIVE_WAREHOUSE_SCAN: 'รับเข้าพัสดุ',
  MANUAL_REMARK: 'Package note',
  CANCEL_SHIPMENT_WAREHOUSE: CANCEL,
  SHIPMENT_WAREHOUSE_SCAN: 'สแกนพัสดุออกคลัง',
  REPLY_WORK_ORDER: 'ตอบกลับ Ticket',
  PRINTING: 'ปริ้นท์ใบลาเบล',
  CONTINUE_TRANSPORT: 'Problem shipment Re-delivery',
  PENDING_RETURN: 'พัสดุรอตีกลับ',
  CHANGE_PARCEL_CLOSE: 'ปิดงาน',
  CREATE_WORK_ORDER: 'สร้าง Ticket',
  REPLACE_PNO: 'เปลี่ยนเลเบล',
}

/** รหัสดิบเป็นคำไทย · ไม่รู้จักก็คืนของเดิมไป ไม่เดา */
export function actionTH(v: string): string {
  const s = v.trim()
  return P24_ACTION_TH[s] ?? s
}

/**
 * ประเภทลูกค้า · ส่วนใหญ่เป็นชื่อแพลตฟอร์มอยู่แล้ว ปล่อยไว้ตามเดิม
 *
 * มีสามค่าที่มาเป็นภาษาจีน แปลเฉพาะสามตัวนั้น
 * สองตัวเป็นชื่อแบรนด์ซึ่งถอดเสียงตรงตัวได้ ไม่ได้ตีความอะไรเพิ่ม
 * ส่วน 小C คือลูกค้ารายย่อยที่ส่งเองหน้าร้าน ไม่ใช่ร้านบนแพลตฟอร์ม
 */
export function custTypeTH(v: string | null | undefined): string {
  const s = String(v ?? '').trim()
  if (!s) return ''
  if (s.includes('小C')) return 'รายย่อย'
  if (s.includes('天猫')) return 'Tmall · เถาเป่า'
  if (s.includes('菜鸟')) return 'Cainiao App'
  return s
}

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
  /** ประเภทลูกค้า เช่น shopee tiktok KA · เก็บไว้ดูเฉย ๆ ไม่ได้ใช้ตัดสินใจอะไร */
  cust_type: string | null
}

export interface P24Snapshot {
  id: number
  /** กี่สาขาที่ถูกปิดการโชว์ไว้ที่หน้าหลังบ้าน · ของพวกนี้ไม่ถูกนับในยอดบนจอ */
  hidden_count?: number
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

/**
 * เวลาในไฟล์เป็นเวลาไทยแต่ไม่ได้เขียนโซนไว้ · ปักให้ชัด ไม่งั้นเบราว์เซอร์เดาเอง
 *
 * ไฟล์บางแบบส่งเวลามาเป็นเลขซีเรียลของ Excel (46296.2155…) ไม่ใช่ข้อความ
 * ถ้าไม่แปลงก่อน ทุกแถวจะอ่านเวลาไม่ได้พร้อมกันทั้งไฟล์
 * แล้วจะล้มที่ "ไฟล์นี้ไม่มีเวลาดำเนินการล่าสุด" โดยที่ความจริงมีครบทุกแถว
 */
function thToIso(v: string): string | null {
  const s = maybeDate(String(v ?? '').trim())
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s)
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

  /*
    ชื่อหัวตารางมีสองชุด แล้วแต่ภาษาที่เลือกตอนกดออกรายงาน
    ชุดไทยล้วนเป็นของเดิม ชุดจีนต่อไทยเป็นของที่เจอวันที่ 13 ต.ค. 2569
    ใส่ไว้ทั้งคู่ ไม่ได้ย้ายไปใช้ชุดใหม่อย่างเดียว เพราะไฟล์เก่ายังต้องอัปได้

    คอลัมน์การดำเนินการของชุดใหม่ต้องเลือกให้ถูกตัว ไฟล์มีสองคอลัมน์ที่คล้ายกัน
      สถานะปฏิบัติงานสุดท้ายที่เป็นผลของฮับ  มีแต่สแกนตามจุด ไม่มีการยกเลิกเลยสักแถว
      สถานะการทำงานสุดท้าย                 มีครบทุกค่าที่ไฟล์เก่าเคยมี รวมการยกเลิก
    จึงใช้ตัวหลัง · ยืนยันจากการเทียบชุดค่ากับของที่นำเข้าไปแล้วในฐานข้อมูล
    ไม่ได้เดาจากชื่อคอลัมน์
  */
  const head = (rows[0] ?? []).map((x) => String(x ?? ''))
  const cTrack = findCol(head, 'เลขพัสดุ')
  const cDest = findCol(head, 'สาขาปลายทาง')
  const cAction = findCol(head, 'การดำเนินการล่าสุด', 'สถานะการทำงานสุดท้าย')
  const cLastAt = findCol(head, 'เวลาที่ดำเนินการล่าสุด', 'สถานะเวลาการทำงานสุดท้าย')
  const cInWh = findCol(head, 'เวลารับพัสดุเข้าคลัง')
  /*
    ชุดจีน-ไทยมีสองคอลัมน์ชื่อ "สาขาสุดท้าย" ติดกัน ต่างกันแค่คำว่า id ในหัวจีน
    ตัวแรกเก็บรหัสสาขาเป็นเลข (6, TH02030116) ซึ่งอ่านแล้วไม่ได้ความอะไร
    ตัวหลังเก็บชื่อสาขาจริง (21 BPL_BHUB-บางพลี) ซึ่งเป็นสิ่งที่คนอยากเห็น
    จึงต้องระบุหัวจีนเต็ม ๆ ให้ชนตัวหลังก่อน ไม่งั้นได้เลขรหัสมาทั้งคอลัมน์
  */
  const cActor = findCol(
    head,
    'สาขา/หัวหน้าสาขา',
    'ที่ดำเนินการล่าสุด',
    '最后操作网点สาขาสุดท้าย',
    'รายชื่อพนักงาน',
  )
  const cProv = findCol(head, 'จังหวัด-ที่อยู่ผู้รับ', 'จังหวัดผู้รับ', 'จังหวัด')
  /* ไม่บังคับ · ไฟล์ที่ไม่มีคอลัมน์นี้ก็ยังอัปได้ตามปกติ ช่องนี้จะว่างเฉย ๆ */
  const cCust = findCol(head, 'ประเภทลูกค้า')

  /*
    บอกให้ชัดว่าขาดคอลัมน์ไหน พร้อมแปะหัวตารางที่เจอจริงมาด้วย
    ของเดิมบอกรวมสามชื่อเสมอ คนอ่านจึงไปไล่หาผิดคอลัมน์
    รอบนี้ไฟล์มีสาขาปลายทางครบ แต่ข้อความบอกว่าไม่มี
  */
  const missing: string[] = []
  if (cTrack < 0) missing.push('เลขพัสดุ')
  if (cDest < 0) missing.push('สาขาปลายทาง')
  if (cAction < 0) missing.push('การดำเนินการล่าสุด')
  if (missing.length) {
    const seen = head.filter(Boolean).slice(0, 10).join(' / ')
    throw new Error(
      `ไฟล์นี้ไม่มีคอลัมน์ ${missing.join(' และ ')} · หัวตารางที่เจอคือ ${seen}`,
    )
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
      /* แปลรหัสดิบเป็นคำไทยตั้งแต่ตอนอ่านไฟล์ ไม่ใช่ตอนโชว์
         เพราะค่านี้ถูกเก็บลงฐานข้อมูลและเอาไปเทียบกับรอบก่อน
         ถ้าแปลตอนโชว์ ของเก่ากับของใหม่จะเป็นคนละคำทั้งที่เป็นเรื่องเดียวกัน */
      action: actionTH(clean(r[cAction]) ?? ''),
      last_at: lastAt,
      in_wh_at: inAt,
      actor: cActor >= 0 ? clean(r[cActor]) : null,
      province: cProv >= 0 ? clean(r[cProv]) : null,
      cust_type: cCust >= 0 ? custTypeTH(clean(r[cCust]) ?? '') || null : null,
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

/** นับว่าเป็นของลูกค้าประเภทไหนบ้าง ประเภทละกี่ชิ้น · ไม่ระบุก็นับรวมเป็นกองเดียว */
export function byCust(rows: P24Row[]): { cust: string; n: number }[] {
  const m = new Map<string, number>()
  for (const r of rows) {
    const k = r.cust_type || 'ไม่ระบุ'
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m.entries()].map(([cust, n]) => ({ cust, n })).sort((a, b) => b.n - a.n)
}

/** ค้างมากี่ชั่วโมง นับจากเวลารับเข้าคลัง เทียบกับเวลาของไฟล์ ไม่ใช่นาฬิกาเครื่อง */
export function heldHours(r: P24Row, dataAt: string): number | null {
  if (!r.in_wh_at) return null
  return Math.floor((new Date(dataAt).getTime() - new Date(r.in_wh_at).getTime()) / 36e5)
}
