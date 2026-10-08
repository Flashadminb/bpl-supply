-- =====================================================================
-- BPL SUPPLY — รถรอลงงาน · แยกงาน DO ออกจากงานที่ไม่ใช่ DO
--                และประวัติว่าใครทำอะไร กับแดชบอร์ดเทียบช่วงเวลา
-- รันต่อจาก 127 · ปลอดภัยที่จะรันซ้ำ
--
-- ไฟล์ของบริษัทมีช่องพัสดุอยู่สามช่อง ซึ่งคนละความหมายกันหมด
--   待卸车包裹量  ที่ต้องขนถ่าย      = งานที่ต้องยกลงจริง ๆ รอบนี้
--   包裹总量      พัสดุทั้งหมด       = ของทั้งคัน
--   本地件        พัสดุจัดส่งโดยตรง  = งาน DO
--
-- ที่ผ่านมาเก็บแค่ช่องแรก · เจ้าของระบบขอให้แยก DO ออกมา
-- เพราะงาน DO กับงานที่ไม่ใช่ DO ไปคนละสายพานและใช้คนไม่เท่ากัน
-- รู้แค่ยอดรวมจึงวางกำลังคนไม่ได้ ต้องรู้ว่าในคันนั้นเป็น DO เท่าไหร่
--
-- "ไม่ใช่ DO" ไม่ได้เก็บเป็นช่อง เพราะมันคือผลลบของอีกสองช่อง
-- เก็บค่าที่คำนวณได้ไว้อีกช่องคือการเปิดช่องให้สามตัวเลขขัดกันเองวันหนึ่ง
-- =====================================================================

alter table wait_trucks add column if not exists parcels_total integer;
alter table wait_trucks add column if not exists parcels_do    integer;

comment on column wait_trucks.parcels_total is
  'พัสดุทั้งหมดในคัน (包裹总量) · ว่างแปลว่าไฟล์รุ่นเก่าที่นำเข้าก่อนมีช่องนี้';
comment on column wait_trucks.parcels_do is
  'พัสดุจัดส่งโดยตรง หรืองาน DO (本地件)';


-- ---------------------------------------------------------------------
-- ① แถวพร้อมสถานะ · เพิ่มสามช่องพัสดุ
--
-- parcels_all ใช้ coalesce เพราะรถที่นำเข้าก่อนไฟล์นี้ไม่มี parcels_total
-- ถ้าปล่อยให้เป็นว่าง กระดานจะขึ้นขีดกลางให้รถเมื่อวาน ซึ่งดูเหมือนข้อมูลหาย
-- ทั้งที่ของเดิมมีตัวเลขอยู่ แค่มาจากช่องที่ละเอียดน้อยกว่า
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
  coalesce(t.parcels_total, t.parcels)                                    as parcels_all,
  t.parcels_do,
  case
    when t.parcels_do is null then null
    else greatest(0, coalesce(t.parcels_total, t.parcels, 0) - t.parcels_do)
  end                                                                     as parcels_nondo,
  t.kpi_minutes,
  t.due_at,
  t.done_at,
  dp.full_name                                                            as done_by_name,
  t.cancelled_at,
  cp.full_name                                                            as cancelled_by_name,
  t.cancel_reason,
  t.imported_at,
  ip.full_name                                                            as imported_by_name,
  round(extract(epoch from (t.due_at - coalesce(t.done_at, now()))))::bigint   as left_sec,
  round(extract(epoch from (coalesce(t.done_at, now()) - t.arrived_at)))::bigint as waited_sec,
  case
    when t.cancelled_at is not null then 'cancelled'
    when t.done_at is not null and t.done_at <= t.due_at then 'done_ontime'
    when t.done_at is not null then 'done_late'
    when now() > t.due_at then 'overdue'
    when now() > t.due_at - interval '20 minutes' then 'warn'
    else 'waiting'
  end                                                                     as state
from wait_trucks t
left join profiles dp on dp.id = t.done_by
left join profiles cp on cp.id = t.cancelled_by
left join profiles ip on ip.id = t.imported_by;

grant select on wait_truck_rows to authenticated;


-- ---------------------------------------------------------------------
-- ② นำเข้า · รับสองช่องใหม่
--
-- เขียนทับทั้งตัวเพราะ plpgsql แก้ทีละบรรทัดไม่ได้ · ของเดิมยกมาครบ
-- ที่เพิ่มคือสองบรรทัดในวงเล็บ values กับสองบรรทัดในรายชื่อคอลัมน์
-- ---------------------------------------------------------------------
create or replace function wait_truck_import(p_rows jsonb, p_batch uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_batch uuid := coalesce(p_batch, gen_random_uuid());
  v_row   jsonb;
  v_code  text;
  v_type  text;
  v_when  timestamptz;
  v_kpi   integer;
  v_id    bigint;
  v_added integer := 0;
  v_skip  integer := 0;
  v_bad   jsonb := '[]'::jsonb;
begin
  if not my_can_wait_truck() then
    raise exception 'บัญชีนี้ยังใช้กระดานรถรอลงงานไม่ได้';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'ต้องส่งมาเป็นรายการแถว';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'ไฟล์เดียวเกิน 2000 แถว ตัดแบ่งก่อน';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_id   := null;
    v_kpi  := null;
    v_code := btrim(coalesce(v_row->>'barcode', ''));
    v_type := upper(btrim(coalesce(v_row->>'vehicle_type', '')));
    v_when := wait_truck_time(v_row->>'arrived_at');

    if v_code = '' then
      v_bad := v_bad || jsonb_build_object('barcode', '(ไม่มี)', 'why', 'ไม่มีบาร์โค้ดรถ');
      continue;
    end if;

    if v_when is null then
      v_bad := v_bad || jsonb_build_object('barcode', v_code, 'why', 'อ่านเวลารถถึงไม่ได้');
      continue;
    end if;

    select wait_minutes into v_kpi
      from wait_truck_kpi where vehicle_type = v_type and is_active;

    if v_kpi is null then
      v_bad := v_bad || jsonb_build_object('barcode', v_code, 'why',
        case when v_type = '' then 'ยังไม่ได้เลือกประเภทรถ'
             else 'ไม่มีเกณฑ์ของประเภท ' || v_type end);
      continue;
    end if;

    insert into wait_trucks (
      truck_barcode, arrived_at, from_station, plate, vehicle_type,
      route_name, carrier, driver_name, driver_phone,
      parcels, parcels_total, parcels_do,
      kpi_minutes, due_at, imported_by, import_batch)
    values (
      left(v_code, 60),
      v_when,
      nullif(btrim(coalesce(v_row->>'from_station',  '')), ''),
      nullif(btrim(coalesce(v_row->>'plate',         '')), ''),
      v_type,
      nullif(btrim(coalesce(v_row->>'route_name',    '')), ''),
      nullif(btrim(coalesce(v_row->>'carrier',       '')), ''),
      nullif(btrim(coalesce(v_row->>'driver_name',   '')), ''),
      nullif(btrim(coalesce(v_row->>'driver_phone',  '')), ''),
      nullif(regexp_replace(coalesce(v_row->>'parcels',       ''), '[^0-9]', '', 'g'), '')::integer,
      nullif(regexp_replace(coalesce(v_row->>'parcels_total', ''), '[^0-9]', '', 'g'), '')::integer,
      nullif(regexp_replace(coalesce(v_row->>'parcels_do',    ''), '[^0-9]', '', 'g'), '')::integer,
      v_kpi,
      v_when + make_interval(mins => v_kpi),
      auth.uid(),
      v_batch)
    on conflict do nothing
    returning id into v_id;

    if v_id is null then
      v_skip := v_skip + 1;
    else
      v_added := v_added + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true, 'batch', v_batch,
    'added', v_added, 'skipped', v_skip,
    'rejected', v_bad, 'rejected_n', jsonb_array_length(v_bad));
end $$;

grant execute on function wait_truck_import(jsonb, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- ③ ตัวเลขหัวจอ · เพิ่ม DO กับไม่ใช่ DO และยอดรวมทั้งรอบ
--
-- แยกเป็นสองฝั่งชัด ๆ คือ "ที่ยังรอ" กับ "ที่ลงไปแล้วในรอบนี้"
-- เพราะหน้างานถามสองคำถามคนละเวลา — ตอนนี้เหลืองานเท่าไหร่
-- กับ ตั้งแต่ตีสามทำไปได้เท่าไหร่แล้ว · ยอดเดียวตอบได้แค่คำถามเดียว
--
-- last_import คือเวลาอัปไฟล์ล่าสุด เอาไว้ขึ้นบนจอว่าข้อมูลสดแค่ไหน
-- จอที่ไม่บอกว่าข้อมูลเก่าแค่ไหน คือจอที่คนจะเชื่อตัวเลขค้างของเมื่อสามชั่วโมงก่อน
-- ---------------------------------------------------------------------
create or replace function wait_truck_counts()
returns jsonb
language sql stable security definer set search_path = public as $$
  with c as (select truck_cycle_start() as since),
  open_now as (
    select * from wait_truck_rows where done_at is null and cancelled_at is null
  ),
  fin as (
    select r.* from wait_truck_rows r, c
     where r.cancelled_at is null and r.done_at >= c.since
  )
  select jsonb_build_object(
    'waiting',      (select count(*) from open_now),
    'overdue',      (select count(*) from open_now where state = 'overdue'),
    'warn',         (select count(*) from open_now where state = 'warn'),
    'carried',      (select count(*) from open_now, c where arrived_at < c.since),
    'wait_parcels', (select coalesce(sum(parcels_all), 0)   from open_now),
    'wait_do',      (select coalesce(sum(parcels_do), 0)    from open_now),
    'wait_nondo',   (select coalesce(sum(parcels_nondo), 0) from open_now),

    'done',         (select count(*) from fin),
    'done_late',    (select count(*) from fin where state = 'done_late'),
    'on_time',      (select count(*) from fin where state = 'done_ontime'),
    'done_parcels', (select coalesce(sum(parcels_all), 0)   from fin),
    'done_do',      (select coalesce(sum(parcels_do), 0)    from fin),
    'done_nondo',   (select coalesce(sum(parcels_nondo), 0) from fin),

    'all_trucks',   (select count(*) from open_now) + (select count(*) from fin),
    'last_import',  (select max(imported_at) from wait_trucks),
    'cycle_start',  (select since from c)
  )
  from c
  where my_can_wait_truck();
$$;

grant execute on function wait_truck_counts() to authenticated;


-- ---------------------------------------------------------------------
-- ④ ประวัติว่าใครทำอะไร
--
-- ทำแบบเดียวกับ truck_log_rows ใน 113 คือแตกแถวของรถหนึ่งคัน
-- ออกเป็นหลายบรรทัดตามเหตุการณ์ ไม่ได้ทำตารางล็อกแยก
--
-- เหตุผลเดิม — ทุกอย่างที่ต้องรู้อยู่ในแถวของรถอยู่แล้ว
-- ตารางล็อกที่ซ้ำกับของเดิม คือของอีกชุดที่ต้องคอยดูแลให้ตรงกัน
-- และวันที่มันไม่ตรง จะไม่มีใครรู้ว่าควรเชื่อฝั่งไหน
-- ---------------------------------------------------------------------
drop view if exists wait_truck_log_rows;
create view wait_truck_log_rows
with (security_invoker = true) as
select
  t.id                                   as truck_id,
  'import'::text                         as event,
  t.imported_at                          as at,
  t.truck_barcode, t.from_station, t.plate, t.vehicle_type,
  t.arrived_at, t.due_at,
  null::text                             as reason,
  null::integer                          as late_min,
  p.full_name                            as who
from wait_trucks t
left join profiles p on p.id = t.imported_by

union all
select
  t.id, 'done', t.done_at,
  t.truck_barcode, t.from_station, t.plate, t.vehicle_type,
  t.arrived_at, t.due_at,
  null,
  greatest(0, round(extract(epoch from (t.done_at - t.due_at)) / 60))::int,
  p.full_name
from wait_trucks t
left join profiles p on p.id = t.done_by
where t.done_at is not null

union all
select
  t.id, 'cancel', t.cancelled_at,
  t.truck_barcode, t.from_station, t.plate, t.vehicle_type,
  t.arrived_at, t.due_at,
  t.cancel_reason,
  null,
  p.full_name
from wait_trucks t
left join profiles p on p.id = t.cancelled_by
where t.cancelled_at is not null;

grant select on wait_truck_log_rows to authenticated;


-- ---------------------------------------------------------------------
-- ⑤ สถิติ · เพิ่ม DO เข้าไปทุกชั้น
-- ---------------------------------------------------------------------
create or replace function wait_truck_stats(p_from date default null, p_to date default null)
returns jsonb
language sql stable security definer set search_path = public as $$
  with win as (
    select
      coalesce(p_from, (now() at time zone 'Asia/Bangkok')::date - 6) as d1,
      coalesce(p_to,   (now() at time zone 'Asia/Bangkok')::date)     as d2
  ),
  base as (
    select
      r.vehicle_type,
      r.from_station,
      r.parcels_all,
      r.parcels_do,
      r.parcels_nondo,
      (r.arrived_at at time zone 'Asia/Bangkok')::date                           as day_th,
      (r.state = 'done_ontime')                                                  as on_time,
      round(extract(epoch from (r.done_at - r.arrived_at)) / 60)::int            as wait_min,
      greatest(0, round(extract(epoch from (r.done_at - r.due_at)) / 60))::int   as over_min
    from wait_truck_rows r, win
    where r.done_at is not null
      and r.cancelled_at is null
      and (r.arrived_at at time zone 'Asia/Bangkok')::date between win.d1 and win.d2
  ),
  cancels as (
    select count(*) as n
      from wait_trucks t, win
     where t.cancelled_at is not null
       and (t.arrived_at at time zone 'Asia/Bangkok')::date between win.d1 and win.d2
  )
  select jsonb_build_object(
    'from',      (select d1 from win),
    'to',        (select d2 from win),
    'total',     (select count(*) from base),
    'on_time',   (select count(*) from base where on_time),
    'cancelled', (select n from cancels),
    'parcels',   (select coalesce(sum(parcels_all), 0)   from base),
    'parcels_do',    (select coalesce(sum(parcels_do), 0)    from base),
    'parcels_nondo', (select coalesce(sum(parcels_nondo), 0) from base),
    'avg_wait',  (select coalesce(round(avg(wait_min)), 0)::int from base),
    'worst',     (select coalesce(max(over_min), 0) from base),

    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day', day_th, 'total', n, 'on_time', ok, 'avg_wait', avg_w,
               'parcels', pa, 'parcels_do', pdo, 'parcels_nondo', pnd) order by day_th)
        from (select day_th, count(*) as n, count(*) filter (where on_time) as ok,
                     coalesce(round(avg(wait_min)), 0)::int as avg_w,
                     coalesce(sum(parcels_all), 0) as pa,
                     coalesce(sum(parcels_do), 0) as pdo,
                     coalesce(sum(parcels_nondo), 0) as pnd
                from base group by day_th) q), '[]'::jsonb),

    'by_type', coalesce((
      select jsonb_agg(jsonb_build_object(
               'vehicle_type', vehicle_type, 'total', n, 'on_time', ok,
               'avg_wait', avg_w, 'worst', worst_m,
               'parcels', pa, 'parcels_do', pdo, 'parcels_nondo', pnd) order by n desc)
        from (select vehicle_type, count(*) as n, count(*) filter (where on_time) as ok,
                     coalesce(round(avg(wait_min)), 0)::int as avg_w,
                     coalesce(max(over_min), 0) as worst_m,
                     coalesce(sum(parcels_all), 0) as pa,
                     coalesce(sum(parcels_do), 0) as pdo,
                     coalesce(sum(parcels_nondo), 0) as pnd
                from base group by vehicle_type) q), '[]'::jsonb),

    'by_station', coalesce((
      select jsonb_agg(jsonb_build_object(
               'from_station', from_station, 'total', n, 'on_time', ok,
               'avg_wait', avg_w, 'parcels', pa) order by n desc)
        from (select from_station, count(*) as n, count(*) filter (where on_time) as ok,
                     coalesce(round(avg(wait_min)), 0)::int as avg_w,
                     coalesce(sum(parcels_all), 0) as pa
                from base where from_station is not null
               group by from_station order by count(*) desc limit 20) q), '[]'::jsonb)
  )
  where my_can_wait_truck();
$$;

grant execute on function wait_truck_stats(date, date) to authenticated;


-- ---------------------------------------------------------------------
-- ⑥ เทียบสองช่วงเวลา
--
-- เรียกของเดิมสองครั้งแล้วห่อไว้ด้วยกัน ไม่ได้เขียนตรรกะนับใหม่
-- ถ้าเขียนใหม่ วันหนึ่งหน้าสรุปกับหน้าเทียบจะให้ตัวเลขคนละชุดของช่วงเดียวกัน
-- แล้วไม่มีใครรู้ว่าควรเชื่อหน้าไหน
-- ---------------------------------------------------------------------
create or replace function wait_truck_compare(
  p_a_from date, p_a_to date, p_b_from date, p_b_to date)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'a', wait_truck_stats(p_a_from, p_a_to),
    'b', wait_truck_stats(p_b_from, p_b_to))
  where my_can_wait_truck();
$$;

comment on function wait_truck_compare(date, date, date, date) is
  'สถิติสองช่วงวันคู่กัน · ห่อ wait_truck_stats ไว้ ไม่ได้นับใหม่';

grant execute on function wait_truck_compare(date, date, date, date) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'wait_trucks'
      and column_name in ('parcels_total', 'parcels_do'))                as ช่องพัสดุที่เพิ่ม,
  (select count(*) from information_schema.columns
    where table_name = 'wait_truck_rows'
      and column_name in ('parcels_all', 'parcels_do', 'parcels_nondo')) as วิวมีสามช่องแล้ว,
  (select count(*) from information_schema.views
    where table_name = 'wait_truck_log_rows')                           as วิวประวัติ,
  (select count(*) from pg_proc where proname = 'wait_truck_compare')   as ฟังก์ชันเทียบช่วง,
  (select count(*) from pg_proc where proname = 'wait_truck_counts'
     and prosrc like '%last_import%')                                   as หัวจอมีเวลาอัปล่าสุด,
  (select count(*) from wait_truck_log_rows)                            as บรรทัดประวัติตอนนี้;
