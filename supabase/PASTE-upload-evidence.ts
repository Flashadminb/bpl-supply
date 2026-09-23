// =====================================================================
// upload-evidence — รับรูปหลักฐานจากมือถือ อัปเข้า Google Drive
// คืน { fileId, webViewLink, bytes } ให้ client เก็บเป็น pointer เท่านั้น
// รูปไม่เคยแตะ Supabase Storage
//
// อัปในนามบัญชี Google ของเจ้าของระบบ (OAuth refresh token)
// ไม่ใช้ service account เพราะ service account ไม่มีโควตาพื้นที่ของตัวเอง
// ไฟล์ที่อัปจึงเป็นของเจ้าของระบบ และกินโควตา Google One ของเขา
//
// ไฟล์นี้เขียนให้จบในตัวเอง ก๊อปวางใน Supabase Dashboard ได้ตรง ๆ
//
// secrets ที่ต้องตั้ง:
//   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET,
//   GOOGLE_OAUTH_REFRESH_TOKEN
//   (GDRIVE_FOLDER_ID ไม่ต้องตั้งแล้ว แอปสร้างโฟลเดอร์เองและจำรหัสไว้ในฐานข้อมูล)
// =====================================================================

const MAX_BYTES = 8 * 1024 * 1024

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

function publicKey(): string {
  return envAny(
    'SUPABASE_ANON_KEY',
    'SB_PUBLISHABLE_KEY',
    'SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  )
}

let cached: { token: string; expires: number } | null = null

/**
 * แลก refresh token เป็น access token — cache ไว้จนกว่าจะใกล้หมดอายุ
 * refresh token ไม่หมดอายุถ้าแอปอยู่สถานะ In production
 * แต่ถ้ายังเป็น Testing จะหมดอายุทุก 7 วัน ต้องกดอนุญาตใหม่
 */
async function getAccessToken(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: envOrThrow('GOOGLE_OAUTH_CLIENT_ID'),
      client_secret: envOrThrow('GOOGLE_OAUTH_CLIENT_SECRET'),
      refresh_token: envOrThrow('GOOGLE_OAUTH_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  })
  const data = (await res.json()) as {
    access_token?: string
    expires_in?: number
    error?: string
    error_description?: string
  }

  if (!res.ok || !data.access_token) {
    if (data.error === 'invalid_grant') {
      throw new Error(
        'สิทธิ์เข้าถึง Google Drive หมดอายุแล้ว ให้เจ้าของระบบกดอนุญาตใหม่ ' +
          '(เกิดเพราะแอป OAuth ยังอยู่สถานะ Testing ซึ่งหมดอายุทุก 7 วัน)',
      )
    }
    throw new Error(`ขอสิทธิ์จาก Google ไม่สำเร็จ: ${data.error_description ?? data.error ?? res.status}`)
  }

  cached = { token: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 }
  return cached.token
}

/** ต้องเป็นผู้ใช้ที่ล็อกอินจริงเท่านั้น */
async function requireUser(req: Request): Promise<string> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) throw new Error('ต้องเข้าสู่ระบบก่อน')

  const res = await fetch(`${envOrThrow('SUPABASE_URL')}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: publicKey() },
  })
  if (!res.ok) throw new Error('เซสชันหมดอายุ เข้าสู่ระบบใหม่')
  const user = (await res.json()) as { id?: string }
  if (!user.id) throw new Error('ไม่พบผู้ใช้')
  return user.id
}

/* ------------------------------------------------ โฟลเดอร์ปลายทางใน Drive */

const FOLDER_NAME = 'BPL SUPPLY หลักฐาน'
const SETTING_KEY = 'gdrive_folder_id'

/**
 * สิทธิ์ที่ขอจาก Google เป็นแบบ drive.file คือแตะได้เฉพาะไฟล์ที่แอปสร้างเอง
 * โฟลเดอร์ที่คนไปสร้างเองในเว็บ Drive แอปจะมองไม่เห็น อัปเข้าไม่ได้
 *
 * จึงให้แอปสร้างโฟลเดอร์ของตัวเองครั้งแรก แล้วจำรหัสไว้ในฐานข้อมูล
 * ถ้าโฟลเดอร์ถูกลบหรือย้ายไปถังขยะ ครั้งต่อไปจะสร้างใหม่ให้เอง
 * ไม่ต้องมาตั้งค่า GDRIVE_FOLDER_ID ด้วยมืออีก
 */
async function setting(key: string, value?: string): Promise<string | null> {
  const base = Deno.env.get('SUPABASE_URL')
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SB_SECRET_KEY')
  if (!base || !svc) return null
  const headers = { apikey: svc, Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json' }

  if (value === undefined) {
    const res = await fetch(
      `${base}/rest/v1/private_settings?key=eq.${encodeURIComponent(key)}&select=value`,
      { headers },
    )
    if (!res.ok) return null
    const rows = (await res.json()) as { value: string }[]
    return rows[0]?.value ?? null
  }

  await fetch(`${base}/rest/v1/private_settings?on_conflict=key`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key, value }),
  }).catch(() => undefined)
  return value
}

let folderCache: { id: string; at: number } | null = null

async function driveFolderOk(id: string, token: string): Promise<boolean> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${id}?fields=id,trashed,mimeType`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) return false
  const f = (await res.json()) as { trashed?: boolean; mimeType?: string }
  return !f.trashed && f.mimeType === 'application/vnd.google-apps.folder'
}

async function createFolder(token: string): Promise<string> {
  const res = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  })
  const data = (await res.json()) as { id?: string; error?: { message?: string } }
  if (!res.ok || !data.id) {
    throw new Error(`สร้างโฟลเดอร์ใน Drive ไม่สำเร็จ: ${data.error?.message ?? res.status}`)
  }
  return data.id
}

async function ensureFolder(token: string): Promise<string> {
  if (folderCache && Date.now() - folderCache.at < 10 * 60_000) return folderCache.id

  const saved = (await setting(SETTING_KEY)) ?? Deno.env.get('GDRIVE_FOLDER_ID') ?? null
  if (saved && (await driveFolderOk(saved, token))) {
    folderCache = { id: saved, at: Date.now() }
    return saved
  }

  const fresh = await createFolder(token)
  await setting(SETTING_KEY, fresh)
  folderCache = { id: fresh, at: Date.now() }
  return fresh
}

// ป้ายบอกเวอร์ชัน — เรียกด้วย GET เพื่อเช็คว่าโค้ดที่ deploy อยู่เป็นตัวไหน
const VERSION = 'folder-v4'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  if (req.method === 'GET') {
    return json({
      name: 'upload-evidence',
      version: VERSION,
      uploadsAs: 'oauth-user',
      hasOauthSecrets: Boolean(
        Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') &&
          Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') &&
          Deno.env.get('GOOGLE_OAUTH_REFRESH_TOKEN'),
      ),
      folderId: (await setting(SETTING_KEY)) ?? Deno.env.get('GDRIVE_FOLDER_ID') ?? null,
      folderName: FOLDER_NAME,
    })
  }

  if (req.method !== 'POST') return json({ error: 'ใช้ได้เฉพาะ POST' }, 405)

  try {
    await requireUser(req)

    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return json({ error: 'ไม่พบไฟล์รูปในคำขอ' }, 400)
    if (file.size > MAX_BYTES) return json({ error: 'ไฟล์ใหญ่เกิน 8 MB' }, 413)

    const token = await getAccessToken()
    const folderId = await ensureFolder(token)
    const mime = file.type || 'image/webp'

    // นามสกุลต้องตรงกับชนิดไฟล์จริง — iPhone บางรุ่นทำ WebP ไม่ได้ จะได้ JPEG มาแทน
    // ถ้าปล่อยชื่อเป็น .webp ทั้งที่ข้างในเป็น JPEG โปรแกรมดูรูปบางตัวจะเปิดไม่ขึ้น
    const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('png') ? 'png' : 'webp'
    const raw = String(form.get('filename') ?? file.name ?? `evidence-${Date.now()}`)
    const name = `${raw.replace(/\.(webp|jpe?g|png)$/i, '')}.${ext}`

    // ต้องเป็น multipart/related เท่านั้น ไม่ใช่ multipart/form-data
    // ที่ผ่านมาใช้ FormData ซึ่ง fetch ตั้ง Content-Type เป็น form-data ให้เอง
    // Google เลยอ่านส่วน metadata ไม่ออก ไฟล์จึงไปกองที่ My Drive ชั้นนอกแทนที่จะเข้าโฟลเดอร์
    const boundary = `bpl${crypto.randomUUID().replace(/-/g, '')}`
    const meta = JSON.stringify({ name, parents: [folderId], mimeType: mime })
    const head =
      `--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      `${meta}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${mime}\r\n\r\n`
    const tail = `\r\n--${boundary}--\r\n`
    const body = new Blob([head, new Uint8Array(await file.arrayBuffer()), tail])

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files' +
        '?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink,size,parents',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    )

    const data = (await res.json()) as {
      id?: string
      webViewLink?: string
      size?: string
      error?: { message?: string }
    }
    if (!res.ok || !data.id) {
      return json({ error: `อัปโหลดเข้า Drive ไม่สำเร็จ: ${data.error?.message ?? res.status}` }, 502)
    }

    return json({
      fileId: data.id,
      webViewLink: data.webViewLink ?? `https://drive.google.com/file/d/${data.id}/view`,
      bytes: Number(data.size ?? file.size),
    })
  } catch (e) {
    return json({ error: (e as Error).message }, 400)
  }
})
