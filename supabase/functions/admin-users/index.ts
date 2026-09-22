// =====================================================================
// admin-users — สร้างบัญชีพนักงาน / รีเซ็ตรหัสผ่าน (เฉพาะเจ้าของระบบ)
//
// ไฟล์นี้ตั้งใจเขียนให้จบในตัวเอง ไม่ import อะไรจากไฟล์อื่น
// จะได้ก๊อปวางใน Supabase Dashboard -> Edge Functions ได้ตรง ๆ
// โดยไม่ต้องใช้ CLI
//
// ต้องอยู่ฝั่งเซิร์ฟเวอร์เพราะใช้คีย์ service role ที่ข้าม RLS ได้
// ห้ามย้ายตรรกะนี้ไปฝั่ง client เด็ดขาด
//
// body: { action: 'create', employee_code, full_name, hub_code, role, password, email }
//       { action: 'reset',  user_id, password }
// =====================================================================

const MIN_PASSWORD = 8

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

/**
 * Supabase เปลี่ยนชื่อคีย์ระหว่างระบบเก่า (anon/service_role) กับใหม่ (publishable/secret)
 * โปรเจกต์ที่สร้างคนละช่วงจึงมีชื่อ env ไม่เหมือนกัน ลองทีละชื่อ
 */
function envAny(...names: string[]): string {
  for (const n of names) {
    const v = Deno.env.get(n)
    if (v) return v
  }
  throw new Error(`ยังไม่ได้ตั้งค่า secret สักตัวจาก: ${names.join(', ')}`)
}

/** คีย์ที่ข้าม RLS ได้ — ใช้ได้เฉพาะหลังตรวจสิทธิ์ผู้เรียกแล้วเท่านั้น */
function serviceKey(): string {
  return envAny('SUPABASE_SERVICE_ROLE_KEY', 'SB_SECRET_KEY', 'SUPABASE_SECRET_KEY')
}

/** คีย์สาธารณะ ใช้แค่เป็น apikey header ตอนถาม /auth/v1/user */
function publicKey(): string {
  return envAny(
    'SUPABASE_ANON_KEY',
    'SB_PUBLISHABLE_KEY',
    'SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  )
}

/** เรียก PostgREST ด้วยคีย์ service role */
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

interface AuthResponse {
  id?: string
  msg?: string
  message?: string
  error_description?: string
}

async function authAdmin<T>(path: string, init: RequestInit): Promise<T> {
  const key = serviceKey()
  const res = await fetch(`${envOrThrow('SUPABASE_URL')}/auth/v1/admin/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  const data = (text ? JSON.parse(text) : {}) as AuthResponse
  if (!res.ok) {
    throw new Error(data.msg ?? data.message ?? data.error_description ?? `Auth ตอบกลับ HTTP ${res.status}`)
  }
  return data as T
}

/** ตรวจว่าผู้เรียกเป็นเจ้าของระบบ (role admin) ที่ยังใช้งานอยู่ */
async function requireOwner(req: Request): Promise<string> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) throw new Error('ต้องเข้าสู่ระบบก่อน')

  const res = await fetch(`${envOrThrow('SUPABASE_URL')}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: publicKey() },
  })
  if (!res.ok) throw new Error('เซสชันหมดอายุ เข้าสู่ระบบใหม่')
  const user = (await res.json()) as { id?: string }
  if (!user.id) throw new Error('ไม่พบผู้ใช้')

  const rows = await db<{ role: string; is_active: boolean }[]>(
    `profiles?id=eq.${user.id}&select=role,is_active`,
  )
  const me = rows[0]
  if (!me || !me.is_active || me.role !== 'admin') {
    throw new Error('เฉพาะเจ้าของระบบเท่านั้นที่เพิ่มบัญชีหรือรีเซ็ตรหัสผ่านได้')
  }
  return user.id
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'ใช้ได้เฉพาะ POST' }, 405)

  try {
    await requireOwner(req)
    const body = await req.json()

    // ---------------------------------------------------------- รีเซ็ตรหัส
    if (body.action === 'reset') {
      const { user_id, password } = body as { user_id?: string; password?: string }
      if (!user_id) return json({ error: 'ไม่ได้ระบุผู้ใช้' }, 400)
      if (!password || password.length < MIN_PASSWORD) {
        return json({ error: `รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD} ตัวอักษร` }, 400)
      }

      await authAdmin(`users/${user_id}`, { method: 'PUT', body: JSON.stringify({ password }) })
      // รหัสนี้เป็นของชั่วคราว เจ้าตัวต้องตั้งใหม่ทันทีที่ล็อกอิน
      await db(`profiles?id=eq.${user_id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ must_change_password: true }),
      })
      return json({ ok: true })
    }

    // ------------------------------------------------------ สร้างบัญชีใหม่
    if (body.action === 'create') {
      const { employee_code, full_name, hub_code, role, password, email } = body as Record<string, string>

      if (!employee_code || !employee_code.trim()) return json({ error: 'ต้องใส่รหัสพนักงาน' }, 400)
      if (!full_name || !full_name.trim()) return json({ error: 'ต้องใส่ชื่อ-นามสกุล' }, 400)
      if (!hub_code || !hub_code.trim()) return json({ error: 'ต้องเลือกฮับ' }, 400)
      if (!['staff', 'supervisor'].includes(role)) {
        return json({ error: 'เพิ่มได้เฉพาะบทบาทหน้างานหรือแอดมิน' }, 400)
      }
      if (!password || password.length < MIN_PASSWORD) {
        return json({ error: `รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD} ตัวอักษร` }, 400)
      }

      const code = employee_code.trim()
      // อีเมลต้องมาจากรหัสพนักงานเสมอ กันตั้งมั่วจนล็อกอินไม่ตรงกับที่แอปคำนวณ
      if (!email || !email.toLowerCase().startsWith(`${code.toLowerCase()}@`)) {
        return json({ error: 'อีเมลไม่ตรงกับรหัสพนักงาน' }, 400)
      }

      const dup = await db<{ id: string }[]>(
        `profiles?employee_code=eq.${encodeURIComponent(code)}&select=id`,
      )
      if (dup.length > 0) return json({ error: `รหัสพนักงาน ${code} มีอยู่ในระบบแล้ว` }, 409)

      const created = await authAdmin<{ id: string }>('users', {
        method: 'POST',
        body: JSON.stringify({ email: email.toLowerCase(), password, email_confirm: true }),
      })
      if (!created.id) return json({ error: 'สร้างบัญชีไม่สำเร็จ' }, 502)

      try {
        await db('profiles', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            id: created.id,
            employee_code: code,
            full_name: full_name.trim(),
            hub_code,
            role,
            is_active: true,
            // รหัสที่เจ้าของระบบตั้งเป็นของชั่วคราว เจ้าตัวต้องตั้งเองตอนล็อกอินครั้งแรก
            must_change_password: true,
          }),
        })
      } catch (e) {
        // เขียนโปรไฟล์ไม่สำเร็จ ต้องลบบัญชี auth ทิ้ง
        // ไม่งั้นเหลือบัญชีผีที่ล็อกอินได้แต่ไม่มีโปรไฟล์
        await authAdmin(`users/${created.id}`, { method: 'DELETE' }).catch(() => {})
        throw e
      }

      return json({ ok: true, id: created.id, email: email.toLowerCase() })
    }

    return json({ error: 'ไม่รู้จักคำสั่งนี้' }, 400)
  } catch (e) {
    const msg = (e as Error).message
    return json({ error: msg }, /สิทธิ์|เข้าสู่ระบบ|เซสชัน/.test(msg) ? 403 : 400)
  }
})
