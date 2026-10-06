-- =====================================================================
-- BPL SUPPLY — เพิ่มประเภทเครื่อง "เครื่องลาเบลพกพา"
-- รันต่อจาก 113 · ปลอดภัยที่จะรันซ้ำ
--
-- photo_min = 1 คือกฎบังคับถ่ายรูปอย่างน้อยหนึ่งใบ
-- ฐานข้อมูลเป็นคนบังคับ ไม่ใช่หน้าจอ · RPC เบิกและคืนอ่านค่านี้ก่อนรับงานเสมอ
-- ซ่อนปุ่มอย่างเดียวไม่พอ เพราะคนที่รู้ทางเรียก API ตรงก็ยังข้ามได้
-- =====================================================================

insert into asset_types (code, name, sort_no, photo_min, photo_max, issue_tags)
values (
  'LABEL',
  'เครื่องลาเบลพกพา',
  5,
  1,
  5,
  array['พิมพ์ไม่ออก','กระดาษติด','หัวพิมพ์เสีย','แบตเสื่อม','ชาร์จไม่เข้า','ต่อบลูทูธไม่ได้','ฝาหาย']
)
on conflict (code) do update set
  name       = excluded.name,
  sort_no    = excluded.sort_no,
  photo_min  = excluded.photo_min,
  photo_max  = excluded.photo_max,
  issue_tags = excluded.issue_tags,
  is_active  = true;


-- ---------------------------------------------------------------------
-- ตรวจผล · ดูกฎรูปของทุกประเภทพร้อมกัน
-- ---------------------------------------------------------------------
select
  code                                                        as รหัส,
  name                                                        as ชื่อ,
  sort_no                                                     as ลำดับ,
  photo_min                                                   as รูปอย่างน้อย,
  photo_max                                                   as รูปมากสุด,
  (select count(*) from asset_photo_steps s where s.type_code = t.code) as ขั้นตอนบังคับ,
  is_active                                                   as เปิดใช้
from asset_types t
order by sort_no;
