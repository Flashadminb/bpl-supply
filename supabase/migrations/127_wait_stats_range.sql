-- =====================================================================
-- BPL SUPPLY — สถิติรถรอลงงาน เลือกช่วงวันจากปฏิทิน
-- รันต่อจาก 126 · ปลอดภัยที่จะรันซ้ำ
--
-- ของเดิมใน 126 รับเป็น "ย้อนหลังกี่วัน" ซึ่งบังคับให้หน้าจอเป็นดรอปดาวน์
-- 7 / 30 / 90 วัน · แต่ทุกหน้าในแอพที่ค้นตามวันใช้ปฏิทินเลือกช่วงหมดแล้ว
-- เหลือหน้านี้หน้าเดียวที่เป็นดรอปดาวน์ คือหน้าที่คนจะกดผิดที่สุด
-- เพราะมันไม่เหมือนที่อื่นโดยไม่มีเหตุผล
--
-- ลบของเดิมทิ้งก่อน ไม่ได้ปล่อยให้มีสองแบบ
-- ฟังก์ชันชื่อเดียวกันสองรูปแบบคือจุดที่ PostgREST เลือกผิดตัวเงียบ ๆ
--
-- ช่วงวันเป็นวันไทยและรวมปลายทั้งสองข้าง · เลือก 1-7 คือได้ทั้งวันที่ 7 ด้วย
-- ถ้าตัดที่เที่ยงคืนของวันที่ 7 รถทั้งวันสุดท้ายจะหายไปจากรายงานโดยไม่มีใครรู้
-- =====================================================================

drop function if exists wait_truck_stats(integer);

create or replace function wait_truck_stats(p_from date default null, p_to date default null)
returns jsonb
language sql stable security definer set search_path = public as $$
  with win as (
    select
      coalesce(p_from, (now() at time zone 'Asia/Bangkok')::date - 6)                  as d1,
      coalesce(p_to,   (now() at time zone 'Asia/Bangkok')::date)                      as d2
  ),
  base as (
    select
      t.vehicle_type,
      t.from_station,
      t.parcels,
      (t.arrived_at at time zone 'Asia/Bangkok')::date                                  as day_th,
      (t.done_at <= t.due_at)                                                           as on_time,
      round(extract(epoch from (t.done_at - t.arrived_at)) / 60)::int                   as wait_min,
      greatest(0, round(extract(epoch from (t.done_at - t.due_at)) / 60))::int          as over_min
    from wait_trucks t, win
    where t.done_at is not null
      and t.cancelled_at is null
      and (t.arrived_at at time zone 'Asia/Bangkok')::date between win.d1 and win.d2
  ),
  -- คันที่ถูกยกเลิกไม่เข้าสถิติทัน-ไม่ทัน แต่ต้องนับไว้ให้เห็น
  -- ไม่งั้นวันที่มีคนกดยกเลิกรัว ๆ รายงานจะสวยขึ้นโดยไม่มีอะไรฟ้อง
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
    'parcels',   (select coalesce(sum(parcels), 0) from base),
    'avg_wait',  (select coalesce(round(avg(wait_min)), 0)::int from base),
    'worst',     (select coalesce(max(over_min), 0) from base),

    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day', day_th, 'total', n, 'on_time', ok, 'avg_wait', avg_w) order by day_th)
        from (select day_th, count(*) as n, count(*) filter (where on_time) as ok,
                     coalesce(round(avg(wait_min)), 0)::int as avg_w
                from base group by day_th) q), '[]'::jsonb),

    'by_type', coalesce((
      select jsonb_agg(jsonb_build_object(
               'vehicle_type', vehicle_type, 'total', n, 'on_time', ok,
               'avg_wait', avg_w, 'worst', worst_m) order by n desc)
        from (select vehicle_type, count(*) as n, count(*) filter (where on_time) as ok,
                     coalesce(round(avg(wait_min)), 0)::int as avg_w,
                     coalesce(max(over_min), 0) as worst_m
                from base group by vehicle_type) q), '[]'::jsonb),

    'by_station', coalesce((
      select jsonb_agg(jsonb_build_object(
               'from_station', from_station, 'total', n, 'on_time', ok,
               'avg_wait', avg_w) order by n desc)
        from (select from_station, count(*) as n, count(*) filter (where on_time) as ok,
                     coalesce(round(avg(wait_min)), 0)::int as avg_w
                from base where from_station is not null
               group by from_station order by count(*) desc limit 20) q), '[]'::jsonb)
  )
  where my_can_wait_truck();
$$;

comment on function wait_truck_stats(date, date) is
  'สถิติรถรอลงงานตามช่วงวันไทย รวมปลายทั้งสองข้าง · นับเฉพาะคันที่จบแล้ว';

grant execute on function wait_truck_stats(date, date) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'wait_truck_stats' and n.nspname = 'public')  as เหลือแบบเดียว,
  (select pg_get_function_identity_arguments(p.oid)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'wait_truck_stats' and n.nspname = 'public')  as รับค่าอะไร,
  wait_truck_stats()                                                as ลองเรียกดู;
