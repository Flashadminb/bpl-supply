/**
 * หน้าเทียบขนาด QR สามแบบ ไว้ให้เจ้าของระบบเลือก — ไม่ได้อยู่ในแอป
 * เลือกแบบแล้วลบไฟล์นี้ทิ้งได้เลย
 *
 * ใช้รูปหน้าจริงกับโค้ดความยาวจริง เพราะความถี่ของลายในภาพ
 * คือสิ่งที่ตัดสินว่าสแกนติดหรือไม่ติด ดูจากกล่องเปล่าแล้วตัดสินไม่ได้
 */
const fs = require('fs')
const sharp = require('sharp')
const QRCode = require('qrcode')

const SRC =
  'C:/Users/Flash/AppData/Local/Temp/claude/C--Users-Flash-Desktop-Best---------------------/607683b5-890b-45a9-a9d2-3e7bfcb164f0/scratchpad/oscards/1.png'
const Y = '#FFED00'
const NAVY = '#16304C'

const OLD = 'aB3xKq9zPmW2rT7vN5cYhJ4dLsF8gQ1e' // โค้ดแบบที่ใช้อยู่ 32 ตัว
const NEW = 'K7QX2MRV9TB4HZNP' // โค้ดแบบสั้น 16 ตัว พิมพ์ใหญ่ล้วน

const qr = (t, ecc) => QRCode.toDataURL(t, { width: 400, margin: 0, errorCorrectionLevel: ecc })

const P = {
  tag: 'AK',
  name: 'AUNG KO LIN',
  id: '4348801',
  model: 'SAMSUNG GALAXY A20S',
  imei: '352233119375526/01',
}

async function main() {
  const faceBuf = await sharp(SRC)
    .extract({ left: 185, top: 190, width: 215, height: 280 })
    .png()
    .toBuffer()
  const face = 'data:image/png;base64,' + faceBuf.toString('base64')

  const qOld = await qr(OLD, 'M')
  const qNew = await qr(NEW, 'Q')

  const deco =
    '<div class="os-top"><span class="os-navy"></span><span class="os-ystripe"></span></div>' +
    '<span class="os-wedge"></span>' +
    '<img class="os-logo" src="/os-logo.png" alt="Flash Express">'
  const bot = '<div class="os-bot"><span class="os-navy2"></span><span class="os-ytri2"></span></div>'
  const hub =
    '<span class="os-hub"><b>21BPL_BHUB-บางพลี</b><span>Hub Standardization</span></span>'

  const faceEl = (h) => '<span class="os-face" style="height:' + h + 'px"><img src="' + face + '"></span>'
  const qrEl = (px, src) =>
    '<span class="os-qr" style="width:' + px + 'px;height:' + px + 'px"><img src="' + src + '"></span>'

  const cards = {
    now:
      '<div class="os-card">' + deco +
      '<div class="os-inner" style="padding:46px 9px 36px">' +
      '<span class="os-tag">' + P.tag + '</span>' + faceEl(92) +
      '<div class="os-mid">' +
      '<span class="os-name">' + P.name + '</span>' +
      '<span class="os-id">ID: ' + P.id + '</span>' +
      '<span class="os-model">' + P.model + '</span>' +
      '<span class="os-imeiL">IMEI</span>' +
      '<span class="os-imeiV">' + P.imei + '</span></div>' +
      qrEl(52, qOld) + '</div>' + bot + hub + '</div>',

    a:
      '<div class="os-card">' + deco +
      '<div class="os-inner" style="padding:46px 9px 34px">' +
      '<span class="os-tag">' + P.tag + '</span>' + faceEl(70) +
      '<div class="os-mid">' +
      '<span class="os-name">' + P.name + '</span>' +
      '<span class="os-id">ID: ' + P.id + '</span>' +
      '<span class="os-model">' + P.model + '</span>' +
      '<span class="os-imeiL">IMEI</span>' +
      '<span class="os-imeiV">' + P.imei + '</span></div>' +
      qrEl(76, qNew) + '</div>' + bot + '<span class="os-hub os-hub-in"><b>21BPL_BHUB-บางพลี</b></span>' + '</div>',

    b:
      '<div class="os-card">' + deco +
      '<div class="os-inner" style="padding:46px 9px 34px">' +
      '<span class="os-tag">' + P.tag + '</span>' + faceEl(98) +
      '<div class="os-mid">' +
      '<span class="os-name">' + P.name + '</span>' +
      '<span class="os-id">ID: ' + P.id + '</span></div>' +
      '<div class="os-row">' + qrEl(76, qNew) +
      '<span class="os-side"><b>' + P.model + '</b><i>IMEI</i><u>' + P.imei + '</u></span>' +
      '</div></div>' + bot + '<span class="os-hub os-hub-in"><b>21BPL_BHUB-บางพลี</b></span>' + '</div>',

    c:
      '<div class="os-card">' + deco +
      '<div class="os-inner" style="padding:46px 9px 34px">' +
      '<span class="os-tag">' + P.tag + '</span>' + faceEl(68) +
      '<div class="os-mid">' +
      '<span class="os-name">' + P.name + '</span>' +
      '<span class="os-id">ID: ' + P.id + '</span>' +
      '<span class="os-model">' + P.model + '</span>' +
      '<span class="os-imeiBig">' + P.imei + '</span></div>' +
      qrEl(88, qNew) + '</div>' + bot +
      '<span class="os-hub os-hub-in"><b>21BPL_BHUB-บางพลี</b></span></div>',
  }

  const css = [
    'body{margin:0;padding:22px;background:#f4f4f2;font-family:Kanit,system-ui,sans-serif}',
    '.wrap{display:flex;gap:22px;flex-wrap:wrap}',
    '.col{width:204px}',
    '.cap{font-size:13px;font-weight:700;margin:0 0 3px}',
    '.sub{font-size:11px;color:#555;margin:0 0 9px;line-height:1.5;min-height:64px}',
    '.os-card{position:relative;width:204px;height:325px;overflow:hidden;background:#EDEAE4;' +
      'border:1px dashed #b9b3a6;border-radius:8px;color:#111}',
    '.os-top{position:absolute;left:0;right:0;top:0;height:8%;overflow:hidden}',
    '.os-navy,.os-navy2{position:absolute;inset:0;background:' + NAVY + '}',
    '.os-navy{clip-path:polygon(0 0,100% 0,100% 60%,48% 100%,0 55%)}',
    '.os-wedge{position:absolute;right:0;top:0;width:46%;height:27%;background:' + Y + ';' +
      'clip-path:polygon(34% 0,100% 0,100% 74%,52% 100%)}',
    '.os-ystripe{position:absolute;left:-4%;top:0;width:52%;height:9px;background:' + Y + ';' +
      'transform:skewX(-34deg)}',
    '.os-logo{position:absolute;left:9px;top:22px;width:46px}',
    '.os-bot{position:absolute;left:0;right:0;bottom:0;height:8%;overflow:hidden}',
    '.os-navy2{clip-path:polygon(0 52%,30% 14%,100% 40%,100% 100%,0 100%)}',
    '.os-ytri2{position:absolute;left:0;bottom:0;width:46%;height:100%;background:' + Y + ';' +
      'clip-path:polygon(0 34%,48% 0,86% 30%,30% 100%,0 100%)}',
    '.os-inner{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;' +
      'justify-content:space-between;text-align:center}',
    '.os-tag{flex:0 0 auto;background:' + Y + ';border-radius:4px;padding:0 10px;' +
      'font-weight:700;font-size:10px;line-height:1.5}',
    '.os-face{display:block;overflow:hidden;width:84px;flex:0 1 auto;min-height:56px;' +
      'background:#d8d3c7;border-radius:4px}',
    '.os-face img{width:100%;height:100%;object-fit:cover}',
    '.os-mid{display:flex;flex-direction:column;align-items:center;width:100%;min-height:0}',
    '.os-name{font-weight:700;line-height:1.12;font-size:17px}',
    '.os-id{font-size:9px;color:#3b3b3b;margin-top:1px}',
    '.os-model{font-weight:700;font-size:9.5px;margin-top:4px;text-transform:uppercase;' +
      'line-height:1.2}',
    '.os-imeiL{font-weight:700;font-size:10px;margin-top:3px}',
    '.os-imeiV{font-size:8.5px}',
    '.os-imeiBig{font-size:10px;font-weight:700;margin-top:3px;letter-spacing:.02em}',
    '.os-qr{display:block;background:#fff;padding:4px;box-sizing:border-box}',
    '.os-qr img{width:100%;height:100%;display:block}',
    '.os-row{display:flex;align-items:center;gap:7px;width:100%}',
    '.os-side{display:flex;flex-direction:column;text-align:left;line-height:1.25}',
    '.os-side b{font-size:9px;text-transform:uppercase}',
    '.os-side i{font-style:normal;font-weight:700;font-size:9.5px;margin-top:4px}',
    '.os-side u{text-decoration:none;font-size:8.5px}',
    '.os-hub{position:absolute;right:9px;bottom:29px;text-align:right;line-height:1.2}',
    '.os-hub b{display:block;font-size:6px}',
    '.os-hub span{font-size:5px;color:#333}',
    '.os-hub-in{bottom:6px;right:9px}',
    '.os-hub-in b{color:#fff;font-size:6px}',
  ].join('')

  const col = (k, cap, sub) =>
    '<div class="col"><p class="cap">' + cap + '</p><p class="sub">' + sub + '</p>' + cards[k] + '</div>'

  const html =
    '<!doctype html><meta charset="utf-8"><title>เทียบขนาด QR</title><style>' + css + '</style>' +
    '<div class="wrap">' +
    col('now', 'ของตอนนี้', 'ตาราง 29×29 ช่อง กว้าง 13.8 มม.<br><b style="color:#a00">ช่องละ 0.47 มม. — เล็กเกินไป</b>') +
    col('a', 'แบบ ก · ย่อรูปหน้า', 'QR กว้าง 20 มม. ตาราง 21×21<br><b style="color:#070">ช่องละ 0.96 มม. — โตขึ้น 2 เท่า</b><br>รูปหน้าเล็กลงจาก 92 เหลือ 70') +
    col('b', 'แบบ ข · QR อยู่ข้างข้อมูลเครื่อง', 'QR กว้าง 20 มม. ตาราง 21×21<br><b style="color:#070">ช่องละ 0.96 มม. — โตขึ้น 2 เท่า</b><br>รูปหน้าใหญ่ขึ้นเป็น 98') +
    col('c', 'แบบ ค · QR ใหญ่สุด', 'QR กว้าง 23 มม. ตาราง 21×21<br><b style="color:#070">ช่องละ 1.11 มม. — โตขึ้น 2.4 เท่า</b><br>ตัดคำว่า IMEI ออก เลขตัวใหญ่ขึ้นแทน') +
    '</div>'

  fs.writeFileSync('public/__qr-options.html', html)
  console.log('wrote public/__qr-options.html')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
