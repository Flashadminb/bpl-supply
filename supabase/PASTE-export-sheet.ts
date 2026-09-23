// =====================================================================
// export-sheet — เขียนข้อมูลลง Google Sheet
//
// สี่ชุดแยกแท็บกัน แต่ละชุดแยกรายเดือนอีกที
//   เบิก-คืน 2569-09   วัสดุสิ้นเปลือง 1 แถวต่อ 1 รายการ
//   Asset 2569-09      อุปกรณ์ 1 แถวต่อ 1 เครื่องต่อครั้งที่เบิกหรือคืน
//   ชำรุด 2569-09      ใบแจ้งชำรุด 1 แถวต่อ 1 ใบ
//   บาร์โค้ด BY 2569-09  ของที่หน้างานส่งบาร์โค้ดมาให้ตัดสต็อกในระบบ BY
//
// กันแถวซ้ำโดยจำตำแหน่งไว้ในฐานข้อมูล (แท็บ + เลขแถว)
// จึงไม่ต้องอ่านทั้งชีตมาเทียบทุกครั้ง — เร็วคงที่ไม่ว่าชีตจะใหญ่แค่ไหน
//
// ไฟล์นี้เขียนให้จบในตัวเอง ก๊อปวางใน Supabase Dashboard ได้ตรง ๆ
// secrets: GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY, GSHEET_ID
// =====================================================================

const VERSION = 'by-v5'
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
      /** 'all' (ค่าเริ่มต้น) | 'supply' | 'asset' */
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
      qs.set('order', 'created_at.asc')

      const reqs = await db<DbReq[]>(`requisitions?${qs}`)
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
        const known = await db<{ requisition_item_id: number; tab: string; row_no: number }[]>(
          `sheet_exports?requisition_item_id=in.(${rows.map((r) => r.key).join(',')})&select=requisition_item_id,tab,row_no`,
        )
        const placed = new Map<RowKey, { tab: string; row_no: number }>(
          known.map((k) => [k.requisition_item_id, k]),
        )
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
        'assets(type_code,asset_types(name)),' +
        'asset_txns!inner(ref_no,kind,created_at,dept_code,shift_start,shift_end,due_at,' +
        'profiles(full_name,employee_code,sub_dept),asset_txn_photos(file_id))'

      const qs = new URLSearchParams({ select, order: 'id.asc' })
      if (payload.from) qs.append('asset_txns.created_at', `gte.${payload.from}`)
      if (payload.to) qs.append('asset_txns.created_at', `lte.${payload.to}`)

      const items = await db<DbAssetItem[]>(`asset_txn_items?${qs}`)
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
        const known = await db<{ asset_txn_item_id: number; tab: string; row_no: number }[]>(
          `asset_sheet_exports?asset_txn_item_id=in.(${rows.map((r) => r.key).join(',')})&select=asset_txn_item_id,tab,row_no`,
        )
        const placed = new Map<RowKey, { tab: string; row_no: number }>(
          known.map((k) => [k.asset_txn_item_id, k]),
        )
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
        order: 'reported_at.asc',
      })
      if (payload.from) iqs.append('reported_at', `gte.${payload.from}`)
      if (payload.to) iqs.append('reported_at', `lte.${payload.to}`)

      const issues = await db<DbIssue[]>(`asset_issues?${iqs}`)
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
        const known = await db<{ issue_id: number; tab: string; row_no: number }[]>(
          `asset_issue_exports?issue_id=in.(${irows.map((r) => r.key).join(',')})&select=issue_id,tab,row_no`,
        )
        const placed = new Map<RowKey, { tab: string; row_no: number }>(
          known.map((k) => [k.issue_id, k]),
        )
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
        order: 'created_at.asc',
      })
      if (payload.from) bqs.append('created_at', `gte.${payload.from}`)
      if (payload.to) bqs.append('created_at', `lte.${payload.to}`)

      const list = await db<DbBy[]>(`by_barcodes?${bqs}`)
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
        const ids = brows.map((r) => `"${r.key}"`).join(',')
        const known = await db<{ by_id: string; tab: string; row_no: number }[]>(
          `by_sheet_exports?by_id=in.(${ids})&select=by_id,tab,row_no`,
        )
        const placed = new Map<RowKey, { tab: string; row_no: number }>(
          known.map((k) => [k.by_id, k]),
        )
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
