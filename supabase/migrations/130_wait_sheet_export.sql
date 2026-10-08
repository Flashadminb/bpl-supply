-- =====================================================================
-- BPL SUPPLY — รถรอลงงาน · สำรองลง Google Sheet
-- รันต่อจาก 129 · ปลอดภัยที่จะรันซ้ำ
--
-- เดิมเจ้าของระบบบอกว่าอัปไฟล์แล้วทิ้งได้ ไม่ต้องสำรอง แล้วเปลี่ยนใจ
-- ซึ่งสมเหตุสมผล เพราะงานกวาดกลางคืนลบของเกิน 400 วัน
-- ชีตจึงเป็นที่เดียวที่เก็บได้ยาวกว่านั้นโดยไม่กินพื้นที่ฐานข้อมูล
--
-- ทำตามแบบเดียวกับประวัติปล่อยรถใน 103 ทุกอย่าง
-- จำตำแหน่งที่เคยเขียนไว้ (แท็บ + เลขแถว) ลงฐานข้อมูล
-- กดส่งซ้ำกี่ครั้งก็ไม่เกิดแถวซ้ำในชีต และไม่ต้องอ่านทั้งชีตมาเทียบ
-- จึงเร็วคงที่ไม่ว่าชีตจะใหญ่แค่ไหน
--
-- ส่งเฉพาะคันที่จบแล้ว ลงงานเสร็จหรือถูกยกเลิก
-- คันที่ยังรออยู่บนกระดานยังไม่ใช่ประวัติ ส่งไปแล้วต้องตามกลับมาแก้ทุกแถว
-- =====================================================================

create table if not exists wait_sheet_exports (
  truck_id    bigint primary key references wait_trucks (id) on delete cascade,
  tab         text not null,
  row_no      integer not null,
  exported_at timestamptz not null default now()
);

comment on table wait_sheet_exports is
  'จำว่ารถคันไหนถูกเขียนลงชีตที่แท็บไหนแถวไหนแล้ว · กันแถวซ้ำตอนกดส่งซ้ำ';

alter table wait_sheet_exports enable row level security;

drop policy if exists read_wait_sheet_exports on wait_sheet_exports;
create policy read_wait_sheet_exports on wait_sheet_exports for select to authenticated
  using (my_can_wait_truck());

grant select on wait_sheet_exports to authenticated;
grant all on wait_sheet_exports to service_role;


-- ---------------------------------------------------------------------
-- แถวที่พร้อมส่งลงชีต
--
-- แบนทุกอย่างเป็นข้อความพร้อมใช้ตั้งแต่ในฐานข้อมูล
-- ฝั่ง Edge Function จึงไม่ต้องรู้เรื่องเขตเวลาหรือการคำนวณใด ๆ เลย
-- ซึ่งสำคัญ เพราะโค้ดที่คำนวณเวลาอยู่สองที่ คือโค้ดที่วันหนึ่งจะให้คำตอบไม่ตรงกัน
-- ---------------------------------------------------------------------
drop view if exists wait_export_rows;
create view wait_export_rows
with (security_invoker = true) as
select
  t.id,
  t.truck_barcode,
  t.arrived_at,
  t.from_station,
  t.plate,
  t.vehicle_type,
  t.route_name,
  t.carrier,
  t.driver_name,
  t.driver_phone,
  coalesce(t.parcels_total, t.parcels)                                      as parcels_all,
  t.parcels_do,
  case
    when t.parcels_do is null then null
    else greatest(0, coalesce(t.parcels_total, t.parcels, 0) - t.parcels_do)
  end                                                                       as parcels_nondo,
  t.kpi_minutes,
  t.due_at,
  t.done_at,
  dp.full_name                                                              as done_by_name,
  t.cancelled_at,
  cp.full_name                                                              as cancelled_by_name,
  t.cancel_reason,
  t.imported_at,
  ip.full_name                                                              as imported_by_name,
  -- รอไปกี่นาทีจนกด · ของที่ถูกยกเลิกนับถึงตอนยกเลิก
  round(extract(epoch from (coalesce(t.done_at, t.cancelled_at) - t.arrived_at)) / 60)::int
                                                                            as waited_min,
  -- เกินเกณฑ์ไปกี่นาที · ยังไม่เกินคือศูนย์
  case
    when t.done_at is null then null
    else greatest(0, round(extract(epoch from (t.done_at - t.due_at)) / 60))::int
  end                                                                       as over_min,
  case
    when t.cancelled_at is not null then 'ยกเลิก'
    when t.done_at <= t.due_at then 'ทันเวลา'
    else 'ไม่ทัน'
  end                                                                       as result_th
from wait_trucks t
left join profiles dp on dp.id = t.done_by
left join profiles cp on cp.id = t.cancelled_by
left join profiles ip on ip.id = t.imported_by
where t.done_at is not null or t.cancelled_at is not null;

grant select on wait_export_rows to authenticated;


-- ---------------------------------------------------------------------
-- นับว่ายังมีคันไหนยังไม่ได้ส่ง · หน้าหลังบ้านเอาไปขึ้นบนปุ่ม
--
-- ปุ่มที่ไม่บอกว่ากดแล้วจะเกิดอะไร คือปุ่มที่คนกดทิ้งกดขว้างหรือไม่กล้ากดเลย
-- ---------------------------------------------------------------------
create or replace function wait_sheet_pending()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'pending', (select count(*) from wait_export_rows r
                 where not exists (select 1 from wait_sheet_exports e where e.truck_id = r.id)),
    'sent',    (select count(*) from wait_sheet_exports),
    'last_at', (select max(exported_at) from wait_sheet_exports)
  )
  where my_can_wait_truck();
$$;

grant execute on function wait_sheet_pending() to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_name = 'wait_sheet_exports')                  as "ตารางจำตำแหน่ง",
  (select count(*) from information_schema.views
    where table_name = 'wait_export_rows')                    as "วิวแถวที่พร้อมส่ง",
  (select count(*) from pg_proc
    where proname = 'wait_sheet_pending')                     as "ฟังก์ชันนับค้าง",
  (select count(*) from wait_export_rows)                     as "แถวพร้อมส่งตอนนี้",
  (select count(*) from wait_trucks)                          as "รถทั้งหมดตอนนี้";
