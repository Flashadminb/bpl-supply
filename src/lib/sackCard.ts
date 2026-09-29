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

function fieldsOf(row: SackRow, sentBy?: string | null): Field[] {
  const out: Field[] = [
    { label: 'HUB ที่จัดส่ง', value: row.hub_code },
    { label: 'จำนวน', value: `${row.qty.toLocaleString('th-TH')} ${row.unit}`, big: true },
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

/** หัวการ์ด — ป้ายเหลืองซ้าย เลขที่ขวา สูงคงที่ */
const HEADER_H = 168

function drawHeader(ctx: CanvasRenderingContext2D, row: SackRow, badge?: string) {
  ctx.fillStyle = YELLOW
  ctx.fillRect(0, 0, W, 12)

  ctx.font = font(52, '600')
  const hubW = ctx.measureText(row.hub_code).width + 44
  roundRect(ctx, PAD, 40, hubW, 80, 16)
  ctx.fillStyle = YELLOW
  ctx.fill()
  ctx.fillStyle = BLACK
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(row.hub_code, PAD + 22, 40 + 42)

  ctx.textAlign = 'right'
  ctx.font = font(32, '500')
  ctx.fillStyle = YELLOW_SOFT
  ctx.fillText(row.ref_no, W - PAD, 62)
  ctx.font = font(26, '500')
  ctx.fillStyle = GREY
  ctx.fillText(badge ?? 'กระจายกระสอบ', W - PAD, 104)
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

/** ท้ายการ์ด — แถบเหลืองบาง ๆ กับบรรทัดเล็ก */
const FOOTER_H = 74

function drawFooterAt(ctx: CanvasRenderingContext2D, row: SackRow, bottom: number) {
  ctx.fillStyle = YELLOW
  ctx.fillRect(0, bottom - 10, W, 10)
  ctx.font = font(26, '500')
  ctx.fillStyle = '#6B6558'
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fillText('BPL SUPPLY', PAD, bottom - 32)
  ctx.textAlign = 'right'
  ctx.fillText(fmtWhen(row.sent_at ?? row.created_at), W - PAD, bottom - 32)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
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

function newCanvas(h = H): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('เบราว์เซอร์นี้วาดรูปลง canvas ไม่ได้')
  ctx.fillStyle = BLACK
  ctx.fillRect(0, 0, W, h)
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
): Promise<Blob[]> {
  const loaded = await Promise.all(photos.slice(0, MAX_PHOTOS).map((p) => loadImage(p.url)))
  const shown = loaded.filter((x): x is HTMLImageElement => Boolean(x))
  const fields = fieldsOf(row, sentBy)

  if (shown.length === 0) return [await buildTextOnly(row, fields)]
  if (layout === 'grid') return [await buildGrid(row, fields, shown)]

  const out: Blob[] = []
  for (let i = 0; i < shown.length; i++) {
    out.push(await buildSplit(row, fields, shown[i], i, shown.length))
  }
  return out
}

async function buildTextOnly(row: SackRow, fields: Field[]): Promise<Blob> {
  const probe = document.createElement('canvas').getContext('2d')
  if (!probe) throw new Error('เบราว์เซอร์นี้วาดรูปลง canvas ไม่ได้')
  const laid = layoutFields(probe, fields)
  const h = HEADER_H + 40 + laid.height + 40 + FOOTER_H

  const { canvas, ctx } = newCanvas(h)
  drawHeader(ctx, row)
  drawFields(ctx, laid, HEADER_H + 40)
  drawFooterAt(ctx, row, h)
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

async function buildGrid(row: SackRow, fields: Field[], imgs: HTMLImageElement[]): Promise<Blob> {
  const { canvas, ctx } = newCanvas()
  drawHeader(ctx, row)

  // ข้อมูลย่อลงหน่อยเพื่อคืนพื้นที่ให้รูป ซึ่งเป็นของที่คนเปิดมาดูจริง
  const laid = layoutFields(ctx, fields, 0.86)
  drawFields(ctx, laid, HEADER_H + 24, 0.86)

  const top = HEADER_H + 24 + laid.height + 28
  const areaH = H - top - FOOTER_H
  const n = imgs.length
  const gap = 12

  /**
   * หนึ่งคอลัมน์หรือสอง เลือกจากขนาดที่รูปจะได้จริง ไม่ใช่ตั้งไว้ตายตัว
   *
   * สองรูปแนวนอนเรียงลงมาได้กว้างราว 840px ต่อใบ
   * แต่ถ้าวางข้างกันเหลือ 534px ทั้งที่พื้นที่เท่ากัน — ต่างกันเกือบเท่าตัว
   * พอสี่รูปขึ้นไปสลับกัน สองคอลัมน์ถึงจะได้เปรียบ
   *
   * วัดเป็นพื้นที่รวมที่รูปกินจริงหลังย่อให้พอดีกรอบ แล้วเอาแบบที่ได้มากกว่า
   * คิดจากรูปจริงในใบนั้น แนวตั้งแนวนอนปนกันก็ยังเลือกถูก
   */
  const score = (cols: number) => {
    const rows = Math.ceil(n / cols)
    const cw = Math.floor((W - gap * (cols - 1)) / cols)
    const ch = Math.floor((areaH - gap * (rows - 1)) / rows)
    if (cw <= 0 || ch <= 0) return -1
    return imgs.reduce((sum, img) => {
      const k = Math.min(cw / img.width, ch / img.height)
      return sum + k * k * img.width * img.height
    }, 0)
  }
  const cols = n === 1 || score(1) >= score(2) ? 1 : 2
  const rows = Math.ceil(n / cols)
  const cw = Math.floor((W - gap * (cols - 1)) / cols)
  const ch = Math.floor((areaH - gap * (rows - 1)) / rows)

  imgs.forEach((img, i) => {
    const cx = (i % cols) * (cw + gap)
    const cy = top + Math.floor(i / cols) * (ch + gap)
    const box = drawContained(ctx, img, cx, cy, cw, ch)
    if (n > 1) drawTag(ctx, String(i + 1), box.x + 10, box.y + 10, 24)
  })

  drawFooterAt(ctx, row, H)
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
