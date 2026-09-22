-- =====================================================================
-- BPL SUPPLY — บังคับตั้งรหัสผ่านใหม่ตอนล็อกอินครั้งแรก
-- รันต่อจาก 002_extras.sql · ปลอดภัยที่จะรันซ้ำ
--
-- แอดมินส่งรหัสชั่วคราวให้พนักงานปากเปล่า พนักงานล็อกอินแล้วต้องตั้งรหัสใหม่ทันที
-- แอดมินจึงรู้รหัสของพนักงานแค่ครั้งเดียวตอนส่งมอบ
-- =====================================================================

alter table profiles
  add column if not exists must_change_password boolean not null default false;

-- ---------------------------------------------------------------------
-- RPC: พนักงานเคลียร์ธงของตัวเองหลังตั้งรหัสใหม่สำเร็จ
-- profiles ไม่มี policy ให้ staff แก้แถวตัวเอง จึงต้องผ่าน security definer
-- ---------------------------------------------------------------------
create or replace function clear_password_flag() returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'ต้องเข้าสู่ระบบก่อน';
  end if;
  update profiles set must_change_password = false where id = auth.uid();
end $$;

grant execute on function clear_password_flag() to authenticated;
