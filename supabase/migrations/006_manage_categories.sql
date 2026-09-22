-- =====================================================================
-- BPL SUPPLY — ให้แอดมินเพิ่ม/แก้/ลบหมวดวัสดุได้จากในเว็บ
-- รันต่อจาก 005 · ปลอดภัยที่จะรันซ้ำ
--
-- เดิม categories มีแต่ policy อ่าน ไม่มี policy เขียน
-- จึงเพิ่มหมวดได้เฉพาะทาง SQL เท่านั้น
-- =====================================================================

drop policy if exists write_categories on categories;
create policy write_categories on categories for all to authenticated
  using (my_role() in ('supervisor', 'admin'))
  with check (my_role() in ('supervisor', 'admin'));

-- ---------------------------------------------------------------------
-- ลบหมวดอย่างปลอดภัย — ห้ามลบถ้ายังมีวัสดุผูกอยู่
-- ถ้าลบตรง ๆ จะติด foreign key แล้วขึ้น error ที่คนทั่วไปอ่านไม่รู้เรื่อง
-- ---------------------------------------------------------------------
create or replace function delete_category(p_id bigint) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role  user_role;
  v_count integer;
  v_name  text;
begin
  select role into v_role from profiles where id = auth.uid();
  if coalesce(v_role, 'staff') = 'staff' then
    raise exception 'ไม่มีสิทธิ์ลบหมวด';
  end if;

  select name into v_name from categories where id = p_id;
  if v_name is null then
    raise exception 'ไม่พบหมวดนี้';
  end if;

  select count(*) into v_count from items where category_id = p_id;
  if v_count > 0 then
    raise exception 'ลบไม่ได้ หมวด "%" ยังมีวัสดุอยู่ % รายการ ย้ายวัสดุไปหมวดอื่นก่อน', v_name, v_count;
  end if;

  delete from categories where id = p_id;
end $$;

grant execute on function delete_category(bigint) to authenticated;
