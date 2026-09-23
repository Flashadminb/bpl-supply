-- =====================================================================
-- BPL SUPPLY — รู้ว่าบรรทัดไหนส่งเข้าชีตแล้ว บรรทัดไหนยังไม่ส่ง
-- รันต่อจาก 014 · ปลอดภัยที่จะรันซ้ำ
--
-- ตาราง sheet_exports จำอยู่แล้วว่าบรรทัดไหนไปอยู่แท็บไหนแถวที่เท่าไหร่
-- แต่หน้าเว็บยังไม่เคยเอามาใช้ เลยมองไม่ออกว่าอันไหนส่งไปแล้ว
-- view นี้ต่อให้ครบในที่เดียว กรอง "ยังไม่ส่ง" ได้ที่ฐานข้อมูลเลย
-- ไม่ต้องดึงทั้งเดือนมาแล้วค่อยมานั่งคัดในเบราว์เซอร์
-- =====================================================================

drop view if exists sheet_export_rows;
create view sheet_export_rows
with (security_invoker = true) as
select
  ri.id                                         as line_id,
  r.id                                          as requisition_id,
  r.ref_no,
  r.created_at,
  r.hub_code,
  r.evidence_file_id,
  r.evidence_web_link,
  p.full_name                                   as requester_name,
  p.employee_code                               as requester_code,
  p.dept_code                                   as requester_dept,
  i.sku,
  i.name                                        as item_name,
  i.unit,
  coalesce(ri.qty_approved, ri.qty_requested)   as qty,
  se.tab,
  se.row_no,
  se.exported_at,
  (se.requisition_item_id is not null)          as is_exported
from requisition_items ri
join requisitions r on r.id = ri.requisition_id
join items i        on i.id = ri.item_id
join profiles p     on p.id = r.requester_id
left join sheet_exports se on se.requisition_item_id = ri.id
-- ตรงกับที่ Edge Function ส่งจริง — ข้ามเฉพาะบรรทัดที่ถูกปฏิเสธ
where ri.status <> 'rejected';

grant select on sheet_export_rows to authenticated;

comment on view sheet_export_rows is
  'บรรทัดที่ส่งเข้าชีตได้ พร้อมสถานะว่าส่งไปแล้วหรือยัง อยู่แท็บไหนแถวที่เท่าไหร่';
