/**
 * ตรวจ token ของ Supabase ด้วยกุญแจสาธารณะ · เขียนเอง ไม่ลงไลบรารี
 *
 * เหตุผลเดียวกับ xlsx.ts กับ code128.ts ที่เขียนเองในโปรเจกต์นี้
 * ไลบรารีตรวจ token ตัวที่คนใช้กันลากของพ่วงมาเป็นสิบไฟล์
 * ส่วนที่เราต้องใช้จริงคือสี่ขั้น ซึ่งเบราว์เซอร์กับ Worker มีให้ครบอยู่แล้ว
 *
 * ─────────────────────────────────────────────────────────────────
 * ทำไมปลอดภัย
 *
 * โปรเจกต์นี้เซ็น token ด้วย ES256 ซึ่งเป็นกุญแจคู่
 * Supabase ถือกุญแจส่วนตัวไว้คนเดียวสำหรับเซ็น เราใช้แค่กุญแจสาธารณะเพื่อตรวจ
 * แปลว่า **ไม่มีรหัสลับต้องเก็บไว้ในนี้เลย** ต่อให้โค้ดนี้หลุดทั้งไฟล์
 * ก็ปลอม token ไม่ได้ · ต่างจากแบบรหัสลับร่วมที่หลุดแล้วปลอมได้ทันที
 * ─────────────────────────────────────────────────────────────────
 *
 * สี่อย่างที่ต้องตรวจ ขาดข้อใดข้อหนึ่งคือรูโหว่
 *   ① ลายเซ็นถูกต้องตามกุญแจสาธารณะของโปรเจกต์เรา
 *   ② ยังไม่หมดอายุ
 *   ③ ออกโดยโปรเจกต์เรา ไม่ใช่โปรเจกต์ Supabase ของคนอื่น
 *   ④ อัลกอริทึมคือ ES256 จริง · ถ้าไม่ล็อกข้อนี้ คนส่ง alg none มาได้
 */

const te = new TextEncoder()

/** ถอด base64url เป็นไบต์ */
function b64u(s: string): Uint8Array {
  const b = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b.length % 4 ? '='.repeat(4 - (b.length % 4)) : ''
  const raw = atob(b + pad)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/**
 * ถอดส่วนของ token เป็นออบเจกต์
 *
 * ห่อ try ไว้เพราะคนส่งอะไรมาก็ได้ · ถ้าปล่อยให้ JSON.parse โยนดิบ ๆ
 * ข้อความผิดพลาดของเครื่องจะหลุดออกไปถึงคนเรียก ซึ่งบอกใบ้ว่าข้างในทำอะไรอยู่
 * ตอบสั้น ๆ ว่ารูปแบบไม่ถูกต้องพอ · คนที่ส่ง token จริงไม่มีวันเจอข้อความนี้
 */
function b64uJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(new TextDecoder().decode(b64u(s))) as Record<string, unknown>
  } catch {
    throw new Error('รูปแบบ token ไม่ถูกต้อง')
  }
}

interface Jwk {
  kid: string
  kty: string
  crv: string
  x: string
  y: string
  alg?: string
}

/**
 * กุญแจสาธารณะ · เก็บไว้ในหน่วยความจำของ Worker สักพัก
 *
 * ไม่แคชเลยคือไปขอ Supabase ทุกคำขอ ซึ่งช้าและเปลืองเปล่า ๆ
 * แคชตลอดไปคือวันที่ Supabase หมุนกุญแจแล้วทุกคนล็อกอินไม่ได้จนกว่าจะ deploy ใหม่
 * สิบนาทีคือจุดกึ่งกลางที่ทั้งเร็วและตามการหมุนกุญแจทัน
 *
 * ถ้าเจอ kid ที่ไม่รู้จัก จะไปขอใหม่ทันทีโดยไม่รอหมดอายุแคช
 * เพราะนั่นคือสัญญาณว่ากุญแจเพิ่งถูกหมุน
 */
const KEY_TTL_MS = 10 * 60 * 1000
let keyCache: { at: number; keys: Map<string, CryptoKey> } | null = null

async function loadKeys(supabaseUrl: string): Promise<Map<string, CryptoKey>> {
  const res = await fetch(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)
  if (!res.ok) throw new Error('ขอกุญแจสาธารณะจาก Supabase ไม่สำเร็จ')
  const body = (await res.json()) as { keys?: Jwk[] }
  const map = new Map<string, CryptoKey>()

  for (const jwk of body.keys ?? []) {
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') continue
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )
    map.set(jwk.kid, key)
  }

  if (!map.size) throw new Error('โปรเจกต์นี้ไม่ได้ใช้กุญแจสาธารณะ ตรวจแบบนี้ไม่ได้')
  keyCache = { at: Date.now(), keys: map }
  return map
}

async function keyFor(kid: string, supabaseUrl: string): Promise<CryptoKey | null> {
  const fresh = keyCache && Date.now() - keyCache.at < KEY_TTL_MS
  if (fresh && keyCache!.keys.has(kid)) return keyCache!.keys.get(kid)!
  /* ไม่เจอ kid หรือแคชเก่าแล้ว · ไปขอใหม่ เผื่อเพิ่งหมุนกุญแจ */
  const keys = await loadKeys(supabaseUrl)
  return keys.get(kid) ?? null
}

export interface Who {
  /** รหัสผู้ใช้ของ Supabase · ตรงกับ profiles.id */
  sub: string
  email: string | null
  exp: number
}

/**
 * ตรวจ token · คืนข้อมูลคนใช้ถ้าผ่าน โยนข้อผิดพลาดถ้าไม่ผ่าน
 *
 * ไม่คืน null เงียบ ๆ เพราะคนเรียกอาจลืมเช็ก แล้วกลายเป็นเปิดให้ใครก็ได้
 * โยนทิ้งไปเลยปลอดภัยกว่า ลืมดักก็แค่ขึ้น 500 ไม่ใช่ข้อมูลหลุด
 */
export async function verifyToken(token: string, supabaseUrl: string): Promise<Who> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('รูปแบบ token ไม่ถูกต้อง')

  const head = b64uJson(parts[0]) as { alg?: string; kid?: string }
  /* ④ ล็อกอัลกอริทึม · ไม่ยอมรับอะไรนอกจาก ES256 */
  if (head.alg !== 'ES256') throw new Error('อัลกอริทึมของ token ไม่ใช่ ES256')
  if (!head.kid) throw new Error('token ไม่มีหมายเลขกุญแจ')

  const key = await keyFor(head.kid, supabaseUrl)
  if (!key) throw new Error('ไม่รู้จักกุญแจที่ใช้เซ็น token นี้')

  /* ① ลายเซ็น · ES256 เซ็นแบบ r ต่อ s ตรง ๆ ซึ่งตรงกับที่ WebCrypto ต้องการพอดี */
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    b64u(parts[2]),
    te.encode(`${parts[0]}.${parts[1]}`),
  )
  if (!ok) throw new Error('ลายเซ็นของ token ไม่ถูกต้อง')

  const body = b64uJson(parts[1]) as {
    sub?: string
    email?: string
    exp?: number
    iss?: string
  }

  /* ② หมดอายุหรือยัง */
  const now = Math.floor(Date.now() / 1000)
  if (!body.exp || body.exp <= now) throw new Error('token หมดอายุแล้ว')

  /* ③ ออกจากโปรเจกต์เราจริงไหม · กันคนเอา token ของโปรเจกต์ Supabase อื่นมาใช้ */
  if (body.iss !== `${supabaseUrl}/auth/v1`) throw new Error('token ไม่ได้ออกจากโปรเจกต์นี้')

  if (!body.sub) throw new Error('token ไม่มีรหัสผู้ใช้')

  return { sub: body.sub, email: body.email ?? null, exp: body.exp }
}
