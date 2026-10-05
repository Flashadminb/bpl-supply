import { supabase, readableError } from './supabase'

/**
 * ตารางปล่อยรถ — งานคนละเรื่องกับเบิกของ
 *
 * อยู่ในแอพนี้เพราะสองอย่างที่มันต้องใช้มีอยู่แล้วที่นี่
 * ระบบแจ้งเตือนเข้ามือถือ กับนาฬิกาที่เดินทุกนาทีคอยดูว่าใครต้องเตือนแล้ว
 * สร้างใหม่ข้างนอกแปลว่าหน้างานต้องล็อกอินสองที่และกดอนุญาตแจ้งเตือนอีกรอบ
 *
 * ตารางและสิทธิ์แยกขาดจากของเดิมทั้งหมด ใช้ร่วมกันแค่ profiles
 */

export interface TruckBoardRow {
  id: number
  branch_id: number | null
  branch_name: string
  branch_code: string | null
  branch_full: string | null
  province: string | null
  district: string | null
  subdistrict: string | null
  arrived_at: string
  allow_min: number
  due_at: string
  note: string | null
  by_name: string | null
  /** เหลือกี่นาที · ติดลบ = เลยกำหนด · ใช้ตอนโหลด ส่วนที่เดินจริงคำนวณในหน้าจอ */
  left_min: number
}

export interface TruckBranch {
  id: number
  code: string | null
  name: string
  full_name: string | null
  branch_ref: string | null
  kind: string | null
  province: string | null
  district: string | null
  subdistrict: string | null
  is_open: boolean
  is_active: boolean
}

/** คันที่ยังอยู่ในคลัง · เรียงจากคันที่ต้องรีบที่สุด */
export async function listTruckBoard(): Promise<TruckBoardRow[]> {
  const { data, error } = await supabase
    .from('truck_board_rows')
    .select('*')
    .order('due_at', { ascending: true })
    .limit(500)
  if (error) throw new Error(readableError(error))
  return (data ?? []) as TruckBoardRow[]
}

/** รายชื่อสาขาไว้ทำช่องค้นหา · โหลดครั้งเดียวแล้วค้นในเครื่อง เพราะมีไม่กี่ร้อยแถว */
export async function listTruckBranches(): Promise<TruckBranch[]> {
  const { data, error } = await supabase
    .from('truck_branches')
    .select('*')
    .eq('is_active', true)
    .order('name')
    .limit(2000)
  if (error) throw new Error(readableError(error))
  return (data ?? []) as TruckBranch[]
}

/**
 * เพิ่มรถเข้าคลัง
 *
 * พิมพ์ชื่อสาขาที่ยังไม่มีได้เลย ฐานข้อมูลสร้างสาขาให้เอง
 * เพราะรถมาจอดอยู่แล้ว การบังคับให้ไปสร้างสาขาก่อนคือการขวางงานที่ด่วนกว่า
 */
export async function addTruck(args: {
  name: string
  arrivedAt?: string
  minutes?: number
  note?: string
}): Promise<{ id: number; branch: string }> {
  const { data, error } = await supabase.rpc('truck_add', {
    p_name: args.name,
    p_arrived: args.arrivedAt ?? null,
    p_min: args.minutes ?? 120,
    p_note: args.note?.trim() || null,
  })
  if (error) throw new Error(readableError(error))
  return data as { id: number; branch: string }
}

/** ปล่อยรถ · กดครั้งเดียวจบ ไม่ถามยืนยัน เพราะวันละสามร้อยคัน */
export async function releaseTruck(id: number): Promise<{ late_min: number }> {
  const { data, error } = await supabase.rpc('truck_release', { p_id: id })
  if (error) throw new Error(readableError(error))
  return data as { late_min: number }
}

/** กดผิดคัน · เลิกทำได้ภายใน 10 นาที */
export async function unreleaseTruck(id: number) {
  const { error } = await supabase.rpc('truck_unrelease', { p_id: id })
  if (error) throw new Error(readableError(error))
}

/** เพิ่มสาขาทีละหลายอัน · วางมาทั้งก้อน บรรทัดละสาขา */
export async function addTruckBranches(lines: string[]): Promise<{ added: number; skipped: number }> {
  const { data, error } = await supabase.rpc('truck_branches_add', { p_lines: lines })
  if (error) throw new Error(readableError(error))
  return data as { added: number; skipped: number }
}

/** เหลือกี่วินาที · ติดลบคือเลยกำหนด */
export function secondsLeft(dueAt: string, now = Date.now()): number {
  return Math.round((new Date(dueAt).getTime() - now) / 1000)
}
