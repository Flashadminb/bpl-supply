// =====================================================================
// evidence-image — ส่งรูปหลักฐานจาก Google Drive ให้หน้าแอดมินแสดงผล
//
// ไฟล์ใน Drive เป็นส่วนตัว เอา URL ไปแปะใน <img> ตรง ๆ ไม่ขึ้น
// ฟังก์ชันนี้ดึงไฟล์ด้วยสิทธิ์ของเจ้าของระบบแล้วส่งต่อ
// จึงไม่ต้องเปิดไฟล์เป็นสาธารณะ
//
// เข้าได้เฉพาะแอดมิน เจ้าของระบบ และผู้ตรวจสอบ
// พนักงานหน้างานเรียกแล้วโดนปฏิเสธ (กติกาข้อ 4 ใน CLAUDE.md)
//
// ผู้ตรวจสอบมี role เป็น staff อยู่ข้างใต้ ต่างกันที่ธง can_dispatch
// ถ้าดูแค่ role จะโดนปฏิเสธไปด้วย ทั้งที่งานหลักของเขาคือดูรูปเซลฟี่
// แล้วตัดสินว่าคนนั้นเข้าประชุมจริงไหม — ไม่เห็นรูปก็ทำงานไม่ได้เลย
//
// ไฟล์นี้เขียนให้จบในตัวเอง ก๊อปวางใน Supabase Dashboard ได้ตรง ๆ
// secrets: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN
// =====================================================================

const VERSION = 'audit-v2'

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

function serviceKey(): string {
  return envAny('SUPABASE_SERVICE_ROLE_KEY', 'SB_SECRET_KEY', 'SUPABASE_SECRET_KEY')
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
      throw new Error('สิทธิ์เข้าถึง Google Drive หมดอายุแล้ว ให้เจ้าของระบบกดอนุญาตใหม่')
    }
    throw new Error(`ขอสิทธิ์จาก Google ไม่สำเร็จ: ${data.error_description ?? data.error ?? res.status}`)
  }
  cached = { token: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 }
  return cached.token
}

/** ผู้เรียกต้องเป็นแอดมินขึ้นไป ไม่ใช่พนักงานหน้างาน */
async function requireManager(req: Request): Promise<void> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) throw new Error('ต้องเข้าสู่ระบบก่อน')

  const ures = await fetch(`${envOrThrow('SUPABASE_URL')}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: publicKey() },
  })
  if (!ures.ok) throw new Error('เซสชันหมดอายุ เข้าสู่ระบบใหม่')
  const user = (await ures.json()) as { id?: string }
  if (!user.id) throw new Error('ไม่พบผู้ใช้')

  const key = serviceKey()
  const pres = await fetch(
    `${envOrThrow('SUPABASE_URL')}/rest/v1/profiles?id=eq.${user.id}&select=role,is_active,can_dispatch`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  )
  const rows = (await pres.json()) as {
    role?: string
    is_active?: boolean
    can_dispatch?: boolean
  }[]
  const me = rows[0]
  const maySee = Boolean(me?.is_active) && (me?.role === 'supervisor' || me?.role === 'admin' || me?.can_dispatch === true)
  if (!maySee) {
    throw new Error('บัญชีนี้เปิดดูรูปหลักฐานไม่ได้')
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const url = new URL(req.url)
  const fileId = url.searchParams.get('fileId')

  if (!fileId) return json({ name: 'evidence-image', version: VERSION })

  try {
    await requireManager(req)

    const token = await getAccessToken()
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!res.ok) {
      const t = await res.text()
      return json({ error: `ดึงรูปจาก Drive ไม่สำเร็จ: ${t.slice(0, 200)}` }, 502)
    }

    return new Response(res.body, {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': res.headers.get('Content-Type') ?? 'image/webp',
        // รูปหลักฐานไม่มีวันเปลี่ยน แคชได้ยาว ๆ ลดโหลดซ้ำ
        'Cache-Control': 'private, max-age=86400',
      },
    })
  } catch (e) {
    const msg = (e as Error).message
    return json({ error: msg }, /สิทธิ์|เข้าสู่ระบบ|เซสชัน|พนักงาน/.test(msg) ? 403 : 400)
  }
})
