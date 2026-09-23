-- =====================================================================
-- BPL SUPPLY — ประวัติ Asset และรูปหลักฐาน Asset ในหน้าเดียวกับสิ้นเปลือง
-- รันต่อจาก 028 · ปลอดภัยที่จะรันซ้ำ
--
-- สองเรื่อง
--   1. ประวัติการเบิก-คืนเครื่อง ต้องดูย้อนหลังได้ ถึงคืนไปแล้วก็ยังต้องอยู่
--      ของเดิมมีแต่ asset_holdings ซึ่งเก็บเฉพาะที่ยังไม่คืน
--   2. รูปตอนเบิก-คืนเครื่องไม่เคยโผล่ในหน้าหลักฐาน เพราะอยู่คนละตาราง
-- =====================================================================

-- ปุ่ม "ใช้แล้ว" ต้องใช้ได้กับรูปฝั่ง Asset ด้วย
alter table asset_txns add column if not exists evidence_archived boolean not null default false;

create index if not exists asset_txns_archived_idx
  on asset_txns (created_at desc) where not evidence_archived;

-- ---------------------------------------------------------------------
-- ประวัติการเบิก-คืนเครื่อง — หนึ่งแถวต่อหนึ่งเครื่องต่อหนึ่งครั้งที่เบิก
-- คืนแล้วแถวยังอยู่ แค่มีเวลาคืนเติมเข้ามา
-- ---------------------------------------------------------------------
drop view if exists asset_history;
create view asset_history
with (security_invoker = true) as
select
  ai.id                                   as out_item_id,
  ai.asset_code,
  a.type_code,
  ty.name                                 as type_name,
  a.dept_code                             as asset_dept,
  t.id                                    as txn_id,
  t.ref_no,
  t.user_id,
  p.full_name                             as who,
  p.employee_code,
  t.dept_code                             as holder_dept,
  p.sub_dept,
  t.shift_start,
  t.shift_end,
  t.due_at,
  t.created_at                            as taken_at,
  back.created_at                         as returned_at,
  back.ref_no                             as return_ref,
  backp.full_name                         as returned_by,
  (back.id is null)                       as still_out,
  case
    when back.created_at is not null
      then extract(epoch from (back.created_at - t.created_at)) / 3600
  end::numeric(10, 2)                     as held_hours
from asset_txn_items ai
join asset_txns t   on t.id = ai.txn_id and t.kind = 'out'
join assets a       on a.code = ai.asset_code
join asset_types ty on ty.code = a.type_code
join profiles p     on p.id = t.user_id
left join asset_txn_items back_item on back_item.out_item_id = ai.id
left join asset_txns back           on back.id = back_item.txn_id
left join profiles backp            on backp.id = back.user_id;

grant select on asset_history to authenticated;

-- ---------------------------------------------------------------------
-- หน้าหลักฐาน: รวมรูปฝั่ง Asset เข้ามาด้วย
--
-- เพิ่มสองชนิดใหม่ asset_out / asset_in และคอลัมน์ asset_type_code
-- ฝั่งสิ้นเปลืองค่าเป็น null ฝั่ง Asset ก็มี item_ids ว่าง
-- ดรอปดาวน์เลือกของจึงรวมได้ทั้งวัสดุรายชิ้นและประเภทเครื่อง
-- ---------------------------------------------------------------------
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
  null::text                                as asset_type_code,
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
  null::text,
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
where rt.evidence_file_id is not null

union all

-- ฝั่ง Asset — หนึ่งแถวต่อหนึ่งครั้งที่เบิกหรือคืน รูปผูกกับครั้งนั้น
select
  case when t.kind = 'out' then 'asset_out' else 'asset_in' end,
  t.id::text,
  t.ref_no,
  t.created_at,
  'BPL',
  (select ph.file_id from asset_txn_photos ph where ph.txn_id = t.id order by ph.seq limit 1),
  null::text,
  t.evidence_archived,
  p.full_name,
  p.employee_code,
  t.dept_code,
  p.sub_dept,
  t.shift_start,
  t.shift_end,
  t.type_code,
  true,
  ty.name || (case when t.kind = 'out' then ' เบิก ' else ' คืน ' end) ||
    coalesce((
      select count(*)::text from asset_txn_items ai where ai.txn_id = t.id
    ), '0') || ' เครื่อง — ' ||
    coalesce((
      select string_agg(ai.asset_code, ', ' order by ai.asset_code)
      from asset_txn_items ai where ai.txn_id = t.id
    ), ''),
  '{}'::bigint[],
  coalesce((
    select array_agg(ph.file_id order by ph.seq)
    from asset_txn_photos ph where ph.txn_id = t.id
  ), '{}')
from asset_txns t
join asset_types ty on ty.code = t.type_code
join profiles p     on p.id = t.user_id
where exists (select 1 from asset_txn_photos ph where ph.txn_id = t.id);

grant select on evidence_feed to authenticated;

-- ── ตัวเลือกในดรอปดาวน์: วัสดุรายชิ้น + ประเภทเครื่อง ─────────────────
create view evidence_items
with (security_invoker = true) as
select
  'i:' || i.id::text                      as key,
  i.name                                  as name,
  i.sku                                   as sub,
  'supply'::text                          as kind,
  count(*)::int                           as photo_rows
from evidence_feed e
join items i on i.id = any(e.item_ids)
group by i.id, i.name, i.sku

union all

select
  't:' || ty.code,
  ty.name,
  'อุปกรณ์ Asset',
  'asset'::text,
  count(*)::int
from evidence_feed e
join asset_types ty on ty.code = e.asset_type_code
group by ty.code, ty.name;

grant select on evidence_items to authenticated;

-- ---------------------------------------------------------------------
-- ปุ่ม "ใช้แล้ว" รองรับรูปฝั่ง Asset
-- ---------------------------------------------------------------------
create or replace function set_evidence_archived(
  p_kind      text,
  p_source_id text,
  p_archived  boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if my_role() not in ('supervisor', 'admin') then
    raise exception 'ไม่มีสิทธิ์จัดการหลักฐาน';
  end if;

  if p_kind = 'requisition' then
    update requisitions set evidence_archived = p_archived where id = p_source_id::uuid;
  elsif p_kind = 'return' then
    update returns set evidence_archived = p_archived where id = p_source_id::bigint;
  elsif p_kind in ('asset_out', 'asset_in') then
    update asset_txns set evidence_archived = p_archived where id = p_source_id::uuid;
  else
    raise exception 'ประเภทหลักฐานไม่ถูกต้อง';
  end if;
end $$;

grant execute on function set_evidence_archived(text, text, boolean) to authenticated;
