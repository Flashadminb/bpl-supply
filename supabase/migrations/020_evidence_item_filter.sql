-- =====================================================================
-- BPL SUPPLY — เลือกดูหลักฐานเฉพาะวัสดุที่ต้องการ
-- รันต่อจาก 019 · ปลอดภัยที่จะรันซ้ำ
--
-- พอของเบิกเยอะขึ้น หน้าหลักฐานจะปนกันจนหาไม่เจอว่ารายการไหนคือของอะไร
-- เดิมชื่อของอยู่ในข้อความสรุปก้อนเดียว กรองด้วยไม่ได้
-- จึงแนบรหัสวัสดุมาเป็นชุด ให้กรองที่ฐานข้อมูลได้ตรง ๆ
-- =====================================================================

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
    select array_agg(distinct ri.item_id)
    from requisition_items ri where ri.requisition_id = r.id
  ), '{}')                                  as item_ids,
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
  array[i.id],
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

-- ── รายชื่อวัสดุที่เคยมีหลักฐานจริง ─────────────────────────────────────
-- ดรอปดาวน์ควรมีเฉพาะของที่มีรูปให้ดู ไม่ใช่ทั้งคลัง
drop view if exists evidence_items;
create view evidence_items
with (security_invoker = true) as
select i.id as item_id, i.sku, i.name, count(*)::int as photo_rows
from evidence_feed e
join items i on i.id = any(e.item_ids)
group by i.id, i.sku, i.name
order by i.name;

grant select on evidence_items to authenticated;
