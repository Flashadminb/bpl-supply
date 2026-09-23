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
  Department,
  SheetExportRow,
  Asset,
  AssetHolding,
  AssetIssue,
  AssetIssueInput,
  AssetOpenIssue,
  AssetPhotoInput,
  AssetPhotoStep,
  AssetType,
  ByRow,
  ByStatRow,
  ByStatus,
  AssetTxnKind,
  AssetHistoryRow,
  TransferNotice,
  MeetingRow,
  MeetingStat,
  MeetingStatus,
} from './types'

const ITEM_COLS =
  'id,sku,name,category_id,hub_code,unit,shelf_code,qty_on_hand,min_qty,is_returnable,requires_approval,dept_code,image_path,qr_payload,is_active,updated_at,categories(id,name,auto_approvable)'

const REQ_COLS =
  'id,ref_no,requester_id,hub_code,purpose,note,status,evidence_file_id,evidence_web_link,evidence_bytes,created_at,decided_by,decided_at,reject_reason,' +
  'requisition_items(id,requisition_id,item_id,qty_requested,qty_approved,status,qty_before,qty_after,items(id,sku,name,unit,shelf_code,qty_on_hand,min_qty,category_id,is_returnable)),' +
  'profiles!requisitions_requester_id_fkey(id,full_name,employee_code,dept_code),' +
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

/** คืนของ — ต้องมีรูปอย่างน้อย 1 ใบเสมอ ฐานข้อมูลปฏิเสธถ้าไม่มี */
export async function createReturn(args: {
  lineId: number
  qty: number
  condition: ReturnCond
  photos: { file_id: string; web_link: string | null; bytes: number | null }[]
}) {
  const { data, error } = await supabase.rpc('create_return', {
    p_line_id: args.lineId,
    p_qty: args.qty,
    p_condition: args.condition,
    p_file_id: args.photos[0]?.file_id ?? null,
    p_link: args.photos[0]?.web_link ?? null,
    p_photos: args.photos,
  })
  if (error) throw new Error(readableError(error))
  return data as { id: number; qty_after: number | null; photos: number }
}

/* -------------------------------------------------------------- แผนก */

export async function listDepartments(): Promise<Department[]> {
  return unwrap(
    await supabase.from('departments').select('*').eq('is_active', true).order('sort_no'),
  ) as unknown as Department[]
}

/** รหัสแผนกสร้างให้อัตโนมัติ กรอกแค่ชื่อ — รหัสตายตัวเพื่อให้เปลี่ยนชื่อทีหลังได้โดยของที่ผูกไว้ไม่ขาด */
export async function createDepartment(name: string) {
  const { error } = await supabase.rpc('create_department', { p_name: name.trim() })
  if (error) throw new Error(readableError(error))
}

export async function renameDepartment(code: string, name: string) {
  const { error } = await supabase.from('departments').update({ name: name.trim() }).eq('code', code)
  if (error) throw new Error(readableError(error))
}

/** ลบผ่าน RPC เพราะต้องกันไม่ให้ลบแผนกที่ยังมีคนหรือของผูกอยู่ */
export async function deleteDepartment(code: string) {
  const { error } = await supabase.rpc('delete_department', { p_code: code })
  if (error) throw new Error(readableError(error))
}

/* ------------------------------------------------------------------ admin */

export async function listProfiles(): Promise<Profile[]> {
  return unwrap(await supabase.from('profiles').select('*').order('employee_code')) as unknown as Profile[]
}

export async function updateProfile(
  id: string,
  patch: Partial<
    Pick<
      Profile,
      | 'role'
      | 'is_active'
      | 'hub_code'
      | 'dept_code'
      | 'sub_dept'
      | 'can_assets'
      | 'can_dispatch'
      | 'extra_depts'
      | 'shift_start'
      | 'shift_end'
    >
  >,
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
  deptCode: string
  role: UserRole
  password: string
  subDept?: string | null
  canAssets?: boolean
  canDispatch?: boolean
  shiftStart?: string | null
  shiftEnd?: string | null
  extraDepts?: string[]
}) {
  return callFunction<{ ok: true; id: string; email: string }>(
    'admin-users',
    JSON.stringify({
      action: 'create',
      employee_code: args.employeeCode.trim(),
      full_name: args.fullName.trim(),
      hub_code: 'BPL',
      dept_code: args.deptCode,
      role: args.role,
      password: args.password,
      sub_dept: args.subDept ?? null,
      can_assets: args.canAssets ?? true,
      can_dispatch: args.canDispatch ?? false,
      shift_start: args.shiftStart ?? null,
      shift_end: args.shiftEnd ?? null,
      extra_depts: args.extraDepts ?? [],
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
  dept_code: string | null
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
  // แก้ของเดิมต้อง update ตาม id ตรง ๆ
  // เดิมใช้ upsert โดยชน sku ซึ่งพังทันทีที่แก้ sku ของรายการเดิม —
  // sku ใหม่ไม่ชนกับใคร มันเลยพยายาม insert แถวใหม่ทั้งที่มี id เดิมติดไปด้วย
  if (draft.id) {
    const { id, ...patch } = draft
    const { error } = await supabase.from('items').update(patch).eq('id', id)
    if (error) throw new Error(readableError(error))
    return
  }

  const { id: _drop, ...fresh } = draft
  const { error } = await supabase.from('items').insert(fresh)
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
  kind: 'requisition' | 'return' | 'asset_out' | 'asset_in'
  source_id: string
  ref_no: string
  created_at: string
  hub_code: string
  file_id: string
  web_link: string | null
  archived: boolean
  who: string
  employee_code: string
  dept_code: string | null
  sub_dept: string | null
  asset_type_code: string | null
  shift_start: string | null
  shift_end: string | null
  has_returnable: boolean
  summary: string
  item_ids: number[]
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
  /** 'all' | 'requisition' | 'return' | 'asset_out' | 'asset_in' | 'supply' | 'asset' */
  kind?: string
  fromISO?: string
  toISO?: string
  /** กรองรายกะ — ส่งเวลาเข้ากะกับเลิกกะเป็นคู่ */
  shift?: { start: string; end: string } | null
  /** ตัวเลือกจากดรอปดาวน์ของ — 'i:<id>' วัสดุรายชิ้น หรือ 't:<code>' ประเภทเครื่อง */
  pick?: string | null
  limit?: number
}): Promise<EvidenceRow[]> {
  let q = supabase.from('evidence_feed').select('*').order('created_at', { ascending: false })
  if (opts.returnableOnly) q = q.eq('has_returnable', true)
  if (!opts.includeArchived) q = q.eq('archived', false)
  if (opts.kind === 'supply') q = q.in('kind', ['requisition', 'return'])
  else if (opts.kind === 'asset') q = q.in('kind', ['asset_out', 'asset_in'])
  else if (opts.kind && opts.kind !== 'all') q = q.eq('kind', opts.kind)
  if (opts.fromISO) q = q.gte('created_at', opts.fromISO)
  if (opts.toISO) q = q.lte('created_at', opts.toISO)
  if (opts.shift) q = q.eq('shift_start', opts.shift.start).eq('shift_end', opts.shift.end)
  if (opts.pick?.startsWith('i:')) q = q.contains('item_ids', [Number(opts.pick.slice(2))])
  else if (opts.pick?.startsWith('t:')) q = q.eq('asset_type_code', opts.pick.slice(2))
  return unwrap(await q.limit(opts.limit ?? 500)) as unknown as EvidenceRow[]
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

/**
 * บรรทัดที่ส่งเข้าชีตได้ในช่วงวันที่เลือก
 * กรอง "ยังไม่ส่ง" ที่ฐานข้อมูล ไม่ใช่ดึงมาทั้งเดือนแล้วค่อยคัดในเบราว์เซอร์
 */
export async function listSheetExportRows(args: {
  fromISO: string
  toISO: string
  dept?: string
  onlyPending?: boolean
  limit?: number
}): Promise<SheetExportRow[]> {
  let q = supabase
    .from('sheet_export_rows')
    .select('*')
    .gte('created_at', args.fromISO)
    .lte('created_at', args.toISO)
    .order('created_at', { ascending: false })
    .limit(args.limit ?? 500)
  if (args.dept) q = q.eq('requester_dept', args.dept)
  if (args.onlyPending) q = q.is('tab', null)
  return unwrap(await q) as unknown as SheetExportRow[]
}

/** นับว่าส่งแล้วกี่บรรทัด ยังไม่ส่งกี่บรรทัด โดยไม่ต้องดึงข้อมูลจริงมา */
export async function countSheetExportRows(args: {
  fromISO: string
  toISO: string
  dept?: string
}): Promise<{ pending: number; done: number }> {
  const base = () => {
    let q = supabase
      .from('sheet_export_rows')
      .select('line_id', { count: 'exact', head: true })
      .gte('created_at', args.fromISO)
      .lte('created_at', args.toISO)
    if (args.dept) q = q.eq('requester_dept', args.dept)
    return q
  }
  const [pending, done] = await Promise.all([
    base().is('tab', null),
    base().not('tab', 'is', null),
  ])
  if (pending.error) throw new Error(readableError(pending.error))
  if (done.error) throw new Error(readableError(done.error))
  return { pending: pending.count ?? 0, done: done.count ?? 0 }
}

/* ---------------------------------------------------------------- assets */

export async function listAssetTypes(): Promise<AssetType[]> {
  return unwrap(
    await supabase.from('asset_types').select('*').eq('is_active', true).order('sort_no'),
  ) as unknown as AssetType[]
}

export async function listAssetPhotoSteps(typeCode?: string): Promise<AssetPhotoStep[]> {
  let q = supabase.from('asset_photo_steps').select('*').order('seq')
  if (typeCode) q = q.eq('type_code', typeCode)
  return unwrap(await q) as unknown as AssetPhotoStep[]
}

/**
 * เครื่องที่ผู้ใช้คนนี้มองเห็น — RLS กรองตามแผนกให้แล้ว ไม่ต้องกรองซ้ำที่นี่
 * ทั้งฮับมี 139 เครื่อง ดึงมาทีเดียวถูกกว่าไล่ถามทีละประเภท
 */
export async function listAssets(typeCodes?: string | string[]): Promise<Asset[]> {
  const list = typeof typeCodes === 'string' ? [typeCodes] : typeCodes
  let q = supabase
    .from('assets')
    .select(
      'code,type_code,dept_code,share_depts,is_enabled,note,held_item_id,created_at,asset_types(code,name)',
    )
    .order('code')
  if (list && list.length > 0) q = q.in('type_code', list)
  return unwrap(await q) as unknown as Asset[]
}

export async function listAssetHoldings(mineOnly = false, userId?: string): Promise<AssetHolding[]> {
  let q = supabase.from('asset_holdings').select('*').order('taken_at')
  if (mineOnly && userId) q = q.eq('user_id', userId)
  return unwrap(await q) as unknown as AssetHolding[]
}

/** เครื่องที่เรากดเบิกให้คนอื่น — ดูอย่างเดียว คนคืนคือคนที่ถืออยู่จริง */
export async function listProxyHoldings(userId: string): Promise<AssetHolding[]> {
  return unwrap(
    await supabase.from('asset_holdings').select('*').eq('acted_by', userId).order('taken_at'),
  ) as unknown as AssetHolding[]
}

export async function listAssetOpenIssues(): Promise<AssetOpenIssue[]> {
  return unwrap(await supabase.from('asset_open_issues').select('*')) as unknown as AssetOpenIssue[]
}

/** ประวัติการแจ้งชำรุดของเครื่องหนึ่ง รวมที่เคลียร์ไปแล้ว */
export async function listAssetIssues(assetCode: string): Promise<AssetIssue[]> {
  return unwrap(
    await supabase
      .from('asset_issues')
      .select('*')
      .eq('asset_code', assetCode)
      .order('reported_at', { ascending: false }),
  ) as unknown as AssetIssue[]
}

export async function assetCheckout(args: {
  typeCode: string
  codes: string[]
  photos: AssetPhotoInput[]
  issues?: AssetIssueInput[]
  note?: string
  /** เบิกให้คนอื่น — ของจะไปค้างชื่อคนนี้ ไม่ใช่ชื่อคนกด */
  forUserId?: string | null
}) {
  const { data, error } = await supabase.rpc('asset_checkout', {
    p_type: args.typeCode,
    p_codes: args.codes,
    p_photos: args.photos,
    p_issues: args.issues ?? [],
    p_note: args.note ?? null,
    p_for_user: args.forUserId ?? null,
  })
  if (error) throw new Error(readableError(error))
  return data as {
    id: string
    ref_no: string
    due_at: string | null
    count: number
    for_name: string | null
  }
}

/* ------------------------------------------------- เบิกแทน และการโอนเครื่อง */

export interface ProxyTarget {
  id: string
  employee_code: string
  full_name: string
  dept_code: string | null
  sub_dept: string | null
  shift_start: string | null
  shift_end: string | null
}

/** รายชื่อคนที่เบิกแทนได้ — คืนว่างถ้าบัญชีนี้ไม่มีสิทธิ์ */
export async function listProxyTargets(q?: string): Promise<ProxyTarget[]> {
  const { data, error } = await supabase.rpc('proxy_targets', { p_q: q ?? null })
  if (error) throw new Error(readableError(error))
  return (data ?? []) as ProxyTarget[]
}

/** โอนเครื่องให้แผนกอื่น — ปลายทางต้องไปกดเบิกเองตามขั้นตอน */
export async function assetTransfer(code: string, toDept: string, reason?: string) {
  const { data, error } = await supabase.rpc('asset_transfer', {
    p_code: code,
    p_to_dept: toDept,
    p_reason: reason ?? null,
  })
  if (error) throw new Error(readableError(error))
  return data as { id: number; asset_code: string; to_dept: string; cut_from: string | null }
}

/** ต้นทางกดรับทราบว่าไม่ต้องตามคืนเครื่องนั้นแล้ว */
export async function ackTransfer(id: number) {
  const { error } = await supabase.rpc('asset_transfer_ack', { p_id: id })
  if (error) throw new Error(readableError(error))
}

/** ยกเลิกการโอนที่ปลายทางยังไม่ได้รับ */
export async function cancelTransfer(id: number) {
  const { error } = await supabase.rpc('asset_transfer_cancel', { p_id: id })
  if (error) throw new Error(readableError(error))
}

/** แถบเตือนเรื่องการโอนที่ยังค้าง ทั้งฝั่งรับและฝั่งถูกตัด */
export async function listTransferNotices(): Promise<TransferNotice[]> {
  const { data, error } = await supabase
    .from('asset_transfer_notices')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw new Error(readableError(error))
  return (data ?? []) as TransferNotice[]
}

export async function assetReturn(args: {
  codes: string[]
  photos: AssetPhotoInput[]
  issues?: AssetIssueInput[]
  note?: string
}) {
  const { data, error } = await supabase.rpc('asset_return', {
    p_codes: args.codes,
    p_photos: args.photos,
    p_issues: args.issues ?? [],
    p_note: args.note ?? null,
  })
  if (error) throw new Error(readableError(error))
  return data as { id: string; ref_no: string; count: number }
}

export async function setAssetEnabled(code: string, on: boolean) {
  const { error } = await supabase.rpc('set_asset_enabled', { p_code: code, p_on: on })
  if (error) throw new Error(readableError(error))
}

export async function resolveAssetIssue(id: number, note?: string) {
  const { error } = await supabase.rpc('resolve_asset_issue', { p_id: id, p_note: note ?? null })
  if (error) throw new Error(readableError(error))
}

export async function resolveAssetIssuesFor(code: string, note?: string) {
  const { data, error } = await supabase.rpc('resolve_asset_issues_for', {
    p_code: code,
    p_note: note ?? null,
  })
  if (error) throw new Error(readableError(error))
  return data as number
}

/**
 * ลบวัสดุ — คืน 'deleted' ถ้าลบสนิท หรือ 'archived' ถ้าเคยถูกเบิกแล้ว
 * จึงได้แค่ปิดการใช้งานเพื่อไม่ให้ประวัติการเบิกพัง
 */
export async function deleteItem(id: number): Promise<'deleted' | 'archived'> {
  const { data, error } = await supabase.rpc('delete_item', { p_id: id })
  if (error) throw new Error(readableError(error))
  return data as 'deleted' | 'archived'
}

/** กะที่มีพนักงานใช้อยู่จริง ใช้ทำดรอปดาวน์กรอง */
export interface ShiftOption {
  shift_start: string
  shift_end: string
  label: string
  staff_count: number
}

export async function listShiftsInUse(): Promise<ShiftOption[]> {
  return unwrap(await supabase.from('shifts_in_use').select('*')) as unknown as ShiftOption[]
}

/** ย้ายเครื่องไปแผนกอื่น และตั้งว่าแผนกไหนใช้ร่วมได้บ้าง */
export async function setAssetDepts(code: string, dept: string | null, shares: string[]) {
  const { error } = await supabase.rpc('set_asset_depts', {
    p_code: code,
    p_dept: dept,
    p_shares: shares,
  })
  if (error) throw new Error(readableError(error))
}

/** วัสดุที่มีหลักฐานอยู่จริง ใช้ทำดรอปดาวน์เลือกดูเฉพาะของชิ้นนั้น */
export interface EvidenceItemOption {
  key: string
  name: string
  sub: string
  kind: 'supply' | 'asset'
  photo_rows: number
}

export async function listEvidenceItems(): Promise<EvidenceItemOption[]> {
  return unwrap(await supabase.from('evidence_items').select('*')) as unknown as EvidenceItemOption[]
}

/** นับบรรทัด Asset ที่ยังไม่ได้ส่งเข้าชีต */
export async function countAssetExportRows(args: {
  fromISO: string
  toISO: string
}): Promise<{ pending: number; done: number }> {
  const base = () =>
    supabase
      .from('asset_export_rows')
      .select('line_id', { count: 'exact', head: true })
      .gte('created_at', args.fromISO)
      .lte('created_at', args.toISO)
  const [pending, done] = await Promise.all([
    base().is('tab', null),
    base().not('tab', 'is', null),
  ])
  if (pending.error) throw new Error(readableError(pending.error))
  if (done.error) throw new Error(readableError(done.error))
  return { pending: pending.count ?? 0, done: done.count ?? 0 }
}

/* --------------------------------------------------------- แจ้งเตือนมือถือ */

export async function pushSubscribe(subscription: {
  endpoint: string
  keys: { p256dh: string; auth: string }
}) {
  return callFunction<{ ok: true }>(
    'push-sent',
    JSON.stringify({ action: 'subscribe', subscription }),
    { 'Content-Type': 'application/json' },
  )
}

export async function pushUnsubscribe(endpoint: string) {
  return callFunction<{ ok: true }>(
    'push-sent',
    JSON.stringify({ action: 'unsubscribe', subscription: { endpoint } }),
    { 'Content-Type': 'application/json' },
  )
}

export async function pushTest() {
  return callFunction<{ ok: true; sent: number; errors: string[] }>(
    'push-sent',
    JSON.stringify({ action: 'test' }),
    { 'Content-Type': 'application/json' },
  )
}

/* ------------------------------------------------------- บาร์โค้ดจาก BY */

export async function listByRows(opts: {
  status?: ByStatus | 'all'
  mineOnly?: boolean
  userId?: string
  fromISO?: string
  toISO?: string
  limit?: number
}): Promise<ByRow[]> {
  let q = supabase.from('by_feed').select('*').order('created_at', { ascending: false })
  if (opts.status && opts.status !== 'all') q = q.eq('status', opts.status)
  if (opts.mineOnly && opts.userId) q = q.eq('user_id', opts.userId)
  if (opts.fromISO) q = q.gte('created_at', opts.fromISO)
  if (opts.toISO) q = q.lte('created_at', opts.toISO)
  return unwrap(await q.limit(opts.limit ?? 300)) as unknown as ByRow[]
}

export async function createByBarcode(args: {
  reason: string
  note?: string
  photos: { file_id: string; web_link: string | null; bytes: number | null }[]
}) {
  const { data, error } = await supabase.rpc('create_by_barcode', {
    p_reason: args.reason,
    p_note: args.note ?? null,
    p_photos: args.photos,
  })
  if (error) throw new Error(readableError(error))
  return data as { id: string; ref_no: string; photos: number }
}

export async function setByStatus(
  id: string,
  status: ByStatus,
  opts: { note?: string; itemId?: number | null; qty?: number | null; cutStock?: boolean } = {},
) {
  const { error } = await supabase.rpc('set_by_status', {
    p_id: id,
    p_status: status,
    p_note: opts.note ?? null,
    p_item_id: opts.itemId ?? null,
    p_qty: opts.qty ?? null,
    p_cut_stock: opts.cutStock ?? false,
  })
  if (error) throw new Error(readableError(error))
}

export async function listByStats(): Promise<ByStatRow[]> {
  return unwrap(
    await supabase.from('by_stats_monthly').select('*').order('ym', { ascending: false }),
  ) as unknown as ByStatRow[]
}

/* ------------------------------------------------- ข้อมูลสรุปหน้าภาพรวม */

/** หนึ่งแถวต่อหนึ่งเครื่องต่อหนึ่งครั้งที่เบิกหรือคืน ใช้นับความเคลื่อนไหวของ Asset */
export interface AssetLine {
  id: number
  asset_code: string
  asset_txns: { kind: AssetTxnKind; created_at: string; type_code: string } | null
}

export async function listAssetLinesBetween(fromISO: string, toISO: string): Promise<AssetLine[]> {
  return unwrap(
    await supabase
      .from('asset_txn_items')
      .select('id,asset_code,asset_txns!inner(kind,created_at,type_code)')
      .gte('asset_txns.created_at', fromISO)
      .lte('asset_txns.created_at', toISO)
      .limit(5000),
  ) as unknown as AssetLine[]
}

/** ของที่คืนมาแล้วไม่ปกติ — ชำรุดหรือสูญหาย */
export interface BadReturn {
  id: number
  qty: number
  condition: ReturnCond
  created_at: string
  profiles: { full_name: string; employee_code: string } | null
  requisition_items: { items: { name: string; unit: string } | null } | null
}

export async function listBadReturns(fromISO: string, toISO: string): Promise<BadReturn[]> {
  return unwrap(
    await supabase
      .from('returns')
      .select(
        'id,qty,condition,created_at,profiles(full_name,employee_code),requisition_items(items(name,unit))',
      )
      .neq('condition', 'ok')
      .gte('created_at', fromISO)
      .lte('created_at', toISO)
      .order('created_at', { ascending: false })
      .limit(50),
  ) as unknown as BadReturn[]
}

/** ใบแจ้งชำรุดที่ยังไม่ได้เคลียร์ เรียงใหม่สุดก่อน */
export async function listOpenAssetIssues(limit = 50): Promise<AssetIssue[]> {
  return unwrap(
    await supabase
      .from('asset_issues')
      .select('*')
      .is('resolved_at', null)
      .order('reported_at', { ascending: false })
      .limit(limit),
  ) as unknown as AssetIssue[]
}

/** ใบแจ้งชำรุดในช่วงวันที่ — ใช้ทำรายงานสถิติการพัง */
export async function listAssetIssuesBetween(fromISO: string, toISO: string): Promise<AssetIssue[]> {
  return unwrap(
    await supabase
      .from('asset_issues')
      .select('*')
      .gte('reported_at', fromISO)
      .lte('reported_at', toISO)
      .order('reported_at', { ascending: false })
      .limit(2000),
  ) as unknown as AssetIssue[]
}

/** ประวัติการเบิก-คืนเครื่อง — รวมที่คืนไปแล้วด้วย */
export async function listAssetHistory(args: {
  fromISO?: string
  toISO?: string
  userId?: string
  limit?: number
}): Promise<AssetHistoryRow[]> {
  let q = supabase.from('asset_history').select('*').order('taken_at', { ascending: false })
  if (args.fromISO) q = q.gte('taken_at', args.fromISO)
  if (args.toISO) q = q.lte('taken_at', args.toISO)
  if (args.userId) q = q.eq('user_id', args.userId)
  return unwrap(await q.limit(args.limit ?? 500)) as unknown as AssetHistoryRow[]
}

/* ------------------------------------------------------ เช็คอินเข้าประชุม */

/**
 * เช็คอินเข้าประชุม — ส่งแค่รูปเซลฟี่
 *
 * ชื่อ เวลา แผนก กะ ฐานข้อมูลเติมให้เองจากโปรไฟล์และ now() ของเซิร์ฟเวอร์
 * ไม่ส่งเวลาจากเครื่องขึ้นไป เพราะนาฬิกามือถือตั้งเองได้
 *
 * กดซ้ำภายใน 10 นาทีจะได้ใบเดิมกลับมาพร้อม duplicate = true
 * ไม่ใช่ error เพราะสิ่งที่ผู้ใช้ต้องการคือ "เช็คอินแล้ว" ซึ่งเป็นจริง
 */
export async function meetingCheckin(args: {
  fileId: string
  webLink?: string | null
  bytes?: number | null
  note?: string | null
}) {
  const { data, error } = await supabase.rpc('meeting_checkin', {
    p_file_id: args.fileId,
    p_web_link: args.webLink ?? null,
    p_bytes: args.bytes ?? null,
    p_note: args.note ?? null,
  })
  if (error) throw new Error(readableError(error))
  return data as { id: string; ref_no: string; created_at: string; duplicate: boolean }
}

/** ประวัติเช็คอินของตัวเอง */
export async function listMyMeetings(limit = 30): Promise<MeetingRow[]> {
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth.user?.id
  if (!uid) return []
  return unwrap(
    await supabase
      .from('meeting_rows')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(limit),
  ) as unknown as MeetingRow[]
}

/** รายชื่อประชุมสำหรับหน้าตรวจสอบ — กรองด้วยวันตามเวลาไทย */
export async function listMeetings(opts: {
  fromDay?: string
  toDay?: string
  status?: MeetingStatus | ''
} = {}): Promise<MeetingRow[]> {
  let q = supabase.from('meeting_rows').select('*').order('created_at', { ascending: false })
  if (opts.fromDay) q = q.gte('day', opts.fromDay)
  if (opts.toDay) q = q.lte('day', opts.toDay)
  if (opts.status) q = q.eq('status', opts.status)
  return unwrap(await q) as unknown as MeetingRow[]
}

/** วันที่ที่มีคนเช็คอิน — ใช้ทำดรอปดาวน์เลือกวัน */
export async function listMeetingDays(limit = 400): Promise<string[]> {
  const { data, error } = await supabase
    .from('meeting_rows')
    .select('day')
    .order('day', { ascending: false })
    .limit(limit)
  if (error) throw new Error(readableError(error))
  return [...new Set(((data ?? []) as { day: string }[]).map((r) => r.day))]
}

/** ยืนยันหรือตีตกหลายรายการในครั้งเดียว */
export async function setMeetingStatus(ids: string[], status: MeetingStatus, note?: string) {
  const { data, error } = await supabase.rpc('set_meeting_status', {
    p_ids: ids,
    p_status: status,
    p_note: note ?? null,
  })
  if (error) throw new Error(readableError(error))
  return (data as number) ?? 0
}

/** สรุปรายคนว่าเข้าประชุมกี่ครั้งในช่วงที่เลือก */
export async function meetingStats(fromDay: string, toDay: string): Promise<MeetingStat[]> {
  const { data, error } = await supabase.rpc('meeting_stats', { p_from: fromDay, p_to: toDay })
  if (error) throw new Error(readableError(error))
  return (data ?? []) as MeetingStat[]
}

/* ------------------------------------------------- คิวรีแบบประหยัด egress */

/**
 * คอลัมน์เท่าที่หน้าจอใช้จริง
 *
 * REQ_COLS ตัวเต็มพ่วง items ครบทุกช่อง โปรไฟล์ และ sync_log มาด้วย
 * วัดจากของจริงได้ใบละ ~1.8 KB — พอคนเพิ่มเป็นสามเท่า เดือนละ ~650 ใบ
 * แค่เปิดหน้าแรกครั้งเดียวก็ 1.2 MB ทั้งที่หน้านั้นใช้แค่ชื่อกับจำนวนรายการ
 */
const REQ_SLIM =
  'id,ref_no,status,created_at,requester_id,' +
  'profiles!requisitions_requester_id_fkey(id,full_name,employee_code,dept_code),' +
  'requisition_items(id)'

/** ใบเบิกล่าสุดไม่กี่ใบ สำหรับตารางบนหน้าแรก */
export async function listRecentRequisitions(limit = 12): Promise<Requisition[]> {
  return unwrap(
    await supabase
      .from('requisitions')
      .select(REQ_SLIM)
      .order('created_at', { ascending: false })
      .limit(limit),
  ) as unknown as Requisition[]
}

/** ใบที่ยังรออนุมัติ — มีไม่เยอะโดยธรรมชาติ เพราะกดอนุมัติแล้วหลุดออกจากชุดนี้ */
export async function listPendingSlim(): Promise<Requisition[]> {
  return unwrap(
    await supabase
      .from('requisitions')
      .select(REQ_SLIM)
      .eq('status', 'pending')
      .order('created_at', { ascending: true }),
  ) as unknown as Requisition[]
}

/**
 * ตัวเลขสำหรับกระดิ่ง — นับอย่างเดียว ไม่ดึงข้อมูลจริง
 *
 * กระดิ่งถามซ้ำทุก 45 วินาทีตลอดเวลาที่เปิดแอพค้างไว้
 * ถ้าดึงแถวจริงมาทุกรอบ วันหนึ่งกินหลายสิบเมกะไบต์ต่อคน
 * แถวจริงค่อยดึงตอนกดเปิดกระดิ่ง ซึ่งนาน ๆ ครั้ง
 */
export async function bellCounts(): Promise<{ by: number; faults: number; late: number }> {
  const nowISO = new Date().toISOString()
  const [by, faults, late] = await Promise.all([
    supabase.from('by_barcodes').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('asset_open_issues').select('asset_code', { count: 'exact', head: true }),
    supabase.from('asset_holdings').select('out_item_id', { count: 'exact', head: true }).lt('due_at', nowISO),
  ])
  return { by: by.count ?? 0, faults: faults.count ?? 0, late: late.count ?? 0 }
}

/**
 * ประวัติการเบิกสำหรับหน้าตรวจสอบ — เอาเฉพาะช่องที่หน้านั้นโชว์จริง
 *
 * ตัด sync_log กับช่องสต็อกของ items ออก ซึ่งหน้านี้ไม่ได้ใช้เลย
 * เหลือราวหนึ่งในสามของขนาดเดิมต่อหนึ่งใบ
 */
export async function listRequisitionHistory(
  fromISO: string,
  toISO: string,
  limit = 400,
): Promise<Requisition[]> {
  return unwrap(
    await supabase
      .from('requisitions')
      .select(
        'id,ref_no,status,created_at,requester_id,' +
          'profiles!requisitions_requester_id_fkey(id,full_name,employee_code,dept_code),' +
          'requisition_items(id,item_id,qty_requested,qty_approved,status,items(name,unit))',
      )
      .gte('created_at', fromISO)
      .lte('created_at', toISO)
      .order('created_at', { ascending: false })
      .limit(limit),
  ) as unknown as Requisition[]
}
