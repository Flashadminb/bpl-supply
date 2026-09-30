/**
 * หน้าตัวอย่างบัตรแบบไฟล์เดียว ไว้ดูหน้าตาโดยไม่ต้องล็อกอิน
 *
 * ดึง CSS ออกมาจาก OsCards.tsx ตรง ๆ ไม่ได้ก็อปมาวางไว้อีกชุด
 * ถ้าก็อปไว้ วันหนึ่งมันจะเพี้ยนจากของจริงแล้วเราจะนั่งดูบัตรที่ไม่มีอยู่จริง
 */
const fs = require('fs')
const QRCode = require('qrcode')

const src = fs.readFileSync('src/pages/admin/OsCards.tsx', 'utf8')

// --print = เอากฎของหน้าพิมพ์มาแสดงบนจอเลย จะได้ตรวจหน้าพิมพ์โดยไม่ต้องสั่งพิมพ์จริง
// ดูได้ทุกอย่างยกเว้นเรื่องสีพื้น ซึ่งต้องเปิดหน้าตัวอย่างก่อนพิมพ์ในเบราว์เซอร์ดูเอง
const asPrint = process.argv.includes('--print')

const css = src
  .slice(src.indexOf('<style>{`') + 9, src.indexOf('`}</style>'))
  .replace(/@media print/g, asPrint ? '@media all' : '@media print')
  .replace(/\$\{Y\}/g, '#FFED00')
  .replace(/\$\{NAVY\}/g, '#16304C')

const PEOPLE = [
  { tag: 'PW', name: 'Zaw Mg San', id: '4821930', model: 'REDMI NOTE 13', imei: '869726074524281' },
  { tag: 'AK', name: 'AUNG KO LIN', id: '5890039', model: 'SAMSUNG GALAXY A15', imei: '352233119375526' },
  { tag: 'SCG', name: 'สมชาย ประเสริฐวงศ์ไพบูลย์', id: '751810', model: 'OPPO RENO 11F 5G', imei: '860765075146156' },
  { tag: 'PW', name: 'Htet', id: null, model: null, imei: null },
]

async function main() {
  const cards = []
  for (const p of PEOPLE) {
    const qr = await QRCode.toDataURL('os_' + (p.id ?? 'x') + '_demo_token_abcdef', {
      width: 104, margin: 0, errorCorrectionLevel: 'M',
    })
    const nameSize = p.name.length > 22 ? 12 : p.name.length > 16 ? 14 : 17
    cards.push(`
<div class="os-card">
  <div class="os-top"><span class="os-navy"></span><span class="os-ystripe"></span></div>
  <span class="os-wedge"></span>
  <img class="os-logo" src="/os-logo.png" alt="Flash Express">
  <div class="os-inner">
    <span class="os-tag">${p.tag}</span>
    <span class="os-face"><span class="os-facetxt">รูป</span></span>
    <div class="os-mid">
      <span class="os-name" style="font-size:${nameSize}px">${p.name}</span>
      <span class="os-id">ID: ${p.id ?? '—'}</span>
      <span class="os-model">${p.model ?? '—'}</span>
      <span class="os-imeiL">IMEI</span>
      <span class="os-imeiV">${p.imei ?? '—'}</span>
    </div>
    <span class="os-qr"><img src="${qr}" alt=""></span>
  </div>
  <div class="os-bot"><span class="os-navy2"></span><span class="os-ytri2"></span></div>
  <span class="os-hub"><b>21BPL_BHUB-บางพลี</b><span>Hub Standardization</span></span>
</div>`)
  }

  // สองอันนี้ในแอปจริงเป็นสไตล์ inline ใน Face กับ QrImg ต้องตรงกับที่นั่นเป๊ะ
  const extra = `
    body { margin:0; padding:16px; background:#fff;
           font-family:Kanit,system-ui,sans-serif; }
    .os-face { display:block; overflow:hidden; width:84px; height:92px; flex:0 1 auto;
               min-height:62px; background:#d8d3c7; border-radius:4px; }
    .os-facetxt { display:flex; height:100%; align-items:center; justify-content:center;
                  font-size:9px; color:#7a7466; }
    .os-qr { display:block; background:#fff; width:52px; height:52px; padding:4px;
             box-sizing:border-box; }
    .os-qr img { width:100%; height:100%; }
  `

  fs.writeFileSync(
    process.argv[2],
    `<!doctype html><meta charset="utf-8"><title>ตัวอย่างบัตร OS</title>
<style>${css}${extra}</style>
<div class="os-sheet">${cards.join('')}</div>`,
  )
  console.log('wrote', process.argv[2])
}

main().catch((e) => { console.error(e); process.exit(1) })
