-- =====================================================================
-- BPL SUPPLY — ย้ายข้อมูลเครื่องจากชีต MASTER เข้าระบบ
-- รันต่อจาก 013 · ปลอดภัยที่จะรันซ้ำ (ไม่ทับของที่แก้ไว้แล้ว)
--
-- ที่มา: "ตั้งค่าระบบถ่ายรูปอัพเดทงาน (MASTER)" แท็บ เครื่อง / หัวข้อ /
--        ช่องถ่ายรูป / เงื่อนไข — ยกมาตรงตามชีตทุกตัวอักษร
--
-- สรุป: Power Pallet 31 · ไอดาต้า 71 · เลเซอร์ลบ 32 · วิทยุสื่อสาร 5
--        รวม 139 เครื่อง · อาการค้าง 19 รายการ
-- =====================================================================

-- ── ประเภท ────────────────────────────────────────────────────────────
insert into asset_types (code, name, sort_no, photo_min, photo_max, issue_tags) values
  ('PP',    'Power Pallet', 1, 5, 6,
     array['แบตไม่เก็บไฟ','ยกไม่ขึ้น','ล้อชำรุด','จอไม่ติด','มีเสียงดัง','น้ำมันรั่ว']),
  ('IDATA', 'ไอดาต้า',      2, 1, 5,
     array['หน้าจอแตก','แบตบวม','ฝาหาย','ความจำเต็ม']),
  ('RADIO', 'วิทยุสื่อสาร',  3, 1, 5,
     array['เสาหัก','แบตเสื่อม','ปุ่มกดไม่ติด','เสียงแตก','ชาร์จไม่เข้า']),
  ('LASER', 'เลเซอร์ลบ',     4, 1, 5,
     array['ยิงไม่ออก','แบตเสื่อม','ชาร์จไม่เข้า','ปุ่มกดไม่ติด','สายชาร์จหาย'])
on conflict (code) do nothing;

-- ── ขั้นตอนถ่ายรูปบังคับ — มีเฉพาะ Power Pallet ───────────────────────
-- ไอดาต้า / วิทยุ / เลเซอร์ ไม่มีขั้นบังคับ ถ่ายอิสระ 1–5 ใบ
insert into asset_photo_steps (type_code, seq, label, hint) values
  ('PP', 1, 'กุญแจ',    'ให้เห็นกุญแจเสียบที่เครื่อง + เลขตัวเครื่อง'),
  ('PP', 2, 'ด้านหน้า', 'ยืนห่าง 2 เมตร ให้เห็นทั้งคัน'),
  ('PP', 3, 'ด้านหลัง', 'ยืนห่าง 2 เมตร ให้เห็นทั้งคัน'),
  ('PP', 4, 'ด้านซ้าย', 'ยืนห่าง 2 เมตร ให้เห็นทั้งคัน'),
  ('PP', 5, 'ด้านขวา',  'ยืนห่าง 2 เมตร ให้เห็นทั้งคัน')
on conflict (type_code, seq) do nothing;

-- ── ทะเบียนเครื่อง ────────────────────────────────────────────────────
-- สถานะ "ซ่อม" ในชีต = is_enabled false (เบิกไม่ได้จนกว่าจะเปิดเอง)

-- Power Pallet ── PP-01..PP-16 (ไม่มี 17) และ PP-18..PP-32
insert into assets (code, type_code, dept_code, is_enabled)
select 'PP-' || lpad(n::text, 2, '0'), 'PP',
       case when n in (14, 15) then 'INLHBG'
            when n >= 18       then 'BULKY'
            else 'OUT4W' end,
       n not in (3, 14)
from generate_series(1, 32) n
where n <> 17
on conflict (code) do nothing;

-- ไอดาต้า ── ประจำแผนก
insert into assets (code, type_code, dept_code, is_enabled)
select 'IN LH + BG ' || lpad(n::text, 2, '0'), 'IDATA', 'INLHBG', true
from generate_series(1, 10) n on conflict (code) do nothing;

insert into assets (code, type_code, dept_code, is_enabled)
select 'IN FD ' || lpad(n::text, 2, '0'), 'IDATA', 'INFD', n <> 8
from generate_series(1, 11) n on conflict (code) do nothing;

insert into assets (code, type_code, dept_code, is_enabled)
select 'REPACK ' || lpad(n::text, 2, '0'), 'IDATA', 'REPACK', n <> 8
from generate_series(1, 8) n on conflict (code) do nothing;

insert into assets (code, type_code, dept_code, is_enabled)
select 'BULKY ' || lpad(n::text, 2, '0'), 'IDATA', 'BULKY', n <> 2
from generate_series(1, 7) n on conflict (code) do nothing;

insert into assets (code, type_code, dept_code, is_enabled)
select 'OUT 4W ' || lpad(n::text, 2, '0'), 'IDATA', 'OUT4W', true
from generate_series(1, 14) n on conflict (code) do nothing;

insert into assets (code, type_code, dept_code, is_enabled)
select 'OUT 6W ' || lpad(n::text, 2, '0'), 'IDATA', 'OUT6W', n <> 8
from generate_series(1, 15) n on conflict (code) do nothing;

insert into assets (code, type_code, dept_code, is_enabled)
select 'MINI ' || n, 'IDATA', 'MINICS', true
from generate_series(1, 4) n on conflict (code) do nothing;

insert into assets (code, type_code, dept_code, is_enabled) values
  ('LH 4W', 'IDATA', 'OUT4W', true),
  ('LH 6W', 'IDATA', 'OUT6W', true)
on conflict (code) do nothing;

-- เลเซอร์ลบ ── ส่วนกลาง ทุกแผนกทุกกะเห็น
insert into assets (code, type_code, dept_code, is_enabled)
select 'BPL ' || lpad(n::text, 2, '0'), 'LASER', 'ALL', n <> 15
from generate_series(1, 32) n on conflict (code) do nothing;

-- วิทยุสื่อสาร ── ส่วนกลาง
insert into assets (code, type_code, dept_code, is_enabled)
select 'วิทยุสื่อสาร ' || lpad(n::text, 2, '0'), 'RADIO', 'ALL', true
from generate_series(1, 5) n on conflict (code) do nothing;

-- ── อาการชำรุดที่ยังค้าง ──────────────────────────────────────────────
-- ยกมาตรงตามชีต รวมถึงกรณีที่ดูเหมือนแจ้งซ้ำข้ามเครื่อง
-- (OUT 4W 09–12 และ REPACK 01/02/06) — เคลียร์ทิ้งได้ทีเดียวในหน้าทะเบียนเครื่อง
insert into asset_issues (asset_code, phase, symptom, reported_name, reported_at)
select v.code, v.phase::asset_txn_kind, v.symptom, v.who, v.at::timestamptz
from (values
  ('PP-10',         'in',  'ที่ดึงเปิดปิดเสีย',                        'นาย อับดุลลาฟิก อาแว',        '2026-08-23'),
  ('PP-15',         'in',  'จอไม่ติด',                                  'นางสาว สุพัตรา อันทะโย',      '2026-08-20'),
  ('PP-16',         'in',  'ที่เหยียบชำรุด',                            'นางสาว ขวัญสุข แก่นนอก',      '2026-08-15'),
  ('PP-24',         'out', 'จอไม่ติด',                                  'นายณัฐิวุฒิ จั่นมาก',          '2026-09-08'),
  ('PP-25',         'out', 'พักเท้ามีอาการง้างเล็กน้อย',                 'นางสาว ดลฤดี แสงบรรลือฤทธิ์', '2026-08-27'),
  ('PP-28',         'in',  'ยางหลุด ที่ใส่กุญแจหลวม',                    'นางสาว ดลฤดี แสงบรรลือฤทธิ์', '2026-09-04'),
  ('PP-32',         'in',  'ชาร์จแบตไม่เข้า',                           'นาย ธวัชชัย ทองติด',          '2026-09-14'),
  ('IN FD 03',      'in',  'ความจำเต็ม',                                'นาย ธวัชชัย ทองติด',          '2026-09-16'),
  ('IN FD 11',      'out', 'หน้าจอแตก',                                 'นาย ธวัชชัย ทองติด',          '2026-09-01'),
  ('REPACK 01',     'in',  'หน้าจอแตก (แจ้งรวม เบอร์ 1 เบอร์ 2 เบอร์ 5)', 'นาย ชินวัตร แสงเงิน',         '2026-09-18'),
  ('REPACK 02',     'in',  'หน้าจอแตก (แจ้งรวม เบอร์ 1 เบอร์ 2 เบอร์ 5)', 'นาย ชินวัตร แสงเงิน',         '2026-09-18'),
  ('REPACK 06',     'in',  'หน้าจอแตก (แจ้งรวม เบอร์ 1 เบอร์ 2 เบอร์ 5)', 'นาย ชินวัตร แสงเงิน',         '2026-09-18'),
  ('OUT 4W 09',     'in',  'จอแตก ส่งซ่อม',                             'นางสาว พีรยา บุญอยู่',         '2026-09-21'),
  ('OUT 4W 10',     'in',  'แจ้งรวมกับเบอร์ 09 จอแตก ส่งซ่อม',           'นางสาว พีรยา บุญอยู่',         '2026-09-21'),
  ('OUT 4W 11',     'in',  'แจ้งรวมกับเบอร์ 09 จอแตก ส่งซ่อม',           'นางสาว พีรยา บุญอยู่',         '2026-09-21'),
  ('OUT 4W 12',     'in',  'แจ้งรวมกับเบอร์ 09 จอแตก ส่งซ่อม',           'นางสาว พีรยา บุญอยู่',         '2026-09-21'),
  ('OUT 6W 04',     'in',  'อัปเดตเวอร์ชันใหม่',                        'นางสาว เนรัชญา แม้นวิลัย',     '2026-08-21'),
  ('MINI 2',        'in',  'ชาร์จแบตไม่ได้',                            'นางสาว จิตติมา บุญทอง',       '2026-08-17'),
  ('วิทยุสื่อสาร 01', 'in',  'เสียงดับ ๆ ติด ๆ',                          'นาย ชินวัตร แสงเงิน',         '2026-09-02')
) as v(code, phase, symptom, who, at)
join assets a on a.code = v.code
where not exists (
  select 1 from asset_issues x
   where x.asset_code = v.code and x.symptom = v.symptom and x.resolved_at is null
);
