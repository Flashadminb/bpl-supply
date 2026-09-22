import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigured = Boolean(url && anonKey)

if (!supabaseConfigured) {
  // ไม่ throw เพื่อให้หน้า login ยังขึ้นและบอกผู้ใช้ได้ว่าลืมตั้ง .env
  console.error('[BPL] ยังไม่ได้ตั้งค่า VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ใน .env')
}

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'public-anon-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})

/** URL ของ Edge Function — ใช้โดเมนเดียวกับ Supabase project */
export function functionUrl(name: string): string {
  return `${(url ?? '').replace(/\/$/, '')}/functions/v1/${name}`
}

/** รหัสพนักงาน -> อีเมลปลอมที่ Supabase Auth ใช้จริง  FE-10482 -> fe-10482@bpl.local */
export function emailFromEmployeeCode(code: string): string {
  const domain = import.meta.env.VITE_AUTH_EMAIL_DOMAIN || 'bpl.local'
  return `${code.trim().toLowerCase()}@${domain}`
}

/** ข้อความ error จาก Supabase/Postgres ให้อ่านรู้เรื่องบนหน้าจอ */
export function readableError(err: unknown): string {
  if (!err) return 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ'
  const e = err as { message?: string; error_description?: string }
  const raw = e.message ?? e.error_description ?? String(err)
  if (/invalid login credentials/i.test(raw)) return 'รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง'
  if (/email not confirmed/i.test(raw)) return 'บัญชีนี้ยังไม่ได้ยืนยัน ติดต่อแอดมิน'
  if (/failed to fetch|networkerror|load failed/i.test(raw)) return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสัญญาณเน็ตแล้วลองใหม่'
  return raw
}
