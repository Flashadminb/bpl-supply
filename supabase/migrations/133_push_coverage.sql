-- =====================================================================
-- BPL SUPPLY — ใครเปิดแจ้งเตือนไว้แล้วบ้าง
-- รันต่อจาก 132 · ปลอดภัยที่จะรันซ้ำ
--
-- ประกาศประชุมแล้วหลายคนบอกว่าไม่ได้รับ · ไล่ดูแล้วไม่มีอะไรพัง
-- ตัวส่งส่งครบทุกคนที่มีเครื่องรับ แต่คนในฮับเปิดแจ้งเตือนไว้ไม่ถึงหนึ่งในสาม
-- ที่เหลือจึงไม่มีทางรู้เรื่อง ไม่ว่าจะประกาศกี่รอบ
--
-- ปัญหาจริงคือเรื่องนี้มองไม่เห็นจากหน้าจอไหนเลย
-- คนประกาศเห็นแต่ว่า "ประกาศแล้ว" ซึ่งจริง แต่ไม่ได้แปลว่าถึงมือใคร
-- หน้านี้ทำให้สิ่งที่มองไม่เห็นกลายเป็นรายชื่อที่เดินไปตามได้ทีละคน
--
-- ไม่ได้บอกว่า "เขาเห็นแจ้งเตือนหรือยัง" เพราะระบบไม่มีทางรู้
-- บอกได้แค่ว่า "เครื่องของเขาพร้อมรับหรือยัง" ซึ่งเป็นด่านแรกที่ต้องผ่านก่อน
-- =====================================================================

create or replace function push_coverage()
returns table (
  user_id        uuid,
  full_name      text,
  employee_code  text,
  dept_code      text,
  role           user_role,
  can_dispatch   boolean,
  can_guard      boolean,
  devices        integer,
  last_device_at timestamptz,
  last_push_at   timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    p.id,
    p.full_name,
    p.employee_code,
    p.dept_code,
    p.role,
    coalesce(p.can_dispatch, false),
    coalesce(p.can_guard, false),
    (select count(*)::int    from push_subscriptions s where s.user_id = p.id),
    (select max(s.created_at) from push_subscriptions s where s.user_id = p.id),
    -- ใบเสร็จแจ้งเตือนถูกกวาดทิ้งเมื่อเกิน 90 วัน · เก่ากว่านั้นจะขึ้นว่าไม่เคย
    -- ซึ่งรับได้ เพราะคนที่ไม่ได้รับอะไรเลยใน 90 วันก็ควรถูกไล่ตามอยู่ดี
    (select max(n.sent_at)    from notification_log n where n.user_id = p.id)
  from profiles p
  where p.is_active
    and (my_role() in ('supervisor', 'admin') or my_can_dispatch())
  order by
    (select count(*) from push_subscriptions s where s.user_id = p.id),
    p.dept_code nulls last,
    p.full_name;
$$;

comment on function push_coverage() is
  'คนที่ยังใช้งานทุกคน พร้อมจำนวนเครื่องที่เปิดแจ้งเตือนไว้ · ไว้ไล่ตามคนที่ยังไม่เปิด';

grant execute on function push_coverage() to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname = 'push_coverage')       as "ฟังก์ชัน",
  (select count(*) from push_coverage())                              as "คนที่ยังใช้งาน",
  (select count(*) from push_coverage() where devices = 0)            as "ยังไม่เปิดแจ้งเตือน",
  (select count(*) from push_coverage() where devices > 0)            as "เปิดแล้ว";
