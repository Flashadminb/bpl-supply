/** ผลลัพธ์การบีบอัดรูปในเครื่อง — ไม่มีการอัปโหลดใด ๆ ในไฟล์นี้ */
export interface CompressedImage {
  blob: Blob
  objectUrl: string
  width: number
  height: number
  bytes: number
  type: string
}

const MAX_EDGE = 1024

export interface CompressOptions {
  quality?: number
  /** ข้อความประทับมุมล่างซ้ายของรูป บรรทัดแรกตัวใหญ่สุด */
  stamp?: string[]
}

/**
 * ย่อรูปให้ด้านยาวสุดไม่เกิน 1024px ประทับเวลา แล้วเข้ารหัสเป็น WebP
 * เบราว์เซอร์ไหนไม่รองรับ WebP จะตกไป JPEG ให้อัตโนมัติ
 *
 * ประทับลงบนพิกเซลจริง ลบไม่ได้ แก้ไม่ได้ ไม่ว่าจะถ่ายสดหรือเลือกจากคลังรูป
 */
export async function compressImage(
  file: File | Blob,
  opts: CompressOptions = {},
): Promise<CompressedImage> {
  const quality = opts.quality ?? 0.72
  const bitmap = await loadBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('เบราว์เซอร์นี้วาดรูปลง canvas ไม่ได้')
  ctx.drawImage(bitmap, 0, 0, width, height)
  if ('close' in bitmap) (bitmap as ImageBitmap).close()

  if (opts.stamp && opts.stamp.length > 0) drawStamp(ctx, width, height, opts.stamp)

  let blob = await toBlob(canvas, 'image/webp', quality)
  if (!blob) blob = await toBlob(canvas, 'image/jpeg', quality)
  if (!blob) throw new Error('บีบอัดรูปไม่สำเร็จ')

  return {
    blob,
    objectUrl: URL.createObjectURL(blob),
    width,
    height,
    bytes: blob.size,
    type: blob.type,
  }
}

/**
 * ประทับข้อความมุมล่างซ้าย พื้นดำโปร่ง ตัวอักษรขาว มีเส้นขอบดำ
 * ต้องอ่านออกกลางแดด และอ่านออกทั้งบนพื้นรูปสว่างและมืด
 */
function drawStamp(ctx: CanvasRenderingContext2D, width: number, height: number, lines: string[]): void {
  const base = Math.max(13, Math.round(width * 0.028))
  const pad = Math.round(base * 0.6)
  const gap = Math.round(base * 0.35)
  const font = (size: number, weight = '600') =>
    `${weight} ${size}px "Kanit", "IBM Plex Sans Thai", system-ui, sans-serif`

  const sizes = lines.map((_, i) => (i === 0 ? base : Math.round(base * 0.82)))
  const heights = sizes.map((s) => Math.round(s * 1.25))
  const boxH = heights.reduce((a, b) => a + b, 0) + gap * (lines.length - 1) + pad * 2

  let boxW = 0
  lines.forEach((t, i) => {
    ctx.font = font(sizes[i])
    boxW = Math.max(boxW, ctx.measureText(t).width)
  })
  boxW = Math.min(width, boxW + pad * 2)

  const x = 0
  const y = height - boxH

  ctx.fillStyle = 'rgba(0, 0, 0, 0.58)'
  ctx.fillRect(x, y, boxW, boxH)
  // แถบเหลืองบาง ๆ ให้รู้ว่ามาจากระบบ BPL SUPPLY ไม่ใช่รูปที่ใครก็ตัดต่อมา
  ctx.fillStyle = '#F5B301'
  ctx.fillRect(x, y, Math.round(base * 0.22), boxH)

  ctx.textBaseline = 'top'
  ctx.lineJoin = 'round'
  let cursor = y + pad
  lines.forEach((t, i) => {
    ctx.font = font(sizes[i], i === 0 ? '600' : '500')
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)'
    ctx.lineWidth = Math.max(2, Math.round(sizes[i] * 0.14))
    ctx.strokeText(t, x + pad + Math.round(base * 0.22), cursor)
    ctx.fillStyle = i === 0 ? '#FFFFFF' : '#F3E2AE'
    ctx.fillText(t, x + pad + Math.round(base * 0.22), cursor)
    cursor += heights[i] + gap
  })
}

/** ข้อความประทับมาตรฐาน: วันเวลา + ผู้เบิก + ฮับ */
export function stampLines(who: string, code: string, hub: string, note?: string): string[] {
  const at = new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date())
  return [at, `${who} · ${code} · ${hub}`, note ?? 'BPL SUPPLY'].filter(Boolean)
}

async function loadBitmap(file: File | Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file)
    } catch {
      /* iOS เก่าบางรุ่นล้ม — ตกไปใช้ <img> */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b && b.type === type ? b : null), type, quality))
}

/** คืน object URL ให้เบราว์เซอร์ทันทีที่ไม่ใช้แล้ว — กฎข้อ 7 ใน CLAUDE.md */
export function releaseImage(img: CompressedImage | null | undefined): void {
  if (img?.objectUrl) URL.revokeObjectURL(img.objectUrl)
}

export function prettyBytes(n: number | null | undefined): string {
  if (!n && n !== 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
