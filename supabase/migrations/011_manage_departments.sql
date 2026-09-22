-- =====================================================================
-- BPL SUPPLY — เพิ่ม/แก้/ลบแผนกได้เองจากในเว็บ
-- รันต่อจาก 010 · ปลอดภัยที่จะรันซ้ำ
--
-- รหัสแผนกสร้างให้อัตโนมัติ ผู้ใช้กรอกแค่ชื่อ
-- เพราะรหัสถูกอ้างอิงจาก profiles และ items ถ้าให้แก้เองแล้วเปลี่ยนชื่อรหัสทีหลัง
-- ข้อมูลที่ผูกไว้จะขาด — แยกรหัส (ตายตัว) ออกจากชื่อ (แก้ได้อิสระ) จึงปลอดภัยกว่า
-- =====================================================================

create or replace function create_department(p_name text) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_code text;
  v_name text := btrim(p_name);
begin
  select role into v_role from profiles where id = auth.uid();
  if coalesce(v_role, 'staff') = 'staff' then
    raise exception 'ไม่มีสิทธิ์เพิ่มแผนก';
  end if;
  if v_name is null or length(v_name) = 0 then
    raise exception 'ต้องใส่ชื่อแผนก';
  end if;
  if exists (select 1 from departments where lower(name) = lower(v_name)) then
    raise exception 'มีแผนกชื่อ "%" อยู่แล้ว', v_name;
  end if;

  -- วนจนได้รหัสที่ยังไม่ซ้ำ
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
-- ลบแผนกอย่างปลอดภัย — ห้ามลบถ้ายังมีคนหรือของผูกอยู่
-- ---------------------------------------------------------------------
create or replace function delete_department(p_code text) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role  user_role;
  v_name  text;
  v_users integer;
  v_items integer;
  v_extra integer;
begin
  select role into v_role from profiles where id = auth.uid();
  if coalesce(v_role, 'staff') = 'staff' then
    raise exception 'ไม่มีสิทธิ์ลบแผนก';
  end if;
  if p_code = 'ALL' then
    raise exception 'ลบแผนก "ทุกแผนก" ไม่ได้ ระบบใช้เป็นค่าตั้งต้น';
  end if;

  select name into v_name from departments where code = p_code;
  if v_name is null then
    raise exception 'ไม่พบแผนกนี้';
  end if;

  select count(*) into v_users from profiles where dept_code = p_code;
  select count(*) into v_items from items    where dept_code = p_code;
  select count(*) into v_extra from profiles where p_code = any(extra_depts);

  if v_users > 0 or v_items > 0 or v_extra > 0 then
    raise exception
      'ลบไม่ได้ แผนก "%" ยังมีพนักงาน % คน · วัสดุ % รายการ · สิทธิพิเศษ % คน ย้ายออกก่อน',
      v_name, v_users, v_items, v_extra;
  end if;

  delete from departments where code = p_code;
end $$;

grant execute on function delete_department(text) to authenticated;
