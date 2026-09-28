-- =====================================================================
-- BPL SUPPLY — สถานะการเข้าประชุมใน Google Sheet
-- รันต่อจาก 061 · ปลอดภัยที่จะรันซ้ำ
--
-- วิว meeting_rows เป็นตัวที่ Edge Function ส่งออกลงชีต
-- เพิ่มสถานะเข้ามา และถ้ามีการแก้โดยผู้ตรวจสอบให้ต่อท้ายไว้
--
-- คอลัมน์เดิมไม่ขยับสักตัว เพิ่มของใหม่ต่อท้ายอย่างเดียว
-- ชีตที่ส่งไปแล้วจึงยังอ่านตรงคอลัมน์เดิมได้เหมือนเดิม
--
-- สองชั้นที่ต้องแยกให้ออก
--   status   ผู้ตรวจสอบกดยืนยัน/ไม่นับรูปเซลฟี่ (ของเดิม มีมาตั้งแต่แรก)
--   attend   มาตรงเวลา/สาย/ผ่อนผัน (ของใหม่ คิดจากเวลาที่เช็ค)
-- คนละเรื่องกัน รูปใช้ได้แต่มาสายก็มี รูปไม่ผ่านแต่มาตรงเวลาก็มี
-- =====================================================================

drop view if exists meeting_export_rows;
drop view if exists meeting_rows;
create view meeting_rows
with (security_invoker = true) as
select
  m.id,
  m.ref_no,
  m.user_id,
  p.full_name,
  p.employee_code,
  m.dept_code,
  m.sub_dept,
  m.shift_start,
  m.shift_end,
  m.note,
  m.file_id,
  m.web_link,
  m.status,
  m.decided_by,
  d.full_name as decided_by_name,
  m.decided_at,
  m.decide_note,
  m.created_at,
  (m.created_at at time zone 'Asia/Bangkok')::date as day,

  -- ── ของใหม่ ต่อท้าย ────────────────────────────────────────────────
  m.event_id,
  e.title            as event_title,
  e.meet_at          as event_at,
  m.is_late,
  m.late_min,
  -- สถานะที่ใช้จริง — ของผู้ตรวจสอบชนะค่าที่ระบบคำนวณ
  coalesce(o.state, case when m.is_late then 'late' else 'ontime' end) as attend_state,
  o.reason           as attend_reason,
  ob.full_name       as attend_by_name,
  o.at               as attend_at
from meeting_checkins m
join profiles p      on p.id = m.user_id
left join profiles d on d.id = m.decided_by
left join meeting_events e on e.id = m.event_id
left join meeting_overrides o on o.event_id = m.event_id and o.user_id = m.user_id
left join profiles ob on ob.id = o.by_user;

grant select on meeting_rows to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'meeting_rows' and column_name = 'attend_state')  as มีสถานะเข้าประชุม,
  (select count(*) from information_schema.columns
    where table_name = 'meeting_rows' and column_name = 'attend_reason') as มีเหตุผลที่แก้,
  (select count(*) from information_schema.columns
    where table_name = 'meeting_rows')                                   as คอลัมน์ทั้งหมด,
  (select count(*) from meeting_rows)                                    as แถวข้อมูลที่มี;


-- ---------------------------------------------------------------------
-- วิวที่พึ่งพา meeting_rows ต้องสร้างใหม่ตามไปด้วย
--
-- Postgres ไม่ยอมให้ drop วิวที่มีคนอ้างอิงอยู่ ต้องไล่สร้างจากล่างขึ้นบน
-- ตัวนี้เนื้อหาเดิมทุกบรรทัด แค่ต้องประกาศใหม่หลังตัวแม่เปลี่ยนรูปร่าง
-- ---------------------------------------------------------------------
create or replace view meeting_export_rows
with (security_invoker = true) as
select
  m.id,
  m.ref_no,
  m.created_at,
  m.full_name,
  m.employee_code,
  m.dept_code,
  m.status,
  e.tab,
  e.row_no,
  e.exported_at,
  (e.tab is not null) as is_exported
from meeting_rows m
left join meeting_sheet_exports e on e.meeting_id = m.id;

grant select on meeting_export_rows to authenticated;
