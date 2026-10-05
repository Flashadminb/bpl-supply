import { supabase, functionUrl, readableError, emailFromEmployeeCode } from './supabase'
import type {
  AssetGrantRow,
  AssetIssueRow,
  AssetTransferRow,
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
  AssetExportRow,
  BorrowSet,
  ReturnCard,
  SackRow,
  SackBranch,
  SackRelay,
  SackNotifyTarget,
  OsPerson,
  OsImportRow,
  OsScanHit,
  OsScanRow,
  TransferNotice,
  LinkAudience,
  LinkRoleKey,
  SystemHealth,
  WorkLink,
  WorkLinkFull,
  TransferTargetRow,
  MeetingRow,
  MeetingStat,
  MeetingStatus,
  MeetingEvent,
  MeetingWindow,
  AttendState,
  RosterRow,
  MeetingSummary,
  IssueRow,
  Announcement,
  NoticeLevel,
  HistoryNote,
} from './types'

const ITEM_COLS =
  'id,sku,name,category_id,hub_code,unit,shelf_code,qty_on_hand,min_qty,is_returnable,requires_approval,view_only,view_only_note,dept_code,image_path,qr_payload,is_active,updated_at,categories(id,name,auto_approvable)'

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
  /** เบิกให้คนอื่น — ของจะไปค้างชื่อคนนี้ ไม่ใช่ชื่อคนกด */
  forUserId?: string | null
}): Promise<CreateReqResult> {
  const { data, error } = await supabase.rpc('create_requisition', {
    p_lines: args.lines.map((l) => ({ item_id: l.item_id, qty: l.qty })),
    p_purpose: args.purpose || null,
    p_note: args.note || null,
    p_evidence_file_id: args.evidenceFileId ?? null,
    p_evidence_link: args.evidenceLink ?? null,
    p_evidence_bytes: args.evidenceBytes ?? null,
    p_for_user: args.forUserId ?? null,
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

/**
 * คืนหลายรายการในครั้งเดียว — รูปชุดเดียวกันติดไปทุกบรรทัด
 * ตอนเลิกกะของกองอยู่ตรงหน้าชุดเดียว ไม่มีเหตุผลต้องถ่ายซ้ำทีละรายการ
 */
export async function createReturnMany(args: {
  lines: { line_id: number; qty: number }[]
  condition: ReturnCond
  photos: { file_id: string; web_link: string | null; bytes: number | null }[]
}) {
  const { data, error } = await supabase.rpc('create_return_many', {
    p_lines: args.lines,
    p_condition: args.condition,
    p_photos: args.photos,
  })
  if (error) throw new Error(readableError(error))
  return data as { lines: number; units: number }
}

/**
 * ชุดเบิก-คืน — หนึ่งแถวคือหนึ่งรายการที่เบิกออกไป พร้อมการคืนทุกครั้งของมัน
 * ค่าเริ่มต้นเอาเฉพาะของยืม-คืน เพราะของใช้แล้วหมดไปไม่มีสถานะให้ตาม
 */
export async function listBorrowSets(args: {
  fromISO?: string
  toISO?: string
  returnableOnly?: boolean
  limit?: number
}): Promise<BorrowSet[]> {
  let q = supabase.from('borrow_sets').select('*').order('taken_at', { ascending: false })
  if (args.fromISO) q = q.gte('taken_at', args.fromISO)
  if (args.toISO) q = q.lte('taken_at', args.toISO)
  if (args.returnableOnly !== false) q = q.eq('is_returnable', true)
  return unwrap(await q.limit(args.limit ?? 600)) as unknown as BorrowSet[]
}

/** การ์ดชุดเบิก-คืน — หนึ่งใบเบิกคือหนึ่งการ์ด พร้อมรายการและการคืนครบในตัว */
export async function listReturnCards(args: {
  kind?: 'supply' | 'asset'
  fromISO?: string
  toISO?: string
  limit?: number
}): Promise<ReturnCard[]> {
  let q = supabase.from('return_cards').select('*').order('taken_at', { ascending: false })
  if (args.kind) q = q.eq('kind', args.kind)
  if (args.fromISO) q = q.gte('taken_at', args.fromISO)
  if (args.toISO) q = q.lte('taken_at', args.toISO)
  return unwrap(await q.limit(args.limit ?? 300)) as unknown as ReturnCard[]
}

/* ------------------------------------------- ลบของ และประวัติตัวหนังสือ */

/**
 * ประวัติแบบตัวหนังสือของสิ่งที่ถูกลบไป
 *
 * ของที่ลบทุกชิ้นถูกย่อเป็นข้อความเก็บไว้ก่อนเสมอ พร้อมลิงก์ไดร์ฟของรูป
 * อ่านย้อนหลังได้โดยไม่ต้องโหลดรูปสักใบ ซึ่งเร็วกว่ามากและไม่กินโควตา
 */
export async function listHistoryNotes(args: {
  kind?: 'issue' | 'asset' | 'supply' | 'break'
  fromISO?: string
  toISO?: string
  limit?: number
}): Promise<HistoryNote[]> {
  let q = supabase
    .from('history_notes')
    .select('*')
    .order('happened_at', { ascending: false, nullsFirst: false })
  if (args.kind) q = q.eq('kind', args.kind)
  if (args.fromISO) q = q.gte('happened_at', args.fromISO)
  if (args.toISO) q = q.lte('happened_at', args.toISO)
  return unwrap(await q.limit(args.limit ?? 300)) as unknown as HistoryNote[]
}

/** ลบใบแจ้งชำรุด · ย่อเป็นข้อความเก็บไว้ก่อนลบเสมอ */
export async function deleteAssetIssues(ids: number[], why?: string): Promise<number> {
  const { data, error } = await supabase.rpc('asset_issues_delete', {
    p_ids: ids,
    p_why: why?.trim() || null,
  })
  if (error) throw new Error(readableError(error))
  return (data ?? 0) as number
}

/** ลบใบเบิก/คืนเครื่อง · ฐานข้อมูลคืนสถานะเครื่องให้ตรงกับความจริงให้เอง */
export async function deleteAssetTxns(ids: string[], why?: string): Promise<number> {
  const { data, error } = await supabase.rpc('asset_txns_delete', {
    p_ids: ids,
    p_why: why?.trim() || null,
  })
  if (error) throw new Error(readableError(error))
  return (data ?? 0) as number
}

/** ลบใบเบิกวัสดุ · สต็อกที่ตัดไปจะถูกบวกคืนพร้อมบรรทัดอธิบาย */
export async function deleteRequisitions(ids: string[], why?: string): Promise<number> {
  const { data, error } = await supabase.rpc('requisitions_delete', {
    p_ids: ids,
    p_why: why?.trim() || null,
  })
  if (error) throw new Error(readableError(error))
  return (data ?? 0) as number
}

/** ไม่ส่งบรรทัดนี้ลงชีต · ใบเบิกยังอยู่ครบ แค่หลุดจากคิวรอส่ง */
export async function skipExportLines(
  kind: 'supply' | 'asset',
  ids: number[],
  skip = true,
): Promise<number> {
  const { data, error } = await supabase.rpc('export_line_skip', {
    p_kind: kind,
    p_ids: ids,
    p_skip: skip,
  })
  if (error) throw new Error(readableError(error))
  return (data ?? 0) as number
}

/* ------------------------------------------------- สแกนอันเดียวจบ */

export interface GuardScanHit {
  kind: 'break' | 'os' | 'unknown'
  code: string
  /** มีเฉพาะตอน kind = 'break' · ผลเดียวกับที่หน้ากระดานเบรคใช้อยู่ */
  scan?: unknown
}

/**
 * โค้ดที่เพิ่งสแกนคือบัตรอะไร
 *
 * ฐานข้อมูลตัดสินจากการถามว่ามีอยู่จริงไหม ไม่ได้เดาจากหน้าตาของโค้ด
 * และตั้งใจไม่เรียก os_scan ให้ เพราะ os_scan บันทึกประวัติทุกครั้งที่เรียก
 * หน้าจอจึงไปเรียกเองตอนที่ตั้งใจจะสแกนจริงเท่านั้น
 */
export async function guardScan(code: string): Promise<GuardScanHit> {
  const { data, error } = await supabase.rpc('guard_scan', { p_code: code })
  if (error) throw new Error(readableError(error))
  return data as GuardScanHit
}

/** ออกบัตร OS ใหม่ให้ทุกคนที่ยังใช้โค้ดรุ่นเก่า · ใบที่ปริ้นไปแล้วใช้ไม่ได้ทันที */
export async function reissueOldOsCards(): Promise<{ reissued: number }> {
  const { data, error } = await supabase.rpc('os_reissue_old_tokens')
  if (error) throw new Error(readableError(error))
  return (data ?? { reissued: 0 }) as { reissued: number }
}

/* ------------------------------------------------------- สถานะระบบ */

/** โควตาแผนฟรีเหลือเท่าไหร่ — แอดมินและผู้ตรวจสอบเรียกได้ */
export async function systemHealth(): Promise<SystemHealth> {
  const { data, error } = await supabase.rpc('system_health')
  if (error) throw new Error(readableError(error))
  return data as unknown as SystemHealth
}

/* ---------------------------------------------------------- ลิงก์งาน */

/** ลิงก์ที่กดเปิดได้ — เรียงตามลำดับที่เจ้าของระบบตั้งไว้ */
export async function listWorkLinks(all = false): Promise<WorkLink[]> {
  let q = supabase.from('work_links').select('*').order('sort_no').order('id')
  if (!all) q = q.eq('is_active', true)
  return unwrap(await q) as unknown as WorkLink[]
}

/**
 * ลิงก์พร้อมรายชื่อผู้ชม — หน้าจัดการของเจ้าของระบบเท่านั้น
 *
 * ตารางเชื่อมเปิดให้เจ้าของระบบอ่านอย่างเดียว คนอื่นเรียกแล้วจะได้ลิสต์ว่าง
 * ซึ่งถูกแล้ว เพราะการกรองว่าใครเห็นลิงก์ไหนเกิดที่ RLS ของ work_links
 */
export async function listWorkLinksFull(): Promise<WorkLinkFull[]> {
  const rows = unwrap(
    await supabase
      .from('work_links')
      .select(
        '*, work_link_roles(role_key), work_link_depts(dept_code), work_link_users(user_id)',
      )
      .order('sort_no')
      .order('id'),
  ) as unknown as (WorkLink & {
    work_link_roles: { role_key: LinkRoleKey }[]
    work_link_depts: { dept_code: string }[]
    work_link_users: { user_id: string }[]
  })[]

  return rows.map(({ work_link_roles, work_link_depts, work_link_users, ...l }) => ({
    ...l,
    role_keys: (work_link_roles ?? []).map((r) => r.role_key),
    dept_codes: (work_link_depts ?? []).map((d) => d.dept_code),
    user_ids: (work_link_users ?? []).map((u) => u.user_id),
  }))
}

export async function saveWorkLink(row: {
  id?: number
  title: string
  url: string
  note?: string | null
  sort_no?: number
  is_active?: boolean
  audience?: LinkAudience
  role_keys?: LinkRoleKey[]
  dept_codes?: string[]
  user_ids?: string[]
}) {
  const custom = row.audience === 'custom'
  // บันทึกลิงก์กับรายชื่อผู้ชมในคำสั่งเดียว เน็ตหลุดกลางคันแล้วไม่ค้างครึ่ง ๆ
  const { error } = await supabase.rpc('save_work_link', {
    p_id: row.id ?? null,
    p_title: row.title.trim(),
    p_url: row.url.trim(),
    p_note: row.note?.trim() || null,
    p_sort_no: row.sort_no ?? 0,
    p_is_active: row.is_active ?? true,
    p_audience: row.audience ?? 'custom',
    p_roles: custom ? (row.role_keys ?? []) : [],
    p_depts: custom ? (row.dept_codes ?? []) : [],
    p_users: custom ? (row.user_ids ?? []) : [],
  })
  if (error) throw new Error(readableError(error))
}

export async function deleteWorkLink(id: number) {
  const { error } = await supabase.from('work_links').delete().eq('id', id)
  if (error) throw new Error(readableError(error))
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
      | 'can_sack'
      | 'can_proxy'
      | 'can_dispatch'
      | 'can_guard'
      | 'can_break_issue'
      | 'can_break_guard'
      | 'can_break_ban'
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
  canGuard?: boolean
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
      can_guard: args.canGuard ?? false,
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
  view_only: boolean
  view_only_note: string | null
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

/**
 * เรียก Edge Function พร้อมกู้เซสชันให้เองหนึ่งครั้ง
 *
 * Edge Function ตรวจโทเคนกับ /auth/v1/user ซึ่งเข้มกว่าที่ PostgREST ตรวจ
 * PostgREST ดูแค่ลายเซ็นกับวันหมดอายุ แต่ฝั่งนี้ถามจริงว่าเซสชันยังอยู่ไหม
 * ผลคือแอพใช้งานได้ปกติทุกอย่าง แต่พอแตะฟังก์ชันทีไรเด้ง "เซสชันหมดอายุ"
 * ซึ่งหน้างานอ่านแล้วไม่รู้จะทำยังไงต่อ
 *
 * เจอ 401/403 ให้ต่ออายุโทเคนแล้วยิงซ้ำหนึ่งรอบ ส่วนใหญ่จบตรงนี้เงียบ ๆ
 * ถ้าต่ออายุไม่ผ่านแปลว่าเซสชันตายจริง ล้างเฉพาะในเครื่องแล้วให้เด้งไปหน้าล็อกอิน
 *
 * ต้องเป็น scope local เท่านั้น ถ้าเผลอใช้ signOut แบบ global
 * จะไปเตะเครื่องอื่นของคนคนเดียวกันหลุดตามไปด้วย ซึ่งเคยทำพังมาแล้ว
 */
async function callFunction<T>(
  name: string,
  body: BodyInit,
  headers: Record<string, string> = {},
  mayRetry = true,
): Promise<T> {
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

  if ((res.status === 401 || res.status === 403) && mayRetry) {
    const again = await supabase.auth.refreshSession()
    if (!again.error && again.data.session) {
      return callFunction<T>(name, body, headers, false)
    }
    await supabase.auth.signOut({ scope: 'local' })
    throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่')
  }

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
/**
 * อัปโหลดรูปหลักฐาน พร้อมลองใหม่เองถ้าพลาด
 *
 * ตอนเปลี่ยนกะมีคนเบิกพร้อมกันหลายสิบคน แต่ละคนถ่ายหลายรูป
 * ช่วงนั้นรูปหล่นได้เป็นปกติ ทั้งจากเน็ตฮับที่ไม่นิ่งและจากปลายทางที่แน่น
 *
 * เดิมพลาดแล้วหยุดเลย รอคนกดเอง ซึ่งคนจะกดทันทีทั้งที่ระบบยังแน่นอยู่
 * กลายเป็นซ้ำเติมกันเองพอดี
 *
 * ลองเองสามครั้ง หน่วงเพิ่มขึ้นเรื่อย ๆ และสุ่มบวกนิดหน่อย
 * ที่ต้องสุ่มเพราะถ้าทุกเครื่องพลาดพร้อมกันแล้วรอเท่ากันเป๊ะ
 * มันจะกลับมาชนกันใหม่ตรงจังหวะเดิมทุกรอบ
 *
 * ปุ่มกดลองใหม่ยังอยู่ ไว้ใช้เมื่อสามครั้งแล้วยังไม่ผ่านจริง ๆ
 */
export async function uploadEvidence(
  blob: Blob,
  filename: string,
  /** โฟลเดอร์ปลายทางใน Drive · ไม่ส่งมา = โฟลเดอร์หลักเหมือนเดิม */
  kind?: 'evidence' | 'break',
) {
  const delays = [800, 2200, 5000]
  let last: unknown = null

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const fd = new FormData()
      fd.append('file', blob, filename)
      fd.append('filename', filename)
      if (kind) fd.append('kind', kind)
      return await callFunction<{ fileId: string; webViewLink: string; bytes: number }>(
        'upload-evidence',
        fd,
      )
    } catch (e) {
      last = e
      if (attempt === delays.length) break
      const wait = delays[attempt] + Math.floor(Math.random() * 600)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  throw last instanceof Error ? last : new Error('อัปโหลดรูปไม่สำเร็จ')
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
export async function fetchEvidenceImage(fileId: string, mayRetry = true): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const res = await fetch(`${functionUrl('evidence-image')}?fileId=${encodeURIComponent(fileId)}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
    },
  })

  // เส้นนี้ไม่ได้ผ่าน callFunction จึงต้องกู้เซสชันเองด้วยเหตุผลเดียวกัน
  if ((res.status === 401 || res.status === 403) && mayRetry) {
    const again = await supabase.auth.refreshSession()
    if (!again.error && again.data.session) return fetchEvidenceImage(fileId, false)
    await supabase.auth.signOut({ scope: 'local' })
    throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่')
  }

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
  /**
   * ว่าง = ส่งทุกชุด · 'sack' = เฉพาะกระสอบ ซึ่งลงคนละไฟล์กับของเบิก
   * 'osscan' = ประวัติสแกนบัตร OS ซึ่งไม่อยู่ใน 'all' เพราะโตวันละหลายร้อยแถว
   */
  scope?: 'all' | 'supply' | 'asset' | 'by' | 'meeting' | 'sack' | 'osscan' | 'break' | 'truck'
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
      'code,type_code,dept_code,share_depts,is_enabled,note,held_item_id,loan_user,created_at,asset_types(code,name)',
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

/** รายชื่อคนที่รับโอนเครื่องได้ — กรองคนที่เบิก Asset ไม่ได้ออกแล้ว */
export async function listTransferTargets(q?: string): Promise<TransferTargetRow[]> {
  const { data, error } = await supabase.rpc('transfer_targets', { p_q: q ?? null })
  if (error) throw new Error(readableError(error))
  return (data ?? []) as TransferTargetRow[]
}

/**
 * โอนเครื่องให้คนอื่นใช้ชั่วคราว — ปลายทางต้องไปกดเบิกเองตามขั้นตอน
 * เครื่องที่อยู่กับคนนั้นอยู่แล้วจะถูกข้าม ไม่ทำให้ทั้งชุดล้ม
 */
export async function assetTransferMany(codes: string[], toUserId: string, reason?: string) {
  const { data, error } = await supabase.rpc('asset_transfer_many', {
    p_codes: codes,
    p_to_user: toUserId,
    p_reason: reason ?? null,
  })
  if (error) throw new Error(readableError(error))
  return data as { to_user: string; to_name: string; moved: string[]; skipped: string[]; count: number }
}

/** นับเครื่องที่ยังไม่คืนทั้งฮับ — เอาแค่ตัวเลข ไม่ดึงแถวมาทั้งกอง */
export async function countAssetHoldings(): Promise<number> {
  const { count, error } = await supabase
    .from('asset_holdings')
    .select('out_item_id', { count: 'exact', head: true })
  if (error) throw new Error(readableError(error))
  return count ?? 0
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

/**
 * เบิกแบบตะกร้า — หลายประเภทในรอบเดียว
 * เบื้องหลังออกใบแยกตามประเภท เพราะจำนวนรูปบังคับไม่เท่ากัน
 */
export async function assetCheckoutMany(args: {
  groups: {
    type_code: string
    codes: string[]
    photos: AssetPhotoInput[]
    issues: AssetIssueInput[]
  }[]
  note?: string
  forUserId?: string | null
}) {
  const { data, error } = await supabase.rpc('asset_checkout_many', {
    p_groups: args.groups,
    p_note: args.note ?? null,
    p_for_user: args.forUserId ?? null,
  })
  if (error) throw new Error(readableError(error))
  return data as { ok: boolean; count: number; groups: number; ref_no: string; refs: string[] }
}

/** คืนแบบตะกร้า — หลายประเภทในรอบเดียว รูปแยกตามประเภท */
export async function assetReturnGroups(args: {
  groups: { type_code: string; codes: string[]; photos: AssetPhotoInput[]; issues: AssetIssueInput[] }[]
  note?: string
}) {
  const { data, error } = await supabase.rpc('asset_return_groups', {
    p_groups: args.groups,
    p_note: args.note ?? null,
  })
  if (error) throw new Error(readableError(error))
  return data as { ok: boolean; count: number; ref_no: string; refs: string[] }
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

/**
 * เพิ่มเครื่องใหม่เข้าทะเบียน
 * รหัสเครื่องซ้ำไม่ได้ ฐานข้อมูลจะตีกลับเอง
 */
export async function createAsset(row: {
  code: string
  type_code: string
  dept_code: string | null
  share_depts?: string[]
  note?: string | null
}) {
  const { error } = await supabase.from('assets').insert({
    code: row.code.trim(),
    type_code: row.type_code,
    dept_code: row.dept_code,
    share_depts: row.share_depts ?? [],
    note: row.note?.trim() || null,
    is_enabled: true,
  })
  if (error) throw new Error(readableError(error))
}

/**
 * แก้ข้อมูลเครื่อง รวมถึงเปลี่ยนรหัส
 * ฐานข้อมูลตั้ง on update cascade ไว้ ประวัติทุกที่จะตามรหัสใหม่ไปเอง
 */
export async function updateAsset(
  code: string,
  patch: { code?: string; type_code?: string; dept_code?: string | null; note?: string | null },
) {
  const body: Record<string, unknown> = {}
  if (patch.code !== undefined) body.code = patch.code.trim()
  if (patch.type_code !== undefined) body.type_code = patch.type_code
  if (patch.dept_code !== undefined) body.dept_code = patch.dept_code
  if (patch.note !== undefined) body.note = patch.note?.trim() || null
  const { error } = await supabase.from('assets').update(body).eq('code', code)
  if (error) throw new Error(readableError(error))
}

/** ลบเครื่องพร้อมประวัติทั้งหมด — เครื่องที่ยังมีคนถือลบไม่ได้ */
export async function deleteAsset(code: string) {
  const { data, error } = await supabase.rpc('delete_asset', { p_code: code })
  if (error) throw new Error(readableError(error))
  return data as { code: string; txn_items: number; issues: number; transfers: number }
}

export async function setAssetEnabled(code: string, on: boolean) {
  const { error } = await supabase.rpc('set_asset_enabled', { p_code: code, p_on: on })
  if (error) throw new Error(readableError(error))
}

export interface IssuePhotoIn {
  file_id: string
  web_link: string | null
  bytes?: number | null
}

/**
 * เคลียร์ใบแจ้งชำรุด — รูปตอนซ่อมเสร็จบังคับ
 *
 * ฐานข้อมูลปฏิเสธถ้าไม่มีรูป ไม่ได้กันแค่ที่หน้าจอ
 * ตัวเก่าที่ไม่รับรูปถูกลบทิ้งแล้ว เรียกแบบเดิมจะไม่เจอฟังก์ชัน
 */
export async function resolveAssetIssue(id: number, photos: IssuePhotoIn[], note?: string) {
  const { error } = await supabase.rpc('resolve_asset_issue', {
    p_id: id,
    p_note: note ?? null,
    p_photos: photos,
  })
  if (error) throw new Error(readableError(error))
}

export async function resolveAssetIssuesFor(
  code: string,
  photos: IssuePhotoIn[],
  note?: string,
) {
  const { data, error } = await supabase.rpc('resolve_asset_issues_for', {
    p_code: code,
    p_note: note ?? null,
    p_photos: photos,
  })
  if (error) throw new Error(readableError(error))
  return data as number
}

/** หลักฐานทั้งหมดของใบแจ้งชำรุด รวมรูปตอนคืนของที่ใบนี้เกิดมาด้วยกัน */
export async function assetIssueEvidence(id: number) {
  const { data, error } = await supabase.rpc('asset_issue_evidence', { p_id: id })
  if (error) throw new Error(readableError(error))
  return (data ?? []) as {
    phase: 'report' | 'fix'
    source: 'issue' | 'txn'
    file_id: string
    web_link: string | null
    created_at: string
    label: string | null
  }[]
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

/** บรรทัด Asset ในช่วงที่เลือก — ไว้ดูก่อนส่ง ว่าจะส่งอะไรเข้าชีตบ้าง */
export async function listAssetExportRows(args: {
  fromISO: string
  toISO: string
  onlyPending?: boolean
  limit?: number
}): Promise<AssetExportRow[]> {
  let q = supabase
    .from('asset_export_rows')
    .select('*')
    .gte('created_at', args.fromISO)
    .lte('created_at', args.toISO)
    .order('created_at', { ascending: false })
  if (args.onlyPending) q = q.is('tab', null)
  return unwrap(await q.limit(args.limit ?? 300)) as unknown as AssetExportRow[]
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
    p_reason: args.reason?.trim() || null,
    p_note: args.note ?? null,
    p_photos: args.photos,
  })
  if (error) throw new Error(readableError(error))
  return data as { id: string; ref_no: string; photos: number }
}

/**
 * ปิดงานบาร์โค้ด พร้อมตัดสต็อกหลายรายการในทีเดียว
 * บาร์โค้ดใบเดียวมักมีของหลายอย่าง การตัดได้ทีละอย่างทำให้ที่เหลือต้องไปตัดมือ
 */
export async function setByStatusLines(
  id: string,
  status: ByStatus,
  opts: { note?: string; lines?: { item_id: number; qty: number }[]; cutStock?: boolean } = {},
) {
  const { data, error } = await supabase.rpc('set_by_status_lines', {
    p_id: id,
    p_status: status,
    p_note: opts.note ?? null,
    p_lines: opts.lines ?? [],
    p_cut_stock: opts.cutStock ?? false,
  })
  if (error) throw new Error(readableError(error))
  return data as { ok: boolean; cut_lines: number }
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
  'id,ref_no,status,created_at,requester_id,acted_by,' +
  'profiles!requisitions_requester_id_fkey(id,full_name,employee_code,dept_code),' +
  'actor:profiles!requisitions_acted_by_fkey(full_name,employee_code),' +
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
        'id,ref_no,status,created_at,requester_id,acted_by,' +
          'profiles!requisitions_requester_id_fkey(id,full_name,employee_code,dept_code),' +
          'actor:profiles!requisitions_acted_by_fkey(full_name,employee_code),' +
          'requisition_items(id,item_id,qty_requested,qty_approved,status,items(name,unit))',
      )
      .gte('created_at', fromISO)
      .lte('created_at', toISO)
      .order('created_at', { ascending: false })
      .limit(limit),
  ) as unknown as Requisition[]
}

/** ลบรายการเช็คอินถาวร — รูปใน Drive และแถวที่ส่งขึ้นชีตไปแล้วยังอยู่ */
export async function deleteMeetings(ids: string[]) {
  const { data, error } = await supabase.rpc('delete_meetings', { p_ids: ids })
  if (error) throw new Error(readableError(error))
  return (data as number) ?? 0
}

export interface MeetingDay {
  day: string
  confirmed: number
  pending: number
  rejected: number
  total: number
  people: number
}

export interface MeetingDept {
  dept_code: string
  confirmed: number
  total: number
  people: number
}

export async function meetingDaily(fromDay: string, toDay: string): Promise<MeetingDay[]> {
  const { data, error } = await supabase.rpc('meeting_daily', { p_from: fromDay, p_to: toDay })
  if (error) throw new Error(readableError(error))
  return (data ?? []) as MeetingDay[]
}

export async function meetingByDept(fromDay: string, toDay: string): Promise<MeetingDept[]> {
  const { data, error } = await supabase.rpc('meeting_by_dept', { p_from: fromDay, p_to: toDay })
  if (error) throw new Error(readableError(error))
  return (data ?? []) as MeetingDept[]
}

/** จำนวนเช็คอินที่ยังไม่ได้ส่งเข้า Google Sheet */
export async function countMeetingExportRows(args: {
  fromISO: string
  toISO: string
}): Promise<{ pending: number; done: number }> {
  const base = () =>
    supabase
      .from('meeting_export_rows')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', args.fromISO)
      .lte('created_at', args.toISO)
  const [pending, done] = await Promise.all([base().is('tab', null), base().not('tab', 'is', null)])
  if (pending.error) throw new Error(readableError(pending.error))
  if (done.error) throw new Error(readableError(done.error))
  return { pending: pending.count ?? 0, done: done.count ?? 0 }
}

/* --------------------------------------------------------------- นัดประชุม */

/** นัดที่ยังไม่ผ่านไป — ทุกคนเห็น ใช้ขึ้นประกาศในแอพ */
export async function listUpcomingMeetings(limit = 10): Promise<MeetingEvent[]> {
  return unwrap(
    await supabase
      .from('meeting_event_rows')
      .select('*')
      .gte('meet_at', new Date(Date.now() - 6 * 3600_000).toISOString())
      .order('meet_at', { ascending: true })
      .limit(limit),
  ) as unknown as MeetingEvent[]
}

/**
 * นัดที่ยังเปิดให้เช็คชื่ออยู่ · ไม่สนว่าผ่านมานานแค่ไหน
 *
 * listUpcomingMeetings มองย้อนหลังแค่ 6 ชั่วโมง ซึ่งถูกสำหรับ "นัดที่กำลังจะถึง"
 * แต่ผิดสำหรับ "นัดที่ลืมปิด" — ของที่ลืมปิดคือของที่ผ่านมานานแล้วทั้งนั้น
 * ยิ่งเก่ายิ่งต้องเห็น ไม่ใช่ยิ่งเก่ายิ่งหาย
 */
export async function listOpenMeetings(limit = 20): Promise<MeetingEvent[]> {
  return unwrap(
    await supabase
      .from('meeting_event_rows')
      .select('*')
      .is('cancelled_at', null)
      .is('closed_at', null)
      .order('meet_at', { ascending: false })
      .limit(limit),
  ) as unknown as MeetingEvent[]
}

/** นัดทั้งหมดในช่วงวัน — ใช้ในหน้าตรวจสอบ */
export async function listMeetingEvents(fromDay: string, toDay: string): Promise<MeetingEvent[]> {
  return unwrap(
    await supabase
      .from('meeting_event_rows')
      .select('*')
      .gte('day', fromDay)
      .lte('day', toDay)
      .order('meet_at', { ascending: false }),
  ) as unknown as MeetingEvent[]
}

export async function createMeetingEvent(args: {
  title: string
  meetAt: string
  audience?: string | null
  place?: string | null
  note?: string | null
  openBefore?: number | null
  lateAfter?: number | null
  mode?: 'all' | 'picked' | 'free'
  deptCodes?: string[]
  userIds?: string[]
}) {
  const picked = args.mode === 'picked'
  const { data, error } = await supabase.rpc('create_meeting_event', {
    p_title: args.title,
    p_meet_at: args.meetAt,
    p_audience: args.audience ?? null,
    p_place: args.place ?? null,
    p_note: args.note ?? null,
    p_open_before: args.openBefore ?? null,
    p_late_after: args.lateAfter ?? null,
    p_mode: args.mode ?? 'free',
    p_depts: picked ? (args.deptCodes ?? []) : [],
    p_users: picked ? (args.userIds ?? []) : [],
  })
  if (error) throw new Error(readableError(error))
  return data as { id: string }
}

/* ------------------------------------------- หน้าต่างเวลาเช็คชื่อประชุม */

/** นัดที่กำลังอยู่ในกรอบเวลา · null = ตอนนี้ไม่มีนัดที่เกี่ยวข้อง */
export async function meetingWindow(): Promise<MeetingWindow | null> {
  const { data, error } = await supabase.rpc('meeting_now')
  if (error) throw new Error(readableError(error))
  const rows = (data ?? []) as MeetingWindow[]
  return rows[0] ?? null
}

/* ------------------------------------------- สถานะการเข้าประชุม */

/** รายชื่อที่ต้องเข้าประชุมพร้อมสถานะ — คิดสดที่ฐานข้อมูลทุกครั้ง */
export async function meetingRoster(eventId: string): Promise<RosterRow[]> {
  const { data, error } = await supabase.rpc('meeting_roster', { p_event: eventId })
  if (error) throw new Error(readableError(error))
  return (data ?? []) as RosterRow[]
}

/**
 * เช็คชื่อทั้งนัดด้วยการกดครั้งเดียว
 *
 * onlyChecked = true แตะแค่คนที่ส่งใบเช็คอินมาจริง คนที่ขาดยังขาดอยู่
 * ซึ่งเป็นค่าปกติ เพราะการกดรับทั้งแผ่นแล้วคนขาดกลายเป็นคนมาคือความเสียหายที่กู้ยาก
 */
export async function attendBulk(args: {
  eventId: string
  state?: 'ontime' | 'late' | 'excused' | 'absent'
  onlyChecked?: boolean
  reason?: string
}): Promise<{ changed: number }> {
  const { data, error } = await supabase.rpc('meeting_attend_bulk', {
    p_event: args.eventId,
    p_state: args.state ?? 'ontime',
    p_only_checked: args.onlyChecked ?? true,
    p_reason: args.reason?.trim() || null,
  })
  if (error) throw new Error(readableError(error))
  return (data ?? { changed: 0 }) as { changed: number }
}

export async function meetingSummary(eventId: string): Promise<MeetingSummary> {
  const { data, error } = await supabase.rpc('meeting_summary', { p_event: eventId })
  if (error) throw new Error(readableError(error))
  return data as MeetingSummary
}

/** ผู้ตรวจสอบแก้สถานะ — ฐานข้อมูลบังคับให้ใส่เหตุผททุกครั้ง */
export async function setAttendance(args: {
  eventId: string
  userId: string
  state: Exclude<AttendState, 'waiting'>
  /** โน้ตกำกับ · ไม่บังคับแล้ว ว่างได้ */
  reason?: string
}) {
  const { error } = await supabase.rpc('set_meeting_attendance', {
    p_event: args.eventId,
    p_user: args.userId,
    p_state: args.state,
    p_reason: args.reason,
  })
  if (error) throw new Error(readableError(error))
}

/** ถอนการแก้ กลับไปใช้ค่าที่ระบบคำนวณ */
export async function clearAttendance(eventId: string, userId: string) {
  const { error } = await supabase.rpc('clear_meeting_attendance', {
    p_event: eventId,
    p_user: userId,
  })
  if (error) throw new Error(readableError(error))
}

/* ------------------------------------------ รูปประกอบการแจ้งซ่อม */

/**
 * แนบรูปเข้าใบแจ้งซ่อมที่เพิ่งสร้าง
 *
 * เรียกหลังเบิกหรือคืนสำเร็จ อ้างจากรหัสเครื่อง
 * ตั้งใจไม่ผูกไว้ใน RPC เบิก-คืน เพราะสองตัวนั้นเป็นหัวใจของสต็อก
 * ถ้าแนบรูปไม่สำเร็จ ใบแจ้งซ่อมต้องยังอยู่ครบ เรื่องสำคัญห้ามพังตาม
 */
export async function attachIssuePhotos(assetCode: string, photos: { file_id: string; web_link: string | null; bytes: number | null }[]) {
  if (photos.length === 0) return 0
  const { data, error } = await supabase.rpc('attach_issue_photos_by_code', {
    p_asset_code: assetCode,
    p_photos: photos,
  })
  if (error) throw new Error(readableError(error))
  return (data as number) ?? 0
}

/** ใบแจ้งซ่อมพร้อมรูปทั้งหมด — แอดมินและผู้ตรวจสอบเท่านั้น */
export async function listIssueRows(assetCode?: string): Promise<IssueRow[]> {
  let q = supabase.from('asset_issue_rows').select('*').order('reported_at', { ascending: false })
  if (assetCode) q = q.eq('asset_code', assetCode)
  return unwrap(await q) as unknown as IssueRow[]
}

/* ------------------------------------------------------- ป้ายประกาศ */

/**
 * ประกาศที่ยังไม่หมดอายุ
 *
 * RLS กรองให้เองว่าใครเห็นอะไร หน้าจอจึงไม่ต้องรู้กติกา
 * คนคุมเห็นของที่หมดอายุแล้วด้วย จึงต้องกรองฝั่งนี้เมื่อใช้ในแอพ
 */
export async function listAnnouncements(all = false): Promise<Announcement[]> {
  let q = supabase
    .from('announcements')
    .select('*')
    .is('cancelled_at', null)
    .order('created_at', { ascending: false })
  if (!all) q = q.gt('expires_at', new Date().toISOString())
  return unwrap(await q) as unknown as Announcement[]
}

export async function createAnnouncement(args: {
  title: string
  body?: string | null
  level?: NoticeLevel
  days?: number
  notify?: boolean
  mode?: 'all' | 'picked'
  deptCodes?: string[]
  userIds?: string[]
}) {
  const picked = args.mode === 'picked'
  const { data, error } = await supabase.rpc('create_announcement', {
    p_title: args.title,
    p_body: args.body ?? null,
    p_level: args.level ?? 'info',
    p_days: args.days ?? 3,
    p_notify: args.notify ?? true,
    p_mode: args.mode ?? 'all',
    p_depts: picked ? (args.deptCodes ?? []) : [],
    p_users: picked ? (args.userIds ?? []) : [],
  })
  if (error) throw new Error(readableError(error))
  return data as { id: string }
}

/** เก็บประกาศก่อนหมดอายุ — ไม่ลบทิ้ง เผื่อย้อนดูว่าเคยประกาศอะไรไป */
export async function retireAnnouncement(id: string) {
  const { error } = await supabase
    .from('announcements')
    .update({ cancelled_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(readableError(error))
}

/**
 * ปิดประชุม — จบรอบนี้ กล้องเช็คชื่อปิดทันที
 *
 * ต่างจากยกเลิก · ปิด = ประชุมเกิดขึ้นจริงแล้วจบ รายชื่อใครมาใครขาดยังอยู่ครบ
 * ส่วนยกเลิก = ประชุมไม่ได้เกิด ทั้งใบหายไปจากระบบพร้อมหลักฐาน
 */
export async function closeMeeting(id: string) {
  const { error } = await supabase.rpc('close_meeting', { p_id: id })
  if (error) throw new Error(readableError(error))
}

/** เผลอกดปิดเร็วไป เปิดใหม่ได้ · คนยังเช็คชื่อไม่ครบก็เกิดขึ้นได้ */
export async function reopenMeeting(id: string) {
  const { error } = await supabase.rpc('reopen_meeting', { p_id: id })
  if (error) throw new Error(readableError(error))
}

export async function cancelMeetingEvent(id: string) {
  const { error } = await supabase.rpc('cancel_meeting_event', { p_id: id })
  if (error) throw new Error(readableError(error))
}

export async function deleteMeetingEvent(id: string) {
  const { error } = await supabase.rpc('delete_meeting_event', { p_id: id })
  if (error) throw new Error(readableError(error))
}

/**
 * ลบรายการในหน้าหลักฐานถาวร — เจ้าของระบบเท่านั้น
 *
 * สต็อกไม่ถูกคืนกลับให้ ลบแค่ประวัติ
 * และลบการเบิกเครื่องที่ยังไม่ได้คืนไม่ได้ ต้องกดคืนก่อน
 */
export async function deleteEvidence(kind: string, id: string) {
  const { error } = await supabase.rpc('delete_evidence', { p_kind: kind, p_id: id })
  if (error) throw new Error(readableError(error))
}

/**
 * ประวัติของตัวเองสำหรับหน้าฝั่งพนักงาน — เอาเฉพาะช่องที่หน้านั้นวาดจริง
 *
 * ตัวเต็มพ่วงข้อมูลผู้เบิก ช่องสต็อกของวัสดุ และรายละเอียด sync ที่ไม่ได้ใช้
 * วัดได้ใบละ ~1.8 KB แบบนี้เหลือราวหนึ่งในสี่
 * สำคัญเพราะทุกคนเปิดหน้านี้ ไม่ใช่แค่แอดมินไม่กี่คน
 */
export async function listMyHistory(limit = 100): Promise<Requisition[]> {
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth.user?.id
  if (!uid) return []
  return unwrap(
    await supabase
      .from('requisitions')
      .select(
        'id,ref_no,status,purpose,reject_reason,created_at,acted_by,' +
          'actor:profiles!requisitions_acted_by_fkey(full_name,employee_code),' +
          'requisition_items(id,item_id,qty_requested,qty_approved,status,items(name,unit)),' +
          'sync_log(channel,state)',
      )
      .eq('requester_id', uid)
      .order('created_at', { ascending: false })
      .limit(limit),
  ) as unknown as Requisition[]
}

/* ------------------------------------------- ปิดรายการค้างจากหน้าเว็บ */

/** ปิดของยืม-คืนที่ค้าง พร้อมคืนสต็อก — แอดมินและเจ้าของระบบ ไม่ต้องมีรูป */
export async function adminCloseBorrow(lineId: number, qty?: number, note?: string) {
  const { data, error } = await supabase.rpc('admin_close_borrow', {
    p_line_id: lineId,
    p_qty: qty ?? null,
    p_note: note ?? null,
  })
  if (error) throw new Error(readableError(error))
  return data as { id: number; qty: number; qty_after: number }
}

/** ปิดเครื่องที่ค้างคืน — ของกลับเข้าคลังแล้วแต่ลืมกดคืน */
export async function adminReleaseAsset(outItemId: number, note?: string) {
  const { data, error } = await supabase.rpc('admin_release_asset', {
    p_out_item_id: outItemId,
    p_note: note ?? null,
  })
  if (error) throw new Error(readableError(error))
  return data as { ref_no: string; asset_code: string }
}

/** ยกเลิกการเบิกเครื่องที่กดผิด — ลบทิ้ง ไม่บันทึกว่าเคยคืน */
export async function adminCancelAssetOut(outItemId: number) {
  const { data, error } = await supabase.rpc('admin_cancel_asset_out', {
    p_out_item_id: outItemId,
  })
  if (error) throw new Error(readableError(error))
  return data as { asset_code: string; txn_removed: boolean }
}

/**
 * แก้ชื่อหรือรหัสพนักงาน — เจ้าของระบบเท่านั้น
 *
 * รหัสพนักงานคืออีเมลที่ใช้ล็อกอิน จึงต้องแก้ทั้งฝั่ง auth และโปรไฟล์ให้ตรงกัน
 * ถ้าแก้แค่ที่เดียวเจ้าตัวจะล็อกอินไม่ได้และหาสาเหตุไม่เจอ
 * รหัสผ่านเดิมยังใช้ได้ เปลี่ยนแค่ชื่อผู้ใช้ที่พิมพ์ตอนเข้าระบบ
 */
export async function renameEmployee(args: {
  userId: string
  fullName?: string
  employeeCode?: string
}) {
  return callFunction<{ ok: true; changed: string[] }>(
    'admin-users',
    JSON.stringify({
      action: 'rename',
      user_id: args.userId,
      full_name: args.fullName ?? null,
      employee_code: args.employeeCode ?? null,
      email: args.employeeCode ? emailFromEmployeeCode(args.employeeCode) : null,
    }),
    { 'Content-Type': 'application/json' },
  )
}

/* --------------------------------------------------- กระจายกระสอบไปสาขา */

/**
 * รายการกระสอบ
 *
 * หน้างานเปิดมาต้องเห็น "รอส่ง" ก่อนเสมอ เพราะนั่นคืองานที่ต้องทำ
 * ส่วนที่ส่งแล้วเก็บไว้ให้ย้อนดูฟอร์มเดิมได้ ไม่ได้ลบทิ้ง
 */
export async function listSackOrders(
  opts: { status?: 'pending' | 'sent' | 'all'; limit?: number } = {},
): Promise<SackRow[]> {
  const status = opts.status ?? 'all'
  let q = supabase.from('sack_rows').select('*').order('created_at', { ascending: false })
  if (status === 'pending') q = q.eq('status', 'pending')
  if (status === 'sent') q = q.neq('status', 'pending')
  return unwrap(await q.limit(opts.limit ?? 200)) as unknown as SackRow[]
}

export async function createSackOrder(args: {
  branch: string
  qty: number
  unit?: string
  note?: string | null
  hub?: string | null
}): Promise<{ id: string; ref_no: string }> {
  const { data, error } = await supabase.rpc('create_sack_order', {
    p_branch: args.branch,
    p_qty: args.qty,
    p_unit: args.unit ?? 'ชิ้น',
    p_note: args.note ?? null,
    p_hub: args.hub ?? null,
  })
  if (error) throw new Error(readableError(error))
  return data as { id: string; ref_no: string }
}

/**
 * กดว่าส่งแล้ว
 *
 * กดซ้ำไม่ถือว่าผิด ฐานข้อมูลตอบ duplicate:true กลับมาเฉย ๆ
 * เน็ตในฮับไม่นิ่ง คนกดค้างแล้วกดซ้ำเป็นเรื่องปกติ
 */
export async function markSackSent(args: {
  id: string
  mode: 'direct' | 'relay'
  relayVia?: string | null
  photos?: { file_id: string; web_link: string | null; bytes: number | null }[]
  /** ส่งไปจริงเท่าไหร่ · ไม่ส่งมา = ส่งเต็มตามที่ขอ */
  sentQty?: number | null
  /** หน่วยที่นับตอนส่ง · ไม่ส่งมา = หน่วยเดียวกับที่ขอ */
  sentUnit?: 'ชิ้น' | 'กระสอบ' | null
}): Promise<{
  ref_no: string
  duplicate: boolean
  status: 'direct' | 'relay'
  relay_via: string | null
  sent_qty: number
  sent_unit: string
  qty: number
  unit: string
}> {
  const { data, error } = await supabase.rpc('mark_sack_sent', {
    p_id: args.id,
    p_mode: args.mode,
    p_relay: args.mode === 'relay' ? (args.relayVia ?? null) : null,
    p_photos: args.photos ?? [],
    p_sent_qty: args.sentQty ?? null,
    p_sent_unit: args.sentUnit ?? null,
  })
  if (error) throw new Error(readableError(error))
  return data as {
    ref_no: string
    duplicate: boolean
    status: 'direct' | 'relay'
    relay_via: string | null
    sent_qty: number
    sent_unit: string
    qty: number
    unit: string
  }
}

/**
 * แก้รายการที่ตั้งผิด — ไม่ต้องลบแล้วตั้งใหม่ให้ได้เลขที่ใหม่
 *
 * ช่องไหนไม่ส่งมา แปลว่าไม่แตะช่องนั้น
 * ส่วนหมายเหตุส่งสตริงว่างมาได้ แปลว่าลบหมายเหตุทิ้ง
 */
export async function updateSackOrder(args: {
  id: string
  branch?: string
  qty?: number
  unit?: string
  note?: string | null
}): Promise<{ ref_no: string; qty: number; unit: string; branch: string; was_sent: boolean }> {
  const { data, error } = await supabase.rpc('update_sack_order', {
    p_id: args.id,
    p_branch: args.branch ?? null,
    p_qty: args.qty ?? null,
    p_unit: args.unit ?? null,
    p_note: args.note ?? null,
  })
  if (error) throw new Error(readableError(error))
  return data as { ref_no: string; qty: number; unit: string; branch: string; was_sent: boolean }
}

/** ลบรายการที่ตั้งผิด — RLS เปิดให้เฉพาะเจ้าของระบบกับแอดมิน */
export async function deleteSackOrder(id: string) {
  const { error } = await supabase.from('sack_orders').delete().eq('id', id)
  if (error) throw new Error(readableError(error))
}

/** สาขาที่เคยใช้ — รายการโตเองจากการใช้งาน ไม่ต้องมีใครมาตั้งล่วงหน้า */
export async function sackBranches(): Promise<SackBranch[]> {
  const { data, error } = await supabase.rpc('sack_branches')
  if (error) throw new Error(readableError(error))
  return (data ?? []) as SackBranch[]
}

export async function sackRelays(): Promise<SackRelay[]> {
  const { data, error } = await supabase.rpc('sack_relays')
  if (error) throw new Error(readableError(error))
  return (data ?? []) as SackRelay[]
}

export async function sackNotifyTargets(): Promise<SackNotifyTarget[]> {
  const { data, error } = await supabase.rpc('sack_notify_targets')
  if (error) throw new Error(readableError(error))
  return (data ?? []) as SackNotifyTarget[]
}

/**
 * นับใบที่ยังรอส่ง — ใช้โชว์ตัวเลขบนหน้าแรกของหน้างาน
 *
 * head:true คือขอแต่จำนวน ไม่ดึงแถวกลับมาสักแถว
 * หน้าแรกถูกเปิดวันละหลายร้อยครั้งรวมทุกคน ต้องเบาที่สุด
 */
export async function countPendingSacks(): Promise<number> {
  const { count, error } = await supabase
    .from('sack_orders')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  if (error) throw new Error(readableError(error))
  return count ?? 0
}

/**
 * ยังมีกระสอบกี่ใบที่ชีตยังไม่ตรงกับความจริง
 *
 * นับทั้งใบที่ไม่เคยส่ง และใบที่ส่งไปแล้วแต่สถานะเปลี่ยนทีหลัง
 * (ตั้งรายการวันนี้ ส่งพรุ่งนี้ — แถวในชีตต้องอัปตาม)
 */
export async function countSackExportRows(): Promise<number> {
  const { count, error } = await supabase
    .from('sack_export_rows')
    .select('id', { count: 'exact', head: true })
    .eq('needs_push', true)
  if (error) throw new Error(readableError(error))
  return count ?? 0
}

/**
 * ยังมีการสแกนกี่ครั้งที่ชีตยังไม่ตรงกับความจริง
 *
 * นับทั้งครั้งที่ไม่เคยส่ง และครั้งที่ส่งไปแล้วแต่ รปภ มาติดธงทีหลัง
 *
 * ไม่ใส่ช่วงวันที่ = นับทั้งหมดตั้งแต่ต้น หน้าจอใช้เทียบกับจำนวนในช่วงที่เลือก
 * เพื่อเตือนว่ายังมีของค้างอยู่นอกช่วง ซึ่งกดส่งเท่าไหร่ก็ไม่มีวันไป
 */
export async function countOsScanExportRows(range?: {
  fromISO: string
  toISO: string
}): Promise<number> {
  let q = supabase
    .from('os_scan_export_rows')
    .select('id', { count: 'exact', head: true })
    .eq('needs_push', true)
  if (range) q = q.gte('scanned_at', range.fromISO).lte('scanned_at', range.toISO)
  const { count, error } = await q
  if (error) throw new Error(readableError(error))
  return count ?? 0
}

/* ------------------------------------ บัตรนำโทรศัพท์เข้าพื้นที่ของ OS */

/** รายชื่อ OS ทั้งหมด พ่วงบัตรที่ใช้งานอยู่ — เฉพาะคนที่จัดการได้ */
export async function listOsPeople(): Promise<OsPerson[]> {
  return unwrap(
    await supabase.from('os_person_rows').select('*').order('full_name'),
  ) as unknown as OsPerson[]
}

export async function saveOsPerson(row: Partial<OsPerson> & { full_name: string }) {
  const patch = {
    os_code: row.os_code?.trim() || null,
    full_name: row.full_name.trim(),
    affiliation: row.affiliation?.trim() || null,
    shift: row.shift?.trim() || null,
    phone_model: row.phone_model?.trim() || null,
    imei: row.imei?.trim() || null,
    nickname: row.nickname?.trim() || null,
    note: row.note?.trim() || null,
    is_active: row.is_active ?? true,
    updated_at: new Date().toISOString(),
  }
  if (row.id) {
    const { error } = await supabase.from('os_people').update(patch).eq('id', row.id)
    if (error) throw new Error(readableError(error))
    return row.id
  }
  const { data, error } = await supabase.from('os_people').insert(patch).select('id').single()
  if (error) throw new Error(readableError(error))
  return (data as { id: string }).id
}

export async function setOsPersonActive(id: string, on: boolean) {
  const { error } = await supabase
    .from('os_people')
    .update({ is_active: on, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(readableError(error))
}

export async function deleteOsPerson(id: string) {
  const { error } = await supabase.from('os_people').delete().eq('id', id)
  if (error) throw new Error(readableError(error))
}

/**
 * วางข้อมูลจากชีตทีเดียวทั้งกอง
 *
 * คนมีรหัส OS แล้วจะอัปเดตทับ ไม่สร้างซ้ำ — วางซ้ำได้ทุกเดือนโดยไม่ต้องกลัว
 * คนไม่มีรหัสจับคู่จากชื่อแทน ซึ่งพลาดได้ถ้าชื่อพิมพ์ต่างกันนิดเดียว
 * จึงคืนมาว่าแถวไหนเพิ่มใหม่แถวไหนทับของเดิม ให้คนกดตรวจเองก่อนไปต่อ
 */
export async function importOsPeople(rows: OsImportRow[]): Promise<{
  added: number
  updated: number
  skipped: number
}> {
  const existing = await listOsPeople()
  const byCode = new Map(
    existing.filter((p) => p.os_code).map((p) => [p.os_code as string, p]),
  )
  const byName = new Map(existing.map((p) => [p.full_name.trim().toLowerCase(), p]))

  let added = 0
  let updated = 0
  let skipped = 0

  for (const r of rows) {
    if (!r.full_name.trim()) {
      skipped++
      continue
    }
    const hit =
      (r.os_code ? byCode.get(r.os_code) : undefined) ??
      byName.get(r.full_name.trim().toLowerCase())

    /**
     * ช่องว่างในชีตแปลว่า "ไม่รู้" ไม่ได้แปลว่า "ลบทิ้ง"
     *
     * สิบสามคนในชีตยังไม่มีรหัส OS เจ้าของระบบจะทยอยเติมในแอพ
     * ถ้าวางทับรอบหน้าแล้วช่องว่างไปล้างของที่เติมไว้ งานที่ทำไปจะหายเงียบ
     * และจะไม่มีใครรู้จนกว่าจะพิมพ์บัตรออกมาแล้วเห็นว่ารหัสหายไป
     *
     * ของใหม่ทับได้เสมอ ของว่างไม่ทับของที่มีอยู่
     */
    const keep = <T,>(incoming: T | null | undefined, current: T | null | undefined) =>
      incoming ?? current ?? null

    await saveOsPerson({
      ...r,
      id: hit?.id,
      os_code: keep(r.os_code, hit?.os_code),
      affiliation: keep(r.affiliation, hit?.affiliation),
      shift: keep(r.shift, hit?.shift),
      phone_model: keep(r.phone_model, hit?.phone_model),
      imei: keep(r.imei, hit?.imei),
      nickname: keep(r.nickname, hit?.nickname),
      is_active: hit?.is_active ?? true,
    })
    if (hit) updated++
    else added++
  }
  return { added, updated, skipped }
}

/** แนบรูปหน้าที่อัปขึ้น Drive แล้วเข้ากับคนคนหนึ่ง */
export async function setOsPersonPhoto(
  id: string,
  photo: { file_id: string; web_link: string | null },
) {
  const { error } = await supabase
    .from('os_people')
    .update({
      photo_file_id: photo.file_id,
      photo_link: photo.web_link,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw new Error(readableError(error))
}

export async function issueOsCard(personId: string) {
  const { data, error } = await supabase.rpc('os_issue_card', { p_person: personId })
  if (error) throw new Error(readableError(error))
  return data as { id: string; token: string; rev: number; full_name: string }
}

export async function revokeOsCard(personId: string, reason?: string) {
  const { error } = await supabase.rpc('os_revoke_card', {
    p_person: personId,
    p_reason: reason ?? null,
  })
  if (error) throw new Error(readableError(error))
}

/**
 * สแกนบัตร — ตอบครบในครั้งเดียวและบันทึกให้เอง
 * ไม่โยน error แม้โค้ดจะใช้ไม่ได้ หน้าจอ รปภ ต้องมีคำตอบเสมอ
 */
export async function scanOsCard(token: string): Promise<OsScanHit> {
  const { data, error } = await supabase.rpc('os_scan', { p_token: token })
  if (error) throw new Error(readableError(error))
  const rows = (data ?? []) as OsScanHit[]
  if (rows.length === 0) throw new Error('ระบบไม่ตอบกลับ ลองสแกนใหม่อีกครั้ง')
  return rows[0]
}

export async function flagOsScan(scanId: number, reason: string) {
  const { error } = await supabase.rpc('os_flag_scan', { p_scan: scanId, p_reason: reason })
  if (error) throw new Error(readableError(error))
}

export async function listOsScans(args: {
  fromISO?: string
  toISO?: string
  onlyFlagged?: boolean
  limit?: number
}): Promise<OsScanRow[]> {
  let q = supabase.from('os_scan_rows').select('*').order('scanned_at', { ascending: false })
  if (args.fromISO) q = q.gte('scanned_at', args.fromISO)
  if (args.toISO) q = q.lte('scanned_at', args.toISO)
  if (args.onlyFlagged) q = q.not('flagged_at', 'is', null)
  return unwrap(await q.limit(args.limit ?? 300)) as unknown as OsScanRow[]
}

/** ใครจะได้รับตอน รปภ กดแจ้งว่าไม่ตรง */
export async function osFlagTargets(): Promise<SackNotifyTarget[]> {
  const { data, error } = await supabase.rpc('os_flag_targets')
  if (error) throw new Error(readableError(error))
  return (data ?? []) as SackNotifyTarget[]
}

/* ------------------------------------------ โอน-แจ้งเสีย · ดูย้อนหลังทั้งฮับ */

/**
 * แจ้งเสียเครื่องจากหน้าทะเบียน โดยไม่ต้องรอให้มีคนเบิกหรือคืน
 *
 * เผื่อหน้างานไม่แจ้งแล้วแอดมินเดินไปเจอเอง
 * ของเดิมบันทึกอาการได้เฉพาะตอนเบิกหรือตอนคืน เครื่องที่วางอยู่เฉย ๆ จึงแจ้งไม่ได้
 */
export async function reportAssetIssue(args: {
  code: string
  symptom: string
  /** รูปอาการที่เจอ · ฐานข้อมูลบังคับอย่างน้อยหนึ่งใบ */
  photos: IssuePhotoIn[]
}): Promise<{ id: number; duplicate: boolean; asset_code: string }> {
  const { data, error } = await supabase.rpc('asset_report_issue', {
    p_code: args.code,
    p_symptom: args.symptom,
    p_photos: args.photos,
  })
  if (error) throw new Error(readableError(error))
  return data as { id: number; duplicate: boolean; asset_code: string }
}

/** ประวัติการโอนในช่วงวันที่ — กรองที่ฐานข้อมูล ไม่ได้ดึงมาทั้งหมดแล้วคัดในเบราว์เซอร์ */
export async function listAssetTransferRows(args: {
  fromISO: string
  toISO: string
  limit?: number
}): Promise<AssetTransferRow[]> {
  return unwrap(
    await supabase
      .from('asset_transfer_rows')
      .select('*')
      .gte('created_at', args.fromISO)
      .lte('created_at', args.toISO)
      .order('created_at', { ascending: false })
      .limit(args.limit ?? 400),
  ) as unknown as AssetTransferRow[]
}

/** ใบแจ้งเสียในช่วงวันที่ · onlyOpen = เอาเฉพาะที่ยังไม่ได้เคลียร์ */
export async function listAssetIssueRows(args: {
  fromISO: string
  toISO: string
  onlyOpen?: boolean
  limit?: number
}): Promise<AssetIssueRow[]> {
  let q = supabase
    .from('asset_issue_rows')
    .select('*')
    .gte('reported_at', args.fromISO)
    .lte('reported_at', args.toISO)
  if (args.onlyOpen) q = q.eq('is_open', true)
  return unwrap(
    await q.order('reported_at', { ascending: false }).limit(args.limit ?? 400),
  ) as unknown as AssetIssueRow[]
}


/* --------------------------------------- สิทธิ์เห็นเครื่องเฉพาะเครื่อง */

/** รายการสิทธิ์ทั้งหมดที่ให้ไว้ · เจ้าของระบบกับผู้ตรวจสอบเห็นทั้งหมด */
export async function listAssetGrants(): Promise<AssetGrantRow[]> {
  return unwrap(
    await supabase.from('asset_grant_rows').select('*').order('created_at', { ascending: false }),
  ) as unknown as AssetGrantRow[]
}

/**
 * เปิดให้คนหนึ่งคนเห็นเครื่องหนึ่งเครื่อง
 *
 * คนละเรื่องกับการโอน · การโอนย้ายเครื่องไปอยู่กับคนนั้นจริงและเป็นของชั่วคราว
 * อันนี้แค่มองเห็นและเบิกได้ เครื่องไม่ได้ย้ายไปไหน และค้างไว้จนกว่าจะเอาออก
 */
export async function addAssetGrant(args: { code: string; userId: string; note?: string | null }) {
  const { data, error } = await supabase.rpc('asset_grant_add', {
    p_code: args.code,
    p_user: args.userId,
    p_note: args.note ?? null,
  })
  if (error) throw new Error(readableError(error))
  return data as { asset_code: string; full_name: string }
}

export async function removeAssetGrant(code: string, userId: string) {
  const { error } = await supabase.rpc('asset_grant_remove', { p_code: code, p_user: userId })
  if (error) throw new Error(readableError(error))
}

/**
 * ช่วงวันที่ของบรรทัดที่ยังค้างส่ง — เอาไว้ขยายช่วงให้ครอบพอดี
 *
 * ปุ่มส่งทำงานกับช่วงที่เลือกเท่านั้น ของที่ค้างอยู่นอกช่วงจึงกดส่งไม่ได้เลย
 * ขยายไปสองปีรวดก็ส่งได้ แต่จะไปเขียนทับทุกแถวที่ส่งไปแล้วเป็นพัน ๆ แถวด้วย
 * ซึ่งช้าและเสี่ยงหมดเวลาฝั่ง Edge Function
 *
 * **ต้องคืนทั้งหัวและท้าย ไม่ใช่แค่ตัวเก่าสุด**
 * ของที่ค้างส่วนใหญ่ตกขอบ *ด้านท้าย* ไม่ใช่ด้านหน้า
 * เพราะช่วงตั้งต้นจบที่ "วันนี้ 23:59 เวลาไทย" แต่ของที่เกิดหลังเที่ยงคืน
 * จะถูกนับเป็นวันถัดไปแล้ว ตกขอบทันทีทั้งที่เพิ่งเกิดเมื่อครู่
 * ขยายแต่ต้นช่วงอย่างเดียวจึงกดเท่าไหร่ก็ไม่ไป — เคยพลาดมาแล้ว
 */
export async function pendingExportSpan(
  lookbackDays = 730,
): Promise<{ oldest: string; newest: string } | null> {
  const fromISO = new Date(Date.now() - lookbackDays * 864e5).toISOString()
  const edge = async (view: 'sheet_export_rows' | 'asset_export_rows', asc: boolean) => {
    const { data, error } = await supabase
      .from(view)
      .select('created_at')
      .is('tab', null)
      .gte('created_at', fromISO)
      .order('created_at', { ascending: asc })
      .limit(1)
    if (error) throw new Error(readableError(error))
    return (data?.[0] as { created_at?: string } | undefined)?.created_at ?? null
  }
  const [so, sn, ao, an] = await Promise.all([
    edge('sheet_export_rows', true),
    edge('sheet_export_rows', false),
    edge('asset_export_rows', true),
    edge('asset_export_rows', false),
  ])
  const olds = [so, ao].filter((d): d is string => Boolean(d)).sort()
  const news = [sn, an].filter((d): d is string => Boolean(d)).sort()
  if (olds.length === 0) return null
  return { oldest: olds[0], newest: news[news.length - 1] }
}
