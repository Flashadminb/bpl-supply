-- =====================================================================
-- BPL SUPPLY — ส่งรายการกระสอบลง Google Sheet
-- รันต่อจาก 067 · ปลอดภัยที่จะรันซ้ำ
--
-- โครงเดียวกับ sheet_exports ของฝั่งเบิกทุกอย่าง
-- จำว่าแถวไหนไปอยู่แท็บไหนบรรทัดที่เท่าไหร่ แล้วครั้งต่อไปเขียนทับที่เดิม
-- ไม่ต้องอ่านทั้งชีตมาเทียบ เร็วคงที่ไม่ว่าชีตจะใหญ่แค่ไหน
--
-- ทำไมส่งใบที่ยังไม่ได้ส่งของลงไปด้วย
--   ส่วนกลางอยากเห็นคิวที่ค้างอยู่ ไม่ใช่เห็นเฉพาะของที่ไปแล้ว
--   พอหน้างานกดส่ง ส่งออกรอบถัดไปจะเขียนทับแถวเดิม สถานะในชีตจึงขยับตามเอง
--   ตำแหน่งแถวผูกกับเดือนที่ตั้งรายการ ไม่ใช่เดือนที่ส่ง แถวจึงไม่ย้ายแท็บทีหลัง
-- =====================================================================

create table if not exists sack_sheet_exports (
  sack_id     uuid primary key references sack_orders (id) on delete cascade,
  tab         text not null,
  row_no      integer not null,
  exported_at timestamptz not null default now()
);

alter table sack_sheet_exports enable row level security;

drop policy if exists read_sack_exports on sack_sheet_exports;
create policy read_sack_exports on sack_sheet_exports for select to authenticated
  using (my_role() in ('admin', 'supervisor') or my_can_audit());


-- ---------------------------------------------------------------------
-- วิวสำหรับนับว่ายังค้างกี่แถว — หน้าจอถามตัวนี้ ไม่ต้องรู้จักตารางตามรอย
-- ---------------------------------------------------------------------
drop view if exists sack_export_rows;
create view sack_export_rows
with (security_invoker = true) as
select
  o.id,
  o.ref_no,
  o.created_at,
  o.branch,
  o.status,
  e.tab,
  e.row_no,
  e.exported_at,
  (e.tab is not null) as is_exported,
  -- ส่งไปแล้วแต่สถานะเปลี่ยนทีหลัง ต้องส่งซ้ำให้ชีตตรงกับความจริง
  (e.tab is null or e.exported_at < coalesce(o.sent_at, o.created_at)) as needs_push
from sack_orders o
left join sack_sheet_exports e on e.sack_id = o.id;

grant select on sack_export_rows to authenticated;

-- Edge Function อ่านผ่าน service_role วิวใหม่ต้องให้สิทธิ์เองไม่ได้ตกทอดมา
grant select on sack_rows to service_role;
grant select on sack_export_rows to service_role;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_name = 'sack_sheet_exports')                  as ตารางตามรอย,
  (select count(*) from information_schema.views
    where table_name = 'sack_export_rows')                    as วิวสำหรับนับ,
  (select count(*) from sack_orders)                          as รายการทั้งหมด,
  (select count(*) from sack_export_rows where needs_push)    as ที่ยังต้องส่ง;
