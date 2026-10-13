// =====================================================================
// backup-db — สำรองฐานข้อมูลทั้งก้อนขึ้น Google Drive
//
// ─────────────────────────────────────────────────────────────────
// มีไว้ทำไม
//
// Supabase แผนฟรีไม่มีการสำรองอัตโนมัติ · รูปหลักฐานอยู่บนไดรฟ์แล้ว
// แต่ตัวฐานข้อมูลไม่เคยถูกคัดลอกไปไหนเลยสักครั้งตั้งแต่วันแรก
// รายชื่อพนักงาน สต็อก ทะเบียนทรัพย์สิน บัตรเบรค โซนสาขา อยู่ที่เดียวในโลก
//
// ไฟล์นี้ถ่ายสำเนาทั้งตู้ไปไว้อีกตึกทุกคืนวันอาทิตย์
// ─────────────────────────────────────────────────────────────────
//
// หน้าตาที่ได้บนไดรฟ์
//
//   BPL SUPPLY สำรองฐานข้อมูล/
//      2026-10-19/
//         _สรุป.json          ← กี่ตาราง กี่แถว ใช้เวลาเท่าไหร่
//         ของสำคัญ/            ← เปิดอ่านได้ด้วยตาเปล่า ไม่ต้องมีเครื่องมือ
//            profiles.json
//            items.json
//            ...
//         ทั้งหมด/             ← บีบไว้ ไว้กู้คืนจริง
//            profiles.json.gz
//            ... ครบทุกตาราง
//
// แยกสองชั้นเพราะคนละหน้าที่ · ของสำคัญคือของที่หายแล้วเจ็บที่สุดแต่ตัวเล็กมาก
// ต้องเปิดดูได้ทันทีแม้ในวันที่ไม่มีใครช่วยและไม่มีเครื่องมืออะไรเลย
// ส่วนทั้งหมดบีบไว้เพื่อให้กู้คืนได้ครบทุกแถวโดยไม่กินที่
//
// ไฟล์นี้เขียนให้จบในตัวเอง ก๊อปวางใน Supabase Dashboard ได้ตรง ๆ
//
// secrets ที่ต้องมี (มีอยู่แล้วทั้งหมดจาก upload-evidence):
//   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET,
//   GOOGLE_OAUTH_REFRESH_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// =====================================================================

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
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

/** เก็บสำเนาย้อนหลังกี่รอบ · แปดสัปดาห์คือสองเดือน ซึ่งนานพอให้รู้ตัวว่าของหาย */
const KEEP = 8

/**
 * ตารางที่ได้สำเนาแบบอ่านด้วยตาเปล่าเพิ่มอีกชุด
 *
 * เกณฑ์คือ ถ้าหายแล้วระบบสร้างใหม่เองไม่ได้ และต้องมีคนนั่งพิมพ์กลับเข้าไป
 * ของพวกนี้ตัวเล็กมากแต่แพงที่สุด · ส่วนประวัติธุรกรรมไม่อยู่ในนี้
 * เพราะมันใหญ่ และมีสำเนาอยู่ในชีตอยู่แล้ว
 */
const PRECIOUS = new Set([
  'profiles',
  'departments',
  'sub_depts',
  'positions',
  'hubs',
  'items',
  'categories',
  'assets',
  'asset_types',
  'asset_user_grants',
  'break_groups',
  'break_group_users',
  'break_reasons',
  'break_suppliers',
  'truck_branches',
  'hub_out_zones',
  'app_settings',
  'audience_groups',
  'work_links',
  'work_link_depts',
  'work_link_roles',
  'work_link_users',
])

/* ----------------------------------------------------------- Google */

let tokenCache: { token: string; expires: number } | null = null

async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expires > Date.now() + 60_000) return tokenCache.token

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
    throw new Error(`ขอสิทธิ์จาก Google ไม่สำเร็จ: ${data.error_description ?? data.error ?? res.status}`)
  }
  tokenCache = { token: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 }
  return tokenCache.token
}

async function createFolder(token: string, name: string, parent?: string): Promise<string> {
  const res = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parent ? { parents: [parent] } : {}),
    }),
  })
  const data = (await res.json()) as { id?: string; error?: { message?: string } }
  if (!res.ok || !data.id) throw new Error(`สร้างโฟลเดอร์ไม่สำเร็จ: ${data.error?.message ?? res.status}`)
  return data.id
}

async function folderOk(token: string, id: string): Promise<boolean> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${id}?fields=id,trashed,mimeType`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) return false
  const f = (await res.json()) as { trashed?: boolean; mimeType?: string }
  return !f.trashed && f.mimeType === 'application/vnd.google-apps.folder'
}

/**
 * อัปไฟล์เดียวเข้าโฟลเดอร์
 *
 * ต้องเป็น multipart/related ไม่ใช่ multipart/form-data
 * ถ้าใช้ FormData เบราว์เซอร์จะตั้ง Content-Type เป็น form-data ให้เอง
 * แล้ว Google อ่านส่วน metadata ไม่ออก ไฟล์จะไปกองที่ชั้นนอกของไดรฟ์แทน
 * บทเรียนเดียวกับที่เคยเจอใน upload-evidence
 */
async function uploadFile(
  token: string,
  parent: string,
  name: string,
  bytes: Uint8Array,
  mime: string,
): Promise<void> {
  const boundary = `bpl${crypto.randomUUID().replace(/-/g, '')}`
  const head =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify({ name, parents: [parent] })}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mime}\r\n\r\n`
  const tail = `\r\n--${boundary}--\r\n`

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: new Blob([head, bytes, tail]),
    },
  )
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`อัป ${name} ไม่สำเร็จ: ${res.status} ${t.slice(0, 160)}`)
  }
}

/* -------------------------------------------------------- Supabase */

function svcHeaders(): Record<string, string> {
  const svc = envOrThrow('SUPABASE_SERVICE_ROLE_KEY')
  return { apikey: svc, Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json' }
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${envOrThrow('SUPABASE_URL')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: svcHeaders(),
    body: JSON.stringify(args),
  })
  if (!res.ok) throw new Error(`เรียก ${name} ไม่สำเร็จ: ${res.status} ${(await res.text()).slice(0, 160)}`)
  return (await res.json()) as T
}

async function setting(key: string, value?: string): Promise<string | null> {
  const base = envOrThrow('SUPABASE_URL')
  if (value === undefined) {
    const res = await fetch(
      `${base}/rest/v1/private_settings?key=eq.${encodeURIComponent(key)}&select=value`,
      { headers: svcHeaders() },
    )
    if (!res.ok) return null
    const rows = (await res.json()) as { value: string }[]
    return rows[0]?.value ?? null
  }
  await fetch(`${base}/rest/v1/private_settings?on_conflict=key`, {
    method: 'POST',
    headers: { ...svcHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key, value }),
  }).catch(() => undefined)
  return value
}

/* ------------------------------------------------------------ ย่อไฟล์ */

const enc = new TextEncoder()

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([enc.encode(text)]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/* ------------------------------------------------------------- งานหลัก */

/** อ่านตารางหนึ่งออกมาเป็นข้อความ JSON · ทีละหน้าเพื่อไม่ให้หน่วยความจำบาน */
async function dumpTable(name: string): Promise<{ text: string; rows: number }> {
  const PAGE = 2000
  const parts: string[] = []
  let rows = 0
  for (let offset = 0; ; offset += PAGE) {
    const chunk = await rpc<unknown[]>('backup_table', {
      p_name: name,
      p_offset: offset,
      p_limit: PAGE,
    })
    if (!chunk.length) break
    for (const r of chunk) parts.push(JSON.stringify(r))
    rows += chunk.length
    if (chunk.length < PAGE) break
  }
  return { text: `[${parts.join(',\n')}]`, rows }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  /* ด่านเดียว · กุญแจที่เก็บไว้ในฐานข้อมูล ไม่ใช่สิ่งที่เดาได้
     เส้นทางนี้อ่านได้ทุกตารางโดยไม่ติด RLS จึงไม่เปิดให้ผู้ใช้ทั่วไปเรียกเลย
     แม้แต่เจ้าของระบบก็ต้องมีกุญแจ ไม่ใช่แค่ล็อกอินอยู่ */
  const given = req.headers.get('x-cron-key') ?? ''
  const want = await setting('backup_cron_secret')
  if (!want || given !== want) return json({ error: 'ไม่มีสิทธิ์เรียกงานนี้' }, 401)

  const t0 = Date.now()
  try {
    const token = await getAccessToken()

    /* โฟลเดอร์หลัก · จำรหัสไว้ในฐานข้อมูล สร้างใหม่ให้เองถ้าถูกลบ
       สิทธิ์ที่ขอจาก Google เป็นแบบ drive.file คือแตะได้เฉพาะไฟล์ที่แอปสร้างเอง
       โฟลเดอร์ที่คนไปสร้างเองในเว็บ Drive แอปจะมองไม่เห็น */
    let root = await setting('gdrive_folder_backup')
    if (!root || !(await folderOk(token, root))) {
      root = await createFolder(token, 'BPL SUPPLY สำรองฐานข้อมูล')
      await setting('gdrive_folder_backup', root)
    }

    const stamp = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
    const dated = await createFolder(token, stamp, root)
    const allDir = await createFolder(token, 'ทั้งหมด', dated)
    const keyDir = await createFolder(token, 'ของสำคัญ', dated)

    const tables = await rpc<{ name: string; est_rows: number }[]>('backup_tables', {})

    const report: Record<string, number> = {}
    let bytes = 0
    const failed: string[] = []

    for (const t of tables) {
      try {
        const { text, rows } = await dumpTable(t.name)
        report[t.name] = rows

        const gz = await gzip(text)
        bytes += gz.length
        await uploadFile(token, allDir, `${t.name}.json.gz`, gz, 'application/gzip')

        if (PRECIOUS.has(t.name)) {
          await uploadFile(token, keyDir, `${t.name}.json`, enc.encode(text), 'application/json')
        }
      } catch (e) {
        /* ตารางเดียวล้มต้องไม่ทำให้ทั้งรอบล้ม · ของที่เหลืออีกแปดสิบกว่าตารางมีค่ากว่า
           แต่ต้องบันทึกไว้ในสรุป ไม่งั้นจะกลายเป็นสำรองที่ขาดโดยไม่มีใครรู้ */
        failed.push(`${t.name}: ${(e as Error).message}`)
      }
    }

    const summary = {
      เมื่อ: new Date(Date.now() + 7 * 3600_000).toISOString().replace('T', ' ').slice(0, 19),
      ตารางทั้งหมด: tables.length,
      สำเร็จ: Object.keys(report).length,
      ล้มเหลว: failed,
      แถวรวม: Object.values(report).reduce((a, b) => a + b, 0),
      ขนาดบีบแล้ว: `${(bytes / 1024 / 1024).toFixed(2)} MB`,
      ใช้เวลา: `${Math.round((Date.now() - t0) / 1000)} วินาที`,
      แต่ละตาราง: report,
      วิธีกู้คืน: 'node scripts/restore-backup.mjs <โฟลเดอร์ที่โหลดมา>',
    }
    await uploadFile(
      token,
      dated,
      '_สรุป.json',
      enc.encode(JSON.stringify(summary, null, 2)),
      'application/json',
    )

    /* ลบรอบเก่าที่เกินกำหนด · ชื่อโฟลเดอร์เป็น ปี-เดือน-วัน จึงเรียงตามชื่อได้ตรง ๆ
       ทำหลังอัปเสร็จเสมอ · ถ้าลบก่อนแล้วรอบนี้ล้ม จะเหลือสำรองน้อยลงโดยไม่ได้อะไรเพิ่ม */
    const list = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        `'${root}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      )}&fields=files(id,name)&pageSize=100`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const old = ((await list.json()) as { files?: { id: string; name: string }[] }).files ?? []
    const removable = old
      .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.name))
      .sort((a, b) => b.name.localeCompare(a.name))
      .slice(KEEP)
    for (const f of removable) {
      await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined)
    }

    return json({ ok: true, folder: stamp, ลบรอบเก่า: removable.length, ...summary })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message, ใช้เวลา: Math.round((Date.now() - t0) / 1000) }, 500)
  }
})
