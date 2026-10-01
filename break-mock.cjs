/**
 * หน้าตัวอย่างระบบบัตรเบรค รอบสอง — ไว้คุยกันก่อนตัดสินใจทำ ไม่ได้อยู่ในแอป
 *
 * โจทย์รอบนี้ต่างจากรอบแรกตรงที่
 *   · ไม่เก็บข้อมูล OS เลย บัตรเป็นแค่หมายเลขกับ QR ไม่มีชื่อไม่มีรูป
 *   · บัตรเป็นของกลางที่หัวหน้างานถือไว้ ไม่ได้ผูกกับคน
 *   · รปภ ไม่ต้องสแกนขาออก ดูจากกระดานว่าใบไหนออกไปอยู่
 *   · ใช้เฉพาะเบรคย่อยกับเข้าห้องน้ำ ไม่ใช้กับพักเที่ยงหรือเปลี่ยนกะ
 *
 *   node break-mock.cjs    แล้วเปิด /__break-mock.html บน dev server
 */
const fs = require('fs')
const QRCode = require('qrcode')

async function main() {
  const qr = await QRCode.toDataURL('BRK7K2QX9MRV', {
    width: 260,
    margin: 0,
    errorCorrectionLevel: 'Q',
  })

  const css = `
  :root{--y:#F5B301;--ink:#141210;--line:#E6E2D8;--mute:#8A857A;
        --ok:#1C7C45;--okbg:#E7F5EC;--warn:#A05A00;--warnbg:#FFF3DF;
        --dang:#B3261E;--dangbg:#FDECEA;}
  *{box-sizing:border-box}
  body{margin:0;padding:16px;background:#F2F1ED;font-family:Kanit,system-ui,sans-serif;color:var(--ink)}
  .row{display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap;max-width:700px}
  .cap{font-size:13px;font-weight:700;margin:0 0 5px}
  .sub{font-size:11px;color:#666;margin:0 0 7px;line-height:1.45;max-width:320px;min-height:46px}
  .phone{width:320px;background:#FBFAF7;border:1px solid var(--line);border-radius:16px;
         overflow:hidden;box-shadow:0 2px 12px #0001}
  .bar{background:var(--ink);color:#fff;padding:10px 13px;font-size:13.5px;font-weight:600;
       display:flex;align-items:center;gap:8px}
  .bar .dot{margin-left:auto;background:var(--y);color:var(--ink);border-radius:999px;
            padding:1px 8px;font-size:11px;font-weight:700}
  .body{padding:13px}
  .lbl{font-size:11px;color:var(--mute);margin:11px 0 5px;font-weight:600}
  .lbl:first-child{margin-top:0}
  .chips{display:flex;flex-wrap:wrap;gap:5px}
  .chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:6px 12px;font-size:12.5px;line-height:1}
  .chip.on{background:var(--ink);color:#fff;border-color:var(--ink);font-weight:600}
  .chip.add{border-style:dashed;color:var(--mute)}
  .go{margin-top:12px;background:var(--y);color:var(--ink);border:0;border-radius:11px;
      width:100%;padding:13px;font-size:14.5px;font-weight:700;font-family:inherit}
  .go.block{background:var(--dang);color:#fff}
  .note{border-radius:10px;padding:9px 11px;font-size:11.5px;line-height:1.45;margin-top:10px}
  .n-warn{background:var(--warnbg);color:var(--warn)}
  .n-dang{background:var(--dangbg);color:var(--dang)}
  .n-ok{background:var(--okbg);color:var(--ok)}
  .n-mute{background:#F0EEE8;color:#55514A}
  .scan{border:2px dashed var(--line);border-radius:12px;padding:18px 10px;text-align:center;
        font-size:12px;color:var(--mute);background:#fff}
  .scan b{display:block;font-size:22px;color:var(--ink);margin-top:5px}

  /* บัตรจริง */
  .card{width:188px;height:300px;background:var(--ink);border-radius:10px;position:relative;
        overflow:hidden;color:#fff;display:flex;flex-direction:column;align-items:center;
        padding:15px 10px;border:1px dashed #b9b3a6}
  .card .top{position:absolute;left:0;right:0;top:0;height:9px;background:var(--y)}
  .card .hub{background:var(--y);color:var(--ink);font-weight:800;font-size:13px;
             border-radius:6px;padding:2px 11px;margin-top:5px}
  .card .no{font-size:62px;font-weight:800;line-height:1;margin:11px 0 2px;letter-spacing:-1px}
  .card .cap2{font-size:11px;opacity:.75;letter-spacing:.08em}
  .card .qr{background:#fff;padding:6px;border-radius:6px;margin-top:11px}
  .card .qr img{width:86px;height:86px;display:block}
  .card .foot{position:absolute;bottom:9px;font-size:8.5px;opacity:.6}

  /* กระดาน รปภ */
  .tile{display:flex;align-items:center;gap:10px;border-radius:12px;padding:10px 11px;margin-bottom:7px;border:1px solid var(--line);background:#fff}
  .tile .num{width:46px;height:46px;border-radius:11px;background:var(--ink);color:#fff;
             display:flex;align-items:center;justify-content:center;font-size:21px;font-weight:800;flex:0 0 auto}
  .tile .mid{flex:1;min-width:0}
  .tile .mid b{display:block;font-size:13px;line-height:1.3}
  .tile .mid span{font-size:11px;color:var(--mute)}
  .tile .cd{font-family:ui-monospace,monospace;font-weight:800;font-size:17px}
  .tile.over{background:var(--dangbg);border-color:#F3C5C1}
  .tile.over .num{background:var(--dang)}
  .tile.over .cd{color:var(--dang)}
  .tile.ok .cd{color:var(--ok)}
  .tile.soon .cd{color:var(--warn)}
  .stop{margin-left:4px;background:var(--ink);color:#fff;border:0;border-radius:10px;
        padding:11px 13px;font-size:12.5px;font-weight:700;font-family:inherit;flex:0 0 auto}

  /* ตารางหลังบ้าน */
  .web{width:672px;background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden}
  .web .wbar{background:#FBFAF7;border-bottom:1px solid var(--line);padding:11px 14px;
             font-size:14px;font-weight:700;display:flex;gap:9px;align-items:center}
  .web .wbar .chip{font-size:11.5px;padding:5px 10px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{text-align:left;color:var(--mute);font-weight:600;padding:8px 12px;border-bottom:1px solid var(--line);font-size:11px}
  td{padding:9px 12px;border-bottom:1px solid #F1EFE9;vertical-align:top}
  tr:last-child td{border-bottom:0}
  .pill{display:inline-block;border-radius:999px;padding:2px 9px;font-size:10.5px;font-weight:600}
  .p-ok{background:var(--okbg);color:var(--ok)}
  .p-over{background:var(--dangbg);color:var(--dang)}
  .p-ban{background:#2B2B2B;color:#FFD9D6}
  .mono{font-family:ui-monospace,monospace}
  `

  const html = `<!doctype html><meta charset="utf-8"><title>ตัวอย่างบัตรเบรค รอบ 2</title><style>${css}</style>
<div class="row">

  <div>
    <p class="cap">① ตัวบัตร — ไม่มีชื่อ ไม่มีรูป</p>
    <p class="sub">หัวหน้างานถือไว้เป็นชุด ใช้ซ้ำได้ตลอด · มีแค่เลขใบกับ QR ใครเก็บได้ก็ใช้ไม่ได้ เพราะอำนาจอยู่ที่กระดาน ไม่ได้อยู่ที่บัตร</p>
    <div class="card">
      <span class="top"></span>
      <span class="hub">21BPL</span>
      <div class="no">07</div>
      <div class="cap2">บัตรเบรค</div>
      <div class="qr"><img src="${qr}"></div>
      <div class="foot">ใบนี้ไม่ใช่สิทธิ์ · สิทธิ์อยู่ที่ระบบ</div>
    </div>
  </div>

  <div>
    <p class="cap">② หัวหน้างาน — ปล่อยเบรค</p>
    <p class="sub">สแกน QR บนบัตรที่จะยื่นให้ แล้วเลือกเวลากับเหตุผล · ใส่ชื่อหรือไม่ใส่ก็ได้ ระบบไม่ได้เก็บทะเบียน OS ไว้เลย</p>
    <div class="phone">
      <div class="bar">ปล่อยเบรค <span class="dot">กะดึก</span></div>
      <div class="body">
        <div class="scan">สแกนบัตรที่จะยื่นให้<b>บัตรเบรค 07</b></div>

        <div class="lbl">เพราะอะไร</div>
        <div class="chips">
          <span class="chip on">เข้าห้องน้ำ</span><span class="chip">เบรคย่อย</span>
          <span class="chip">ฉุกเฉิน</span><span class="chip add">+ เพิ่ม</span>
        </div>

        <div class="lbl">กี่นาที</div>
        <div class="chips">
          <span class="chip">2</span><span class="chip">3</span><span class="chip">5</span>
          <span class="chip">6</span><span class="chip">8</span><span class="chip on">10</span>
          <span class="chip">15</span><span class="chip">20</span><span class="chip add">พิมพ์เอง</span>
        </div>

        <div class="lbl">ใครไป · ไม่บังคับ</div>
        <div class="chips">
          <span class="chip add">พิมพ์ชื่อเล่น</span><span class="chip add">📷 ถ่ายรูป</span>
        </div>
        <div class="note n-mute">ไม่ใส่ก็ปล่อยได้ · ใส่ไว้จะตามได้ว่าใครเกินเวลาบ่อย</div>

        <button class="go">ยื่นบัตร 07 · เริ่มจับเวลา 10 นาที</button>
      </div>
    </div>
  </div>

  <div>
    <p class="cap">③ หัวหน้างาน — ตอนอยู่ในช่วงห้ามเบรค</p>
    <p class="sub">ไม่ได้ปิดตาย ยังปล่อยได้ถ้าฉุกเฉินจริง แต่ต้องกดรับรู้ และคนที่คุณเลือกไว้จะได้แจ้งเตือนทันทีว่าใครปล่อยตอนไหน</p>
    <div class="phone">
      <div class="bar">ปล่อยเบรค <span class="dot">กะดึก</span></div>
      <div class="body">
        <div class="scan">บัตรที่สแกน<b>บัตรเบรค 03</b></div>
        <div class="note n-dang" style="margin-top:12px">
          <b>ตอนนี้เป็นช่วงห้ามเบรค</b><br>
          03:30–04:30 · ปิดยอดก่อนจบกะ · ตั้งโดยเจ้าของระบบ
        </div>
        <div class="lbl">ถ้าจำเป็นจริง ให้ระบุเหตุ</div>
        <div class="chips">
          <span class="chip on">ปวดท้องฉุกเฉิน</span><span class="chip">ไม่สบาย</span><span class="chip add">พิมพ์เอง</span>
        </div>
        <div class="note n-warn">กดปล่อยแล้ว ธนวัฒน์ และอีก 2 คนจะได้แจ้งเตือนทันทีว่าคุณปล่อยบัตรในช่วงห้าม</div>
        <button class="go block">ยืนยันว่าฉุกเฉิน · ปล่อยบัตร 03</button>
      </div>
    </div>
  </div>

  <div>
    <p class="cap">④ รปภ — กระดานบัตรที่ออกไป</p>
    <p class="sub"><b>ไม่ต้องสแกนขาออก</b> · ใบไหนไม่อยู่บนกระดาน แปลว่าไม่ได้ขออนุญาต ไม่ปล่อย · บัตรปลอมใช้ไม่ได้ เพราะเลขปลอมไม่ขึ้นบนนี้</p>
    <div class="phone">
      <div class="bar">บัตรที่ออกไปอยู่ <span class="dot">3 ใบ</span></div>
      <div class="body">
        <div class="tile over">
          <span class="num">03</span>
          <span class="mid"><b>เข้าห้องน้ำ · ขอ 10 นาที</b><span>ปล่อยโดย สิโรธร 04:12</span></span>
          <span class="cd">+3:20</span>
          <button class="stop">รับกลับ</button>
        </div>
        <div class="tile soon">
          <span class="num">07</span>
          <span class="mid"><b>เข้าห้องน้ำ · ขอ 10 นาที</b><span>ปล่อยโดย สิโรธร 04:19</span></span>
          <span class="cd">1:05</span>
          <button class="stop">รับกลับ</button>
        </div>
        <div class="tile ok">
          <span class="num">12</span>
          <span class="mid"><b>เบรคย่อย · ขอ 20 นาที</b><span>ปล่อยโดย ปิยะนุช 04:21</span></span>
          <span class="cd">14:40</span>
          <button class="stop">รับกลับ</button>
        </div>
        <div class="note n-mute">กด <b>รับกลับ</b> ครั้งเดียวจบ หรือสแกนบัตรตอนคนกลับมาเยอะ ๆ ก็ได้</div>
      </div>
    </div>
  </div>

  <div style="width:100%">
    <p class="cap">⑤ หลังบ้าน — เมนูใหม่ "บัตรเบรค"</p>
    <p class="sub" style="max-width:none">คุมได้ทุกอย่างที่เดียว: ประวัติทุกใบ · ใครปล่อย · เกินกี่นาที · ใบไหนปล่อยในช่วงห้าม · ตั้งช่วงห้ามเบรค · ออกบัตรใหม่เปลี่ยน QR ทั้งชุด</p>
    <div class="web">
      <div class="wbar">ประวัติการเบรค
        <span class="chip">วันนี้</span><span class="chip on" style="background:var(--ink);color:#fff">เกินเวลา</span>
        <span class="chip">ปล่อยในช่วงห้าม</span>
        <span class="chip" style="margin-left:auto">ตั้งช่วงห้ามเบรค</span><span class="chip">ออกบัตร/เปลี่ยน QR</span>
      </div>
      <table>
        <thead><tr><th>บัตร</th><th>เหตุผล</th><th>ปล่อยโดย</th><th>ออก–กลับ</th><th>ใช้ไป</th><th>สถานะ</th></tr></thead>
        <tbody>
          <tr><td class="mono">03</td><td>เข้าห้องน้ำ<br><span style="color:var(--mute)">—</span></td>
              <td>สิโรธร คล้ายศิริ<br><span style="color:var(--mute)">690196</span></td>
              <td>04:12 – 04:25</td><td><b>13:20</b> / ขอ 10</td>
              <td><span class="pill p-over">เกิน 3:20</span></td></tr>
          <tr><td class="mono">07</td><td>เข้าห้องน้ำ<br><span style="color:var(--mute)">Zaw (พิมพ์ไว้)</span></td>
              <td>สิโรธร คล้ายศิริ<br><span style="color:var(--mute)">690196</span></td>
              <td>04:19 – 04:27</td><td><b>8:02</b> / ขอ 10</td>
              <td><span class="pill p-ok">ตรงเวลา</span></td></tr>
          <tr><td class="mono">03</td><td>ปวดท้องฉุกเฉิน<br><span style="color:var(--mute)">—</span></td>
              <td>ปิยะนุช สมบัติหล้า<br><span style="color:var(--mute)">632550</span></td>
              <td>03:48 – 03:56</td><td><b>8:10</b> / ขอ 10</td>
              <td><span class="pill p-ban">ปล่อยในช่วงห้าม</span></td></tr>
          <tr><td class="mono">12</td><td>เบรคย่อย<br><span style="color:var(--mute)">—</span></td>
              <td>ปิยะนุช สมบัติหล้า<br><span style="color:var(--mute)">632550</span></td>
              <td>04:21 – <span style="color:var(--mute)">ยังไม่กลับ</span></td><td><b>5:20</b> / ขอ 20</td>
              <td><span class="pill p-ok">ออกไปอยู่</span></td></tr>
        </tbody>
      </table>
    </div>
  </div>

</div>`

  fs.writeFileSync('public/__break-mock.html', html)
  console.log('เปิด /__break-mock.html บน dev server ได้เลย')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
