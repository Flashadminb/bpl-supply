-- =====================================================================
-- BPL SUPPLY — เปิดรถรอลงงานให้หน้างานใช้จริง
-- รันต่อจาก 130 · ปลอดภัยที่จะรันซ้ำ
--
-- รอบทดสอบเปิดให้เจ้าของระบบกับผู้ตรวจสอบเท่านั้น ตอนนี้ผ่านแล้วจึงเปิดทั้งฮับ
-- แก้ฟังก์ชันตัวเดียวจบ ตามที่วางไว้ตั้งแต่ 125
--
-- เปิดให้ทุกคนที่บัญชียังใช้งานอยู่ รวมถึง รปภ ด้วย
-- เพราะ รปภ เป็นคนแรกที่เห็นรถเข้าฮับ และบางกะเป็นคนเดียวที่อยู่หน้าลาน
--
-- สิ่งที่ยังไม่เปิดให้ทุกคน คือการแก้เกณฑ์เวลา
-- ซึ่งคุมด้วย policy แยกของ wait_truck_kpi ที่ยังเป็น my_role() = 'admin'
-- ไม่ได้ถูกแตะในไฟล์นี้ · เกณฑ์ที่ใครก็แก้ได้ คือเกณฑ์ที่พอใครสอบตกก็แก้เกณฑ์
--
-- การกดลงงานเสร็จ ยกเลิก และอัปไฟล์ เปิดให้ทุกคนตามที่เจ้าของระบบสั่ง
-- ตัวกันคือหน้าประวัติ ซึ่งบันทึกชื่อคนกดทุกครั้งและแก้ย้อนได้
-- =====================================================================

create or replace function my_can_wait_truck() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
     where id = auth.uid()
       and is_active
  );
$$;

comment on function my_can_wait_truck() is
  'ใครใช้กระดานรถรอลงงานได้ · เปิดทั้งฮับแล้ว ยกเว้นบัญชีที่ถูกระงับ';

grant execute on function my_can_wait_truck() to authenticated;


-- ---------------------------------------------------------------------
-- ล้างข้อมูลทดสอบให้หมดก่อนหน้างานเข้ามาเห็น
--
-- ไม่แตะตารางเกณฑ์เวลา เพราะนั่นคือค่าตั้งที่ต้องใช้ต่อ ไม่ใช่ข้อมูลทดสอบ
-- แถวในตารางจำตำแหน่งชีตหายตามไปเองด้วย on delete cascade
-- ---------------------------------------------------------------------
delete from wait_trucks;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname = 'my_can_wait_truck'
     and prosrc like '%is_active%')                      as "เปิดให้ทั้งฮับแล้ว",
  (select count(*) from pg_proc where proname = 'my_can_wait_truck'
     and prosrc like '%my_can_dispatch%')                as "ยังจำกัดผู้ตรวจสอบอยู่ไหม",
  (select count(*) from pg_policies
    where tablename = 'wait_truck_kpi' and policyname = 'write_wait_truck_kpi'
      and qual like '%admin%')                           as "เกณฑ์ยังเป็นของเจ้าของระบบ",
  (select count(*) from wait_trucks)                     as "รถที่เหลือ",
  (select count(*) from wait_sheet_exports)              as "แถวที่จำตำแหน่งชีตไว้",
  (select count(*) from wait_truck_kpi)                  as "เกณฑ์ที่ยังอยู่";
