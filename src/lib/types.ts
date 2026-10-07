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
  /** เห็นงานกระสอบไหม · ตั้งรายคนได้จากหน้าผู้ใช้และสิทธิ์ */
  can_sack: boolean
  /** เบิกแทนคนอื่นได้ไหม · ของเดิมผูกกับตำแหน่ง ตอนนี้เปิดปิดรายคนได้ */
  can_proxy: boolean
  /** ผู้ตรวจสอบ — เห็นเครื่องทุกแผนก เบิกแทนและโอนเครื่องได้ */
  can_dispatch: boolean
  /** รปภ — เห็นเฉพาะหน้าสแกนบัตร OS ไม่เห็นเมนูเบิกของเลย */
  can_guard: boolean
  /** หัวหน้างาน — ปล่อยบัตรเบรคให้ OS ได้ · ต้องถูกใส่ไว้ในแผนกบัตรด้วยถึงจะเห็นบัตร */
  can_break_issue: boolean
  /** รปภ — สแกนบัตรเบรคขาออกและขากลับได้ */
  can_break_guard: boolean
  /** กดห้ามเบรคเดี๋ยวนี้และยกเลิกได้ จากในแอป */
  can_break_ban: boolean
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
  /** true = โชว์สต็อกได้แต่กดเบิกในแอพไม่ได้ เช่นของที่ต้องเบิกผ่านระบบ BY */
  view_only: boolean
  /** เหตุผลที่เบิกไม่ได้ · โชว์ให้หน้างานเห็นตรงหน้ารายการ */
  view_only_note: string | null
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
  /** คนที่กดเบิกให้ ถ้าไม่ใช่เจ้าตัว · ว่าง = เบิกเอง */
  acted_by?: string | null
  actor?: Pick<Profile, 'full_name' | 'employee_code'> | null
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
  /** ชื่อคนที่ของไปอยู่ด้วย ถ้าเบิกแทน · ว่าง = เบิกให้ตัวเอง */
  for_name?: string | null
}

/** บรรทัดในตะกร้า — เก็บ snapshot ไว้พอแสดงผลได้ตอนออฟไลน์ */
export interface CartLine {
  /** ของที่โดนปิดการเบิกหลังจากมันเข้าตะกร้าไปแล้ว — ต้องกันไว้ก่อนกดส่ง */
  view_only?: boolean
  view_only_note?: string | null
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
  /** แผนกย่อยเจ้าของ · ว่าง = ของกลางของแผนก ทุกคนในแผนกเห็น */
  sub_dept: string | null
  share_depts: string[]
  /** คนที่ได้รับเครื่องนี้มาใช้ชั่วคราวจากการโอน · ว่าง = อยู่บ้านตัวเอง */
  loan_user: string | null
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
  /** คนที่ได้รับเครื่องนี้มาใช้ชั่วคราวจากการโอน */
  asset_loan_user: string | null
  asset_loan_name: string | null
  txn_id: string
  ref_no: string
  user_id: string
  holder_name: string
  holder_code: string
  holder_dept: string | null
  holder_sub_dept: string | null
  /** คนที่กดเบิกให้ · ว่าง = เจ้าตัวเบิกเอง */
  acted_by: string | null
  acted_by_name: string | null
  shift_start: string | null
  shift_end: string | null
  due_at: string | null
  taken_at: string
}

/** หนึ่งบรรทัด Asset ที่รอส่งเข้าชีต หรือส่งไปแล้ว */
export interface AssetExportRow {
  line_id: number
  ref_no: string
  /** out = เบิก · in = คืน */
  kind: 'out' | 'in'
  created_at: string
  type_name: string
  asset_code: string
  who: string
  employee_code: string
  dept_code: string | null
  tab: string | null
  row_no: number | null
  is_exported: boolean
}

/** ลิงก์งานที่เจ้าของระบบใส่ไว้ให้กดจากปุ่มสายฟ้าในแอพ */
/**
 * ใครเห็นลิงก์นี้
 *
 * 'managers' เป็นของเก่าจากตอนที่ยังเลือกตำแหน่งไม่ได้
 * ข้อมูลถูกย้ายมาเป็น custom + ตำแหน่งแล้วใน 054 หน้าจอจึงไม่สร้างค่านี้อีก
 * แต่ยังคงไว้ในชนิดข้อมูล เผื่อมีแถวเก่าค้างจะได้ไม่พัง
 */
export type LinkAudience = 'all' | 'managers' | 'custom'

/**
 * สถานะโควตาแผนฟรี
 *
 * db กับ mau วัดจากฐานข้อมูลจริง · egress กับ edge เป็นการประมาณ
 * เพราะ Supabase นับสองตัวหลังที่ชั้นเครือข่าย ไม่ได้เก็บไว้ให้เราอ่าน
 */
export interface SystemHealth {
  measured_at: string
  /** per_day_bytes / days_left เป็น null ได้ = ยังจดสถิติไม่ครบ 7 วัน ห้ามเดาแทน */
  db: {
    bytes: number
    limit_bytes: number
    per_day_bytes: number | null
    days_left: number | null
    tracked_days: number
  }
  tables: { name: string; bytes: number; rows: number }[]
  egress: { est_bytes: number; limit_bytes: number; photo_count: number; photo_bytes: number }
  edge: { est_calls: number; limit_calls: number; uploads: number; pushes: number }
  mau: { used: number; limit: number; active_profiles: number }
}

/** ตำแหน่งที่เลือกให้เห็นลิงก์ได้ — dispatch มาจากธง can_dispatch ไม่ใช่ role */
export type LinkRoleKey = 'staff' | 'supervisor' | 'admin' | 'dispatch'

export interface WorkLink {
  id: number
  title: string
  url: string
  note: string | null
  sort_no: number
  is_active: boolean
  audience: LinkAudience
  updated_at: string
}

/** ลิงก์พร้อมรายชื่อผู้ชม — ใช้เฉพาะหน้าจัดการของเจ้าของระบบ */
export interface WorkLinkFull extends WorkLink {
  role_keys: LinkRoleKey[]
  dept_codes: string[]
  user_ids: string[]
}

/** ของหนึ่งอย่างในใบเบิก */
export interface CardItem {
  label: string
  sub: string | null
  unit: string
  /** จำนวนที่ต้องคืน · 0 = ไม่ต้องคืน (ของใช้แล้วหมด หรือถูกโอนไปแล้ว) */
  need: number
  taken: number
  returned: number
  state: 'consumed' | 'open' | 'partial' | 'returned' | 'transferred' | 'forced'
  note: string | null
}

/** การคืนหนึ่งครั้ง · ครั้งเดียวอาจคืนหลายอย่างพร้อมกัน */
export interface CardEvent {
  at: string
  by: string | null
  detail: string
  cond: string
  file_ids: string[]
}

/** หนึ่งใบเบิก = หนึ่งการ์ด */
/**
 * ประวัติแบบตัวหนังสือของสิ่งที่ถูกลบไปแล้ว
 *
 * เก็บแค่ข้อความกับลิงก์ไดร์ฟ ไม่เก็บรูปซ้ำ
 * รูปอยู่ในไดร์ฟอยู่แล้วและไดร์ฟไม่ใช่ข้อจำกัด ส่วนฐานข้อมูลเป็นข้อจำกัด
 */
export interface HistoryNote {
  id: number
  /** 'issue' แจ้งเสีย · 'asset' เบิกคืนเครื่อง · 'supply' เบิกวัสดุ · 'break' บัตรเบรค */
  kind: 'issue' | 'asset' | 'supply' | 'break'
  ref_no: string | null
  subject: string | null
  who: string | null
  happened_at: string | null
  body: string
  links: string | null
  photos: number
  reason: string | null
  archived_at: string
  archived_by_name: string | null
}

export interface ReturnCard {
  kind: 'supply' | 'asset'
  card_id: string
  ref_no: string
  taken_at: string
  user_id: string
  who: string
  employee_code: string
  dept_code: string | null
  sub_dept: string | null
  shift_start: string | null
  shift_end: string | null
  out_file_ids: string[]
  items: CardItem[]
  events: CardEvent[]
}

/** การคืนหนึ่งครั้งของบรรทัดเบิกหนึ่งบรรทัด */
export interface ReturnEvent {
  id: number
  qty: number
  condition: ReturnCond
  at: string
  by: string | null
  file_ids: string[]
}

/** หนึ่งบรรทัดที่เบิกออกไป พร้อมการคืนทุกครั้งของมัน */
export interface BorrowSet {
  line_id: number
  requisition_id: string
  ref_no: string
  taken_at: string
  hub_code: string
  requester_id: string
  who: string
  employee_code: string
  dept_code: string | null
  sub_dept: string | null
  shift_start: string | null
  shift_end: string | null
  item_id: number
  sku: string
  item_name: string
  unit: string
  is_returnable: boolean
  qty_taken: number
  qty_returned: number
  qty_open: number
  /** consumed = ใช้แล้วหมดไป · none/partial/full = ของยืม-คืน */
  return_state: 'consumed' | 'none' | 'partial' | 'full'
  out_file_ids: string[]
  returns: ReturnEvent[]
}

/** คนที่รับโอนเครื่องได้ */
export interface TransferTargetRow {
  id: string
  employee_code: string
  full_name: string
  dept_code: string | null
  sub_dept: string | null
}

/** แถบเตือนเรื่องการโอนเครื่อง — ขึ้นทั้งฝั่งที่ได้รับและฝั่งที่ถูกตัด */
export interface TransferNotice {
  id: number
  /** in = ถูกโอนมาให้แผนกเรา รอไปกดเบิก · out = ของเราถูกโอนออก ไม่ต้องคืนแล้ว */
  side: 'in' | 'out'
  asset_code: string
  type_name: string
  /** ชื่อคนที่รับโอน · ตั้งแต่ 041 โอนให้ "คน" ไม่ใช่ "แผนก" แล้ว */
  to_name: string | null
  /** แผนกปลายทางของการโอนยุคเก่า · แถวใหม่ว่างเสมอ */
  to_dept: string | null
  from_dept: string | null
  from_name: string | null
  by_name: string
  reason: string | null
  created_at: string
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

/** วัสดุหนึ่งบรรทัดในบาร์โค้ด BY ใบหนึ่ง */
export interface ByLine {
  item_id: number
  qty: number
  name: string
  sku: string
  unit: string
}

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
  item_id: number | null
  item_name: string | null
  item_sku: string | null
  item_unit: string | null
  qty: number | null
  /** รายการทั้งหมดในใบนี้ · ใบเก่าที่มีตัวเดียวก็มาเป็นบรรทัดเดียว */
  lines: ByLine[]
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
  item_id: number | null
  item_name: string | null
  qty_done: number
  total: number
  pending: number
  done: number
  rejected: number
}

/** หนึ่งแถวต่อหนึ่งเครื่องต่อหนึ่งครั้งที่เบิก — คืนแล้วแถวยังอยู่ */
export interface AssetHistoryRow {
  out_item_id: number
  asset_code: string
  type_code: string
  type_name: string
  asset_dept: string | null
  txn_id: string
  ref_no: string
  user_id: string
  who: string
  employee_code: string
  holder_dept: string | null
  sub_dept: string | null
  /** คนที่กดเบิกให้ · ว่าง = เจ้าตัวเบิกเอง */
  acted_by: string | null
  acted_by_name: string | null
  shift_start: string | null
  shift_end: string | null
  due_at: string | null
  taken_at: string
  returned_at: string | null
  return_ref: string | null
  /** คนที่กดปิดรายการจริง ๆ · คืนแทนจะเป็นชื่อแอดมิน ไม่ใช่ชื่อเจ้าตัว */
  returned_by: string | null
  /** true = ไม่ใช่เจ้าตัวกดคืนเอง */
  returned_by_proxy: boolean
  /** ปิดเพราะถูกโอนให้แผนกอื่น ไม่ใช่การคืนจริง */
  closed_by_transfer: boolean
  /** ปิดโดยแอดมินแบบไม่มีรูป */
  closed_forced: boolean
  /** เหตุผลที่คนกดพิมพ์ไว้ตอนปิด */
  return_note: string | null
  still_out: boolean
  held_hours: number | null
  /** รูปตอนเบิก และตอนคืน — หน้างานเปิดดูไม่ได้ เฉพาะแอดมิน */
  out_file_ids: string[]
  in_file_ids: string[]
}

/* ------------------------------------------------------ เช็คอินเข้าประชุม */

export type MeetingStatus = 'pending' | 'confirmed' | 'rejected'

export interface MeetingRow {
  id: string
  ref_no: string
  user_id: string
  full_name: string
  employee_code: string
  dept_code: string | null
  sub_dept: string | null
  shift_start: string | null
  shift_end: string | null
  note: string | null
  file_id: string
  web_link: string | null
  status: MeetingStatus
  decided_by: string | null
  decided_by_name: string | null
  decided_at: string | null
  decide_note: string | null
  created_at: string
  /** วันที่ตามเวลาไทย — ใช้จัดกลุ่มตามวันประชุม */
  day: string
}

/** สรุปรายคนในช่วงที่เลือก — รวมคนที่ไม่เคยเช็คอินเลยด้วย */
export interface MeetingStat {
  user_id: string
  full_name: string
  employee_code: string
  dept_code: string | null
  sub_dept: string | null
  confirmed: number
  pending: number
  rejected: number
  total: number
  last_at: string | null
}

/** นัดประชุมที่ประกาศไว้ — ผู้เข้าร่วมเป็นข้อความอิสระ ไม่ผูกกับตำแหน่งในระบบ */
/**
 * สถานะการเข้าประชุมรายคน
 *
 * waiting = ยังไม่ถึงเวลาสาย ยังลุ้นอยู่ · absent = เลยเวลาแล้วยังไม่เช็ค
 * คนที่ขึ้น absent ยังเดินมาสแกนได้ แล้วสถานะจะเปลี่ยนเป็น late เอง
 */
export type AttendState = 'ontime' | 'late' | 'absent' | 'excused' | 'waiting'

export interface RosterRow {
  user_id: string
  full_name: string
  employee_code: string
  dept_code: string | null
  checked_at: string | null
  ref_no: string | null
  /** สถานะที่ระบบคำนวณ เก็บไว้ให้เห็นแม้จะถูกแก้แล้ว */
  raw_state: AttendState
  /** สถานะที่ใช้จริง — ของผู้ตรวจสอบชนะ */
  state: AttendState
  late_min: number | null
  reason: string | null
  by_name: string | null
  changed_at: string | null
  /** รหัสใบเช็คอิน · ว่าง = คนนี้ไม่ได้ส่งใบมา จึงไม่มีอะไรให้ลบ */
  checkin_id: string | null
  file_id: string | null
  /** โน้ตที่เจ้าตัวพิมพ์มาเองตอนเช็คอิน คนละช่องกับเหตุผลที่ผู้ตรวจสอบใส่ */
  note: string | null
  status: MeetingStatus | null
  decided_by_name: string | null
  decide_note: string | null
}

export interface MeetingSummary {
  expected: number
  ontime: number
  late: number
  absent: number
  excused: number
  waiting: number
}

/** ใครต้องเข้าประชุม — ทุกคน · เลือกเจาะจง · พิมพ์เอง */
export type AudienceMode = 'all' | 'picked' | 'free'

/** รูปประกอบใบแจ้งซ่อม */
export interface IssuePhoto {
  seq: number
  file_id: string
  web_link: string | null
}

export interface IssueRow {
  id: number
  asset_code: string
  phase: string | null
  symptom: string
  reported_name: string | null
  reported_at: string
  file_id: string | null
  web_link: string | null
  resolved_at: string | null
  resolved_by_name: string | null
  resolve_note: string | null
  type_name: string | null
  photos: IssuePhoto[]
}

/** ระดับความสำคัญของประกาศ — คุมสีและคำนำหน้าในแจ้งเตือน */
export type NoticeLevel = 'urgent' | 'warn' | 'info'

export interface Announcement {
  id: string
  title: string
  body: string | null
  level: NoticeLevel
  expires_at: string
  notify: boolean
  created_by: string
  created_at: string
  cancelled_at: string | null
}

/**
 * นัดที่กำลังอยู่ในกรอบเวลา พร้อมตัวนับถอยหลังจากเซิร์ฟเวอร์
 *
 * ตัวเลขเป็น "อีกกี่วินาที" ไม่ใช่เวลาเป้าหมาย
 * เพราะถ้าส่งเวลาเป้าหมายมา หน้าจอจะเอาไปลบกับนาฬิกาเครื่องตัวเอง
 * ซึ่งเป็นสิ่งที่เราตั้งใจไม่เชื่อตั้งแต่แรก
 */
export interface MeetingWindow {
  id: string
  title: string
  meet_at: string
  place: string | null
  audience: string | null
  note: string | null
  phase: 'soon' | 'open' | 'late'
  opens_in_sec: number
  closes_in_sec: number
  late_by_sec: number
  checked_in: boolean
}

export interface MeetingEvent {
  id: string
  title: string
  meet_at: string
  open_before_min?: number
  late_after_min?: number
  audience: string | null
  place: string | null
  note: string | null
  created_by: string
  created_by_name: string
  created_at: string
  cancelled_at: string | null
  /** ปิดประชุมแล้วเมื่อไหร่ · ว่าง = ยังเปิดอยู่ กล้องเช็คชื่อยังใช้ได้ */
  closed_at?: string | null
  closed_by_name?: string | null
  audience_mode?: string
  day: string
}

/* ------------------------------------------------- กระจายกระสอบไปสาขา */

export interface SackPhoto {
  seq: number
  file_id: string
  web_link: string | null
}

/**
 * รายการกระสอบหนึ่งใบ
 *
 * pending = ตั้งไว้แล้วยังไม่มีใครกดส่ง
 * direct  = ส่งตรงถึงสาขาปลายทาง
 * relay   = ฝากสาขาอื่นส่งต่อ — relay_via จะมีค่าเสมอในกรณีนี้
 */
export interface SackRow {
  id: string
  ref_no: string
  hub_code: string
  qty: number
  unit: string
  branch: string
  note: string | null
  status: 'pending' | 'direct' | 'relay'
  relay_via: string | null
  created_at: string
  sent_at: string | null
  /** จำนวนที่ส่งไปจริง · ว่าง = ส่งเต็มตามที่ขอ ไม่ใช่ไม่รู้ */
  sent_qty: number | null
  /** หน่วยของจำนวนที่ส่ง · ว่าง = หน่วยเดียวกับที่ขอ */
  sent_unit: string | null
  /** จำนวนที่ใช้แสดงในใบ = sent_qty ถ้ามี ไม่งั้นเท่าที่ขอ */
  qty_out: number
  /** หน่วยที่ใช้แสดงในใบ */
  unit_out: string
  /** ส่งคนละหน่วยกับที่ขอ · เทียบจำนวนตรง ๆ ไม่ได้แล้ว */
  unit_differs: boolean
  /** ส่งไม่เท่าที่ขอ · จริงเฉพาะตอนหน่วยเดียวกัน */
  qty_differs: boolean
  /** แก้ไขล่าสุดเมื่อไหร่ · ว่าง = ยังไม่เคยถูกแก้ */
  updated_at: string | null
  created_by_name: string | null
  sent_by_name: string | null
  updated_by_name: string | null
  photos: SackPhoto[]
  photo_count: number
}

export interface SackBranch {
  branch: string
  used: number
  last_at: string
}

export interface SackRelay {
  via: string
  used: number
}

/** ใครจะได้รับแจ้งเตือนเมื่อมีรายการเข้าคิว — โชว์ให้คนตั้งรายการเห็นก่อนกด */
export interface SackNotifyTarget {
  full_name: string
  employee_code: string
  reason: string
  has_push: boolean
}

/* ------------------------------------ บัตรนำโทรศัพท์เข้าพื้นที่ของ OS */

export interface OsPerson {
  id: string
  os_code: string | null
  full_name: string
  affiliation: string | null
  shift: string | null
  phone_model: string | null
  imei: string | null
  nickname: string | null
  photo_file_id: string | null
  photo_link: string | null
  is_active: boolean
  note: string | null
  created_at: string
  updated_at: string | null
  /* จากวิว os_person_rows */
  card_id: string | null
  card_token: string | null
  card_rev: number | null
  card_issued_at: string | null
  has_card: boolean
  has_photo: boolean
  scan_count: number
  last_scan_at: string | null
}

export type OsScanResult = 'ok' | 'revoked' | 'unknown' | 'inactive'

/** สิ่งที่ รปภ เห็นทันทีหลังสแกน — ตอบครบในครั้งเดียว ไม่ต้องยิงต่อ */
export interface OsScanHit {
  scan_id: number
  result: OsScanResult
  person_id: string | null
  os_code: string | null
  full_name: string | null
  affiliation: string | null
  shift: string | null
  phone_model: string | null
  imei: string | null
  nickname: string | null
  photo_file_id: string | null
  card_rev: number | null
  revoked_at: string | null
  revoked_by_name: string | null
}

export interface OsScanRow {
  id: number
  scanned_at: string
  result: OsScanResult
  flag_reason: string | null
  flagged_at: string | null
  token: string
  person_id: string | null
  os_code: string | null
  full_name: string | null
  affiliation: string | null
  phone_model: string | null
  imei: string | null
  guard_name: string | null
  guard_code: string | null
}

/** แถวที่แกะได้จากการวางข้อมูลจากชีต — ยังไม่ได้บันทึก */
export interface OsImportRow {
  shift: string | null
  os_code: string | null
  full_name: string
  affiliation: string | null
  phone_model: string | null
  imei: string | null
  nickname: string | null
}

/**
 * ประวัติการโอนเครื่องทั้งฮับ — ใครโอนอะไรไปให้ใคร
 *
 * คนละตัวกับ TransferNotice ซึ่งเป็น "ของค้างอยู่ของฉัน" เท่านั้น
 * ตัวนี้เห็นทั้งหมดรวมของที่จบไปแล้ว เพราะเป็นหน้าไว้ดูย้อนหลัง
 */
export interface AssetTransferRow {
  id: number
  asset_code: string
  type_name: string
  asset_dept: string | null
  from_user_id: string | null
  from_name: string | null
  from_code: string | null
  from_dept: string | null
  to_user_id: string | null
  to_name: string | null
  to_code: string | null
  to_dept: string | null
  by_user_id: string | null
  by_name: string | null
  reason: string | null
  created_at: string
  claimed_at: string | null
  claimed_by_name: string | null
  ack_at: string | null
  cancelled_at: string | null
  cancelled_by_name: string | null
  cancel_reason: string | null
  /** claimed = ปลายทางรับแล้ว · waiting = ยังไม่มีใครกดรับ · cancelled = ยกเลิกแล้ว แต่ยังอยู่ในประวัติ */
  state: 'claimed' | 'waiting' | 'cancelled'
}

/** ใบแจ้งเสียทั้งฮับ พ่วงชื่อคนแจ้งและชื่อประเภทเครื่องมาให้แล้ว */
export interface AssetIssueRow {
  id: number
  asset_code: string
  type_name: string
  asset_dept: string | null
  symptom: string
  phase: AssetTxnKind | null
  reported_at: string
  reported_by_name: string | null
  reported_by_code: string | null
  file_id: string | null
  web_link: string | null
  resolved_at: string | null
  resolved_by_name: string | null
  resolve_note: string | null
  is_open: boolean
  /** รูปที่แนบตอนแจ้ง */
  report_shots: number
  /** รูปตอนซ่อมเสร็จ */
  fix_shots: number
  /** รูปตอนคืนของที่ใบนี้เกิดมาด้วยกัน · มีอยู่แล้วแต่เพิ่งถูกเอามาโชว์ */
  txn_shots: number
}


/** สิทธิ์เห็นเครื่องเฉพาะเครื่องของคนหนึ่งคน · ค้างไว้จนกว่าจะเอาออก */
export interface AssetGrantRow {
  asset_code: string
  type_name: string
  asset_dept: string | null
  user_id: string
  user_name: string
  user_code: string
  user_dept: string | null
  note: string | null
  granted_by_name: string | null
  created_at: string
}
