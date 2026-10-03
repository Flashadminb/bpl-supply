-- =====================================================================
-- BPL SUPPLY — หน้าแจ้งเสียโชว์เฉพาะรูปที่แจ้งเสียมาจริง
-- รันต่อจาก 090 · ปลอดภัยที่จะรันซ้ำ
--
-- 089 ผมดึงรูปตอนเบิก/คืนมารวมในหน้าแจ้งเสียด้วย ซึ่งผิดเจตนา
-- รูปพวกนั้นคือหลักฐานการเบิกการคืนตามปกติ ไม่ใช่หลักฐานว่าของพัง
-- เอามาปนทำให้หน้าแจ้งเสียเต็มไปด้วยรูปเครื่องสภาพดี แล้วรูปอาการจริงจมหายไป
--
-- ที่ถูกคือโชว์เฉพาะรูปที่ถ่ายมาพร้อมการแจ้งเสีย ไม่ว่าจะแจ้งตอนก่อนเบิกหรือหลังคืน
-- และรูปตอนซ่อมเสร็จ แค่สองอย่างนี้
--
-- ไม่ได้ลบรูปตอนเบิก/คืนทิ้ง มันยังอยู่ที่หน้าหลักฐานเดิมของมันเหมือนเดิมทุกอย่าง
-- =====================================================================

create or replace function asset_issue_evidence(p_id bigint)
returns table (
  phase      text,
  source     text,
  file_id    text,
  web_link   text,
  created_at timestamptz,
  label      text
)
language sql stable security definer set search_path = public as $$
  select p.phase, 'issue'::text, p.file_id, p.web_link, p.created_at, null::text
    from asset_issue_photos p
   where my_can_audit() and p.issue_id = p_id
   order by p.created_at, p.file_id;
$$;

grant execute on function asset_issue_evidence(bigint) to authenticated;


-- ---------------------------------------------------------------------
-- จำนวนรูป — เอา txn_shots ออก เหลือเฉพาะรูปของการแจ้งเสียจริง
--
-- คงชื่อคอลัมน์ txn_shots ไว้แต่ให้เป็นศูนย์เสมอ
-- แอปรุ่นเก่าที่ยังค้างในเครื่องใครอ่านช่องนี้อยู่ จะได้ไม่พังเพราะหาคอลัมน์ไม่เจอ
-- ---------------------------------------------------------------------
drop view if exists asset_issue_rows;
create view asset_issue_rows
with (security_invoker = true) as
select
  i.id,
  i.asset_code,
  ty.name                                   as type_name,
  a.dept_code                               as asset_dept,
  i.symptom,
  i.phase,
  i.reported_at,
  coalesce(rp.full_name, i.reported_name)   as reported_by_name,
  rp.employee_code                          as reported_by_code,
  i.file_id,
  i.web_link,
  i.resolved_at,
  sp.full_name                              as resolved_by_name,
  i.resolve_note,
  (i.resolved_at is null)                   as is_open,
  (select count(*) from asset_issue_photos p
    where p.issue_id = i.id and p.phase = 'report')  as report_shots,
  (select count(*) from asset_issue_photos p
    where p.issue_id = i.id and p.phase = 'fix')     as fix_shots,
  0::bigint                                          as txn_shots
from asset_issues i
join assets a         on a.code = i.asset_code
join asset_types ty   on ty.code = a.type_code
left join profiles rp on rp.id = i.reported_by
left join profiles sp on sp.id = i.resolved_by;

grant select on asset_issue_rows to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
--
-- "ใบค้างที่ยังไม่มีรูปเลย" คือของที่หน้างานแจ้งมาก่อนจะบังคับถ่ายรูป
-- ของเก่าพวกนี้ไม่มีรูปจริง ๆ ไม่ได้หายไปไหน
-- ---------------------------------------------------------------------
select
  (select count(*) from asset_issues where resolved_at is null)          as ใบที่ยังค้าง,
  (select count(*) from asset_issue_rows
    where is_open and report_shots > 0)                                  as ใบค้างที่มีรูปอาการ,
  (select count(*) from asset_issue_rows
    where is_open and report_shots = 0)                                  as ใบค้างที่ยังไม่มีรูปเลย;
