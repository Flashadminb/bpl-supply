import { verifyToken, type Who } from './auth'

/**
 * ตัวกลางของหน้าจับคู่
 *
 * ขั้นนี้ยังไม่แตะข้อมูลเลยสักแถว · มีแค่สองเส้นทางไว้พิสูจน์เรื่องเดียว
 * คือ "ล็อกอินเดิมของแอพ ใช้กับที่นี่ได้จริงไหม"
 *
 * พิสูจน์ข้อนี้ให้ผ่านก่อนค่อยย้ายข้อมูล · ถ้าย้ายข้อมูลไปก่อนแล้วค่อยพบว่า
 * การยืนยันตัวตนมีปัญหา จะกลายเป็นมีข้อมูลกองอยู่ที่ที่เข้าไม่ถึง
 *
 * ของเดิมใน Supabase ยังทำงานปกติทั้งหมด ไฟล์นี้ไม่ได้แตะอะไรของเขาเลย
 */

interface Env {
  SUPABASE_URL: string
  ALLOW_ORIGIN: string
  /** สายเชื่อมฐานข้อมูล Neon · ตั้งเป็น secret ไม่ได้อยู่ในไฟล์ไหนทั้งนั้น */
  NEON_URL?: string
}

/**
 * หัว CORS · อนุญาตเฉพาะเว็บของเรา
 *
 * ไม่ใช้ * เพราะนั่นแปลว่าเว็บไหนก็เรียกได้ · ถึงจะยังต้องมี token อยู่ดี
 * แต่การปล่อยให้เว็บแปลกหน้ายิงมาได้คือเปิดช่องให้ทดลองหาช่องโหว่ฟรี ๆ
 */
function cors(env: Env, origin: string | null): Record<string, string> {
  const ok = origin === env.ALLOW_ORIGIN || origin === 'http://localhost:5173'
  return {
    'Access-Control-Allow-Origin': ok ? origin! : env.ALLOW_ORIGIN,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'content-type': 'application/json; charset=utf-8' },
  })
}

/** ดึง token จากหัว Authorization · ไม่มีก็คือไม่ผ่าน ไม่มีทางลัดอื่น */
async function who(req: Request, env: Env): Promise<Who> {
  const h = req.headers.get('authorization') ?? ''
  const m = /^Bearer\s+(.+)$/i.exec(h.trim())
  if (!m) throw new Error('ไม่มี token มาด้วย')
  return verifyToken(m[1], env.SUPABASE_URL)
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('origin')
    const h = cors(env, origin)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h })

    const url = new URL(req.url)

    /* เส้นทางเดียวที่ไม่ต้องมี token · ไว้เช็กว่าตัวกลางยังมีชีวิตอยู่ */
    if (url.pathname === '/health') {
      return json(
        {
          ok: true,
          service: 'bpl-pair-api',
          /* บอกว่าต่อฐานข้อมูลไว้หรือยัง แต่ไม่บอกว่าต่อไปที่ไหน */
          db: env.NEON_URL ? 'ตั้งค่าแล้ว' : 'ยังไม่ได้ตั้ง',
          at: new Date().toISOString(),
        },
        200,
        h,
      )
    }

    /* ต้องมี token ของ Supabase ตัวเดิมเท่านั้น */
    if (url.pathname === '/whoami') {
      try {
        const me = await who(req, env)
        return json(
          {
            ok: true,
            user_id: me.sub,
            email: me.email,
            /* บอกว่าเหลืออีกกี่นาที token จะหมดอายุ · ไว้ดูตอนทดสอบ */
            expires_in_min: Math.round((me.exp * 1000 - Date.now()) / 60000),
          },
          200,
          h,
        )
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, 401, h)
      }
    }

    return json({ ok: false, error: 'ไม่มีเส้นทางนี้' }, 404, h)
  },
}
