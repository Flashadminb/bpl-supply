/**
 * หน้าตัวอย่างระบบบัตรเบรค รอบห้า — เฉพาะจอที่เปลี่ยนจากรอบสี่
 *
 * เจ้าของระบบเคาะเพิ่มสองข้อ
 *   · 1 ใบใช้ได้หลายคน สูงสุด 5 คน  →  รปภ ต้องเห็นจำนวน และรับกลับทีละส่วนได้
 *   · หัวหน้างานบังคับถ่ายรูปทุกครั้ง กี่รูปก็ได้ ปั๊มเวลาเหมือนเดิม
 *     รูปไม่ส่งให้ รปภ เห็น ขึ้นหลังบ้านอย่างเดียว เก็บใน Drive คนละโฟลเดอร์กับหลักฐานซัพพลาย
 *
 * ช่องโหว่ใหม่ที่มากับการใช้หลายคนต่อใบ และวิธีปิด
 *   ใบที่ยังกลับไม่ครบจะค้างเปิดอยู่ ถ้าไม่กันไว้ คนอื่นเดินออกตามโควตาที่เหลือได้
 *   จึงล็อกว่า "ใบไหนเริ่มรับกลับแล้ว ออกเพิ่มไม่ได้อีก" (จอ ④)
 *
 *   node break-mock5.cjs   แล้วเปิด /__brk5.html บน dev server
 */
const fs = require('fs')

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
.lbl b{color:var(--ink)}
.chips{display:flex;flex-wrap:wrap;gap:5px}
.chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:6px 12px;font-size:12.5px;line-height:1}
.chip.on{background:var(--ink);color:#fff;border-color:var(--ink);font-weight:600}
.chip.add{border-style:dashed;color:var(--mute)}
.chip.big{padding:9px 16px;font-size:15px;font-weight:700}
.chip.big.on{background:var(--ok);border-color:var(--ok)}
.go{margin-top:12px;background:var(--y);color:var(--ink);border:0;border-radius:11px;
    width:100%;padding:13px;font-size:14.5px;font-weight:700;font-family:inherit}
.go.green{background:var(--ok);color:#fff}
.go.amber{background:var(--warn);color:#fff}
.go.off{background:#EDEBE4;color:#A9A396}
.go.ghost{background:#fff;border:1px solid var(--line);color:var(--mute);font-size:12px;padding:9px;margin-top:7px;font-weight:600}
.note{border-radius:10px;padding:9px 11px;font-size:11.5px;line-height:1.45;margin-top:10px}
.n-warn{background:var(--warnbg);color:var(--warn)}
.n-dang{background:var(--dangbg);color:var(--dang)}
.n-ok{background:var(--okbg);color:var(--ok)}
.n-mute{background:#F0EEE8;color:#55514A}
.res{border-radius:13px;padding:15px 13px;text-align:center;border:2px solid}
.res .code{font-family:ui-monospace,monospace;font-size:27px;font-weight:800;letter-spacing:-.5px}
.res .st{font-size:15px;font-weight:700;margin-top:7px}
.res .de{font-size:11.5px;margin-top:4px;line-height:1.5}
.res .ppl{display:inline-block;margin-top:8px;border-radius:999px;padding:3px 14px;
          font-size:15px;font-weight:800;background:#fff;border:1px solid currentColor}
.r-ok{background:var(--okbg);border-color:#A8D8BC}
.r-ok .st,.r-ok .ppl{color:var(--ok)} .r-ok .de{color:#2F6B49}
.r-am{background:var(--warnbg);border-color:#EBC890}
.r-am .st,.r-am .ppl{color:var(--warn)} .r-am .de{color:#7A4700}
.r-no{background:var(--dangbg);border-color:#F0B6B1}
.r-no .st,.r-no .ppl{color:var(--dang)} .r-no .de{color:#8C2A24}
.pick{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.pk{border:1px solid var(--line);background:#fff;border-radius:10px;padding:8px 9px;
    font-family:ui-monospace,monospace;font-size:13px;font-weight:700}
.pk small{display:block;font-family:Kanit,sans-serif;font-size:10px;font-weight:400;color:var(--mute);margin-top:2px}
.pk.on{background:var(--ink);color:#fff;border-color:var(--ink)}
.pk.on small{color:#D8D3C7}
.pk.off{opacity:.45}
.shots{display:flex;gap:6px}
.shot{flex:1;aspect-ratio:3/4;border-radius:9px;background:#D8D3C7;position:relative;overflow:hidden;
      display:flex;align-items:flex-end;padding:5px}
.shot i{font-style:normal;font-size:7.5px;background:rgba(0,0,0,.6);color:#fff;border-radius:3px;
        padding:2px 4px;line-height:1.25}
.shot.add{background:#fff;border:2px dashed var(--line);align-items:center;justify-content:center;
          color:var(--mute);font-size:21px}
.tile{display:flex;align-items:center;gap:10px;border-radius:12px;padding:10px 11px;margin-bottom:7px;border:1px solid var(--line);background:#fff}
.tile .num{min-width:62px;height:42px;padding:0 6px;border-radius:10px;background:var(--ink);color:#fff;
           display:flex;align-items:center;justify-content:center;font-family:ui-monospace,monospace;
           font-size:13px;font-weight:800;flex:0 0 auto}
.tile .mid{flex:1;min-width:0}
.tile .mid b{display:block;font-size:12.5px;line-height:1.35}
.tile .mid span{font-size:10.5px;color:var(--mute)}
.tile .cd{font-family:ui-monospace,monospace;font-weight:800;font-size:16px;text-align:right}
.tile .cd em{display:block;font-style:normal;font-family:Kanit,sans-serif;font-size:10px;font-weight:600}
.tile.over{background:var(--dangbg);border-color:#F3C5C1}
.tile.over .num{background:var(--dang)} .tile.over .cd{color:var(--dang)}
.tile.ok .cd{color:var(--ok)}
.tile.soon .cd{color:var(--warn)}
.tile.wait{background:#FBFAF7}
.tile.wait .num{background:#8A857A}
.tile.wait .cd{color:var(--mute);font-size:11px;font-family:Kanit,sans-serif;font-weight:600}
`

const html = `<!doctype html><meta charset="utf-8"><title>บัตรเบรค 5 · หลายคนต่อใบ</title><style>${css}</style>
<div class="row">

  <div>
    <p class="cap">① หัวหน้างาน — เลือกจำนวนคน + บังคับถ่ายรูป</p>
    <p class="sub">จำนวนคนเป็นของใบนั้น สูงสุด 5 · ถ่ายรูปก่อนถึงจะกดยื่นได้ กี่รูปก็ได้ ปั๊มเวลาเหมือนทุกที่ในแอป</p>
    <div class="phone">
      <div class="bar">ปล่อยเบรค <span class="dot">OUT4</span></div>
      <div class="body">
        <div class="lbl">บัตรของแผนกคุณ · <b>เลือก OUT4-01</b></div>
        <div class="pick">
          <div class="pk on">OUT4-01<small>ว่าง</small></div>
          <div class="pk">OUT4-02<small>ว่าง</small></div>
          <div class="pk off">OUT4-03<small>กำลังออกไป</small></div>
          <div class="pk">OUT4-04<small>ว่าง</small></div>
        </div>

        <div class="lbl">ใบนี้กี่คน · <b>สูงสุด 5</b></div>
        <div class="chips">
          <span class="chip big">1</span><span class="chip big">2</span>
          <span class="chip big on">3</span><span class="chip big">4</span><span class="chip big">5</span>
        </div>

        <div class="lbl">เหตุผล · นาที</div>
        <div class="chips">
          <span class="chip on">เบรคย่อย</span><span class="chip">เข้าห้องน้ำ</span>
          <span class="chip">ฉุกเฉิน</span><span class="chip on">10 นาที</span>
        </div>

        <div class="lbl">รูป <b>(บังคับ)</b> · ถ่ายหรืออัปโหลดก็ได้</div>
        <div class="shots">
          <div class="shot"><i>ธนวัฒน์ 751810<br>21BPL · 04:12</i></div>
          <div class="shot"><i>ธนวัฒน์ 751810<br>21BPL · 04:12</i></div>
          <div class="shot add">+</div>
        </div>

        <button class="go">ยื่น OUT4-01 · 3 คน · เริ่มจับเวลา</button>
        <div class="note n-mute">รูปขึ้น Drive เบื้องหลัง ถ้าเน็ตช้าไม่ต้องรอ กดยื่นได้เลย เดี๋ยวตามขึ้นให้เอง<br><b>รปภ ไม่เห็นรูป</b> ขึ้นเฉพาะหลังบ้าน</div>
      </div>
    </div>
  </div>

  <div>
    <p class="cap">② รปภ สแกน — 🟢 ขาออก เห็นจำนวนทันที</p>
    <p class="sub">ตัวเลขคนตัวใหญ่กลางจอ · ปุ่มตั้งค่ามาเต็มจำนวนไว้แล้ว ถ้ามาไม่ครบค่อยกดลด ปกติแตะปุ่มเดียวจบ</p>
    <div class="phone">
      <div class="bar">สแกนบัตร</div>
      <div class="body">
        <div class="res r-ok">
          <div class="code">OUT4-01</div>
          <div class="st">🟢 ปล่อยออกได้</div>
          <div class="ppl">3 คน</div>
          <div class="de">เบรคย่อย · เหลือ 8:30<br>ยื่นโดย สิโรธร เมื่อ 04:12</div>
        </div>
        <div class="lbl">ออกไปจริงกี่คน</div>
        <div class="chips">
          <span class="chip big">1</span><span class="chip big">2</span><span class="chip big on">3</span>
        </div>
        <button class="go green">ปล่อยออก 3 คน</button>
        <button class="go ghost">คนนี้กลับมาแล้ว · ปิดใบเลย</button>
      </div>
    </div>
  </div>

  <div>
    <p class="cap">③ รปภ สแกน — 🟡 รับกลับทีละส่วนได้</p>
    <p class="sub">กลับไม่พร้อมกันก็รับทีละคน · ใบจะค้างอยู่บนจอจนครบ แล้วปิดเอง</p>
    <div class="phone">
      <div class="bar">สแกนบัตร</div>
      <div class="body">
        <div class="res r-am">
          <div class="code">OUT4-01</div>
          <div class="st">🟡 ออกไปตั้งแต่ 04:14</div>
          <div class="ppl">ยังไม่กลับ 2 จาก 3</div>
          <div class="de">ใช้ไป 6:20 / ขอ 10 · กลับแล้ว 1 คน เมื่อ 04:18</div>
        </div>
        <div class="lbl">กลับมากี่คน</div>
        <div class="chips">
          <span class="chip big">1</span><span class="chip big on">2</span>
        </div>
        <button class="go amber">รับกลับ 2 คน · ปิดใบ</button>
        <div class="note n-dang">ถ้าคนนี้กำลังจะออก = บัตรซ้ำ <b>ไม่ปล่อย</b> ไม่ต้องกดอะไร</div>
      </div>
    </div>
  </div>

  <div>
    <p class="cap">④ สถานะใหม่ 🔴 — ปิดช่องโหว่โควตาลอย</p>
    <p class="sub">ใบที่เริ่มรับกลับแล้ว จะออกเพิ่มไม่ได้อีก กันคนอื่นเดินออกตามจำนวนที่ยังเหลือ</p>
    <div class="phone">
      <div class="bar">สแกนบัตร</div>
      <div class="body">
        <div class="res r-no">
          <div class="code">OUT4-01</div>
          <div class="st">🔴 ใบนี้เริ่มรับกลับแล้ว</div>
          <div class="ppl">ออกเพิ่มไม่ได้</div>
          <div class="de">รับกลับคนแรกเมื่อ 04:18<br>ไม่ต้องปล่อย</div>
        </div>
        <div class="note n-mute">ถ้าไม่มีด่านนี้ ใบที่ยังกลับไม่ครบจะกลายเป็นโควตาลอย ใครหยิบไปก็เดินออกได้</div>
      </div>
    </div>
  </div>

  <div>
    <p class="cap">⑤ จอ "เบรค OS" — เห็นจำนวนคนทุกใบ</p>
    <p class="sub">หัวหน้าเห็นแผนกตัวเอง · รปภ เห็นทุกใบ · หลังบ้านเห็นทุกใบ · ตัวเลขคนอยู่บรรทัดเดียวกับเวลา</p>
    <div class="phone">
      <div class="bar">เบรค OS <span class="dot">3 ใบ · 7 คน</span></div>
      <div class="body">
        <div class="tile over">
          <div class="num">OUT4-03</div>
          <div class="mid"><b>เบรคย่อย</b><span>สิโรธร · ผ่านประตู 04:14</span></div>
          <div class="cd">+1:40<em>ยังไม่กลับ 2/3</em></div>
        </div>
        <div class="tile soon">
          <div class="num">OUT4-01</div>
          <div class="mid"><b>เข้าห้องน้ำ</b><span>สิโรธร · ผ่านประตู 04:21</span></div>
          <div class="cd">0:48<em>ยังไม่กลับ 1/1</em></div>
        </div>
        <div class="tile wait">
          <div class="num">IN2-02</div>
          <div class="mid"><b>ฉุกเฉิน</b><span>ปิยะนุช · ยื่น 04:22</span></div>
          <div class="cd">ยังไม่ถึงประตู<em>3 คน</em></div>
        </div>
        <div class="note n-mute">หัวบนบอกยอดรวมคน ไม่ใช่ยอดใบ — รปภ เหลือบดูครั้งเดียวรู้ว่าตอนนี้ข้างนอกมีกี่คน</div>
      </div>
    </div>
  </div>

</div>`

fs.writeFileSync('public/__brk5.html', html)
console.log('ok: /__brk5.html')
