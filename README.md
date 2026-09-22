# BPL SUPPLY

ระบบเบิก–คืนวัสดุสิ้นเปลืองแบบ PWA สำหรับ Flash Express BPL HUB (รองรับหลายฮับ: BPL, AYU, PDT, WNO, BAG)

พนักงานสแกน QR ที่ชั้นวาง ใส่ตะกร้าได้หลายรายการ ถ่ายรูปหลักฐาน 1 รูป แล้วยืนยันครั้งเดียว
ระบบตัดสต็อกทุกบรรทัดใน transaction เดียว เก็บรูปไว้ที่ Google Drive และสรุปลง Google Sheet

> **เริ่มที่นี่ → [SETUP.md](SETUP.md)** ขั้นตอนติดตั้งตั้งแต่ศูนย์จนใช้งานได้จริง

---

## Tech stack

| ส่วน | ใช้อะไร |
|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind, PWA ผ่าน `vite-plugin-pwa` |
| Backend | Supabase (Postgres + Auth + Edge Functions) — free tier ทั้งหมด |
| รูปหลักฐาน | Google Drive ผ่าน service account — **ไม่เก็บใน Supabase Storage** เก็บแค่ `drive_file_id` + `web_link` |
| รายงาน | Google Sheets API — 1 แถวต่อ 1 รายการวัสดุ |
| Deploy | Cloudflare Pages |

## คำสั่งที่ใช้บ่อย

```bash
npm run dev
```

```bash
npm run build
```

```bash
npm run typecheck
```

## โครงไฟล์

```
├── CLAUDE.md                     กติกาประจำโปรเจกต์ — เอเจนต์ต้องอ่านทุกครั้ง
├── SETUP.md                      ขั้นตอนติดตั้งทั้งหมด
├── docs/
│   ├── SPEC.md                   สเปกฟังก์ชันเต็ม ทุกหน้าจอ ทุก flow
│   ├── schema.sql                สำเนา DDL ไว้อ่านอ้างอิง
│   ├── design-tokens.css         สำเนา token ไว้อ่านอ้างอิง
│   └── KICKOFF-PROMPT.md         ข้อความเริ่มงานเดิม
├── supabase/
│   ├── migrations/001_init.sql   ตาราง + RLS + RPC หลัก
│   ├── migrations/002_extras.sql RPC เสริม (คืนของ ปรับสต็อก ปฏิเสธ แถบ sync) + view
│   ├── seed.sql                  ข้อมูลวัสดุตัวอย่าง
│   └── functions/
│       ├── _shared/google.ts     JWT service account + ตัวช่วย
│       ├── upload-evidence/      อัปรูปเข้า Google Drive
│       ├── admin-users/          สร้างบัญชีพนักงาน / รีเซ็ตรหัสผ่าน
│       └── export-sheet/         เขียนลง Google Sheet (upsert ไม่ซ้ำ)
└── src/
    ├── styles/tokens.css         ★ ต้นทางเดียวของสี/ฟอนต์/ระยะ
    ├── lib/                      supabase, auth, cart, api, image, format
    ├── components/               ui, Shell (TopBar/BottomNav), SyncBar
    └── pages/
        ├── staff/                Login Home Scan Items ItemDetail Cart Evidence Success Returns History Account
        └── admin/                AdminLayout Dashboard Stock Approvals Users ExportSheet
```

## กติกาสำคัญ (ฉบับย่อ — ฉบับเต็มใน [CLAUDE.md](CLAUDE.md))

1. ตัดสต็อกผ่าน RPC `create_requisition` / `approve_requisition` เท่านั้น ห้าม `update items` ตรง ๆ จาก client
2. 1 คำขอ = หลายรายการเสมอ · รูปหลักฐาน 1 รูปต่อ 1 คำขอ
3. พนักงานเปิดดูรูปหลักฐานไม่ได้ — เห็นแค่แถบรหัส `IMG GDV SPB TMP GSH`
4. บังคับสิทธิ์ที่ RLS ไม่ใช่แค่ซ่อนปุ่ม
5. service account key อยู่ใน Edge Function secrets เท่านั้น
6. ตัวอักษรบนพื้นเหลืองต้องเป็นสีเข้มเสมอ · ปุ่มไม่ต่ำกว่า 44×44px

## สีและดีไซน์

แก้สีที่ [`src/styles/tokens.css`](src/styles/tokens.css) ที่เดียว แล้ว mirror ค่าเดียวกันใน `tailwind.config.js`
ห้าม hardcode สีในคอมโพเนนต์

## ยังไม่ได้ทำ

หน้าพิมพ์ QR ติดชั้นวาง · โหมดออฟไลน์เต็มรูปแบบ ·
การแจ้งเตือนเมื่อของเข้าสต็อก · เทมเพลตชุดเบิกประจำ · เข้าระบบด้วย QR บัตรพนักงาน
(หน้ารับของเข้าสต็อกทำไว้แบบย่อแล้วในหน้าสต็อกวัสดุ → ปุ่ม "รับเข้า/ปรับ")
