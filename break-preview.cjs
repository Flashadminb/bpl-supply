/**
 * ดูหน้าตาบัตรเบรคก่อนพิมพ์จริง โดยไม่ต้องล็อกอินเข้าหลังบ้าน
 *
 * ดึง CSS ออกมาจาก BreakCards.tsx ตรง ๆ ไม่ได้ก๊อปมาวาง
 * ถ้าแก้สไตล์ในหน้าจริงแล้วลืมแก้ที่นี่ ภาพตัวอย่างจะหลอกตาทันที
 *
 *   node break-preview.cjs   แล้วเปิด /__brk-card.html บน dev server
 */
const fs = require('fs')
const QRCode = require('qrcode')

const src = fs.readFileSync('src/pages/admin/BreakCards.tsx', 'utf8')
const m = /export function BreakCardStyles\(\)[\s\S]*?<style>\{`([\s\S]*?)`\}<\/style>/.exec(src)
if (!m) {
  console.error('หา BreakCardStyles ใน BreakCards.tsx ไม่เจอ — สไตล์ย้ายที่หรือเปลี่ยนรูปแบบไปแล้ว')
  process.exit(1)
}
// ในไฟล์จริงสีมาจากตัวแปร ${NAVY} กับ ${Y} ซึ่งเป็นค่าคงที่สองตัวบนสุดของไฟล์
const css = m[1].replace(/\$\{NAVY\}/g, '#1B2A4A').replace(/\$\{Y\}/g, '#F5B301')

// ใส่รหัสยาวสุดที่ยอมให้พิมพ์ไว้ด้วย จะได้เห็นว่าทรงบัตรยังอยู่ไหมตอนรหัสยาว
const CODES = ['OUT4-01', 'OUT4-02', 'IN2-01', 'PICK-NIGHT-12']

async function main() {
  const faces = []
  for (const code of CODES) {
    const qr = await QRCode.toDataURL(code, { width: 348, margin: 0, errorCorrectionLevel: 'Q' })
    // ต้องตรงกับ codeSize() ใน BreakCards.tsx
    const fs = code.length <= 8 ? '27px' : code.length <= 11 ? '22px' : code.length <= 15 ? '18px' : '15px'
    faces.push(`
      <div class="brk-card" style="--brk-fs:${fs}">
        <span class="brk-top"></span>
        <span class="brk-hub">21BPL</span>
        <div class="brk-grp">บัตรเบรค</div>
        <div class="brk-mid"><div class="brk-code">${code}</div></div>
        <div class="brk-qr"><img src="${qr}"></div>
        <div class="brk-bot">
          <span class="brk-foot">${code.split('-')[0]} · ใบนี้ไม่ใช่สิทธิ์ · สิทธิ์อยู่ที่ระบบ</span>
        </div>
      </div>`)
  }

  fs.writeFileSync(
    'public/__brk-card.html',
    `<!doctype html><meta charset="utf-8"><title>บัตรเบรค · ตัวอย่างก่อนพิมพ์</title>
<style>
  /* แอปจริงได้ตัวนี้มาจาก Tailwind preflight · ถ้าไม่ใส่ที่นี่
     ขอบกับช่องว่างในจะไปบวกเพิ่มจากความกว้างที่ตั้งไว้ บัตรเลยล้นออกนอกช่อง
     แล้วภาพตัวอย่างจะหลอกว่าบัตรชิดกันทั้งที่ของจริงมีช่องว่าง */
  *{box-sizing:border-box}
  body{margin:0;padding:16px;background:#F2F1ED;font-family:Kanit,system-ui,sans-serif}
  h1{font-size:15px;margin:0 0 4px}
  p{font-size:11.5px;color:#666;margin:0 0 14px;line-height:1.5}
  ${css}
</style>
<h1>บัตรเบรค — ตัวอย่างก่อนพิมพ์</h1>
<p>ขนาดบนจอ 204×325px · ตอนพิมพ์จะเป็น 54×86 มม. เท่าบัตรพนักงาน A4 ได้แผ่นละ 9 ใบ<br>
QR เก็บรหัสบัตรตรง ๆ ลองสแกนดูได้เลย จะได้ข้อความตรงกับที่พิมพ์อยู่บนบัตร</p>
<div class="brk-sheet">${faces.join('')}</div>`,
  )
  console.log('ok: /__brk-card.html')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
