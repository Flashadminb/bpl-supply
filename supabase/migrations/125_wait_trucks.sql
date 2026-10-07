-- =====================================================================
-- BPL SUPPLY — รถรอลงงาน · ฐานข้อมูลและเกณฑ์ KPI
-- รันต่อจาก 124 · ปลอดภัยที่จะรันซ้ำ
--
-- หน้างานทำเรื่องนี้ด้วยไฟล์ Excel อยู่แล้ว โหลดไฟล์ 未卸车明细 จากระบบบริษัท
-- ทุกชั่วโมงเพื่อรายงานหัวหน้า แล้วแปะลงชีตที่มีสูตรนับถอยหลังกับ VBA
-- ปัญหาของไฟล์นั้นคือต้องกดปุ่มเริ่มนาฬิกาเอง ลืมกดแล้วตัวเลขค้างทั้งวัน
-- และช่องทัน-ไม่ทันต้องติ๊กมือ ซึ่งติ๊กให้สวยได้ สถิติจึงเชื่อไม่ได้
--
-- ของใหม่นับเวลาเอง ตัดสินทัน-ไม่ทันเอง และเปิดดูจากมือถือได้
--
-- ── สองอย่างที่ไฟล์ต้นทางไม่ได้บอกตรง ๆ ──
--
-- ① ประเภทรถในไฟล์ใช้ไม่ได้ · มีแค่ 6W กับ others ซึ่งแยก 6W5 จาก 6W7 ไม่ออก
--    และ others คือ 14W · ของจริงซ่อนอยู่ในชื่อเส้นทาง DD1-6W7.2-WNOO-BPLL
--    ไฟล์ Excel ของหน้างานก็มีคอลัมน์ช่วยแอบอยู่คอลัมน์ R ด้วยเหตุนี้
--    ฝั่งเว็บจึงแกะจากชื่อเส้นทาง ตัวที่แกะไม่ออกจะให้คนเลือกเองก่อนกดรับ
--
-- ② เวลาในไฟล์เป็นเวลาไทยอยู่แล้ว ไม่มีโซนเวลาต่อท้าย
--    ฝั่งเว็บต้องแปลงเป็น Asia/Bangkok เสมอ อ่านเป็น UTC เมื่อไหร่
--    นาฬิกาจะเพี้ยนไปเจ็ดชั่วโมงทั้งกระดานโดยดูเหมือนทำงานปกติ
--
-- ── ขอบเขตรอบแรก ──
-- เปิดให้เจ้าของระบบกับผู้ตรวจสอบเท่านั้น ไว้ทดสอบก่อนปล่อยหน้างาน
-- =====================================================================

-- ---------------------------------------------------------------------
-- ① เกณฑ์ KPI ต่อประเภทรถ · เจ้าของระบบแก้เองได้จากหลังบ้าน
--
-- wait_minutes   รอลงงานได้นานเท่าไหร่ก่อนถือว่าเกิน · ของเดิม 120 ทุกประเภท
-- unload_minutes ลงงานให้เสร็จในกี่นาที · ยังไม่ได้ใช้ในรอบแรก
--                เพราะเจ้าของระบบเคาะว่าไม่ต้องมีสถานะกำลังลงงาน
--                เก็บช่องไว้เพราะไฟล์หน้างานมีเกณฑ์นี้อยู่แล้ว วันหลังอยากวัดจะได้ไม่ต้องย้ายตาราง
-- ---------------------------------------------------------------------
create table if not exists wait_truck_kpi (
  vehicle_type   text primary key,
  wait_minutes   integer not null check (wait_minutes between 1 and 1440),
  unload_minutes integer not null default 60 check (unload_minutes between 1 and 1440),
  sort_no        integer not null default 0,
  is_active      boolean not null default true
);

comment on table wait_truck_kpi is
  'เกณฑ์เวลารอลงงานต่อประเภทรถ · แก้ได้จากหน้าหลังบ้าน';

insert into wait_truck_kpi (vehicle_type, wait_minutes, unload_minutes, sort_no) values
  ('4W',  120,  20, 1),
  ('4WJ', 120,  25, 2),
  ('6W5', 120,  60, 3),
  ('6W7', 120,  60, 4),
  ('6W8', 120,  60, 5),
  ('14W', 120, 130, 6),
  ('22W', 120, 130, 7)
on conflict (vehicle_type) do nothing;


-- ---------------------------------------------------------------------
-- ② รถรอลงงาน
--
-- truck_barcode คือ 出车凭证 ในไฟล์ ซึ่งเป็นรหัสเที่ยวรถ ไม่ซ้ำกันในหนึ่งเที่ยว
-- ใช้เป็นตัวกันซ้ำตอนอัปไฟล์รอบที่สองของวันเดียวกัน
--
-- due_at เก็บเป็นค่าตายตัว ไม่ได้คำนวณสดจากตาราง KPI
-- เพราะถ้าวันหลังเจ้าของระบบแก้เกณฑ์จาก 120 เป็น 90
-- รถที่ลงไปแล้วเมื่อเดือนก่อนต้องไม่กลายเป็นสายย้อนหลัง สถิติจะเชื่อไม่ได้
-- kpi_minutes เก็บคู่ไว้ด้วย จะได้ตอบได้เสมอว่าตอนนั้นใช้เกณฑ์เท่าไหร่
-- ---------------------------------------------------------------------
create table if not exists wait_trucks (
  id             bigserial primary key,

  truck_barcode  text not null,
  arrived_at     timestamptz not null,
  from_station   text,
  plate          text,
  vehicle_type   text,
  route_name     text,
  carrier        text,
  driver_name    text,
  driver_phone   text,
  parcels        integer,

  kpi_minutes    integer not null,
  due_at         timestamptz not null,

  done_at        timestamptz,
  done_by        uuid references profiles (id),

  cancelled_at   timestamptz,
  cancelled_by   uuid references profiles (id),
  cancel_reason  text,

  imported_at    timestamptz not null default now(),
  imported_by    uuid references profiles (id),
  import_batch   uuid
);

comment on column wait_trucks.truck_barcode is
  'รหัสเที่ยวรถจากไฟล์ (出车凭证) · ใช้กันอัปซ้ำ';
comment on column wait_trucks.kpi_minutes is
  'เกณฑ์ที่ใช้ตอนนำเข้า · เก็บไว้เพื่อให้สถิติย้อนหลังไม่เปลี่ยนเมื่อแก้เกณฑ์';

-- หนึ่งเที่ยวรถที่ยังไม่จบ มีได้ใบเดียว · อัปไฟล์ซ้ำจึงไม่สร้างแถวซ้ำ
-- ปิดไปแล้วรหัสเดิมกลับมาใหม่ได้ เพราะรถคันเดิมวิ่งรอบใหม่
create unique index if not exists wait_trucks_open_uniq
  on wait_trucks (truck_barcode)
  where done_at is null and cancelled_at is null;

create index if not exists wait_trucks_open_idx
  on wait_trucks (due_at) where done_at is null and cancelled_at is null;
create index if not exists wait_trucks_arrived_idx
  on wait_trucks (arrived_at desc);


-- ---------------------------------------------------------------------
-- ③ ใครเห็นอะไร
--
-- รอบแรกเปิดให้เจ้าของระบบกับผู้ตรวจสอบเท่านั้น ไว้ทดสอบก่อนปล่อยหน้างาน
-- ไม่ได้ใช้ my_can_audit() เพราะตัวนั้นรวมแอดมินระดับหัวหน้าเข้ามาด้วย
-- ซึ่งกว้างกว่าที่เจ้าของระบบสั่งไว้ · วันเปิดจริงแก้ฟังก์ชันตัวเดียวจบ
-- ---------------------------------------------------------------------
create or replace function my_can_wait_truck() returns boolean
language sql stable security definer set search_path = public as $$
  select my_role() = 'admin' or my_can_dispatch();
$$;

grant execute on function my_can_wait_truck() to authenticated;

alter table wait_truck_kpi enable row level security;
alter table wait_trucks    enable row level security;

drop policy if exists read_wait_truck_kpi on wait_truck_kpi;
create policy read_wait_truck_kpi on wait_truck_kpi for select to authenticated
  using (my_can_wait_truck());

drop policy if exists write_wait_truck_kpi on wait_truck_kpi;
create policy write_wait_truck_kpi on wait_truck_kpi for all to authenticated
  using (my_role() = 'admin') with check (my_role() = 'admin');

drop policy if exists read_wait_trucks on wait_trucks;
create policy read_wait_trucks on wait_trucks for select to authenticated
  using (my_can_wait_truck());

-- เขียนผ่าน RPC เท่านั้น · ไม่มี policy insert/update/delete โดยตั้งใจ
-- เหมือนบัตรเบรคใน 080 ถือ token ของคนมีสิทธิ์ก็เขียนตรงไม่ได้


-- ---------------------------------------------------------------------
-- ④ แถวพร้อมสถานะ · คิดสดทุกครั้งที่อ่าน
--
-- ทำไมคิดสดไม่เก็บค่า — เหตุผลเดียวกับสถานะเข้าประชุมใน 061
-- สถานะเปลี่ยนตามเวลาที่เดินไปเรื่อย ๆ เก็บเป็นค่าตายตัวแล้วต้องมีใคร
-- คอยไล่อัปเดตทั้งฮับทุกนาที ซึ่งพลาดเมื่อไหร่ก็ค้างผิดโดยไม่มีใครรู้
--
-- late_sec เป็นบวก = เหลือเวลาอีกเท่านี้ · เป็นลบ = เกินมาแล้วเท่านี้
-- ฝั่งหน้าจอเอาไปเข้านาฬิกาป้ายพับตัวเดียวกับจอปล่อยรถได้เลย
-- ---------------------------------------------------------------------
drop view if exists wait_truck_rows;
create view wait_truck_rows
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
  t.parcels,
  t.kpi_minutes,
  t.due_at,
  t.done_at,
  dp.full_name                                      as done_by_name,
  t.cancelled_at,
  cp.full_name                                      as cancelled_by_name,
  t.cancel_reason,
  t.imported_at,
  -- เหลือ/เกินกี่วินาที · ของที่จบแล้วหยุดนับที่เวลาที่กดเสร็จ
  round(extract(epoch from (t.due_at - coalesce(t.done_at, now()))))::bigint as left_sec,
  round(extract(epoch from (coalesce(t.done_at, now()) - t.arrived_at)))::bigint as waited_sec,
  case
    when t.cancelled_at is not null then 'cancelled'
    when t.done_at is not null and t.done_at <= t.due_at then 'done_ontime'
    when t.done_at is not null then 'done_late'
    when now() > t.due_at then 'overdue'
    when now() > t.due_at - interval '20 minutes' then 'warn'
    else 'waiting'
  end                                               as state
from wait_trucks t
left join profiles dp on dp.id = t.done_by
left join profiles cp on cp.id = t.cancelled_by;

grant select on wait_truck_rows to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from wait_truck_kpi)                                    as เกณฑ์ที่ตั้งไว้,
  (select string_agg(vehicle_type || ' ' || wait_minutes || 'น.', ' · '
            order by sort_no) from wait_truck_kpi)                         as รายการเกณฑ์,
  (select count(*) from information_schema.tables
    where table_name = 'wait_trucks')                                      as ตารางรถ,
  (select count(*) from information_schema.views
    where table_name = 'wait_truck_rows')                                  as วิวสถานะ,
  (select count(*) from pg_proc where proname = 'my_can_wait_truck')       as ฟังก์ชันสิทธิ์;
