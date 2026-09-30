-- =====================================================================
-- BPL SUPPLY — ส่งประวัติการสแกนบัตร OS ลง Google Sheet
-- รันต่อจาก 072 · ปลอดภัยที่จะรันซ้ำ
--
-- โครงเดียวกับ sack_sheet_exports ทุกอย่าง
-- จำว่าแถวไหนไปอยู่แท็บไหนบรรทัดที่เท่าไหร่ แล้วครั้งต่อไปเขียนทับที่เดิม
-- ไม่ต้องอ่านทั้งชีตมาเทียบ เร็วคงที่ไม่ว่าชีตจะใหญ่แค่ไหน
--
-- ทำไมต้องส่งซ้ำได้ ทั้งที่การสแกนเกิดครั้งเดียวแล้วจบ
--   รปภ กดติดธงทีหลังได้ แถวที่ส่งไปแล้วจึงเปลี่ยนเนื้อหาได้
--   needs_push จึงดูเวลาติดธงด้วย ไม่ได้ดูแค่ว่าเคยส่งหรือยัง
--
-- ของเก่าถูก os_scans_rollup ยุบทิ้งเป็นสรุปรายวันหลังผ่านไปอย่างน้อย 30 วัน
-- แถวตามรอยผูกกับ os_scans ด้วย on delete cascade จึงหายตามไปเอง
-- ซึ่งกลับเป็นข้อดี เพราะชีตจะกลายเป็นที่เก็บประวัติระยะยาวแทนฐานข้อมูล
-- แต่แปลว่า **ต้องกดส่งลงชีตก่อนถึงรอบยุบ** ไม่งั้นรายละเอียดรายครั้งหายไปเลย
-- =====================================================================

create table if not exists os_scan_exports (
  scan_id     bigint primary key references os_scans (id) on delete cascade,
  tab         text not null,
  row_no      integer not null,
  exported_at timestamptz not null default now()
);

alter table os_scan_exports enable row level security;

-- ใครอ่านประวัติสแกนได้ ก็อ่านตารางตามรอยได้ ใช้เกณฑ์เดียวกับ os_scans
drop policy if exists read_os_scan_exports on os_scan_exports;
create policy read_os_scan_exports on os_scan_exports for select to authenticated
  using (my_can_os_admin());


-- ---------------------------------------------------------------------
-- วิวสำหรับนับว่ายังค้างกี่แถว — หน้าจอถามตัวนี้ ไม่ต้องรู้จักตารางตามรอย
-- ---------------------------------------------------------------------
drop view if exists os_scan_export_rows;
create view os_scan_export_rows
with (security_invoker = true) as
select
  s.id,
  s.scanned_at,
  s.result,
  e.tab,
  e.row_no,
  e.exported_at,
  (e.tab is not null) as is_exported,
  -- ส่งไปแล้วแต่ รปภ มาติดธงทีหลัง ต้องส่งซ้ำให้ชีตตรงกับความจริง
  (e.tab is null or e.exported_at < coalesce(s.flagged_at, s.scanned_at)) as needs_push
from os_scans s
left join os_scan_exports e on e.scan_id = s.id;

grant select on os_scan_export_rows to authenticated;

-- Edge Function อ่านผ่าน service_role วิวใหม่ต้องให้สิทธิ์เองไม่ได้ตกทอดมา
grant select on os_scan_rows to service_role;
grant select on os_scan_export_rows to service_role;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_name = 'os_scan_exports')                        as ตารางตามรอย,
  (select count(*) from information_schema.views
    where table_name = 'os_scan_export_rows')                    as วิวสำหรับนับ,
  (select count(*) from os_scans)                                as สแกนทั้งหมด,
  (select count(*) from os_scan_export_rows where needs_push)    as ที่ยังต้องส่ง;
