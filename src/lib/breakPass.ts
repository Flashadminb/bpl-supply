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
  /** เพดานจำนวนใบที่ปล่อยพร้อมกันได้ · 0 = ไม่จำกัด · คันโยกสำรอง ปกติเป็น 0 */
  max_open: number
  open_now: number
  /** เพดานจำนวนคนที่ออกพร้อมกันได้ · 0 = ไม่จำกัด · ตัวนี้คือเพดานจริงที่ใช้กัน */
  max_people: number
  /** หัวคนที่ออกไปแล้วตอนนี้ รวมทุกใบที่ยังไม่ปิด */
  open_people: number
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
  /** uuid ของคนปล่อย · ไว้กรองว่าใบไหนเป็นของเราเอง */
  issued_by: string
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

export interface BreakBanNow {
  id: number
  note: string | null
  /** daily = ช่วงประจำวันที่ตั้งไว้ · once = กดห้ามเดี๋ยวนี้ มีเวลาจบจริง */
  kind: 'daily' | 'once'
  starts_at: string | null
  ends_at: string | null
}

/** ช่วงห้ามเบรคที่ครอบเวลาตอนนี้ · ไม่มีก็คืน null */
export async function breakBanNow(): Promise<BreakBanNow | null> {
  const { data, error } = await supabase.rpc('break_ban_now')
  if (error) throw new Error(readableError(error))
  // ฟังก์ชันประกาศว่าคืน break_bans ไม่ใช่ setof
  // ไม่เจอช่วงห้ามมันจึงคืนแถวที่ทุกช่องเป็น null ไม่ใช่ null ทั้งก้อน
  const row = data as (BreakBanNow & { id: number | null }) | null
  return row && row.id !== null ? row : null
}

/**
 * กดห้ามเบรคเดี๋ยวนี้
 *
 * หมดอายุเอง ไม่ต้องกลับมาปิด ซึ่งเป็นจุดที่ช่วงห้ามแบบตั้งเวลาพังที่สุด
 * กดซ้ำ = เลื่อนเวลาจบของอันเดิม ไม่ได้สร้างซ้อน
 */
export async function breakBanQuick(minutes: number, note?: string | null) {
  return rpc<{ ok: true; id: number; until: string }>('break_ban_quick', {
    p_minutes: minutes,
    p_note: note ?? null,
  })
}

/**
 * ห้ามเบรคแบบกำหนดเวลาเอง ตั้งแต่เมื่อไหร่ถึงเมื่อไหร่
 *
 * คนคิดเป็น "ห้ามถึงบ่ายสอง" ไม่ได้คิดเป็น "ห้ามอีก 47 นาที"
 * และบางทีต้องตั้งล่วงหน้าก่อนรถเข้า ไม่ใช่กดตอนรถมาถึงแล้ว
 */
export async function breakBanSet(args: {
  startAt?: string | null
  endAt: string
  note?: string | null
}) {
  return rpc<{ ok: true; id: number; from: string; until: string }>('break_ban_set', {
    p_start: args.startAt ?? null,
    p_end: args.endAt,
    p_note: args.note ?? null,
  })
}

/** ช่วงห้ามที่ตั้งไว้แต่ยังไม่ถึงเวลา · ไว้บอกว่า "ตั้งไว้แล้วนะ เริ่มบ่ายสอง" */
export async function breakBanNext(): Promise<BreakBanNow | null> {
  const { data, error } = await supabase.rpc('break_ban_next')
  if (error) throw new Error(readableError(error))
  const row = data as (BreakBanNow & { id: number | null; starts_at: string | null }) | null
  return row && row.id !== null ? row : null
}

/** ยกเลิกช่วงห้ามที่กดไว้ · ไม่ได้ลบทิ้ง ประวัติยังอ่านได้ว่าเคยห้ามตอนไหน */
export async function breakBanStop() {
  return rpc<{ ok: true; stopped: number }>('break_ban_stop', {})
}

/** ลบแผนกที่สร้างผิด · แผนกที่บัตรเคยถูกปล่อยแล้วลบไม่ได้ */
export async function deleteBreakGroup(code: string) {
  return rpc<{ ok: true; code: string; cards_removed: number }>('break_group_delete', {
    p_code: code,
  })
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

/**
 * บัตรที่ฉันปล่อยเอง · ใบที่ยังไม่ปิดมาก่อน แล้วค่อยไล่ลงไปตามเวลา
 *
 * กรองด้วย issued_by ตรง ๆ ไม่ได้พึ่ง RLS อย่างเดียว
 * เพราะเจ้าของระบบกับผู้ตรวจสอบอ่านได้ทุกใบอยู่แล้ว ถ้าไม่กรอง
 * หน้านี้จะกลายเป็นประวัติทั้งฮับทันทีที่เขาเปิดดู ซึ่งไม่ใช่ของเขา
 */
export async function listMyBreakRows(userId: string, limit = 60): Promise<BreakRow[]> {
  const { data, error } = await supabase
    .from('break_rows')
    .select('*')
    .eq('issued_by', userId)
    .order('issued_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(readableError(error))
  return (data ?? []) as BreakRow[]
}

/**
 * ใบของทั้งฮับในช่วงที่ผ่านมา · หน้าของ รปภ ใช้ตอบคำถามที่ประตู
 *
 * กดรับกลับแล้วใบหายจากกระดานทันที ซึ่งถูกสำหรับ "ใครยังอยู่ข้างนอก"
 * แต่ตอบไม่ได้เลยว่า "บัตรใบนี้เมื่อกี้ออกไปตอนกี่โมง" หรือ "วันนี้ออกไปกี่รอบแล้ว"
 * ซึ่งเป็นคำถามที่เกิดขึ้นจริงทุกกะ
 *
 * RLS เปิดให้ รปภ อ่านย้อนหลังได้ 24 ชั่วโมงตั้งแต่ 097
 */
export async function listBreakRecent(hours = 24, limit = 80): Promise<BreakRow[]> {
  const from = new Date(Date.now() - hours * 3600_000).toISOString()
  const { data, error } = await supabase
    .from('break_rows')
    .select('*')
    .gte('issued_at', from)
    .order('issued_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(readableError(error))
  return (data ?? []) as BreakRow[]
}

/**
 * ลบใบเบรคถาวร · ย่อเป็นข้อความเก็บไว้ในประวัติให้ก่อนเสมอ
 *
 * ใบที่ยังไม่ปิดลบไม่ได้ ฐานข้อมูลจะปฏิเสธพร้อมบอกรหัสบัตร
 * เพราะบัตรใบนั้นจะค้างสถานะถูกใช้อยู่ตลอดกาล เอาไปปล่อยซ้ำไม่ได้อีก
 */
export async function deleteBreakPasses(ids: number[], why?: string): Promise<number> {
  const { data, error } = await supabase.rpc('break_passes_delete', {
    p_ids: ids,
    p_why: why?.trim() || null,
  })
  if (error) throw new Error(readableError(error))
  return (data ?? 0) as number
}

/**
 * ใบที่ปิดแล้วและยังไม่ได้ส่งลงชีต
 *
 * ไม่ใส่ช่วงวัน = นับทั้งหมด ไว้เตือนว่ามีของค้างอยู่นอกช่วงที่กำลังดู
 * ซึ่งเป็นกับดักที่เจอจริงกับฝั่งประวัติสแกนมาแล้ว กดส่งแล้วตัวเลขไม่ลด
 * เพราะของค้างอยู่เดือนก่อนหน้า โดยหน้าจอไม่ได้บอกอะไรเลย
 */
export async function countBreakExportRows(args?: {
  from: string
  to: string
}): Promise<number> {
  let q = supabase
    .from('break_export_rows')
    .select('id', { count: 'exact', head: true })
    .eq('needs_push', true)
  if (args) q = q.gte('issued_at', args.from).lte('issued_at', args.to)
  const { count, error } = await q
  if (error) throw new Error(readableError(error))
  return count ?? 0
}

/**
 * ลบใบที่เก่ากว่าที่กำหนด โดยต้องส่งลงชีตไปแล้วเท่านั้น
 *
 * ฐานข้อมูลจะปฏิเสธถ้ามีใบที่เก่าพอจะลบแต่ยังไม่ได้ส่ง
 * เพราะเจตนาของการลบคือย้ายที่เก็บไปไว้ที่ชีต ไม่ใช่ทำข้อมูลหาย
 */
export async function purgeExportedBreaks(days = 90): Promise<{ deleted: number }> {
  const { data, error } = await supabase.rpc('break_purge_exported', { p_days: days })
  if (error) throw new Error(readableError(error))
  return (data ?? { deleted: 0 }) as { deleted: number }
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
    max_people: number
    open_people: number
    active: boolean
    cards: number
    users: string[]
  }[]
  cards: {
    code: string
    group_code: string
    active: boolean
    note: string | null
    /** ยังไม่ได้รับกลับ · ปิดใช้งานหรือลบไม่ได้ */
    busy: boolean
    /** เคยถูกปล่อยแล้ว · ลบไม่ได้เพราะประวัติอ้างถึงรหัสนี้ ปิดใช้งานแทน */
    used: boolean
  }[]
  reasons: BreakReason[]
  bans: { id: number; start_min: number; end_min: number; note: string | null; active: boolean }[]
  alert_subs: string[]
  /** คนที่กดห้ามเบรคเดี๋ยวนี้ได้ · มาจากธง can_break_ban */
  ban_users: string[]
}

export async function getBreakSettings(): Promise<BreakSettings> {
  return rpc<BreakSettings>('break_settings', {})
}

export async function saveBreakGroup(args: {
  code: string
  name?: string | null
  /** เพดานจำนวนใบ · ค่าตั้งต้น 0 = ไม่จำกัด เพราะเพดานจริงคุมที่หัวคน */
  maxOpen?: number
  /** เพดานจำนวนคนที่ออกพร้อมกันได้ · เจ้าของระบบเคาะไว้ที่ 15 */
  maxPeople?: number
  active?: boolean
}) {
  return rpc<{ ok: true; code: string }>('break_group_save', {
    p_code: args.code,
    p_name: args.name ?? null,
    p_max_open: args.maxOpen ?? 0,
    p_max_people: args.maxPeople ?? 15,
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

/**
 * ลบบัตรทิ้ง · ใบที่เคยถูกปล่อยแล้วลบไม่ได้ ฐานข้อมูลคืนมาว่าเหลือใบไหนเพราะอะไร
 * ลบเท่าที่ลบได้ ไม่ล้มทั้งก้อนเพราะมีใบเดียวติด
 */
export async function deleteBreakCards(codes: string[]) {
  return rpc<{ ok: true; deleted: number; kept: { code: string; why: string }[] }>(
    'break_card_delete',
    { p_codes: codes },
  )
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
