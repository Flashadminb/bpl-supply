import { verifyToken, type Who } from './auth'
import { one, sql } from './db'

/**
 * ตัวกลางของหน้าจับคู่
 *
 * หน้าเว็บคุยกับที่นี่แทนที่จะคุยกับ Supabase โดยตรงสำหรับงานจับคู่อย่างเดียว
 * งานอื่นทั้งหมดของแอพยังคุยกับ Supabase เหมือนเดิม ไม่เกี่ยวกับไฟล์นี้เลย
 *
 * ─────────────────────────────────────────────────────────────────
 * ด่านสามชั้น เรียงตามลำดับที่ตรวจ
 *
 *   ① token ต้องเป็นของจริงจากโปรเจกต์ Supabase ของเรา
 *   ② บัญชีนั้นต้องยังไม่ถูกระงับ · ถามจาก Supabase จำคำตอบไว้หนึ่งนาที
 *   ③ งานที่เป็นของผู้ดูแลระบบ ต้องมี role เป็น admin
 *
 * ชั้นที่ ② สำคัญกว่าที่คิด · ถ้าตรวจแค่ลายเซ็น คนที่เพิ่งโดนระงับ
 * จะยังใช้งานได้จนกว่า token เดิมจะหมดอายุ ซึ่งนานถึงหนึ่งชั่วโมง
 * ระบบที่ไล่คนออกแล้วเขายังเปิดดูของได้อีกชั่วโมง คือระบบที่อธิบายกับหัวหน้ายาก
 * ─────────────────────────────────────────────────────────────────
 */

interface Env {
  SUPABASE_URL: string
  ALLOW_ORIGIN: string
  /** กุญแจสาธารณะของ Supabase · ไม่ใช่ความลับ ติดมากับหน้าเว็บอยู่แล้ว */
  SUPABASE_ANON_KEY?: string
  /** สายเชื่อมฐานข้อมูล Neon · เป็น secret ไม่ได้อยู่ในไฟล์ไหน */
  NEON_URL?: string
}

/* --------------------------------------------------------------- CORS */

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

/* --------------------------------------------------------- ใครกำลังขอ */

interface Profile {
  role: string
  is_active: boolean
  full_name: string
  employee_code: string
}

export interface Caller extends Who {
  profile: Profile
}

/**
 * ข้อมูลพนักงานของคนที่ถือ token นี้
 *
 * ถามจาก Supabase ด้วย token ของเจ้าตัวเอง · RLS ฝั่งโน้นจึงยังเป็นคนตัดสิน
 * ว่าเขาเห็นแถวของตัวเองได้ เราไม่ได้ใช้กุญแจพิเศษอะไรเพื่อแอบดูของคนอื่น
 *
 * จำคำตอบไว้หนึ่งนาที · ไม่จำเลยคือยิงไป Supabase ทุกคำขอซึ่งช้าและเปลือง
 * จำนานกว่านี้คือการระงับบัญชีมีผลช้าเกินไป
 */
const PROFILE_TTL_MS = 60 * 1000
const profileCache = new Map<string, { at: number; p: Profile }>()

async function profileOf(uid: string, token: string, env: Env): Promise<Profile> {
  const hit = profileCache.get(uid)
  if (hit && Date.now() - hit.at < PROFILE_TTL_MS) return hit.p

  /* ตัดช่องว่างกับอักขระท้ายบรรทัดออกก่อนใช้
     ตอนเก็บ secret ด้วยการไพป์ไฟล์เข้าไป มันติดตัวขึ้นบรรทัดใหม่มาด้วยได้ง่าย ๆ
     ตาเปล่ามองไม่เห็น แต่ Supabase ตอบว่ากุญแจไม่ถูกต้อง ซึ่งพาไปไล่หาผิดจุดอยู่นาน */
  const key = (env.SUPABASE_ANON_KEY ?? '').trim()
  if (!key) throw new Error('ยังไม่ได้ตั้งกุญแจสาธารณะของ Supabase')

  const u =
    `${env.SUPABASE_URL}/rest/v1/profiles` +
    `?id=eq.${encodeURIComponent(uid)}&select=role,is_active,full_name,employee_code&limit=1`
  const res = await fetch(u, {
    headers: { apikey: key, authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    /* บอกสาเหตุจริงออกมา · ข้อความลอย ๆ ว่าไม่สำเร็จ ทำให้ไล่หาต้นเหตุไม่ได้เลย
       ตรงนี้เห็นเฉพาะคนที่มี token ที่ถูกต้องอยู่แล้ว จึงไม่ได้เปิดอะไรให้คนนอก */
    const t = await res.text()
    throw new Error(`ถามข้อมูลพนักงานจาก Supabase ไม่สำเร็จ · ${res.status} · ${t.slice(0, 200)}`)
  }

  const rows = (await res.json()) as Profile[]
  if (!rows.length) throw new Error('ไม่พบบัญชีนี้ในระบบ')

  const p: Profile = {
    role: String(rows[0].role ?? ''),
    is_active: rows[0].is_active === true,
    full_name: String(rows[0].full_name ?? ''),
    employee_code: String(rows[0].employee_code ?? ''),
  }
  profileCache.set(uid, { at: Date.now(), p })
  return p
}

/** ด่าน ① และ ② · ทุกเส้นทางที่ไม่ใช่ /health ต้องผ่านตรงนี้ */
async function gate(req: Request, env: Env): Promise<Caller> {
  const h = req.headers.get('authorization') ?? ''
  const m = /^Bearer\s+(.+)$/i.exec(h.trim())
  if (!m) throw new Error('ไม่มี token มาด้วย')

  const who = await verifyToken(m[1], env.SUPABASE_URL)
  const profile = await profileOf(who.sub, m[1], env)
  if (!profile.is_active) throw new Error('บัญชีนี้ถูกระงับการใช้งาน')

  return { ...who, profile }
}

/** ด่าน ③ */
function needAdmin(me: Caller): void {
  if (me.profile.role !== 'admin') throw new Error('เฉพาะผู้ดูแลระบบเท่านั้น')
}

/* อ่านฟังก์ชันที่คืนเป็นตาราง แล้วห่อเป็น jsonb ก้อนเดียว · เหตุผลอยู่ที่ case '/runs' */
const RUN_LIST = "select coalesce(jsonb_agg(to_jsonb(t) order by (t.id) desc), '[]'::jsonb) from p48_run_list() t"
const SLA_LIST = "select coalesce(jsonb_agg(to_jsonb(t) order by t.sort_no, t.cust_type), '[]'::jsonb) from p48_sla_list() t"

function db(env: Env): string {
  /* ตัดช่องว่างท้ายออกเหมือนกุญแจด้านบน · ค่าที่เก็บเป็น secret ติดตัวขึ้นบรรทัดใหม่มาด้วย
     ซึ่งทำให้ new URL อ่านชื่อโฮสต์ไม่ออก และขึ้นว่าสายเชื่อมผิดรูปแบบ */
  const conn = (env.NEON_URL ?? '').trim()
  if (!conn) throw new Error('ยังไม่ได้ตั้งสายเชื่อมฐานข้อมูล')
  return conn
}

/* ------------------------------------------------- จำคำตอบที่ซ้ำกันทุกคน */

/**
 * ไวท์บอร์ดหน้าห้อง
 *
 * ─────────────────────────────────────────────────────────────────
 * มีไว้ประหยัดชั่วโมงเครื่อง ไม่ใช่ประหยัดความเร็ว
 *
 * ฐานข้อมูลฝั่งนี้ดับเองเมื่อไม่มีคำสั่งเข้ามา 5 นาที และคิดค่าใช้ตามชั่วโมงที่ติดเครื่อง
 * แปลว่าทุกคำถามที่ยิงไป ไม่ได้จ่ายแค่ค่าตอบคำถามนั้น แต่จ่ายค่าเครื่องติดต่ออีกห้านาที
 *
 * ของสี่อย่างนี้เหมือนกันทุกคน และเปลี่ยนเฉพาะตอนมีคนอัปไฟล์ใหม่เท่านั้น
 *   ตัวเลขสรุปหัวจอ · รายการในตัวกรอง · ตาราง SLA · ตารางหน้าแรกตอนยังไม่พิมพ์อะไร
 * ทั้งสี่อย่างคือทุกอย่างที่เกิดขึ้นตอนคนเปิดหน้ามาดูเฉย ๆ
 * จำไว้แล้วคนเปิดดูจะไม่ปลุกเครื่องเลย เหลือแต่คนที่ค้นจริง ๆ
 * ─────────────────────────────────────────────────────────────────
 *
 * อยู่ในหน่วยความจำของ Worker ไม่ได้ลงที่เก็บถาวรที่ไหน
 * Worker รีไซเคิลเมื่อไหร่ก็หายไปเอง ซึ่งไม่เป็นไร แค่ไปถามใหม่หนึ่งครั้ง
 */

interface Memo {
  at: number
  body: unknown
}

/** นานแค่ไหนถึงถือว่าเก่า · สิบนาที */
const MEMO_MS = 10 * 60 * 1000

const memo = new Map<string, Memo>()

/**
 * ลบกระดานทิ้งทั้งแผ่น · เรียกทุกครั้งที่มีอะไรเปลี่ยน
 *
 * ไม่ได้ลบทีละช่องเพราะของทั้งสี่อย่างเปลี่ยนพร้อมกันหมดอยู่แล้ว
 * เมื่อมีไฟล์ใหม่เข้ามา และลบเกินไปแค่ไปถามใหม่ครั้งเดียว ซึ่งถูกกว่าการลบผิดช่อง
 */
function memoClear(): void {
  memo.clear()
}

/**
 * ตอบจากกระดานถ้ามี ไม่มีก็ไปถามแล้วเขียนขึ้นกระดาน
 *
 * ─────────────────────────────────────────────────────────────────
 * ข้อแลกเปลี่ยนที่ต้องรู้
 *
 * Worker มีหลายตัววิ่งพร้อมกัน แต่ละตัวมีกระดานของตัวเอง
 * คนที่อัปไฟล์จะลบกระดานของตัวที่รับคำขอเขาเท่านั้น ตัวอื่นยังถือของเก่าอยู่
 * แปลว่าหลังอัปไฟล์ใหม่ อาจมีคนเห็นตัวเลขเก่าได้นานสุดสิบนาที
 *
 * ยอมรับได้เพราะหน้าจอบอกเวลาที่อัปกับชื่อคนอัปอยู่แล้วทุกครั้ง
 * คนที่เห็นของเก่าจะเห็นเวลาเก่าคู่กันไปด้วย ไม่ใช่ตัวเลขลอย ๆ ที่ไม่รู้ว่าของเมื่อไหร่
 * และถ้าอยากได้ของสดทันทีมี fresh=1 ให้ข้ามกระดานไปถามตรง ๆ ได้
 * ─────────────────────────────────────────────────────────────────
 */
async function memoized(key: string, fresh: boolean, make: () => Promise<unknown>): Promise<unknown> {
  if (!fresh) {
    const hit = memo.get(key)
    if (hit && Date.now() - hit.at < MEMO_MS) return hit.body
  }
  const body = await make()
  memo.set(key, { at: Date.now(), body })
  return body
}

/**
 * คำค้นนี้เป็นหน้าแรกเปล่า ๆ ที่ทุกคนเห็นเหมือนกันหรือเปล่า
 *
 * ต้องไม่มีตัวกรองใดถูกเลือกเลย และต้องเป็นหน้าแรก
 * พลาดข้อใดข้อหนึ่งคือเอาผลของคนหนึ่งไปให้อีกคน ซึ่งแย่กว่าไม่แคชเลยมาก
 * จึงไล่เช็กทุกช่องแบบตรงไปตรงมา ไม่ใช้วิธีเดาจากจำนวนช่อง
 */
function isPlainFirstPage(b: Record<string, unknown>): boolean {
  const empty = (v: unknown) => v === undefined || v === null || v === '' || v === false
  return (
    empty(b.q) &&
    empty(b.sla) &&
    empty(b.cust) &&
    empty(b.dest) &&
    empty(b.action) &&
    empty(b.prov) &&
    empty(b.bag) &&
    empty(b.nop) &&
    empty(b.cn) &&
    (b.offset === undefined || b.offset === null || Number(b.offset) === 0)
  )
}

/* ------------------------------------------------------------ เส้นทาง */

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('origin')
    const h = cors(env, origin)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h })

    const url = new URL(req.url)
    const path = url.pathname

    /* เส้นทางเดียวที่ไม่ต้องมี token */
    if (path === '/health') {
      return json(
        {
          ok: true,
          service: 'bpl-pair-api',
          db: env.NEON_URL ? 'ตั้งค่าแล้ว' : 'ยังไม่ได้ตั้ง',
          key: env.SUPABASE_ANON_KEY ? 'ตั้งค่าแล้ว' : 'ยังไม่ได้ตั้ง',
          at: new Date().toISOString(),
        },
        200,
        h,
      )
    }

    let me: Caller
    try {
      me = await gate(req, env)
    } catch (e) {
      return json({ ok: false, error: (e as Error).message }, 401, h)
    }

    try {
      const body = req.method === 'POST' ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {}
      const C = db(env)
      /* ข้ามกระดานไปถามฐานข้อมูลตรง ๆ · ไว้ให้กดโหลดใหม่แล้วได้ของสดแน่นอน */
      const fresh = url.searchParams.get('fresh') === '1'

      switch (path) {
        case '/whoami':
          return json(
            {
              ok: true,
              user_id: me.sub,
              name: me.profile.full_name,
              code: me.profile.employee_code,
              role: me.profile.role,
              expires_in_min: Math.round((me.exp * 1000 - Date.now()) / 60000),
            },
            200,
            h,
          )

        case '/dbcheck': {
          const t0 = Date.now()
          const r = await sql(
            C,
            `select (select count(*) from p48_parcels)  as parcels,
                    (select count(*) from p48_products) as products,
                    (select count(*) from p48_runs)     as runs,
                    current_database() as db,
                    pg_database_size(current_database()) as bytes`,
          )
          return json({ ok: true, ms: Date.now() - t0, ...r.rows[0] }, 200, h)
        }

        /* ---- อ่าน ---- */
        case '/stats': {
          /* ติดชื่อฐานข้อมูลกลับไปด้วยในคำขอเดียวกัน
             หน้าเว็บจะได้บอกคนใช้ได้ว่ากำลังอ่านของจากที่ไหน โดยไม่ต้องยิงเพิ่มอีกรอบ
             และเป็นชื่อที่ถามจากฐานข้อมูลจริง ๆ ไม่ใช่ข้อความที่เขียนตายไว้ในหน้าเว็บ
             ซึ่งวันหนึ่งที่ย้ายอีกทีแล้วลืมแก้ จะกลายเป็นป้ายที่โกหก */
          const data = await memoized('stats', fresh, async () => {
            const r = await sql<{ data: unknown; db: string }>(
              C,
              'select p48_stats() as data, current_database() as db',
            )
            const row = r.rows[0]
            return { ...(row?.data as Record<string, unknown>), source: row?.db ?? '' }
          })
          return json({ ok: true, data }, 200, h)
        }

        case '/facets':
          return json(
            { ok: true, data: await memoized('facets', fresh, () => one(C, 'select p48_facets()')) },
            200,
            h,
          )

        case '/search': {
          const run = () => one(C, 'select p48_search($1::jsonb)', [JSON.stringify(body)])
          /* แคชเฉพาะหน้าแรกที่ยังไม่มีใครพิมพ์อะไร · ที่เหลือเป็นของเฉพาะคนถาม */
          const data = isPlainFirstPage(body) ? await memoized('search:plain', fresh, run) : await run()
          return json({ ok: true, data }, 200, h)
        }

        case '/one':
          return json(
            { ok: true, data: await one(C, 'select p48_one($1)', [url.searchParams.get('tracking') ?? '']) },
            200,
            h,
          )

        case '/runs': {
          needAdmin(me)
          /* ห่อเป็น jsonb ให้ Postgres แปลงชนิดเอง
             ถ้าอ่านเป็นตารางดิบ ช่อง bigint จะมาเป็นข้อความและเวลาจะมาเป็นรูปแบบของ Postgres
             ซึ่งไม่เหมือนที่ฝั่ง Supabase ส่งมา แล้วหน้าเว็บต้องรู้ว่าคุยกับใครอยู่ ซึ่งไม่ควร */
          return json({ ok: true, data: await one(C, RUN_LIST) }, 200, h)
        }

        case '/sla': {
          if (req.method === 'GET') {
            return json({ ok: true, data: await memoized('sla', fresh, () => one(C, SLA_LIST)) }, 200, h)
          }
          needAdmin(me)
          memoClear()
          return json(
            {
              ok: true,
              data: await one(C, 'select p48_sla_set($1,$2,$3::uuid,$4)', [
                String(body.cust_type ?? ''),
                Number(body.days ?? 0),
                me.sub,
                me.profile.full_name,
              ]),
            },
            200,
            h,
          )
        }

        case '/sla-delete':
          needAdmin(me)
          memoClear()
          return json(
            { ok: true, data: await one(C, 'select p48_sla_delete($1)', [String(body.cust_type ?? '')]) },
            200,
            h,
          )

        /* ---- นำเข้า ---- */
        case '/begin':
          return json(
            {
              ok: true,
              /* ผ่าน Number เพราะ bigint จาก Neon มาเป็นข้อความ */
              run: Number(await one<string>(C, 'select p48_begin($1,$2,$3,$4::uuid,$5,$6)', [
                String(body.kind ?? ''),
                String(body.file ?? ''),
                Number(body.fileRows ?? 0),
                me.sub,
                me.profile.full_name,
                me.profile.employee_code,
              ])),
            },
            200,
            h,
          )

        case '/put': {
          const fn = body.kind === 'parcel' ? 'p48_put_parcels' : 'p48_put_products'
          return json(
            {
              ok: true,
              n: Number(await one<string>(C, `select ${fn}($1::bigint,$2::jsonb)`, [
                Number(body.run ?? 0),
                JSON.stringify(body.rows ?? []),
              ])),
            },
            200,
            h,
          )
        }

        case '/end': {
          /* ของเปลี่ยนแล้ว ลบกระดานทิ้ง · ลบหลังจากปิดรอบสำเร็จเท่านั้น
             ถ้าลบก่อน แล้วการปิดรอบล้ม จะกลายเป็นทิ้งของดีไปเปล่า ๆ */
          const data = await one(C, 'select p48_end($1::bigint)', [Number(body.run ?? 0)])
          memoClear()
          return json({ ok: true, data }, 200, h)
        }

        case '/undo': {
          const data = await one(C, 'select p48_undo($1)', [String(body.kind ?? '')])
          memoClear()
          return json({ ok: true, data }, 200, h)
        }

        case '/prune':
          return json(
            { ok: true, deleted: Number(await one<string>(C, 'select p48_sweep($1)', [Number(body.limit ?? 20000)])) },
            200,
            h,
          )

        default:
          return json({ ok: false, error: 'ไม่มีเส้นทางนี้' }, 404, h)
      }
    } catch (e) {
      const msg = (e as Error).message
      /* งานที่ต้องเป็นผู้ดูแลระบบ ตอบ 403 ไม่ใช่ 500 · คนเรียกจะได้รู้ว่าเป็นเรื่องสิทธิ์ */
      const code = msg.includes('เฉพาะผู้ดูแลระบบ') ? 403 : 500
      return json({ ok: false, error: msg }, code, h)
    }
  },
}
