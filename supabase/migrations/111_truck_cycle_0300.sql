-- =====================================================================
-- BPL SUPPLY — ตัวนับจอทีวีตัดรอบเองทุกวันตอนตีสาม
-- รันต่อจาก 110 · ปลอดภัยที่จะรันซ้ำ
--
-- รอบคือ 03:00 ของวันนี้ ถึง 03:00 ของวันพรุ่งนี้ ตามเวลาไทย
--
-- ไม่ได้ใช้งานตั้งเวลาให้ไปเขียนค่าใหม่ตอนตีสาม
-- เพราะงานตั้งเวลาที่ไม่ทำงานคืนหนึ่ง จะทำให้ตัวเลขผิดทั้งวันโดยไม่มีใครรู้
-- คำนวณสด ๆ จากเวลาปัจจุบันแทน ซึ่งถูกเสมอแม้เซิร์ฟเวอร์เพิ่งกลับมาจากล่ม
--
-- ปุ่มรีเซตที่หลังบ้านยังใช้ได้ สำหรับตัดรอบกลางวันเอง
-- จุดเริ่มนับจริงคือค่าที่มาทีหลังระหว่าง ตีสามรอบล่าสุด กับ ครั้งที่กดรีเซต
-- =====================================================================

create or replace function truck_cycle_start() returns timestamptz
language sql stable set search_path = public as $$
  select (
    date_trunc('day', (now() at time zone 'Asia/Bangkok'))
      + interval '3 hours'
      - case
          when (now() at time zone 'Asia/Bangkok')::time < time '03:00'
          then interval '1 day'
          else interval '0'
        end
  ) at time zone 'Asia/Bangkok';
$$;

comment on function truck_cycle_start() is
  'ตีสามของรอบปัจจุบันตามเวลาไทย · รอบคือ 03:00 ถึง 03:00 ของวันถัดไป';

grant execute on function truck_cycle_start() to authenticated;


create or replace function truck_counts()
returns jsonb
language sql stable security definer set search_path = public as $$
  with c as (
    select
      truck_cycle_start()                        as cycle_start,
      truck_cycle_start() + interval '1 day'     as cycle_end,
      greatest(
        truck_cycle_start(),
        coalesce((select count_since from truck_alert_settings where id), truck_cycle_start())
      )                                          as since
  )
  select jsonb_build_object(
    'in_hub',  (select count(*) from truck_runs where left_at is null),
    'late',    (select count(*) from truck_runs where left_at is null and now() > due_at),
    'soon',    (select count(*) from truck_runs
                 where left_at is null and now() <= due_at
                   and now() > due_at - interval '20 minutes'),
    'done',    (select count(*) from truck_runs r, c
                 where r.left_at is not null and r.left_at >= c.since),
    'on_time', (select count(*) from truck_runs r, c
                 where r.left_at is not null and r.left_at >= c.since and r.late_min = 0),
    'since',       (select since from c),
    'cycle_start', (select cycle_start from c),
    'cycle_end',   (select cycle_end from c)
  )
  from c
  where my_can_truck();
$$;

grant execute on function truck_counts() to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  to_char(truck_cycle_start() at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI')              as รอบนี้เริ่ม,
  to_char((truck_cycle_start() + interval '1 day') at time zone 'Asia/Bangkok',
          'DD/MM/YYYY HH24:MI')                                                               as รอบนี้จบ,
  to_char(now() at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI')                            as ตอนนี้,
  to_char((select count_since from truck_alert_settings where id) at time zone 'Asia/Bangkok',
          'DD/MM/YYYY HH24:MI')                                                               as กดรีเซตล่าสุด;
