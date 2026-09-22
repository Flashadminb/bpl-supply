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
