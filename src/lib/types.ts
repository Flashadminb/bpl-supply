export type UserRole = 'staff' | 'supervisor' | 'admin'
export type ReqStatus = 'pending' | 'approved' | 'partial' | 'rejected'
export type LineStatus = 'pending' | 'approved' | 'rejected'
export type ReturnCond = 'ok' | 'damaged' | 'lost'
export type SyncChannel = 'IMG' | 'GDV' | 'SPB' | 'TMP' | 'GSH'
export type SyncState = 'pending' | 'running' | 'done' | 'failed'

export interface Hub {
  code: string
  name: string
  is_active: boolean
}

export interface Profile {
  id: string
  employee_code: string
  full_name: string
  hub_code: string
  role: UserRole
  is_active: boolean
  must_change_password: boolean
  dept_code: string | null
  sub_dept: string | null
  can_assets: boolean
  extra_depts: string[]
  shift_start: string | null
  shift_end: string | null
  created_at: string
}

export interface Category {
  id: number
  name: string
  auto_approvable: boolean
}

export interface Item {
  id: number
  sku: string
  name: string
  category_id: number | null
  hub_code: string
  unit: string
  shelf_code: string | null
  qty_on_hand: number
  min_qty: number
  is_returnable: boolean
  requires_approval: boolean
  dept_code: string | null
  image_path: string | null
  qr_payload: string | null
  is_active: boolean
  updated_at: string
  categories?: Pick<Category, 'id' | 'name' | 'auto_approvable'> | null
}

export interface RequisitionItem {
  id: number
  requisition_id: string
  item_id: number
  qty_requested: number
  qty_approved: number | null
  status: LineStatus
  qty_before: number | null
  qty_after: number | null
  items?: Pick<Item, 'id' | 'sku' | 'name' | 'unit' | 'shelf_code' | 'qty_on_hand' | 'min_qty'> | null
}

export interface Requisition {
  id: string
  ref_no: string
  requester_id: string
  requester_name: string
  requester_code: string
  requester_dept: string | null
  hub_code: string
  purpose: string | null
  note: string | null
  status: ReqStatus
  evidence_file_id: string | null
  evidence_web_link: string | null
  evidence_bytes: number | null
  created_at: string
  decided_by: string | null
  decided_at: string | null
  reject_reason: string | null
  requisition_items?: RequisitionItem[]
  profiles?: Pick<Profile, 'id' | 'full_name' | 'employee_code' | 'dept_code'> | null
  sync_log?: SyncRow[]
}

export interface SyncRow {
  id: number
  requisition_id: string
  channel: SyncChannel
  state: SyncState
  detail: string | null
  updated_at: string
}

export interface OpenBorrowing {
  requisition_item_id: number
  requisition_id: string
  ref_no: string
  requester_id: string
  requester_name: string
  requester_code: string
  requester_dept: string | null
  requester_sub_dept: string | null
  shift_start: string | null
  shift_end: string | null
  hub_code: string
  item_id: number
  sku: string
  item_name: string
  unit: string
  shelf_code: string | null
  qty_taken: number
  qty_returned: number
  qty_open: number
  created_at: string
}

/** ผลลัพธ์จาก RPC create_requisition */
export interface CreateReqResult {
  ref_no: string
  id: string
  status: ReqStatus
}

/** บรรทัดในตะกร้า — เก็บ snapshot ไว้พอแสดงผลได้ตอนออฟไลน์ */
export interface CartLine {
  item_id: number
  sku: string
  name: string
  unit: string
  shelf_code: string | null
  qty_on_hand: number
  is_returnable: boolean
  requires_approval: boolean
  qty: number
}

export interface Department {
  code: string
  name: string
  sort_no: number
  is_active: boolean
}

/** หนึ่งบรรทัดที่ส่งเข้า Google Sheet ได้ พร้อมสถานะว่าส่งไปแล้วหรือยัง */
export interface SheetExportRow {
  line_id: number
  requisition_id: string
  ref_no: string
  created_at: string
  hub_code: string
  evidence_file_id: string | null
  evidence_web_link: string | null
  requester_name: string
  requester_code: string
  requester_dept: string | null
  requester_sub_dept: string | null
  shift_start: string | null
  shift_end: string | null
  sku: string
  item_name: string
  unit: string
  qty: number
  tab: string | null
  row_no: number | null
  exported_at: string | null
  is_exported: boolean
}

/* ---------------------------------------------------------------- assets */

export type AssetTxnKind = 'out' | 'in'

export interface AssetType {
  code: string
  name: string
  /** ถ้ามีค่า = เป็นของพ่วงประเภทนี้ ไม่ขึ้นเป็นเมนูแยก */
  parent_code: string | null
  sort_no: number
  is_active: boolean
  photo_min: number
  photo_max: number
  issue_tags: string[]
}

export interface AssetPhotoStep {
  type_code: string
  seq: number
  label: string
  hint: string | null
}

export interface Asset {
  code: string
  type_code: string
  dept_code: string | null
  share_depts: string[]
  is_enabled: boolean
  note: string | null
  held_item_id: number | null
  created_at: string
  asset_types?: Pick<AssetType, 'code' | 'name'> | null
}

/** เครื่องที่ยังไม่ถูกคืน — อ่านจากตารางเครื่องโดยตรง ไม่ไล่ประวัติย้อนหลัง */
export interface AssetHolding {
  out_item_id: number
  asset_code: string
  type_code: string
  type_name: string
  asset_dept: string | null
  asset_share_depts: string[]
  txn_id: string
  ref_no: string
  user_id: string
  holder_name: string
  holder_code: string
  holder_dept: string | null
  holder_sub_dept: string | null
  shift_start: string | null
  shift_end: string | null
  due_at: string | null
  taken_at: string
}

export interface AssetOpenIssue {
  asset_code: string
  issue_count: number
  symptoms: string
  last_reported_at: string
}

export interface AssetIssue {
  id: number
  asset_code: string
  txn_id: string | null
  phase: AssetTxnKind | null
  symptom: string
  reported_by: string | null
  reported_name: string | null
  reported_at: string
  file_id: string | null
  web_link: string | null
  resolved_at: string | null
  resolved_by: string | null
  resolve_note: string | null
}

/** รูปหนึ่งใบที่ส่งเข้า RPC — label ไว้บอกว่ารูปนี้คือขั้นตอนอะไร */
export interface AssetPhotoInput {
  file_id: string
  web_link: string | null
  bytes: number | null
  seq: number
  label: string | null
}

export interface AssetIssueInput {
  asset_code: string
  symptom: string
  file_id?: string | null
  web_link?: string | null
}

/* ------------------------------------------------------- บาร์โค้ดจาก BY */

export type ByStatus = 'pending' | 'done' | 'rejected'

export interface ByRow {
  id: string
  ref_no: string
  created_at: string
  reason: string
  note: string | null
  status: ByStatus
  handled_at: string | null
  handled_note: string | null
  handled_by_name: string | null
  user_id: string
  who: string
  employee_code: string
  dept_code: string | null
  sub_dept: string | null
  shift_start: string | null
  shift_end: string | null
  photo_count: number
  file_ids: string[]
}

export interface ByStatRow {
  ym: string
  dept_code: string | null
  reason: string
  total: number
  pending: number
  done: number
  rejected: number
}
