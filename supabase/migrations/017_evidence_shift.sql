-- =====================================================================
-- BPL SUPPLY — ใส่กะและแผนกลงในหน้าหลักฐาน
-- รันต่อจาก 016 · ปลอดภัยที่จะรันซ้ำ
--
-- หน้าหลักฐานกรองได้แค่ช่วงวันกับประเภท พอมีพนักงาน 49 คน 5 กะ
-- ต้องเลือกดูเป็นรายกะได้ ไม่งั้นต้องไล่อ่านทีละแถว
-- =====================================================================

-- ── แผนกย่อย ──────────────────────────────────────────────────────────
-- ข้อความเปล่า ๆ ต่อท้ายแผนกไว้ระบุตัวคนให้ละเอียดขึ้น เช่น OUT 4W · DO1
-- ไม่มีผลกับสิทธิ์การมองเห็นใด ๆ ทั้งสิ้น เป็นแค่ป้ายกำกับ
alter table profiles add column if not exists sub_dept text;

comment on column profiles.sub_dept is
  'แผนกย่อย เป็นป้ายกำกับอย่างเดียว ไม่มีผลกับสิทธิ์';

-- คอลัมน์เพิ่มตรงกลาง create or replace view จึงไม่พอ ต้อง drop ก่อน
-- evidence_items สร้างทับ evidence_feed อีกที ต้องรื้อตัวลูกก่อนเสมอ
-- ไม่งั้นรันไฟล์นี้ซ้ำรอบสองจะติด "other objects depend on it"
drop view if exists evidence_items;
drop view if exists evidence_feed;

create view evidence_feed
with (security_invoker = true) as
select
  'requisition'::text                       as kind,
  r.id::text                                as source_id,
  r.ref_no,
  r.created_at,
  r.hub_code,
  r.evidence_file_id                        as file_id,
  r.evidence_web_link                       as web_link,
  r.evidence_archived                       as archived,
  p.full_name                               as who,
  p.employee_code,
  p.dept_code,
  p.sub_dept,
  p.shift_start,
  p.shift_end,
  coalesce((
    select bool_or(i.is_returnable)
    from requisition_items ri join items i on i.id = ri.item_id
    where ri.requisition_id = r.id
  ), false)                                 as has_returnable,
  coalesce((
    select string_agg(i.name || ' x' || ri.qty_requested, ', ' order by ri.id)
    from requisition_items ri join items i on i.id = ri.item_id
    where ri.requisition_id = r.id
  ), '')                                    as summary,
  coalesce((
    select array_agg(ph.file_id order by ph.sort_no)
    from requisition_photos ph where ph.requisition_id = r.id
  ), array[r.evidence_file_id])             as file_ids
from requisitions r
join profiles p on p.id = r.requester_id
where r.evidence_file_id is not null

union all

select
  'return'::text,
  rt.id::text,
  rq.ref_no,
  rt.created_at,
  rq.hub_code,
  rt.evidence_file_id,
  rt.evidence_web_link,
  rt.evidence_archived,
  p.full_name,
  p.employee_code,
  p.dept_code,
  p.sub_dept,
  p.shift_start,
  p.shift_end,
  true,
  i.name || ' คืน ' || rt.qty || ' (' ||
    case rt.condition when 'ok' then 'ใช้ได้' when 'damaged' then 'ชำรุด' else 'สูญหาย' end || ')',
  coalesce((
    select array_agg(ph.file_id order by ph.sort_no)
    from return_photos ph where ph.return_id = rt.id
  ), array[rt.evidence_file_id])
from returns rt
join requisition_items ri on ri.id = rt.requisition_item_id
join requisitions rq      on rq.id = ri.requisition_id
join items i              on i.id = ri.item_id
join profiles p           on p.id = rt.returned_by
where rt.evidence_file_id is not null;

grant select on evidence_feed to authenticated;

-- ── รายชื่อกะที่มีใช้จริง ──────────────────────────────────────────────
-- ดึงจากพนักงานที่มีอยู่ ไม่ต้องมาตั้งค่ากะซ้ำอีกที่
drop view if exists shifts_in_use;
create view shifts_in_use
with (security_invoker = true) as
select
  shift_start,
  shift_end,
  substring(shift_start::text, 1, 5) || ' – ' || substring(shift_end::text, 1, 5) as label,
  count(*)::int as staff_count
from profiles
where shift_start is not null and shift_end is not null and is_active
group by shift_start, shift_end
order by shift_start;

grant select on shifts_in_use to authenticated;

-- ── แผนกย่อยและกะ ให้โผล่ในหน้าของค้างคืนและหน้าส่งออกด้วย ─────────────
drop view if exists open_borrowings;
create view open_borrowings
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
  p.sub_dept                                    as requester_sub_dept,
  p.shift_start,
  p.shift_end,
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
  p.sub_dept                                    as requester_sub_dept,
  p.shift_start,
  p.shift_end,
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
where ri.status <> 'rejected';

grant select on sheet_export_rows to authenticated;
