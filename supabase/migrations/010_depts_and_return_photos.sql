-- =====================================================================
-- BPL SUPPLY — แผนกแทนฮับ + รูปตอนคืนหลายใบและบังคับถ่าย
-- รันต่อจาก 009 · ปลอดภัยที่จะรันซ้ำ
--
-- 1. ใช้ฮับเดียว (BPL) จึงเลิกใช้ฮับเป็นตัวแบ่ง เปลี่ยนเป็น "แผนก"
--    คอลัมน์ hub_code ยังอยู่เพื่อไม่ให้ของเดิมพัง แต่ไม่ใช้แบ่งสิทธิ์แล้ว
-- 2. ของประเภทยืม-คืน บังคับถ่ายรูปตอนคืน และแนบได้หลายใบเหมือนตอนเบิก
-- =====================================================================

-- ── แผนก ──────────────────────────────────────────────────────────────
create table if not exists departments (
  code      text primary key,
  name      text not null,
  sort_no   integer not null default 0,
  is_active boolean not null default true
);

insert into departments (code, name, sort_no) values
  ('ALL',      'ทุกแผนก',   0),
  ('OUT4W',    'OUT 4W',    1),
  ('OUT6W',    'OUT 6W',    2),
  ('INLHBG',   'IN LH+BG',  3),
  ('INFD',     'IN FD',     4),
  ('BULKY',    'BULKY',     5),
  ('REPACK',   'REPACK',    6),
  ('MINICS',   'MINI CS',   7)
on conflict (code) do nothing;

alter table departments enable row level security;
drop policy if exists read_departments on departments;
create policy read_departments on departments for select to authenticated using (true);
drop policy if exists write_departments on departments;
create policy write_departments on departments for all to authenticated
  using (my_role() in ('supervisor', 'admin'))
  with check (my_role() in ('supervisor', 'admin'));

-- ── คนอยู่แผนกไหน และเห็นแผนกอื่นได้บ้าง ───────────────────────────────
alter table profiles
  add column if not exists dept_code   text references departments(code),
  -- แผนกพิเศษที่คนนี้เห็นเพิ่มนอกจากแผนกตัวเอง เตรียมไว้ตอนย้ายเครื่องเข้าระบบ
  add column if not exists extra_depts text[] not null default '{}';

comment on column profiles.extra_depts is
  'แผนกเพิ่มเติมที่ผู้ใช้คนนี้มองเห็นของได้ นอกเหนือจาก dept_code ของตัวเอง';

update profiles set dept_code = 'ALL' where dept_code is null;

-- ── ของอยู่แผนกไหน ────────────────────────────────────────────────────
alter table items
  add column if not exists dept_code text references departments(code);

-- ของสิ้นเปลืองเดิมให้ทุกแผนกเห็นหมด ไม่งั้นของหายไปจากหน้าจอทันทีที่รัน
update items set dept_code = 'ALL' where dept_code is null;

create index if not exists items_dept_idx on items (dept_code) where is_active;

-- ── ใครเห็นของชิ้นไหน ─────────────────────────────────────────────────
create or replace function my_depts() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array[dept_code] || extra_depts, '{}') from profiles where id = auth.uid();
$$;

grant execute on function my_depts() to authenticated;

-- แทน read_items เดิมที่กรองด้วยฮับ
drop policy if exists read_items on items;
create policy read_items on items for select to authenticated using (
  my_role() in ('supervisor', 'admin')                 -- แอดมินเห็นหมด
  or dept_code = 'ALL'                                 -- ของกลางทุกคนเห็น
  or 'ALL' = any(my_depts())                           -- คนที่อยู่ "ทุกแผนก" เห็นหมด
  or dept_code = any(my_depts())                       -- แผนกตัวเอง + แผนกพิเศษ
);

-- ── รูปตอนคืน หลายใบ ──────────────────────────────────────────────────
create table if not exists return_photos (
  id         bigserial primary key,
  return_id  bigint not null references returns(id) on delete cascade,
  file_id    text not null,
  web_link   text,
  bytes      integer,
  sort_no    integer not null default 0,
  created_at timestamptz not null default now(),
  unique (return_id, file_id)
);

create index if not exists return_photos_idx on return_photos (return_id, sort_no);

alter table return_photos enable row level security;
drop policy if exists read_return_photos on return_photos;
create policy read_return_photos on return_photos for select to authenticated using (
  exists (
    select 1 from returns rt
    where rt.id = return_id
      and (rt.returned_by = auth.uid() or my_role() in ('supervisor', 'admin'))
  )
);

-- ── บังคับถ่ายรูปตอนคืน ───────────────────────────────────────────────
-- ตรวจที่ฐานข้อมูล ไม่ใช่แค่ซ่อนปุ่ม แก้ HTML ในเครื่องแล้วยิงตรงก็ยังไม่ผ่าน
create or replace function create_return(
  p_line_id   bigint,
  p_qty       integer,
  p_condition return_cond default 'ok',
  p_file_id   text default null,
  p_link      text default null,
  p_photos    jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor    profiles%rowtype;
  v_line     requisition_items%rowtype;
  v_req      requisitions%rowtype;
  v_item     items%rowtype;
  v_returned integer;
  v_after    integer;
  v_id       bigint;
  v_photo    jsonb;
  v_n        integer := 0;
  v_main     text := p_file_id;
begin
  select * into v_actor from profiles where id = auth.uid();
  if not found or not v_actor.is_active then
    raise exception 'ไม่พบผู้ใช้หรือบัญชีถูกระงับ';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'จำนวนที่คืนไม่ถูกต้อง';
  end if;

  select * into v_line from requisition_items where id = p_line_id;
  if not found then
    raise exception 'ไม่พบบรรทัดรายการ';
  end if;
  select * into v_req from requisitions where id = v_line.requisition_id;

  if v_req.requester_id <> v_actor.id and v_actor.role = 'staff' then
    raise exception 'คืนได้เฉพาะของที่ตัวเองเบิก';
  end if;
  if v_line.status <> 'approved' then
    raise exception 'บรรทัดนี้ยังไม่ได้อนุมัติ จึงยังคืนไม่ได้';
  end if;

  if v_main is null then
    v_main := p_photos->0->>'file_id';
  end if;
  if v_main is null then
    raise exception 'ต้องถ่ายรูปสภาพตอนคืนอย่างน้อย 1 ใบ';
  end if;

  select coalesce(sum(qty), 0) into v_returned from returns where requisition_item_id = p_line_id;
  if v_returned + p_qty > coalesce(v_line.qty_approved, 0) then
    raise exception 'คืนเกินจำนวนที่เบิกไป (ค้างอยู่ %)', coalesce(v_line.qty_approved, 0) - v_returned;
  end if;

  insert into returns (requisition_item_id, returned_by, qty, condition, evidence_file_id, evidence_web_link)
  values (p_line_id, v_actor.id, p_qty, p_condition, v_main, p_link)
  returning id into v_id;

  for v_photo in select * from jsonb_array_elements(p_photos) loop
    if (v_photo->>'file_id') is null then continue; end if;
    if v_n >= 5 then exit; end if;
    insert into return_photos (return_id, file_id, web_link, bytes, sort_no)
    values (v_id, v_photo->>'file_id', v_photo->>'web_link', (v_photo->>'bytes')::int, v_n)
    on conflict do nothing;
    v_n := v_n + 1;
  end loop;

  if p_condition = 'ok' then
    select * into v_item from items where id = v_line.item_id for update;
    v_after := v_item.qty_on_hand + p_qty;
    update items set qty_on_hand = v_after, updated_at = now() where id = v_item.id;
    insert into stock_movements (item_id, delta, qty_after, reason, ref_type, ref_id, actor_id)
      values (v_item.id, p_qty, v_after, 'return', 'return', v_id::text, v_actor.id);
  end if;

  return jsonb_build_object('id', v_id, 'qty_after', v_after, 'photos', v_n);
end $$;

grant execute on function create_return(bigint, integer, return_cond, text, text, jsonb) to authenticated;

-- ── view หลักฐาน: รวมรูปตอนคืนหลายใบด้วย ──────────────────────────────
create or replace view evidence_feed
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
