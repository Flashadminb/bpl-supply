-- =====================================================================
-- BPL SUPPLY — ตัวนับรอบของจอทีวี
-- รันต่อจาก 103 · ปลอดภัยที่จะรันซ้ำ
--
-- จอทีวีต้องบอกว่า "ปล่อยไปแล้วกี่คัน" ซึ่งต้องมีจุดเริ่มนับ
-- ใช้ "ตั้งแต่เที่ยงคืน" ไม่ได้ เพราะงานรัน 24 ชั่วโมงและกะคาบเกี่ยวข้ามวัน
-- จึงให้หลังบ้านกดรีเซ็ตเองตอนเริ่มรอบ แล้วตัวเลขกลับไปเริ่มที่ศูนย์
--
-- เก็บไว้ในตารางตั้งค่าเดิมที่มีแถวเดียวอยู่แล้ว ไม่สร้างตารางใหม่ให้รก
-- =====================================================================

alter table truck_alert_settings
  add column if not exists count_since timestamptz not null default now();

comment on column truck_alert_settings.count_since is
  'จุดเริ่มนับของจอทีวี · กดรีเซ็ตที่หลังบ้านแล้วตัวเลขปล่อยแล้วกลับไปเริ่มที่ศูนย์';


create or replace function truck_count_reset()
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if my_role() <> 'admin' then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่รีเซ็ตตัวนับได้';
  end if;

  update truck_alert_settings set count_since = now(), updated_by = auth.uid() where id;
  return jsonb_build_object('ok', true, 'since', now());
end $$;

grant execute on function truck_count_reset() to authenticated;


-- ---------------------------------------------------------------------
-- ตัวเลขทั้งหมดที่จอทีวีต้องใช้ · เรียกครั้งเดียวจบ
--
-- จอนี้เปิดค้าง 24 ชั่วโมง ถ้าให้มันดึงสี่ชุดแยกกันก็คือสี่คำขอต่อรอบ
-- รวมเป็นชุดเดียวแล้วเหลือคำขอเดียว ซึ่งคูณด้วยจำนวนรอบทั้งวันแล้วต่างกันมาก
-- ---------------------------------------------------------------------
create or replace function truck_counts()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'in_hub',  (select count(*) from truck_runs where left_at is null),
    'late',    (select count(*) from truck_runs where left_at is null and now() > due_at),
    'soon',    (select count(*) from truck_runs
                 where left_at is null and now() <= due_at
                   and now() > due_at - interval '30 minutes'),
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
  (select count(*) from information_schema.columns
    where table_name = 'truck_alert_settings' and column_name = 'count_since') as มีช่องจุดเริ่มนับ,
  (select count(*) from pg_proc
    where proname in ('truck_count_reset', 'truck_counts'))                    as ฟังก์ชันที่เพิ่ม,
  truck_counts()                                                               as ตัวเลขตอนนี้;
