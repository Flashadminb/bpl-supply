import type { OsImportRow } from './types'

/**
 * แกะข้อมูลที่ก็อปมาจาก Google Sheet
 *
 * ก็อปจากชีตแล้ววางจะได้ตัวคั่นเป็นแท็บเสมอ ไม่ใช่จุลภาค
 * ช่องที่เว้นว่างในชีตจะมาเป็นสตริงว่าง ไม่ได้หายไป ลำดับคอลัมน์จึงยังตรง
 *
 * คอลัมน์ตามชีตจริง: กะ · รูป · รหัส OS · ชื่อ · สังกัด · รุ่น · IMEI · ชื่อเล่น
 * ช่องรูปเป็นรูปในเซลล์ ซึ่งก็อปมาแล้วได้ค่าว่าง — ข้ามไปเฉย ๆ
 *
 * เผื่อกรณีก็อปมาไม่ครบคอลัมน์ไว้ด้วย ถ้ามี 7 ช่องจะถือว่าไม่มีช่องรูป
 * เพราะคนมักลากคลุมเฉพาะคอลัมน์ที่มีข้อความ
 */
export interface ParsedImport {
  rows: OsImportRow[]
  /** แถวที่อ่านไม่ออก เก็บไว้โชว์ให้คนตรวจ ไม่ได้ทิ้งเงียบ */
  bad: { line: number; text: string; why: string }[]
}

const clean = (v: string | undefined): string | null => {
  const s = (v ?? '').replace(/ /g, ' ').trim()
  return s === '' ? null : s
}

export function parseOsPaste(text: string): ParsedImport {
  const rows: OsImportRow[] = []
  const bad: ParsedImport['bad'] = []

  const lines = text.split(/\r?\n/)
  lines.forEach((raw, i) => {
    if (!raw.trim()) return

    const cells = raw.split('\t')
    // ก็อปมาทั้งแถบจะได้แท็บ ถ้าไม่มีแท็บเลยแปลว่าวางผิดที่ เช่นก็อปมาทีละช่อง
    if (cells.length < 4) {
      bad.push({ line: i + 1, text: raw.slice(0, 60), why: 'ไม่ใช่ข้อมูลที่ก็อปมาทั้งแถว' })
      return
    }

    // มีช่องรูปหรือไม่ — ดูจากจำนวนคอลัมน์
    const hasPhotoCol = cells.length >= 8
    const at = (n: number) => clean(cells[hasPhotoCol ? n : n - 1])

    const shift = clean(cells[0])
    const osCode = at(2)
    const fullName = at(3)
    const affiliation = at(4)
    const phoneModel = at(5)
    const imei = at(6)
    const nickname = at(7)

    if (!fullName) {
      // แถวว่างกลางตารางเป็นเรื่องปกติในชีตนี้ ไม่ต้องรายงานว่าพัง
      if (osCode || imei || phoneModel) {
        bad.push({ line: i + 1, text: raw.slice(0, 60), why: 'ไม่มีชื่อ-นามสกุล' })
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
  const imei = (r.imei ?? '').replace(/\D/g, '')
  if (!r.imei) out.push('ไม่มี IMEI')
  else if (imei.length < 15) out.push(`IMEI สั้นไป (${imei.length} หลัก)`)
  else if (imei.length > 17) out.push(`IMEI ยาวเกิน (${imei.length} หลัก)`)
  if (!r.phone_model) out.push('ไม่มีรุ่นเครื่อง')
  else if (/^\s*(day\s*off|ลา|หยุด)\s*$/i.test(r.phone_model)) out.push('ช่องรุ่นไม่ใช่ชื่อรุ่น')
  return out
}

/** ชื่อไฟล์รูป -> กุญแจจับคู่ · ตัดนามสกุลและช่องว่างหัวท้ายออก */
export function photoKeyOf(filename: string): string {
  return filename
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/ /g, ' ')
    .trim()
    .toLowerCase()
}
