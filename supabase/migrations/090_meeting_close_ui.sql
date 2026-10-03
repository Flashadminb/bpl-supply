-- =====================================================================
-- BPL SUPPLY — เปิดทางให้หน้าจอกดปิดประชุมได้จริง
-- รันต่อจาก 089 · ปลอดภัยที่จะรันซ้ำ
--
-- อาการ
--   ปิดประชุมไม่ได้ กล้องเช็คชื่อยังเปิดค้างไว้เรื่อย ๆ หลังประชุมเลิกแล้ว
--   คนที่มาสายเป็นชั่วโมงก็ยังกดเช็คได้อยู่ แค่ติดป้ายว่าสาย
--
-- สาเหตุ
--   ฟังก์ชัน close_meeting / reopen_meeting มีมาตั้งแต่ 064 และทำงานได้ปกติ
--   แต่ไม่เคยมีปุ่มไหนในแอปเรียกมันเลย และ view ที่หน้าจอใช้ก็ไม่มีช่อง closed_at
--   หน้าจอจึงไม่รู้ด้วยซ้ำว่านัดไหนปิดไปแล้ว
--
-- ไฟล์นี้แค่เปิดช่องให้ view ส่งสถานะออกไป ตรรกะการปิดไม่ได้แตะเลย
--
-- ปิด ต่างจาก ยกเลิก
--   ปิด     ประชุมเกิดขึ้นจริงแล้วจบ · รายชื่อใครมาใครขาดยังอยู่ครบ
--   ยกเลิก  ประชุมไม่ได้เกิด · ทั้งใบหายไปจากระบบ
--   เลิกประชุมแล้วต้องกดปิด ไม่ใช่กดยกเลิก ไม่งั้นหลักฐานการเข้าประชุมหายตามไปด้วย
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
  (e.meet_at at time zone 'Asia/Bangkok')::date as day
from meeting_events e
join profiles p      on p.id = e.created_by
left join profiles c on c.id = e.closed_by;

grant select on meeting_event_rows to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'meeting_event_rows' and column_name = 'closed_at') as วิวมีช่องปิดแล้ว,
  (select count(*) from meeting_events
    where cancelled_at is null and closed_at is null)                      as นัดที่ยังเปิดอยู่,
  (select count(*) from meeting_events where closed_at is not null)        as นัดที่ปิดไปแล้ว;
