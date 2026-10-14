import { supabase, functionUrl } from './supabase'

/**
 * คลังเก่า — ประวัติที่เลยกำหนดเก็บแล้วและถูกลบออกจากฐานข้อมูลไป
 *
 * ─────────────────────────────────────────────────────────────────
 * คนใช้ไม่ต้องรู้ว่าข้อมูลมาจากไหน
 *
 * ของใหม่อยู่ในฐานข้อมูล เร็วเหมือนเดิมทุกอย่าง
 * ของเก่าถูกส่งขึ้นชีตทุกคืนแล้วลบออกจากฐานข้อมูลเมื่อครบกำหนด
 * ไฟล์นี้คือทางที่หน้าเว็บไปหยิบของเก่ากลับมาแสดงต่อท้ายให้เนียน
 *
 * หน้าจอเหมือนเดิมทุกอย่าง กดดูได้ กดดูรูปได้ ต่างแค่ช้ากว่าราวหนึ่งถึงสองวินาที
 * ─────────────────────────────────────────────────────────────────
 *
 * ห้ามเรียกตัวนี้อัตโนมัติเป็นรอบ ๆ เด็ดขาด
 * โควตาอ่านของ Google คือ 300 ครั้งต่อนาทีทั้งโปรเจกต์
 * หน้าไหนที่รีเฟรชตัวเองอยู่แล้ว ต้องดึงเฉพาะตอนคนขอของเก่าจริง ๆ เท่านั้น
 */

/** งานที่มีคลังเก่าให้อ่าน · ชื่อต้องตรงกับฝั่ง Edge Function */
export type ArchiveKind =
  | 'supply'
  | 'asset'
  | 'issue'
  | 'by'
  | 'break'
  | 'meeting'
  | 'sack'
  | 'truck'
  | 'wait'
  | 'osscan'

export interface ArchiveQuery {
  from?: string
  to?: string
  /** คำค้น · เทียบแบบมีคำนี้อยู่ข้างใน */
  q?: string
  /** จะค้นในคอลัมน์ไหนบ้าง · ใช้ชื่อหัวตารางในชีตตรง ๆ */
  cols?: string[]
  limit?: number
}

export interface ArchiveResult {
  /** แต่ละแถวคือ ชื่อหัวตาราง → ค่า · บวก __แท็บ ว่ามาจากเดือนไหน */
  rows: Record<string, unknown>[]
  /** อ่านแท็บไหนไปบ้าง ใช้เวลาเท่าไหร่ · ไว้ดูว่าช้าเพราะอะไร */
  tabs: { tab: string; ms: number; n: number }[]
  /** เดือนที่ยังไม่มีแท็บ · ไม่ใช่ความผิดพลาด แค่ตอนนั้นงานยังไม่เริ่มใช้ */
  empty: string[]
  problems: string[]
}

/**
 * ขอของเก่าจากคลัง
 *
 * ไม่โยน error ออกไปเมื่ออ่านไม่สำเร็จ · คืนผลว่างพร้อมคำอธิบายแทน
 * เพราะคลังเก่าเป็นของเสริม ล้มแล้วหน้าจอต้องยังแสดงของใหม่ได้ตามปกติ
 * ถ้าโยนออกไป หน้าประวัติทั้งหน้าจะพังเพียงเพราะชีตช้าหรือเน็ตสะดุด
 */
export async function archiveRead(kind: ArchiveKind, q: ArchiveQuery = {}): Promise<ArchiveResult> {
  const blank: ArchiveResult = { rows: [], tabs: [], empty: [], problems: [] }
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return { ...blank, problems: ['ยังไม่ได้เข้าสู่ระบบ'] }

    const res = await fetch(functionUrl('archive-read'), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ kind, ...q }),
    })
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      error?: string
      rows?: Record<string, unknown>[]
      แท็บที่อ่าน?: { tab: string; ms: number; n: number }[]
      เดือนที่ยังไม่มีข้อมูล?: string[]
      ปัญหา?: string[]
    }
    if (!res.ok || body.ok === false) {
      return { ...blank, problems: [body.error ?? `คลังเก่าตอบ ${res.status}`] }
    }
    return {
      rows: body.rows ?? [],
      tabs: body['แท็บที่อ่าน'] ?? [],
      empty: body['เดือนที่ยังไม่มีข้อมูล'] ?? [],
      problems: body['ปัญหา'] ?? [],
    }
  } catch (e) {
    return { ...blank, problems: [(e as Error).message] }
  }
}

/* ------------------------------------------------------------- ตัวช่วยแปลง */

/** ค่าจากชีตเป็นข้อความ · ชีตคืนมาเป็นตัวเลขบ้างข้อความบ้างแล้วแต่ช่อง */
export const aStr = (v: unknown): string => {
  const s = String(v ?? '').trim()
  return s === '--' || s === '-' ? '' : s
}

/** ค่าจากชีตเป็นตัวเลข · อ่านไม่ออกคืน null ไม่ใช่ 0 เพราะศูนย์กับไม่รู้ไม่เหมือนกัน */
export const aNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * ดึงรหัสไฟล์ใน Drive ออกจากช่องรูปของชีต
 *
 * ช่องนั้นเก็บเป็นสูตร HYPERLINK ซึ่งมีรหัสไฟล์ฝังอยู่ในลิงก์
 * บางชีตมีคอลัมน์ Drive File ID แยกให้แล้ว บางชีตไม่มี จึงต้องแกะเอาได้ด้วย
 *
 * คืนรหัสไฟล์ล้วน ๆ ไม่ใช่ลิงก์ เพราะหน้าเว็บต้องส่งรูปผ่าน evidence-image
 * ที่ตรวจสิทธิ์ซ้ำทุกครั้งเสมอ ห้ามปล่อยลิงก์ไดรฟ์ตรง ๆ ออกไปหน้าจอ
 */
export function aFileIds(v: unknown): string[] {
  const s = String(v ?? '')
  if (!s) return []
  const fromLink = [...s.matchAll(/\/file\/d\/([A-Za-z0-9_-]{20,})/g)].map((m) => m[1])
  if (fromLink.length) return fromLink
  return s
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter((x) => /^[A-Za-z0-9_-]{20,}$/.test(x))
}
