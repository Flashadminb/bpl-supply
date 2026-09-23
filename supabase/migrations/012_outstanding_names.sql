-- =====================================================================
-- BPL SUPPLY — ใส่ชื่อผู้เบิกและแผนกลงใน view ของค้างคืน
-- รันต่อจาก 011 · ปลอดภัยที่จะรันซ้ำ
--
-- เดิม view คืนแค่ requester_id ซึ่งเป็นรหัสยาว ๆ อ่านไม่รู้เรื่อง
-- หน้า "ของค้างคืน" ต้องตอบให้ได้ว่า "ใคร" ยังไม่คืน จึงต้องมีชื่อติดมาด้วย
-- =====================================================================

-- Postgres ไม่ยอมให้ create or replace view สลับตำแหน่งคอลัมน์
-- (ERROR 42P16) จึงต้อง drop ทิ้งก่อนแล้วสร้างใหม่ — view ไม่เก็บข้อมูล ไม่มีอะไรหาย
drop view if exists open_borrowings;

create or replace view open_borrowings
with (security_invoker = true) as
select
  ri.id                                         as requisition_item_id,
  r.id                                          as requisition_id,
  r.ref_no,
  r.requester_id,
  r.hub_code,
  p.full_name                                   as requester_name,
  p.employee_code                               as requester_code,
  p.dept_code                                   as requester_dept,
  i.id                                          as item_id,
  i.sku,
  i.name                                        as item_name,
  i.unit,
  i.shelf_code,
  coalesce(ri.qty_approved, 0)                  as qty_taken,
  coalesce(rt.qty_returned, 0)::int             as qty_returned,
  (coalesce(ri.qty_approved, 0) - coalesce(rt.qty_returned, 0))::int as qty_open,
  r.created_at
from requisition_items ri
join requisitions r on r.id = ri.requisition_id
join items i        on i.id = ri.item_id
join profiles p     on p.id = r.requester_id
left join lateral (
  select sum(qty)::int as qty_returned from returns where requisition_item_id = ri.id
) rt on true
where i.is_returnable
  and ri.status = 'approved'
  and coalesce(ri.qty_approved, 0) > coalesce(rt.qty_returned, 0);

grant select on open_borrowings to authenticated;
