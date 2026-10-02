/**
 * หน้าตัวอย่างระบบบัตรเบรค รอบหก — เฉพาะของใหม่ "รปภ แจ้งปัญหา"
 *
 * เจ้าของระบบเคาะเพิ่ม
 *   · ตัดปิดอัตโนมัติ 2 ชั่วโมงทิ้ง  ใบค้างให้หลังบ้านปิดเอง
 *   · รปภ รับกลับได้แม้คนไม่ครบ แต่ต้องกดแจ้งปัญหาพร้อมกัน
 *     เลือกจากดรอปดาวน์ว่าขาดไปกี่คน + บังคับถ่ายรูป 1 ใบ อัปให้เสร็จ
 *   · ส่งปุ๊บ เด้งเตือนผู้ตรวจสอบและคนที่เจ้าของเลือกไว้ทันที 0 วินาที
 *   · หลังบ้านเอารูปตอนปล่อยของหัวหน้า มาเทียบกับรูปตอนรับของ รปภ
 *     เห็นเองว่าใครหายไปจากกลุ่ม
 *
 *   node break-mock6.cjs   แล้วเปิด /__brk6.html บน dev server
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
.sub.w{max-width:672px;min-height:0}
.phone{width:320px;background:#FBFAF7;border:1px solid var(--line);border-radius:16px;
       overflow:hidden;box-shadow:0 2px 12px #0001}
.bar{background:var(--ink);color:#fff;padding:10px 13px;font-size:13.5px;font-weight:600;
     display:flex;align-items:center;gap:8px}
.bar.red{background:var(--dang)}
.body{padding:13px}
.lbl{font-size:11px;color:var(--mute);margin:11px 0 5px;font-weight:600}
.lbl:first-child{margin-top:0}
.lbl b{color:var(--ink)}
.go{margin-top:12px;background:var(--y);color:var(--ink);border:0;border-radius:11px;
    width:100%;padding:13px;font-size:14.5px;font-weight:700;font-family:inherit}
.go.amber{background:var(--warn);color:#fff}
.go.red{background:var(--dang);color:#fff}
.go.off{background:#EDEBE4;color:#A9A396}
.go.ghost{background:#fff;border:1.5px solid #F0B6B1;color:var(--dang);font-size:12.5px;padding:11px;margin-top:8px;font-weight:700}
.note{border-radius:10px;padding:9px 11px;font-size:11.5px;line-height:1.45;margin-top:10px}
.n-warn{background:var(--warnbg);color:var(--warn)}
.n-dang{background:var(--dangbg);color:var(--dang)}
.n-mute{background:#F0EEE8;color:#55514A}
.res{border-radius:13px;padding:15px 13px;text-align:center;border:2px solid}
.res .code{font-family:ui-monospace,monospace;font-size:27px;font-weight:800;letter-spacing:-.5px}
.res .st{font-size:15px;font-weight:700;margin-top:7px}
.res .de{font-size:11.5px;margin-top:4px;line-height:1.5}
.res .ppl{display:inline-block;margin-top:8px;border-radius:999px;padding:3px 14px;
          font-size:15px;font-weight:800;background:#fff;border:1px solid currentColor}
.r-am{background:var(--warnbg);border-color:#EBC890}
.r-am .st,.r-am .ppl{color:var(--warn)} .r-am .de{color:#7A4700}
.sel{border:1.5px solid var(--line);background:#fff;border-radius:10px;padding:11px 12px;
     font-size:14px;font-weight:600;display:flex;align-items:center}
.sel.on{border-color:var(--dang);color:var(--dang)}
.sel::after{content:'▾';margin-left:auto;color:var(--mute);font-weight:400}
.opts{border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-top:5px;background:#fff}
.opts div{padding:9px 12px;font-size:13px;border-bottom:1px solid #F1EFE9}
.opts div:last-child{border-bottom:0}
.opts div.on{background:var(--dangbg);color:var(--dang);font-weight:700}
.shots{display:flex;gap:6px}
.shot{flex:1;aspect-ratio:3/4;border-radius:9px;background:#D8D3C7;position:relative;overflow:hidden;
      display:flex;align-items:flex-end;padding:5px;max-width:92px}
.shot i{font-style:normal;font-size:7px;background:rgba(0,0,0,.6);color:#fff;border-radius:3px;
        padding:2px 4px;line-height:1.25}
.shot.add{background:#fff;border:2px dashed #F0B6B1;align-items:center;justify-content:center;
          color:var(--dang);font-size:21px}
.shot.up{background:#CFC9BB}
.shot.up i{background:rgba(0,0,0,.75)}

/* แจ้งเตือน */
.push{width:320px;background:#fff;border-radius:14px;padding:12px 13px;box-shadow:0 4px 18px #0002;
      border:1px solid var(--line)}
.push .ph{display:flex;align-items:center;gap:7px;font-size:10.5px;color:var(--mute);margin-bottom:5px}
.push .ph b{background:var(--ink);color:#fff;border-radius:5px;padding:1px 6px;font-size:9.5px}
.push .pt{font-size:14px;font-weight:700;color:var(--dang)}
.push .pb{font-size:12px;line-height:1.5;margin-top:3px}

/* หลังบ้าน */
.web{width:672px;background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden}
.web .wbar{background:#FBFAF7;border-bottom:1px solid var(--line);padding:11px 14px;
           font-size:14px;font-weight:700;display:flex;gap:9px;align-items:center;flex-wrap:wrap}
.chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:5px 10px;font-size:11.5px}
.chip.d{background:var(--dangbg);border-color:#F0B6B1;color:var(--dang);font-weight:700}
.wpad{padding:14px}
.cmp{display:flex;gap:14px;align-items:flex-start}
.cmp .side{flex:1}
.cmp .side h4{margin:0 0 6px;font-size:12px;font-weight:700}
.cmp .side h4 span{display:block;font-size:10.5px;font-weight:400;color:var(--mute);margin-top:1px}
.cmp .g{display:flex;gap:6px}
.cmp .g .shot{flex:0 0 88px;max-width:88px}
.cmp .vs{align-self:center;font-size:11px;color:var(--mute);font-weight:700;padding-top:26px}
.meta{margin-top:12px;border-top:1px solid #F1EFE9;padding-top:11px;font-size:12px;line-height:1.7}
.meta b{display:inline-block;min-width:96px;color:var(--mute);font-weight:600;font-size:11px}
.pill{display:inline-block;border-radius:999px;padding:2px 9px;font-size:10.5px;font-weight:600}
.p-ban{background:#2B2B2B;color:#FFD9D6}
.btn{background:#fff;border:1px solid var(--line);border-radius:9px;padding:7px 12px;
     font-size:11.5px;font-weight:600;font-family:inherit}
.btn.y{background:var(--y);border-color:var(--y)}
`

const html = `<!doctype html><meta charset="utf-8"><title>บัตรเบรค 6 · แจ้งปัญหา</title><style>${css}</style>
<div class="row">

  <div>
    <p class="cap">① จอรับกลับ — เพิ่มทางออกที่สอง</p>
    <p class="sub">ปุ่มบนคือกรณีปกติ ครบก็กดจบ · ปุ่มล่างสีแดงไว้ใช้ตอนคนไม่ครบ ไม่ต้องไปตามหาเมนูที่ไหน</p>
    <div class="phone">
      <div class="bar">สแกนบัตร</div>
      <div class="body">
        <div class="res r-am">
          <div class="code">OUT4-01</div>
          <div class="st">🟡 ออกไปตั้งแต่ 04:14</div>
          <div class="ppl">3 คน</div>
          <div class="de">เบรคย่อย · ใช้ไป 6:20 / ขอ 10<br>ยื่นโดย สิโรธร</div>
        </div>
        <button class="go amber">รับกลับครบ 3 คน · ปิดใบ</button>
        <button class="go ghost">รับ + แจ้งปัญหา (คนไม่ครบ)</button>
        <div class="note n-mute">ไม่มีปิดอัตโนมัติแล้ว · ใบไหนไม่มีใครมารับกลับจะค้างอยู่จนหลังบ้านปิดเอง</div>
      </div>
    </div>
  </div>

  <div>
    <p class="cap">② แจ้งปัญหา — เลือกจำนวน แล้วถ่ายรูป</p>
    <p class="sub">บังคับรูป 1 ใบ อัปให้เสร็จก่อนถึงกดส่งได้ เหมือนเบิก Asset · ปุ่มส่งเทาไว้จนกว่ารูปจะขึ้นครบ</p>
    <div class="phone">
      <div class="bar red">แจ้งปัญหา · OUT4-01</div>
      <div class="body">
        <div class="lbl">เกิดอะไรขึ้น</div>
        <div class="sel on">เข้าไม่ครบ</div>
        <div class="opts">
          <div>เข้าไม่ครบ · ขาด 1 คน</div>
          <div class="on">เข้าไม่ครบ · ขาด 2 คน</div>
          <div>ไม่มีใครกลับเลย</div>
          <div>คนเกินมาจากที่ปล่อย</div>
          <div>อื่น ๆ · พิมพ์เอง</div>
        </div>

        <div class="lbl">รูปตอนรับกลับ <b>(บังคับ 1 ใบ)</b></div>
        <div class="shots">
          <div class="shot up"><i>สมชาย รปภ<br>21BPL · 04:26</i></div>
          <div class="shot add">+</div>
        </div>

        <button class="go red">ส่ง · รับกลับ 1 จาก 3 คน</button>
        <div class="note n-dang">ส่งปุ๊บเด้งเตือนทันที — ผู้ตรวจสอบ และคนที่เจ้าของระบบเลือกไว้<br>ใบจะปิดพร้อมกัน ติดป้าย "เข้าไม่ครบ" ถาวร</div>
      </div>
    </div>
  </div>

  <div>
    <p class="cap">③ แจ้งเตือนที่เด้ง — 0 วินาที</p>
    <p class="sub">ยิงออกจากฐานข้อมูลตอนกดส่งเลย ไม่รอรอบนาฬิกา · คนที่ได้รับกดแล้วเข้าหน้าเทียบรูปทันที</p>
    <div class="push">
      <div class="ph"><b>BPL SUPPLY</b> ตอนนี้</div>
      <div class="pt">🔴 เบรค OS เข้าไม่ครบ</div>
      <div class="pb">
        OUT4-01 · ปล่อย 3 คน กลับ 1 คน<br>
        ปล่อยโดย สิโรธร 690196 เมื่อ 04:12<br>
        แจ้งโดย สมชาย (รปภ) เมื่อ 04:26
      </div>
    </div>
    <div class="note n-mute" style="width:320px">เตือนผู้ตรวจสอบทุกคนเสมอ · บวกคนที่คุณติ๊กไว้ในหน้าตั้งค่า · และหัวหน้าที่ปล่อยใบนั้นด้วย</div>
  </div>

  <div>
    <p class="cap">④ หลังบ้าน — เทียบรูปสองฝั่ง</p>
    <p class="sub w">ซ้ายคือรูปตอนหัวหน้าปล่อย ขวาคือรูปตอน รปภ รับกลับ · เปิดเทียบในจอเดียว เห็นเองว่าใครหายไป</p>
    <div class="web">
      <div class="wbar">OUT4-01 · 2 ต.ค. 2026
        <span class="chip d">เข้าไม่ครบ · ขาด 2 คน</span>
        <span class="chip">ยังไม่ปิดเรื่อง</span>
      </div>
      <div class="wpad">
        <div class="cmp">
          <div class="side">
            <h4>ตอนปล่อย · 3 คน<span>สิโรธร 690196 · 04:12</span></h4>
            <div class="g">
              <div class="shot"><i>สิโรธร 690196<br>21BPL · 04:12</i></div>
              <div class="shot"><i>สิโรธร 690196<br>21BPL · 04:12</i></div>
              <div class="shot"><i>สิโรธร 690196<br>21BPL · 04:12</i></div>
            </div>
          </div>
          <div class="vs">เทียบ →</div>
          <div class="side">
            <h4>ตอนรับกลับ · 1 คน<span>สมชาย (รปภ) · 04:26</span></h4>
            <div class="g">
              <div class="shot up"><i>สมชาย รปภ<br>21BPL · 04:26</i></div>
            </div>
          </div>
        </div>
        <div class="meta">
          <div><b>เหตุผล</b> เบรคย่อย · ขอ 10 นาที</div>
          <div><b>เวลา</b> ยื่น 04:12 → ผ่านประตู 04:14 → รับกลับ 04:26 · เดิน 2:00 · ข้างนอก 12:00</div>
          <div><b>สถานะ</b> <span class="pill p-ban">เข้าไม่ครบ · ขาด 2 คน</span></div>
          <div><b>แจ้งเตือนแล้ว</b> ผู้ตรวจสอบ 2 คน · ธนวัฒน์ (เจ้าของ) · สิโรธร (หัวหน้าที่ปล่อย)</div>
        </div>
        <div style="margin-top:12px;display:flex;gap:8px">
          <button class="btn y">จบเรื่อง · คนกลับมาแล้ว</button>
          <button class="btn">เขียนบันทึก</button>
        </div>
      </div>
    </div>
  </div>

  <div>
    <p class="cap">⑤ หลังบ้าน — ใบที่ค้างอยู่ (แทนปิดอัตโนมัติ)</p>
    <p class="sub w">ไม่มีปิดเองที่ 2 ชั่วโมงแล้ว · ใบที่ไม่มีใครมารับกลับจะมากองที่นี่ รอคุณปิดเอง · บัตรใบนั้นเอาไปปล่อยซ้ำไม่ได้จนกว่าจะปิด</p>
    <div class="web">
      <div class="wbar">ใบที่ค้างอยู่ <span class="chip d">3 ใบ</span></div>
      <div class="wpad">
        <div class="meta" style="margin-top:0;border-top:0;padding-top:0">
          <div><b>OUT4-02</b> ยื่น 02:40 · ผ่านประตู 02:43 · <span style="color:var(--dang)">ค้างมา 6 ชม. 25 นาที</span> · 1 คน · ณัฐพล</div>
          <div><b>IN2-03</b> ยื่น 03:15 · <span style="color:var(--mute)">ไม่ได้สแกนขาออก</span> · ค้างมา 5 ชม. 50 นาที · 2 คน · ปิยะนุช</div>
          <div><b>OUT4-05</b> ยื่น 07:02 · ผ่านประตู 07:04 · ค้างมา 2 ชม. 3 นาที · 1 คน · สิโรธร</div>
        </div>
        <div style="margin-top:12px;display:flex;gap:8px">
          <button class="btn y">ปิดใบที่เลือก</button>
          <button class="btn">ปิดทั้งหมดของกะที่แล้ว</button>
        </div>
        <div class="note n-mute">ปิดจากที่นี่จะติดป้าย "หลังบ้านปิดเอง" และไม่เอาเวลาที่ค้างไปนับเป็นเวลาอู้ของใคร</div>
      </div>
    </div>
  </div>

</div>`

fs.writeFileSync('public/__brk6.html', html)
console.log('ok: /__brk6.html')
