-- =====================================================================
-- BPL SUPPLY — "ใกล้หมดเวลา" ย้ายจาก 30 นาที มาเป็น 20 นาที
-- รันต่อจาก 106 · ปลอดภัยที่จะรันซ้ำ
--
-- หน้าจอเพิ่มเสียงเตือนสามขั้น 20 นาที 10 นาที และเลยกำหนด
-- ถ้าตัวนับฝั่งฐานข้อมูลยังนับที่ 30 นาที จอทีวีจะบอกว่าใกล้หมดเวลา 5 คัน
-- ในขณะที่ยังไม่มีเสียงดังสักคัน แล้วไม่มีใครรู้ว่าควรเชื่ออันไหน
--
-- ตัวเลขเดียวกันบนสองจอ ต้องมาจากนิยามเดียวกันเสมอ
-- =====================================================================

create or replace function truck_counts()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'in_hub',  (select count(*) from truck_runs where left_at is null),
    'late',    (select count(*) from truck_runs where left_at is null and now() > due_at),
    'soon',    (select count(*) from truck_runs
                 where left_at is null and now() <= due_at
                   and now() > due_at - interval '20 minutes'),
    'done',    (select count(*) from truck_runs r, truck_alert_settings s
                 where s.id and r.left_at is not null and r.left_at >= s.count_since),
    'on_time', (select count(*) from truck_runs r, truck_alert_settings s
                 where s.id and r.left_at is not null and r.left_at >= s.count_since
                   and r.late_min = 0),
    'since',   (select count_since from truck_alert_settings where id)
  )
  where my_can_truck();
$$;

grant execute on function truck_counts() to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc
    where proname = 'truck_counts' and prosrc like '%20 minutes%')  as ใช้ยี่สิบนาทีแล้ว,
  truck_counts()                                                    as ตัวเลขตอนนี้;
