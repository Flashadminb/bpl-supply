-- =====================================================================
-- BPL SUPPLY — ลบใบเบิกที่เคยถูกโอนได้
-- รันต่อจาก 048 · ปลอดภัยที่จะรันซ้ำ
--
-- 048 แก้ตัวชี้ระหว่างแถวเบิกกับแถวคืนไปแล้ว แต่ยังเหลืออีกตัวที่ชี้มาที่เดียวกัน
--   asset_transfers.out_item_id → asset_txn_items
-- ประวัติการโอนเครื่องจำไว้ว่า "ตัดของจากการเบิกแถวไหน"
-- พอลบใบเบิกนั้น ตัวชี้ก็ค้าง ฐานข้อมูลเลยไม่ยอมลบเหมือนเดิม
--
-- ไล่ตรวจทั้งฐานข้อมูลแล้ว เหลือตัวนี้ตัวเดียวที่ขวางการลบใบเบิก
-- อีกสองตัวที่ยังเป็น NO ACTION คือ asset_code ที่ชี้ไปตารางทะเบียนเครื่อง
-- สองตัวนั้นตั้งใจให้ขวาง เพราะห้ามลบเครื่องออกจากทะเบียนทั้งที่มีประวัติใช้งานอยู่
--
-- ล้างตัวชี้เป็นว่างแทนการลบแถวโอนตาม เพราะการโอนเกิดขึ้นจริง
-- ลบทิ้งคือลบหลักฐานว่าเครื่องเคยถูกย้ายมือ ซึ่งเป็นคนละเรื่องกับการลบใบเบิก
-- =====================================================================

alter table asset_transfers
  drop constraint if exists asset_transfers_out_item_id_fkey;

alter table asset_transfers
  add constraint asset_transfers_out_item_id_fkey
  foreign key (out_item_id) references asset_txn_items(id) on delete set null;


-- ---------------------------------------------------------------------
-- ตรวจผล — ต้องไม่เหลือตัวไหนชี้มาที่ asset_txn_items แบบ NO ACTION
-- ---------------------------------------------------------------------
select tc.table_name || '.' || kcu.column_name || '  [' || rc.delete_rule || ']' as ผลตรวจ
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
  join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
  join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name
 where tc.constraint_type = 'FOREIGN KEY'
   and ccu.table_name = 'asset_txn_items'
 order by 1;
