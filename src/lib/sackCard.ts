import type { SackRow } from './types'

/**
 * ผลลัพธ์ที่หน้างานต้องเอาไปส่งต่อในแชท — สองแบบ
 *
 *   ① ข้อความล้วน   ก็อปแปะได้ทุกที่ ไม่กินเน็ต อ่านออกแม้แชทบีบรูปจนเบลอ
 *   ② รูปการ์ด      มีทั้งข้อความและรูปหลักฐานอยู่ในนั้น
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
    `${qtyLabel(row)} : ${qtyOf(row).toLocaleString('th-TH')} ${row.unit}`,
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
const WHITE = '#FFFFFF'
const GREY = '#918D84'

/**
 * ขนาดการ์ดคงที่เท่าจอมือถือเสมอ ไม่ว่าจะมีกี่รูป
 *
 * ของเดิมการ์ดยาวขึ้นตามจำนวนรูป หกใบได้ภาพสูงเกือบหกพันพิกเซล
 * เปิดในแชทแล้วเห็นเป็นแถบผอม ๆ ต้องเลื่อนทีละช่วงถึงจะดูได้
 * 9:16 คือสัดส่วนที่มือถือเปิดแล้วเต็มจอพอดี ไม่ต้องเลื่อนไม่ต้องซูม
 */
const W = 1080
const H = 1920
const PAD = 56
const MAX_PHOTOS = 6

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
 * รูปแบบการ์ด
 *
 * split  รูปละใบ — ทุกใบได้พื้นที่เท่ากันและใหญ่เท่ากัน
 * grid   ใบเดียว — รูปทั้งหมดแบ่งช่องกันอยู่ในการ์ดเดียว
 */
export type SackCardLayout = 'split' | 'grid'

/**
 * รูปหลายใบในคอลัมน์เดียว แบ่งที่กันยังไง
 *
 * proportional  ช่องของใครของมันตามสัดส่วนรูปนั้น ทุกใบได้ใหญ่ที่สุดเท่าที่ได้
 * equal         ช่องเท่ากันทุกใบ วางรูปไว้กลางช่อง ไม่ครอบขอบ
 * equalCrop     ช่องเท่ากันและครอบขอบให้เต็มช่อง ทุกใบจึงดูเท่ากันเป๊ะ
 *
 * ถ้ารูปทุกใบถ่ายจากมือถือเครื่องเดิมโดยถือแนวเดียวกัน ซึ่งเป็นเรื่องปกติ
 * ทั้งสามแบบให้รูปขนาดเท่ากันหมด ต่างกันแค่ระยะห่างระหว่างรูป
 * ความต่างจะโผล่ก็ต่อเมื่อมีทั้งรูปตั้งและรูปนอนปนกันในใบเดียว
 */
export type SackPhotoFit = 'proportional' | 'equal' | 'equalCrop'

/* ------------------------------------------------------ ชิ้นส่วนที่ใช้ร่วมกัน */

/** ข้อมูลหนึ่งช่อง — ป้ายเล็กอยู่บน ค่าตัวใหญ่อยู่ล่าง */
interface Field {
  label: string
  value: string
  /** ช่องสำคัญ ตัวใหญ่สีเหลือง */
  big?: boolean
  /** กินเต็มแถว ใช้กับค่าที่ยาว เช่นชื่อสาขา */
  wide?: boolean
}

/**
 * จำนวนที่ขึ้นในใบคือจำนวนที่ส่งไปจริง ไม่ใช่จำนวนที่สาขาขอมา
 *
 * เจ้าของระบบขอไว้ชัดว่าห้ามขึ้นเป็น "ขอ 500 ส่ง 200" ในใบ
 * ใบนี้ไปอยู่ในแชทกลุ่มที่มีสาขาปลายทางอยู่ด้วย
 * ตัวเลขที่ขอแล้วไม่ได้ของทำให้ต้องไปนั่งอธิบายกันในกลุ่ม
 * ส่วนต่างไปโผล่ในหน้าประวัติฝั่งเว็บแทน ซึ่งมีแต่คนในเห็น
 */
const qtyOf = (row: SackRow) => row.qty_out ?? row.qty
const qtyLabel = (row: SackRow) => (row.status === 'pending' ? 'จำนวน' : 'จำนวนที่ส่ง')

function fieldsOf(row: SackRow, sentBy?: string | null): Field[] {
  const out: Field[] = [
    { label: 'HUB ที่จัดส่ง', value: row.hub_code },
    { label: qtyLabel(row), value: `${qtyOf(row).toLocaleString('th-TH')} ${row.unit}`, big: true },
    { label: 'สาขาที่ขอ', value: row.branch, big: true, wide: true },
    { label: 'สถานะการส่ง', value: sackStatusLabel(row), big: true, wide: true },
  ]
  if (row.note) out.push({ label: 'หมายเหตุ', value: row.note, wide: true })
  if (row.status !== 'pending') {
    out.push({ label: 'ผู้ส่ง', value: sentBy ?? row.sent_by_name ?? '—' })
    out.push({ label: 'เวลา', value: `${fmtWhen(row.sent_at)} น.` })
  }
  return out
}

/**
 * หัวการ์ด — ป้ายเหลืองซ้าย ชื่องานขวา สูงคงที่
 *
 * เลขที่ลงไปอยู่ท้ายการ์ดแล้ว คนหน้างานไม่ได้ใช้ ใช้ตอนแอดมินตามเรื่องย้อนหลัง
 * ที่หัวการ์ดมีแต่ของที่ต้องเห็นทันทีตอนเลื่อนผ่านในแชท
 */
const HEADER_H = 148

function drawHeader(ctx: CanvasRenderingContext2D, row: SackRow, badge?: string, w = W) {
  ctx.fillStyle = YELLOW
  ctx.fillRect(0, 0, w, 12)

  ctx.font = font(52, '600')
  const hubW = ctx.measureText(row.hub_code).width + 44
  roundRect(ctx, PAD, 38, hubW, 80, 16)
  ctx.fillStyle = YELLOW
  ctx.fill()
  ctx.fillStyle = BLACK
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(row.hub_code, PAD + 22, 38 + 42)

  ctx.textAlign = 'right'
  ctx.font = font(30, '500')
  ctx.fillStyle = YELLOW_SOFT
  ctx.fillText(badge ?? 'กระจายกระสอบ', w - PAD, 38 + 42)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
}

/**
 * บล็อกข้อมูล — สองช่องต่อแถว ป้ายเล็กบน ค่าใหญ่ล่าง
 *
 * ของเดิมเป็นตารางป้ายซ้ายค่าขวา ซึ่งกินความสูงต่อบรรทัดเยอะ
 * และเสียความกว้างครึ่งหนึ่งไปกับป้ายที่อ่านครั้งเดียวก็จำได้แล้ว
 * เรียงแบบนี้ได้ความสูงคืนมาเกือบครึ่ง ซึ่งยกให้รูปทั้งหมด
 */
interface Cell {
  f: Field
  x: number
  w: number
}

function layoutFields(
  ctx: CanvasRenderingContext2D,
  fields: Field[],
  scale = 1,
): { rows: Cell[][]; height: number } {
  const colW = Math.floor((W - PAD * 2 - 24) / 2)
  const rows: Cell[][] = []
  let cur: Cell[] = []
  for (const f of fields) {
    if (f.wide) {
      if (cur.length) {
        rows.push(cur)
        cur = []
      }
      rows.push([{ f, x: PAD, w: W - PAD * 2 }])
      continue
    }
    cur.push({ f, x: PAD + cur.length * (colW + 24), w: colW })
    if (cur.length === 2) {
      rows.push(cur)
      cur = []
    }
  }
  if (cur.length) rows.push(cur)

  const rowH = Math.round((36 + 52) * scale)
  const gap = Math.round(18 * scale)
  const lineH = Math.round(52 * scale)
  // ค่ายาว ๆ อาจต้องขึ้นบรรทัดสอง เผื่อความสูงไว้ให้ถูกตั้งแต่ตอนวัด
  let height = 0
  for (const r of rows) {
    let extra = 0
    for (const c of r) {
      ctx.font = font(Math.round((c.f.big ? 46 : 38) * scale), c.f.big ? '600' : '500')
      extra = Math.max(extra, (wrap(ctx, c.f.value, c.w).length - 1) * lineH)
    }
    height += rowH + extra + gap
  }
  return { rows, height: Math.max(0, height - gap) }
}

function drawFields(
  ctx: CanvasRenderingContext2D,
  laid: { rows: Cell[][]; height: number },
  top: number,
  scale = 1,
) {
  let y = top
  const rowH = Math.round((36 + 52) * scale)
  const gap = Math.round(18 * scale)
  const lineH = Math.round(52 * scale)
  for (const r of laid.rows) {
    let extra = 0
    for (const c of r) {
      ctx.font = font(Math.round(28 * scale), '500')
      ctx.fillStyle = GREY
      ctx.textBaseline = 'top'
      ctx.textAlign = 'left'
      ctx.fillText(c.f.label, c.x, y)

      ctx.font = font(Math.round((c.f.big ? 46 : 38) * scale), c.f.big ? '600' : '500')
      ctx.fillStyle = c.f.big ? YELLOW : WHITE
      const lines = wrap(ctx, c.f.value, c.w)
      lines.forEach((line, k) => {
        ctx.fillText(line, c.x, y + Math.round(36 * scale) + k * lineH)
      })
      extra = Math.max(extra, (lines.length - 1) * lineH)
    }
    y += rowH + extra + gap
  }
}

/**
 * ข้อมูลเรียงลงมาคอลัมน์เดียว — ใช้กับการ์ดที่ยกฝั่งขวาให้รูปไปหมดแล้ว
 *
 * ของเดิมเป็นสองช่องต่อแถวเต็มความกว้างการ์ด ซึ่งกินฝั่งขวาไปด้วย
 * พอรูปมาอยู่ขวา ข้อมูลจึงต้องมุดมาอยู่คอลัมน์เดียวทางซ้าย
 * แคบลงแปลว่าค่ายาว ๆ ขึ้นบรรทัดสองบ่อยขึ้น ต้องวัดความสูงจริงทุกช่อง
 */
interface StackItem {
  f: Field
  lines: string[]
}

const stackMetrics = (big: boolean, scale: number) => ({
  label: Math.round(26 * scale),
  value: Math.round((big ? 46 : 36) * scale),
  lineH: Math.round((big ? 54 : 44) * scale),
  labelH: Math.round(34 * scale),
  gap: Math.round(22 * scale),
})

function layoutStack(
  ctx: CanvasRenderingContext2D,
  fields: Field[],
  w: number,
  scale = 1,
): { items: StackItem[]; height: number } {
  const items: StackItem[] = []
  let height = 0
  for (const f of fields) {
    const m = stackMetrics(Boolean(f.big), scale)
    ctx.font = font(m.value, f.big ? '600' : '500')
    const lines = wrap(ctx, f.value, w)
    items.push({ f, lines })
    height += m.labelH + lines.length * m.lineH + m.gap
  }
  const tailGap = items.length ? stackMetrics(false, scale).gap : 0
  return { items, height: Math.max(0, height - tailGap) }
}

function drawStack(
  ctx: CanvasRenderingContext2D,
  laid: { items: StackItem[] },
  x: number,
  top: number,
  scale = 1,
) {
  let y = top
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  for (const it of laid.items) {
    const m = stackMetrics(Boolean(it.f.big), scale)
    ctx.font = font(m.label, '500')
    ctx.fillStyle = GREY
    ctx.fillText(it.f.label, x, y)

    ctx.font = font(m.value, it.f.big ? '600' : '500')
    ctx.fillStyle = it.f.big ? YELLOW : WHITE
    it.lines.forEach((line, k) => ctx.fillText(line, x, y + m.labelH + k * m.lineH))

    y += m.labelH + it.lines.length * m.lineH + m.gap
  }
}

/**
 * ท้ายการ์ด — แถบเหลืองบาง ๆ กับบรรทัดเล็ก
 *
 * เลขที่มาอยู่ตรงนี้ ไม่ได้อยู่หัวการ์ดเหมือนเดิม
 * หน้างานดูแค่จำนวนกับสาขา ส่วนเลขที่ใช้ตอนแอดมินตามเรื่องย้อนหลัง
 * เอาไว้ล่างสุดตัวเล็กจึงพอ และคืนที่หัวการ์ดให้ของที่ต้องเห็นก่อน
 */
const FOOTER_H = 82

function drawFooterAt(ctx: CanvasRenderingContext2D, row: SackRow, bottom: number, w = W) {
  ctx.fillStyle = YELLOW
  ctx.fillRect(0, bottom - 10, w, 10)
  ctx.font = font(25, '500')
  ctx.fillStyle = '#6B6558'
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fillText(`BPL SUPPLY · ${row.ref_no}`, PAD, bottom - 34)
  ctx.textAlign = 'right'
  ctx.fillText(fmtWhen(row.sent_at ?? row.created_at), w - PAD, bottom - 34)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
}

/**
 * วาดรูปให้เต็มกรอบโดยยอมครอบขอบทิ้ง
 *
 * ใช้เฉพาะตอนที่ต้องการให้ทุกรูปดูเท่ากันเป๊ะ
 * ซึ่งทำไม่ได้เลยถ้าไม่ครอบ เพราะรูปตั้งกับรูปนอนสัดส่วนไม่เท่ากันอยู่แล้ว
 */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } {
  const scale = Math.max(w / img.width, h / img.height)
  const sw = w / scale
  const sh = h / scale
  const sx = (img.width - sw) / 2
  const sy = (img.height - sh) / 2
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
  return { x, y, w, h }
}

/** วาดรูปให้พอดีกรอบโดยไม่ครอบขอบทิ้ง แล้วคืนกรอบจริงที่รูปกิน */
function drawContained(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } {
  const scale = Math.min(w / img.width, h / img.height)
  const dw = Math.round(img.width * scale)
  const dh = Math.round(img.height * scale)
  const dx = Math.round(x + (w - dw) / 2)
  const dy = Math.round(y + (h - dh) / 2)
  ctx.drawImage(img, dx, dy, dw, dh)
  return { x: dx, y: dy, w: dw, h: dh }
}

function drawTag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size = 26) {
  ctx.font = font(size, '600')
  const w = ctx.measureText(text).width + size
  const h = Math.round(size * 1.55)
  ctx.fillStyle = YELLOW
  roundRect(ctx, x, y, w, h, 9)
  ctx.fill()
  ctx.fillStyle = BLACK
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(text, x + size / 2, y + h / 2)
  ctx.textBaseline = 'top'
}

function newCanvas(h = H, w = W): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('เบราว์เซอร์นี้วาดรูปลง canvas ไม่ได้')
  ctx.fillStyle = BLACK
  ctx.fillRect(0, 0, w, h)
  ctx.textBaseline = 'top'
  return { canvas, ctx }
}

async function toBlob(canvas: HTMLCanvasElement, hasPhoto: boolean): Promise<Blob> {
  // มีรูปถ่ายอยู่ในนั้นให้ออกเป็น JPEG
  //
  // PNG เก็บรูปถ่ายแบบไม่สูญเสีย ซึ่งได้ไฟล์หลายเมกะไบต์โดยตาคนดูไม่ออกว่าต่าง
  // การ์ดนี้ต้องวิ่งผ่านแชทในมือถือที่เน็ตฮับไม่นิ่ง ขนาดไฟล์คือเรื่องจริง
  // ใบที่ไม่มีรูปยังเป็น PNG เพราะเป็นตัวอักษรล้วน ซึ่ง PNG คมกว่าและเล็กกว่า
  const type = hasPhoto ? 'image/jpeg' : 'image/png'
  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob(res, type, hasPhoto ? 0.92 : undefined),
  )
  if (!blob) throw new Error('สร้างรูปการ์ดไม่สำเร็จ')
  return blob
}

/* ------------------------------------------------------------ ตัวสร้างการ์ด */

/**
 * สร้างการ์ด — ขนาด 1080×1920 ทุกใบ ไม่ว่ารูปจะกี่ใบ
 *
 * grid   (ตั้งต้น) ได้การ์ดใบเดียว รูปแบ่งช่องกันในพื้นที่ที่เหลือ
 *        ครบในใบเดียว ซึ่งเป็นสิ่งที่คนรับปลายทางอยากได้
 *        งานจริงส่วนมากมีสองรูป ซึ่งวางเรียงลงมาแล้วยังอ่านป้ายออกสบาย
 * split  ได้การ์ดเท่าจำนวนรูป รูปละใบ ทุกใบใหญ่เท่ากัน
 *        เผื่อวันที่ต้องแนบรูปเยอะแล้วช่องในใบเดียวเล็กเกินจะอ่าน
 *
 * ไม่มีรูปเลยได้ใบเดียวทั้งสองแบบ และไม่ยืดเต็มจอ เพราะกล่องข้อความ
 * ลอยกลางจอดำ ๆ ดูเหมือนรูปหายไปมากกว่าดูเหมือนการ์ดที่ยังไม่มีรูป
 *
 * รูปต้องเป็น blob/object URL ในเครื่อง ไม่ใช่ลิงก์ข้ามโดเมน
 * ไม่งั้น canvas จะถูกมาร์กว่าเปื้อนแล้ว toBlob จะโยน SecurityError
 */
export async function buildSackCards(
  row: SackRow,
  photos: SackCardPhoto[],
  sentBy?: string | null,
  layout: SackCardLayout = 'grid',
  fit: SackPhotoFit = 'equal',
): Promise<Blob[]> {
  const loaded = await Promise.all(photos.slice(0, MAX_PHOTOS).map((p) => loadImage(p.url)))
  const shown = loaded.filter((x): x is HTMLImageElement => Boolean(x))
  const fields = fieldsOf(row, sentBy)

  if (shown.length === 0) return [await buildTextOnly(row, fields)]
  if (layout === 'grid') return [await buildGrid(row, fields, shown, fit)]

  const out: Blob[] = []
  for (let i = 0; i < shown.length; i++) {
    out.push(await buildSplit(row, fields, shown[i], i, shown.length))
  }
  return out
}

/** คอลัมน์ข้อมูลฝั่งซ้าย ที่เหลือเป็นของรูปทั้งหมด */
const INFO_W = 330
const GUTTER = 28

async function buildTextOnly(row: SackRow, fields: Field[]): Promise<Blob> {
  const probe = document.createElement('canvas').getContext('2d')
  if (!probe) throw new Error('เบราว์เซอร์นี้วาดรูปลง canvas ไม่ได้')

  // ไม่มีรูปก็ไม่ต้องหวงที่ให้รูป คอลัมน์กว้างได้ ค่ายาว ๆ จะได้ไม่ตกบรรทัด
  //
  // และย่อความกว้างการ์ดลงตามคอลัมน์ด้วย
  // คงไว้ 1080 เท่าใบที่มีรูป จะเหลือพื้นดำเปล่าฝั่งขวาเกือบครึ่งใบ
  // ซึ่งดูเหมือนรูปโหลดไม่ขึ้น มากกว่าดูเหมือนใบที่ตั้งใจไม่มีรูป
  const colW = 640
  const cardW = colW + PAD * 2
  const laid = layoutStack(probe, fields, colW)
  const h = HEADER_H + 36 + laid.height + 44 + FOOTER_H

  const { canvas, ctx } = newCanvas(h, cardW)
  drawHeader(ctx, row, undefined, cardW)
  drawStack(ctx, laid, PAD, HEADER_H + 36)
  drawFooterAt(ctx, row, h, cardW)
  return toBlob(canvas, false)
}

async function buildSplit(
  row: SackRow,
  fields: Field[],
  img: HTMLImageElement,
  index: number,
  total: number,
): Promise<Blob> {
  const { canvas, ctx } = newCanvas()
  drawHeader(ctx, row, total > 1 ? `กระจายกระสอบ · รูปที่ ${index + 1} จาก ${total}` : undefined)

  const base = layoutFields(ctx, fields)
  // เว้นหายใจรอบบล็อกข้อมูลไว้ก่อน ที่เหลือเป็นของรูปทั้งหมด
  const infoMin = base.height + 72
  const avail = H - HEADER_H - FOOTER_H - infoMin
  const ratio = img.width > 0 ? img.height / img.width : 0.75
  const photoH = Math.min(avail, Math.round(W * ratio))
  const infoH = H - HEADER_H - FOOTER_H - photoH

  /**
   * รูปแนวนอนกินความสูงไม่หมด เพราะการ์ดสูง 16 ส่วนแต่รูปกว้าง 4 สูง 3
   * ส่วนที่เหลือจะกลายเป็นแถบดำเปล่า ๆ คั่นกลางถ้าปล่อยไว้
   *
   * เอามาขยายตัวหนังสือแทน ได้สองอย่างในทีเดียว
   * การ์ดดูเต็มไม่โหว่ และตัวเลขอ่านง่ายขึ้นตอนเปิดในมือถือ
   * มีเพดานไว้ เพราะใหญ่เกินไปจะกลายเป็นป้ายโฆษณาแทนที่จะเป็นเอกสาร
   */
  let scale = Math.min(1.34, Math.max(1, (infoH - 72) / Math.max(base.height, 1)))
  let laid = layoutFields(ctx, fields, scale)
  while (laid.height > infoH - 40 && scale > 1) {
    scale = Math.max(1, scale - 0.04)
    laid = layoutFields(ctx, fields, scale)
  }

  drawFields(ctx, laid, HEADER_H + Math.round((infoH - laid.height) / 2), scale)

  const top = HEADER_H + infoH
  drawContained(ctx, img, 0, top, W, photoH)
  if (total > 1) drawTag(ctx, `${index + 1}/${total}`, 24, top + 20, 30)

  drawFooterAt(ctx, row, H)
  return toBlob(canvas, true)
}

/**
 * ข้อมูลซ้าย รูปขวา
 *
 * ของเดิมข้อมูลกินเต็มความกว้างด้านบน แล้วรูปได้แถบล่างที่เหลือ
 * ซึ่งแปลว่ารูปสูงได้ไม่เกินราวครึ่งการ์ด ทั้งที่รูปคือของที่คนเปิดมาดู
 * ยกฝั่งขวาทั้งแถบให้รูปแทน รูปจึงสูงได้เกือบเต็มการ์ด
 *
 * ส่วนสูงของแต่ละรูปแบ่งตามสัดส่วนจริงของรูปนั้น ไม่ได้หารเท่า ๆ กัน
 * หารเท่ากันแล้วรูปแนวนอนจะเหลือขอบดำบนล่างเป็นแถบใหญ่
 * ขณะที่รูปแนวตั้งในช่องเดียวกันกลับถูกบีบจนเล็กทั้งที่มีที่ว่างอยู่ข้าง ๆ
 */
async function buildGrid(
  row: SackRow,
  fields: Field[],
  imgs: HTMLImageElement[],
  fit: SackPhotoFit,
): Promise<Blob> {
  const probe = document.createElement('canvas').getContext('2d')
  if (!probe) throw new Error('เบราว์เซอร์นี้วาดรูปลง canvas ไม่ได้')

  const laid = layoutStack(probe, fields, INFO_W)
  const top = HEADER_H + 30
  const px = PAD + INFO_W + GUTTER
  const pw = W - px - PAD
  const gap = 14
  const n = imgs.length

  /** ความสูงที่รูปนี้อยากได้ ถ้าได้กว้างเต็มคอลัมน์ */
  const natural = imgs.map((im) => (im.width > 0 ? (pw * im.height) / im.width : pw * 0.75))

  /**
   * เพดานความสูง — การ์ดยาวกว่าจอมือถือแล้วต้องเลื่อนดู ซึ่งเสียจุดประสงค์
   * ปกติไม่ถึงเพดาน รูปนอนสองใบจบที่ราวพันสองร้อย
   */
  const roomMax = H - top - 28 - FOOTER_H - gap * (n - 1)
  const even = roomMax / n
  const tallest = Math.max(...natural)
  const shortest = Math.min(...natural)

  let slots: number[]
  if (fit === 'proportional') {
    const wanted = natural.reduce((a, b) => a + b, 0)
    const k = wanted > 0 ? Math.min(1, roomMax / wanted) : 1
    slots = natural.map((v) => v * k)
  } else if (fit === 'equalCrop') {
    slots = imgs.map(() => Math.min(even, tallest))
  } else {
    /**
     * ช่องเท่ากันทุกใบ และสูงเท่ารูปที่เตี้ยที่สุดต้องการ ไม่ใช่สูงที่สุด
     *
     * เอาตัวสูงสุดเป็นเกณฑ์แล้วรูปนอนจะลอยอยู่กลางช่องสูง ๆ
     * ช่องเท่ากันก็จริง แต่รูปข้างในสูงไม่เท่ากัน ตาก็ยังเห็นว่าไม่เท่า
     * แถมการ์ดถูกดันยาวออกไปด้วยแถบดำที่ไม่มีอะไรอยู่
     *
     * เอาตัวเตี้ยสุดเป็นเกณฑ์แล้วทุกใบสูงเท่ากันจริง และไม่มีแถบดำบนล่างเลย
     * แลกกับรูปตั้งที่เล็กลง ซึ่งเกิดเฉพาะตอนมีรูปตั้งปนรูปนอนในใบเดียว
     */
    slots = imgs.map(() => Math.min(even, shortest))
  }

  /**
   * ความสูงการ์ดเดินตามเนื้อหา ไม่ได้ตรึงไว้ที่ 1920
   *
   * ตรึงไว้แล้วรูปนอนสองใบจบที่ราวพันสองร้อย เหลือพื้นดำอีกเจ็ดร้อย
   * ซึ่งเปิดในแชทแล้วเห็นเป็นช่องว่างใหญ่ ๆ ใต้ของที่ต้องดู
   *
   * รูปเริ่มที่ระดับเดียวกับบรรทัดแรกของข้อมูล ไม่ได้จัดกลางคอลัมน์
   * สองฝั่งจึงเริ่มเสมอกัน และการ์ดจบตรงที่ฝั่งที่ยาวกว่าจบ
   */
  const stackH = Math.round(slots.reduce((a, b) => a + b, 0) + gap * (n - 1))
  const contentH = Math.max(laid.height, stackH)
  const cardH = Math.min(H, top + contentH + 28 + FOOTER_H)

  const { canvas, ctx } = newCanvas(cardH)
  drawHeader(ctx, row)
  drawStack(ctx, laid, PAD, top)

  let y = top
  imgs.forEach((img, i) => {
    const slotH = Math.round(slots[i])
    const draw = fit === 'equalCrop' ? drawCover : drawContained
    const box = draw(ctx, img, px, y, pw, slotH)
    if (n > 1) drawTag(ctx, String(i + 1), box.x + 10, box.y + 10, 24)
    y += slotH + gap
  })

  drawFooterAt(ctx, row, cardH)
  return toBlob(canvas, true)
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
export function sackCardFilename(row: SackRow, mime = 'image/png', index?: number): string {
  const ext = mime === 'image/jpeg' ? 'jpg' : 'png'
  const safe = row.branch.replace(/[\\/:*?"<>|\s]+/g, '_')
  const n = index === undefined ? '' : `-${index + 1}`
  return `${row.ref_no}-${safe}${n}.${ext}`
}
