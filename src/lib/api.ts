import { supabase, functionUrl, readableError, emailFromEmployeeCode } from './supabase'
import type {
  CartLine,
  CreateReqResult,
  Item,
  OpenBorrowing,
  Profile,
  Requisition,
  ReturnCond,
  SyncChannel,
  SyncState,
  UserRole,
} from './types'

const ITEM_COLS =
  'id,sku,name,category_id,hub_code,unit,shelf_code,qty_on_hand,min_qty,is_returnable,requires_approval,image_path,qr_payload,is_active,updated_at,categories(id,name,auto_approvable)'

const REQ_COLS =
  'id,ref_no,requester_id,hub_code,purpose,note,status,evidence_file_id,evidence_web_link,evidence_bytes,created_at,decided_by,decided_at,reject_reason,' +
  'requisition_items(id,requisition_id,item_id,qty_requested,qty_approved,status,qty_before,qty_after,items(id,sku,name,unit,shelf_code,qty_on_hand,min_qty,category_id,is_returnable)),' +
  'profiles!requisitions_requester_id_fkey(id,full_name,employee_code),' +
  'sync_log(id,requisition_id,channel,state,detail,updated_at)'

function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw new Error(readableError(res.error))
  return res.data as T
}

/* ------------------------------------------------------------------ items */

export async function listItems(opts: { search?: string; categoryId?: number | null } = {}): Promise<Item[]> {
  let q = supabase.from('items').select(ITEM_COLS).eq('is_active', true).order('name')
  if (opts.categoryId) q = q.eq('category_id', opts.categoryId)
  if (opts.search && opts.search.trim()) {
    const s = opts.search.trim()
    q = q.or(`name.ilike.%${s}%,sku.ilike.%${s}%,shelf_code.ilike.%${s}%`)
  }
  return unwrap(await q) as unknown as Item[]
}

export async function listAllItemsForAdmin(): Promise<Item[]> {
  return unwrap(await supabase.from('items').select(ITEM_COLS).order('name')) as unknown as Item[]
}

export async function getItem(id: number): Promise<Item> {
  return unwrap(await supabase.from('items').select(ITEM_COLS).eq('id', id).single()) as unknown as Item
}

/** หาวัสดุจากค่าใน QR — รองรับทั้ง qr_payload ตรง ๆ และรหัส SKU */
export async function findItemByCode(code: string): Promise<Item | null> {
  const value = code.trim()
  if (!value) return null
  const { data, error } = await supabase
    .from('items')
    .select(ITEM_COLS)
    .or(`qr_payload.eq.${value},sku.eq.${value}`)
    .eq('is_active', true)
    .limit(1)
  if (error) throw new Error(readableError(error))
  return ((data && data[0]) as unknown as Item) ?? null
}

export async function listCategories() {
  return unwrap(
    await supabase.from('categories').select('id,name,auto_approvable').order('id'),
  ) as { id: number; name: string; auto_approvable: boolean }[]
}

export async function createCategory(name: string, autoApprovable: boolean) {
  const { error } = await supabase
    .from('categories')
    .insert({ name: name.trim(), auto_approvable: autoApprovable })
  if (error) throw new Error(readableError(error))
}

export async function updateCategory(
  id: number,
  patch: { name?: string; auto_approvable?: boolean },
) {
  const { error } = await supabase.from('categories').update(patch).eq('id', id)
  if (error) throw new Error(readableError(error))
}

/** ลบผ่าน RPC เพราะต้องกันไม่ให้ลบหมวดที่ยังมีวัสดุผูกอยู่ */
export async function deleteCategory(id: number) {
  const { error } = await supabase.rpc('delete_category', { p_id: id })
  if (error) throw new Error(readableError(error))
}

/* ----------------------------------------------------------- requisitions */

/**
 * ประวัติของตัวเองเท่านั้น
 * ต้องกรอง requester_id เอง เพราะ RLS ปล่อยให้แอดมินเห็นทั้งฮับ
 * แต่หน้าฝั่งพนักงานต้องโชว์แค่ของตัวเอง ไม่ว่าจะเป็นบทบาทไหน
 */
export async function listMyRequisitions(limit = 50): Promise<Requisition[]> {
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth.user?.id
  if (!uid) return []
  return unwrap(
    await supabase
      .from('requisitions')
      .select(REQ_COLS)
      .eq('requester_id', uid)
      .order('created_at', { ascending: false })
      .limit(limit),
  ) as unknown as Requisition[]
}

export async function listPendingRequisitions(): Promise<Requisition[]> {
  return unwrap(
    await supabase
      .from('requisitions')
      .select(REQ_COLS)
      .eq('status', 'pending')
      .order('created_at', { ascending: true }),
  ) as unknown as Requisition[]
}

export async function listRequisitionsBetween(fromISO: string, toISO: string, hub?: string) {
  let q = supabase
    .from('requisitions')
    .select(REQ_COLS)
    .gte('created_at', fromISO)
    .lte('created_at', toISO)
    .order('created_at', { ascending: false })
  if (hub) q = q.eq('hub_code', hub)
  return unwrap(await q) as unknown as Requisition[]
}

export async function createRequisition(args: {
  lines: CartLine[]
  purpose?: string
  note?: string
  evidenceFileId?: string | null
  evidenceLink?: string | null
  evidenceBytes?: number | null
}): Promise<CreateReqResult> {
  const { data, error } = await supabase.rpc('create_requisition', {
    p_lines: args.lines.map((l) => ({ item_id: l.item_id, qty: l.qty })),
    p_purpose: args.purpose || null,
    p_note: args.note || null,
    p_evidence_file_id: args.evidenceFileId ?? null,
    p_evidence_link: args.evidenceLink ?? null,
    p_evidence_bytes: args.evidenceBytes ?? null,
  })
  if (error) throw new Error(readableError(error))
  return data as CreateReqResult
}

export async function approveRequisition(requisitionId: string, lineIds: number[]) {
  const { data, error } = await supabase.rpc('approve_requisition', {
    p_requisition_id: requisitionId,
    p_line_ids: lineIds,
  })
  if (error) throw new Error(readableError(error))
  return data as { status: string; approved_lines: number; total_lines: number }
}

export async function rejectRequisition(requisitionId: string, reason: string) {
  const { error } = await supabase.rpc('reject_requisition', {
    p_requisition_id: requisitionId,
    p_reason: reason || null,
  })
  if (error) throw new Error(readableError(error))
}

export async function setSync(
  requisitionId: string,
  channel: SyncChannel,
  state: SyncState,
  detail?: string,
) {
  const { error } = await supabase.rpc('set_sync', {
    p_requisition_id: requisitionId,
    p_channel: channel,
    p_state: state,
    p_detail: detail ?? null,
  })
  // แถบสถานะพังไม่ควรทำให้การเบิกล้ม — แค่ log ไว้
  if (error) console.warn('[BPL] set_sync ล้มเหลว', error)
}

/* ---------------------------------------------------------------- returns */

export async function listOpenBorrowings(mineOnly = true, userId?: string): Promise<OpenBorrowing[]> {
  let q = supabase.from('open_borrowings').select('*').order('created_at', { ascending: false })
  if (mineOnly && userId) q = q.eq('requester_id', userId)
  return unwrap(await q) as unknown as OpenBorrowing[]
}

export async function createReturn(args: {
  lineId: number
  qty: number
  condition: ReturnCond
  fileId?: string | null
  link?: string | null
}) {
  const { data, error } = await supabase.rpc('create_return', {
    p_line_id: args.lineId,
    p_qty: args.qty,
    p_condition: args.condition,
    p_file_id: args.fileId ?? null,
    p_link: args.link ?? null,
  })
  if (error) throw new Error(readableError(error))
  return data as { id: number; qty_after: number | null }
}

/* ------------------------------------------------------------------ admin */

export async function listProfiles(): Promise<Profile[]> {
  return unwrap(await supabase.from('profiles').select('*').order('employee_code')) as unknown as Profile[]
}

export async function updateProfile(
  id: string,
  patch: Partial<Pick<Profile, 'role' | 'is_active' | 'hub_code'>>,
) {
  const { error } = await supabase.from('profiles').update(patch).eq('id', id)
  if (error) throw new Error(readableError(error))
}

/** พนักงานเปลี่ยนรหัสผ่านของตัวเอง — ทำฝั่ง client ได้เลย เพราะล็อกอินอยู่แล้ว */
export async function changeMyPassword(newPassword: string) {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw new Error(readableError(error))
  // ตั้งรหัสเองแล้ว ไม่ต้องบังคับอีก
  const { error: flagError } = await supabase.rpc('clear_password_flag')
  if (flagError) console.warn('[BPL] เคลียร์ธงบังคับเปลี่ยนรหัสไม่สำเร็จ', flagError)
}

/** แอดมินสร้างบัญชีพนักงานใหม่ — ต้องผ่าน Edge Function เพราะใช้คีย์ระดับ service role */
export async function createEmployee(args: {
  employeeCode: string
  fullName: string
  hubCode: string
  role: UserRole
  password: string
}) {
  return callFunction<{ ok: true; id: string; email: string }>(
    'admin-users',
    JSON.stringify({
      action: 'create',
      employee_code: args.employeeCode.trim(),
      full_name: args.fullName.trim(),
      hub_code: args.hubCode,
      role: args.role,
      password: args.password,
      email: emailFromEmployeeCode(args.employeeCode),
    }),
    { 'Content-Type': 'application/json' },
  )
}

/** แอดมินตั้งรหัสผ่านใหม่ให้พนักงานที่ลืมรหัส */
export async function resetEmployeePassword(userId: string, password: string) {
  return callFunction<{ ok: true }>(
    'admin-users',
    JSON.stringify({ action: 'reset', user_id: userId, password }),
    { 'Content-Type': 'application/json' },
  )
}

export type ItemDraft = {
  id?: number
  sku: string
  name: string
  hub_code: string
  unit: string
  category_id: number | null
  shelf_code: string | null
  qty_on_hand: number
  min_qty: number
  is_returnable: boolean
  requires_approval: boolean
  qr_payload: string | null
  is_active: boolean
}

export async function upsertItem(draft: ItemDraft) {
  const { error } = await supabase.from('items').upsert(draft, { onConflict: 'sku' })
  if (error) throw new Error(readableError(error))
}

export async function adjustStock(itemId: number, delta: number, reason: string) {
  const { data, error } = await supabase.rpc('adjust_stock', {
    p_item_id: itemId,
    p_delta: delta,
    p_reason: reason || 'adjust',
  })
  if (error) throw new Error(readableError(error))
  return data as { qty_after: number }
}

export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle()
  if (error) throw new Error(readableError(error))
  return ((data && (data.value as T)) ?? null) as T | null
}

export async function setSetting(key: string, value: unknown) {
  const { error } = await supabase.from('app_settings').upsert({ key, value })
  if (error) throw new Error(readableError(error))
}

export async function listHubs() {
  return unwrap(
    await supabase.from('hubs').select('code,name,is_active').eq('is_active', true).order('code'),
  ) as { code: string; name: string; is_active: boolean }[]
}

/* --------------------------------------------------------- edge functions */

async function callFunction<T>(name: string, body: BodyInit, headers: Record<string, string> = {}): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const res = await fetch(functionUrl(name), {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
      ...headers,
    },
    body,
  })
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* ไม่ใช่ JSON */
  }
  if (!res.ok) {
    const msg = (json as { error?: string } | null)?.error ?? text ?? `HTTP ${res.status}`
    throw new Error(msg)
  }
  return json as T
}

/** อัปรูปหลักฐานเข้า Google Drive ผ่าน Edge Function — client ไม่เคยเห็น service account */
export async function uploadEvidence(blob: Blob, filename: string) {
  const fd = new FormData()
  fd.append('file', blob, filename)
  fd.append('filename', filename)
  return callFunction<{ fileId: string; webViewLink: string; bytes: number }>('upload-evidence', fd)
}

/* -------------------------------------------------------- แกลเลอรีหลักฐาน */

export interface EvidenceRow {
  kind: 'requisition' | 'return'
  source_id: string
  ref_no: string
  created_at: string
  hub_code: string
  file_id: string
  web_link: string | null
  archived: boolean
  who: string
  employee_code: string
  has_returnable: boolean
  summary: string
  /** รูปทุกใบของคำขอนี้ ใบแรกคือรูปหลัก */
  file_ids: string[]
}

export const MAX_PHOTOS = 5

/** แนบรูปเพิ่มเข้าคำขอหลังสร้างเสร็จ — ใบแรกจะถูกตั้งเป็นรูปหลักให้อัตโนมัติ */
export async function addRequisitionPhotos(
  requisitionId: string,
  photos: { file_id: string; web_link: string | null; bytes: number | null }[],
) {
  if (photos.length === 0) return { added: 0, total: 0 }
  const { data, error } = await supabase.rpc('add_requisition_photos', {
    p_requisition_id: requisitionId,
    p_photos: photos,
  })
  if (error) throw new Error(readableError(error))
  return data as { added: number; total: number }
}

export async function listEvidence(opts: {
  returnableOnly?: boolean
  includeArchived?: boolean
  limit?: number
}): Promise<EvidenceRow[]> {
  let q = supabase.from('evidence_feed').select('*').order('created_at', { ascending: false })
  if (opts.returnableOnly) q = q.eq('has_returnable', true)
  if (!opts.includeArchived) q = q.eq('archived', false)
  return unwrap(await q.limit(opts.limit ?? 120)) as unknown as EvidenceRow[]
}

export async function setEvidenceArchived(row: EvidenceRow, archived: boolean) {
  const { error } = await supabase.rpc('set_evidence_archived', {
    p_kind: row.kind,
    p_source_id: row.source_id,
    p_archived: archived,
  })
  if (error) throw new Error(readableError(error))
}

/**
 * โหลดรูปหลักฐานผ่าน Edge Function แล้วแปลงเป็น object URL
 * ต้องดึงด้วย fetch เพราะ <img src> ส่ง header ยืนยันตัวตนไม่ได้
 * และไฟล์ใน Drive เป็นส่วนตัว จะแปะ URL ตรง ๆ ไม่ได้
 */
export async function fetchEvidenceImage(fileId: string): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const res = await fetch(`${functionUrl('evidence-image')}?fileId=${encodeURIComponent(fileId)}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
    },
  })
  if (!res.ok) {
    const text = await res.text()
    let msg = text
    try {
      msg = (JSON.parse(text) as { error?: string }).error ?? text
    } catch {
      /* ไม่ใช่ JSON */
    }
    throw new Error(msg || `โหลดรูปไม่สำเร็จ (HTTP ${res.status})`)
  }
  return URL.createObjectURL(await res.blob())
}

export async function exportToSheet(payload: {
  requisitionId?: string
  from?: string
  to?: string
  hub?: string
}) {
  return callFunction<{ updated: number; appended: number; sheet: string }>(
    'export-sheet',
    JSON.stringify(payload),
    { 'Content-Type': 'application/json' },
  )
}
