# ข้อความเริ่มงาน — ก๊อปทั้งบล็อกนี้วางใน Claude Code

---

ช่วยสร้างโปรเจกต์ **BPL SUPPLY** ระบบเบิก–คืนวัสดุสิ้นเปลืองแบบ PWA สำหรับฮับขนส่ง

อ่าน `CLAUDE.md`, `docs/SPEC.md`, `docs/schema.sql` และ `docs/design-tokens.css` ให้ครบก่อนเริ่มเขียนโค้ด แล้วทำตามลำดับนี้:

**เฟส 1 — วางโครง**
- Vite + React + TypeScript + Tailwind, ตั้งค่า PWA ด้วย `vite-plugin-pwa`
- แปลง `design-tokens.css` เป็น Tailwind theme (สี ฟอนต์ ระยะ มุมโค้ง)
- ต่อ Supabase client, ทำ auth ด้วยรหัสพนักงาน + รหัสผ่าน
- ทำ route guard แยก role: `staff` / `supervisor` / `admin`

**เฟส 2 — ฝั่งพนักงาน (มือถือ 390px เป็นหลัก)**
หน้า: เข้าสู่ระบบ, หน้าหลัก, สแกน QR, รายการวัสดุ, รายละเอียดรายการ, ตะกร้าเบิก, ถ่ายรูปหลักฐาน, เบิกสำเร็จ, คืนวัสดุ, ประวัติ
- ตะกร้าเก็บใน state + localStorage กันปิดแอปแล้วหาย
- สแกน QR ใช้ `@zxing/browser` หรือ `BarcodeDetector` API
- บีบอัดรูปในเครื่องเป็น WebP ด้านยาว 1024px ก่อนอัปโหลด แล้ว revoke object URL ทิ้งทันที

**เฟส 3 — ฝั่งแอดมิน (เดสก์ท็อป 1280px + ย่อลงมือถือได้)**
หน้า: ภาพรวม, สต็อกวัสดุ, อนุมัติคำขอ (เลือกอนุมัติรายบรรทัดได้), ผู้ใช้และสิทธิ์, ส่งออก Google Sheet

**เฟส 4 — Edge Functions**
- `upload-evidence` — รับรูป อัปเข้า Google Drive ด้วย service account คืน fileId + webViewLink
- `export-sheet` — เขียนข้อมูลลง Google Sheet 1 แถวต่อ 1 รายการวัสดุ

เริ่มจากเฟส 1 ก่อน ทำเสร็จแล้วหยุดให้ผมรีวิว อย่าข้ามไปเฟสถัดไปเอง
ถ้ามีจุดไหนในสเปกกำกวม ให้ถามก่อน อย่าเดา

---
