import type { SackRow } from './types'

/**
 * ผลลัพธ์ที่หน้างานต้องเอาไปส่งต่อในแชท — สองแบบ
 *
 *   ① ข้อความล้วน   ก็อปแปะได้ทุกที่ ไม่กินเน็ต อ่านออกแม้แชทบีบรูปจนเบลอ
 *   ② รูปการ์ด      ใบเดียวจบ มีทั้งข้อความและรูปหลักฐานอยู่ในนั้น
 *
 * ทำไมต้องมีสองแบบ
 *   ส่วนกลางบางคนอ่านจากข้อความแล้วก็อปตัวเลขไปลงตาราง
 *   บางกลุ่มต้องการรูปเดียวจบเพราะแชทกลุ่มเลื่อนเร็ว ข้อความยาวจะหาย
 *   ให้เลือกได้ทั้งคู่ ดีกว่าบังคับให้ใช้แบบที่ไม่ถนัด
 */

const BANGKOK = 'Asia/Bangkok'

function fmtWhen(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: BANGKOK,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export function sackStatusLabel(row: Pick<SackRow, 'status' | 'relay_via'>): string {
  if (row.status === 'direct') return 'ส่งตรง'
  if (row.status === 'relay') return `ฝากส่ง · ผ่าน ${row.relay_via ?? '—'}`
  return 'รอส่ง'
}

/**
 * ฟอร์มข้อความ
 *
 * จัดคอลัมน์ด้วยช่องว่างธรรมดา ไม่ใช่ตาราง markdown หรือ tab
 * เพราะปลายทางคือแชทในมือถือ ซึ่งไม่ได้ใช้ฟอนต์ความกว้างเท่ากัน
 * ป้ายกำกับตามด้วย : แล้วค่อยเว้นวรรค อ่านง่ายในทุกฟอนต์
 */
export function sackFormText(row: SackRow, sentBy?: string | null): string {
  const lines = [
    `${row.hub_code} · กระจายกระสอบ`,
    `เลขที่ : ${row.ref_no}`,
    '',
    `HUB ที่จัดส่ง : ${row.hub_code}`,
    `จำนวน : ${row.qty.toLocaleString('th-TH')} ${row.unit}`,
    `สาขาที่ขอ : ${row.branch}`,
    `สถานะการส่ง : ${sackStatusLabel(row)}`,
  ]
  if (row.note) lines.push(`หมายเหตุ : ${row.note}`)
  if (row.status !== 'pending') {
    lines.push(`ผู้ส่ง : ${sentBy ?? row.sent_by_name ?? '—'}`)
    lines.push(`เวลา : ${fmtWhen(row.sent_at)} น.`)
    if (row.photo_count > 0) lines.push(`รูปหลักฐาน : ${row.photo_count} ใบ`)
  }
  return lines.join('\n')
}

/* ------------------------------------------------------------- รูปการ์ด */

const YELLOW = '#F5B301'
const YELLOW_SOFT = '#F3E2AE'
const BLACK = '#141210'
const BLACK_2 = '#1F1C18'
const WHITE = '#FFFFFF'

const W = 1080
const PAD = 56

const font = (size: number, weight = '500') =>
  `${weight} ${size}px "Kanit", "IBM Plex Sans Thai", system-ui, sans-serif`

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** ตัดข้อความให้พอดีความกว้าง คืนเป็นหลายบรรทัด */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/)
  const out: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width <= maxW || !line) {
      line = next
    } else {
      out.push(line)
      line = word
    }
  }
  // ภาษาไทยไม่มีช่องว่างระหว่างคำ คำเดียวยาวเกินกรอบจึงเกิดได้จริง
  // ตัดทีละตัวอักษรเป็นทางสำรอง ดีกว่าปล่อยให้ล้นออกนอกการ์ด
  const fixed: string[] = []
  for (const l of [...out, line]) {
    if (!l) continue
    if (ctx.measureText(l).width <= maxW) {
      fixed.push(l)
      continue
    }
    let cur = ''
    for (const ch of l) {
      if (ctx.measureText(cur + ch).width > maxW && cur) {
        fixed.push(cur)
        cur = ch
      } else {
        cur += ch
      }
    }
    if (cur) fixed.push(cur)
  }
  return fixed
}

export interface SackCardPhoto {
  /** object URL หรือ data URL ที่วาดลง canvas ได้โดยไม่ทำให้ canvas เปื้อน */
  url: string
}

/**
 * วาดการ์ด แล้วคืนเป็นไฟล์ PNG
 *
 * ธีมเหลือง-ดำตามที่เจ้าของระบบกำหนด หัวซ้ายเป็นรหัสฮับเสมอ
 * ความสูงคิดจากเนื้อหาจริง ไม่ได้ตั้งตายตัว รายการที่ไม่มีรูปจะได้การ์ดสั้น
 *
 * รูปต้องเป็น blob/object URL ในเครื่อง ไม่ใช่ลิงก์ข้ามโดเมน
 * ไม่งั้น canvas จะถูกมาร์กว่าเปื้อนแล้ว toBlob จะโยน SecurityError
 */
export async function buildSackCard(
  row: SackRow,
  photos: SackCardPhoto[],
  sentBy?: string | null,
): Promise<Blob> {
  // หน้างานแนบได้ถึงหกใบ การ์ดจึงต้องโชว์ได้ครบหกใบ
  // ถ้าตัดที่สี่ ใบที่เหลือจะหายไปเงียบ ๆ ทั้งที่ตัวเลขข้างบนบอกว่ามีหกใบ
  const imgs = await Promise.all(photos.slice(0, 6).map((p) => loadImage(p.url)))
  const shown = imgs.filter((x): x is HTMLImageElement => Boolean(x))

  const measure = document.createElement('canvas').getContext('2d')
  if (!measure) throw new Error('เบราว์เซอร์นี้วาดรูปลง canvas ไม่ได้')

  const innerW = W - PAD * 2
  const rows: { label: string; value: string; big?: boolean }[] = [
    { label: 'HUB ที่จัดส่ง', value: row.hub_code },
    { label: 'จำนวน', value: `${row.qty.toLocaleString('th-TH')} ${row.unit}`, big: true },
    { label: 'สาขาที่ขอ', value: row.branch, big: true },
    { label: 'สถานะการส่ง', value: sackStatusLabel(row), big: true },
  ]
  if (row.note) rows.push({ label: 'หมายเหตุ', value: row.note })
  if (row.status !== 'pending') {
    rows.push({ label: 'ผู้ส่ง', value: sentBy ?? row.sent_by_name ?? '—' })
    rows.push({ label: 'เวลา', value: `${fmtWhen(row.sent_at)} น.` })
  }

  // วัดความสูงของแต่ละแถวก่อน แล้วค่อยรู้ว่าการ์ดต้องสูงเท่าไหร่
  const labelW = 250
  const valueW = innerW - labelW - 24
  const rowLines = rows.map((r) => {
    measure.font = font(r.big ? 40 : 34)
    return wrap(measure, r.value, valueW)
  })
  const rowHeights = rowLines.map((ls, i) => Math.max(64, ls.length * (rows[i].big ? 54 : 46) + 20))

  const headerH = 200
  const bodyH = rowHeights.reduce((a, b) => a + b, 0) + 40
  const frames = layoutPhotos(shown.length, innerW)
  const gridH = frames.length === 0 ? 0 : Math.max(...frames.map((f) => f.y + f.h))
  const photosH = frames.length === 0 ? 0 : 74 + gridH
  const footerH = 96
  const H = headerH + bodyH + photosH + footerH

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('เบราว์เซอร์นี้วาดรูปลง canvas ไม่ได้')

  ctx.fillStyle = BLACK
  ctx.fillRect(0, 0, W, H)

  /* --- หัวการ์ด: ป้ายเหลือง 21BPL มุมซ้าย เลขที่อยู่ขวา --- */
  ctx.fillStyle = YELLOW
  ctx.fillRect(0, 0, W, 14)

  ctx.font = font(52, '600')
  const hubW = ctx.measureText(row.hub_code).width + 44
  roundRect(ctx, PAD, 52, hubW, 82, 16)
  ctx.fillStyle = YELLOW
  ctx.fill()
  ctx.fillStyle = BLACK
  ctx.textBaseline = 'middle'
  ctx.fillText(row.hub_code, PAD + 22, 52 + 43)

  ctx.textAlign = 'right'
  ctx.font = font(30, '500')
  ctx.fillStyle = YELLOW_SOFT
  ctx.fillText(row.ref_no, W - PAD, 76)
  ctx.font = font(26, '500')
  ctx.fillStyle = '#A8A091'
  ctx.fillText('กระจายกระสอบ', W - PAD, 116)
  ctx.textAlign = 'left'

  /* --- ตารางข้อมูล --- */
  let y = headerH
  rows.forEach((r, i) => {
    const h = rowHeights[i]
    if (i % 2 === 0) {
      ctx.fillStyle = BLACK_2
      roundRect(ctx, PAD - 16, y - 8, innerW + 32, h - 4, 12)
      ctx.fill()
    }
    ctx.font = font(30, '500')
    ctx.fillStyle = '#918D84'
    ctx.textBaseline = 'top'
    ctx.fillText(r.label, PAD, y + 14)

    ctx.font = font(r.big ? 40 : 34, r.big ? '600' : '500')
    ctx.fillStyle = r.big ? YELLOW : WHITE
    rowLines[i].forEach((line, k) => {
      ctx.fillText(line, PAD + labelW, y + 10 + k * (r.big ? 54 : 46))
    })
    y += h
  })

  /* --- รูปหลักฐาน --- */
  if (shown.length > 0) {
    y += 40
    ctx.font = font(28, '500')
    ctx.fillStyle = '#918D84'
    ctx.fillText(`รูปหลักฐาน ${row.photo_count || shown.length} ใบ`, PAD, y)
    y += 46

    shown.forEach((img, i) => {
      const f = frames[i]
      const x = PAD + f.x
      const yy = y + f.y
      ctx.save()
      roundRect(ctx, x, yy, f.w, f.h, 14)
      ctx.clip()
      // ครอบให้เต็มกรอบโดยไม่บิดสัดส่วน — รูปกระสอบถ่ายมาหลายอัตราส่วน
      const scale = Math.max(f.w / img.width, f.h / img.height)
      const dw = img.width * scale
      const dh = img.height * scale
      ctx.drawImage(img, x + (f.w - dw) / 2, yy + (f.h - dh) / 2, dw, dh)
      ctx.restore()
      ctx.strokeStyle = 'rgba(245, 179, 1, 0.35)'
      ctx.lineWidth = 2
      roundRect(ctx, x, yy, f.w, f.h, 14)
      ctx.stroke()
    })
    y += gridH
  }

  /* --- ท้ายการ์ด --- */
  ctx.fillStyle = YELLOW
  ctx.fillRect(0, H - 10, W, 10)
  ctx.font = font(26, '500')
  ctx.fillStyle = '#6B6558'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('BPL SUPPLY', PAD, H - 40)
  ctx.textAlign = 'right'
  ctx.fillText(fmtWhen(row.sent_at ?? row.created_at), W - PAD, H - 40)

  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
  if (!blob) throw new Error('สร้างรูปการ์ดไม่สำเร็จ')
  return blob
}

/**
 * ตำแหน่งกรอบรูปทั้งกอง คิดครั้งเดียวแล้วใช้ทั้งตอนวัดความสูงและตอนวาด
 *
 * เรียงสองคอลัมน์ ยกเว้นใบสุดท้ายของจำนวนคี่ที่กินเต็มความกว้าง
 * ถ้าปล่อยให้เป็นครึ่งเดียว การ์ดจะเหลือช่องว่างข้างขวา ซึ่งดูเหมือนรูปหายไปหนึ่งใบ
 */
function layoutPhotos(n: number, width: number): { x: number; y: number; w: number; h: number }[] {
  if (n <= 0) return []
  const gap = 16
  const half = Math.floor((width - gap) / 2)
  const out: { x: number; y: number; w: number; h: number }[] = []
  let y = 0
  let i = 0
  while (i < n) {
    const alone = n - i === 1
    const w = alone ? width : half
    const h = Math.round(w * (alone ? 0.56 : 0.75))
    if (alone) {
      out.push({ x: 0, y, w, h })
      i += 1
    } else {
      out.push({ x: 0, y, w, h })
      out.push({ x: half + gap, y, w, h })
      i += 2
    }
    y += h + gap
  }
  return out
}

/** โหลดรูปหนึ่งใบ — ใบไหนพังก็ข้าม ไม่ให้การ์ดทั้งใบล้มเพราะรูปเดียว */
function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/**
 * ชื่อไฟล์ของการ์ด — ขึ้นต้นด้วยเลขที่เสมอ
 * คนดาวน์โหลดหลายใบติดกันจะได้เรียงตามลำดับในโฟลเดอร์เอง
 */
export function sackCardFilename(row: SackRow): string {
  return `${row.ref_no}-${row.branch.replace(/[\\/:*?"<>|\s]+/g, '_')}.png`
}
