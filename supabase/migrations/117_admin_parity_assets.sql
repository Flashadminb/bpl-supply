-- =====================================================================
-- BPL SUPPLY — แอดมินทำงานเรื่องทะเบียนเครื่องและผู้ใช้ได้เท่าเจ้าของระบบ
-- รันต่อจาก 116 · ปลอดภัยที่จะรันซ้ำ
--
-- ต่อยอดจาก 058 ที่เปิดเรื่องผู้ใช้ไปแล้ว · รอบนี้เปิดเรื่องแผนกและเครื่อง
-- ตามที่เจ้าของระบบสั่งไว้ว่า "แอดมินทำได้เท่าผม แต่ลบไม่ได้"
--
-- เส้นที่ยังไม่ข้าม สามข้อ
--   ① ลบ · เพิ่มกับแก้ได้ แต่ลบแผนก ลบแผนกย่อย ยังเป็นของเจ้าของระบบ
--      เพราะของที่เพิ่มผิดแก้คืนได้ ส่วนของที่ลบผิดไม่มีอะไรให้แก้คืน
--   ② เมนูสิทธิ์เข้าถึง (asset_user_grants) ยังเป็นของเจ้าของคนเดียวเหมือนเดิม
--      นั่นคือที่ที่ใช้เปิดเครื่องให้คนนอกแผนกเห็น ซึ่งข้ามกติกาทั้งระบบ
--   ③ การแต่งตั้งเจ้าของระบบ ยังกันไว้ตาม 058 ทุกตัวอักษร
-- =====================================================================

-- ---------------------------------------------------------------------
-- ① แผนก · เพิ่มกับแก้ชื่อได้ ลบไม่ได้
--
-- ต้องแยกเป็นสามนโยบาย เพราะ for all ใช้เงื่อนไขเดียวกับทุกคำสั่ง
-- จะกันเฉพาะ delete ไม่ได้ถ้าไม่แยก
-- ---------------------------------------------------------------------
drop policy if exists write_departments  on departments;
drop policy if exists insert_departments on departments;
drop policy if exists update_departments on departments;
drop policy if exists delete_departments on departments;

create policy insert_departments on departments for insert to authenticated
  with check (my_role() in ('supervisor', 'admin'));

create policy update_departments on departments for update to authenticated
  using (my_role() in ('supervisor', 'admin'))
  with check (my_role() in ('supervisor', 'admin'));

create policy delete_departments on departments for delete to authenticated
  using (my_role() = 'admin');


create or replace function create_department(p_name text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if my_role() not in ('supervisor', 'admin') then
    raise exception 'เฉพาะเจ้าของระบบและแอดมินเท่านั้นที่เพิ่มแผนกได้';
  end if;
  if v_name = '' then
    raise exception 'ต้องใส่ชื่อแผนก';
  end if;
  if exists (select 1 from departments where lower(name) = lower(v_name)) then
    raise exception 'มีแผนกชื่อ % อยู่แล้ว', v_name;
  end if;

  loop
    v_code := 'D' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from departments where code = v_code);
  end loop;

  insert into departments (code, name, sort_no)
  values (v_code, v_name, coalesce((select max(sort_no) + 1 from departments), 1));

  return v_code;
end $$;

grant execute on function create_department(text) to authenticated;


-- ---------------------------------------------------------------------
-- ② แผนกย่อย · เพิ่มกับแก้ได้ ลบไม่ได้
-- ---------------------------------------------------------------------
drop policy if exists write_sub_depts  on sub_depts;
drop policy if exists insert_sub_depts on sub_depts;
drop policy if exists update_sub_depts on sub_depts;
drop policy if exists delete_sub_depts on sub_depts;

create policy insert_sub_depts on sub_depts for insert to authenticated
  with check (my_role() in ('supervisor', 'admin'));

create policy update_sub_depts on sub_depts for update to authenticated
  using (my_role() in ('supervisor', 'admin'))
  with check (my_role() in ('supervisor', 'admin'));

create policy delete_sub_depts on sub_depts for delete to authenticated
  using (my_role() = 'admin');


-- ---------------------------------------------------------------------
-- ③ ย้ายแผนกของเครื่อง และตั้งแผนกย่อยให้เครื่องกับคน
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
  if my_role() not in ('supervisor', 'admin') then
    raise exception 'เฉพาะเจ้าของระบบและแอดมินเท่านั้นที่ย้ายแผนกของเครื่องได้';
  end if;

  if not exists (select 1 from assets where code = p_code) then
    raise exception 'ไม่พบเครื่อง %', p_code;
  end if;

  if p_dept is not null and p_dept <> 'ALL'
     and not exists (select 1 from departments where code = p_dept) then
    raise exception 'ไม่พบแผนก %', p_dept;
  end if;

  select string_agg(s, ', ') into v_bad
    from unnest(coalesce(p_shares, '{}')) s
   where s <> 'ALL' and not exists (select 1 from departments where code = s);
  if v_bad is not null then
    raise exception 'ไม่พบแผนก %', v_bad;
  end if;

  update assets set
    dept_code   = nullif(p_dept, 'ALL'),
    share_depts = coalesce(p_shares, '{}')
  where code = p_code;
end $$;

grant execute on function set_asset_depts(text, text, text[]) to authenticated;


create or replace function set_asset_sub_dept(p_code text, p_sub text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_dept text; v_sub text := nullif(btrim(coalesce(p_sub, '')), '');
begin
  if my_role() not in ('supervisor', 'admin') then
    raise exception 'เฉพาะเจ้าของระบบและแอดมินเท่านั้นที่ตั้งแผนกย่อยของเครื่องได้';
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
declare v_dept text; v_role user_role; v_sub text := nullif(btrim(coalesce(p_sub, '')), '');
begin
  if my_role() not in ('supervisor', 'admin') then
    raise exception 'เฉพาะเจ้าของระบบและแอดมินเท่านั้นที่ตั้งแผนกย่อยของคนได้';
  end if;

  select dept_code, role into v_dept, v_role from profiles where id = p_user;
  if not found then
    raise exception 'ไม่พบพนักงานคนนี้';
  end if;
  -- กันตาม 058 · แอดมินแตะบัญชีเจ้าของระบบไม่ได้
  if v_role = 'admin' and my_role() <> 'admin' then
    raise exception 'บัญชีนี้เป็นเจ้าของระบบ แอดมินแก้ไม่ได้';
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
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_policies
    where tablename = 'departments' and cmd = 'DELETE')                    as นโยบายลบแผนก,
  (select count(*) from pg_policies
    where tablename = 'sub_depts' and cmd = 'DELETE')                      as นโยบายลบย่อย,
  (select count(*) from pg_policies
    where tablename in ('departments','sub_depts') and cmd in ('INSERT','UPDATE')
      and coalesce(qual, with_check) like '%supervisor%')                  as เพิ่มแก้เปิดให้แอดมิน,
  (select count(*) from pg_proc where proname in
    ('create_department','set_asset_depts','set_asset_sub_dept','set_user_sub_dept')
     and prosrc like '%supervisor%')                                       as ฟังก์ชันที่เปิดให้แอดมิน,
  (select count(*) from pg_proc where proname = 'delete_department'
     and prosrc like '%my_role() <> ''admin''%')                           as ลบแผนกยังล็อกไว้;
