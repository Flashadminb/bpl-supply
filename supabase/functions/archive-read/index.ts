// =====================================================================
// archive-read — ให้เว็บอ่านประวัติเก่าที่ย้ายไปอยู่ในชีตแล้ว
//
// ─────────────────────────────────────────────────────────────────
// หน้าที่
//
// ของในกำหนด (เช่น 90 วันล่าสุด) อยู่ในฐานข้อมูล เร็วเหมือนเดิมทุกอย่าง
// ของที่เลยกำหนดถูกลบออกจากฐานข้อมูลแล้ว แต่ยังอยู่ในชีตครบ
// ไฟล์นี้คือสะพานที่ทำให้หน้าเว็บหยิบของเก่ามาแสดงได้เหมือนไม่มีอะไรเกิดขึ้น
//
// คนใช้ไม่ต้องรู้ว่าข้อมูลมาจากไหน กดดูเหมือนเดิม เห็นรูปเหมือนเดิม
// ต่างแค่ของเก่าโหลดช้ากว่า ซึ่งเจ้าของระบบยืนยันแล้วว่ารับได้
// ─────────────────────────────────────────────────────────────────
//
// ─────────────────────────────────────────────────────────────────
// ปัญหาที่รู้ล่วงหน้าว่าจะเจอ และทางกันไว้แล้ว
//
// ① ชีตไม่มีดัชนี ดึงทั้งแผ่นมากรองเองคือช้าและกินหน่วยความจำ
//    เคยลองช่องทาง gviz ที่ให้ Google กรองให้ตั้งแต่ฝั่งเขา เร็วมาก ~450 มิลลิวินาที
//    แต่มันไม่รับกุญแจ service account ตอบ 401 ทุกครั้ง รับแต่การล็อกอินของคน
//    ซึ่งใช้กับงานเบื้องหลังไม่ได้
//    กัน: อ่านทีละช่วงแถวจากล่างขึ้นบนแทน แล้วหยุดทันทีที่ได้ครบตามที่ขอ
//        แถวใหม่สุดอยู่ท้ายชีตเสมอ และคนมองของใหม่ก่อนแทบทุกครั้ง
//        จึงแทบไม่เคยต้องอ่านถึงต้นเดือน · หน่วยความจำก็ถูกจำกัดด้วยขนาดช่วง
//
// ② เดือนหนึ่งของบัตรเบรคมีราวสามหมื่นแถว
//    กัน: ชีตแยกแท็บรายเดือนอยู่แล้ว ช่วงวันที่ขอจึงแตะแค่แท็บที่เกี่ยวข้อง
//
// ③ คนไปแทรกคอลัมน์หรือสลับลำดับในชีต แล้วเว็บอ่านผิดช่องแบบเงียบ ๆ
//    กัน: อ่านหัวตารางมาทำแผนที่ชื่อ→ตัวอักษรคอลัมน์ทุกครั้ง ไม่ยึดตำแหน่งตายตัว
//        หาหัวที่ต้องใช้ไม่เจอ = ตอบ error ชัด ๆ ดีกว่าคืนข้อมูลผิด
//
// ④ หลายคนเปิดเดือนเดียวกันพร้อมกัน = ยิง Google ซ้ำ ๆ โดยเปล่าประโยชน์
//    กัน: จำคำตอบไว้ในหน่วยความจำสิบนาที · ของเก่าไม่มีวันเปลี่ยนอยู่แล้ว
//
// ⑤ โควตาอ่านของ Google คือ 300 ครั้งต่อนาทีต่อโปรเจกต์
//    กัน: แคชด้านบน บวกกับห้ามหน้าเว็บดึงเองอัตโนมัติ ต้องให้คนกดเท่านั้น
//
// ⑥ ชีตหนึ่งไฟล์เก็บได้สิบล้านช่อง บัตรเบรคกินราวเก้าแสนช่องต่อเดือน
//    = เต็มในราวสิบเดือน แล้วการเขียนจะล้มทั้งระบบ
//    กัน: ตรวจขนาดให้ทุกครั้งที่อ่าน และเตือนล่วงหน้าตั้งแต่ 70%
//        ดู /health ของไฟล์นี้ · ยังไม่ย้ายไฟล์ให้อัตโนมัติ แต่จะไม่โดนจู่โจม
// ─────────────────────────────────────────────────────────────────

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
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

/** อ่านอย่างเดียวก็พอ · ขอสิทธิ์เท่าที่ใช้จริงเสมอ */
const READ_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'

/** อ่านทีละกี่แถวต่อครั้ง · ใหญ่กว่านี้เริ่มกินหน่วยความจำ เล็กกว่านี้ไปกลับบ่อยเกิน */
const CHUNK = 4000

/** ไล่ขึ้นไปได้สูงสุดกี่ช่วงต่อแท็บ · กันคำค้นที่ไม่เจออะไรเลยลากยาวทั้งเดือน */
const MAX_CHUNKS = 6

/**
 * งานไหนอยู่ชีตไหน แท็บขึ้นต้นด้วยอะไร
 *
 * ชื่อแท็บจริงคือ "<ขึ้นต้น> <ปีพ.ศ.>-<เดือน>" เช่น "เบรค 2569-10"
 * ซึ่งเป็นรูปแบบที่ตัวส่งชีตใช้อยู่แล้ว ไม่ได้คิดขึ้นใหม่
 */
const SHEETS: Record<string, { id: string; tab: string }> = {
  supply: { id: '1Ga4v_v7U2Nu8GqK-x8up8xjDLf1LmKuGD7X1sVz3kVY', tab: 'เบิก-คืน' },
  asset: { id: '1Ga4v_v7U2Nu8GqK-x8up8xjDLf1LmKuGD7X1sVz3kVY', tab: 'Asset' },
  issue: { id: '1Ga4v_v7U2Nu8GqK-x8up8xjDLf1LmKuGD7X1sVz3kVY', tab: 'ชำรุด' },
  by: { id: '1Ga4v_v7U2Nu8GqK-x8up8xjDLf1LmKuGD7X1sVz3kVY', tab: 'บาร์โค้ด BY' },
  break: { id: '1Mv7zInXLBid27HrdWlwkwbmrd1rHXcYjfhZeY-KYmno', tab: 'เบรค' },
  meeting: { id: '15_ES88gZhq8ZWBaAwoFekP-3o3HKnNW52jPimSIjHRY', tab: 'ประชุม' },
  sack: { id: '1ZqSEG1dTPlCcC9mAJJSwcOQz8vdXyF9rF-RfzB5bvSI', tab: 'กระสอบ' },
  truck: { id: '1j9P4eKX9JBNfcYUqDNQzC_4yWk7zZQypVUaG8UPkt1c', tab: 'ปล่อยรถ' },
  wait: { id: '1KItBMEgie6I9EaWA93N2ISAwr5rn_w5iJtai6cfg2Dg', tab: 'รถรอลงงาน' },
  osscan: { id: '1Suklni1sHj_waOIRMnu4TU71D8Cdujju6eJbFSddQ74', tab: 'สแกนบัตร OS' },
}

/* ------------------------------------------------------- กุญแจของ Google */

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----[A-Z ]+-----/g, '')
    .replace(/\s+/g, '')
  const raw = atob(body)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

let tokenCache: { token: string; expires: number } | null = null

/** แลกกุญแจ service account เป็น access token · วิธีเดียวกับ export-sheet */
async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expires > Date.now() + 60_000) return tokenCache.token

  const email = envOrThrow('GOOGLE_SA_EMAIL')
  const pem = envOrThrow('GOOGLE_SA_PRIVATE_KEY')
  const now = Math.floor(Date.now() / 1000)
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(
    JSON.stringify({
      iss: email,
      scope: READ_SCOPE,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  )

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claim}`)),
  )
  const jwt = `${head}.${claim}.${b64url(String.fromCharCode(...sig))}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string }
  if (!res.ok || !data.access_token) {
    throw new Error(`ขอสิทธิ์จาก Google ไม่สำเร็จ: ${data.error_description ?? res.status}`)
  }
  tokenCache = { token: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 }
  return tokenCache.token
}

/* ------------------------------------------------------------ ใครกำลังขอ */

async function requireUser(req: Request): Promise<void> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) throw new Error('ต้องเข้าสู่ระบบก่อน')
  const res = await fetch(`${envOrThrow('SUPABASE_URL')}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SB_PUBLISHABLE_KEY') ?? '',
    },
  })
  if (!res.ok) throw new Error('เซสชันหมดอายุ เข้าสู่ระบบใหม่')
}

/* --------------------------------------------------------------- แท็บ */

/** เดือน พ.ศ. ของแท็บ เช่น "2569-09" · ต้องตรงกับที่ export-sheet ใช้ตั้งชื่อ */
function monthOf(iso: string): string {
  const d = new Date(iso)
  const y = d.getUTCFullYear() + 543
  return `${y}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** แท็บทั้งหมดที่ช่วงวันนี้พาดผ่าน · เรียงจากใหม่ไปเก่า เพราะคนมองของใหม่ก่อน */
function monthsBetween(from: string, to: string): string[] {
  const a = new Date(from)
  const b = new Date(to)
  const out: string[] = []
  const cur = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1))
  while (cur <= b && out.length < 36) {
    out.push(monthOf(cur.toISOString()))
    cur.setUTCMonth(cur.getUTCMonth() + 1)
  }
  return out.reverse()
}

/** เลขคอลัมน์ 1 → A, 27 → AA */
function colLetter(n: number): string {
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/* ------------------------------------------------------------- แคช */

const TTL_MS = 10 * 60 * 1000
const memo = new Map<string, { at: number; body: unknown }>()

async function memoized<T>(key: string, make: () => Promise<T>): Promise<T> {
  const hit = memo.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.body as T
  const body = await make()
  /* กันหน่วยความจำบานตอนมีคนเปิดหลายเดือนรวด · ของเก่าสุดหลุดก่อน */
  if (memo.size > 40) memo.delete(memo.keys().next().value as string)
  memo.set(key, { at: Date.now(), body })
  return body
}

/* ------------------------------------------------------------- อ่านชีต */

/**
 * แผนที่ชื่อหัวตาราง → ตัวอักษรคอลัมน์
 *
 * ยึดตามชื่อ ไม่ยึดตำแหน่ง · วันที่มีคนไปแทรกคอลัมน์กลางชีต
 * ระบบจะยังอ่านถูกช่อง แทนที่จะเงียบ ๆ อ่านผิดแล้วโชว์ข้อมูลมั่ว
 */
async function headerMap(sheetId: string, tab: string, token: string): Promise<Record<string, string>> {
  return await memoized(`head:${sheetId}:${tab}`, async () => {
    const url =
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/` +
      `${encodeURIComponent(`${tab}!1:1`)}`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`อ่านหัวตาราง ${tab} ไม่ได้ · ${res.status}`)
    const body = (await res.json()) as { values?: string[][] }
    const row = body.values?.[0] ?? []
    const map: Record<string, string> = {}
    row.forEach((name, i) => {
      const k = String(name ?? '').trim()
      if (k && !map[k]) map[k] = colLetter(i + 1)
    })
    return map
  })
}

interface Found {
  tab: string
  cols: string[]
  rows: (string | number | null)[][]
  ms: number
  /** ไล่อ่านไปกี่แถวกว่าจะได้เท่านี้ · ไว้ดูว่าคำค้นแพงแค่ไหน */
  scanned: number
}

/** มีกี่แถวในแท็บนี้ · อ่านคอลัมน์เดียวพอ ไม่ได้ลากข้อมูลมาทั้งแผ่น */
async function tabRows(sheetId: string, tab: string, token: string): Promise<number> {
  return await memoized(`n:${sheetId}:${tab}`, async () => {
    const url =
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/` +
      `${encodeURIComponent(`${tab}!A:A`)}`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`นับแถวของ ${tab} ไม่ได้ · ${res.status}`)
    const body = (await res.json()) as { values?: string[][] }
    return body.values?.length ?? 0
  })
}

/**
 * อ่านแท็บเดียว เอาเฉพาะแถวที่ตรงกับที่ขอ
 *
 * ─────────────────────────────────────────────────────────────────
 * ทำไมอ่านจากล่างขึ้นบน
 *
 * ตัวส่งชีตต่อแถวใหม่ท้ายตารางเสมอ แถวล่างสุดจึงใหม่สุดเสมอ
 * และคนที่เปิดดูประวัติมองของใหม่ก่อนแทบทุกครั้ง
 *
 * อ่านจากล่างขึ้นทีละสี่พันแถวแล้วหยุดเมื่อได้ครบ
 * แปลว่ากรณีปกติแตะแค่ช่วงเดียว ไม่ต้องลากทั้งเดือนสามหมื่นแถวข้ามเน็ตมาทิ้ง
 * ─────────────────────────────────────────────────────────────────
 */
async function queryTab(
  sheetId: string,
  tab: string,
  token: string,
  lastCol: string,
  match: ((row: (string | number | null)[]) => boolean) | null,
  limit: number,
): Promise<Found> {
  const t0 = Date.now()
  const total = await tabRows(sheetId, tab, token)
  const out: (string | number | null)[][] = []
  let scanned = 0

  /* แถวที่ 1 คือหัวตาราง ข้อมูลจริงเริ่มที่ 2 */
  let end = total
  for (let i = 0; i < MAX_CHUNKS && end >= 2 && out.length < limit; i++) {
    const start = Math.max(2, end - CHUNK + 1)
    const url =
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/` +
      `${encodeURIComponent(`${tab}!A${start}:${lastCol}${end}`)}` +
      `?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`อ่าน ${tab} ช่วง ${start}-${end} ไม่ได้ · ${res.status}`)
    const body = (await res.json()) as { values?: (string | number | null)[][] }
    const got = body.values ?? []
    scanned += got.length

    /* ในช่วงเดียวกันก็ยังต้องกลับหัว เพราะต้องการใหม่สุดก่อน */
    for (let k = got.length - 1; k >= 0 && out.length < limit; k--) {
      const row = got[k]
      if (!match || match(row)) out.push(row)
    }

    end = start - 1
  }

  return { tab, cols: [], rows: out, ms: Date.now() - t0, scanned }
}

/** A → 1, AA → 27 · ย้อนทางของ colLetter */
function colNum(letter: string): number {
  let n = 0
  for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

/* ------------------------------------------------------------- เส้นทาง */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    await requireUser(req)
    const p = (await req.json().catch(() => ({}))) as {
      kind?: string
      from?: string
      to?: string
      /** คำค้น · จะถูกเทียบแบบมีคำนี้อยู่ข้างใน กับคอลัมน์ที่ระบุใน cols */
      q?: string
      /** จะค้นในคอลัมน์ไหนบ้าง · ชื่อหัวตารางตรง ๆ ไม่ใช่ตัวอักษรคอลัมน์ */
      cols?: string[]
      limit?: number
      /** ดูโครงชีตเฉย ๆ ไม่ดึงข้อมูล · ไว้ตรวจว่าหัวตารางยังตรงอยู่ไหม */
      probe?: boolean
    }

    const spec = SHEETS[String(p.kind ?? '')]
    if (!spec) throw new Error(`ไม่รู้จักงานชื่อ ${p.kind} · มีให้เลือก ${Object.keys(SHEETS).join(', ')}`)

    const token = await getAccessToken()
    const to = p.to ?? new Date().toISOString()
    const from = p.from ?? new Date(Date.now() - 90 * 86400_000).toISOString()
    const months = monthsBetween(from, to)
    const limit = Math.min(Math.max(Number(p.limit ?? 300), 1), 2000)

    if (p.probe) {
      const out: Record<string, unknown> = {}
      for (const mo of months.slice(0, 3)) {
        const tab = `${spec.tab} ${mo}`
        try {
          out[tab] = await headerMap(spec.id, tab, token)
        } catch (e) {
          out[tab] = `อ่านไม่ได้ · ${(e as Error).message}`
        }
      }
      return json({ ok: true, kind: p.kind, sheet: spec.id, months, หัวตาราง: out })
    }

    /* ไล่ทีละแท็บจากใหม่ไปเก่า · พอได้ครบตามที่ขอก็หยุด ไม่ไปรบกวนเดือนที่เหลือ */
    const rows: Record<string, unknown>[] = []
    const touched: { tab: string; ms: number; n: number; ไล่อ่าน?: number }[] = []
    const problems: string[] = []
    /* เดือนที่ยังไม่มีแท็บ ไม่ใช่ความผิดพลาด · แค่ตอนนั้นงานนี้ยังไม่เริ่มใช้
       แยกออกจากปัญหาจริง ไม่งั้นหน้าจอจะขึ้นเตือนสีแดงทุกครั้งที่ขอช่วงยาว ๆ
       แล้วคนจะเลิกอ่านข้อความเตือน ซึ่งอันตรายกว่าไม่มีข้อความเตือน */
    const noTab: string[] = []

    for (const mo of months) {
      if (rows.length >= limit) break
      const tab = `${spec.tab} ${mo}`

      try {
        const head = await headerMap(spec.id, tab, token)
        const names = Object.keys(head)

        /* ลำดับคอลัมน์ตามหัวตารางจริงของแท็บนั้น ไม่ใช่ลำดับที่โค้ดเดาเอง */
        const order = names.slice().sort((a, b) => colNum(head[a]) - colNum(head[b]))
        const lastCol = order.length ? head[order[order.length - 1]] : 'Z'

        /* ช่องที่จะใช้ค้น · แปลงชื่อหัวเป็นเลขลำดับช่องในแถว */
        let idxs: number[] = []
        if (p.q) {
          const want = (p.cols ?? names).filter((c) => head[c])
          if (!want.length) throw new Error('ไม่เจอคอลัมน์ที่จะใช้ค้นในแท็บนี้')
          idxs = want.map((c) => colNum(head[c]) - 1)
        }
        const needle = (p.q ?? '').toLowerCase()
        const match = p.q
          ? (row: (string | number | null)[]) =>
              idxs.some((i) => String(row[i] ?? '').toLowerCase().includes(needle))
          : null

        const key = `q:${spec.id}:${tab}:${needle}:${idxs.join(',')}:${limit - rows.length}`
        const got = await memoized(key, () =>
          queryTab(spec.id, tab, token, lastCol, match, limit - rows.length),
        )

        for (const r of got.rows) {
          const o: Record<string, unknown> = {}
          for (const name of order) o[name] = r[colNum(head[name]) - 1] ?? null
          o['__แท็บ'] = tab
          rows.push(o)
        }
        touched.push({ tab, ms: got.ms, n: got.rows.length, ไล่อ่าน: got.scanned })
      } catch (e) {
        /* แท็บเดียวมีปัญหาไม่ควรทำให้ทั้งคำขอล้ม · เดือนที่เหลือยังมีค่า
           แต่ต้องบอกออกไปด้วย ไม่งั้นคนจะคิดว่าเดือนนั้นไม่มีข้อมูลจริง ๆ */
        const msg = (e as Error).message
        if (msg.includes('400')) noTab.push(tab)
        else problems.push(`${tab}: ${msg}`)
      }
    }

    return json({
      ok: true,
      kind: p.kind,
      rows,
      นับได้: rows.length,
      แท็บที่อ่าน: touched,
      เดือนที่ยังไม่มีข้อมูล: noTab,
      ปัญหา: problems,
      หมายเหตุ: 'ข้อมูลชุดนี้มาจากคลังเก่าในชีต ไม่ใช่ฐานข้อมูลหลัก',
    })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 400)
  }
})
