-- =====================================================================
-- BPL SUPPLY — เปิดตารางปล่อยรถให้ผู้ตรวจสอบ
-- รันต่อจาก 105 · ปลอดภัยที่จะรันซ้ำ
--
-- เดิมล็อกไว้ที่เจ้าของระบบคนเดียว ตามที่สั่งไว้ตอนเริ่มทำว่าขอดูก่อน
-- ตอนนี้จะให้ผู้ตรวจสอบช่วยทดสอบ จึงเปิดให้อีกหนึ่งกลุ่ม
--
-- "ผู้ตรวจสอบ" ในระบบนี้คือ profiles.can_dispatch = true ไม่ใช่ค่าใน enum ของ role
-- จึงต้องเรียกผ่าน my_can_dispatch() ไม่ใช่เทียบกับ my_role()
--
-- เปิดเฉพาะตัวงาน คือดูกระดาน เพิ่มรถ ปล่อยรถ ดูจอทีวีและสถิติ
-- ส่วนงานหลังบ้าน คือส่งลงชีต ลบของเก่า แก้รายชื่อสาขา ตั้งแจ้งเตือน
-- และรีเซตตัวนับจอทีวี ยังเป็นของผู้ดูแลระบบคนเดียวเหมือนเดิม
-- เพราะนั่นคืองานที่กดผิดแล้วกระทบของจริง ไม่ใช่งานที่เอาไว้ทดสอบ
-- =====================================================================

create or replace function my_can_truck() returns boolean
language sql stable security definer set search_path = public as $$
  select my_role() = 'admin' or my_can_dispatch();
$$;

grant execute on function my_can_truck() to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
--
-- นับจากตารางจริงว่าตอนนี้มีกี่คนที่เข้าได้ และเป็นใครบ้าง
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc
    where proname = 'my_can_truck' and prosrc like '%my_can_dispatch%')  as เปิดให้ผู้ตรวจสอบแล้ว,
  (select count(*) from profiles
    where is_active and (role = 'admin' or can_dispatch))                as คนที่เข้าได้ตอนนี้,
  (select string_agg(full_name || ' (' ||
            case when role = 'admin' then 'ผู้ดูแลระบบ' else 'ผู้ตรวจสอบ' end || ')', ' · ')
     from profiles where is_active and (role = 'admin' or can_dispatch)) as รายชื่อ;
