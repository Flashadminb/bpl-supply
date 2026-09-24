-- =====================================================================
-- BPL SUPPLY — ล้างข้อมูลที่เกิดจากการทดสอบ
--
-- รันครั้งเดียวก่อนให้ทีมเริ่มทดสอบจริง
-- ⚠️ ลบแล้วเอาคืนไม่ได้ · อ่านให้จบก่อนกด Run
--
-- ลบ
--   ใบเบิกสิ้นเปลืองทั้งหมด (REQ-2569-0004 ถึง 0010) พร้อมบรรทัด รูป การคืน
--   รายการเบิก-คืน Asset ทั้งหมด พร้อมรูป
--   บาร์โค้ด BY
--   เช็คอินประชุม และนัดประชุม
--   ประวัติการโอนเครื่อง
--
-- ไม่ลบ
--   ใบแจ้งชำรุด 19 ใบ — นำเข้าจากชีต MASTER เดิม ไม่ใช่ของทดสอบ
--     (คอลัมน์ txn_id จะถูกล้างเป็นว่างเองเพราะรายการที่อ้างถึงถูกลบ
--      ตัวใบแจ้งยังอยู่ครบ อาการและวันที่ไม่เปลี่ยน)
--   ทะเบียนเครื่อง 139 เครื่อง · รายการวัสดุ · ผู้ใช้ทั้งหมด
--   stock_movements — เก็บไว้เป็นคำอธิบายว่าทำไมยอดถึงเป็นเลขนี้
--
-- ไม่แตะยอดสต็อก ตามที่เจ้าของระบบสั่ง — จะไปนับของจริงแล้วแก้ที่หน้าสต็อกเอง
-- ยอดที่ค้างจากการทดสอบคือ วัสดุ #1 ขาด 2 · #7 ขาด 2 · #9 ขาด 1
-- =====================================================================

begin;

-- ── Asset ─────────────────────────────────────────────────────────────
-- ตัดสายที่แถวคืนชี้กลับไปหาแถวเบิกก่อน ไม่งั้นลบไม่ได้เพราะติดกันเอง
update asset_txn_items set out_item_id = null where out_item_id is not null;

-- เครื่องทุกตัวกลับสู่สถานะว่าง
update assets set held_item_id = null, loan_dept = null;

delete from asset_transfers;
delete from asset_txns;          -- items กับ photos หลุดตามเอง

-- ── สิ้นเปลือง ────────────────────────────────────────────────────────
delete from requisitions;        -- items, photos, sync_log, returns, sheet_exports หลุดตามเอง

-- ── BY และประชุม ─────────────────────────────────────────────────────
delete from by_barcodes;
delete from meeting_checkins;
delete from meeting_events;

-- ── ล้างบันทึกแจ้งเตือน จะได้ไม่ค้างว่าเคยเตือนเรื่องที่ลบไปแล้ว ──────
delete from notification_log;

commit;


-- ---------------------------------------------------------------------
-- ตรวจผลหลังรัน — ทุกบรรทัดควรเป็น 0 ยกเว้นใบแจ้งชำรุดที่ต้องเหลือ 19
-- ---------------------------------------------------------------------
select 'ใบเบิกสิ้นเปลือง'      as รายการ, count(*) as เหลือ from requisitions
union all select 'การคืน',              count(*) from returns
union all select 'รายการ Asset',        count(*) from asset_txns
union all select 'เครื่องที่ยังไม่คืน',   count(*) from assets where held_item_id is not null
union all select 'บาร์โค้ด BY',          count(*) from by_barcodes
union all select 'เช็คอินประชุม',        count(*) from meeting_checkins
union all select 'นัดประชุม',            count(*) from meeting_events
union all select 'การโอนเครื่อง',        count(*) from asset_transfers
union all select '--- ต้องเหลือ ---',    null
union all select 'ใบแจ้งชำรุด (เก็บไว้)', count(*) from asset_issues
union all select 'ทะเบียนเครื่อง',        count(*) from assets
union all select 'รายการวัสดุ',          count(*) from items
union all select 'ผู้ใช้',               count(*) from profiles;
