/**
 * หน้าตัวอย่างระบบบัตรเบรค รอบสี่ — ไว้คุยกันก่อนตัดสินใจทำ ไม่ได้อยู่ในแอป
 *
 * รอบนี้ย้าย QR ไปอยู่ฝั่ง รปภ ตามที่เจ้าของระบบชี้
 *   · หัวหน้างาน "จิ้มเลือก" บัตรจากรายการของแผนกตัวเอง ไม่ต้องเปิดกล้อง
 *   · รปภ "สแกน" อย่างเดียว ทั้งขาออกและขากลับ ระบบรู้เองว่าครั้งนี้คืออะไร
 *   · การสแกนไม่เปลี่ยนอะไรทันที แค่เปิดจอให้ดู แล้วมีปุ่มเดียวให้กด
 *     ไม่เคยมีสองปุ่มให้เลือก เพราะทิศทาง รปภ เห็นเองอยู่แล้ว
 *   · QR เก็บแค่รหัสบัตรตรง ๆ ไม่ใช่ความลับ ปลอมมาก็ไปจบที่ด่านเดียวกัน
 *     ผลพลอยได้คือ QR เล็กสแกนง่าย และพิมพ์รหัสแทนได้ถ้ากล้องไม่ติด
 *   · ได้เวลาสามจุด ยื่น → ผ่านประตู → กลับ เวลาเดินจึงแยกออกจากเวลาอู้
 *
 *   node break-mock4.cjs   แล้วเปิด /__brk4-a.html และ /__brk4-b.html บน dev server
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
.sub.s{min-height:32px}
.phone{width:320px;background:#FBFAF7;border:1px solid var(--line);border-radius:16px;
       overflow:hidden;box-shadow:0 2px 12px #0001}
.bar{background:var(--ink);color:#fff;padding:10px 13px;font-size:13.5px;font-weight:600;
     display:flex;align-items:center;gap:8px}
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
.go{margin-top:12px;background:var(--y);color:var(--ink);border:0;border-radius:11px;
    width:100%;padding:13px;font-size:14.5px;font-weight:700;font-family:inherit}
.go.green{background:var(--ok);color:#fff}
.go.amber{background:var(--warn);color:#fff}
.go.ghost{background:#fff;border:1px solid var(--line);color:var(--mute);font-size:12px;padding:9px;margin-top:7px;font-weight:600}
.note{border-radius:10px;padding:9px 11px;font-size:11.5px;line-height:1.45;margin-top:10px}
.n-warn{background:var(--warnbg);color:var(--warn)}
.n-dang{background:var(--dangbg);color:var(--dang)}
.n-ok{background:var(--okbg);color:var(--ok)}
.n-mute{background:#F0EEE8;color:#55514A}

/* จอผลการสแกนของ รปภ */
.res{border-radius:13px;padding:15px 13px;text-align:center;border:2px solid}
.res .code{font-family:ui-monospace,monospace;font-size:27px;font-weight:800;letter-spacing:-.5px}
.res .st{font-size:15px;font-weight:700;margin-top:7px}
.res .de{font-size:11.5px;margin-top:4px;line-height:1.5}
.r-ok{background:var(--okbg);border-color:#A8D8BC}
.r-ok .st{color:var(--ok)} .r-ok .de{color:#2F6B49}
.r-am{background:var(--warnbg);border-color:#EBC890}
.r-am .st{color:var(--warn)} .r-am .de{color:#7A4700}
.r-no{background:var(--dangbg);border-color:#F0B6B1}
.r-no .st{color:var(--dang)} .r-no .de{color:#8C2A24}

/* บัตรจริง */
.card{width:188px;height:276px;background:var(--ink);border-radius:10px;position:relative;
      overflow:hidden;color:#fff;display:flex;flex-direction:column;align-items:center;
      padding:14px 10px;border:1px dashed #b9b3a6}
.card .top{position:absolute;left:0;right:0;top:0;height:9px;background:var(--y)}
.card .hub{background:var(--y);color:var(--ink);font-weight:800;font-size:12px;
           border-radius:6px;padding:2px 10px;margin-top:4px}
.card .no{font-family:ui-monospace,monospace;font-size:30px;font-weight:800;line-height:1;margin:12px 0 2px}
.card .cap2{font-size:10px;opacity:.75;letter-spacing:.08em}
.card .qr{background:#fff;padding:6px;border-radius:6px;margin-top:10px}
.card .qr img{width:96px;height:96px;display:block}
.card .foot{position:absolute;bottom:8px;font-size:8px;opacity:.6;text-align:center;line-height:1.3}

/* ตารางเลือกบัตร */
.pick{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.pk{border:1px solid var(--line);background:#fff;border-radius:10px;padding:8px 9px;
    font-family:ui-monospace,monospace;font-size:13px;font-weight:700}
.pk small{display:block;font-family:Kanit,sans-serif;font-size:10px;font-weight:400;color:var(--mute);margin-top:2px}
.pk.on{background:var(--ink);color:#fff;border-color:var(--ink)}
.pk.on small{color:#D8D3C7}
.pk.off{opacity:.45}

/* กระดาน */
.tile{display:flex;align-items:center;gap:10px;border-radius:12px;padding:10px 11px;margin-bottom:7px;border:1px solid var(--line);background:#fff}
.tile .num{min-width:62px;height:42px;padding:0 6px;border-radius:10px;background:var(--ink);color:#fff;
           display:flex;align-items:center;justify-content:center;font-family:ui-monospace,monospace;
           font-size:13px;font-weight:800;flex:0 0 auto}
.tile .mid{flex:1;min-width:0}
.tile .mid b{display:block;font-size:12.5px;line-height:1.35}
.tile .mid span{font-size:10.5px;color:var(--mute)}
.tile .cd{font-family:ui-monospace,monospace;font-weight:800;font-size:16px}
.tile.over{background:var(--dangbg);border-color:#F3C5C1}
.tile.over .num{background:var(--dang)}
.tile.over .cd{color:var(--dang)}
.tile.ok .cd{color:var(--ok)}
.tile.soon .cd{color:var(--warn)}
.tile.wait{background:#FBFAF7}
.tile.wait .num{background:#8A857A}
.tile.wait .cd{color:var(--mute);font-size:11px;font-family:Kanit,sans-serif;font-weight:600}

/* หลังบ้าน */
.web{width:672px;background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden}
.web .wbar{background:#FBFAF7;border-bottom:1px solid var(--line);padding:11px 14px;
           font-size:14px;font-weight:700;display:flex;gap:9px;align-items:center;flex-wrap:wrap}
.web .wbar .chip{font-size:11.5px;padding:5px 10px;font-weight:500}
.wpad{padding:13px 14px}
table{width:100%;border-collapse:collapse;font-size:11.5px}
th{text-align:left;color:var(--mute);font-weight:600;padding:8px 10px;border-bottom:1px solid var(--line);font-size:10.5px}
td{padding:8px 10px;border-bottom:1px solid #F1EFE9;vertical-align:top}
tr:last-child td{border-bottom:0}
.pill{display:inline-block;border-radius:999px;padding:2px 8px;font-size:10px;font-weight:600}
.p-ok{background:var(--okbg);color:var(--ok)}
.p-over{background:var(--dangbg);color:var(--dang)}
.p-ban{background:#2B2B2B;color:#FFD9D6}
.p-mute{background:#F0EEE8;color:#55514A}
.mono{font-family:ui-monospace,monospace;font-weight:700}
.lk{color:#1A5FB4;text-decoration:underline;font-size:10.5px}
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
  // QR เก็บรหัสบัตรตรง ๆ ไม่ใช่ความลับ · สั้นแบบนี้ได้ตาราง 25×25 สแกนง่ายมาก
  const qr = await QRCode.toDataURL('OUT4-01', {
    width: 300,
    margin: 0,
    errorCorrectionLevel: 'Q',
  })

  // ═══════════════ แผ่น A · หน้างาน ═══════════════
  const a = `
  <div>
    <p class="cap">① ตัวบัตร — ไม่มีชื่อ ไม่มีรูป</p>
    <p class="sub">QR เก็บแค่รหัสบัตร ไม่ใช่ความลับ · ปลอมมาก็ไปจบที่ด่านเดียวกัน · รหัสสั้น QR จึงเล็กและสแกนติดง่ายแม้แสงน้อย</p>
    <div class="card">
      <span class="top"></span>
      <span class="hub">21BPL</span>
      <div class="no">OUT4-01</div>
      <div class="cap2">บัตรเบรค</div>
      <div class="qr"><img src="${qr}"></div>
      <div class="foot">ใบนี้ไม่ใช่สิทธิ์<br>สิทธิ์อยู่ที่ระบบ</div>
    </div>
  </div>

  <div>
    <p class="cap">② หัวหน้างาน — จิ้มเลือก ไม่ต้องเปิดกล้อง</p>
    <p class="sub">เห็นเฉพาะบัตรของแผนกตัวเอง · เลือกกี่ใบก็ได้ กดนาทีครั้งเดียว · ข้างในแยกเป็นใบ ๆ เพราะคนกลับไม่พร้อมกัน</p>
    <div class="phone">
      <div class="bar">ปล่อยเบรค <span class="dot">OUT4</span></div>
      <div class="body">
        <div class="lbl">บัตรของแผนกคุณ · <b>เลือกไว้ 2 ใบ</b></div>
        <div class="pick">
          <div class="pk on">OUT4-01<small>ว่าง</small></div>
          <div class="pk on">OUT4-02<small>ว่าง</small></div>
          <div class="pk off">OUT4-03<small>กำลังออกไป</small></div>
          <div class="pk">OUT4-04<small>ว่าง</small></div>
          <div class="pk">OUT4-05<small>ว่าง</small></div>
        </div>

        <div class="lbl">เพราะอะไร</div>
        <div class="chips">
          <span class="chip">เข้าห้องน้ำ</span><span class="chip on">เบรคย่อย</span>
          <span class="chip">ฉุกเฉิน</span>
        </div>

        <div class="lbl">ไปกลับรวมกี่นาที · <b>ค่าเริ่มต้น 10</b></div>
        <div class="chips">
          <span class="chip">5</span><span class="chip">6</span><span class="chip">8</span>
          <span class="chip on">10</span><span class="chip">15</span><span class="chip add">พิมพ์เอง</span>
        </div>

        <div class="note n-mute">เพดานแผนกนี้ 3 ใบพร้อมกัน · ตอนนี้ออกไป 1 เลือกได้อีก 2</div>

        <button class="go">ยื่น 2 ใบ · เริ่มจับเวลา</button>
      </div>
    </div>
  </div>

  <div>
    <p class="cap">③ รปภ สแกน — 🟢 ขาออกปกติ</p>
    <p class="sub s">สแกนแล้วยังไม่เปลี่ยนอะไร แค่เปิดจอให้ดู · มีปุ่มเดียวเสมอ ไม่เคยมีสองปุ่มให้เลือก</p>
    <div class="phone">
      <div class="bar">สแกนบัตร</div>
      <div class="body">
        <div class="res r-ok">
          <div class="code">OUT4-01</div>
          <div class="st">🟢 ปล่อยออกได้</div>
          <div class="de">เบรคย่อย · เหลือ 8:30<br>ยื่นโดย สิโรธร เมื่อ 04:12</div>
        </div>
        <button class="go green">ปล่อยออก</button>
        <button class="go ghost">คนนี้กลับมาแล้ว · ปิดใบเลย</button>
        <div class="note n-mute">บรรทัดล่างไว้ใช้ตอน รปภ พลาดไม่ได้สแกนขาออก จะติดป้ายไว้ในประวัติ ไม่บล็อกไม่ให้คนเข้า</div>
      </div>
    </div>
  </div>

  <div>
    <p class="cap">④ รปภ สแกน — 🟡 ใบนี้ออกไปแล้ว</p>
    <p class="sub s">จอเดียวใช้สองเรื่อง — ถ้าคนกำลังกลับ กดรับกลับ · ถ้าคนกำลังจะออก แปลว่าบัตรซ้ำ ไม่ต้องกดอะไรเลย</p>
    <div class="phone">
      <div class="bar">สแกนบัตร</div>
      <div class="body">
        <div class="res r-am">
          <div class="code">OUT4-01</div>
          <div class="st">🟡 ออกไปตั้งแต่ 04:14</div>
          <div class="de">ใช้ไป 6:20 / ขอ 10<br>ยื่นโดย สิโรธร</div>
        </div>
        <button class="go amber">รับกลับ · หยุดเวลา</button>
        <div class="note n-dang">ถ้าคนนี้กำลังจะออก = บัตรซ้ำ <b>ไม่ปล่อย</b> และไม่ต้องกดปุ่มบน</div>
        <button class="go ghost">แจ้งบัตรซ้ำ (เก็บเป็นหลักฐาน)</button>
      </div>
    </div>
  </div>

  <div>
    <p class="cap">⑤ รปภ สแกน — 🔴 ไม่ได้ถูกปล่อย</p>
    <p class="sub s">บัตรขโมย บัตรปลอม หรือหยิบมาเอง · ไม่มีปุ่มให้กดเลย</p>
    <div class="phone">
      <div class="bar">สแกนบัตร</div>
      <div class="body">
        <div class="res r-no">
          <div class="code">IN2-07</div>
          <div class="st">🔴 ไม่ได้รับอนุญาต</div>
          <div class="de">ไม่มีใครยื่นบัตรใบนี้<br>ไม่ต้องปล่อย</div>
        </div>
        <div class="note n-mute">กฎของ รปภ เหลือประโยคเดียว — <b>ขาออกต้องเห็นเขียว</b> เห็นสีอื่นไม่ปล่อย</div>
      </div>
    </div>
  </div>

  <div>
    <p class="cap">⑥ รปภ สแกน — 🔴 ปิดไปแล้ว</p>
    <p class="sub s">ใบที่รับกลับไปแล้ว ใครเอามาใช้ต่อไม่ได้ จนกว่าหัวหน้าจะปล่อยใหม่</p>
    <div class="phone">
      <div class="bar">สแกนบัตร</div>
      <div class="body">
        <div class="res r-no">
          <div class="code">OUT4-01</div>
          <div class="st">🔴 ปิดไปแล้วเมื่อ 04:25</div>
          <div class="de">รับกลับโดย สมชาย (รปภ)<br>ไม่ต้องปล่อย</div>
        </div>
        <div class="note n-mute">ถ้ากล้องไม่ติดหรือ QR เปื้อน — พิมพ์รหัสบัตรแทนได้ ผลเหมือนกันทุกอย่าง ระบบไม่มีทางล็อกตาย</div>
      </div>
    </div>
  </div>

  <div>
    <p class="cap">⑦ จอ "เบรค OS" — เขียนครั้งเดียว ใช้ 3 ที่</p>
    <p class="sub">หัวหน้าเห็นเฉพาะแผนกตัวเอง · รปภ เห็นทุกใบ · หลังบ้านเห็นทุกใบ แล้วมีประวัติต่อท้าย · นับถอยหลังสดในเครื่อง ไม่ยิงเซิร์ฟเวอร์</p>
    <div class="phone">
      <div class="bar">เบรค OS <span class="dot">3 ใบ</span></div>
      <div class="body">
        <div class="tile over">
          <div class="num">OUT4-03</div>
          <div class="mid"><b>เบรคย่อย</b><span>สิโรธร · ผ่านประตู 04:14</span></div>
          <div class="cd">+1:40</div>
        </div>
        <div class="tile soon">
          <div class="num">OUT4-01</div>
          <div class="mid"><b>เข้าห้องน้ำ</b><span>สิโรธร · ผ่านประตู 04:21</span></div>
          <div class="cd">0:48</div>
        </div>
        <div class="tile wait">
          <div class="num">IN2-02</div>
          <div class="mid"><b>ฉุกเฉิน</b><span>ปิยะนุช · ยื่น 04:22</span></div>
          <div class="cd">ยังไม่ถึงประตู</div>
        </div>
        <div class="note n-mute">ใบสีเทา = หัวหน้ายื่นบัตรแล้วแต่ยังไม่เดินมาถึง รปภ</div>
      </div>
    </div>
  </div>`

  // ═══════════════ แผ่น B · หลังบ้าน ═══════════════
  const b = `
  <div>
    <p class="cap">⑧ หลังบ้าน — ประวัติเบรค</p>
    <p class="sub w">ได้เวลาสามจุด <b>ยื่น → ผ่านประตู → กลับ</b> เวลาเดินจึงแยกออกจากเวลาอยู่ข้างนอก · เทียบข้ามแผนกได้แล้ว เพราะดูช่องขวาอย่างเดียว</p>
    <div class="web">
      <div class="wbar">ประวัติเบรค
        <span class="chip">1–31 ต.ค. 2026</span>
        <span class="chip">เฉพาะที่เกินเวลา</span>
        <span class="chip">เฉพาะช่วงห้าม</span>
        <span class="chip">บัตรซ้ำ</span>
      </div>
      <table>
        <thead><tr><th>บัตร</th><th>เหตุผล · ปล่อยโดย</th><th>ยื่น</th><th>ผ่านประตู</th><th>กลับ</th><th>เดิน</th><th>ข้างนอก</th><th>สถานะ</th></tr></thead>
        <tbody>
          <tr><td class="mono">OUT4-03</td><td>เบรคย่อย<br><span style="color:var(--mute)">สิโรธร 690196</span></td>
              <td>04:12</td><td>04:14</td><td>04:25</td><td>2:00</td><td><b>11:20</b></td>
              <td><span class="pill p-over">เกิน 3:20</span></td></tr>
          <tr><td class="mono">OUT4-01</td><td>เข้าห้องน้ำ<br><span style="color:var(--mute)">สิโรธร 690196</span></td>
              <td>04:19</td><td>04:21</td><td>04:24</td><td>2:10</td><td><b>3:02</b></td>
              <td><span class="pill p-ok">ตรงเวลา</span></td></tr>
          <tr><td class="mono">IN2-02</td><td>ฉุกเฉิน<br><span style="color:var(--mute)">ปิยะนุช 632550</span></td>
              <td>04:12</td><td>04:15</td><td>04:20</td><td>3:00</td><td><b>5:10</b></td>
              <td><span class="pill p-ban">ปล่อยในช่วงห้าม</span></td></tr>
          <tr><td class="mono">OUT4-05</td><td>เบรคย่อย<br><span style="color:var(--mute)">ณัฐพล 711204</span></td>
              <td>03:40</td><td><span style="color:var(--mute)">—</span></td><td>03:52</td><td><span style="color:var(--mute)">—</span></td><td><b>12:00</b></td>
              <td><span class="pill p-mute">ไม่ได้สแกนขาออก</span></td></tr>
          <tr><td class="mono">OUT4-02</td><td>เบรคย่อย<br><span style="color:var(--mute)">ณัฐพล 711204</span></td>
              <td>02:40</td><td>02:43</td><td><span style="color:var(--mute)">ปิดอัตโนมัติ</span></td><td>3:00</td><td><b>—</b></td>
              <td><span class="pill p-over">ไม่ได้รับกลับ</span></td></tr>
          <tr><td class="mono">OUT4-03</td><td><span style="color:var(--dang)">พยายามใช้บัตรซ้ำ</span><br><span style="color:var(--mute)">สมชาย (รปภ) แจ้ง</span></td>
              <td><span style="color:var(--mute)">—</span></td><td>04:17</td><td><span style="color:var(--mute)">—</span></td><td><span style="color:var(--mute)">—</span></td><td><b>—</b></td>
              <td><span class="pill p-ban">บัตรซ้ำ</span></td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <div>
    <p class="cap">⑨ หลังบ้าน — ส่งเข้าชีต แล้วล้างของเก่า</p>
    <p class="sub w">ปุ่มเดียวกับกระสอบ · ลบเฉพาะใบที่ <b>ปิดแล้ว + ชีตยืนยันรับแล้ว + เก่ากว่า 3 เดือน</b> ครบสามข้อถึงลบ</p>
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
          <div class="g">เก็บไว้ในเว็บ 3 เดือนล่าสุด<span>28,400 แถว · กรองดูได้ทันทีไม่ต้องเปิดชีต</span></div>
          <button class="btn">เปิดชีต</button>
        </div>
        <div class="note n-mute">ลบแล้วพื้นที่ไม่คืนทันที Postgres เอาไปใช้ซ้ำเอง ตารางจะนิ่งไม่โตต่อ</div>
        <div style="margin-top:12px;font-size:11.5px;color:var(--mute)">ฐานข้อมูล 38 MB / 500 MB</div>
        <div class="meter"><i></i></div>
      </div>
    </div>
  </div>

  <div>
    <p class="cap">⑩ หลังบ้าน — ตั้งค่า (เฉพาะเจ้าของระบบ)</p>
    <p class="sub w">ทุกอย่างตั้งจากที่นี่ที่เดียว ไม่ต้องแก้โค้ด · บัตรไม่มี QR ลับ จะพิมพ์เพิ่มเองที่ไหนก็ได้</p>
    <div class="web">
      <div class="wbar">ตั้งค่าบัตรเบรค</div>
      <div class="wpad">
        <p class="h3">บัตร · รหัสพิมพ์อิสระ ตัวอักษรหรือตัวเลขก็ได้</p>
        <div class="ln"><div class="g"><span class="mono">OUT4-01 · OUT4-02 · OUT4-03 · OUT4-04 · OUT4-05</span><span>แผนก OUT4 · เพดานพร้อมกัน 3 ใบ</span></div><button class="btn">แก้</button></div>
        <div class="ln"><div class="g"><span class="mono">IN2-01 · IN2-02 · IN2-03</span><span>แผนก IN2 · เพดานพร้อมกัน 2 ใบ</span></div><button class="btn">แก้</button></div>
        <div class="ln"><div class="g" style="color:var(--mute)">+ เพิ่มบัตร / เพิ่มแผนก</div><button class="btn">พิมพ์ชุดบัตร</button></div>

        <p class="h3">ช่วงห้ามเบรค</p>
        <div class="ln"><div class="g">ทุกวัน 04:00 – 04:30<span>ช่วงรถเข้า</span></div><button class="btn">แก้</button></div>
        <div class="ln"><div class="g" style="color:var(--mute)">+ เพิ่มช่วงห้าม</div></div>

        <p class="h3">นาทีเริ่มต้นของแต่ละเหตุผล (ไปกลับรวม)</p>
        <div class="ln"><div class="g">เข้าห้องน้ำ<span>เผื่อเวลาเดินแล้ว</span></div><span class="chip on">6 นาที</span><button class="btn">แก้</button></div>
        <div class="ln"><div class="g">เบรคย่อย</div><span class="chip on">10 นาที</span><button class="btn">แก้</button></div>
        <div class="ln"><div class="g">ฉุกเฉิน</div><span class="chip on">15 นาที</span><button class="btn">แก้</button></div>

        <p class="h3">ใครได้แจ้งเตือนเมื่อปล่อยในช่วงห้าม <span style="font-weight:400;color:var(--mute)">· ยังไม่เลือก</span></p>
        <div class="chips" style="margin-bottom:4px"><span class="chip add">+ เลือกคน</span></div>

        <p class="h3">สิทธิ์ — ไปตั้งที่หน้า "สิทธิ์เข้าถึง" เดิม</p>
        <div class="chips" style="margin-bottom:4px">
          <span class="chip on">ปล่อยบัตรได้ · 5 คน</span><span class="chip on">รปภ สแกนได้ · 3 คน</span>
        </div>
        <div class="note n-mute">ปิดสิทธิ์ที่ฐานข้อมูล ไม่ใช่แค่ซ่อนปุ่ม · พนักงานทั่วไปมองไม่เห็นเมนูนี้และเรียกข้อมูลตรง ๆ ก็ไม่ได้</div>
      </div>
    </div>
  </div>`

  fs.writeFileSync('public/__brk4-a.html', page('บัตรเบรค 4 · หน้างาน', a))
  fs.writeFileSync('public/__brk4-b.html', page('บัตรเบรค 4 · หลังบ้าน', b))
  console.log('ok: /__brk4-a.html  /__brk4-b.html')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
