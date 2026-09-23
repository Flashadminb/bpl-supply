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
  extra_depts: string[]
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
  sku: string
  item_name: string
  unit: string
  qty: number
  tab: string | null
  row_no: number | null
  exported_at: string | null
  is_exported: boolean
}
