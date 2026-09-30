/**
 * ทำโลโก้ให้พื้นหลังใส
 *
 * ที่ตัดมาจากบัตรมีพื้นเทาอ่อนติดมาด้วย วางบนการ์ดแล้วเห็นเป็นกล่องเทาทึบ
 * mix-blend-mode ช่วยบนจอได้บ้าง แต่ตอนพิมพ์ไม่ช่วย และพื้นการ์ดก็ไม่ได้ขาวสนิท
 *
 * คีย์สีพื้นออกตรง ๆ ดีกว่า — อ่านสีมุมซ้ายบนเป็นสีพื้น แล้วลบพิกเซลที่ใกล้เคียง
 * ไล่ระดับความโปร่งตามระยะห่างจากสีพื้น ขอบตัวอักษรจึงไม่หยักเป็นฟันเลื่อย
 */
const sharp = require('sharp')
const path = require('path')

const SRC =
  'C:/Users/Flash/AppData/Local/Temp/claude/C--Users-Flash-Desktop-Best---------------------/607683b5-890b-45a9-a9d2-3e7bfcb164f0/scratchpad/oscards/1.png'
const OUT = 'public/os-logo.png'

const NEAR = 26 // ใกล้สีพื้นขนาดนี้ = ใส
const FAR = 64 // ห่างเกินนี้ = ทึบเต็ม

async function main() {
  const crop = await sharp(SRC)
    .extract({ left: 20, top: 50, width: 112, height: 54 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const { data, info } = crop
  const px = info.width * info.height
  const bg = [data[0], data[1], data[2]]

  let cleared = 0
  for (let i = 0; i < px; i++) {
    const o = i * 4
    const d = Math.max(
      Math.abs(data[o] - bg[0]),
      Math.abs(data[o + 1] - bg[1]),
      Math.abs(data[o + 2] - bg[2]),
    )
    if (d <= NEAR) {
      data[o + 3] = 0
      cleared++
    } else if (d < FAR) {
      data[o + 3] = Math.round(((d - NEAR) / (FAR - NEAR)) * 255)
    }
  }

  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toFile(OUT)

  console.log(
    'สีพื้นที่อ่านได้ rgb(' + bg.join(',') + ') · ทำใสไป ' +
      Math.round((cleared / px) * 100) + '% ของพื้นที่ →', OUT,
  )
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
