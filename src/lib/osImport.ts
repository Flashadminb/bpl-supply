import type { OsImportRow } from './types'

/**
 * แกะข้อมูลที่ก็อปมาจาก Google Sheet
 *
 * ก็อปจากชีตแล้ววางจะได้ตัวคั่นเป็นแท็บเสมอ ไม่ใช่จุลภาค
 * คอลัมน์ตามชีตจริง: กะ · รูป · รหัส OS · ชื่อ · สังกัด · รุ่น · IMEI · ชื่อเล่น
 * ช่องรูปเป็นรูปในเซลล์ ซึ่งก็อปมาแล้วได้ค่าว่าง — ข้ามไปเฉย ๆ
 */
export interface ParsedImport {
  rows: OsImportRow[]
  /** แถวที่อ่านไม่ออก เก็บไว้โชว์ให้คนตรวจ ไม่ได้ทิ้งเงียบ */
  bad: { line: number; text: string; why: string }[]
}

const NBSP = / /g

const clean = (v: string | undefined): string | null => {
  const s = (v ?? '').replace(NBSP, ' ').trim()
  return s === '' ? null : s
}

/**
 * ตัดข้อความที่ก็อปมาเป็นตาราง
 *
 * ช่องที่มีการขึ้นบรรทัดอยู่ข้างใน จะถูกครอบด้วยอัญประกาศ
 * แล้วมีขึ้นบรรทัดจริงอยู่ข้างใน ถ้าตัดด้วยการ split ตามบรรทัด แถวนั้นจะขาดครึ่ง
 * แล้วครึ่งหลังจะกลายเป็นแถวเสียที่คนต้องมานั่งงงว่าผิดตรงไหน
 *
 * จึงต้องไล่ทีละตัวอักษรและจำว่าตอนนี้อยู่ในอัญประกาศหรือเปล่า
 * อัญประกาศสองตัวติดกันข้างในแปลว่าอัญประกาศจริงหนึ่งตัว ตามแบบ TSV
 */
function splitTable(text: string): string[][] {
  const rows: string[][] = []
  let cells: string[] = []
  let cur = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        cur += ch
      }
      continue
    }

    if (ch === '"' && cur === '') {
      quoted = true
    } else if (ch === '\t') {
      cells.push(cur)
      cur = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      cells.push(cur)
      rows.push(cells)
      cells = []
      cur = ''
    } else {
      cur += ch
    }
  }

  if (cur !== '' || cells.length > 0) {
    cells.push(cur)
    rows.push(cells)
  }
  return rows
}

const SHIFT_LIKE = /^\d{1,2}:\d{2}/

export function parseOsPaste(text: string): ParsedImport {
  const rows: OsImportRow[] = []
  const bad: ParsedImport['bad'] = []
  const table = splitTable(text)

  /**
   * ช่องรูปอยู่ตรงไหน — ตัดสินจากทั้งก้อน ไม่ใช่ทีละแถว
   *
   * ชีตตัดช่องว่างท้ายแถวทิ้งตอนก็อป แถวที่ไม่มีชื่อเล่นจึงสั้นกว่าเพื่อน
   * ถ้าเดาทีละแถวจากจำนวนช่อง แถวสั้นจะถูกอ่านเลื่อนไปหนึ่งคอลัมน์ทั้งแถว
   * แล้วรหัสพนักงานจะไปโผล่ในช่องชื่อ โดยหน้าจอยังดูเหมือนอ่านได้ปกติ
   *
   * ทั้งก้อนมาจากการลากคลุมครั้งเดียว โครงคอลัมน์จึงเหมือนกันทุกแถวเสมอ
   */
  const widest = table.reduce((n, c) => Math.max(n, c.length), 0)
  const hasPhotoCol =
    widest >= 8 ||
    table.some(
      (c) =>
        SHIFT_LIKE.test((c[0] ?? '').trim()) && (c[1] ?? '').trim() === '' && c.length >= 5,
    )

  table.forEach((cells, i) => {
    if (cells.every((c) => c.trim() === '')) return

    // ในชีตมีแถวที่ใส่ไว้แต่กะ ไว้คั่นกลุ่ม ไม่ใช่แถวที่พัง ข้ามเงียบ ๆ
    if (cells.slice(1).every((c) => c.trim() === '')) return

    // ก็อปมาทั้งแถบจะได้แท็บ ถ้าไม่มีแท็บเลยแปลว่าวางผิดที่ เช่นก็อปมาทีละช่อง
    if (cells.length < 4) {
      bad.push({
        line: i + 1,
        text: cells.join(' ').slice(0, 60),
        why: 'ไม่ใช่ข้อมูลที่ก็อปมาทั้งแถว',
      })
      return
    }

    const at = (n: number) => clean(cells[hasPhotoCol ? n : n - 1])

    const shift = clean(cells[0])
    const osCode = at(2)
    const fullName = at(3)
    const affiliation = at(4)
    const phoneModel = at(5)
    const imei = at(6)
    const nickname = at(7)

    if (!fullName) {
      if (osCode || imei || phoneModel) {
        bad.push({ line: i + 1, text: cells.join(' ').slice(0, 60), why: 'ไม่มีชื่อ-นามสกุล' })
      }
      return
    }

    // หัวตารางติดมาด้วยก็ข้ามให้ ไม่ต้องให้คนไปลากใหม่
    if (fullName.includes('ชื่อ-นามสกุล') || osCode === 'รหัสพนักงาน OS') return

    rows.push({
      shift,
      os_code: osCode,
      full_name: fullName,
      affiliation,
      phone_model: phoneModel,
      imei,
      nickname,
    })
  })

  return { rows, bad }
}

/**
 * IMEI ครบไหม — คืนข้อความบอกปัญหา หรือ null ถ้าไม่มีปัญหา
 *
 * IMEI จริงมี 15 หลักเสมอ เครื่องสองซิมในชีตเขียนเป็น 352233119375526/01
 * ซึ่งเลขหลังสแลชเป็นเลขช่องซิม ไม่ใช่ส่วนหนึ่งของ IMEI
 * จึงนับเฉพาะส่วนหน้าและต้องได้ 15 พอดี
 *
 * เคยนับตัวเลขทั้งก้อนแล้วยอมถึง 17 เพื่อให้เคสสองซิมผ่าน
 * ซึ่งแปลว่าเลข 16 หลักที่พิมพ์เกินมาจริง ๆ ก็ผ่านไปด้วยโดยไม่มีใครรู้
 */
export function imeiProblem(imei?: string | null): string | null {
  if (!imei || imei.trim() === '') return 'ยังไม่ได้กรอก IMEI'
  const head = imei.split(/[/,]/)[0]
  const digits = head.replace(/\D/g, '')
  if (digits.length === 15) return null
  if (digits.length === 0) return 'ไม่มีตัวเลขเลย'
  return `กรอกไม่ครบ — มี ${digits.length} หลัก ต้องมี 15 หลัก`
}

const NOT_A_MODEL = /^\s*(day\s*off|ลา|หยุด|-)\s*$/i

/**
 * ข้อมูลแถวนี้น่าสงสัยตรงไหน — ไม่บล็อก แค่ติดป้ายให้เห็น
 *
 * ไม่ห้ามบันทึก เพราะของจริงในชีตก็ไม่ครบอยู่แล้วและงานต้องเดินต่อ
 * แต่ถ้าไม่บอกเลย ความผิดพลาดจะไปโผล่ตอน รปภ ยืนงงอยู่ที่ประตู
 */
export function osRowWarnings(r: {
  os_code?: string | null
  imei?: string | null
  phone_model?: string | null
}): string[] {
  const out: string[] = []
  if (!r.os_code) out.push('ไม่มีรหัส OS')

  const bad = imeiProblem(r.imei)
  if (bad) out.push(bad.startsWith('ยังไม่') ? 'ไม่มี IMEI' : `IMEI ${bad}`)

  if (!r.phone_model) out.push('ไม่มีรุ่นเครื่อง')
  else if (NOT_A_MODEL.test(r.phone_model)) out.push('ช่องรุ่นไม่ใช่ชื่อรุ่น')

  return out
}

/** ชื่อไฟล์รูป -> กุญแจจับคู่ · ตัดนามสกุลและช่องว่างหัวท้ายออก */
export function photoKeyOf(filename: string): string {
  return filename
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(NBSP, ' ')
    .trim()
    .toLowerCase()
}
