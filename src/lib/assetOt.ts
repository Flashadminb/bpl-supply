import { supabase, readableError } from './supabase'

/**
 * ขอ OT ต่อเวลาคืนเครื่อง
 *
 * กำหนดเดิมไม่ถูกแก้ · due_at ยังเป็นเวลาเดิมเสมอ
 * ที่เพิ่มคือ ot_until ซึ่งบอกว่าขอต่อถึงกี่โมง
 * ถ้าเลื่อน due_at ทิ้ง สิ้นเดือนจะไม่มีใครรู้ว่าใบนี้เลยเวลามาตั้งแต่กี่โมง
 * และสถิติทั้งเดือนจะสวยเกินจริงโดยไม่มีใครตั้งใจโกง
 */

export const OT_HOURS = [1, 2, 3, 4] as const

export interface AssetOtRow {
  txn_id: string
  ot_until: string
  ot_hours: number
  due_at: string | null
}

/** ใบที่ยังไม่คืนและขอ OT ไว้ · เอาไปต่อกับรายการถือครองฝั่งหน้าจอ */
export async function listAssetOtOpen(): Promise<AssetOtRow[]> {
  const { data, error } = await supabase.rpc('asset_ot_open')
  if (error) throw new Error(readableError(error))
  return (data ?? []) as AssetOtRow[]
}

/** ต่อเวลา · ฐานข้อมูลบังคับว่าเฉพาะคนที่เบิกเอง และต่อได้ครั้งเดียวต่อใบ */
export async function assetOtExtend(txnId: string, hours: number) {
  const { data, error } = await supabase.rpc('asset_ot_extend', { p_txn_id: txnId, p_hours: hours })
  if (error) throw new Error(readableError(error))
  return data as { ok: true; ot_until: string }
}

/**
 * ตอนนี้ใบนี้ถือว่าเลยเวลาไหม
 *
 * อยู่ในช่วง OT ไม่นับว่าเลย แต่พอพ้น ot_until แล้วกลับมานับใหม่ทันที
 * กติกานี้อยู่ที่เดียวเพื่อให้ทุกหน้าตัดสินเหมือนกัน
 * ถ้าแต่ละหน้าคิดเอง วันหนึ่งหน้าแรกจะบอกว่าเลย ส่วนหน้าคืนของบอกว่ายัง
 */
export function isLate(dueAt: string | null, otUntil?: string | null): boolean {
  if (!dueAt) return false
  const limit = otUntil && Date.parse(otUntil) > Date.parse(dueAt) ? otUntil : dueAt
  return Date.now() > Date.parse(limit)
}
