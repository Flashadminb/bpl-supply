import type { UserRole } from './types'

/**
 * ระบบมี 3 ระดับ แต่ระดับบนสุดมีคนเดียวคือเจ้าของระบบ
 * คนที่แอดมินเพิ่มเข้ามาได้จึงมีแค่ "หน้างาน" กับ "แอดมิน"
 *
 * ค่าในฐานข้อมูลยังเป็น staff / supervisor / admin เหมือนเดิม
 * (enum ของ Postgres แก้ยาก ไม่คุ้มเสี่ยงกับ RLS ที่อ้างค่าเหล่านี้อยู่)
 *
 *   staff      -> "หน้างาน"      เบิก คืน ดูประวัติของตัวเอง
 *   supervisor -> "แอดมิน"       + อนุมัติคำขอ แก้สต็อก รับของเข้า ส่งออก Sheet
 *   admin      -> "เจ้าของระบบ"  + เพิ่มบัญชี รีเซ็ตรหัสผ่านคนอื่น ดูตารางสิทธิ์
 */
export const ROLE_TH: Record<UserRole, string> = {
  staff: 'หน้างาน',
  supervisor: 'แอดมิน',
  admin: 'เจ้าของระบบ',
}

/**
 * ตัวเลือกในดรอปดาวน์ตอนเพิ่ม/แก้ผู้ใช้
 * ไม่มี "เจ้าของระบบ" ให้เลือก — ตั้งได้ทาง SQL เท่านั้น กันเผลอยกสิทธิ์สูงสุดให้คนอื่น
 */
export const ASSIGNABLE_ROLES: { key: UserRole; label: string; hint: string }[] = [
  { key: 'staff', label: 'หน้างาน', hint: 'เบิก คืน ดูประวัติของตัวเอง' },
  { key: 'supervisor', label: 'แอดมิน', hint: 'อนุมัติคำขอ แก้สต็อก ส่งออก Sheet' },
]

/** ทั้งสองระดับนี้เข้าหน้าฝั่งแอดมินได้ */
export const MANAGER_ROLES: UserRole[] = ['supervisor', 'admin']

/**
 * ตำแหน่งที่ไม่ได้อยู่ใน enum ของฐานข้อมูล แต่เป็นคอลัมน์ boolean แยก
 *
 * "ผู้ตรวจสอบ" = หน้างานที่เห็นเครื่องทุกแผนก เบิกแทนคนอื่นได้ และโอนเครื่องได้
 * แต่ไม่มีสิทธิ์แอดมินเลยสักอย่าง เข้าหน้าแอดมินไม่ได้ อนุมัติไม่ได้ แก้สต็อกไม่ได้
 * และคืนแทนคนอื่นไม่ได้ เพราะคนคืนต้องถือของอยู่จริงถึงจะถ่ายรูปสภาพได้
 *
 * แยกจาก role เพราะ Postgres ห้ามใช้ค่า enum ที่เพิ่งเพิ่มในทรานแซกชันเดียวกัน
 * ซึ่งจะทำให้ไฟล์ migration พังกลางทางบนหน้า SQL Editor ของ Supabase
 */
export const DISPATCH_TH = 'ผู้ตรวจสอบ'

/** ชื่อตำแหน่งที่เอาไว้โชว์ — รวมกรณีผู้ตรวจสอบเข้าไปด้วย */
export function roleLabel(p: { role: UserRole; can_dispatch?: boolean }): string {
  if (p.role === 'staff' && p.can_dispatch) return DISPATCH_TH
  return ROLE_TH[p.role]
}

/**
 * ตำแหน่งที่เลือกได้ในดรอปดาวน์ — "ผู้ตรวจสอบ" ไม่ใช่ค่าใน enum
 * จึงต้องแปลงไป-กลับระหว่างสิ่งที่เห็นบนหน้าจอกับสองคอลัมน์ในฐานข้อมูล
 */
export type PostKey = 'staff' | 'dispatcher' | 'supervisor' | 'admin'

export const POSTS: { key: PostKey; label: string; hint: string }[] = [
  { key: 'staff', label: 'หน้างาน', hint: 'เบิก คืน ดูประวัติของตัวเอง' },
  {
    key: 'dispatcher',
    label: DISPATCH_TH,
    hint: 'เห็นเครื่องทุกแผนก เบิกแทนและโอนเครื่องได้ · ไม่มีสิทธิ์แอดมิน ไม่คืนแทน',
  },
  { key: 'supervisor', label: 'แอดมิน', hint: 'อนุมัติคำขอ แก้สต็อก ส่งออก Sheet' },
]

export function postOf(p: { role: UserRole; can_dispatch?: boolean }): PostKey {
  if (p.role === 'staff' && p.can_dispatch) return 'dispatcher'
  return p.role
}

/** แปลงกลับเป็นสองคอลัมน์ที่เก็บจริง */
export function postPatch(key: PostKey): { role: UserRole; can_dispatch: boolean } {
  if (key === 'dispatcher') return { role: 'staff', can_dispatch: true }
  return { role: key as UserRole, can_dispatch: false }
}

/** จ่ายของแทนคนอื่นได้ไหม — ตรงกับ my_can_proxy() ในฐานข้อมูล */
export function canProxy(p: { role: UserRole; can_dispatch?: boolean } | null): boolean {
  if (!p) return false
  return p.role === 'supervisor' || p.role === 'admin' || Boolean(p.can_dispatch)
}
