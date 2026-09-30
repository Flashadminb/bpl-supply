/**
 * หน้าตัวอย่างการ์ดกระจายกระสอบ — ไว้ดูหน้าตาก่อนแก้ โดยไม่ต้องล็อกอิน
 *
 *   node sack-preview.cjs        แล้วเปิด /__sack-preview.html บน dev server
 *
 * หน้านี้ import ตัวจริงจาก src/lib/sackCard.ts ผ่าน Vite
 * ไม่ได้ก็อปโค้ดวาดการ์ดมาไว้อีกชุด ตัวอย่างจึงเป็นของจริงเสมอ
 * ไฟล์ที่สร้างอยู่ใน .gitignore แล้ว ไม่ติดขึ้นเว็บจริง
 *
 * รูปตัวอย่างทำเป็นสามสัดส่วน เพราะสัดส่วนรูปคือสิ่งที่ทำให้เลย์เอาต์พัง
 * ไม่ใช่เนื้อในรูป — รูปนอนล้วนกับรูปตั้งล้วนวางไม่เหมือนกันเลย
 */
const fs = require('fs')
const sharp = require('sharp')

const SAMPLES = [
  ['__s1.jpg', 1600, 1200, '#3d5a3a', 'LANDSCAPE 4:3'],
  ['__s2.jpg', 1200, 1600, '#4a3a5a', 'PORTRAIT 3:4'],
  ['__s3.jpg', 1440, 1440, '#5a4a3a', 'SQUARE 1:1'],
]

const svg = (w, h, label) =>
  Buffer.from(
    '<svg width="' + w + '" height="' + h + '">' +
      '<rect x="14" y="14" width="' + (w - 28) + '" height="' + (h - 28) +
      '" fill="none" stroke="#ffffff" stroke-width="6"/>' +
      '<text x="' + w / 2 + '" y="' + h / 2 + '" font-family="sans-serif" font-size="' +
      Math.round(w / 10) + '" fill="#ffffff" text-anchor="middle">' + label + '</text></svg>',
  )

const PAGE = `<!doctype html>
<meta charset="utf-8" />
<title>ตัวอย่างการ์ดกระจายกระสอบ</title>
<style>
  body { margin:0; padding:20px; background:#fff; font-family:Kanit,system-ui,sans-serif; }
  .wrap { display:flex; gap:18px; align-items:flex-start; flex-wrap:wrap; }
  .cap { font-size:13px; font-weight:700; margin:0 0 6px; }
  img.card { width:372px; display:block; box-shadow:0 2px 10px #0003; }
  #err { color:#a00; font-size:13px; white-space:pre-wrap; }
</style>
<div class="wrap" id="wrap"></div>
<p id="err"></p>
<script type="module">
  import { buildSackCards } from '/src/lib/sackCard.ts'

  const row = {
    id: 'x', ref_no: 'SH-260930-009', hub_code: '21BPL',
    qty: 1000, unit: 'ชิ้น', branch: 'ตัวอย่าง', note: 'เทส',
    status: 'direct', relay_via: null,
    created_at: '2026-09-30T03:12:00Z', sent_at: '2026-09-30T03:12:00Z', updated_at: null,
    created_by_name: 'ธนวัฒน์ พุฒฤทธิ์', sent_by_name: 'ธนวัฒน์ พุฒฤทธิ์', updated_by_name: null,
    photos: [], photo_count: 0,
  }

  // สาขาชื่อยาวกับหมายเหตุยาวเกิดขึ้นจริง และเป็นตัวที่ทำให้คอลัมน์แคบ ๆ พัง
  const longRow = {
    ...row, ref_no: 'SH-260930-014',
    branch: 'บางพลี-กิ่งแก้ว สาขาย่อย 3',
    note: 'ฝากรถหกล้อรอบบ่าย ให้โทรก่อนถึง 15 นาที',
    qty: 12500, status: 'relay', relay_via: '21BKK',
  }

  const shot = async (u) => ({ url: URL.createObjectURL(await (await fetch(u)).blob()) })

  try {
    const land = await shot('/__s1.jpg')
    const port = await shot('/__s2.jpg')
    const sq = await shot('/__s3.jpg')

    const cases = [
      ['ไม่มีรูป', row, []],
      ['1 รูป แนวนอน', row, [land]],
      ['2 รูป นอน+ตั้ง', row, [land, port]],
      ['3 รูป', row, [land, port, sq]],
      ['ข้อมูลยาว 2 รูป', longRow, [port, land]],
    ]

    for (const [cap, r, ph] of cases) {
      const col = document.createElement('div')
      col.className = 'col'
      const p = document.createElement('p')
      p.className = 'cap'
      p.textContent = cap
      col.appendChild(p)
      for (const b of await buildSackCards(r, ph, r.sent_by_name)) {
        const img = document.createElement('img')
        img.className = 'card'
        img.src = URL.createObjectURL(b)
        img.dataset.kb = Math.round(b.size / 1024)
        col.appendChild(img)
      }
      wrap.appendChild(col)
    }
    window.__done = true
  } catch (e) {
    document.getElementById('err').textContent = e.stack || String(e)
    window.__done = 'error'
  }
</script>
`

async function main() {
  for (const [name, w, h, bg, label] of SAMPLES) {
    await sharp({ create: { width: w, height: h, channels: 3, background: bg } })
      .composite([{ input: svg(w, h, label), top: 0, left: 0 }])
      .jpeg({ quality: 85 })
      .toFile('public/' + name)
  }
  fs.writeFileSync('public/__sack-preview.html', PAGE)
  console.log('เปิด /__sack-preview.html บน dev server ได้เลย')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
