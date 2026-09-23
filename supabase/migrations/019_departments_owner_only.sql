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
