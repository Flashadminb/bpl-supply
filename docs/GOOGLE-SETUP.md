# การเชื่อมต่อ Google — ฉบับที่ใช้จริง

> เอกสารนี้แทนที่หัวข้อที่ 6–7 ใน `SETUP.md` เฉพาะส่วน Google
> `SETUP.md` ฉบับเดิมเขียนไว้ว่าใช้ service account กับทั้ง Drive และ Sheets
> ตอนติดตั้งจริงพบว่าใช้กับ Drive ไม่ได้ จึงเปลี่ยนวิธีเฉพาะฝั่ง Drive

---

## ทำไมต้องใช้คนละวิธีกัน 2 ฝั่ง

| ปลายทาง | ใช้อะไร | เหตุผล |
|---|---|---|
| **Google Sheet** | service account | เขียนชีตไม่กินพื้นที่เก็บข้อมูล service account จึงทำได้ปกติ |
| **Google Drive** | OAuth ในนามเจ้าของระบบ | **service account ไม่มีโควตาพื้นที่ของตัวเอง** อัปไฟล์ไม่ได้ |

ข้อความที่ Google ตอบกลับตอนลองใช้ service account อัปไฟล์

```
Service Accounts do not have storage quota.
Leverage shared drives, or use OAuth delegation instead.
```

**"ไดรฟ์ที่แชร์" (Shared drive) เป็นฟีเจอร์ของ Google Workspace แบบเสียเงินเท่านั้น**
บัญชี Gmail ธรรมดา แม้ซื้อ Google One 100 GB แล้วก็สร้างไม่ได้

จึงเปลี่ยนเป็นให้แอปอัปไฟล์ **ในนามบัญชี Google ของเจ้าของระบบ** ไฟล์เป็นของเขา
กินโควตา Google One ของเขา และเขาเปิดดูได้ตามปกติ

---

## Secrets ที่ต้องตั้งใน Supabase

Dashboard → Edge Functions → Secrets

| ชื่อ | ใช้กับ | ได้มาจาก |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | Drive | ไฟล์ `client_secret_*.json` |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Drive | ไฟล์ `client_secret_*.json` |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | Drive | ได้จากการกดอนุญาตครั้งแรก |
| `GDRIVE_FOLDER_ID` | Drive | โฟลเดอร์ที่ **แอปสร้างเอง** ไม่ใช่ที่สร้างมือ |
| `GOOGLE_SA_EMAIL` | Sheets | ไฟล์ JSON ของ service account |
| `GOOGLE_SA_PRIVATE_KEY` | Sheets | ไฟล์ JSON ของ service account |
| `GSHEET_ID` | Sheets | จาก URL ของชีต |
| `GSHEET_TAB` | Sheets | `บันทึกการเบิก-คืน` |

---

## ข้อควรระวังเรื่องโฟลเดอร์ Drive

scope ที่ใช้คือ `drive.file` ซึ่งแอปจะเห็น**เฉพาะไฟล์ที่ตัวเองสร้าง**เท่านั้น

แปลว่า **โฟลเดอร์ที่สร้างมือใน Google Drive ใช้ไม่ได้** จะขึ้น `File not found`
ต้องให้แอปสร้างโฟลเดอร์เอง แล้วเอา id นั้นมาใส่ `GDRIVE_FOLDER_ID`

เลือก `drive.file` แทน `drive` เต็ม เพราะ Google ถือว่าไม่ใช่ scope อันตราย
จึงไม่ต้องส่งแอปให้ Google ตรวจสอบ (ถ้าใช้ scope เต็มต้องรออนุมัติเป็นสัปดาห์)
และแอปแตะไฟล์อื่นในไดรฟ์ไม่ได้เลย ปลอดภัยกว่าด้วย

---

## ⚠️ ค้างอยู่: refresh token หมดอายุทุก 7 วัน

ตอนตั้งค่า แอป OAuth ถูกทิ้งไว้สถานะ **Testing** เพราะปุ่ม Publish กดไม่ได้ตอนนั้น
Google กำหนดว่าแอปสถานะ Testing จะทำให้ refresh token หมดอายุทุก 7 วัน

**อาการเมื่อหมดอายุ:** ช่อง `GDV` ขึ้น `!` และมีข้อความว่า
*สิทธิ์เข้าถึง Google Drive หมดอายุแล้ว ให้เจ้าของระบบกดอนุญาตใหม่*

**วิธีแก้ถาวร** — เปลี่ยนสถานะเป็น In production

1. เปิด <https://console.cloud.google.com/auth/audience>
2. หา **Publishing status** → กด **PUBLISH APP** → **CONFIRM**
3. กดอนุญาตใหม่อีกครั้งเพื่อรับ refresh token ตัวใหม่ที่ไม่หมดอายุ

เนื่องจากใช้แค่ scope `drive.file` ซึ่งไม่ใช่ scope อันตราย การ Publish
**ไม่ต้องรอ Google ตรวจสอบ** มีผลทันที

---

## วิธีขอ refresh token ใหม่

ถ้าหมดอายุหรือเปลี่ยนบัญชี ให้รันสคริปต์ `oauth.mjs` (อยู่ในโฟลเดอร์ scratchpad ของเซสชันที่ติดตั้ง)
หรือทำมือ

1. เปิด URL นี้ในเบราว์เซอร์ที่ล็อกอินบัญชีเจ้าของระบบอยู่ (แทน `CLIENT_ID`)

```
https://accounts.google.com/o/oauth2/v2/auth?client_id=CLIENT_ID&redirect_uri=http://localhost:53682&response_type=code&scope=https://www.googleapis.com/auth/drive.file&access_type=offline&prompt=consent
```

2. ต้องมีอะไรรับที่ `http://localhost:53682` เพื่อดัก `?code=...`
3. เอา code ไปแลก refresh token

```
POST https://oauth2.googleapis.com/token
  code, client_id, client_secret,
  redirect_uri=http://localhost:53682,
  grant_type=authorization_code
```

4. เอา `refresh_token` ที่ได้ไปอัปเดต secret `GOOGLE_OAUTH_REFRESH_TOKEN`

---

## บันทึกบั๊กที่เจอระหว่างติดตั้ง

| อาการ | สาเหตุ | แก้ที่ |
|---|---|---|
| `File not found: <folderId>` | โฟลเดอร์สร้างมือ แอป scope `drive.file` มองไม่เห็น | ให้แอปสร้างโฟลเดอร์เอง |
| `Service Accounts do not have storage quota` | service account อัปไฟล์เข้าไดรฟ์ส่วนตัวไม่ได้ | เปลี่ยนไปใช้ OAuth |
| `column "state" is of type sync_state but expression is of type text` | `schema.sql` ต้นฉบับใส่ `case ... end` ใน `sync_log` โดยไม่ cast ชนิด | `001_init.sql` cast เป็น `::sync_state` แล้ว |
| `access_denied` ตอนกดอนุญาต | แอป OAuth อยู่สถานะ Testing และยังไม่ได้ใส่ตัวเองเป็น Test user | Audience → Test users |
