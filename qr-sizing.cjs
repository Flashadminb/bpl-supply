/** QR ที่บัตรสแกนยากเพราะอะไร — ขนาด หรือจำนวนโมดูล */
const QRCode = require('qrcode')
const CARD_MM = 54 // ความกว้างบัตรจริง
const CARD_PX = 204

const CASES = [
  ['ของตอนนี้ base64 24 ไบต์', 'aB3xKq9zPmW2rT7vN5cYhJ4dLsF8gQ1e', 'M', 52],
  ['ของตอนนี้ + QR ใหญ่ขึ้น', 'aB3xKq9zPmW2rT7vN5cYhJ4dLsF8gQ1e', 'M', 76],
  ['สั้นลงเหลือ 16 ตัว พิมพ์ใหญ่', 'K7QX2MRV9TB4HZNP', 'M', 52],
  ['สั้น 16 ตัว + QR ใหญ่ขึ้น', 'K7QX2MRV9TB4HZNP', 'M', 76],
  ['สั้น 16 ตัว + กันรอยระดับ Q', 'K7QX2MRV9TB4HZNP', 'Q', 76],
  ['สั้น 12 ตัว + กันรอยระดับ Q', 'K7QX2MRV9TBH', 'Q', 76],
]

for (const [label, token, ecc, px] of CASES) {
  const mods = QRCode.create(token, { errorCorrectionLevel: ecc }).modules.size
  const mm = (px / CARD_PX) * CARD_MM
  const per = mm / mods
  console.log(
    label.padEnd(30) +
      ' | ' + String(mods).padStart(2) + 'x' + mods +
      ' | กว้าง ' + mm.toFixed(1) + ' มม.' +
      ' | ช่องละ ' + per.toFixed(2) + ' มม.' +
      (per >= 0.75 ? '  สบาย' : per >= 0.55 ? '  พอได้' : '  เสี่ยง'),
  )
}
