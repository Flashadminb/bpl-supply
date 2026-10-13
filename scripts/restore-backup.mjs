#!/usr/bin/env node
/**
 * กู้คืนฐานข้อมูลจากสำเนาที่โหลดมาจาก Google Drive
 *
 * ─────────────────────────────────────────────────────────────────
 * ทำไมต้องเขียนไว้ตั้งแต่วันที่ยังไม่มีอะไรพัง
 *
 * สำรองที่ไม่เคยกู้ ไม่นับว่าเป็นสำรอง
 * ของที่พังจริงในวันเกิดเหตุส่วนใหญ่คือขั้นตอนกู้ ไม่ใช่ขั้นตอนสำรอง
 * และวันนั้นคือวันที่ไม่มีใครมีสมาธิพอจะมานั่งเขียนสคริปต์
 * ─────────────────────────────────────────────────────────────────
 *
 * วิธีใช้
 *
 *   ดูว่าในสำเนามีอะไรบ้าง ไม่เขียนอะไรลงฐานข้อมูล
 *     node scripts/restore-backup.mjs ./2026-10-19 --dry-run
 *
 *   กู้คืนทั้งหมด
 *     node scripts/restore-backup.mjs ./2026-10-19
 *
 *   กู้คืนเฉพาะบางตาราง
 *     node scripts/restore-backup.mjs ./2026-10-19 --only profiles,items
 *
 * ต้องมีใน .env หรือใน environment
 *   VITE_SUPABASE_URL          ที่อยู่โปรเจกต์
 *   SUPABASE_SERVICE_ROLE_KEY  กุญแจฝั่งเซิร์ฟเวอร์ · ไม่ใช่กุญแจที่อยู่ในหน้าเว็บ
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { join, resolve } from 'node:path'

/* ------------------------------------------------------------- ตั้งค่า */

function loadEnv() {
  const out = { ...process.env }
  const f = resolve(process.cwd(), '.env')
  if (existsSync(f)) {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
      /* ตัดช่องว่างกับอัญประกาศออก · ค่าที่ติดอักขระท้ายบรรทัดมาเคยทำให้
         ไล่หาสาเหตุกันอยู่ครึ่งวันมาแล้ว เพราะกุญแจถูกทุกตัวแต่ปลายทางบอกว่าผิด */
      if (m && !out[m[1]]) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  }
  return out
}

const env = loadEnv()
const URL_BASE = (env.VITE_SUPABASE_URL ?? env.SUPABASE_URL ?? '').replace(/\/$/, '')
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SB_SECRET_KEY ?? ''

/* ------------------------------------------------------------- อ่านสำเนา */

const args = process.argv.slice(2)
const dir = args.find((a) => !a.startsWith('--'))
const dryRun = args.includes('--dry-run')
const onlyArg = args.find((a) => a.startsWith('--only'))
const only = onlyArg ? new Set(onlyArg.split('=')[1]?.split(',') ?? []) : null

if (!dir) {
  console.error('ต้องบอกโฟลเดอร์ของสำเนาด้วย · เช่น node scripts/restore-backup.mjs ./2026-10-19')
  process.exit(1)
}

const root = resolve(dir)
const allDir = existsSync(join(root, 'ทั้งหมด')) ? join(root, 'ทั้งหมด') : root
if (!existsSync(allDir)) {
  console.error(`ไม่เจอโฟลเดอร์ ${allDir}`)
  process.exit(1)
}

const files = readdirSync(allDir).filter((f) => f.endsWith('.json.gz') || f.endsWith('.json'))
if (!files.length) {
  console.error('ในโฟลเดอร์นี้ไม่มีไฟล์สำเนาเลย')
  process.exit(1)
}

/** อ่านไฟล์เดียวออกมาเป็นแถว · รองรับทั้งแบบบีบและไม่บีบ */
function readRows(name) {
  const p = join(allDir, name)
  const raw = name.endsWith('.gz') ? gunzipSync(readFileSync(p)).toString('utf8') : readFileSync(p, 'utf8')
  const rows = JSON.parse(raw)
  if (!Array.isArray(rows)) throw new Error('รูปแบบไฟล์ไม่ใช่รายการแถว')
  return rows
}

const tables = files
  .map((f) => ({ file: f, name: f.replace(/\.json(\.gz)?$/, '') }))
  .filter((t) => !only || only.has(t.name))

console.log(`เจอสำเนา ${tables.length} ตาราง ที่ ${allDir}`)

if (existsSync(join(root, '_สรุป.json'))) {
  const s = JSON.parse(readFileSync(join(root, '_สรุป.json'), 'utf8'))
  console.log(`สำเนานี้ทำเมื่อ ${s['เมื่อ']} · ${s['แถวรวม']} แถว · ${s['ขนาดบีบแล้ว']}`)
  if (s['ล้มเหลว']?.length) console.log(`  มีตารางที่สำรองไม่สำเร็จ: ${s['ล้มเหลว'].join(', ')}`)
}

if (dryRun) {
  for (const t of tables) {
    let n = 0
    try {
      n = readRows(t.file).length
    } catch (e) {
      console.log(`  ${t.name.padEnd(28)} อ่านไม่ได้ · ${e.message}`)
      continue
    }
    console.log(`  ${t.name.padEnd(28)} ${String(n).padStart(8)} แถว`)
  }
  console.log('\nนี่เป็นการดูเฉย ๆ ไม่ได้เขียนอะไรลงฐานข้อมูล')
  process.exit(0)
}

if (!URL_BASE || !SERVICE) {
  console.error('ยังไม่ได้ตั้ง VITE_SUPABASE_URL หรือ SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

/* ------------------------------------------------------------- เขียนกลับ */

const headers = {
  apikey: SERVICE,
  Authorization: `Bearer ${SERVICE}`,
  'Content-Type': 'application/json',
  Prefer: 'resolution=merge-duplicates,return=minimal',
}

async function push(name, rows) {
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const res = await fetch(`${URL_BASE}/rest/v1/${name}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(rows.slice(i, i + CHUNK)),
    })
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`)
  }
}

/**
 * วนหลายรอบจนกว่าจะไม่มีอะไรคืบหน้า
 *
 * ตารางผูกกันด้วย foreign key · ใส่ลูกก่อนแม่คือโดนปฏิเสธ
 * แทนที่จะมานั่งไล่ลำดับเองซึ่งต้องกลับมาแก้ทุกครั้งที่มีตารางใหม่
 * ก็ลองใส่ทั้งหมด เก็บตัวที่ล้มไว้ แล้ววนใหม่
 * รอบหน้าแม่ของมันจะเข้าไปแล้ว ลูกจึงเข้าได้
 * หยุดเมื่อรอบหนึ่งไม่มีตารางไหนสำเร็จเพิ่มเลย ซึ่งแปลว่าที่เหลือพังด้วยเหตุอื่น
 */
let pending = tables.slice()
let round = 0
const done = []
const failed = []

while (pending.length) {
  round++
  const stuck = []
  let progressed = 0

  for (const t of pending) {
    let rows
    try {
      rows = readRows(t.file)
    } catch (e) {
      failed.push(`${t.name} · อ่านไฟล์ไม่ได้ · ${e.message}`)
      continue
    }
    if (!rows.length) {
      done.push(`${t.name} (ว่าง)`)
      progressed++
      continue
    }
    try {
      await push(t.name, rows)
      done.push(`${t.name} ${rows.length} แถว`)
      progressed++
      process.stdout.write(`  รอบ ${round} · ${t.name} ${rows.length} แถว\n`)
    } catch (e) {
      stuck.push({ ...t, why: e.message })
    }
  }

  if (!progressed) {
    for (const t of stuck) failed.push(`${t.name} · ${t.why}`)
    break
  }
  pending = stuck
}

console.log(`\nสำเร็จ ${done.length} ตาราง · ใช้ไป ${round} รอบ`)
if (failed.length) {
  console.log(`\nไม่สำเร็จ ${failed.length} ตาราง`)
  for (const f of failed) console.log(`  ${f}`)
  console.log('\nส่วนใหญ่เกิดจากตารางแม่ไม่มีอยู่ หรือโครงตารางเปลี่ยนไปจากวันที่สำรอง')
  console.log('ให้รัน migration ให้ครบก่อนแล้วลองใหม่')
  process.exit(1)
}
console.log('กู้คืนครบทุกตาราง')
