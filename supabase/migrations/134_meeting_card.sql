-- =====================================================================
-- BPL SUPPLY — การ์ดประกาศประชุม บอกให้ถูกคนและบอกให้พอ
-- รันต่อจาก 133 · ปลอดภัยที่จะรันซ้ำ
--
-- สองอย่างที่ผิดอยู่บนการ์ดนี้
--
-- ① ขึ้นให้ทุกคนเห็น ทั้งที่นัดเรียกแค่ 46 จาก 92 คน
--    คนที่ไม่ได้ถูกเรียกเห็นแล้วไม่รู้ว่าต้องไปหรือเปล่า บางคนไปทั้งที่ไม่ต้องไป
--    ประกาศที่ขึ้นกับคนที่ไม่เกี่ยว คือประกาศที่สอนให้คนเลิกอ่านประกาศ
--
-- ② บรรทัดผู้เข้าร่วมยาวเป็นพรืด "MINI CS, QC, IE และอีก 35 คน · รวม 46 คน"
--    ซึ่งไม่ได้ช่วยให้ใครตัดสินใจอะไรได้ คนอ่านอยากรู้แค่ว่าตัวเองต้องไปไหม
--    ซึ่งตอบไปแล้วด้วยข้อ ① · เหลือไว้แค่จำนวนก็พอ
--    วันที่มีตำแหน่งงานในระบบแล้วค่อยกลับมาเขียนให้มีความหมายกว่านี้
--
-- วิวนี้ใช้ทั้งฝั่งหน้างานและฝั่งหลังบ้าน จึงไม่กรองแถวทิ้งที่ฐานข้อมูล
-- เพิ่มเป็นคอลัมน์ for_me ให้ฝั่งหน้าจอเลือกเอง
-- ถ้ากรองทิ้งตรงนี้ ผู้ตรวจสอบที่ไม่ได้ถูกเรียกเข้าประชุม จะมองไม่เห็นนัด
-- ที่ตัวเองต้องไปกดปิด ซึ่งพังกว่าเดิม
-- =====================================================================

drop view if exists meeting_event_rows;
create view meeting_event_rows
with (security_invoker = true) as
select
  e.id,
  e.title,
  e.meet_at,
  e.audience,
  e.place,
  e.note,
  e.created_by,
  p.full_name as created_by_name,
  e.created_at,
  e.cancelled_at,
  e.closed_at,
  c.full_name as closed_by_name,
  e.open_before_min,
  e.late_after_min,
  e.audience_mode,
  (e.meet_at at time zone 'Asia/Bangkok')::date as day,

  -- จำนวนคนที่ถูกเรียก · โหมด free ไม่มีรายชื่อจึงเป็นศูนย์
  (select count(*)::int from meeting_members m where m.event_id = e.id) as member_count,

  -- การ์ดนี้ควรขึ้นให้คนที่เปิดอยู่เห็นไหม
  --   free        ไม่มีรายชื่อ แปลว่าตั้งใจประกาศทั่วถึง · ขึ้นให้ทุกคน
  --   มีรายชื่อ    ขึ้นเฉพาะคนในรายชื่อ
  --   คนประกาศ    เห็นเสมอ ไม่งั้นประกาศไปแล้วไม่มีอะไรยืนยันว่าขึ้นจริง
  (
    e.audience_mode = 'free'
    or e.created_by = auth.uid()
    or exists (select 1 from meeting_members m
                where m.event_id = e.id and m.user_id = auth.uid())
  ) as for_me

from meeting_events e
join profiles p      on p.id = e.created_by
left join profiles c on c.id = e.closed_by;

grant select on meeting_event_rows to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'meeting_event_rows' and column_name = 'for_me')       as "มีคอลัมน์ for_me",
  (select count(*) from information_schema.columns
    where table_name = 'meeting_event_rows' and column_name = 'member_count') as "มีคอลัมน์ member_count",
  (select count(*) from meeting_event_rows)                                   as "นัดทั้งหมด",
  (select count(*) from meeting_events e
    where e.audience_mode <> 'free'
      and (select count(*) from meeting_members m where m.event_id = e.id) > 0) as "นัดที่มีรายชื่อ";
