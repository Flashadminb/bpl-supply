// =====================================================================
// export-sheet — เขียนข้อมูลลง Google Sheet
//
// ห้าชุดแยกแท็บกัน แต่ละชุดแยกรายเดือนอีกที
//   เบิก-คืน 2569-09   วัสดุสิ้นเปลือง 1 แถวต่อ 1 รายการ
//   Asset 2569-09      อุปกรณ์ 1 แถวต่อ 1 เครื่องต่อครั้งที่เบิกหรือคืน
//   ชำรุด 2569-09      ใบแจ้งชำรุด 1 แถวต่อ 1 ใบ
//   บาร์โค้ด BY 2569-09  ของที่หน้างานส่งบาร์โค้ดมาให้ตัดสต็อกในระบบ BY
//   ประชุม 2569-09     เช็คอินเข้าประชุม — ลงคนละไฟล์ ดู GSHEET_MEETING_ID
//   กระสอบ 2569-09     กระสอบที่กระจายไปสาขา — ลงคนละไฟล์ ดู GSHEET_SACK_ID
//   สแกนบัตร OS 2569-09  ประวัติ รปภ สแกนบัตร — ลงคนละไฟล์ ดู GSHEET_OSSCAN_ID
//                        ไม่อยู่ใน scope 'all' ต้องขอ scope 'osscan' โดยเฉพาะ
//
// กันแถวซ้ำโดยจำตำแหน่งไว้ในฐานข้อมูล (แท็บ + เลขแถว)
// จึงไม่ต้องอ่านทั้งชีตมาเทียบทุกครั้ง — เร็วคงที่ไม่ว่าชีตจะใหญ่แค่ไหน
//
// ไฟล์นี้เขียนให้จบในตัวเอง ก๊อปวางใน Supabase Dashboard ได้ตรง ๆ
// secrets: GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY, GSHEET_ID
// ไม่บังคับ: GSHEET_MEETING_ID, GSHEET_SACK_ID, GSHEET_OSSCAN_ID (ไม่ตั้งก็ใช้ไฟล์ที่ฝังไว้ในโค้ด)
// =====================================================================

const VERSION = 'osscan-v12'
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

const HEADER = ['เลขที่คำขอ', 'วันเวลา', 'ผู้เบิก (ฮับ)', 'วัสดุ', 'จำนวน', 'หลักฐาน', 'Drive File ID']

const ASSET_HEADER = [
  'เลขที่',
  'วันเวลา',
  'รายการ',
  'ผู้ทำรายการ',
  'รหัสพนักงาน',
  'แผนก',
  'กะ',
  'ประเภท',
  'รหัสเครื่อง',
  'กำหนดคืน',
  'หลักฐาน',
  'Drive File ID',
]

const ISSUE_HEADER = [
  'วันที่แจ้ง',
  'รหัสเครื่อง',
  'ประเภท',
  'อาการ',
  'แจ้งตอน',
  'ผู้แจ้ง',
  'รหัสพนักงาน',
  'สถานะ',
  'วันที่เคลียร์',
  'เลขที่รายการ',
]

const BY_HEADER = [
  'เลขที่',
  'วันเวลา',
  'ผู้ส่ง',
  'รหัสพนักงาน',
  'แผนก',
  'กะ',
  'เหตุผล',
  'หมายเหตุ',
  'จำนวนรูป',
  'สถานะ',
  'เวลาที่ตัดสต็อก',
  'หลักฐาน',
  'Drive File ID',
]

// ไฟล์รายชื่อประชุมแยกจากไฟล์เบิก-คืน · ตั้ง GSHEET_MEETING_ID ทับได้ถ้าย้ายไฟล์
const MEETING_SHEET_ID = '15_ES88gZhq8ZWBaAwoFekP-3o3HKnNW52jPimSIjHRY'
const SACK_SHEET_ID = '1ZqSEG1dTPlCcC9mAJJSwcOQz8vdXyF9rF-RfzB5bvSI'
const OSSCAN_SHEET_ID = '1Suklni1sHj_waOIRMnu4TU71D8Cdujju6eJbFSddQ74'

/**
 * ประวัติการสแกนบัตร OS ที่ป้อม
 *
 * ชีตนี้ทำหน้าที่เป็นที่เก็บระยะยาวด้วย ไม่ใช่แค่สำเนาไว้ดู
 * เพราะ os_scans_rollup ยุบรายละเอียดรายครั้งทิ้งหลังผ่านไปอย่างน้อย 30 วัน
 * เหลือไว้แค่สรุปรายวัน ของที่ไม่ได้ส่งลงชีตก่อนถึงรอบยุบจึงหายไปเลย
 *
 * ใส่ IMEI กับรุ่นเครื่อง ณ ตอนที่ส่งออก ไม่ใช่ ณ ตอนที่สแกน
 * ถ้าคนเปลี่ยนเครื่องแล้วแก้ทะเบียน แถวเก่าในชีตจะเปลี่ยนตามตอนส่งซ้ำ
 * ซึ่งยอมรับได้ เพราะสิ่งที่ต้องตรวจย้อนหลังคือใครเข้าเมื่อไหร่และติดธงไหม
 */
const OSSCAN_HEADER = [
  'วันเวลาที่สแกน',
  'ผล',
  'รหัส OS',
  'ชื่อ-นามสกุล',
  'สังกัด',
  'รุ่นเครื่อง',
  'IMEI',
  'ติดธง',
  'เหตุผลที่ติดธง',
  'เวลาที่ติดธง',
  'รปภ ที่สแกน',
  'รหัส รปภ',
]

/** ผลการสแกนเป็นภาษาคน — ตรงกับที่ รปภ เห็นบนจอตอนสแกน */
function scanResultText(result: string | null): string {
  if (result === 'ok') return 'ผ่าน'
  if (result === 'revoked') return 'บัตรถูกยกเลิก'
  if (result === 'unknown') return 'ไม่รู้จักบัตรนี้'
  if (result === 'inactive') return 'คนนี้ถูกปิดการใช้งาน'
  return result ?? ''
}

// เรียงตามที่เจ้าของระบบขอมา: ฮับ จำนวน สาขา สถานะ แล้วค่อยรูป
// ของที่ยังไม่ได้ส่งก็ลงชีตด้วย ส่วนกลางจะได้เห็นคิวที่ค้าง ไม่ใช่เห็นแต่ของที่ไปแล้ว
const SACK_HEADER = [
  'เลขที่',
  'HUB ที่จัดส่ง',
  'จำนวน',
  'หน่วย',
  'สาขาที่ขอ',
  'สถานะการส่ง',
  'ฝากผ่านสาขา',
  'ผู้ส่ง',
  'วันเวลาที่ส่ง',
  'หมายเหตุ',
  'จำนวนรูป',
  'หลักฐาน',
  'Drive File ID',
  'ผู้ตั้งรายการ',
  'วันเวลาที่ตั้ง',
]

/**
 * สถานะการเข้าประชุมเป็นภาษาคน
 *
 * คนละเรื่องกับคอลัมน์ "สถานะ" ที่มีอยู่เดิม
 * อันเดิมคือผู้ตรวจสอบรับรองรูปเซลฟี่ · อันนี้คือมาทันเวลาไหม
 * รูปผ่านแต่มาสายก็มี รูปไม่ผ่านแต่มาตรงเวลาก็มี
 */
function attendText(state: string | null): string {
  switch (state) {
    case 'ontime':
      return 'ตรงเวลา'
    case 'late':
      return 'มาสาย'
    case 'absent':
      return 'ขาดประชุม'
    case 'excused':
      return 'ผ่อนผัน'
    default:
      return ''
  }
}

const MEETING_HEADER = [
  'เลขที่',
  'วันเวลาเช็คอิน',
  'ชื่อ',
  'รหัสพนักงาน',
  'แผนก',
  'กะ',
  'สถานะ',
  'ผู้ตรวจสอบ',
  'เวลาที่ตรวจ',
  'หมายเหตุผู้ตรวจ',
  'หมายเหตุผู้เช็คอิน',
  'รูปเซลฟี่',
  'Drive File ID',
  // ── เพิ่มใหม่ ต่อท้าย ชีตเก่าจึงยังอ่านคอลัมน์เดิมได้ตรงตำแหน่ง
  'การประชุม',
  'สถานะการเข้า',
  'สายกี่นาที',
  'เหตุผลที่แก้',
  'ผู้แก้สถานะ',
  'เวลาที่แก้',
]

interface DbMeeting {
  id: string
  ref_no: string
  created_at: string
  full_name: string | null
  employee_code: string | null
  dept_code: string | null
  sub_dept: string | null
  shift_start: string | null
  shift_end: string | null
  note: string | null
  file_id: string | null
  status: string
  decided_by_name: string | null
  decided_at: string | null
  decide_note: string | null
  event_title: string | null
  attend_state: string | null
  late_min: number | null
  attend_reason: string | null
  attend_by_name: string | null
  attend_at: string | null
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function envOrThrow(name: string): string {
  const v = Deno.env.get(name)
  if (!v) throw new Error(`ยังไม่ได้ตั้งค่า secret: ${name}`)
  return v
}

function envAny(...names: string[]): string {
  for (const n of names) {
    const v = Deno.env.get(n)
    if (v) return v
  }
  throw new Error(`ยังไม่ได้ตั้งค่า secret สักตัวจาก: ${names.join(', ')}`)
}

const serviceKey = () => envAny('SUPABASE_SERVICE_ROLE_KEY', 'SB_SECRET_KEY', 'SUPABASE_SECRET_KEY')
const publicKey = () =>
  envAny('SUPABASE_ANON_KEY', 'SB_PUBLISHABLE_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY')

function b64url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes)
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '')
  const bin = atob(body)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer
}

let cached: { token: string; expires: number } | null = null

async function getAccessToken(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token
  const email = envOrThrow('GOOGLE_SA_EMAIL')
  const pem = envOrThrow('GOOGLE_SA_PRIVATE_KEY')
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(
    JSON.stringify({
      iss: email,
      scope: SHEETS_SCOPE,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  )
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claim}`)),
  )
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claim}.${b64url(sig)}`,
    }),
  })
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string }
  if (!res.ok || !data.access_token) {
    throw new Error(`ขอ token จาก Google ไม่สำเร็จ: ${data.error_description ?? res.status}`)
  }
  cached = { token: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 }
  return cached.token
}

async function requireUser(req: Request): Promise<void> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) throw new Error('ต้องเข้าสู่ระบบก่อน')
  const res = await fetch(`${envOrThrow('SUPABASE_URL')}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: publicKey() },
  })
  if (!res.ok) throw new Error('เซสชันหมดอายุ เข้าสู่ระบบใหม่')
}

/**
 * PostgREST ส่งกลับมาสูงสุดพันแถวต่อครั้ง (db-max-rows) ไม่ว่าจะขออะไรไป
 * ไม่ได้แจ้งว่าตัดนะ ตอบ 200 มาเฉย ๆ เหมือนดึงมาครบแล้ว
 *
 * ผลคือพอ Asset เกินพันบรรทัด การส่งออกจะวนส่งพันบรรทัดแรกซ้ำ ๆ ทุกครั้ง
 * ส่วนบรรทัดใหม่ไม่เคยถูกดึงมาเลย ตัวเลข "ยังไม่ส่ง" จึงไม่มีวันลด
 * และหน้าจอก็บอกว่าสำเร็จทุกครั้ง เพราะฝั่งเซิร์ฟเวอร์ไม่ได้ผิดพลาดอะไร
 *
 * ไล่ทีละหน้าจนกว่าจะหมดจริง ต้องมี order ที่ไม่ซ้ำกันกำกับเสมอ
 * ไม่งั้นแถวจะสลับหน้ากันแล้วหายหรือซ้ำ
 */
const PAGE = 1000

async function dbPaged<T>(path: string): Promise<T[]> {
  const key = serviceKey()
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${envOrThrow('SUPABASE_URL')}/rest/v1/${path}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Range-Unit': 'items',
        Range: `${from}-${from + PAGE - 1}`,
      },
    })
    // ขอเลยแถวสุดท้ายพอดีจะได้ 416 กลับมา ซึ่งแปลว่าหมดแล้ว ไม่ใช่ว่าพัง
    if (res.status === 416) break
    const text = await res.text()
    if (!res.ok) throw new Error(text || `ฐานข้อมูลตอบกลับ HTTP ${res.status}`)
    const page = (text ? JSON.parse(text) : []) as T[]
    if (!Array.isArray(page) || page.length === 0) break
    out.push(...page)
    if (page.length < PAGE) break
  }
  return out
}

/**
 * หาว่าแถวไหนเคยลงชีตไว้ตรงไหนแล้ว
 *
 * เดิมยัดคีย์ทั้งหมดลง in.(...) ทีเดียว ซึ่งพังสองทางเมื่อของเยอะขึ้น
 * URL ยาวเกินจนโดนปฏิเสธ และผลลัพธ์ก็โดนตัดที่พันแถวอีกชั้น
 * แบ่งเป็นก้อนละสองร้อยแล้วรวมกัน ใช้ได้ทั้งคีย์ตัวเลขและ uuid
 */
async function lookupPlaced(
  table: string,
  keyCol: string,
  keys: RowKey[],
): Promise<Map<RowKey, { tab: string; row_no: number }>> {
  const placed = new Map<RowKey, { tab: string; row_no: number }>()
  const quote = (k: RowKey) => (typeof k === 'number' ? String(k) : `"${k}"`)
  for (let i = 0; i < keys.length; i += 200) {
    const batch = keys.slice(i, i + 200).map(quote).join(',')
    const rows = await dbPaged<Record<string, unknown>>(
      `${table}?${keyCol}=in.(${batch})&select=${keyCol},tab,row_no`,
    )
    for (const r of rows) {
      placed.set(r[keyCol] as RowKey, { tab: r.tab as string, row_no: r.row_no as number })
    }
  }
  return placed
}

async function db<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = serviceKey()
  const res = await fetch(`${envOrThrow('SUPABASE_URL')}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(text || `ฐานข้อมูลตอบกลับ HTTP ${res.status}`)
  return (text ? JSON.parse(text) : null) as T
}

/* ------------------------------------------------------------ Sheets API */

const api = (id: string, path: string, qs = '') =>
  `https://sheets.googleapis.com/v4/spreadsheets/${id}${path}${qs}`

async function gfetch(url: string, token: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`)
  return data
}

/** A, B, C … สำหรับหัวตารางกว้างเท่าไหร่ก็ได้ */
const colLetter = (n: number) => String.fromCharCode(64 + n)

/* ------------------------------------------------------------------ data */

interface DbLine {
  id: number
  qty_requested: number
  qty_approved: number | null
  status: string
  items: { sku: string; name: string; unit: string } | null
}

interface DbReq {
  id: string
  ref_no: string
  created_at: string
  hub_code: string
  evidence_file_id: string | null
  profiles: { full_name: string } | null
  requisition_photos: { file_id: string }[] | null
  requisition_items: DbLine[]
}

interface DbAssetItem {
  id: number
  asset_code: string
  out_item_id: number | null
  assets: { type_code: string; asset_types: { name: string } | null } | null
  asset_txns: {
    ref_no: string
    kind: string
    created_at: string
    dept_code: string | null
    shift_start: string | null
    shift_end: string | null
    due_at: string | null
    profiles: { full_name: string; employee_code: string; sub_dept: string | null } | null
    asset_txn_photos: { file_id: string }[] | null
  } | null
}

interface DbSack {
  id: string
  ref_no: string
  hub_code: string
  qty: number
  unit: string
  branch: string
  note: string | null
  status: string
  relay_via: string | null
  created_at: string
  sent_at: string | null
  created_by_name: string | null
  sent_by_name: string | null
  photos: { seq: number; file_id: string; web_link: string | null }[] | null
  photo_count: number
}

interface DbOsScan {
  id: number
  scanned_at: string
  result: string | null
  flag_reason: string | null
  flagged_at: string | null
  os_code: string | null
  full_name: string | null
  affiliation: string | null
  phone_model: string | null
  imei: string | null
  guard_name: string | null
  guard_code: string | null
}

interface DbBy {
  id: string
  ref_no: string
  created_at: string
  reason: string
  note: string | null
  status: string
  dept_code: string | null
  sub_dept: string | null
  shift_start: string | null
  shift_end: string | null
  handled_at: string | null
  profiles: { full_name: string; employee_code: string } | null
  by_barcode_photos: { file_id: string }[] | null
}

interface DbIssue {
  id: number
  asset_code: string
  symptom: string
  phase: string | null
  reported_at: string
  reported_name: string | null
  resolved_at: string | null
  assets: { asset_types: { name: string } | null } | null
  profiles: { full_name: string; employee_code: string } | null
  asset_txns: { ref_no: string } | null
}

/** เดือน พ.ศ. ของแท็บ เช่น "2569-09" */
function monthOf(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(iso))
  const y = Number(parts.find((p) => p.type === 'year')?.value ?? '0') + 543
  const m = parts.find((p) => p.type === 'month')?.value ?? '01'
  return `${y}-${m}`
}

function thaiDateTime(iso: string): string {
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

/** สร้างแท็บถ้ายังไม่มี พร้อมใส่หัวตาราง คืนจำนวนแถวที่มีอยู่แล้ว */
async function ensureTab(
  sheetId: string,
  tab: string,
  token: string,
  header: string[],
): Promise<number> {
  const end = colLetter(header.length)
  const meta = (await gfetch(api(sheetId, ''), token)) as {
    sheets?: { properties?: { title?: string } }[]
  }
  const found = (meta.sheets ?? []).find((s) => s.properties?.title === tab)

  const writeHeader = async () => {
    await gfetch(
      api(sheetId, `/values/${encodeURIComponent(`${tab}!A1:${end}1`)}`, '?valueInputOption=RAW'),
      token,
      { method: 'PUT', body: JSON.stringify({ values: [header] }) },
    )
  }

  if (!found) {
    await gfetch(api(sheetId, ':batchUpdate'), token, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab } } }] }),
    })
    await writeHeader()
    return 1
  }

  // อ่านแค่คอลัมน์ A เพื่อรู้ว่าตอนนี้มีกี่แถว ไม่ได้อ่านข้อมูลทั้งชีต
  const col = (await gfetch(api(sheetId, `/values/${encodeURIComponent(`${tab}!A:A`)}`), token)) as {
    values?: string[][]
  }
  const used = col.values?.length ?? 0
  if (used === 0) {
    await writeHeader()
    return 1
  }
  return used
}

/** ตัวชี้แถว — เลขสำหรับของสิ้นเปลืองกับ Asset, uuid สำหรับบาร์โค้ด BY */
type RowKey = number | string

interface OutRow {
  key: RowKey
  tab: string
  values: (string | number)[]
}

/**
 * เขียนแถวลงชีต — ที่เคยส่งแล้วเขียนทับตำแหน่งเดิม ที่ยังไม่เคยส่งต่อท้าย
 * คืนตำแหน่งของแถวใหม่ไว้ให้คนเรียกเอาไปจำต่อ
 */
async function pushRows(
  sheetId: string,
  token: string,
  rows: OutRow[],
  placed: Map<RowKey, { tab: string; row_no: number }>,
  header: string[],
): Promise<{ updated: number; appended: number; fresh: OutRow[]; rowNos: number[]; tabs: string[] }> {
  const end = colLetter(header.length)
  const tabs = new Set<string>()
  let updated = 0
  let appended = 0

  const updates = rows
    .filter((r) => placed.has(r.key))
    .map((r) => {
      const p = placed.get(r.key) as { tab: string; row_no: number }
      tabs.add(p.tab)
      return { range: `${p.tab}!A${p.row_no}:${end}${p.row_no}`, values: [r.values] }
    })

  if (updates.length > 0) {
    await gfetch(api(sheetId, '/values:batchUpdate'), token, {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: updates }),
    })
    updated = updates.length
  }

  const fresh: OutRow[] = []
  const rowNos: number[] = []
  const byTab = new Map<string, OutRow[]>()
  for (const r of rows.filter((x) => !placed.has(x.key))) {
    const arr = byTab.get(r.tab)
    if (arr) arr.push(r)
    else byTab.set(r.tab, [r])
  }

  for (const [tab, list] of byTab) {
    const startRow = await ensureTab(sheetId, tab, token, header)
    await gfetch(
      api(
        sheetId,
        `/values/${encodeURIComponent(`${tab}!A1`)}:append`,
        '?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS',
      ),
      token,
      { method: 'POST', body: JSON.stringify({ values: list.map((r) => r.values) }) },
    )
    list.forEach((r, i) => {
      fresh.push(r)
      rowNos.push(startRow + 1 + i)
    })
    appended += list.length
    tabs.add(tab)
  }

  return { updated, appended, fresh, rowNos, tabs: [...tabs] }
}

const driveLink = (id: string, text: string) =>
  `=HYPERLINK("https://drive.google.com/file/d/${id}/view";"${text}")`

const shiftText = (a: string | null, b: string | null) =>
  a && b ? `${a.slice(0, 5)}–${b.slice(0, 5)}` : ''

/* ------------------------------------------------------------------ serve */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method === 'GET') return json({ name: 'export-sheet', version: VERSION })
  if (req.method !== 'POST') return json({ error: 'ใช้ได้เฉพาะ POST' }, 405)

  try {
    await requireUser(req)
    const payload = (await req.json().catch(() => ({}))) as {
      requisitionId?: string
      from?: string
      to?: string
      hub?: string
      /** 'all' (ค่าเริ่มต้น) | 'supply' | 'asset' | 'by' | 'meeting' | 'sack' | 'osscan' */
      scope?: string
    }

    const sheetId = envOrThrow('GSHEET_ID')
    const scope = payload.scope ?? 'all'
    const token = await getAccessToken()

    let updated = 0
    let appended = 0
    const tabs = new Set<string>()

    /* ------------------------------------------------ วัสดุสิ้นเปลือง */
    if (scope === 'all' || scope === 'supply') {
      const select =
        'id,ref_no,created_at,hub_code,evidence_file_id,' +
        'profiles!requisitions_requester_id_fkey(full_name),' +
        'requisition_photos(file_id),' +
        'requisition_items(id,qty_requested,qty_approved,status,items(sku,name,unit))'

      const qs = new URLSearchParams({ select })
      if (payload.requisitionId) {
        qs.set('id', `eq.${payload.requisitionId}`)
      } else {
        if (payload.from) qs.append('created_at', `gte.${payload.from}`)
        if (payload.to) qs.append('created_at', `lte.${payload.to}`)
        if (payload.hub) qs.set('hub_code', `eq.${payload.hub}`)
      }
      qs.set('order', 'created_at.asc,id.asc')

      const reqs = await dbPaged<DbReq>(`requisitions?${qs}`)
      const rows: OutRow[] = []
      for (const r of reqs) {
        const photos = (r.requisition_photos ?? []).map((p) => p.file_id)
        const count = Math.max(photos.length, r.evidence_file_id ? 1 : 0)
        const mainId = r.evidence_file_id ?? photos[0] ?? null
        const linkText = count > 1 ? `ดูรูป (${count} ใบ)` : 'ดูรูป'

        for (const l of r.requisition_items ?? []) {
          if (l.status === 'rejected') continue
          rows.push({
            key: l.id,
            tab: `เบิก-คืน ${monthOf(r.created_at)}`,
            values: [
              r.ref_no,
              thaiDateTime(r.created_at),
              `${r.profiles?.full_name ?? '—'} (${r.hub_code})`,
              l.items?.name ?? '',
              `${l.qty_approved ?? l.qty_requested} ${l.items?.unit ?? ''}`,
              mainId ? driveLink(mainId, linkText) : '',
              photos.length > 1 ? photos.join(' ') : (mainId ?? ''),
            ],
          })
        }
      }

      if (rows.length > 0) {
        const placed = await lookupPlaced('sheet_exports', 'requisition_item_id', rows.map((r) => r.key))
        const out = await pushRows(sheetId, token, rows, placed, HEADER)
        updated += out.updated
        appended += out.appended
        out.tabs.forEach((t) => tabs.add(t))

        if (out.fresh.length > 0) {
          await db('sheet_exports?on_conflict=requisition_item_id', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(
              out.fresh.map((r, i) => ({
                requisition_item_id: r.key,
                tab: r.tab,
                row_no: out.rowNos[i],
              })),
            ),
          })
        }
      }
    }

    /* --------------------------------------------------------- Asset */
    if (scope === 'all' || scope === 'asset') {
      const select =
        'id,asset_code,out_item_id,' +
        // ต้องระบุชื่อ FK ให้ชัด เพราะ assets กับ asset_txn_items ผูกกันสองทาง
        // (asset_txn_items.asset_code -> assets.code และ assets.held_item_id -> asset_txn_items.id)
        // เขียนแค่ assets(...) PostgREST จะไม่รู้ว่าหมายถึงทางไหน แล้วตอบ PGRST201
        'assets!asset_txn_items_asset_code_fkey(type_code,asset_types(name)),' +
        'asset_txns!inner(ref_no,kind,created_at,dept_code,shift_start,shift_end,due_at,' +
        // asset_txns ชี้ไป profiles สองทางตั้งแต่เพิ่มการเบิกแทน
        // (user_id = คนที่ของไปอยู่ด้วย · acted_by = คนที่กดให้)
        // เขียนแค่ profiles(...) PostgREST เลือกไม่ถูกแล้วตอบ PGRST201
        // ชีตต้องการชื่อ "ผู้เบิก" จึงต้องระบุเส้น user_id ให้ชัด
        'profiles!asset_txns_user_id_fkey(full_name,employee_code,sub_dept),' +
        'asset_txn_photos(file_id))'

      const qs = new URLSearchParams({ select, order: 'id.asc' })
      if (payload.from) qs.append('asset_txns.created_at', `gte.${payload.from}`)
      if (payload.to) qs.append('asset_txns.created_at', `lte.${payload.to}`)

      const items = await dbPaged<DbAssetItem>(`asset_txn_items?${qs}`)
      const rows: OutRow[] = []
      for (const it of items) {
        const t = it.asset_txns
        if (!t) continue
        const photos = (t.asset_txn_photos ?? []).map((p) => p.file_id)
        const mainId = photos[0] ?? null
        const linkText = photos.length > 1 ? `ดูรูป (${photos.length} ใบ)` : 'ดูรูป'
        const dept = [t.dept_code ?? '', t.profiles?.sub_dept ?? ''].filter(Boolean).join(' · ')

        rows.push({
          key: it.id,
          tab: `Asset ${monthOf(t.created_at)}`,
          values: [
            t.ref_no,
            thaiDateTime(t.created_at),
            t.kind === 'out' ? 'เบิก' : 'คืน',
            t.profiles?.full_name ?? '—',
            t.profiles?.employee_code ?? '',
            dept,
            shiftText(t.shift_start, t.shift_end),
            it.assets?.asset_types?.name ?? it.assets?.type_code ?? '',
            it.asset_code,
            t.kind === 'out' && t.due_at ? thaiDateTime(t.due_at) : '',
            mainId ? driveLink(mainId, linkText) : '',
            photos.join(' '),
          ],
        })
      }

      if (rows.length > 0) {
        const placed = await lookupPlaced('asset_sheet_exports', 'asset_txn_item_id', rows.map((r) => r.key))
        const out = await pushRows(sheetId, token, rows, placed, ASSET_HEADER)
        updated += out.updated
        appended += out.appended
        out.tabs.forEach((t) => tabs.add(t))

        if (out.fresh.length > 0) {
          await db('asset_sheet_exports?on_conflict=asset_txn_item_id', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(
              out.fresh.map((r, i) => ({
                asset_txn_item_id: r.key,
                tab: r.tab,
                row_no: out.rowNos[i],
              })),
            ),
          })
        }
      }

      /* ----------------------------------------------------- ใบแจ้งชำรุด */
      const iqs = new URLSearchParams({
        select:
          'id,asset_code,symptom,phase,reported_at,reported_name,resolved_at,' +
          'assets(asset_types(name)),' +
          'profiles!asset_issues_reported_by_fkey(full_name,employee_code),' +
          'asset_txns(ref_no)',
        order: 'reported_at.asc,id.asc',
      })
      if (payload.from) iqs.append('reported_at', `gte.${payload.from}`)
      if (payload.to) iqs.append('reported_at', `lte.${payload.to}`)

      const issues = await dbPaged<DbIssue>(`asset_issues?${iqs}`)
      const irows: OutRow[] = issues.map((i) => ({
        key: i.id,
        tab: `ชำรุด ${monthOf(i.reported_at)}`,
        values: [
          thaiDateTime(i.reported_at),
          i.asset_code,
          i.assets?.asset_types?.name ?? '',
          i.symptom,
          i.phase === 'out' ? 'ตอนเบิก' : i.phase === 'in' ? 'ตอนคืน' : '',
          i.profiles?.full_name ?? i.reported_name ?? '—',
          i.profiles?.employee_code ?? '',
          i.resolved_at ? 'เคลียร์แล้ว' : 'ยังค้าง',
          i.resolved_at ? thaiDateTime(i.resolved_at) : '',
          i.asset_txns?.ref_no ?? '',
        ],
      }))

      if (irows.length > 0) {
        const placed = await lookupPlaced('asset_issue_exports', 'issue_id', irows.map((r) => r.key))
        const out = await pushRows(sheetId, token, irows, placed, ISSUE_HEADER)
        updated += out.updated
        appended += out.appended
        out.tabs.forEach((t) => tabs.add(t))

        if (out.fresh.length > 0) {
          await db('asset_issue_exports?on_conflict=issue_id', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(
              out.fresh.map((r, i) => ({ issue_id: r.key, tab: r.tab, row_no: out.rowNos[i] })),
            ),
          })
        }
      }
    }

    /* ---------------------------------------------------- บาร์โค้ด BY */
    if (scope === 'all' || scope === 'by') {
      const bqs = new URLSearchParams({
        select:
          'id,ref_no,created_at,reason,note,status,dept_code,sub_dept,shift_start,shift_end,handled_at,' +
          'profiles!by_barcodes_user_id_fkey(full_name,employee_code),by_barcode_photos(file_id)',
        order: 'created_at.asc,id.asc',
      })
      if (payload.from) bqs.append('created_at', `gte.${payload.from}`)
      if (payload.to) bqs.append('created_at', `lte.${payload.to}`)

      const list = await dbPaged<DbBy>(`by_barcodes?${bqs}`)
      const brows: OutRow[] = list.map((b) => {
        const photos = (b.by_barcode_photos ?? []).map((p) => p.file_id)
        const mainId = photos[0] ?? null
        const linkText = photos.length > 1 ? `ดูรูป (${photos.length} ใบ)` : 'ดูรูป'
        return {
          key: b.id,
          tab: `บาร์โค้ด BY ${monthOf(b.created_at)}`,
          values: [
            b.ref_no,
            thaiDateTime(b.created_at),
            b.profiles?.full_name ?? '—',
            b.profiles?.employee_code ?? '',
            [b.dept_code ?? '', b.sub_dept ?? ''].filter(Boolean).join(' · '),
            shiftText(b.shift_start, b.shift_end),
            b.reason,
            b.note ?? '',
            photos.length,
            b.status === 'done' ? 'ตัดสต็อกแล้ว' : b.status === 'rejected' ? 'ไม่รับ' : 'รอตัดสต็อก',
            b.handled_at ? thaiDateTime(b.handled_at) : '',
            mainId ? driveLink(mainId, linkText) : '',
            photos.join(' '),
          ],
        }
      })

      if (brows.length > 0) {
        const placed = await lookupPlaced('by_sheet_exports', 'by_id', brows.map((r) => r.key))
        const out = await pushRows(sheetId, token, brows, placed, BY_HEADER)
        updated += out.updated
        appended += out.appended
        out.tabs.forEach((t) => tabs.add(t))

        if (out.fresh.length > 0) {
          await db('by_sheet_exports?on_conflict=by_id', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(
              out.fresh.map((r, i) => ({ by_id: r.key, tab: r.tab, row_no: out.rowNos[i] })),
            ),
          })
        }
      }
    }

    /* ------------------------------------------------- เช็คอินเข้าประชุม */
    // ลงคนละไฟล์กับของเบิก เพราะเป็นคนละเรื่องและคนดูก็คนละคน
    // ปนกันแล้วคนที่เปิดดูรายชื่อประชุมต้องเลื่อนผ่านแท็บเบิกของทุกเดือน
    if (scope === 'all' || scope === 'meeting') {
      const meetSheet = Deno.env.get('GSHEET_MEETING_ID') || MEETING_SHEET_ID
      const mqs = new URLSearchParams({
        select:
          'id,ref_no,created_at,full_name,employee_code,dept_code,sub_dept,' +
          'shift_start,shift_end,note,file_id,status,decided_by_name,decided_at,decide_note,' +
          'event_title,attend_state,late_min,attend_reason,attend_by_name,attend_at',
        order: 'created_at.asc,id.asc',
      })
      if (payload.from) mqs.append('created_at', `gte.${payload.from}`)
      if (payload.to) mqs.append('created_at', `lte.${payload.to}`)

      const meets = await dbPaged<DbMeeting>(`meeting_rows?${mqs}`)
      const mrows: OutRow[] = meets.map((m) => ({
        key: m.id,
        tab: `ประชุม ${monthOf(m.created_at)}`,
        values: [
          m.ref_no,
          thaiDateTime(m.created_at),
          m.full_name ?? '—',
          m.employee_code ?? '',
          [m.dept_code ?? '', m.sub_dept ?? ''].filter(Boolean).join(' · '),
          shiftText(m.shift_start, m.shift_end),
          m.status === 'confirmed' ? 'ยืนยันแล้ว' : m.status === 'rejected' ? 'ไม่นับ' : 'รอตรวจ',
          m.decided_by_name ?? '',
          m.decided_at ? thaiDateTime(m.decided_at) : '',
          m.decide_note ?? '',
          m.note ?? '',
          m.file_id ? driveLink(m.file_id, 'ดูรูป') : '',
          m.file_id ?? '',
          m.event_title ?? '',
          attendText(m.attend_state),
          m.attend_state === 'late' && m.late_min ? String(m.late_min) : '',
          m.attend_reason ?? '',
          m.attend_by_name ?? '',
          m.attend_at ? thaiDateTime(m.attend_at) : '',
        ],
      }))

      if (mrows.length > 0) {
        const placed = await lookupPlaced('meeting_sheet_exports', 'meeting_id', mrows.map((r) => r.key))
        const out = await pushRows(meetSheet, token, mrows, placed, MEETING_HEADER)
        updated += out.updated
        appended += out.appended
        out.tabs.forEach((t) => tabs.add(t))

        if (out.fresh.length > 0) {
          await db('meeting_sheet_exports?on_conflict=meeting_id', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(
              out.fresh.map((r, i) => ({ meeting_id: r.key, tab: r.tab, row_no: out.rowNos[i] })),
            ),
          })
        }
      }
    }

    /* --------------------------------------------- กระสอบที่กระจายไปสาขา */
    // ลงคนละไฟล์กับของเบิก คนที่เปิดดูคือส่วนกลาง ไม่ใช่คนที่ดูยอดเบิกของฮับ
    //
    // แท็บผูกกับเดือนที่ "ตั้งรายการ" ไม่ใช่เดือนที่ส่ง
    // เพราะใบที่ตั้งสิ้นเดือนแล้วส่งต้นเดือนถัดไปจะย้ายแท็บ
    // แล้วแถวเดิมจะค้างอยู่ที่เก่าโดยไม่มีใครลบ
    if (scope === 'all' || scope === 'sack') {
      const sackSheet = Deno.env.get('GSHEET_SACK_ID') || SACK_SHEET_ID
      const sqs = new URLSearchParams({
        select:
          'id,ref_no,hub_code,qty,unit,branch,note,status,relay_via,created_at,sent_at,' +
          'created_by_name,sent_by_name,photos,photo_count',
        order: 'created_at.asc,id.asc',
      })
      if (payload.from) sqs.append('created_at', `gte.${payload.from}`)
      if (payload.to) sqs.append('created_at', `lte.${payload.to}`)

      const sacks = await dbPaged<DbSack>(`sack_rows?${sqs}`)
      const srows: OutRow[] = sacks.map((s) => {
        const ids = (s.photos ?? []).map((p) => p.file_id)
        const mainId = ids[0] ?? null
        const linkText = ids.length > 1 ? `ดูรูป (${ids.length} ใบ)` : 'ดูรูป'
        return {
          key: s.id,
          tab: `กระสอบ ${monthOf(s.created_at)}`,
          values: [
            s.ref_no,
            s.hub_code,
            s.qty,
            s.unit,
            s.branch,
            s.status === 'direct' ? 'ส่งตรง' : s.status === 'relay' ? 'ฝากส่ง' : 'รอส่ง',
            s.relay_via ?? '',
            s.sent_by_name ?? '',
            s.sent_at ? thaiDateTime(s.sent_at) : '',
            s.note ?? '',
            s.photo_count,
            mainId ? driveLink(mainId, linkText) : '',
            ids.join(' '),
            s.created_by_name ?? '',
            thaiDateTime(s.created_at),
          ],
        }
      })

      if (srows.length > 0) {
        const placed = await lookupPlaced('sack_sheet_exports', 'sack_id', srows.map((r) => r.key))
        const out = await pushRows(sackSheet, token, srows, placed, SACK_HEADER)
        updated += out.updated
        appended += out.appended
        out.tabs.forEach((t) => tabs.add(t))

        // แถวที่เคยส่งแล้วก็ต้องอัปเวลาด้วย ไม่งั้นตัวนับ needs_push จะค้างอยู่ตลอด
        const stamp = new Date().toISOString()
        await db('sack_sheet_exports?on_conflict=sack_id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(
            srows.map((r, i) => {
              const fresh = out.fresh.findIndex((f) => f.key === r.key)
              const place = fresh >= 0 ? { tab: out.fresh[fresh].tab, row_no: out.rowNos[fresh] } : placed.get(r.key)
              return place
                ? { sack_id: r.key, tab: place.tab, row_no: place.row_no, exported_at: stamp }
                : null
            }).filter(Boolean),
          ),
        })
      }
    }

    /* ------------------------------------ ประวัติสแกนบัตร OS ที่ป้อม */
    // ลงคนละไฟล์กับของเบิกและของกระสอบ คนที่เปิดดูคือฝ่ายมาตรฐานกับผู้ตรวจสอบ
    //
    // ไม่อยู่ใน scope 'all' ตั้งใจ — ประวัติสแกนโตวันละหลายร้อยแถว
    // ถ้าพ่วงไปกับการส่งยอดเบิกประจำวัน จะดึงของที่ไม่มีใครขอดูทุกครั้ง
    // ต้องกดจากหน้าประวัติการสแกนโดยตรงเท่านั้น
    if (scope === 'osscan') {
      const osSheet = Deno.env.get('GSHEET_OSSCAN_ID') || OSSCAN_SHEET_ID
      const oqs = new URLSearchParams({
        select:
          'id,scanned_at,result,flag_reason,flagged_at,os_code,full_name,affiliation,' +
          'phone_model,imei,guard_name,guard_code',
        order: 'scanned_at.asc,id.asc',
      })
      if (payload.from) oqs.append('scanned_at', `gte.${payload.from}`)
      if (payload.to) oqs.append('scanned_at', `lte.${payload.to}`)

      const scans = await dbPaged<DbOsScan>(`os_scan_rows?${oqs}`)
      const orows: OutRow[] = scans.map((s) => ({
        key: s.id,
        tab: `สแกนบัตร OS ${monthOf(s.scanned_at)}`,
        values: [
          thaiDateTime(s.scanned_at),
          scanResultText(s.result),
          s.os_code ?? '',
          s.full_name ?? '',
          s.affiliation ?? '',
          s.phone_model ?? '',
          // นำหน้าด้วยเครื่องหมายคำพูดกัน Sheets แปลง 15 หลักเป็นเลขวิทยาศาสตร์
          s.imei ? `'${s.imei}` : '',
          s.flagged_at ? 'ติดธง' : '',
          s.flag_reason ?? '',
          s.flagged_at ? thaiDateTime(s.flagged_at) : '',
          s.guard_name ?? '',
          s.guard_code ?? '',
        ],
      }))

      if (orows.length > 0) {
        const placed = await lookupPlaced('os_scan_exports', 'scan_id', orows.map((r) => r.key))
        const out = await pushRows(osSheet, token, orows, placed, OSSCAN_HEADER)
        updated += out.updated
        appended += out.appended
        out.tabs.forEach((t) => tabs.add(t))

        // แถวที่เคยส่งแล้วก็ต้องอัปเวลาด้วย ไม่งั้นตัวนับ needs_push จะค้างอยู่ตลอด
        const stamp = new Date().toISOString()
        await db('os_scan_exports?on_conflict=scan_id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(
            orows.map((r, i) => {
              const fresh = out.fresh.findIndex((f) => f.key === r.key)
              const place = fresh >= 0 ? { tab: out.fresh[fresh].tab, row_no: out.rowNos[fresh] } : placed.get(r.key)
              return place
                ? { scan_id: r.key, tab: place.tab, row_no: place.row_no, exported_at: stamp }
                : null
            }).filter(Boolean),
          ),
        })
      }
    }

    return json({
      updated,
      appended,
      sheet: [...tabs].join(', ') || '-',
      version: VERSION,
    })
  } catch (e) {
    return json({ error: (e as Error).message }, 400)
  }
})
