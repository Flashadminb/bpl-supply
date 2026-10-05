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


/* ----------------------------------------------------- ประวัติและสถิติ */

export interface TruckDoneRow {
  id: number
  branch_name: string
  branch_code: string | null
  arrived_at: string
  allow_min: number
  due_at: string
  left_at: string
  late_min: number | null
  on_time: boolean
  dwell_min: number | null
  by_name: string | null
  closed_by_name: string | null
}

/**
 * คันที่ปล่อยแล้วในช่วงที่เลือก
 *
 * ดึงมาคำนวณในเบราว์เซอร์ ไม่ได้สรุปที่ฐานข้อมูล
 * เพราะหน้าสถิติต้องหั่นข้อมูลหลายแบบพร้อมกัน ทั้งรายชั่วโมง รายสาขา และการกระจาย
 * ถ้าทำเป็นวิวสรุปจะได้วิวสามสี่ตัวที่ต้องแก้พร้อมกันทุกครั้งที่เปลี่ยนมุมมอง
 * สามเดือนอยู่ราวสามหมื่นแถว ซึ่งยังเบากว่ารูปหลักฐานใบเดียว
 */
export async function listTruckDone(fromISO: string, toISO: string): Promise<TruckDoneRow[]> {
  const { data, error } = await supabase
    .from('truck_done_rows')
    .select('id,branch_name,branch_code,arrived_at,allow_min,due_at,left_at,late_min,on_time,dwell_min,by_name,closed_by_name')
    .gte('arrived_at', fromISO)
    .lte('arrived_at', toISO)
    .order('arrived_at', { ascending: true })
    .limit(20000)
  if (error) throw new Error(readableError(error))
  return (data ?? []) as TruckDoneRow[]
}

/** คันที่ปล่อยแล้วแต่ยังไม่ได้ส่งลงชีต · ไม่ใส่ช่วง = นับทั้งหมด */
export async function countTruckExportRows(args?: { from: string; to: string }): Promise<number> {
  let q = supabase
    .from('truck_export_rows')
    .select('id', { count: 'exact', head: true })
    .eq('needs_push', true)
  if (args) q = q.gte('arrived_at', args.from).lte('arrived_at', args.to)
  const { count, error } = await q
  if (error) throw new Error(readableError(error))
  return count ?? 0
}

/** ลบของเก่าที่ส่งลงชีตแล้ว · ฐานข้อมูลปฏิเสธถ้ามีคันที่ยังไม่ส่งปนอยู่ */
export async function purgeExportedTrucks(days = 180): Promise<{ deleted: number }> {
  const { data, error } = await supabase.rpc('truck_purge_exported', { p_days: days })
  if (error) throw new Error(readableError(error))
  return (data ?? { deleted: 0 }) as { deleted: number }
}


/* ------------------------------------------------------- แจ้งเตือน */

export interface TruckAlertSettings {
  before_min: number
  after_min: number
  repeat_min: number
  stop_min: number
  is_on: boolean
  roles: string[]
}

export async function getTruckAlertSettings(): Promise<TruckAlertSettings> {
  const { data, error } = await supabase.from('truck_alert_settings').select('*').single()
  if (error) throw new Error(readableError(error))
  return data as TruckAlertSettings
}

export async function saveTruckAlertSettings(s: TruckAlertSettings) {
  const { error } = await supabase.rpc('truck_alert_save', {
    p_before: s.before_min,
    p_after: s.after_min,
    p_repeat: s.repeat_min,
    p_stop: s.stop_min,
    p_on: s.is_on,
    p_roles: s.roles,
  })
  if (error) throw new Error(readableError(error))
}

export async function listTruckAlertSubs(): Promise<string[]> {
  const { data, error } = await supabase.from('truck_alert_subs').select('user_id')
  if (error) throw new Error(readableError(error))
  return (data ?? []).map((r) => (r as { user_id: string }).user_id)
}

export async function setTruckAlertSub(userId: string, on: boolean) {
  const { error } = await supabase.rpc('truck_alert_sub_set', { p_user: userId, p_on: on })
  if (error) throw new Error(readableError(error))
}


/* --------------------------------------------------------- สาขา */

export async function saveTruckBranch(b: {
  id?: number | null
  name: string
  code?: string | null
  full_name?: string | null
  province?: string | null
  district?: string | null
  subdistrict?: string | null
  branch_ref?: string | null
  is_open?: boolean
  is_active?: boolean
}) {
  const { error } = await supabase.rpc('truck_branch_save', {
    p_id: b.id ?? null,
    p_name: b.name,
    p_code: b.code ?? null,
    p_full: b.full_name ?? null,
    p_province: b.province ?? null,
    p_district: b.district ?? null,
    p_subdistrict: b.subdistrict ?? null,
    p_ref: b.branch_ref ?? null,
    p_open: b.is_open ?? true,
    p_active: b.is_active ?? true,
  })
  if (error) throw new Error(readableError(error))
}

export async function deleteTruckBranches(ids: number[]): Promise<{ deleted: number }> {
  const { data, error } = await supabase.rpc('truck_branches_delete', { p_ids: ids })
  if (error) throw new Error(readableError(error))
  return (data ?? { deleted: 0 }) as { deleted: number }
}
