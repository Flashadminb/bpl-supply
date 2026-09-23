// =====================================================================
// push-sent — แจ้งเตือนเข้ามือถือ (Web Push)
//
// สามคำสั่ง
//   subscribe  เครื่องนี้ขออนุญาตแล้ว เก็บ endpoint ไว้
//   test       ยิงทดสอบหาตัวเอง
//   run        นาฬิกาเรียกทุก 5 นาที · ดูว่าใครต้องเตือนแล้วส่งให้
//
// เข้ารหัสตามมาตรฐาน aes128gcm (RFC 8291) + VAPID (RFC 8292) เขียนเอง
// ไม่พึ่งไลบรารีข้างนอก จะได้ก๊อปวางใน Dashboard แล้วใช้ได้เลย
//
// secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET
// =====================================================================

const VERSION = 'push-v1'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
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

/* --------------------------------------------------------------- base64 */

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToB64url(b: Uint8Array): string {
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const utf8 = (s: string) => new TextEncoder().encode(s)

/* ------------------------------------------------------------------ HKDF */

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data))
}

/** HKDF ที่ใช้ใน Web Push ต้องการ output สั้นกว่า 32 ไบต์เสมอ จึงวนรอบเดียวพอ */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const prk = await hmac(salt, ikm)
  const okm = await hmac(prk, concat(info, new Uint8Array([1])))
  return okm.slice(0, len)
}

/* ------------------------------------------------------------- VAPID JWT */

async function vapidHeader(endpoint: string): Promise<string> {
  const aud = new URL(endpoint).origin
  const pub = envOrThrow('VAPID_PUBLIC_KEY')
  const d = envOrThrow('VAPID_PRIVATE_KEY')
  const sub = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@bpl.local'

  const raw = b64urlToBytes(pub)
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: bytesToB64url(raw.slice(1, 33)),
    y: bytesToB64url(raw.slice(33, 65)),
    d,
    ext: true,
  }
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
  ])

  const header = bytesToB64url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claim = bytesToB64url(
    utf8(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub })),
  )
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      utf8(`${header}.${claim}`),
    ),
  )
  return `vapid t=${header}.${claim}.${bytesToB64url(sig)}, k=${pub}`
}

/* ------------------------------------------------- เข้ารหัสตัวข้อความ */

async function encrypt(p256dhB64: string, authB64: string, plaintext: string) {
  const clientPub = b64urlToBytes(p256dhB64)
  const authSecret = b64urlToBytes(authB64)

  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])
  const ephPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey))

  const clientKey = await crypto.subtle.importKey(
    'raw',
    clientPub,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, eph.privateKey, 256),
  )

  // ไล่ตาม RFC 8291 ตรงตัว ลำดับ client ก่อน server เสมอ
  const keyInfo = concat(utf8('WebPush: info\0'), clientPub, ephPubRaw)
  const ikm = await hkdf(authSecret, shared, keyInfo, 32)

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12)

  const aes = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt'])
  // 0x02 คือตัวปิดท้ายบอกว่าเป็นบล็อกสุดท้าย
  const body = concat(utf8(plaintext), new Uint8Array([2]))
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, body),
  )

  const rs = new Uint8Array(4)
  new DataView(rs.buffer).setUint32(0, 4096)
  return concat(salt, rs, new Uint8Array([ephPubRaw.length]), ephPubRaw, cipher)
}

interface Sub {
  endpoint: string
  p256dh: string
  auth: string
}

/** คืน true ถ้าส่งสำเร็จ · คืน 'gone' ถ้าเบราว์เซอร์บอกว่าเลิกใช้แล้ว */
async function send(sub: Sub, payload: unknown): Promise<true | 'gone' | string> {
  const body = await encrypt(sub.p256dh, sub.auth, JSON.stringify(payload))
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(sub.endpoint),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body,
  })
  if (res.ok) return true
  if (res.status === 404 || res.status === 410) return 'gone'
  return `HTTP ${res.status} ${await res.text().catch(() => '')}`.trim()
}

/* --------------------------------------------------------------- Supabase */

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

async function rpc<T>(name: string, args: unknown = {}): Promise<T> {
  const key = serviceKey()
  const res = await fetch(`${envOrThrow('SUPABASE_URL')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(text || `rpc ${name} ล้มเหลว`)
  return (text ? JSON.parse(text) : null) as T
}

async function currentUser(req: Request): Promise<string> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) throw new Error('ต้องเข้าสู่ระบบก่อน')
  const res = await fetch(`${envOrThrow('SUPABASE_URL')}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: publicKey() },
  })
  if (!res.ok) throw new Error('เซสชันหมดอายุ เข้าสู่ระบบใหม่')
  const u = (await res.json()) as { id?: string }
  if (!u.id) throw new Error('อ่านบัญชีไม่ได้')
  return u.id
}

async function subsOf(userId: string): Promise<Sub[]> {
  return await db<Sub[]>(
    `push_subscriptions?user_id=eq.${userId}&select=endpoint,p256dh,auth`,
  )
}

async function dropSub(endpoint: string) {
  await db(`push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: 'DELETE' })
}

/* ------------------------------------------------------------------ serve */

interface Job {
  kind: string
  subject: string
  user_id: string
  title: string
  body: string
  url: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method === 'GET') {
    return json({
      name: 'push-sent',
      version: VERSION,
      publicKeySet: Boolean(Deno.env.get('VAPID_PUBLIC_KEY')),
      cronKeySet: Boolean(Deno.env.get('CRON_SECRET')),
    })
  }
  if (req.method !== 'POST') return json({ error: 'ใช้ได้เฉพาะ POST' }, 405)

  try {
    const payload = (await req.json().catch(() => ({}))) as {
      action?: string
      subscription?: { endpoint: string; keys: { p256dh: string; auth: string } }
    }
    const action = payload.action ?? 'run'

    /* ------------------------------------------------ ลงทะเบียนเครื่องนี้ */
    if (action === 'subscribe') {
      const userId = await currentUser(req)
      const s = payload.subscription
      if (!s?.endpoint || !s.keys?.p256dh || !s.keys?.auth) {
        return json({ error: 'ข้อมูลการสมัครรับแจ้งเตือนไม่ครบ' }, 400)
      }
      await db('push_subscriptions?on_conflict=endpoint', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          endpoint: s.endpoint,
          user_id: userId,
          p256dh: s.keys.p256dh,
          auth: s.keys.auth,
          user_agent: req.headers.get('user-agent') ?? null,
          fail_count: 0,
        }),
      })
      return json({ ok: true })
    }

    if (action === 'unsubscribe') {
      await currentUser(req)
      const ep = payload.subscription?.endpoint
      if (ep) await dropSub(ep)
      return json({ ok: true })
    }

    /* ------------------------------------------------------- ยิงทดสอบ */
    if (action === 'test') {
      const userId = await currentUser(req)
      const subs = await subsOf(userId)
      if (subs.length === 0) return json({ error: 'เครื่องนี้ยังไม่ได้เปิดแจ้งเตือน' }, 400)

      let ok = 0
      const errors: string[] = []
      for (const s of subs) {
        const r = await send(s, {
          title: 'ทดสอบแจ้งเตือน',
          body: 'ถ้าเห็นข้อความนี้ แปลว่าใช้ได้แล้ว',
          url: '/',
        })
        if (r === true) ok++
        else if (r === 'gone') await dropSub(s.endpoint)
        else errors.push(r)
      }
      return json({ ok: true, sent: ok, errors })
    }

    /* ----------------------------------------------- นาฬิกาเรียกทุก 5 นาที */
    if (action === 'run') {
      const expect = Deno.env.get('CRON_SECRET')
      const given = req.headers.get('x-cron-key')
      if (!expect || given !== expect) return json({ error: 'ไม่มีสิทธิ์เรียกงานนี้' }, 403)

      const jobs = await rpc<Job[]>('push_due_jobs')
      let sent = 0
      let skipped = 0

      for (const j of jobs ?? []) {
        const subs = await subsOf(j.user_id)
        if (subs.length === 0) {
          // ยังไม่เคยเปิดแจ้งเตือน ข้ามไปแต่ไม่จดว่าเตือนแล้ว
          // เผื่อเปิดทีหลังจะได้ยังได้รับ
          skipped++
          continue
        }
        let any = false
        for (const s of subs) {
          const r = await send(s, { title: j.title, body: j.body, url: j.url })
          if (r === true) any = true
          else if (r === 'gone') await dropSub(s.endpoint)
        }
        if (any) {
          await rpc('push_mark_sent', { p_kind: j.kind, p_subject: j.subject, p_user: j.user_id })
          sent++
        }
      }

      await rpc('push_prune_log').catch(() => undefined)
      return json({ ok: true, jobs: jobs?.length ?? 0, sent, skipped, version: VERSION })
    }

    return json({ error: 'ไม่รู้จักคำสั่งนี้' }, 400)
  } catch (e) {
    return json({ error: (e as Error).message }, 400)
  }
})
