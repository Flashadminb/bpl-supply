-- ---------------------------------------------------------------------
-- 177 · ส่งประวัติการแก้ไขบัตรเบรคขึ้นชีต
--
-- ─────────────────────────────────────────────────────────────────
-- ทำไมตารางนี้ถึงต้องย้ายออกเป็นตัวแรก
--
-- มันโตเร็วเกือบเท่าตัวใบเบรคเอง ราวสามแถวต่อใบหนึ่งใบ
-- ที่ 31 วันกิน 34 MB ซึ่งแพงที่สุดในตารางทั้งหมด
-- ทั้งที่เนื้อในเป็นแค่ร่องรอยว่าใครกดอะไร ไม่ใช่ตัวหลักฐานการทำงาน
--
-- เจ้าของระบบจึงสั่งให้ไปอยู่ในชีตร้อยเปอร์เซ็นต์
-- ฐานข้อมูลเก็บไว้แค่จนกว่ารอบส่งคืนถัดไปจะทำงาน ราวหนึ่งวัน แล้วหายไปเอง
-- ─────────────────────────────────────────────────────────────────
--
-- ─────────────────────────────────────────────────────────────────
-- ข้อควรระวังที่สำคัญกว่าเรื่องพื้นที่
--
-- ตารางนี้คือหลักฐานว่าใครแก้หรือลบใบเบรคทิ้ง
-- 149_break_audit.sql จงใจไม่ผูก foreign key ไว้ เพราะต้องอยู่ต่อแม้ใบถูกลบ
--
-- ย้ายไปชีตคือย้ายหลักฐานไปไว้ในที่ที่คนลบแถวได้ด้วยมือ
-- ในฐานข้อมูลมี RLS คุม แก้ย้อนหลังไม่ได้ แต่ในชีตใครเข้าถึงไฟล์ได้ก็ลบได้
--
-- **ต้องไปกด Protect sheet ล็อกแท็บนั้นในชีตด้วย** ให้แก้ได้เฉพาะเจ้าของระบบ
-- ขั้นตอนนั้นทำจากฝั่งโค้ดไม่ได้ ต้องกดเองในหน้า Google Sheet
-- ─────────────────────────────────────────────────────────────────

create table if not exists break_audit_exports (
  audit_id    bigint primary key references break_audit (id) on delete cascade,
  tab         text not null,
  row_no      integer not null,
  exported_at timestamptz not null default now()
);

alter table break_audit_exports enable row level security;

-- ใครอ่านประวัติการแก้ไขได้ ก็อ่านตารางตามรอยได้ · เกณฑ์เดียวกับ break_sheet_exports
drop policy if exists read_break_audit_exports on break_audit_exports;
create policy read_break_audit_exports on break_audit_exports for select to authenticated
  using (my_can_audit());

grant select on break_audit_exports to authenticated;
grant all on break_audit_exports to service_role;


-- ---------------------------------------------------------------------
-- วิวที่ Edge Function ใช้ส่งออก
--
-- ต่อชื่อคนที่ทำไว้ให้เลย เพราะในชีตต้องอ่านออกโดยไม่ต้องไปเปิดตารางอื่นเทียบ
-- และวันหนึ่งที่แถวนี้ถูกลบจากฐานข้อมูลแล้ว ก็ไม่มีตารางอื่นให้เทียบอีก
-- ---------------------------------------------------------------------
create or replace view break_audit_export_rows
with (security_invoker = true) as
select
  a.id,
  a.at,
  a.pass_id,
  a.ref_no,
  a.card_code,
  a.action,
  a.field,
  a.before_val,
  a.after_val,
  a.reason,
  p.full_name     as by_name,
  p.employee_code as by_code
from break_audit a
left join profiles p on p.id = a.by_id;

grant select on break_audit_export_rows to authenticated, service_role;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from break_audit)                        as แถวทั้งหมด,
  (select count(*) from break_audit_exports)                as ส่งไปแล้ว,
  (select count(*) from break_audit_export_rows)            as วิวอ่านได้,
  (select count(*) from break_audit a
     left join break_audit_exports e on e.audit_id = a.id
    where e.audit_id is null)                               as ยังไม่ได้ส่ง;
