/**
 * อ่านไฟล์ .xlsx ในเครื่อง · ไม่ลงไลบรารีเพิ่ม
 *
 * ทำไมไม่ใช้ของสำเร็จรูป — ตัวที่คนใช้กันหนักราว 400 kB
 * ซึ่งแพงเกินไปสำหรับไฟล์ที่หน้างานต้องโหลดผ่านเน็ตในฮับ
 * และหน้าเดียวในแอพที่ใช้มันคือหน้าอัปไฟล์รถรอลงงาน
 *
 * ไฟล์ xlsx คือ zip ที่ข้างในเป็น XML · สิ่งที่ต้องทำมีแค่สามอย่าง
 * แกะ zip ด้วย DecompressionStream ที่เบราว์เซอร์มีให้อยู่แล้ว
 * หาว่าชีตแรกคือไฟล์ไหน แล้วไล่อ่านเซลล์
 *
 * ไฟล์ของบริษัทเขียนข้อความแบบ inlineStr ทั้งแผ่น และเขียนอักษรไทย-จีน
 * เป็นรหัสตัวเลข (&#3648;) ซึ่งต้องถอดเอง ไม่งั้นได้ชื่อสาขาเป็นตัวเลขยาว ๆ
 * แต่รองรับ sharedStrings กับวันที่แบบเลขซีเรียลไว้ด้วย เผื่อวันหนึ่งบริษัทเปลี่ยนรูปแบบไฟล์
 */

/** ไฟล์ใหญ่กว่านี้ไม่ใช่ไฟล์รายงานรายชั่วโมงแล้ว · กันเครื่องหน้างานค้าง */
const MAX_BYTES = 10 * 1024 * 1024

const td = new TextDecoder('utf-8')

/* ------------------------------------------------------------------ zip */

interface ZipEntry {
  name: string
  method: number
  start: number
  size: number
}

/**
 * ไล่หาสารบัญท้ายไฟล์ zip
 *
 * อ่านจากสารบัญ ไม่ใช่ไล่หัวไฟล์ไปเรื่อย ๆ เพราะหัวไฟล์ของบางตัวสร้าง
 * ไม่ได้ใส่ขนาดไว้ ต้องไปอ่านท้ายก้อนถึงจะรู้ว่าจบตรงไหน
 */
function zipEntries(buf: Uint8Array): ZipEntry[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

  // หาท้ายสารบัญ · ไล่ถอยหลังจากท้ายไฟล์ ไกลสุดเท่าที่คอมเมนต์ท้ายไฟล์จะยาวได้
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('ไฟล์นี้ไม่ใช่ไฟล์ Excel (.xlsx)')

  const count = dv.getUint16(eocd + 10, true)
  let p = dv.getUint32(eocd + 16, true)
  if (p === 0xffffffff) throw new Error('ไฟล์ใหญ่เกินกว่าที่หน้านี้อ่านได้')

  const out: ZipEntry[] = []
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break
    const method = dv.getUint16(p + 10, true)
    const csize = dv.getUint32(p + 20, true)
    const nameLen = dv.getUint16(p + 28, true)
    const extraLen = dv.getUint16(p + 30, true)
    const cmtLen = dv.getUint16(p + 32, true)
    const local = dv.getUint32(p + 42, true)
    const name = td.decode(buf.subarray(p + 46, p + 46 + nameLen))

    // ขนาดของส่วนเสริมในหัวก้อนจริง ต่างจากในสารบัญได้ ต้องอ่านจากหัวก้อนเสมอ
    const lNameLen = dv.getUint16(local + 26, true)
    const lExtraLen = dv.getUint16(local + 28, true)
    const start = local + 30 + lNameLen + lExtraLen

    out.push({ name, method, start, size: csize })
    p += 46 + nameLen + extraLen + cmtLen
  }
  return out
}

async function inflate(buf: Uint8Array, e: ZipEntry): Promise<string> {
  const raw = buf.subarray(e.start, e.start + e.size)
  if (e.method === 0) return td.decode(raw)
  if (e.method !== 8) throw new Error('ไฟล์ Excel นี้บีบอัดด้วยวิธีที่หน้านี้อ่านไม่ได้')

  const DS = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream
  if (!DS) throw new Error('เบราว์เซอร์นี้เก่าเกินไป เปิดด้วย Chrome รุ่นใหม่แล้วลองอีกครั้ง')

  // คัดลอกออกมาเป็นก้อนของตัวเองก่อน · subarray ยังชี้กลับไปที่บัฟเฟอร์ของทั้งไฟล์
  // ซึ่ง TypeScript มองว่าอาจเป็นหน่วยความจำที่แชร์ข้ามเธรด แล้วเอาไปทำ Blob ไม่ได้
  const stream = new Blob([raw.slice()]).stream().pipeThrough(new DS('deflate-raw'))
  return td.decode(new Uint8Array(await new Response(stream).arrayBuffer()))
}

/* ------------------------------------------------------------------ xml */

/**
 * ถอดรหัสตัวอักษรใน XML
 *
 * ไฟล์ของบริษัทเขียนไทยกับจีนเป็นรหัสตัวเลขทั้งหมด
 * ไม่ถอดคือได้ชื่อสาขาออกมาเป็น &#3610;&#3634;&#3591; แล้วไม่มีใครอ่านออก
 */
function dec(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** ตัวอักษรคอลัมน์เป็นเลขลำดับ · A=0 B=1 … AA=26 */
function colOf(ref: string): number {
  const m = /^([A-Z]+)/.exec(ref)
  if (!m) return 0
  let n = 0
  for (const c of m[1]) n = n * 26 + (c.charCodeAt(0) - 64)
  return n - 1
}

function sharedStrings(xml: string | null): string[] {
  if (!xml) return []
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    dec([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')),
  )
}

/**
 * เลขซีเรียลวันที่ของ Excel เป็นข้อความเวลาไทย
 *
 * ไฟล์ปัจจุบันส่งเวลามาเป็นข้อความอยู่แล้ว ตัวนี้จึงยังไม่ได้ถูกใช้
 * แต่ถ้าวันหนึ่งบริษัทเปลี่ยนไปส่งเป็นวันที่จริง แล้วไม่มีตัวแปลงรองรับ
 * ทุกแถวจะกลายเป็น "อ่านเวลาไม่ได้" พร้อมกันทั้งไฟล์โดยไม่มีใครรู้ว่าเพราะอะไร
 *
 * ฐานวันที่คือ 1899-12-30 ตามที่ Excel นับ (รวมบั๊กปี 1900 ที่ไม่เคยแก้)
 */
function serialToText(n: number): string {
  const ms = Math.round((n - 25569) * 86400 * 1000)
  const d = new Date(ms)
  const p = (x: number) => String(x).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
  )
}

function sheetRows(xml: string, ss: string[]): string[][] {
  const out: string[][] = []

  for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = []

    for (const c of r[1].matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const at = c[2] ?? ''
      const body = c[3] ?? ''
      const idx = colOf(c[1])
      let v = ''

      if (/t="s"/.test(at)) {
        const m = /<v>([\s\S]*?)<\/v>/.exec(body)
        v = m ? (ss[Number(m[1])] ?? '') : ''
      } else {
        // inlineStr กับผลลัพธ์ของสูตรที่เป็นข้อความ ทั้งคู่อยู่ใน <t>
        const ts = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
        if (ts.length) {
          v = dec(ts.map((t) => t[1]).join(''))
        } else {
          const m = /<v>([\s\S]*?)<\/v>/.exec(body)
          v = m ? dec(m[1]) : ''
        }
      }

      cells[idx] = v
    }

    out.push([...cells].map((x) => x ?? ''))
  }

  return out
}

/* ---------------------------------------------------------------- public */

export interface XlsxSheet {
  name: string
  rows: string[][]
}

/**
 * อ่านชีตแรกของไฟล์ออกมาเป็นตารางข้อความ
 *
 * หาชีตแรกจาก workbook.xml ไม่ได้เดาว่าเป็น sheet1.xml
 * เพราะลำดับของแผ่นงานกับชื่อไฟล์ข้างในไม่ได้เรียงตรงกันเสมอไป
 * เดาแล้วผิดคือได้ตารางเปล่าโดยไม่มีอะไรฟ้อง
 */
export async function readXlsx(file: File): Promise<XlsxSheet> {
  if (file.size > MAX_BYTES) throw new Error('ไฟล์ใหญ่เกิน 10 MB')

  const buf = new Uint8Array(await file.arrayBuffer())
  const entries = zipEntries(buf)
  const pick = (name: string) => entries.find((e) => e.name === name) ?? null

  const wbEntry = pick('xl/workbook.xml')
  if (!wbEntry) throw new Error('ไฟล์นี้ไม่ใช่ไฟล์ Excel (.xlsx)')

  const wb = await inflate(buf, wbEntry)
  // อ่านแท็กของแผ่นงานแรกทั้งแท็ก แล้วค่อยหยิบทีละค่า
  // เพราะลำดับของ name กับ r:id ในแท็กไม่ได้คงที่ระหว่างโปรแกรมที่สร้างไฟล์
  const tag = /<sheet\s[^>]*>/.exec(wb)?.[0] ?? ''
  const sheetName = dec(/name="([^"]*)"/.exec(tag)?.[1] ?? 'แผ่นงานแรก')
  const rid = /r:id="([^"]*)"/.exec(tag)?.[1] ?? ''
  if (!tag) throw new Error('ไฟล์นี้ไม่มีแผ่นงานข้างใน')

  // แปลงรหัสอ้างอิงเป็นชื่อไฟล์จริงของแผ่นงาน
  const relsEntry = pick('xl/_rels/workbook.xml.rels')
  let target = 'worksheets/sheet1.xml'
  if (relsEntry) {
    const rels = await inflate(buf, relsEntry)
    const re = new RegExp(`Id="${rid}"[^>]*?Target="([^"]*)"`)
    const m = re.exec(rels) ?? new RegExp(`Target="([^"]*)"[^>]*?Id="${rid}"`).exec(rels)
    if (m) target = m[1].replace(/^\/?xl\//, '').replace(/^\//, '')
  }

  const wsEntry = pick('xl/' + target)
  if (!wsEntry) throw new Error('หาแผ่นงานแรกในไฟล์ไม่เจอ')

  const ssEntry = pick('xl/sharedStrings.xml')
  const ss = sharedStrings(ssEntry ? await inflate(buf, ssEntry) : null)
  const rows = sheetRows(await inflate(buf, wsEntry), ss)

  return { name: sheetName, rows }
}

/**
 * ค่าที่อาจเป็นเลขซีเรียลวันที่ เป็นข้อความเวลา
 *
 * ตัวเลขล้วนในช่วงที่สมเหตุสมผล (ปี 2000 ถึง 2100) ถือว่าเป็นวันที่
 * นอกช่วงนั้นคืนค่าเดิมไป เพราะเลขพัสดุ 512 ไม่ใช่วันที่
 */
export function maybeDate(v: string): string {
  const s = v.trim()
  if (!/^\d+(\.\d+)?$/.test(s)) return s
  const n = Number(s)
  if (n < 36526 || n > 73050) return s
  return serialToText(n)
}
