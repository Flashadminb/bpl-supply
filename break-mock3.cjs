/**
 * หน้าตัวอย่างระบบบัตรเบรค รอบสาม — ไว้คุยกันก่อนตัดสินใจทำ ไม่ได้อยู่ในแอป
 *
 * รอบนี้ใส่ทุกอย่างที่ตกลงกันแล้วลงไปครบ
 *   · บัตรไม่มีชื่อไม่มีรูป อำนาจอยู่ที่กระดาน ไม่ได้อยู่ที่บัตร
 *   · เวลาเริ่มนับตอนหัวหน้ากดยื่นบัตร หัวหน้าเผื่อเวลาเดินเอง
 *     นาทีที่เลือกจึงหมายถึง "ไปกลับรวม" ไม่ใช่เวลาเบรคสุทธิ
 *   · รปภ ไม่สแกนขาออก กดรับกลับขาเข้าอย่างเดียว
 *   · เตือนเกินเวลาด้วยนาฬิกานับถอยหลังในเครื่อง ไม่รอเซิร์ฟเวอร์
 *   · ช่วงห้ามเบรคปล่อยได้ถ้าฉุกเฉิน แต่เด้งเตือนคนที่เจ้าของเลือกไว้ทันที
 *   · ส่งเข้าชีตแล้วลบของที่เก่ากว่า 3 เดือน รูปอยู่ Drive เปิดจากลิงก์ในชีต
 *
 *   node break-mock3.cjs   แล้วเปิด /__brk-a.html และ /__brk-b.html บน dev server
 */
const fs = require('fs')
const QRCode = require('qrcode')

const css = `
:root{--y:#F5B301;--ink:#141210;--line:#E6E2D8;--mute:#8A857A;
      --ok:#1C7C45;--okbg:#E7F5EC;--warn:#A05A00;--warnbg:#FFF3DF;
      --dang:#B3261E;--dangbg:#FDECEA;}
*{box-sizing:border-box}
body{margin:0;padding:16px;background:#F2F1ED;font-family:Kanit,system-ui,sans-serif;color:var(--ink)}
.row{display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap;max-width:700px}
.cap{font-size:13px;font-weight:700;margin:0 0 5px}
.sub{font-size:11px;color:#666;margin:0 0 7px;line-height:1.45;max-width:320px;min-height:46px}
.sub.w{max-width:672px;min-height:0}
.phone{width:320px;background:#FBFAF7;border:1px solid var(--line);border-radius:16px;
       overflow:hidden;box-shadow:0 2px 12px #0001}
.bar{background:var(--ink);color:#fff;padding:10px 13px;font-size:13.5px;font-weight:600;
     display:flex;align-items:center;gap:8px}
.bar.red{background:var(--dang)}
.bar .dot{margin-left:auto;background:var(--y);color:var(--ink);border-radius:999px;
          padding:1px 8px;font-size:11px;font-weight:700}
.body{padding:13px}
.lbl{font-size:11px;color:var(--mute);margin:11px 0 5px;font-weight:600}
.lbl:first-child{margin-top:0}
.lbl b{color:var(--ink)}
.chips{display:flex;flex-wrap:wrap;gap:5px}
.chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:6px 12px;font-size:12.5px;line-height:1}
.chip.on{background:var(--ink);color:#fff;border-color:var(--ink);font-weight:600}
.chip.add{border-style:dashed;color:var(--mute)}
.inp{border:1px solid var(--line);background:#fff;border-radius:10px;padding:9px 11px;
     font-size:12.5px;color:var(--mute)}
.go{margin-top:12px;background:var(--y);color:var(--ink);border:0;border-radius:11px;
    width:100%;padding:13px;font-size:14.5px;font-weight:700;font-family:inherit}
.go.block{background:var(--dang);color:#fff}
.note{border-radius:10px;padding:9px 11px;font-size:11.5px;line-height:1.45;margin-top:10px}
.n-warn{background:var(--warnbg);color:var(--warn)}
.n-dang{background:var(--dangbg);color:var(--dang)}
.n-ok{background:var(--okbg);color:var(--ok)}
.n-mute{background:#F0EEE8;color:#55514A}
.scan{border:2px dashed var(--line);border-radius:12px;padding:16px 10px;text-align:center;
      font-size:12px;color:var(--mute);background:#fff}
.scan b{display:block;font-size:22px;color:var(--ink);margin-top:5px}

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
.card .foot{position:absolute;bottom:9px;font-size:8.5px;opacity:.6;text-align:center;line-height:1.3}

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
      padding:11px 12px;font-size:12.5px;font-weight:700;font-family:inherit;flex:0 0 auto}

.web{width:672px;background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden}
.web .wbar{background:#FBFAF7;border-bottom:1px solid var(--line);padding:11px 14px;
           font-size:14px;font-weight:700;display:flex;gap:9px;align-items:center;flex-wrap:wrap}
.web .wbar .chip{font-size:11.5px;padding:5px 10px;font-weight:500}
.wpad{padding:13px 14px}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;color:var(--mute);font-weight:600;padding:8px 12px;border-bottom:1px solid var(--line);font-size:11px}
td{padding:9px 12px;border-bottom:1px solid #F1EFE9;vertical-align:top}
tr:last-child td{border-bottom:0}
.pill{display:inline-block;border-radius:999px;padding:2px 9px;font-size:10.5px;font-weight:600}
.p-ok{background:var(--okbg);color:var(--ok)}
.p-over{background:var(--dangbg);color:var(--dang)}
.p-ban{background:#2B2B2B;color:#FFD9D6}
.mono{font-family:ui-monospace,monospace}
.lk{color:#1A5FB4;text-decoration:underline;font-size:11px}
.ln{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #F1EFE9;font-size:12.5px}
.ln:last-child{border-bottom:0}
.ln .g{flex:1}
.ln .g span{display:block;font-size:11px;color:var(--mute);margin-top:2px}
.ln .btn{background:#fff;border:1px solid var(--line);border-radius:9px;padding:7px 11px;
         font-size:11.5px;font-weight:600;font-family:inherit;flex:0 0 auto}
.ln .btn.y{background:var(--y);border-color:var(--y)}
.ln .btn.d{background:#fff;border-color:#F3C5C1;color:var(--dang)}
.meter{height:9px;border-radius:999px;background:#EDEBE4;overflow:hidden;margin-top:7px}
.meter i{display:block;height:100%;width:7.6%;background:var(--ok)}
.h3{font-size:12px;font-weight:700;margin:14px 0 4px}
.h3:first-child{margin-top:0}
`

function page(title, inner) {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><style>${css}</style>
<div class="row">${inner}</div>`
}

async function main() {
  const qr = await QRCode.toDataURL('BRK7K2QX9MRV', {
    width: 260,
    margin: 0,
    errorCorrectionLevel: 'Q',
  })

  // ═══════════════ แผ่น A · หน้างาน ═══════════════
  const a = `
  <div>
    <p class="cap">① ตัวบัตร — ไม่มีชื่อ ไม่มีรูป</p>
    <p class="sub">หัวหน้างานถือไว้เป็นชุด ใช้ซ้ำได้ตลอด · ก็อปไปก็ใช้ไม่ได้ เพราะเลขที่ไม่ขึ้นบนกระดาน รปภ คือไม่ได้รับอนุญาต</p>
    <div class="card">
      <span class="top"></span>
      <span class="hub">21BPL</span>
      <div class="no">07</div>
      <div class="cap2">บัตรเบรค</div>
      <div class="qr"><img src="${qr}"></div>
      <div class="foot">ใบนี้ไม่ใช่สิทธิ์<br>สิทธิ์อยู่ที่ระบบ</div>
    </div>
  </div>

  <div>
    <p class="cap">② หัวหน้างาน — ปล่อยเบรค</p>
    <p class="sub">สแกนบัตรที่จะยื่นให้ · กดเหตุผลแล้วนาทีเด้งมาให้เอง ไม่ต้องคิด · เวลาเริ่มนับตอนกดยื่น นาทีที่เห็นจึงเป็น "ไปกลับรวม"</p>
    <div class="phone">
      <div class="bar">ปล่อยเบรค <span class="dot">กะดึก</span></div>
      <div class="body">
        <div class="scan">สแกนบัตรที่จะยื่นให้<b>บัตรเบรค 07</b></div>

        <div class="lbl">เพราะอะไร</div>
        <div class="chips">
          <span class="chip on">เข้าห้องน้ำ</span><span class="chip">เบรคย่อย</span>
          <span class="chip">ฉุกเฉิน</span>
        </div>

        <div class="lbl">ไปกลับรวมกี่นาที · <b>ค่าเริ่มต้น 6 นาที</b></div>
        <div class="chips">
          <span class="chip">4</span><span class="chip">5</span><span class="chip on">6</span>
          <span class="chip">8</span><span class="chip">10</span><span class="chip">15</span>
          <span class="chip add">พิมพ์เอง</span>
        </div>

        <div class="note n-mute">เวลาเริ่มเดินตอนกดยื่นบัตร ไม่ใช่ตอนถึง รปภ — เผื่อเวลาเดินไว้ในนาทีนี้แล้ว</div>

        <div class="lbl">ชื่อเล่น (ไม่บังคับ)</div>
        <div class="inp">เว้นว่างได้ · ระบบไม่เก็บทะเบียน OS</div>

        <button class="go">ยื่นบัตร 07 · เริ่มจับเวลา</button>
      </div>
    </div>
  </div>

  <div>
    <p class="cap">③ หัวหน้างาน — ช่วงที่คุณสั่งห้าม</p>
    <p class="sub">ไม่ปิดตาย ปล่อยได้ถ้าฉุกเฉินจริง แต่ต้องพิมพ์เหตุผล และคนที่คุณเลือกไว้จะรู้ทันทีว่าใครปล่อย</p>
    <div class="phone">
      <div class="bar red">ปล่อยเบรค · ช่วงห้าม</div>
      <div class="body">
        <div class="note n-dang" style="margin-top:0">ห้ามเบรค 04:00–04:30 · เหตุผลที่ตั้งไว้ "ช่วงรถเข้า"<br>ตอนนี้ 04:12 — ยังอีก 18 นาที</div>

        <div class="lbl">เพราะอะไร</div>
        <div class="chips">
          <span class="chip" style="opacity:.4">เข้าห้องน้ำ</span>
          <span class="chip" style="opacity:.4">เบรคย่อย</span>
          <span class="chip on">ฉุกเฉิน</span>
        </div>

        <div class="lbl">เหตุผลฉุกเฉิน <b>(บังคับ)</b></div>
        <div class="inp" style="color:var(--ink)">ปวดท้องมาก ทนไม่ได้จริง</div>

        <div class="note n-warn">กดแล้วจะเด้งเตือนทันที — ธนวัฒน์ (เจ้าของ), ผู้ตรวจการ 2 คน<br>ประวัติจะติดป้าย "ปล่อยในช่วงห้าม" ถาวร</div>

        <button class="go block">ยืนยันปล่อยในช่วงห้าม</button>
      </div>
    </div>
  </div>

  <div>
    <p class="cap">④ หัวหน้างาน — ใบที่ตัวเองปล่อย</p>
    <p class="sub">นาฬิกานับถอยหลังในเครื่อง ไม่ต้องรอเซิร์ฟเวอร์ ตรงถึงวินาที · ปิดจอไว้ก็ยังมีแจ้งเตือนเด้งตามไปให้</p>
    <div class="phone">
      <div class="bar">ใบที่ผมปล่อย <span class="dot">3 ใบ</span></div>
      <div class="body">
        <div class="tile over">
          <div class="num">03</div>
          <div class="mid"><b>เบรคย่อย</b><span>ขอ 10 นาที · ยื่น 04:12</span></div>
          <div class="cd">+1:40</div>
        </div>
        <div class="tile soon">
          <div class="num">07</div>
          <div class="mid"><b>เข้าห้องน้ำ</b><span>Zaw · ขอ 6 นาที</span></div>
          <div class="cd">0:48</div>
        </div>
        <div class="tile ok">
          <div class="num">12</div>
          <div class="mid"><b>ฉุกเฉิน</b><span>ขอ 15 นาที</span></div>
          <div class="cd">7:02</div>
        </div>
        <div class="note n-dang">ใบ 03 เกินมา 1 นาที 40 วินาที — เตือนไปแล้ว</div>
      </div>
    </div>
  </div>

  <div>
    <p class="cap">⑤ กระดาน รปภ</p>
    <p class="sub">ขาออกไม่ต้องสแกน แค่เหลือบดูว่าเลขบนบัตรขึ้นอยู่บนจอไหม · ขากลับกดรับกลับ เวลาหยุดทันที</p>
    <div class="phone">
      <div class="bar">บัตรที่ออกไปอยู่ <span class="dot">3 ใบ</span></div>
      <div class="body">
        <div class="tile over">
          <div class="num">03</div>
          <div class="mid"><b>เบรคย่อย</b><span>เกินมา 1:40</span></div>
          <button class="stop">รับกลับ</button>
        </div>
        <div class="tile soon">
          <div class="num">07</div>
          <div class="mid"><b>เข้าห้องน้ำ</b><span>เหลือ 0:48</span></div>
          <button class="stop">รับกลับ</button>
        </div>
        <div class="tile ok">
          <div class="num">12</div>
          <div class="mid"><b>ฉุกเฉิน</b><span>เหลือ 7:02</span></div>
          <button class="stop">รับกลับ</button>
        </div>
        <div class="note n-ok">เลขที่ไม่ขึ้นบนกระดานนี้ = ไม่ได้รับอนุญาต ไม่ต้องปล่อย</div>
      </div>
    </div>
  </div>`

  // ═══════════════ แผ่น B · หลังบ้าน ═══════════════
  const b = `
  <div>
    <p class="cap">⑥ หลังบ้าน — ประวัติเบรค (เมนูใหม่ แยกออกมา)</p>
    <p class="sub w">กรองได้ว่าใครเกินเวลาบ่อย ใครปล่อยในช่วงห้าม · รูปไม่ได้เก็บในฐานข้อมูล กดเปิดจาก Drive</p>
    <div class="web">
      <div class="wbar">ประวัติเบรค
        <span class="chip">1–31 ต.ค. 2026</span>
        <span class="chip">เฉพาะที่เกินเวลา</span>
        <span class="chip">เฉพาะช่วงห้าม</span>
        <span class="chip">หัวหน้างาน: ทุกคน</span>
      </div>
      <table>
        <thead><tr><th>บัตร</th><th>เหตุผล</th><th>ปล่อยโดย</th><th>ออก–กลับ</th><th>ใช้ไป / ขอ</th><th>รูป</th><th>สถานะ</th></tr></thead>
        <tbody>
          <tr><td class="mono">03</td><td>เบรคย่อย<br><span style="color:var(--mute)">—</span></td>
              <td>สิโรธร คล้ายศิริ<br><span style="color:var(--mute)">690196</span></td>
              <td>04:12 – 04:25</td><td><b>13:20</b> / 10</td>
              <td><a class="lk">เปิด</a></td>
              <td><span class="pill p-over">เกิน 3:20</span></td></tr>
          <tr><td class="mono">07</td><td>เข้าห้องน้ำ<br><span style="color:var(--mute)">Zaw (พิมพ์ไว้)</span></td>
              <td>สิโรธร คล้ายศิริ<br><span style="color:var(--mute)">690196</span></td>
              <td>04:19 – 04:24</td><td><b>5:02</b> / 6</td>
              <td><span style="color:var(--mute);font-size:11px">—</span></td>
              <td><span class="pill p-ok">ตรงเวลา</span></td></tr>
          <tr><td class="mono">03</td><td>ฉุกเฉิน<br><span style="color:var(--mute)">ปวดท้องมาก ทนไม่ได้จริง</span></td>
              <td>ปิยะนุช สมบัติหล้า<br><span style="color:var(--mute)">632550</span></td>
              <td>04:12 – 04:20</td><td><b>8:10</b> / 15</td>
              <td><a class="lk">เปิด</a></td>
              <td><span class="pill p-ban">ปล่อยในช่วงห้าม</span></td></tr>
          <tr><td class="mono">12</td><td>เบรคย่อย<br><span style="color:var(--mute)">—</span></td>
              <td>ปิยะนุช สมบัติหล้า<br><span style="color:var(--mute)">632550</span></td>
              <td>04:21 – <span style="color:var(--mute)">ยังไม่กลับ</span></td><td><b>5:20</b> / 10</td>
              <td><span style="color:var(--mute);font-size:11px">—</span></td>
              <td><span class="pill p-ok">ออกไปอยู่</span></td></tr>
          <tr><td class="mono">09</td><td>เบรคย่อย<br><span style="color:var(--mute)">—</span></td>
              <td>ณัฐพล ศรีสมบัติ<br><span style="color:var(--mute)">711204</span></td>
              <td>02:40 – <span style="color:var(--mute)">ปิดอัตโนมัติ</span></td><td><b>—</b> / 10</td>
              <td><span style="color:var(--mute);font-size:11px">—</span></td>
              <td><span class="pill p-over">ไม่ได้รับกลับ</span></td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <div>
    <p class="cap">⑦ หลังบ้าน — ส่งเข้าชีต แล้วล้างของเก่า</p>
    <p class="sub w">ปุ่มเดียวกับกระสอบ · ส่งเข้าชีต "ประวัติเบรค" แล้วลบเฉพาะใบที่ปิดแล้ว ชีตยืนยันรับแล้ว และเก่ากว่า 3 เดือน</p>
    <div class="web">
      <div class="wbar">ส่งเข้าชีต <span class="chip">ประวัติเบรค</span></div>
      <div class="wpad">
        <div class="ln">
          <div class="g">ยังไม่ได้ส่งเข้าชีต<span>1,284 แถว · เก่าสุด 1 ต.ค. 2026</span></div>
          <button class="btn y">ส่งเข้าชีต</button>
        </div>
        <div class="ln">
          <div class="g">ส่งแล้ว และเก่ากว่า 3 เดือน<span>9,140 แถว · ถึง 2 ก.ค. 2026 · ลบได้</span></div>
          <button class="btn d">ล้างออกจากฐานข้อมูล</button>
        </div>
        <div class="ln">
          <div class="g">เก็บไว้ในเว็บ 3 เดือนล่าสุด<span>28,400 แถว · กรองดูในหน้าประวัติได้ทันที</span></div>
          <button class="btn">เปิดชีต</button>
        </div>
        <div class="note n-mute">ลบแล้วพื้นที่ไม่คืนทันที Postgres เอาไปใช้ซ้ำเอง ตารางจะนิ่งไม่โตต่อ<br>รูปยังอยู่ใน Drive ครบ เปิดจากลิงก์ในชีตได้ตลอด</div>
        <div style="margin-top:12px;font-size:11.5px;color:var(--mute)">ฐานข้อมูล 38 MB / 500 MB</div>
        <div class="meter"><i></i></div>
      </div>
    </div>
  </div>

  <div>
    <p class="cap">⑧ หลังบ้าน — ตั้งค่า (เฉพาะเจ้าของระบบ)</p>
    <p class="sub w">ทุกอย่างที่หัวหน้างานทำได้ คุณตั้งจากที่นี่ที่เดียว ไม่ต้องแก้โค้ด</p>
    <div class="web">
      <div class="wbar">ตั้งค่าบัตรเบรค</div>
      <div class="wpad">
        <p class="h3">ช่วงห้ามเบรค</p>
        <div class="ln"><div class="g">ทุกวัน 04:00 – 04:30<span>ช่วงรถเข้า</span></div><button class="btn">แก้</button></div>
        <div class="ln"><div class="g">ทุกวัน 20:00 – 20:20<span>ปิดยอด</span></div><button class="btn">แก้</button></div>
        <div class="ln"><div class="g" style="color:var(--mute)">+ เพิ่มช่วงห้าม</div></div>

        <p class="h3">นาทีเริ่มต้นของแต่ละเหตุผล (ไปกลับรวม)</p>
        <div class="ln"><div class="g">เข้าห้องน้ำ<span>เผื่อเวลาเดินแล้ว</span></div><span class="chip on">6 นาที</span><button class="btn">แก้</button></div>
        <div class="ln"><div class="g">เบรคย่อย</div><span class="chip on">10 นาที</span><button class="btn">แก้</button></div>
        <div class="ln"><div class="g">ฉุกเฉิน</div><span class="chip on">15 นาที</span><button class="btn">แก้</button></div>

        <p class="h3">ใครได้แจ้งเตือนเมื่อมีคนปล่อยในช่วงห้าม</p>
        <div class="chips" style="margin-bottom:4px">
          <span class="chip on">ธนวัฒน์ (เจ้าของ)</span><span class="chip on">ผู้ตรวจการ A</span>
          <span class="chip on">ผู้ตรวจการ B</span><span class="chip add">+ เพิ่มคน</span>
        </div>

        <p class="h3">ใครปล่อยบัตรได้</p>
        <div class="chips" style="margin-bottom:4px">
          <span class="chip on">หัวหน้ากะดึก 3 คน</span><span class="chip on">หัวหน้ากะเช้า 2 คน</span>
          <span class="chip add">+ เพิ่มคน</span>
        </div>

        <p class="h3">บัตร</p>
        <div class="ln"><div class="g">มีอยู่ 16 ใบ · ใช้งานได้ทั้งหมด<span>พิมพ์ได้จากเครื่องคุณเท่านั้น</span></div>
          <button class="btn">พิมพ์ชุดบัตร</button><button class="btn d">เปลี่ยน QR ทั้งชุด</button></div>
        <div class="note n-warn">เปลี่ยน QR แล้วบัตรใบเดิมใช้ไม่ได้ทันที ต้องพิมพ์ใหม่แจกใหม่ทั้งชุด<br>ปุ่มนี้เห็นเฉพาะเจ้าของระบบ</div>
      </div>
    </div>
  </div>`

  fs.writeFileSync('public/__brk-a.html', page('บัตรเบรค · หน้างาน', a))
  fs.writeFileSync('public/__brk-b.html', page('บัตรเบรค · หลังบ้าน', b))
  console.log('ok: /__brk-a.html  /__brk-b.html')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
