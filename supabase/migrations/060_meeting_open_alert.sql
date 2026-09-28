-- =====================================================================
-- BPL SUPPLY — เด้งเตือนตอนหน้าต่างเช็คชื่อเปิด
-- รันต่อจาก 059 · ปลอดภัยที่จะรันซ้ำ
--
-- เดิมมีแจ้งเตือนรอบเดียวคือตอนประกาศนัด ซึ่งอาจเป็นเมื่อวาน
-- พอถึงวันจริงคนลืม ต้องมานั่งกดดูเองว่าเปิดให้เช็คชื่อหรือยัง
--
-- เพิ่มรอบที่สอง ยิงตอนหน้าต่างเปิดพอดี บอกว่าเช็คชื่อได้แล้ว
-- และบอกด้วยว่ามีเวลากี่นาทีก่อนจะถือว่าสาย
--
-- ข้อจำกัดที่ต้องรู้ไว้
--   นาฬิกาของระบบเดินทุก 5 นาที แจ้งเตือนจึงออกช้าได้ถึง 5 นาที
--   ถ้าตั้ง "เปิดก่อน 0 นาที" กับ "สายหลัง 0 นาที" พร้อมกัน
--   แจ้งเตือนอาจมาถึงตอนที่สายไปแล้ว ซึ่งไม่มีประโยชน์
--   จึงยิงเฉพาะตอนที่ยังมีเวลาเหลือให้เช็คจริง ๆ
-- =====================================================================

create or replace function push_meeting_open_jobs()
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'meeting_open',
      'subject', e.id::text,
      'user_id', m.id,
      'title',   'เช็คชื่อได้แล้ว · ' || e.title,
      'body',    case
                   when e.late_after_min = 0
                     then 'ต้องเช็คภายใน ' ||
                          to_char(e.meet_at at time zone 'Asia/Bangkok', 'HH24:MI') ||
                          ' พอดี เลยจากนั้นถือว่าสาย'
                   else 'เช็คได้ถึง ' ||
                        to_char((e.meet_at + (e.late_after_min || ' minutes')::interval)
                                at time zone 'Asia/Bangkok', 'HH24:MI') ||
                        ' หลังจากนั้นจะบันทึกว่าสาย'
                 end,
      'url',     '/'
    ))
    from meeting_events e
    cross join (select id from profiles where is_active) m
    where e.cancelled_at is null
      -- หน้าต่างเปิดแล้ว
      and now() >= e.meet_at - (e.open_before_min || ' minutes')::interval
      -- และยังไม่สาย — ส่งตอนสายไปแล้วไม่มีประโยชน์
      and now() <= e.meet_at + (e.late_after_min || ' minutes')::interval
      and not exists (
        select 1 from notification_log n
        where n.kind = 'meeting_open' and n.subject = e.id::text and n.user_id = m.id
      )
      -- คนที่เช็คไปแล้วไม่ต้องกวน
      and not exists (
        select 1 from meeting_checkins c
        where c.event_id = e.id and c.user_id = m.id
      )
  ), '[]'::jsonb);
end $$;

grant execute on function push_meeting_open_jobs() to authenticated, service_role;


create or replace function push_due_jobs()
returns jsonb
language sql security definer set search_path = public as $$
  select push_core_jobs()
      || push_meeting_jobs()
      || push_meeting_open_jobs()
      || push_announcement_jobs();
$$;

grant execute on function push_due_jobs() to authenticated, service_role;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname = 'push_meeting_open_jobs') as ฟังก์ชันเตือนเปิดเช็คชื่อ,
  jsonb_array_length(push_meeting_open_jobs())                            as งานรอส่งตอนนี้,
  jsonb_array_length(push_due_jobs())                                     as งานรวมทุกชนิด;
