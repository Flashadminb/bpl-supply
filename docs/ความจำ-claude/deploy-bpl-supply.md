---
name: deploy-bpl-supply
description: วิธี deploy BPL SUPPLY บนเครื่องนี้ — PowerShell บล็อก npx ต้องใช้ npx.cmd และต้องล้าง cache PWA หลัง deploy
metadata:
  node_type: memory
  type: project
  originSessionId: 558471e8-c4f3-4acc-8622-bf119572434e
  modified: 2026-09-24T07:29:06.311Z
---

Deploy BPL SUPPLY ขึ้น Cloudflare จากโฟลเดอร์ `bpl-supply-handoff` (ไม่ใช่โฟลเดอร์แม่):
`npx.cmd wrangler deploy` — ล็อกอินไว้แล้วตั้งแต่ 2026-09-24 ไม่ต้อง login ซ้ำ

**Why:** PowerShell ของเครื่องนี้ตั้ง execution policy ห้ามรันสคริปต์ `.ps1` คำสั่ง `npx` เปล่า ๆ จะวิ่งไปเจอ `npx.ps1` แล้วตายด้วย `UnauthorizedAccess` ทุกครั้ง — `.cmd` ไม่โดนกฎนี้ ไม่ต้องไปแก้ค่าความปลอดภัยของ Windows

**How to apply:** บอกคำสั่งให้ผู้ใช้ต้องเติม `.cmd` และใส่ `cd` เข้าโฟลเดอร์โปรเจกต์ให้ด้วยเสมอ · หลัง deploy เสร็จ **ห้ามสรุปว่าขึ้นแล้วจากผลของ wrangler อย่างเดียว** เพราะ service worker จะเสิร์ฟไฟล์เก่าต่อ ทำให้ของใหม่ไม่ขึ้นทั้งที่ deploy สำเร็จ (เคยหลงมาแล้ว) — ต้อง unregister SW + ลบ caches แล้วโหลดใหม่ก่อนตรวจ และต้องบอกทีมงานให้ปัดปิดแอพเปิดใหม่ทุกครั้ง ดู [[bpl-supply-sql-editor]]
