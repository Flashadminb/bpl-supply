/**
 * สร้างสคริปต์สำหรับแปะโค้ดใหม่เข้า Monaco ของหน้า Edge Functions
 *
 * Supabase CLI ยังไม่ได้ล็อกอินบนเครื่องนี้ การ deploy จึงต้องทำผ่านหน้าเว็บ
 * แต่ไฟล์ 47KB ส่งเข้าหน้าเว็บแล้วพิมพ์ตกหล่นง่ายมาก และตกตัวเดียวก็พังทั้งไฟล์
 *
 * จึงส่งเฉพาะบรรทัดที่ต่างจากของที่ deploy อยู่ ซึ่งเหลือราวร้อยบรรทัด
 * แล้วให้หน้าเว็บประกอบเองจากของเดิมที่อยู่ในนั้นแล้ว
 * ปิดท้ายด้วย checksum เทียบกับไฟล์ในเครื่อง จะได้รู้แน่ว่าตรงกันจริงไม่ใช่เดา
 *
 *   node fn-patch.cjs        แล้วเอาเนื้อใน fn-patch.out.js ไปรันในหน้าเว็บ
 */
const fs = require('fs')
const { execSync } = require('child_process')

const FN = 'supabase/functions/export-sheet/index.ts'
const TMP = process.env.TEMP || '.'

const oldT = execSync(`git show HEAD:${FN}`, { encoding: 'utf8', maxBuffer: 1 << 24 })
const newT = fs.readFileSync(FN, 'utf8').replace(/\r\n/g, '\n')

fs.writeFileSync(`${TMP}/fnold.ts`, oldT)
fs.writeFileSync(`${TMP}/fnnew.ts`, newT)

const script = execSync(`diff --normal "${TMP}/fnold.ts" "${TMP}/fnnew.ts" || true`, {
  encoding: 'utf8',
  maxBuffer: 1 << 24,
  shell: 'bash',
})

const newLines = newT.split('\n')

/**
 * แปลงผลของ diff เป็นรายการแก้ไขทีละช่วง
 *
 * ทำจากล่างขึ้นบนตอนเอาไปใช้ เลขบรรทัดของช่วงที่ยังไม่ได้แตะจึงไม่ขยับ
 * ถ้าไล่จากบนลงล่าง ทุกการแทรกจะดันเลขบรรทัดของช่วงถัดไปให้เพี้ยนหมด
 */
const ops = []
for (const line of script.split('\n')) {
  const m = line.match(/^(\d+)(?:,(\d+))?([acd])(\d+)(?:,(\d+))?$/)
  if (!m) continue
  const [, a1, a2, kind, b1, b2] = m
  const oldStart = Number(a1)
  const oldEnd = a2 ? Number(a2) : oldStart
  const newStart = Number(b1)
  const newEnd = b2 ? Number(b2) : newStart

  if (kind === 'a') {
    ops.push({ at: oldStart, del: 0, ins: newLines.slice(newStart - 1, newEnd) })
  } else if (kind === 'd') {
    ops.push({ at: oldStart - 1, del: oldEnd - oldStart + 1, ins: [] })
  } else {
    ops.push({ at: oldStart - 1, del: oldEnd - oldStart + 1, ins: newLines.slice(newStart - 1, newEnd) })
  }
}

const sum = (t) => {
  let s = 0
  for (let i = 0; i < t.length; i++) s = (s + (i + 1) * t.charCodeAt(i)) % 2147483647
  return s
}

// ตรวจก่อนว่าชุดแก้ไขนี้ประกอบกลับได้ตรงกับไฟล์ใหม่จริง ไม่งั้นอย่าส่งไปเลย
const check = oldT.split('\n')
for (const op of [...ops].sort((x, y) => y.at - x.at)) check.splice(op.at, op.del, ...op.ins)
if (check.join('\n') !== newT) throw new Error('ชุดแก้ไขประกอบกลับแล้วไม่ตรงกับไฟล์ใหม่')

const js = [
  '(() => {',
  '  const m = window.monaco.editor.getModels()[0];',
  // เก็บของเดิมไว้ตั้งแต่รอบแรก รันซ้ำจะได้เริ่มจากของเดิมเสมอ
  // ไม่ใช่เริ่มจากของที่เพิ่งเขียนพลาดไป ซึ่งจะทำให้รอบสองไม่มีทางถูก
  '  window.__orig = window.__orig || m.getValue().replace(/\\r\\n/g, "\\n");',
  // Monaco เติมขึ้นบรรทัดท้ายไฟล์ให้เอง ของเดิมจึงยาวกว่าที่ git เก็บอยู่หนึ่งตัว
  '  const cur = window.__orig.endsWith("\\n") ? window.__orig.slice(0, -1) : window.__orig;',
  `  if (cur.length !== ${oldT.length}) return { stop: "ของเดิมในหน้าเว็บไม่ตรงกับที่คาดไว้", chars: cur.length, want: ${oldT.length} };`,
  `  const ops = ${JSON.stringify(ops)};`,
  '  const L = cur.split("\\n");',
  '  for (const op of ops.slice().sort((x, y) => y.at - x.at)) L.splice(op.at, op.del, ...op.ins);',
  '  const next = L.join("\\n");',
  '  m.setValue(next);',
  '  const raw = m.getValue(); const t = raw.endsWith("\\n") ? raw.slice(0, -1) : raw;',
  '  let s = 0; for (let i = 0; i < t.length; i++) s = (s + (i + 1) * t.charCodeAt(i)) % 2147483647;',
  `  return { chars: t.length, want: ${newT.length}, checksum: s, wantChecksum: ${sum(newT)},`,
  `           ok: t.length === ${newT.length} && s === ${sum(newT)},`,
  '           version: (t.match(/const VERSION = \'[^\']+\'/) || ["?"])[0] };',
  '})()',
].join('\n')

fs.writeFileSync('fn-patch.out.js', js)
console.log('ของเดิม', oldT.length, '· ของใหม่', newT.length, 'ตัวอักษร')
console.log('แก้', ops.length, 'ช่วง · บรรทัดใหม่', ops.reduce((n, o) => n + o.ins.length, 0))
console.log('checksum ที่ต้องได้', sum(newT))
console.log('เขียน fn-patch.out.js ขนาด', js.length, 'ตัวอักษร')
