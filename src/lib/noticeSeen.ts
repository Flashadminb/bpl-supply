import { supabase, readableError } from './supabase'

/**
 * จำว่าใครเห็นแจ้งเตือนอะไรไปแล้ว
 *
 * เก็บที่ฐานข้อมูลไม่ใช่ในเครื่อง เพราะพนักงานคนหนึ่งเปิดทั้งมือถือตัวเอง
 * และเครื่องส่วนกลาง ถ้าเก็บในเครื่อง เรื่องเดิมจะเด้งใหม่ทุกครั้งที่เปลี่ยนเครื่อง
 * แล้วป็อปอัพจะกลายเป็นสิ่งที่ทุกคนกดปิดโดยไม่อ่าน
 *
 * ของเก่าเกิน 14 วันถูกลบตอนอ่าน ไม่ต้องตั้ง cron
 */

export async function listNoticeSeen(): Promise<string[]> {
  const { data, error } = await supabase.rpc('notice_seen_list')
  if (error) throw new Error(readableError(error))
  return (data ?? []) as string[]
}

export async function markNoticeSeen(keys: string[]): Promise<number> {
  if (keys.length === 0) return 0
  const { data, error } = await supabase.rpc('notice_seen_mark', { p_keys: keys })
  if (error) throw new Error(readableError(error))
  return (data ?? 0) as number
}
