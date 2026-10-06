-- =====================================================================
-- BPL SUPPLY — แผนกย่อยของทะเบียนเครื่อง
-- รันต่อจาก 114 · ปลอดภัยที่จะรันซ้ำ
--
-- แผนกหนึ่งแผนกมีย่อยได้ เช่น OUT4W มี D02 D03
-- แต่ละย่อยมีผู้ดูแลของตัวเองและอยากแยกของกัน
-- ถ้าไม่แยก ทุกคนในแผนกเห็นเครื่องหมดแล้วแย่งกันเบิก
--
-- กติกา (เจ้าของระบบเลือกแบบ ก)
--   คนปล่อยช่องย่อยว่าง  = เห็นทั้งแผนก รวมทุกย่อย        · ใช้กับหัวหน้าแผนก
--   คนใส่ย่อย D02        = เห็นของกลางของแผนก + ของ D02 เท่านั้น
--   เครื่องไม่ใส่ย่อย     = ของกลาง ทุกคนในแผนกเห็นเหมือนเดิม
--   อยากให้ D02 เห็น D03 = ใส่ OUT4W/D03 ในช่องสิทธิ์เพิ่มของเดิม
--
-- my_depts() ไม่ถูกแตะเลย เพราะมีอีกหลายระบบใช้อยู่
-- ทั้งลงเวลา ลิงก์งาน และของสิ้นเปลือง · งานนี้แตะเฉพาะทะเบียนเครื่อง
-- =====================================================================

alter table assets   add column if not exists sub_dept text;
alter table profiles add column if not exists sub_dept text;

comment on column assets.sub_dept is
  'แผนกย่อยเจ้าของเครื่อง · ว่าง = ของกลางของแผนก ทุกคนในแผนกเห็น';
comment on column profiles.sub_dept is
  'แผนกย่อยของคนนี้ · ว่าง = เห็นทั้งแผนกรวมทุกย่อย ใช้กับหัวหน้าแผนก';

create index if not exists assets_sub_dept_idx on assets (dept_code, sub_dept);


-- ---------------------------------------------------------------------
-- รายชื่อแผนกย่อย · ไว้ให้หน้าจอมีดรอปดาวน์ให้เลือก ไม่ต้องพิมพ์เอง
-- ---------------------------------------------------------------------
create table if not exists sub_depts (
  dept_code text not null references departments(code) on delete cascade,
  code      text not null,
  name      text not null,
  sort_no   integer not null default 0,
  is_active boolean not null default true,
  primary key (dept_code, code)
);

alter table sub_depts enable row level security;

drop policy if exists read_sub_depts on sub_depts;
create policy read_sub_depts on sub_depts for select to authenticated using (true);

drop policy if exists write_sub_depts on sub_depts;
create policy write_sub_depts on sub_depts for all to authenticated
  using (my_role() = 'admin') with check (my_role() = 'admin');


-- ---------------------------------------------------------------------
-- สิทธิ์ของคนสำหรับทะเบียนเครื่อง
--
-- คืนเป็นรายการสตริง แผนกเปล่า ๆ แปลว่าทั้งแผนก
-- แผนกทับย่อย เช่น OUT4W/D02 แปลว่าเฉพาะย่อยนั้น
-- ---------------------------------------------------------------------
create or replace function my_asset_grants() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(
    array[
      case
        when p.sub_dept is null or btrim(p.sub_dept) = '' then p.dept_code
        else p.dept_code || '/' || p.sub_dept
      end
    ] || p.extra_depts,
    '{}'
  )
  from profiles p where p.id = auth.uid();
$$;

grant execute on function my_asset_grants() to authenticated;


-- ---------------------------------------------------------------------
-- เครื่องหนึ่งเครื่องนับเป็นกุญแจอะไรบ้าง
--
-- มีย่อย = นับเฉพาะคู่แผนกทับย่อย ไม่นับแผนกเปล่า
-- ถ้านับแผนกเปล่าด้วย คนที่ถือสิทธิ์ย่อย D02 จะเห็นของ D03 ทันที
-- เพราะสิทธิ์ D02 ครอบแผนกเปล่าอยู่แล้ว · จุดนี้พลาดง่ายที่สุดของทั้งงาน
-- ---------------------------------------------------------------------
create or replace function asset_dept_keys(p_dept text, p_sub text, p_shares text[])
returns text[]
language sql immutable set search_path = public as $$
  select
    case
      when p_dept is null then '{}'::text[]
      when p_sub is null or btrim(p_sub) = '' then array[p_dept]
      else array[p_dept || '/' || p_sub]
    end
    || coalesce(p_shares, '{}');
$$;

grant execute on function asset_dept_keys(text, text, text[]) to authenticated;


create or replace function asset_dept_ok(p_dept text, p_sub text, p_shares text[])
returns boolean
language sql stable security definer set search_path = public as $$
  select
    p_dept is null
    or p_dept = 'ALL'
    or exists (
      select 1
      from unnest(my_asset_grants())                        as g,
           unnest(asset_dept_keys(p_dept, p_sub, p_shares)) as k
      -- ใช้ตัดสตริงเทียบตรง ๆ ไม่ใช้ like
      -- เพราะรหัสแผนกที่มี _ หรือ % ปนอยู่ จะกลายเป็นตัวแทนอักขระของ like
      -- แล้วสิทธิ์จะกว้างเกินจริงโดยไม่มีใครเห็น
      where g = 'ALL'
         or k = 'ALL'
         or g = k
         or left(k, length(g) + 1) = g || '/'   -- สิทธิ์ทั้งแผนก เห็นของย่อยทุกย่อย
         or left(g, length(k) + 1) = k || '/'   -- สิทธิ์ย่อย ยังเห็นของกลางของแผนกตัวเอง
    );
$$;

grant execute on function asset_dept_ok(text, text, text[]) to authenticated;


-- ---------------------------------------------------------------------
-- ด่านเดียวที่ตัดสินว่าใครเห็นเครื่องไหน
-- เปลี่ยนแค่สามบรรทัดกลาง ที่เหลือคงเดิมทุกตัวอักษร
-- ---------------------------------------------------------------------
drop policy if exists read_assets on assets;
create policy read_assets on assets for select to authenticated using (
  my_role() in ('supervisor', 'admin')
  or my_can_dispatch()
  or exists (
    select 1
    from asset_txn_items ai
    join asset_txns t on t.id = ai.txn_id
    where ai.id = assets.held_item_id and t.user_id = auth.uid()
  )
  or (
    my_can_assets()
    and (
      asset_dept_ok(dept_code, sub_dept, share_depts)
      or loan_user = auth.uid()
      or exists (
        select 1 from asset_user_grants g
         where g.asset_code = assets.code and g.user_id = auth.uid()
      )
    )
  )
);


-- ---------------------------------------------------------------------
-- ตั้งแผนกและแผนกย่อยของเครื่อง · เจ้าของระบบเท่านั้น
-- ---------------------------------------------------------------------
create or replace function set_asset_sub_dept(p_code text, p_sub text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_dept text; v_sub text := nullif(btrim(coalesce(p_sub, '')), '');
begin
  if my_role() <> 'admin' then
    raise exception 'เฉพาะเจ้าของระบบเท่านั้นที่ตั้งแผนกย่อยของเครื่องได้';
  end if;

  select dept_code into v_dept from assets where code = p_code;
  if not found then
    raise exception 'ไม่พบเครื่อง %', p_code;
  end if;

  if v_sub is not null and not exists (
    select 1 from sub_depts s where s.dept_code = v_dept and s.code = v_sub and s.is_active
  ) then
    raise exception 'แผนก % ไม่มีแผนกย่อยชื่อ %', v_dept, v_sub;
  end if;

  update assets set sub_dept = v_sub where code = p_code;
  return jsonb_build_object('ok', true, 'code', p_code, 'sub_dept', v_sub);
end $$;

grant execute on function set_asset_sub_dept(text, text) to authenticated;


create or replace function set_user_sub_dept(p_user uuid, p_sub text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_dept text; v_sub text := nullif(btrim(coalesce(p_sub, '')), '');
begin
  if my_role() <> 'admin' then
    raise exception 'เฉพาะเจ้าของระบบเท่านั้นที่ตั้งแผนกย่อยของคนได้';
  end if;

  select dept_code into v_dept from profiles where id = p_user;
  if not found then
    raise exception 'ไม่พบพนักงานคนนี้';
  end if;

  if v_sub is not null and not exists (
    select 1 from sub_depts s where s.dept_code = v_dept and s.code = v_sub and s.is_active
  ) then
    raise exception 'แผนก % ไม่มีแผนกย่อยชื่อ %', v_dept, v_sub;
  end if;

  update profiles set sub_dept = v_sub where id = p_user;
  return jsonb_build_object('ok', true, 'sub_dept', v_sub);
end $$;

grant execute on function set_user_sub_dept(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- คนที่ยังไม่ได้ใส่แผนกย่อย · เอาไว้โชว์เตือนในหน้าแผนก
--
-- ว่าง = เห็นทั้งแผนก ซึ่งถูกตามกติกา แต่ถ้าลืมใส่ให้พนักงานธรรมดา
-- เขาจะเห็นของทุกย่อยเหมือนหัวหน้าโดยไม่มีใครรู้ · หน้าจอจึงต้องบอกไว้
-- ---------------------------------------------------------------------
create or replace function sub_dept_coverage()
returns table (dept_code text, dept_name text, total int, no_sub int)
language sql stable security definer set search_path = public as $$
  select d.code, d.name,
         count(p.id)::int,
         count(p.id) filter (where p.sub_dept is null)::int
  from departments d
  left join profiles p on p.dept_code = d.code and p.is_active
  where my_role() = 'admin'
    and exists (select 1 from sub_depts s where s.dept_code = d.code and s.is_active)
  group by d.code, d.name
  order by d.sort_no;
$$;

grant execute on function sub_dept_coverage() to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'assets' and column_name = 'sub_dept')    as ช่องย่อยที่เครื่อง,
  (select count(*) from information_schema.columns
    where table_name = 'profiles' and column_name = 'sub_dept')  as ช่องย่อยที่คน,
  (select count(*) from pg_tables where tablename = 'sub_depts') as ตารางแผนกย่อย,
  (select count(*) from pg_proc where proname in
    ('my_asset_grants','asset_dept_keys','asset_dept_ok',
     'set_asset_sub_dept','set_user_sub_dept','sub_dept_coverage')) as ฟังก์ชันที่เพิ่ม;
