import { supabase, readableError } from './supabase'

/**
 * บัตรเบรค OS — ตัวเรียกฝั่งเว็บ
 *
 * ทุกตัวในนี้เรียก RPC ไม่มีตัวไหนเขียนตารางตรง ๆ
 * เพราะตาราง break_* ไม่มี policy เขียนสักตัว ต่อให้เรียกตรงก็ไม่ผ่าน
 * ฐานข้อมูลตรวจสิทธิ์เองทุกครั้ง ฝั่งนี้แค่ซ่อนปุ่มให้ไม่ต้องกดแล้วเจอ error
 */

export interface BreakCardOption {
  code: string
  group_code: string
  group_name: string | null
  max_open: number
  open_now: number
  busy: boolean
  busy_people: number | null
  busy_since: string | null
}

export interface BreakReason {
  code: string
  label: string
  default_minutes: number
  sort: number
  active: boolean
}

/** ใบที่ยังเปิดอยู่ · จอ "เบรค OS" ใช้ร่วมกันสามที่ ขอบเขตมาจาก RLS */
export interface BreakBoardRow {
  id: number
  ref_no: string
  card_code: string
  group_code: string
  reason_label: string
  people: number
  minutes: number
  nickname: string | null
  issued_at: string
  due_at: string
  gate_out_at: string | null
  gate_out_people: number | null
  in_ban: boolean
  issued_by_name: string
  issued_by_code: string
  waiting_gate: boolean
}

/** ประวัติ · ผู้ตรวจสอบเท่านั้น (RLS ของ break_passes คุมอยู่) */
export interface BreakRow extends BreakBoardRow {
  reason_code: string
  closed_at: string | null
  close_kind: 'guard' | 'problem' | 'supervisor' | 'admin' | null
  returned_people: number | null
  problem_code: string | null
  problem_note: string | null
  ban_reason: string | null
  exported_at: string | null
  closed_by_name: string | null
  walk_sec: number | null
  out_sec: number | null
  over_sec: number | null
  missing_people: number
  issue_shots: number
  return_shots: number
}

/** ผลการสแกนของ รปภ · การสแกนไม่เปลี่ยนอะไร แค่บอกว่าเห็นอะไร */
export type BreakScan =
  | { state: 'unknown'; code: string }
  | { state: 'free'; code: string }
  | {
      state: 'closed'
      code: string
      closed_at: string
      closed_by: string | null
      close_kind: string | null
    }
  | {
      state: 'ready' | 'out'
      code: string
      pass_id: number
      people: number
      reason: string
      minutes: number
      nickname: string | null
      issued_at: string
      issued_by: string
      due_at: string
      gate_out_at: string | null
      gate_out_people: number | null
      in_ban: boolean
    }

export interface BreakPhotoIn {
  file_id: string
  /**
   * ลิงก์เปิดไฟล์บน Drive
   *
   * ยอมให้เป็น null เพราะ shotsToPhotos คืนแบบนั้นได้
   * ฐานข้อมูลข้ามรูปที่ไม่มีลิงก์ทิ้งไปเอง แล้วด่าน "ต้องมีรูปอย่างน้อยหนึ่งใบ"
   * จะไม่ผ่าน ซึ่งถูกแล้ว — รูปที่เปิดไม่ได้เท่ากับไม่มีรูป
   */
  web_link: string | null
  bytes?: number | null
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(readableError(error))
  return data as T
}

/* ───────────────────────── หัวหน้างาน ───────────────────────── */

/** บัตรของแผนกที่ฉันดูแล พร้อมสถานะว่าใบไหนไม่ว่าง */
export async function listMyBreakCards(): Promise<BreakCardOption[]> {
  return rpc<BreakCardOption[]>('break_my_cards', {})
}

export async function listBreakReasons(): Promise<BreakReason[]> {
  const { data, error } = await supabase
    .from('break_reasons')
    .select('code,label,default_minutes,sort,active')
    .eq('active', true)
    .order('sort')
  if (error) throw new Error(readableError(error))
  return (data ?? []) as BreakReason[]
}

/** ช่วงห้ามเบรคที่ครอบเวลาตอนนี้ · ไม่มีก็คืน null */
export async function breakBanNow(): Promise<{ id: number; note: string | null } | null> {
  const { data, error } = await supabase.rpc('break_ban_now')
  if (error) throw new Error(readableError(error))
  // ฟังก์ชันประกาศว่าคืน break_bans ไม่ใช่ setof
  // ไม่เจอช่วงห้ามมันจึงคืนแถวที่ทุกช่องเป็น null ไม่ใช่ null ทั้งก้อน
  const row = data as { id: number | null; note: string | null } | null
  return row && row.id !== null ? { id: row.id, note: row.note } : null
}

export async function issueBreak(args: {
  cardCode: string
  people: number
  reason: string
  minutes?: number | null
  photos: BreakPhotoIn[]
  nickname?: string | null
  banReason?: string | null
}) {
  return rpc<{
    id: number
    ref_no: string
    card_code: string
    people: number
    minutes: number
    issued_at: string
    due_at: string
    in_ban: boolean
    ban_note: string | null
  }>('break_issue', {
    p_card_code: args.cardCode,
    p_people: args.people,
    p_reason: args.reason,
    p_minutes: args.minutes ?? null,
    p_photos: args.photos,
    p_nickname: args.nickname ?? null,
    p_ban_reason: args.banReason ?? null,
  })
}

/* ───────────────────────────── รปภ ───────────────────────────── */

export async function scanBreakCard(code: string): Promise<BreakScan> {
  return rpc<BreakScan>('break_scan', { p_code: code })
}

export async function breakGateOut(passId: number, people?: number | null) {
  return rpc<{ ok: true; pass_id: number; people: number }>('break_gate_out', {
    p_pass_id: passId,
    p_people: people ?? null,
  })
}

export async function breakReturn(passId: number) {
  return rpc<{ ok: true; pass_id: number; people: number }>('break_return', {
    p_pass_id: passId,
  })
}

/** รับกลับทั้งที่คนไม่ครบ · รูปบังคับหนึ่งใบ และเตือนคนที่เกี่ยวข้องทันที */
export async function breakProblem(args: {
  passId: number
  problem: string
  returned: number
  photo: BreakPhotoIn[]
  note?: string | null
}) {
  return rpc<{ ok: true; pass_id: number; returned: number; missing: number }>('break_problem', {
    p_pass_id: args.passId,
    p_problem: args.problem,
    p_returned: args.returned,
    p_photo: args.photo,
    p_note: args.note ?? null,
  })
}

/* ───────────────────────── จอร่วมและประวัติ ───────────────────────── */

/** ใบที่ยังเปิดอยู่ · เห็นได้แค่ไหนขึ้นกับว่าใครถาม RLS จัดการให้ */
export async function listBreakBoard(): Promise<BreakBoardRow[]> {
  const { data, error } = await supabase
    .from('break_board_rows')
    .select('*')
    .order('issued_at')
  if (error) throw new Error(readableError(error))
  return (data ?? []) as BreakBoardRow[]
}

export async function listBreakRows(args: {
  from: string
  to: string
  onlyOver?: boolean
  onlyBan?: boolean
  onlyProblem?: boolean
}): Promise<BreakRow[]> {
  let q = supabase
    .from('break_rows')
    .select('*')
    .gte('issued_at', args.from)
    .lte('issued_at', args.to)
    .order('issued_at', { ascending: false })
    .limit(1000)
  if (args.onlyBan) q = q.eq('in_ban', true)
  if (args.onlyProblem) q = q.eq('close_kind', 'problem')
  if (args.onlyOver) q = q.gt('over_sec', 0)
  const { data, error } = await q
  if (error) throw new Error(readableError(error))
  return (data ?? []) as BreakRow[]
}

export interface BreakPhoto {
  id: number
  phase: 'issue' | 'return'
  file_id: string
  web_link: string
  created_at: string
}

/**
 * รูปของใบหนึ่ง · ผู้ตรวจสอบเท่านั้น
 *
 * ไม่ได้ดึงมาพร้อมตารางประวัติ เพราะส่วนใหญ่ไม่ได้เปิดดู
 * ดึงตอนกดขยายแถวแทน ประหยัดทั้งเน็ตหน้างานและโควตา
 */
export async function listBreakPhotos(passId: number): Promise<BreakPhoto[]> {
  const { data, error } = await supabase
    .from('break_photos')
    .select('id,phase,file_id,web_link,created_at')
    .eq('pass_id', passId)
    .order('phase')
    .order('created_at')
  if (error) throw new Error(readableError(error))
  return (data ?? []) as BreakPhoto[]
}

/** ปิดใบที่ไม่มีใครมารับกลับ · หลังบ้านหรือหัวหน้าที่ปล่อยเอง */
export async function closeBreakPasses(ids: number[], note?: string | null) {
  return rpc<{ ok: true; closed: number }>('break_close', {
    p_pass_ids: ids,
    p_note: note ?? null,
  })
}

/* ───────────────────────── ตั้งค่า (เจ้าของระบบ) ───────────────────────── */

export interface BreakSettings {
  groups: {
    code: string
    name: string | null
    max_open: number
    active: boolean
    cards: number
    users: string[]
  }[]
  cards: { code: string; group_code: string; active: boolean; note: string | null; busy: boolean }[]
  reasons: BreakReason[]
  bans: { id: number; start_min: number; end_min: number; note: string | null; active: boolean }[]
  alert_subs: string[]
}

export async function getBreakSettings(): Promise<BreakSettings> {
  return rpc<BreakSettings>('break_settings', {})
}

export async function saveBreakGroup(args: {
  code: string
  name?: string | null
  maxOpen?: number
  active?: boolean
}) {
  return rpc<{ ok: true; code: string }>('break_group_save', {
    p_code: args.code,
    p_name: args.name ?? null,
    p_max_open: args.maxOpen ?? 3,
    p_active: args.active ?? true,
  })
}

export async function addBreakCards(group: string, codes: string[]) {
  return rpc<{ ok: true; added: number; skipped: number }>('break_cards_add', {
    p_group: group,
    p_codes: codes,
  })
}

export async function saveBreakCard(args: {
  code: string
  active?: boolean | null
  group?: string | null
  note?: string | null
}) {
  return rpc<{ ok: true; code: string }>('break_card_save', {
    p_code: args.code,
    p_active: args.active ?? null,
    p_group: args.group ?? null,
    p_note: args.note ?? null,
  })
}

export async function setBreakGroupUser(group: string, userId: string, on: boolean) {
  return rpc<{ ok: true }>('break_group_user_set', {
    p_group: group,
    p_user: userId,
    p_on: on,
  })
}

export async function saveBreakBan(args: {
  id?: number | null
  startMin: number
  endMin: number
  note?: string | null
  active?: boolean
}) {
  return rpc<{ ok: true; id: number }>('break_ban_save', {
    p_id: args.id ?? null,
    p_start_min: args.startMin,
    p_end_min: args.endMin,
    p_note: args.note ?? null,
    p_active: args.active ?? true,
  })
}

export async function deleteBreakBan(id: number) {
  return rpc<{ ok: true }>('break_ban_delete', { p_id: id })
}

export async function saveBreakReason(args: {
  code: string
  label: string
  minutes: number
  sort?: number
  active?: boolean
}) {
  return rpc<{ ok: true; code: string }>('break_reason_save', {
    p_code: args.code,
    p_label: args.label,
    p_minutes: args.minutes,
    p_sort: args.sort ?? 0,
    p_active: args.active ?? true,
  })
}

export async function setBreakAlertSub(userId: string, on: boolean) {
  return rpc<{ ok: true }>('break_alert_sub_set', { p_user: userId, p_on: on })
}

/* ───────────────────────────── ตัวช่วยเล็ก ๆ ───────────────────────────── */

/** 250 → "04:10" · ใช้กับช่วงห้ามเบรคที่เก็บเป็นนาทีนับจากเที่ยงคืนเวลาไทย */
export function minToHHMM(m: number): string {
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/** "04:10" → 250 · คืน null ถ้ารูปแบบไม่ถูก */
export function hhmmToMin(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  if (h > 23 || mi > 59) return null
  return h * 60 + mi
}

/**
 * นับถอยหลังเป็นข้อความ · ติดลบแปลว่าเกินเวลาแล้ว
 *
 * ทำฝั่งเครื่องล้วน ไม่ยิงเซิร์ฟเวอร์ จึงตรงถึงวินาทีและไม่กินโควตาอะไรเลย
 * ส่วน push ที่ตามมาทีหลังเป็นแค่ตัวสำรองตอนปิดจอ
 */
export function countdown(dueAt: string, now = Date.now()): { text: string; over: boolean } {
  const diff = Math.round((new Date(dueAt).getTime() - now) / 1000)
  const over = diff < 0
  const a = Math.abs(diff)
  const mm = Math.floor(a / 60)
  const ss = a % 60
  return { text: `${over ? '+' : ''}${mm}:${String(ss).padStart(2, '0')}`, over }
}

/** 740 → "12:20" · ใช้โชว์เวลาเดินกับเวลาอยู่ข้างนอกในประวัติ */
export function secToMMSS(s: number | null): string {
  if (s === null || s === undefined) return '—'
  const a = Math.max(0, Math.round(s))
  return `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`
}
