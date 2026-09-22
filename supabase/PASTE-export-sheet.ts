// =====================================================================
// export-sheet — เขียนข้อมูลการเบิกลง Google Sheet
// 1 แถวต่อ 1 รายการวัสดุ · แยกแท็บรายเดือน
//
// กันแถวซ้ำโดยจำตำแหน่งไว้ในตาราง sheet_exports (แท็บ + เลขแถว)
// จึงไม่ต้องอ่านทั้งชีตมาเทียบทุกครั้ง — เร็วคงที่ไม่ว่าชีตจะใหญ่แค่ไหน
//
// ไฟล์นี้เขียนให้จบในตัวเอง ก๊อปวางใน Supabase Dashboard ได้ตรง ๆ
// secrets: GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY, GSHEET_ID, GSHEET_TAB (ไม่บังคับ)
// =====================================================================

const VERSION = 'monthly-v3'
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
const HEADER = ['เลขที่คำขอ', 'วันเวลา', 'ผู้เบิก (ฮับ)', 'วัสดุ', 'จำนวน', 'หลักฐาน', 'Drive File ID']

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

/** ชื่อแท็บรายเดือนแบบ พ.ศ. เช่น "เบิก-คืน 2569-09" */
function tabFor(iso: string): string {
  const d = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(d)
  const y = Number(parts.find((p) => p.type === 'year')?.value ?? '0') + 543
  const m = parts.find((p) => p.type === 'month')?.value ?? '01'
  return `เบิก-คืน ${y}-${m}`
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
async function ensureTab(sheetId: string, tab: string, token: string): Promise<number> {
  const meta = (await gfetch(api(sheetId, ''), token)) as {
    sheets?: { properties?: { title?: string; gridProperties?: { rowCount?: number } } }[]
  }
  const found = (meta.sheets ?? []).find((s) => s.properties?.title === tab)

  if (!found) {
    await gfetch(api(sheetId, ':batchUpdate'), token, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab } } }] }),
    })
    await gfetch(api(sheetId, `/values/${encodeURIComponent(`${tab}!A1:G1`)}`, '?valueInputOption=RAW'), token, {
      method: 'PUT',
      body: JSON.stringify({ values: [HEADER] }),
    })
    return 1
  }

  // อ่านแค่คอลัมน์ A เพื่อรู้ว่าตอนนี้มีกี่แถว ไม่ได้อ่านข้อมูลทั้งชีต
  const col = (await gfetch(
    api(sheetId, `/values/${encodeURIComponent(`${tab}!A:A`)}`),
    token,
  )) as { values?: string[][] }
  const used = col.values?.length ?? 0
  if (used === 0) {
    await gfetch(api(sheetId, `/values/${encodeURIComponent(`${tab}!A1:G1`)}`, '?valueInputOption=RAW'), token, {
      method: 'PUT',
      body: JSON.stringify({ values: [HEADER] }),
    })
    return 1
  }
  return used
}

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
    }

    const sheetId = envOrThrow('GSHEET_ID')

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

    // แปลงเป็นแถว พร้อมจับกลุ่มตามแท็บรายเดือน
    interface Row {
      lineId: number
      tab: string
      values: (string | number)[]
    }
    const allRows: Row[] = []
    for (const r of reqs) {
      // แนบได้หลายใบ ลิงก์ในชีตชี้ไปใบแรก แล้วบอกจำนวนไว้ในข้อความ
      const photos = (r.requisition_photos ?? []).map((p) => p.file_id)
      const count = Math.max(photos.length, r.evidence_file_id ? 1 : 0)
      const mainId = r.evidence_file_id ?? photos[0] ?? null
      const linkText = count > 1 ? `ดูรูป (${count} ใบ)` : 'ดูรูป'

      for (const l of r.requisition_items ?? []) {
        if (l.status === 'rejected') continue
        allRows.push({
          lineId: l.id,
          tab: tabFor(r.created_at),
          values: [
            r.ref_no,
            thaiDateTime(r.created_at),
            `${r.profiles?.full_name ?? '—'} (${r.hub_code})`,
            l.items?.name ?? '',
            `${l.qty_approved ?? l.qty_requested} ${l.items?.unit ?? ''}`,
            mainId ? `=HYPERLINK("https://drive.google.com/file/d/${mainId}/view";"${linkText}")` : '',
            photos.length > 1 ? photos.join(' ') : (mainId ?? ''),
          ],
        })
      }
    }

    if (allRows.length === 0) return json({ updated: 0, appended: 0, sheet: '-', version: VERSION })

    // ดูว่าบรรทัดไหนเคยส่งไปแล้วและอยู่ตรงไหน
    const ids = allRows.map((r) => r.lineId)
    const known = await db<{ requisition_item_id: number; tab: string; row_no: number }[]>(
      `sheet_exports?requisition_item_id=in.(${ids.join(',')})&select=requisition_item_id,tab,row_no`,
    )
    const placed = new Map(known.map((k) => [k.requisition_item_id, k]))

    const token = await getAccessToken()
    let updated = 0
    let appended = 0
    const touchedTabs = new Set<string>()

    // ---- เขียนทับแถวเดิม เฉพาะตำแหน่งที่จำไว้ ----
    const updates = allRows
      .filter((r) => placed.has(r.lineId))
      .map((r) => {
        const p = placed.get(r.lineId) as { tab: string; row_no: number }
        touchedTabs.add(p.tab)
        return { range: `${p.tab}!A${p.row_no}:G${p.row_no}`, values: [r.values] }
      })

    if (updates.length > 0) {
      await gfetch(api(sheetId, '/values:batchUpdate'), token, {
        method: 'POST',
        body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: updates }),
      })
      updated = updates.length
    }

    // ---- ต่อท้ายแถวใหม่ แยกทีละแท็บ ----
    const fresh = allRows.filter((r) => !placed.has(r.lineId))
    const byTab = new Map<string, Row[]>()
    for (const r of fresh) {
      const arr = byTab.get(r.tab)
      if (arr) arr.push(r)
      else byTab.set(r.tab, [r])
    }

    const records: { requisition_item_id: number; tab: string; row_no: number }[] = []
    for (const [tab, list] of byTab) {
      const startRow = await ensureTab(sheetId, tab, token)
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
        records.push({ requisition_item_id: r.lineId, tab, row_no: startRow + 1 + i })
      })
      appended += list.length
      touchedTabs.add(tab)
    }

    if (records.length > 0) {
      await db('sheet_exports?on_conflict=requisition_item_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(records),
      })
    }

    return json({
      updated,
      appended,
      sheet: [...touchedTabs].join(', '),
      version: VERSION,
    })
  } catch (e) {
    return json({ error: (e as Error).message }, 400)
  }
})
