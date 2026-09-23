-- =====================================================================
-- BPL SUPPLY — อัปเดต 016 ถึง 023 · รันไฟล์เดียวจบ
-- รันต่อจาก 015 · ปลอดภัยที่จะรันซ้ำ
--
--  016  ลบรายการวัสดุได้ + เอาของตัวอย่างสองชิ้นออก
--  017  แผนกย่อย + กะ ในหน้าหลักฐาน ของค้างคืน และส่งออกชีต
--  018  ย้ายเครื่องข้ามแผนก ให้หลายแผนกใช้ร่วมกันได้
--  019  จัดการแผนกเป็นของเจ้าของระบบคนเดียว
--  020  หน้าหลักฐาน เลือกดูเฉพาะวัสดุชิ้นที่ต้องการ
--  021  เปิด/ปิดสิทธิ์เห็นเครื่อง Asset เป็นรายคน
--  022  ส่งออก Asset และใบแจ้งชำรุดเข้า Google Sheet
--  023  เลเซอร์ลบเป็นของพ่วงไอดาต้า ไม่ใช่ประเภทแยก
-- =====================================================================

-- =====================================================================
-- BPL SUPPLY — ลบรายการวัสดุออกจากสต็อกได้
-- รันต่อจาก 015 · ปลอดภัยที่จะรันซ้ำ
--
-- ของที่เคยมีคนเบิกไปแล้ว ลบทิ้งจริงไม่ได้ ไม่งั้นประวัติการเบิกจะพัง
-- จึงแยกเป็นสองทาง: ยังไม่เคยถูกเบิก = ลบทิ้งจริง
--                  เคยถูกเบิกแล้ว   = ปิดการใช้งาน หายจากทุกหน้า ประวัติยังอ่านได้
-- =====================================================================

create or replace function delete_item(p_id bigint)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_used boolean;
  v_name text;
begin
  if my_role() not in ('supervisor', 'admin') then
    raise exception 'ไม่มีสิทธิ์ลบรายการวัสดุ';
  end if;

  select name into v_name from items where id = p_id;
  if v_name is null then
    raise exception 'ไม่พบรายการนี้';
  end if;

  select exists (select 1 from requisition_items where item_id = p_id) into v_used;

  if v_used then
    update items set is_active = false, updated_at = now() where id = p_id;
    return 'archived';
  end if;

  -- ไม่เคยถูกเบิกเลย ลบทิ้งได้สนิท พร้อมประวัติปรับสต็อกที่ผูกอยู่
  delete from stock_movements where item_id = p_id;
  delete from items where id = p_id;
  return 'deleted';
end $$;

grant execute on function delete_item(bigint) to authenticated;

comment on function delete_item(bigint) is
  'ลบวัสดุ — ลบสนิทถ้ายังไม่เคยถูกเบิก ไม่งั้นปิดการใช้งานเพื่อรักษาประวัติ';

-- ── เอาของตัวอย่างสองชิ้นที่ใส่ไว้ตอนตั้งระบบออก ─────────────────────
-- ของจริงย้ายไปอยู่ในทะเบียนเครื่อง (assets) หมดแล้ว
do $$
declare v_id bigint;
begin
  for v_id in select id from items where sku in ('SKU-RT-0401', 'SKU-RT-0402') loop
    if exists (select 1 from requisition_items where item_id = v_id) then
      update items set is_active = false, updated_at = now() where id = v_id;
    else
      delete from stock_movements where item_id = v_id;
      delete from items where id = v_id;
    end if;
  end loop;
end $$;


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
  to_char(shift_start, 'HH24:MI') || ' – ' || to_char(shift_end, 'HH24:MI') as label,
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


-- =====================================================================
-- BPL SUPPLY — ย้ายเครื่องข้ามแผนก และให้หลายแผนกใช้ร่วมกันได้
-- รันต่อจาก 017 · ปลอดภัยที่จะรันซ้ำ
--
-- โครงเดียวกับที่ใช้กับคน: มีแผนกหลักหนึ่งแผนก บวกแผนกอื่นที่เพิ่มให้ได้
--   dept_code    แผนกเจ้าของเครื่อง — ใช้จัดกลุ่มบนหน้าจอด้วย
--   share_depts  แผนกอื่นที่ใช้เครื่องนี้ได้ ติ๊กกี่แผนกก็ได้
-- =====================================================================

alter table assets add column if not exists share_depts text[] not null default '{}';

comment on column assets.share_depts is
  'แผนกอื่นที่ใช้เครื่องนี้ได้ นอกเหนือจาก dept_code ที่เป็นแผนกเจ้าของ';

create index if not exists assets_share_idx on assets using gin (share_depts);

-- ---------------------------------------------------------------------
-- ใครเห็นเครื่องไหน
--
-- เพิ่มกฎสำคัญหนึ่งข้อ: คนที่ถือเครื่องอยู่ต้องเห็นเครื่องนั้นเสมอ
-- ไม่งั้นย้ายเครื่องข้ามแผนกตอนที่ยังไม่ได้คืน เจ้าตัวจะมองไม่เห็นจนคืนไม่ได้
-- ---------------------------------------------------------------------
drop policy if exists read_assets on assets;
create policy read_assets on assets for select to authenticated using (
  my_role() in ('supervisor', 'admin')
  or dept_code is null
  or dept_code = 'ALL'
  or 'ALL' = any(my_depts())
  or dept_code = any(my_depts())
  or share_depts && my_depts()
  or exists (
    select 1
    from asset_txn_items ai
    join asset_txns t on t.id = ai.txn_id
    where ai.id = assets.held_item_id and t.user_id = auth.uid()
  )
);

-- ---------------------------------------------------------------------
-- RPC: ย้ายเครื่อง / ตั้งแผนกที่ใช้ร่วมได้
-- ---------------------------------------------------------------------
create or replace function set_asset_depts(
  p_code   text,
  p_dept   text,
  p_shares text[] default '{}'
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_bad text;
begin
  -- เฉพาะเจ้าของระบบ · แอดมินย้ายแผนกเครื่องไม่ได้
  if my_role() <> 'admin' then
    raise exception 'เฉพาะเจ้าของระบบเท่านั้นที่ย้ายแผนกของเครื่องได้';
  end if;

  if not exists (select 1 from assets where code = p_code) then
    raise exception 'ไม่พบเครื่อง %', p_code;
  end if;

  if p_dept is not null and not exists (select 1 from departments where code = p_dept) then
    raise exception 'ไม่รู้จักแผนก %', p_dept;
  end if;

  select s into v_bad
    from unnest(coalesce(p_shares, '{}')) s
   where not exists (select 1 from departments d where d.code = s)
   limit 1;
  if v_bad is not null then
    raise exception 'ไม่รู้จักแผนก %', v_bad;
  end if;

  update assets
     set dept_code   = p_dept,
         -- แผนกเจ้าของไม่ต้องมาซ้ำในรายการใช้ร่วม
         share_depts = coalesce(
           (select array_agg(distinct s)
              from unnest(coalesce(p_shares, '{}')) s
             where s is distinct from p_dept),
           '{}'
         )
   where code = p_code;
end $$;

grant execute on function set_asset_depts(text, text, text[]) to authenticated;

-- ---------------------------------------------------------------------
-- view ของค้างคืนฝั่ง Asset ต้องพ่วงแผนกย่อยของคนถือมาด้วย
-- ---------------------------------------------------------------------
drop view if exists asset_holdings;
create view asset_holdings
with (security_invoker = true) as
select
  ai.id                as out_item_id,
  a.code               as asset_code,
  a.type_code,
  ty.name              as type_name,
  a.dept_code          as asset_dept,
  a.share_depts        as asset_share_depts,
  t.id                 as txn_id,
  t.ref_no,
  t.user_id,
  p.full_name          as holder_name,
  p.employee_code      as holder_code,
  t.dept_code          as holder_dept,
  p.sub_dept           as holder_sub_dept,
  t.shift_start,
  t.shift_end,
  t.due_at,
  t.created_at         as taken_at
from assets a
join asset_txn_items ai on ai.id = a.held_item_id
join asset_txns t       on t.id = ai.txn_id
join asset_types ty     on ty.code = a.type_code
join profiles p         on p.id = t.user_id;

grant select on asset_holdings to authenticated;


-- =====================================================================
-- BPL SUPPLY — จัดการแผนกได้เฉพาะเจ้าของระบบ
-- รันต่อจาก 018 · ปลอดภัยที่จะรันซ้ำ
--
-- แผนกเป็นตัวกำหนดว่าใครเห็นของอะไร ลบแผนกทิ้งกระทบทั้งคนและเครื่องพร้อมกัน
-- จึงยกขึ้นมาให้เป็นของเจ้าของระบบคนเดียว เท่ากับการย้ายแผนกของเครื่องใน 018
-- แอดมินยังอ่านรายชื่อแผนกได้ตามปกติ แค่แก้ไม่ได้
-- =====================================================================

drop policy if exists write_departments on departments;
create policy write_departments on departments for all to authenticated
  using (my_role() = 'admin')
  with check (my_role() = 'admin');

create or replace function create_department(p_name text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if my_role() <> 'admin' then
    raise exception 'เฉพาะเจ้าของระบบเท่านั้นที่เพิ่มแผนกได้';
  end if;
  if v_name = '' then
    raise exception 'ต้องใส่ชื่อแผนก';
  end if;
  if exists (select 1 from departments where lower(name) = lower(v_name)) then
    raise exception 'มีแผนกชื่อ % อยู่แล้ว', v_name;
  end if;

  -- รหัสสุ่มไม่ผูกกับชื่อ เปลี่ยนชื่อทีหลังได้โดยไม่ต้องแก้ข้อมูลที่อ้างถึง
  -- รูปแบบเดียวกับที่ใช้มาตั้งแต่ 011 เพื่อไม่ให้รหัสสองแบบปนกัน
  loop
    v_code := 'D' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from departments where code = v_code);
  end loop;

  insert into departments (code, name, sort_no)
  values (v_code, v_name, coalesce((select max(sort_no) + 1 from departments), 1));

  return v_code;
end $$;

grant execute on function create_department(text) to authenticated;

create or replace function delete_department(p_code text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_people int;
  v_items  int;
  v_assets int;
begin
  if my_role() <> 'admin' then
    raise exception 'เฉพาะเจ้าของระบบเท่านั้นที่ลบแผนกได้';
  end if;
  if p_code = 'ALL' then
    raise exception 'ลบแผนก "ทุกแผนก" ไม่ได้ ระบบใช้เป็นค่ากลาง';
  end if;

  select count(*) into v_people from profiles
   where dept_code = p_code or p_code = any(extra_depts);
  select count(*) into v_items  from items  where dept_code = p_code;
  select count(*) into v_assets from assets
   where dept_code = p_code or p_code = any(share_depts);

  if v_people + v_items + v_assets > 0 then
    raise exception 'ลบไม่ได้ ยังมีพนักงาน % คน วัสดุ % รายการ เครื่อง % ตัว ผูกอยู่กับแผนกนี้',
      v_people, v_items, v_assets;
  end if;

  delete from departments where code = p_code;
end $$;

grant execute on function delete_department(text) to authenticated;


-- =====================================================================
-- BPL SUPPLY — เลือกดูหลักฐานเฉพาะวัสดุที่ต้องการ
-- รันต่อจาก 019 · ปลอดภัยที่จะรันซ้ำ
--
-- พอของเบิกเยอะขึ้น หน้าหลักฐานจะปนกันจนหาไม่เจอว่ารายการไหนคือของอะไร
-- เดิมชื่อของอยู่ในข้อความสรุปก้อนเดียว กรองด้วยไม่ได้
-- จึงแนบรหัสวัสดุมาเป็นชุด ให้กรองที่ฐานข้อมูลได้ตรง ๆ
-- =====================================================================

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


-- =====================================================================
-- BPL SUPPLY — เปิด/ปิดสิทธิ์เห็นเครื่อง Asset เป็นรายคน
-- รันต่อจาก 020 · ปลอดภัยที่จะรันซ้ำ
--
-- บางคนมีรหัสไว้เบิกของสิ้นเปลืองอย่างเดียว ไม่ควรเห็นเครื่องเลย
-- แยกเป็นสวิตช์ของตัวเอง ไม่ปนกับเรื่องแผนก เพราะเป็นคนละคำถามกัน
--   แผนก     = เห็นเครื่อง "ของแผนกไหน"
--   can_assets = เห็นเครื่อง "ไหม" ตั้งแต่แรก
--
-- ค่าเริ่มต้นเป็นเปิด ของเดิมทุกคนจึงไม่เปลี่ยนพฤติกรรม
-- =====================================================================

alter table profiles add column if not exists can_assets boolean not null default true;

comment on column profiles.can_assets is
  'เห็นและเบิกเครื่อง Asset ได้ไหม · ปิดไว้สำหรับคนที่เบิกได้แต่ของสิ้นเปลือง';

create or replace function my_can_assets() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select can_assets from profiles where id = auth.uid()), false);
$$;

grant execute on function my_can_assets() to authenticated;

-- ---------------------------------------------------------------------
-- ใครเห็นเครื่องไหน — เพิ่มด่านแรกว่าคนนี้ดูเครื่องได้ไหม
--
-- ยกเว้นเครื่องที่ตัวเองถืออยู่ ต้องเห็นเสมอเพื่อให้คืนได้
-- เผื่อกรณีปิดสิทธิ์ทีหลังตอนที่ของยังไม่ได้คืน
-- ---------------------------------------------------------------------
drop policy if exists read_assets on assets;
create policy read_assets on assets for select to authenticated using (
  my_role() in ('supervisor', 'admin')
  or exists (
    select 1
    from asset_txn_items ai
    join asset_txns t on t.id = ai.txn_id
    where ai.id = assets.held_item_id and t.user_id = auth.uid()
  )
  or (
    my_can_assets()
    and (
      dept_code is null
      or dept_code = 'ALL'
      or 'ALL' = any(my_depts())
      or dept_code = any(my_depts())
      or share_depts && my_depts()
    )
  )
);

-- กันไว้อีกชั้นที่ตัวคำสั่งเบิก ไม่ใช่แค่ซ่อนจากหน้าจอ
create or replace function assert_can_assets() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if my_role() not in ('supervisor', 'admin') and not my_can_assets() then
    raise exception 'บัญชีนี้ไม่มีสิทธิ์เบิกอุปกรณ์ Asset';
  end if;
end $$;

grant execute on function assert_can_assets() to authenticated;

-- เรียกด่านนี้ตอนเบิกจริง (asset_checkout ถูกสร้างไว้ใน 013)
create or replace function asset_checkout(
  p_type   text,
  p_codes  text[],
  p_photos jsonb default '[]'::jsonb,
  p_issues jsonb default '[]'::jsonb,
  p_note   text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me     profiles%rowtype;
  v_txn    uuid;
  v_ref    text;
  v_code   text;
  v_taken  text;
  v_item   bigint;
  v_min    int;
  v_steps  int;
  v_photos int := coalesce(jsonb_array_length(p_photos), 0);
  r        jsonb;
begin
  select * into v_me from profiles where id = auth.uid();
  if v_me.id is null or not v_me.is_active then
    raise exception 'บัญชีนี้ใช้งานไม่ได้';
  end if;
  if v_me.role = 'staff' and not v_me.can_assets then
    raise exception 'บัญชีนี้ไม่มีสิทธิ์เบิกอุปกรณ์ Asset';
  end if;

  if p_codes is null or array_length(p_codes, 1) is null then
    raise exception 'ยังไม่ได้เลือกเครื่อง';
  end if;

  if not exists (select 1 from asset_types where code = p_type and is_active) then
    raise exception 'ไม่พบประเภท %', p_type;
  end if;

  select count(*) into v_steps from asset_photo_steps where type_code = p_type;
  select photo_min into v_min from asset_types where code = p_type;
  if v_steps > 0 then v_min := v_steps; end if;
  if v_photos < coalesce(v_min, 1) then
    raise exception 'ต้องถ่ายรูปให้ครบ % ใบก่อน (ถ่ายมาแล้ว % ใบ)', coalesce(v_min, 1), v_photos;
  end if;

  v_ref := next_asset_ref('out');
  insert into asset_txns (ref_no, kind, type_code, user_id, dept_code,
                          shift_start, shift_end, due_at, note)
  values (v_ref, 'out', p_type, v_me.id, v_me.dept_code,
          v_me.shift_start, v_me.shift_end,
          shift_due_at(v_me.shift_start, v_me.shift_end), p_note)
  returning id into v_txn;

  foreach v_code in array p_codes loop
    perform 1 from assets where code = v_code for update;
    if not found then
      raise exception 'ไม่พบเครื่อง %', v_code;
    end if;
    if not exists (select 1 from assets where code = v_code and is_enabled) then
      raise exception 'เครื่อง % ถูกปิดไม่ให้เบิก', v_code;
    end if;
    if exists (select 1 from assets where code = v_code and type_code <> p_type) then
      raise exception 'เครื่อง % ไม่ใช่ประเภทที่เลือก', v_code;
    end if;

    select h.holder_name into v_taken
      from assets x join asset_holdings h on h.asset_code = x.code
     where x.code = v_code and x.held_item_id is not null;
    if v_taken is not null then
      raise exception 'เครื่อง % ยังไม่ได้คืน อยู่กับ %', v_code, v_taken;
    end if;

    insert into asset_txn_items (txn_id, asset_code)
    values (v_txn, v_code) returning id into v_item;

    update assets set held_item_id = v_item where code = v_code;
  end loop;

  for r in select * from jsonb_array_elements(p_photos) loop
    insert into asset_txn_photos (txn_id, seq, label, file_id, web_link, bytes)
    values (v_txn, coalesce((r->>'seq')::int, 1), r->>'label',
            r->>'file_id', r->>'web_link', (r->>'bytes')::int);
  end loop;

  for r in select * from jsonb_array_elements(p_issues) loop
    insert into asset_issues (asset_code, txn_id, phase, symptom, reported_by, file_id, web_link)
    values (r->>'asset_code', v_txn, 'out', r->>'symptom', v_me.id, r->>'file_id', r->>'web_link');
  end loop;

  return jsonb_build_object(
    'id', v_txn, 'ref_no', v_ref,
    'due_at', (select due_at from asset_txns where id = v_txn),
    'count', array_length(p_codes, 1)
  );
end $$;

grant execute on function asset_checkout(text, text[], jsonb, jsonb, text) to authenticated;


-- =====================================================================
-- BPL SUPPLY — ส่งออก Asset และใบแจ้งชำรุดเข้า Google Sheet
-- รันต่อจาก 021 · ปลอดภัยที่จะรันซ้ำ
--
-- ใช้วิธีเดียวกับของสิ้นเปลือง: จำไว้ว่าแถวไหนไปอยู่แท็บไหนแถวที่เท่าไหร่
-- ส่งซ้ำจึงเขียนทับแถวเดิม ไม่เกิดแถวซ้ำ และไม่ต้องอ่านทั้งชีตมาเทียบ
-- =====================================================================

create table if not exists asset_sheet_exports (
  asset_txn_item_id bigint primary key references asset_txn_items(id) on delete cascade,
  tab               text not null,
  row_no            integer not null,
  exported_at       timestamptz not null default now()
);

create index if not exists asset_sheet_exports_tab_idx on asset_sheet_exports (tab, row_no);

create table if not exists asset_issue_exports (
  issue_id    bigint primary key references asset_issues(id) on delete cascade,
  tab         text not null,
  row_no      integer not null,
  exported_at timestamptz not null default now()
);

create index if not exists asset_issue_exports_tab_idx on asset_issue_exports (tab, row_no);

alter table asset_sheet_exports enable row level security;
alter table asset_issue_exports enable row level security;

-- อ่านได้เฉพาะแอดมินขึ้นไป · เขียนผ่าน Edge Function (service role) เท่านั้น
drop policy if exists read_asset_sheet_exports on asset_sheet_exports;
create policy read_asset_sheet_exports on asset_sheet_exports for select to authenticated
  using (my_role() in ('supervisor', 'admin'));

drop policy if exists read_asset_issue_exports on asset_issue_exports;
create policy read_asset_issue_exports on asset_issue_exports for select to authenticated
  using (my_role() in ('supervisor', 'admin'));

-- ── สถานะการส่งออกฝั่ง Asset ให้หน้าเว็บนับได้ ─────────────────────────
drop view if exists asset_export_rows;
create view asset_export_rows
with (security_invoker = true) as
select
  ai.id                                   as line_id,
  t.ref_no,
  t.kind,
  t.created_at,
  ty.name                                 as type_name,
  ai.asset_code,
  p.full_name                             as who,
  p.employee_code,
  t.dept_code,
  se.tab,
  se.row_no,
  (se.asset_txn_item_id is not null)      as is_exported
from asset_txn_items ai
join asset_txns t   on t.id = ai.txn_id
join assets a       on a.code = ai.asset_code
join asset_types ty on ty.code = a.type_code
join profiles p     on p.id = t.user_id
left join asset_sheet_exports se on se.asset_txn_item_id = ai.id;

grant select on asset_export_rows to authenticated;


-- =====================================================================
-- BPL SUPPLY — เลเซอร์ลบเป็นของพ่วงไอดาต้า ไม่ใช่ประเภทแยก
-- รันต่อจาก 022 · ปลอดภัยที่จะรันซ้ำ
--
-- ของเดิมแยกเลเซอร์ลบเป็นเมนูของตัวเอง ซึ่งผิดจากการใช้งานจริง
-- หน้างานเบิกไอดาต้าแล้วบางครั้งหยิบเลเซอร์ลบไปด้วย ไม่ได้เบิกแยกรอบ
--
-- จึงให้ประเภทมี "ประเภทแม่" ได้ ประเภทที่มีแม่จะไม่โผล่เป็นเมนูเอง
-- แต่ไปโผล่เป็นตัวเลือกเสริมในหน้าเบิกของแม่ ข้ามได้ถ้าไม่เอา
-- =====================================================================

alter table asset_types add column if not exists parent_code text references asset_types(code);

comment on column asset_types.parent_code is
  'ถ้ามีค่า = เป็นของพ่วงประเภทนี้ ไม่ขึ้นเป็นเมนูแยก เบิกไปพร้อมกันได้';

update asset_types set parent_code = 'IDATA' where code = 'LASER' and parent_code is null;

-- เลเซอร์ลบไม่มีรูปบังคับของตัวเอง ใช้รูปชุดเดียวกับไอดาต้าที่เบิกพร้อมกัน
update asset_types set photo_min = 0 where code = 'LASER';

-- ประเภทหลักของเครื่องนี้ — ของพ่วงจะคืนค่าเป็นประเภทแม่
create or replace function asset_root_type(p_code text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(ty.parent_code, ty.code)
    from assets a join asset_types ty on ty.code = a.type_code
   where a.code = p_code;
$$;

grant execute on function asset_root_type(text) to authenticated;

-- ---------------------------------------------------------------------
-- เบิก — รับได้ทั้งประเภทหลักและของพ่วงในครั้งเดียว
-- ---------------------------------------------------------------------
create or replace function asset_checkout(
  p_type   text,
  p_codes  text[],
  p_photos jsonb default '[]'::jsonb,
  p_issues jsonb default '[]'::jsonb,
  p_note   text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me     profiles%rowtype;
  v_txn    uuid;
  v_ref    text;
  v_code   text;
  v_taken  text;
  v_item   bigint;
  v_min    int;
  v_steps  int;
  v_photos int := coalesce(jsonb_array_length(p_photos), 0);
  r        jsonb;
begin
  select * into v_me from profiles where id = auth.uid();
  if v_me.id is null or not v_me.is_active then
    raise exception 'บัญชีนี้ใช้งานไม่ได้';
  end if;
  if v_me.role = 'staff' and not v_me.can_assets then
    raise exception 'บัญชีนี้ไม่มีสิทธิ์เบิกอุปกรณ์ Asset';
  end if;

  if p_codes is null or array_length(p_codes, 1) is null then
    raise exception 'ยังไม่ได้เลือกเครื่อง';
  end if;

  if not exists (
    select 1 from asset_types where code = p_type and is_active and parent_code is null
  ) then
    raise exception 'ไม่พบประเภท %', p_type;
  end if;

  -- จำนวนรูปคิดจากประเภทหลักเสมอ ของพ่วงไม่เพิ่มจำนวนรูป
  select count(*) into v_steps from asset_photo_steps where type_code = p_type;
  select photo_min into v_min from asset_types where code = p_type;
  if v_steps > 0 then v_min := v_steps; end if;
  if v_photos < coalesce(v_min, 1) then
    raise exception 'ต้องถ่ายรูปให้ครบ % ใบก่อน (ถ่ายมาแล้ว % ใบ)', coalesce(v_min, 1), v_photos;
  end if;

  v_ref := next_asset_ref('out');
  insert into asset_txns (ref_no, kind, type_code, user_id, dept_code,
                          shift_start, shift_end, due_at, note)
  values (v_ref, 'out', p_type, v_me.id, v_me.dept_code,
          v_me.shift_start, v_me.shift_end,
          shift_due_at(v_me.shift_start, v_me.shift_end), p_note)
  returning id into v_txn;

  foreach v_code in array p_codes loop
    perform 1 from assets where code = v_code for update;
    if not found then
      raise exception 'ไม่พบเครื่อง %', v_code;
    end if;
    if not exists (select 1 from assets where code = v_code and is_enabled) then
      raise exception 'เครื่อง % ถูกปิดไม่ให้เบิก', v_code;
    end if;
    if asset_root_type(v_code) is distinct from p_type then
      raise exception 'เครื่อง % ไม่ได้อยู่ในกลุ่มที่เลือก', v_code;
    end if;

    select h.holder_name into v_taken
      from assets x join asset_holdings h on h.asset_code = x.code
     where x.code = v_code and x.held_item_id is not null;
    if v_taken is not null then
      raise exception 'เครื่อง % ยังไม่ได้คืน อยู่กับ %', v_code, v_taken;
    end if;

    insert into asset_txn_items (txn_id, asset_code)
    values (v_txn, v_code) returning id into v_item;

    update assets set held_item_id = v_item where code = v_code;
  end loop;

  for r in select * from jsonb_array_elements(p_photos) loop
    insert into asset_txn_photos (txn_id, seq, label, file_id, web_link, bytes)
    values (v_txn, coalesce((r->>'seq')::int, 1), r->>'label',
            r->>'file_id', r->>'web_link', (r->>'bytes')::int);
  end loop;

  for r in select * from jsonb_array_elements(p_issues) loop
    insert into asset_issues (asset_code, txn_id, phase, symptom, reported_by, file_id, web_link)
    values (r->>'asset_code', v_txn, 'out', r->>'symptom', v_me.id, r->>'file_id', r->>'web_link');
  end loop;

  return jsonb_build_object(
    'id', v_txn, 'ref_no', v_ref,
    'due_at', (select due_at from asset_txns where id = v_txn),
    'count', array_length(p_codes, 1)
  );
end $$;

grant execute on function asset_checkout(text, text[], jsonb, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------
-- คืน — คืนของพ่วงพร้อมประเภทหลักได้ในครั้งเดียว
-- ---------------------------------------------------------------------
create or replace function asset_return(
  p_codes  text[],
  p_photos jsonb default '[]'::jsonb,
  p_issues jsonb default '[]'::jsonb,
  p_note   text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me     profiles%rowtype;
  v_txn    uuid;
  v_ref    text;
  v_code   text;
  v_root   text;
  v_out    bigint;
  v_owner  uuid;
  v_min    int;
  v_steps  int;
  v_photos int := coalesce(jsonb_array_length(p_photos), 0);
  r        jsonb;
begin
  select * into v_me from profiles where id = auth.uid();
  if v_me.id is null or not v_me.is_active then
    raise exception 'บัญชีนี้ใช้งานไม่ได้';
  end if;

  if p_codes is null or array_length(p_codes, 1) is null then
    raise exception 'ยังไม่ได้เลือกเครื่องที่จะคืน';
  end if;

  v_root := asset_root_type(p_codes[1]);
  if v_root is null then
    raise exception 'ไม่พบเครื่อง %', p_codes[1];
  end if;

  select count(*) into v_steps from asset_photo_steps where type_code = v_root;
  select photo_min into v_min from asset_types where code = v_root;
  if v_steps > 0 then v_min := v_steps; end if;
  if v_photos < coalesce(v_min, 1) then
    raise exception 'ต้องถ่ายรูปสภาพตอนคืนให้ครบ % ใบก่อน (ถ่ายมาแล้ว % ใบ)',
      coalesce(v_min, 1), v_photos;
  end if;

  v_ref := next_asset_ref('in');
  insert into asset_txns (ref_no, kind, type_code, user_id, dept_code,
                          shift_start, shift_end, note)
  values (v_ref, 'in', v_root, v_me.id, v_me.dept_code,
          v_me.shift_start, v_me.shift_end, p_note)
  returning id into v_txn;

  foreach v_code in array p_codes loop
    perform 1 from assets where code = v_code for update;

    if asset_root_type(v_code) is distinct from v_root then
      raise exception 'เครื่อง % คนละกลุ่มกับที่เลือกไว้ ต้องคืนแยกรอบ', v_code;
    end if;

    select a.held_item_id, t.user_id into v_out, v_owner
      from assets a
      join asset_txn_items ai on ai.id = a.held_item_id
      join asset_txns t on t.id = ai.txn_id
     where a.code = v_code;

    if v_out is null then
      raise exception 'เครื่อง % ไม่ได้อยู่ในรายการค้างคืน', v_code;
    end if;
    if v_owner <> v_me.id and my_role() not in ('supervisor', 'admin') then
      raise exception 'เครื่อง % ไม่ได้เบิกโดยคุณ', v_code;
    end if;

    insert into asset_txn_items (txn_id, asset_code, out_item_id)
    values (v_txn, v_code, v_out);

    update assets set held_item_id = null where code = v_code;
  end loop;

  for r in select * from jsonb_array_elements(p_photos) loop
    insert into asset_txn_photos (txn_id, seq, label, file_id, web_link, bytes)
    values (v_txn, coalesce((r->>'seq')::int, 1), r->>'label',
            r->>'file_id', r->>'web_link', (r->>'bytes')::int);
  end loop;

  for r in select * from jsonb_array_elements(p_issues) loop
    insert into asset_issues (asset_code, txn_id, phase, symptom, reported_by, file_id, web_link)
    values (r->>'asset_code', v_txn, 'in', r->>'symptom', v_me.id, r->>'file_id', r->>'web_link');
  end loop;

  return jsonb_build_object('id', v_txn, 'ref_no', v_ref, 'count', array_length(p_codes, 1));
end $$;

grant execute on function asset_return(text[], jsonb, jsonb, text) to authenticated;


