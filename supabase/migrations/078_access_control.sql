-- =====================================================================
-- BPL SUPPLY — สิทธิ์เข้าถึงที่ตั้งเองได้รายคน
-- รันต่อจาก 077 · ปลอดภัยที่จะรันซ้ำ
--
-- สองเรื่องที่เจ้าของระบบขอ
--
--   1) ให้คนหนึ่งคนเห็นเครื่องเฉพาะเครื่องได้ นอกเหนือจากแผนกของตัวเอง
--      เช่น คนแผนก OUT4 เห็น PP ของแผนกตัวเองอยู่แล้ว
--      แต่อยากให้เห็น PP-20 ของแผนกอื่นด้วย ก็เลือกให้เป็นรายเครื่อง
--      **ไม่ใช่การโอน** การโอนเป็นของชั่วคราวและย้ายเครื่องไปอยู่กับคนนั้นจริง
--      อันนี้แค่ "มองเห็นและเบิกได้" ค้างไว้จนกว่าจะเอาออกเอง เครื่องไม่ได้ย้ายไปไหน
--
--   2) เปิดปิดสิทธิ์เบิกแทนคนอื่นเป็นรายคนได้
--      ของเดิมผูกกับตำแหน่งตายตัว คือแอดมินกับผู้ตรวจสอบเท่านั้น
--      หน้างานคนที่ไว้ใจได้จึงยกสิทธิ์ให้ไม่ได้เลย นอกจากเลื่อนตำแหน่งให้ทั้งก้อน
--
-- ทั้งสองอย่างไม่แตะของเดิม คนที่ใช้งานอยู่ตอนนี้สิทธิ์ไม่เปลี่ยนสักคน
-- =====================================================================


-- ---------------------------------------------------------------------
-- เบิกแทนคนอื่นได้ — ย้ายจาก "ดูตำแหน่ง" มาเป็นธงรายคน
--
-- backfill ให้คนที่มีสิทธิ์อยู่แล้ววันนี้ ไม่งั้นตัดสิทธิ์เขากลางกะ
-- เจ้าของระบบไม่ต้องพึ่งธง กันล็อกตัวเองออกจากระบบ
-- ---------------------------------------------------------------------
alter table profiles add column if not exists can_proxy boolean not null default false;

update profiles
   set can_proxy = true
 where can_proxy = false
   and (role in ('admin', 'supervisor') or coalesce(can_dispatch, false));

create or replace function my_can_proxy() returns boolean
language sql stable security definer set search_path = public as $$
  select my_role() = 'admin'
      or coalesce((select p.can_proxy from profiles p where p.id = auth.uid()), false);
$$;

grant execute on function my_can_proxy() to authenticated;


-- ---------------------------------------------------------------------
-- เครื่องที่เปิดให้คนหนึ่งคนเห็นเป็นพิเศษ
--
-- คีย์คู่ เครื่อง+คน จึงให้ซ้ำไม่ได้โดยอัตโนมัติ กดเพิ่มซ้ำก็ไม่เกิดแถวซ้อน
-- ลบเครื่องหรือลบคนแล้วแถวนี้หายตาม ไม่เหลือสิทธิ์ลอยที่ชี้ไปหาของที่ไม่มีแล้ว
-- ---------------------------------------------------------------------
create table if not exists asset_user_grants (
  asset_code text not null references assets (code) on delete cascade,
  user_id    uuid not null references profiles (id) on delete cascade,
  note       text,
  granted_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  primary key (asset_code, user_id)
);

create index if not exists asset_user_grants_user_idx on asset_user_grants (user_id);

alter table asset_user_grants enable row level security;

-- เจ้าตัวต้องอ่านได้ ไม่งั้น policy ของ assets ที่อ้างตารางนี้จะมองไม่เห็นแถวตัวเอง
drop policy if exists read_asset_grants on asset_user_grants;
create policy read_asset_grants on asset_user_grants for select to authenticated
  using (user_id = auth.uid() or my_can_audit());

-- เขียนผ่าน RPC เท่านั้น ไม่เปิด insert/update/delete ตรง ๆ ให้ใคร
drop policy if exists write_asset_grants on asset_user_grants;


-- ---------------------------------------------------------------------
-- ใครเห็นเครื่องไหน — ของเดิมทุกบรรทัด บวกสิทธิ์รายเครื่องอีกข้อเดียว
--
-- ข้อใหม่อยู่ในวงเล็บของ my_can_assets() เหมือนข้ออื่น
-- คนที่ถูกปิดสิทธิ์ Asset ไว้จึงไม่ได้สิทธิ์ย้อนกลับมาเพราะถูกให้เครื่องรายตัว
-- ---------------------------------------------------------------------
drop policy if exists read_assets on assets;
create policy read_assets on assets for select to authenticated using (
  my_role() in ('supervisor', 'admin')
  or my_can_dispatch()
  -- คนที่ถืออยู่ต้องเห็นเสมอ ไม่งั้นคืนไม่ได้
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
      -- เครื่องที่ถูกโอนมาให้เราคนเดียว
      or loan_user = auth.uid()
      -- เครื่องที่เจ้าของระบบเปิดให้เราเห็นเป็นพิเศษ
      or exists (
        select 1 from asset_user_grants g
         where g.asset_code = assets.code and g.user_id = auth.uid()
      )
    )
  )
);


-- ---------------------------------------------------------------------
-- เพิ่ม/เอาออก — เจ้าของระบบเท่านั้น
-- ---------------------------------------------------------------------
create or replace function asset_grant_add(
  p_code text,
  p_user uuid,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  if my_role() <> 'admin' then
    raise exception 'เฉพาะเจ้าของระบบเท่านั้นที่ตั้งสิทธิ์นี้ได้';
  end if;
  if not exists (select 1 from assets where code = p_code) then
    raise exception 'ไม่พบเครื่องรหัส %', p_code;
  end if;

  select full_name into v_name from profiles where id = p_user and is_active;
  if v_name is null then
    raise exception 'ไม่พบผู้ใช้ หรือบัญชีถูกระงับ';
  end if;

  insert into asset_user_grants (asset_code, user_id, note, granted_by)
  values (p_code, p_user, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  on conflict (asset_code, user_id) do update
    set note = excluded.note, granted_by = excluded.granted_by;

  return jsonb_build_object('asset_code', p_code, 'full_name', v_name);
end $$;

grant execute on function asset_grant_add(text, uuid, text) to authenticated;


create or replace function asset_grant_remove(p_code text, p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if my_role() <> 'admin' then
    raise exception 'เฉพาะเจ้าของระบบเท่านั้นที่ตั้งสิทธิ์นี้ได้';
  end if;
  delete from asset_user_grants where asset_code = p_code and user_id = p_user;
  return jsonb_build_object('asset_code', p_code);
end $$;

grant execute on function asset_grant_remove(text, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- รายการสิทธิ์รายเครื่อง ไว้ให้หน้าจอแสดง
-- ---------------------------------------------------------------------
drop view if exists asset_grant_rows;
create view asset_grant_rows
with (security_invoker = true) as
select
  g.asset_code,
  ty.name          as type_name,
  a.dept_code      as asset_dept,
  g.user_id,
  p.full_name      as user_name,
  p.employee_code  as user_code,
  p.dept_code      as user_dept,
  g.note,
  bp.full_name     as granted_by_name,
  g.created_at
from asset_user_grants g
join assets a         on a.code = g.asset_code
join asset_types ty   on ty.code = a.type_code
join profiles p       on p.id = g.user_id
left join profiles bp on bp.id = g.granted_by;

grant select on asset_grant_rows to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'profiles' and column_name = 'can_proxy')      as มีธงเบิกแทน,
  (select count(*) from profiles where can_proxy)                     as คนที่เบิกแทนได้,
  (select count(*) from information_schema.tables
    where table_name = 'asset_user_grants')                           as ตารางสิทธิ์รายเครื่อง,
  (select count(*) from asset_user_grants)                            as สิทธิ์ที่ให้ไว้แล้ว;
