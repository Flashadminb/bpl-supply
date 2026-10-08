-- =====================================================================
-- BPL SUPPLY — รถรอลงงาน · "ไม่รู้" ต้องไม่ถูกแสดงเป็น "ศูนย์"
-- รันต่อจาก 128 · ปลอดภัยที่จะรันซ้ำ
--
-- 128 ใช้ coalesce(sum(parcels_do), 0) ซึ่งทำให้รถที่นำเข้าก่อนมีช่อง DO
-- ขึ้นบนจอว่า "DO 0 ชิ้น" · ซึ่งไม่ใช่ความจริง ความจริงคือไฟล์ไม่ได้บอกมา
--
-- ต่างกันมากตรงที่ศูนย์คือคำตอบ ส่วนไม่รู้คือยังไม่มีคำตอบ
-- จอที่ตอบว่าศูนย์ทั้งที่ไม่รู้ จะทำให้คนวางกำลังคนผิดโดยไม่มีอะไรเตือน
--
-- sum() คืน null อยู่แล้วเมื่อทุกแถวเป็น null · เอา coalesce ออกก็พอ
-- ฝั่งหน้าจอขึ้นขีดกลางให้เองเมื่อเจอ null
--
-- ยอดพัสดุรวมยังใส่ coalesce ไว้เหมือนเดิม เพราะช่องนั้นมีค่าเสมอ
-- =====================================================================

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
    'wait_parcels', (select coalesce(sum(parcels_all), 0) from open_now),
    'wait_do',      (select sum(parcels_do)                from open_now),
    'wait_nondo',   (select sum(parcels_nondo)             from open_now),

    'done',         (select count(*) from fin),
    'done_late',    (select count(*) from fin where state = 'done_late'),
    'on_time',      (select count(*) from fin where state = 'done_ontime'),
    'done_parcels', (select coalesce(sum(parcels_all), 0) from fin),
    'done_do',      (select sum(parcels_do)                from fin),
    'done_nondo',   (select sum(parcels_nondo)             from fin),

    'all_trucks',   (select count(*) from open_now) + (select count(*) from fin),
    'last_import',  (select max(imported_at) from wait_trucks),
    'cycle_start',  (select since from c)
  )
  from c
  where my_can_wait_truck();
$$;

grant execute on function wait_truck_counts() to authenticated;


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
    'parcels',       (select coalesce(sum(parcels_all), 0) from base),
    'parcels_do',    (select sum(parcels_do)                from base),
    'parcels_nondo', (select sum(parcels_nondo)             from base),
    'avg_wait',  (select coalesce(round(avg(wait_min)), 0)::int from base),
    'worst',     (select coalesce(max(over_min), 0) from base),

    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day', day_th, 'total', n, 'on_time', ok, 'avg_wait', avg_w,
               'parcels', pa, 'parcels_do', pdo, 'parcels_nondo', pnd) order by day_th)
        from (select day_th, count(*) as n, count(*) filter (where on_time) as ok,
                     coalesce(round(avg(wait_min)), 0)::int as avg_w,
                     coalesce(sum(parcels_all), 0) as pa,
                     sum(parcels_do) as pdo,
                     sum(parcels_nondo) as pnd
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
                     sum(parcels_do) as pdo,
                     sum(parcels_nondo) as pnd
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
-- ตรวจผล · ของที่ยังไม่รู้ต้องเป็น null ไม่ใช่ 0
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname = 'wait_truck_counts'
     and prosrc not like '%coalesce(sum(parcels_do)%')              as ตัวนับเลิกกลบเป็นศูนย์,
  (select count(*) from pg_proc where proname = 'wait_truck_stats'
     and prosrc not like '%coalesce(sum(parcels_do)%')              as สถิติเลิกกลบเป็นศูนย์,
  (select count(*) from wait_trucks where parcels_do is null)       as "แถวที่ยังไม่รู้ DO",
  (select count(*) from wait_trucks where parcels_do is not null)   as "แถวที่รู้ DO แล้ว";
