-- =====================================================================
-- BPL SUPPLY — ล้างข้อมูลทดสอบรอบสอง (25 ก.ย. 2569)
--
-- ⚠️ ลบแล้วเอาคืนไม่ได้
--
-- ลบ
--   ใบเบิกสิ้นเปลือง 1 ใบ พร้อมบรรทัด รูป การคืน
--   ใบเบิก-คืน Asset 20 ใบ พร้อมรูป
--   ประวัติการโอนเครื่อง 7 รายการ
--   บาร์โค้ด BY 3 รายการ
--   ใบแจ้งชำรุดที่แจ้งวันที่ 24 ก.ย. เป็นต้นมา (ของทดสอบ)
--   บันทึกการแจ้งเตือน
--
-- คืนสต็อกให้ด้วย ต่างจากรอบแรกที่เจ้าของระบบสั่งไม่ให้แตะ
-- เพราะของไม่ได้ถูกเบิกออกไปจริง ยอดจึงต้องกลับไปเท่าก่อนทดสอบ
--
-- ไม่ลบ
--   ใบแจ้งชำรุดเดิม 19 ใบ — นำเข้าจากชีต MASTER ไม่ใช่ของทดสอบ
--   ทะเบียนเครื่อง 139 · รายการวัสดุ 20 · ผู้ใช้ทั้งหมด
--
-- หมายเหตุ: แถวที่เขียนลง Google Sheet ไปแล้วจะยังอยู่ในชีต
-- ฐานข้อมูลลบได้ แต่ชีตเป็นคนละที่ ต้องไปลบแถวในชีตเอง
-- =====================================================================

begin;

-- ── คืนสต็อกก่อน ต้องทำก่อนลบใบเบิก ไม่งั้นไม่รู้แล้วว่าต้องคืนเท่าไหร่ ──
-- นับเฉพาะที่เบิกออกไปจริง หักส่วนที่คืนมาแล้วออก จะได้ไม่คืนซ้ำ
with back as (
  select ri.item_id,
         sum(coalesce(ri.qty_approved, 0) - coalesce(rt.n, 0))::int as qty
    from requisition_items ri
    left join lateral (
      select sum(qty)::int as n from returns where requisition_item_id = ri.id
    ) rt on true
   where ri.status = 'approved'
   group by ri.item_id
)
update items i
   set qty_on_hand = i.qty_on_hand + b.qty
  from back b
 where b.item_id = i.id and b.qty > 0;

-- ── Asset ─────────────────────────────────────────────────────────────
update assets set held_item_id = null, loan_user = null, loan_dept = null;

delete from asset_transfers;
delete from asset_txns;          -- items กับ photos หลุดตามเอง

-- ── สิ้นเปลือง ────────────────────────────────────────────────────────
delete from requisitions;        -- items, photos, returns, sheet_exports หลุดตามเอง

-- ── BY และประชุม ─────────────────────────────────────────────────────
delete from by_barcodes;         -- lines กับ photos หลุดตามเอง
delete from meeting_checkins;
delete from meeting_events;

-- ── ใบแจ้งชำรุดของทดสอบ เก็บของเดิมไว้ ───────────────────────────────
delete from asset_issues where reported_at >= '2026-09-24';

-- ── ล้างบันทึกแจ้งเตือน จะได้ไม่ค้างว่าเคยเตือนเรื่องที่ลบไปแล้ว ──────
delete from notification_log;

commit;


-- ---------------------------------------------------------------------
-- ตรวจผล — ต้องเป็น 0 ทั้งหมด ยกเว้นบรรทัดที่บอกว่าต้องเหลือ
-- ---------------------------------------------------------------------
select 'ใบเบิกสิ้นเปลือง' as รายการ, count(*)::text as เหลือ from requisitions
union all select 'ใบเบิก-คืน Asset', count(*)::text from asset_txns
union all select 'เครื่องที่ยังไม่คืน', count(*)::text from assets where held_item_id is not null
union all select 'ประวัติการโอน', count(*)::text from asset_transfers
union all select 'บาร์โค้ด BY', count(*)::text from by_barcodes
union all select 'เช็คอินประชุม', count(*)::text from meeting_checkins
union all select '--- ต้องเหลือ ---', ''
union all select 'ใบแจ้งชำรุดเดิม', count(*)::text from asset_issues
union all select 'ทะเบียนเครื่อง', count(*)::text from assets
union all select 'รายการวัสดุ', count(*)::text from items
union all select 'ผู้ใช้', count(*)::text from profiles
union all select '--- สต็อกที่คืนกลับ ---', ''
union all select i.name, i.qty_on_hand::text
  from items i where i.name in ('มาร์กเกอร์', 'ไม้กวาดทางมะพร้าว', 'ไม้กวาดดอกหญ้า');
