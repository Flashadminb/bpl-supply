import { supabase } from './supabase'

/**
 * หน้าจับคู่คุยกับฐานข้อมูลของตัวเอง ไม่ได้อยู่กับที่เดียวกับงานอื่นแล้ว
 *
 * ─────────────────────────────────────────────────────────────────
 * ทำไมต้องแยกออกมา
 *
 * ข้อมูลของหน้าจับคู่กินที่ราวเก้าสิบเปอร์เซ็นต์ของฐานข้อมูลทั้งแอพ
 * ทั้งที่งานอื่นทุกงานรวมกันใช้ไม่ถึงยี่สิบเมกะไบต์
 * แปลว่าของหน้าเดียวหน้านี้เกือบทำให้งานที่เหลือทั้งระบบไม่มีที่อยู่
 *
 * ไฟล์สองใบที่อัปเข้ามาคือภาพของคลังในวันนั้น อัปใหม่ทับได้ทุกเมื่อ
 * ไม่ใช่ข้อมูลที่ต้องเก็บย้อนหลัง จึงไม่มีเหตุให้ต้องอยู่ที่เดียวกับของที่ลบไม่ได้
 * อย่างประวัติการเบิก รูปหลักฐาน หรือรายชื่อพนักงาน
 * ─────────────────────────────────────────────────────────────────
 *
 * การล็อกอินยังเป็นที่เดิมทั้งหมด · ฝั่งนี้ไม่มีระบบล็อกอินของตัวเองเลย
 * ใครเข้าแอพไม่ได้ ก็แตะข้อมูลฝั่งนี้ไม่ได้เช่นกัน
 */

/** ที่อยู่ของตัวกลาง · ตั้งใน .env ได้ เผื่อวันหนึ่งย้ายโดเมน */
const BASE = (
  (import.meta.env.VITE_PAIR_API as string | undefined) ||
  'https://bpl-pair-api.elevenezbest.workers.dev'
).replace(/\/$/, '')

/**
 * ยิงไปที่ตัวกลาง พร้อม token ของคนที่ล็อกอินอยู่
 *
 * ขอ session ใหม่ทุกครั้งแทนการจำไว้ เพราะไลบรารีของ Supabase
 * ต่ออายุ token ให้เองเป็นระยะ · จำไว้คือวันหนึ่งจะส่งตัวที่หมดอายุไป
 */
export async function pairCall<T>(path: string, body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('หมดเวลาการใช้งาน · กรุณาเข้าสู่ระบบอีกครั้ง')

  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสัญญาณเน็ตแล้วลองใหม่')
  }

  /* อ่านเป็นข้อความก่อนแปลง · ตอนตัวกลางล้มจริง ๆ มันตอบเป็นหน้า HTML
     ซึ่งถ้าแปลงเป็น JSON ตรง ๆ จะได้ข้อความผิดพลาดที่ไม่บอกอะไรเลย */
  const raw = await res.text()
  let out: { ok?: boolean; error?: string; data?: T } & Record<string, unknown>
  try {
    out = JSON.parse(raw)
  } catch {
    throw new Error(`ตัวกลางตอบไม่เป็นรูปแบบที่อ่านได้ · ${res.status}`)
  }

  if (!res.ok || out.ok === false) throw new Error(out.error ?? `ตัวกลางตอบ ${res.status}`)
  return out as T
}
