---
name: bpl-supply-sql-editor
description: วิธีรัน migration ให้ผู้ใช้เองผ่าน Supabase SQL Editor ด้วยเบราว์เซอร์ โดยไม่ต้องให้เขา copy-paste
metadata:
  node_type: memory
  type: project
  originSessionId: 558471e8-c4f3-4acc-8622-bf119572434e
  modified: 2026-09-24T07:29:27.087Z
---

Supabase project ของ BPL SUPPLY คือ `ajcdzmfefoyyisgwnpky` · SQL Editor อยู่ที่
`https://supabase.com/dashboard/project/ajcdzmfefoyyisgwnpky/sql/new`

รัน migration ให้เองได้โดยไม่ต้องพิมพ์ทีละตัว: gzip + base64 ไฟล์ SQL (`gzip -9c f.sql | base64 | tr -d '\n'`)
แบ่งเป็นก้อนละ ~2600 ตัวอักษรส่งเข้า `window` ผ่าน javascript_tool แล้วคลาย
ด้วย `DecompressionStream('gzip')` และยัดเข้า `window.monaco.editor.getModels()[0].setValue(sql)`
จากนั้นกดปุ่ม Run มุมขวาบน (Ctrl+Enter ไม่ทำงาน) แล้วจะมีกล่อง
"Potential issue detected" เด้งขึ้นทุกครั้งที่ไฟล์มี `drop` ต้องกด "Run query" ยืนยันอีกที

**Why:** ผู้ใช้เปิด SQL Editor เองได้แต่ขอให้ทำให้ · การพิมพ์ SQL ภาษาไทยยาว ๆ
ผ่าน keystroke ช้าและพังเพราะ auto-indent กับ autocomplete ของ Monaco
ส่วน gzip ช่วยให้ไฟล์ 10KB เหลือ base64 แค่ 5KB ส่งรอบเดียวจบ

**How to apply:** ตรวจความยาว base64 ที่ฝั่งเบราว์เซอร์ให้ตรงกับ `wc -c` ก่อนคลายเสมอ
และเทียบจำนวนบรรทัด/ฟังก์ชันกับไฟล์ต้นทางหลัง setValue ก่อนกด Run
ห้ามเดาว่าพิมพ์ครบ · ปิดท้าย migration ด้วย select ตรวจผลจะได้เห็นทันทีว่าลงจริง ดู [[deploy-bpl-supply]]
