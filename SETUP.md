# BPL SUPPLY — ขั้นตอนติดตั้งจนใช้งานได้จริง

ทำตามลำดับ 1 → 9 ข้ามไม่ได้ ใช้เวลาประมาณ 45–60 นาทีถ้าทำครั้งแรก
ทุกอย่างในคู่มือนี้อยู่ใน **free tier** ไม่มีค่าใช้จ่าย

สรุปทางลัด: ขั้น 1–5 พอให้แอปรันบนเครื่องและเบิกของได้จริง (ยังไม่มีรูป/ชีต)
ขั้น 6–7 เพิ่มรูปหลักฐานลง Google Drive และรายงานลง Google Sheet
ขั้น 8–9 เอาขึ้นออนไลน์ให้พนักงานติดตั้งบนมือถือ

---

## ขั้นที่ 1 — Node.js ✅ ติดตั้งให้แล้ว (v24.19.0)

ถ้าย้ายไปทำบนเครื่องอื่น ติดตั้งด้วยคำสั่งนี้ แล้ว**ปิด Terminal เปิดใหม่**ให้ PATH อัปเดต

```bash
winget install OpenJS.NodeJS.LTS
```

ตรวจว่าได้จริง — ต้องขึ้นเลขเวอร์ชัน

```bash
node -v
```

---

## ขั้นที่ 2 — dependencies ✅ ติดตั้งให้แล้ว (424 packages)

ถ้าเครื่องใหม่หรือ `node_modules` หาย ให้รันในโฟลเดอร์โปรเจกต์นี้

```bash
npm install
```

ตรวจว่า build ผ่าน (ตอนนี้ผ่านแล้ว exit code 0)

```bash
npm run build
```

---

## ขั้นที่ 3 — สร้างฐานข้อมูล Supabase

1. ไปที่ <https://supabase.com> → Sign in ด้วย GitHub หรืออีเมล
2. **New project**
   - Name: `bpl-supply`
   - Database password: ตั้งแล้ว**จดเก็บไว้** (ใช้ตอน CLI)
   - Region: `Southeast Asia (Singapore)` — ใกล้ไทยที่สุด
3. รอสร้างเสร็จ ~2 นาที
4. เมนูซ้าย → **SQL Editor** → **New query** แล้วรันไฟล์ตามลำดับ **ทีละไฟล์**
   - เปิด `supabase/migrations/001_init.sql` ก๊อปทั้งไฟล์ → วาง → **Run**
   - เปิด `supabase/migrations/002_extras.sql` ก๊อปทั้งไฟล์ → วาง → **Run**
   - (ถ้าอยากมีของตัวอย่างให้ทดลอง) เปิด `supabase/seed.sql` → วาง → **Run**
5. ตรวจว่าสำเร็จ: เมนู **Table Editor** ต้องเห็นตาราง `hubs`, `items`, `requisitions`, `requisition_items`, `sync_log` ฯลฯ

> ถ้าขั้นที่ 4 ขึ้น error สีแดงระหว่างรัน ให้อ่านบรรทัดแรกของ error
> `type already exists` ไม่เป็นไร ข้ามได้ แต่ error อื่นต้องแก้ก่อนไปต่อ

---

## ขั้นที่ 4 — ตั้งค่า `.env` แล้วลองรัน

1. ใน Supabase: **Project Settings → API** จดค่า 2 ตัว
   - **Project URL** → ใช้เป็น `VITE_SUPABASE_URL`
   - **anon public** key → ใช้เป็น `VITE_SUPABASE_ANON_KEY`
2. ก๊อป `.env.example` เป็น `.env`

```bash
cp .env.example .env
```

3. เปิด `.env` ใส่ค่า 2 ตัวข้างบน (อย่าใส่ `service_role` key เด็ดขาด)
4. รันแอป

```bash
npm run dev
```

เปิด <http://localhost:5173> จะเห็นหน้าเข้าสู่ระบบ — ยังล็อกอินไม่ได้จนกว่าจะทำขั้นที่ 5

---

## ขั้นที่ 5 — สร้างผู้ใช้คนแรก (แอดมิน)

ระบบล็อกอินด้วย **รหัสพนักงาน + รหัสผ่าน** โดยแปลงรหัสพนักงานเป็นอีเมลปลอมอัตโนมัติ
`FE-10482` → `fe-10482@bpl.local` (ตัวพิมพ์เล็กเสมอ โดเมนตั้งได้ที่ `VITE_AUTH_EMAIL_DOMAIN`)

1. Supabase → **Authentication → Users → Add user → Create new user**
   - Email: `fe-10482@bpl.local` (ใช้รหัสพนักงานจริงของคุณ)
   - Password: ตั้งตามต้องการ
   - ✅ ติ๊ก **Auto Confirm User** (สำคัญ ไม่งั้นล็อกอินไม่ได้)
2. ก๊อป **User UID** ที่ได้
3. ไป **SQL Editor** รันคำสั่งนี้ (แทนค่า 3 จุด)

```sql
insert into profiles (id, employee_code, full_name, hub_code, role)
values ('<วาง USER UID ที่ก๊อปมา>', 'FE-10482', 'ชื่อ นามสกุล', 'BPL', 'admin');
```

4. กลับไปที่แอป ล็อกอินด้วย `FE-10482` + รหัสผ่านที่ตั้งไว้

**ถึงตรงนี้ใช้งานได้แล้ว**: เลือกวัสดุ → ใส่ตะกร้า → ถ่ายรูป → ยืนยัน → ตัดสต็อกจริง
(ช่อง `GDV` กับ `GSH` บนแถบสถานะจะขึ้น `!` เพราะยังไม่ได้ต่อ Google — ทำต่อในขั้นที่ 6)

### เพิ่มพนักงานคนอื่น

**ทำมือแบบนี้แค่บัญชีแรกเท่านั้น** หลังจาก deploy ฟังก์ชัน `admin-users` (ขั้นที่ 7.4) แล้ว
พนักงานคนถัดไปเพิ่มจากในเว็บได้เลย: หน้าแอดมิน → **ผู้ใช้และสิทธิ์** → ปุ่ม **เพิ่มพนักงาน**

### การจัดการรหัสผ่าน

พนักงานล็อกอินด้วย **รหัสพนักงาน** เท่านั้น ไม่เคยเห็นอีเมล ไม่ต้องมีอีเมลจริง
อีเมล `@bpl.local` เป็นโดเมนปลอมที่ไม่มีอยู่จริง ใช้เพราะ Supabase บังคับให้ต้องมีช่องอีเมล

| ใคร | ทำอะไรได้ | ที่ไหน |
|---|---|---|
| แอดมิน | สร้างบัญชี + สุ่มรหัส**ชั่วคราว** | ผู้ใช้และสิทธิ์ → เพิ่มพนักงาน |
| แอดมิน | ตั้งรหัสชั่วคราวใหม่ให้คนที่ลืมรหัส | ผู้ใช้และสิทธิ์ → **ตั้งรหัสใหม่** |
| พนักงาน | **ถูกบังคับ**ตั้งรหัสเองตอนล็อกอินครั้งแรก | ขึ้นเองอัตโนมัติ กดข้ามไม่ได้ |
| พนักงาน | เปลี่ยนรหัสตัวเองเมื่อไหร่ก็ได้ | หน้าหลัก → **บัญชีของฉัน** |

**ทำไมต้องบังคับ:** แอดมินต้องบอกรหัสชั่วคราวให้พนักงานปากเปล่า ถ้าไม่บังคับเปลี่ยน
แอดมินจะรู้รหัสถาวรของทุกคน ระบบนี้ทำให้แอดมินรู้รหัสแค่ครั้งเดียวตอนส่งมอบเท่านั้น

ไม่มีปุ่ม "ลืมรหัสผ่าน" แบบส่งอีเมล เพราะไม่มีอีเมลจริงให้ส่ง — คนลืมรหัสต้องให้แอดมินตั้งใหม่ให้

รหัสผ่านยาวอย่างน้อย 8 ตัว ทุกหน้ามีปุ่ม "สุ่มใหม่" ที่ตัดตัวสับสนออก (`0/O`, `1/l/I`) เพราะต้องอ่านให้ฟังหน้างาน

---

## ขั้นที่ 6 — ต่อ Google Drive + Google Sheet

### 6.1 สร้าง service account

1. <https://console.cloud.google.com> → สร้างโปรเจกต์ใหม่ชื่อ `bpl-supply`
2. **APIs & Services → Library** เปิดใช้งาน 2 ตัว
   - **Google Drive API**
   - **Google Sheets API**
3. **APIs & Services → Credentials → Create credentials → Service account**
   - ชื่อ: `bpl-supply-bot` → Create → Done
4. คลิกชื่อ service account ที่เพิ่งสร้าง → แท็บ **Keys → Add key → Create new key → JSON**
   - ไฟล์ JSON จะดาวน์โหลดลงเครื่อง **เก็บเป็นความลับ ห้ามใส่ในโฟลเดอร์โปรเจกต์**
   - ในไฟล์นั้นมี `client_email` และ `private_key` — จะใช้ในขั้น 7

### 6.2 เตรียมโฟลเดอร์ Drive

1. สร้างโฟลเดอร์ใน Google Drive ชื่อ `BPL SUPPLY หลักฐานการเบิก`
2. คลิกขวา → **แชร์** → ใส่ `client_email` ของ service account → สิทธิ์ **ผู้แก้ไข (Editor)**
3. เปิดโฟลเดอร์แล้วดู URL: `https://drive.google.com/drive/folders/1AbCdEf...`
   ส่วน `1AbCdEf...` คือ `GDRIVE_FOLDER_ID`

### 6.3 เตรียม Google Sheet

1. สร้าง Google Sheet ใหม่ชื่อ `BPL SUPPLY รายงานการเบิก`
2. แชร์ให้ `client_email` สิทธิ์ **ผู้แก้ไข** เช่นกัน
3. URL: `https://docs.google.com/spreadsheets/d/1XyZ.../edit` — ส่วน `1XyZ...` คือ `GSHEET_ID`
4. แท็บปลายทางชื่อ `บันทึกการเบิก-คืน` (ระบบสร้างให้อัตโนมัติถ้ายังไม่มี)

---

## ขั้นที่ 7 — Deploy Edge Functions

### 7.1 ติดตั้ง Supabase CLI

```bash
npm install -g supabase
```

### 7.2 เชื่อมโปรเจกต์

หา **Project ref** ได้จาก Supabase → Project Settings → General (หรือจาก URL `https://supabase.com/dashboard/project/<ref>`)

```bash
supabase login
```

```bash
supabase link --project-ref <ใส่ project ref>
```

### 7.3 ใส่ secrets

แทนค่าจากไฟล์ JSON ของ service account (คัดลอก `private_key` มาทั้งก้อนรวม `-----BEGIN...` และ `\n`)

```bash
supabase secrets set GOOGLE_SA_EMAIL="bpl-supply-bot@xxx.iam.gserviceaccount.com" GDRIVE_FOLDER_ID="1AbCdEf..." GSHEET_ID="1XyZ..." GSHEET_TAB="บันทึกการเบิก-คืน"
```

private key มีขึ้นบรรทัดใหม่ ต้องใส่แยกด้วยไฟล์ — สร้างไฟล์ชั่วคราว `sa.env` (อย่า commit)

```
GOOGLE_SA_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
```

แล้วรัน

```bash
supabase secrets set --env-file sa.env
```

เสร็จแล้ว **ลบไฟล์ `sa.env` ทิ้งทันที**

> `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` ไม่ต้องตั้งเอง
> Supabase ใส่ให้ Edge Function อัตโนมัติอยู่แล้ว

### 7.4 Deploy

```bash
supabase functions deploy upload-evidence
```

```bash
supabase functions deploy export-sheet
```

```bash
supabase functions deploy admin-users
```

> `admin-users` คือฟังก์ชันสร้างบัญชีพนักงาน/รีเซ็ตรหัสผ่าน ไม่ต้องใช้ secret ของ Google
> deploy ตัวนี้ได้เลยแม้ยังไม่ได้ทำขั้นที่ 6 — พอขึ้นแล้วหน้าแอดมิน → ผู้ใช้และสิทธิ์ จะมีปุ่ม
> **เพิ่มพนักงาน** กับ **ตั้งรหัสใหม่** ใช้งานได้ทันที ไม่ต้องกลับไปสร้างบัญชีใน Supabase อีก

ทดสอบ: กลับไปที่แอป เบิกของ 1 รายการพร้อมถ่ายรูป — แถบสถานะต้องขึ้น
`IMG ✓ GDV ✓ SPB ✓ TMP ✓ GSH ✓` ครบทั้ง 5 ช่อง และรูปต้องโผล่ในโฟลเดอร์ Drive

---

## ขั้นที่ 8 — ขึ้นออนไลน์ด้วย Cloudflare

1. ตรวจว่า build ผ่านก่อน

```bash
npm run build
```

2. push โค้ดขึ้น GitHub (repo แบบ private ได้ Cloudflare อ่านได้)
3. <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Import a repository**
4. เลือก repo แล้วตั้งค่า

   | ช่อง | ค่า |
   |---|---|
   | Project name | `bpl-supply` |
   | Build command | `npm run build` |
   | Deploy command | `npx wrangler deploy` |

5. **Advanced settings → Variables** ใส่ 3 ตัว แบบ **Text ธรรมดา ห้าม Encrypt**
   (ถ้า encrypt ตอน build จะอ่านไม่เจอ เพราะ Vite ฝังค่าลงไฟล์ตอน build ไม่ใช่ตอนรัน)

   | ชื่อ | ค่า |
   |---|---|
   | `VITE_SUPABASE_URL` | URL ของโปรเจกต์ Supabase |
   | `VITE_SUPABASE_ANON_KEY` | publishable / anon key |
   | `VITE_AUTH_EMAIL_DOMAIN` | `bpl.local` |

6. กด **Deploy** → ได้ URL แบบ `https://bpl-supply.<ชื่อบัญชี>.workers.dev`

### เส้นทางหน้าใน ๆ จัดการที่ไหน

อยู่ในไฟล์ `wrangler.jsonc` ที่ root ของโปรเจกต์

```jsonc
"assets": {
  "directory": "./dist",
  "not_found_handling": "single-page-application"
}
```

จำเป็นเพราะเส้นทางอย่าง `/admin/stock` ไม่มีไฟล์จริงบนเซิร์ฟเวอร์ ถ้าไม่ตั้ง พอรีเฟรชหน้าลึก ๆ จะเจอ 404

> ⚠️ **ห้ามมีไฟล์ `public/_redirects`** ในโหมดนี้ — มันจะชนกับ `not_found_handling`
> แล้ว Cloudflare จะปฏิเสธ deploy ด้วยข้อความ *Infinite loop detected in this rule*
> (ไฟล์นั้นใช้กับ Cloudflare Pages แบบเก่าเท่านั้น โปรเจกต์นี้ลบทิ้งไปแล้ว)

---

## ขั้นที่ 9 — ให้พนักงานติดตั้งบนมือถือ

1. ส่งลิงก์ให้พนักงานเปิดด้วย **Chrome (Android)** หรือ **Safari (iPhone)**
2. Android: จะมีแบนเนอร์ "ติดตั้ง" ขึ้นเอง หรือเมนู ⋮ → **ติดตั้งแอป**
3. iPhone: ปุ่มแชร์ → **เพิ่มไปยังหน้าจอโฮม**
4. เปิดครั้งแรกจะขอสิทธิ์กล้อง ต้องกด **อนุญาต** ไม่งั้นสแกน QR ไม่ได้

> กล้องทำงานเฉพาะบน **https** หรือ `localhost` เท่านั้น
> ถ้าทดสอบในเครือข่ายด้วย `http://192.168.x.x:5173` กล้องจะไม่ขึ้น ให้ใช้ปุ่ม "ป้อนรหัสเอง" แทน

---

## พิมพ์ QR ติดชั้นวาง

ยังไม่มีหน้าพิมพ์ในแอป (อยู่ในรายการที่ยังไม่ได้ออกแบบ) ระหว่างนี้ใช้วิธีนี้ไปก่อน

1. หน้าแอดมิน → สต็อกวัสดุ → ดูคอลัมน์ SKU
2. สร้าง QR จากค่า `qr_payload` (ถ้าเว้นว่างระบบใช้ SKU แทน) ด้วยเครื่องมือสร้าง QR ใด ๆ
3. พิมพ์แล้วติดที่ชั้นวางตามรหัส `shelf_code`

---

## สิ่งที่ต้องรู้ก่อนขึ้นใช้งานจริง

| เรื่อง | สถานะ |
|---|---|
| ตัดสต็อกพร้อมกันหลายคน | ปลอดภัย — RPC ล็อกแถวด้วย `FOR UPDATE` และล้มทั้งคำขอถ้าบรรทัดใดไม่พอ |
| สิทธิ์ผู้ใช้ | บังคับที่ RLS ในฐานข้อมูล ไม่ใช่แค่ซ่อนปุ่ม |
| service account key | อยู่ใน Edge Function secrets เท่านั้น ไม่เคยเข้า bundle ฝั่ง client |
| พนักงานเห็นรูปหลักฐานไหม | ไม่เห็น — เห็นแค่แถบรหัส `IMG GDV SPB TMP GSH` |
| ส่งลง Sheet ซ้ำ | ไม่เกิดแถวซ้ำ ใช้คู่ (เลขที่คำขอ, ชื่อวัสดุ) เป็นกุญแจ upsert |
| โหมดออฟไลน์ | **ยังไม่มี** — เน็ตหลุดตอนกดยืนยันต้องกดใหม่ (ตะกร้าไม่หาย เก็บใน localStorage) |
| หน้าโปรไฟล์ / พิมพ์ QR / แจ้งเตือนของเข้า | **ยังไม่ได้ออกแบบ** ต้องกลับมาทำเพิ่ม |

---

## แก้ปัญหาที่เจอบ่อย

**ล็อกอินไม่ผ่าน "รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง"**
→ ตรวจว่าอีเมลใน Supabase คือ `รหัสพนักงานตัวพิมพ์เล็ก@bpl.local` และติ๊ก Auto Confirm แล้ว

**ล็อกอินได้แต่ขึ้น "บัญชีนี้ยังไม่มีโปรไฟล์พนักงาน"**
→ ยังไม่ได้ insert แถวใน `profiles` (ขั้นที่ 5 ข้อ 3) หรือ UID ไม่ตรง

**หน้าวัสดุว่างเปล่า**
→ RLS ให้เห็นเฉพาะวัสดุใน hub เดียวกับโปรไฟล์ ตรวจว่า `items.hub_code` ตรงกับ `profiles.hub_code`

**`GDV !` อัปโหลดรูปไม่สำเร็จ**
→ ยังไม่ได้ deploy `upload-evidence` หรือยังไม่ได้แชร์โฟลเดอร์ Drive ให้ service account
ดู log จริงด้วย `supabase functions logs upload-evidence`

**`GSH !` ส่ง Sheet ไม่สำเร็จ**
→ ยังไม่ได้แชร์ Sheet ให้ service account หรือ `GSHEET_ID` ผิด
คำขอถูกบันทึกและตัดสต็อกเรียบร้อยแล้ว กดส่งซ้ำได้ที่หน้าแอดมิน → ส่งออก Google Sheet

**กล้องไม่ขึ้น**
→ ต้องเป็น https หรือ localhost และต้องกดอนุญาตสิทธิ์กล้อง
