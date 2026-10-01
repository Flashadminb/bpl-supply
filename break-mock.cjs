/**
 * หน้าตัวอย่างระบบบัตรเบรค — ไว้คุยกันก่อนตัดสินใจทำ ไม่ได้อยู่ในแอป
 * เลือกแบบแล้วลบไฟล์นี้ทิ้งได้เลย
 *
 *   node break-mock.cjs    แล้วเปิด /__break-mock.html บน dev server
 */
const fs = require('fs')
const sharp = require('sharp')

const SRC =
  'C:/Users/Flash/AppData/Local/Temp/claude/C--Users-Flash-Desktop-Best---------------------/607683b5-890b-45a9-a9d2-3e7bfcb164f0/scratchpad/oscards/1.png'
const SRC2 =
  'C:/Users/Flash/AppData/Local/Temp/claude/C--Users-Flash-Desktop-Best---------------------/607683b5-890b-45a9-a9d2-3e7bfcb164f0/scratchpad/oscards/5.png'

async function face(src) {
  const buf = await sharp(src)
    .extract({ left: 200, top: 195, width: 190, height: 190 })
    .resize(190, 190)
    .png()
    .toBuffer()
  return 'data:image/png;base64,' + buf.toString('base64')
}

async function main() {
  const f1 = await face(SRC)
  const f2 = await face(SRC2)

  const css = `
  :root{--y:#F5B301;--ink:#141210;--line:#E6E2D8;--mute:#8A857A;
        --ok:#1C7C45;--okbg:#E7F5EC;--warn:#A05A00;--warnbg:#FFF3DF;
        --dang:#B3261E;--dangbg:#FDECEA;}
  *{box-sizing:border-box}
  body{margin:0;padding:22px;background:#F2F1ED;font-family:Kanit,system-ui,sans-serif;color:var(--ink)}
  .row{display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap}
  .cap{font-size:13px;font-weight:700;margin:0 0 6px}
  .sub{font-size:11px;color:#666;margin:0 0 8px;line-height:1.5;max-width:330px;min-height:34px}
  .phone{width:330px;background:#FBFAF7;border:1px solid var(--line);border-radius:18px;
         overflow:hidden;box-shadow:0 2px 14px #0001}
  .bar{background:var(--ink);color:#fff;padding:11px 14px;font-size:14px;font-weight:600;
       display:flex;align-items:center;gap:8px}
  .bar .dot{margin-left:auto;background:var(--y);color:var(--ink);border-radius:999px;
            padding:1px 8px;font-size:11px;font-weight:700}
  .body{padding:14px}
  .lbl{font-size:11px;color:var(--mute);margin:12px 0 5px;font-weight:600}
  .lbl:first-child{margin-top:0}
  .chips{display:flex;flex-wrap:wrap;gap:6px}
  .chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:7px 13px;
        font-size:13px;line-height:1}
  .chip.on{background:var(--ink);color:#fff;border-color:var(--ink);font-weight:600}
  .chip.add{border-style:dashed;color:var(--mute)}
  .who{display:flex;align-items:center;gap:9px;border:1px solid var(--line);background:#fff;
       border-radius:12px;padding:7px 9px;margin-bottom:6px}
  .who.on{border-color:var(--ink);background:#FFFBEF}
  .who img{width:38px;height:38px;border-radius:9px;object-fit:cover;background:#ddd}
  .who b{font-size:13px;display:block;line-height:1.25}
  .who span{font-size:11px;color:var(--mute)}
  .tick{margin-left:auto;width:22px;height:22px;border-radius:7px;border:1px solid var(--line);
        display:flex;align-items:center;justify-content:center;font-size:12px;color:transparent}
  .tick.on{background:var(--ink);border-color:var(--ink);color:#fff}
  .go{margin-top:14px;background:var(--y);color:var(--ink);border:0;border-radius:12px;
      width:100%;padding:14px;font-size:15px;font-weight:700;font-family:inherit}
  .big{text-align:center;padding:16px 12px}
  .big img{width:112px;height:112px;border-radius:14px;object-fit:cover;background:#ddd}
  .big h2{margin:9px 0 1px;font-size:19px}
  .big .code{font-family:ui-monospace,monospace;font-size:12px;color:var(--mute)}
  .state{margin:12px 0;border-radius:14px;padding:13px}
  .state .t{font-size:12px;font-weight:600;opacity:.85}
  .state .n{font-size:36px;font-weight:800;line-height:1.1;margin:2px 0}
  .state .m{font-size:12px}
  .s-ok{background:var(--okbg);color:var(--ok)}
  .s-dang{background:var(--dangbg);color:var(--dang)}
  .s-warn{background:var(--warnbg);color:var(--warn)}
  .acts{display:flex;gap:8px}
  .acts button{flex:1;border:0;border-radius:12px;padding:14px 8px;font-size:14px;
               font-weight:700;font-family:inherit}
  .b-dark{background:var(--ink);color:#fff}
  .b-soft{background:#EDEAE2;color:var(--ink)}
  .info{border-top:1px solid var(--line);margin-top:13px;padding-top:11px;font-size:12px;color:#555}
  .info b{color:var(--ink)}
  .list{font-size:12px}
  .list li{display:flex;align-items:center;gap:9px;padding:8px 0;border-bottom:1px solid #EFEDE6}
  .list li:last-child{border:0}
  .list img{width:32px;height:32px;border-radius:8px;object-fit:cover;background:#ddd}
  .list .nm{flex:1;min-width:0}
  .list .nm b{display:block;font-size:12.5px}
  .list .nm span{color:var(--mute);font-size:11px}
  .cd{font-family:ui-monospace,monospace;font-weight:700;font-size:14px}
  ul{list-style:none;margin:0;padding:0}
  `

  const html = `<!doctype html><meta charset="utf-8"><title>ตัวอย่างบัตรเบรค</title><style>${css}</style>
<div class="row">

  <div>
    <p class="cap">① หัวหน้างาน — ปล่อยเบรค</p>
    <p class="sub">เลือกได้ทีละหลายคน · เวลาและเหตุผลใช้ร่วมกันทั้งกลุ่ม แต่ระบบแยกใบให้คนละใบ เพราะกลับไม่พร้อมกัน</p>
    <div class="phone">
      <div class="bar">← ปล่อยเบรค <span class="dot">กะดึก</span></div>
      <div class="body">
        <div class="lbl">ใครไปบ้าง · เลือกแล้ว 2 คน</div>
        <div class="who on"><img src="${f1}"><span><b>Zaw Mg San</b><span>4821930 · PW</span></span><span class="tick on">✓</span></div>
        <div class="who on"><img src="${f2}"><span><b>AUNG KO LIN</b><span>4348801 · AK</span></span><span class="tick on">✓</span></div>
        <div class="who"><img src="${f1}"><span><b>Hein Thu</b><span>8026557 · PW</span></span><span class="tick">✓</span></div>

        <div class="lbl">เพราะอะไร</div>
        <div class="chips">
          <span class="chip on">เข้าห้องน้ำ</span><span class="chip">พักเบรค</span>
          <span class="chip">กินข้าว</span><span class="chip add">+ เพิ่ม</span>
        </div>

        <div class="lbl">กี่นาที</div>
        <div class="chips">
          <span class="chip">2</span><span class="chip">3</span><span class="chip">5</span>
          <span class="chip">6</span><span class="chip">8</span><span class="chip on">10</span>
          <span class="chip">15</span><span class="chip">20</span><span class="chip add">พิมพ์เอง</span>
        </div>

        <div class="lbl">รูป · ไม่บังคับ</div>
        <div class="chips"><span class="chip add">📷 ถ่ายรูปกลุ่มที่ไป</span></div>

        <button class="go">ปล่อยเบรค 2 คน · 10 นาที</button>
      </div>
    </div>
  </div>

  <div>
    <p class="cap">② รปภ — สแกนบัตรใบเดิม</p>
    <p class="sub">บัตรคล้องคอใบเดิมที่ใช้เช็กมือถืออยู่แล้ว ไม่ต้องทำบัตรใหม่ · สแกนครั้งเดียวเห็นครบทั้งเบรคและมือถือ</p>
    <div class="phone">
      <div class="bar">สแกนบัตร OS <span class="dot">ออกไปเบรค</span></div>
      <div class="big">
        <img src="${f1}">
        <h2>Zaw Mg San</h2>
        <div class="code">4821930 · PW · กะดึก</div>
        <div class="state s-ok">
          <div class="t">หัวหน้างานอนุญาตแล้ว</div>
          <div class="n">10 นาที</div>
          <div class="m">เข้าห้องน้ำ · อนุมัติโดย สิโรธร 04:12 · ไปพร้อม AUNG KO LIN</div>
        </div>
        <div class="acts">
          <button class="b-dark">ปล่อยออกไป · เริ่มจับเวลา</button>
        </div>
        <div class="info">
          มือถือ <b>REDMI NOTE 13</b><br>IMEI 869726074524281
        </div>
      </div>
    </div>
  </div>

  <div>
    <p class="cap">③ รปภ — ตอนกลับเข้ามา</p>
    <p class="sub">สแกนใบเดิมอีกครั้ง ระบบรู้เองว่าเป็นขากลับ ไม่ต้องเลือกโหมด · เลยเวลาขึ้นแดงให้เห็นแต่ไกล</p>
    <div class="phone">
      <div class="bar">สแกนบัตร OS <span class="dot">กลับเข้ามา</span></div>
      <div class="big">
        <img src="${f2}">
        <h2>AUNG KO LIN</h2>
        <div class="code">4348801 · AK · กะดึก</div>
        <div class="state s-dang">
          <div class="t">เลยเวลาที่ขอไว้</div>
          <div class="n">+3:20</div>
          <div class="m">ขอไว้ 10 นาที · ออกไป 04:12 · ตอนนี้ 04:25</div>
        </div>
        <div class="acts">
          <button class="b-dark">รับกลับเข้า · หยุดเวลา</button>
        </div>
        <div class="info">
          มือถือ <b>SAMSUNG GALAXY A20S</b><br>IMEI 352233119375526
        </div>
      </div>
    </div>
  </div>

  <div>
    <p class="cap">④ กระดานคนที่ออกไป</p>
    <p class="sub">หัวหน้างานกับ รปภ เปิดดูได้ตลอด · ใครยังไม่กลับ เหลือกี่นาที เลยไปเท่าไหร่</p>
    <div class="phone">
      <div class="bar">ออกไปอยู่ตอนนี้ <span class="dot">3 คน</span></div>
      <div class="body">
        <ul class="list">
          <li><img src="${f1}"><span class="nm"><b>Zaw Mg San</b><span>เข้าห้องน้ำ · ขอ 10 นาที</span></span><span class="cd" style="color:var(--ok)">6:12</span></li>
          <li><img src="${f2}"><span class="nm"><b>AUNG KO LIN</b><span>เข้าห้องน้ำ · ขอ 10 นาที</span></span><span class="cd" style="color:var(--dang)">+3:20</span></li>
          <li><img src="${f1}"><span class="nm"><b>Hein Thu</b><span>พักเบรค · ขอ 20 นาที</span></span><span class="cd" style="color:var(--warn)">1:05</span></li>
        </ul>
        <div class="info" style="margin-top:4px">
          ใบที่ค้างข้ามกะ ระบบปิดให้เองตอนจบกะ และติดป้ายว่า <b>ไม่ได้สแกนกลับ</b><br>
          ไม่ได้นับเป็นสายอัตโนมัติ ต้องมีคนกดยืนยันก่อน
        </div>
      </div>
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
