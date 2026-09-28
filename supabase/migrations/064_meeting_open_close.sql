-- =====================================================================
-- BPL SUPPLY — เช็คชื่อได้เฉพาะตอนที่ประชุมเปิดอยู่จริง
-- รันต่อจาก 063 · ปลอดภัยที่จะรันซ้ำ
--
-- เดิมกล้องเปิดตลอดเวลา ใครจะถ่ายเซลฟี่ส่งเมื่อไหร่ก็ได้
-- แม้ไม่มีนัดประชุมอยู่เลย ซึ่งทำให้ใบเช็คอินลอย ๆ ไม่ผูกกับอะไร
--
-- ต่อจากนี้มีสี่ช่วง และกล้องเปิดแค่ช่วงเดียว
--   ไม่มีนัด   กล้องปิด — ไม่มีอะไรให้เช็คชื่อ
--   ยังไม่ถึง  กล้องปิด · นับถอยหลังให้ดู
--   เปิดอยู่   กล้องเปิด — ตั้งแต่ถึงเวลาจนกว่าจะมีคนกดปิดประชุม
--   ปิดแล้ว    กล้องปิด — สายแค่ไหนก็หมดสิทธิ์แล้ว
--
-- ทำไมต้องให้คนกดปิดเอง ไม่ปิดอัตโนมัติตามเวลา
--   ประชุมจริงเลิกไม่ตรงเวลาที่นัดไว้เสมอ ถ้าปิดเองตามนาฬิกา
--   คนที่เข้าประชุมอยู่จริงจะเช็คชื่อไม่ทันแล้วต้องมาตามแก้ทีหลังทุกครั้ง
--   ให้คนที่อยู่ในห้องเป็นคนตัดสินว่าจบแล้ว ตรงกับความจริงมากกว่า
--
-- หนักระบบไหม — ไม่
--   สถานะคิดจากแถวเดียวของนัดที่ใกล้ที่สุด ไม่ได้ไล่ทั้งตาราง
--   นับถอยหลังเดินในเครื่องผู้ใช้ เซิร์ฟเวอร์ถูกถามแค่ตอนเปิดแผ่น
--   กับตอนนับถอยหลังถึงศูนย์เท่านั้น
-- =====================================================================

alter table meeting_events
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references profiles (id);

comment on column meeting_events.closed_at is
  'ปิดประชุมแล้วเมื่อไหร่ · ว่าง = ยังเปิดอยู่ กล้องเช็คชื่อยังใช้ได้';


-- ---------------------------------------------------------------------
-- ปิด / เปิดประชุมใหม่
-- ---------------------------------------------------------------------
create or replace function close_meeting(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not my_can_audit() then
    raise exception 'เฉพาะผู้ตรวจสอบและแอดมินเท่านั้นที่ปิดประชุมได้';
  end if;

  update meeting_events
     set closed_at = now(), closed_by = auth.uid()
   where id = p_id and cancelled_at is null and closed_at is null;

  if not found then
    raise exception 'ไม่พบนัดนี้ หรือปิดไปแล้ว';
  end if;

  return jsonb_build_object('ok', true);
end $$;

grant execute on function close_meeting(uuid) to authenticated;


/** เผลอกดปิดเร็วไป เปิดใหม่ได้ — คนยังเช็คชื่อไม่ครบก็เกิดขึ้นได้ */
create or replace function reopen_meeting(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not my_can_audit() then
    raise exception 'เฉพาะผู้ตรวจสอบและแอดมินเท่านั้นที่เปิดประชุมใหม่ได้';
  end if;

  update meeting_events
     set closed_at = null, closed_by = null
   where id = p_id and cancelled_at is null;

  if not found then
    raise exception 'ไม่พบนัดนี้';
  end if;

  return jsonb_build_object('ok', true);
end $$;

grant execute on function reopen_meeting(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- นัดที่เกี่ยวข้องตอนนี้ พร้อมบอกว่ากล้องเปิดได้ไหม
--
-- ไม่มีแถวตอบกลับ = ไม่มีนัด = กล้องปิด หน้าจออ่านง่ายกว่าส่งค่าว่างมา
-- เลิกใช้เงื่อนไข "เลยเวลาสายแล้ว 6 ชั่วโมงให้หายไป" ของเดิม
-- เพราะตอนนี้ตัวตัดสินคือการกดปิด ไม่ใช่นาฬิกา
-- ---------------------------------------------------------------------
-- เปลี่ยนคอลัมน์ผลลัพธ์ ต้องทิ้งตัวเดิมก่อน Postgres ถึงยอม
-- ทั้งสคริปต์รันในธุรกรรมเดียว ระหว่างนี้จึงไม่มีช่วงที่แอพเรียกไม่ได้
drop function if exists meeting_now();

create or replace function meeting_now()
returns table (
  id            uuid,
  title         text,
  meet_at       timestamptz,
  place         text,
  audience      text,
  note          text,
  phase         text,      -- soon | open | late | closed
  opens_in_sec  integer,
  closes_in_sec integer,
  late_by_sec   integer,
  checked_in    boolean,
  can_shoot     boolean,
  closed_at     timestamptz
)
language sql stable security definer set search_path = public as $$
  with e as (
    select *
      from meeting_events
     where cancelled_at is null
       and meet_at > now() - interval '2 days'
       -- ปิดแล้วยังโชว์อีก 2 ชั่วโมง ให้คนที่เพิ่งพลาดรู้ว่าเกิดอะไรขึ้น
       and (closed_at is null or closed_at > now() - interval '2 hours')
     order by meet_at
     limit 1
  )
  select
    e.id, e.title, e.meet_at, e.place, e.audience, e.note,
    case
      when e.closed_at is not null then 'closed'
      when now() < e.meet_at - (e.open_before_min || ' minutes')::interval then 'soon'
      when now() <= e.meet_at + (e.late_after_min  || ' minutes')::interval then 'open'
      else 'late'
    end,
    greatest(ceil(extract(epoch from
      (e.meet_at - (e.open_before_min || ' minutes')::interval) - now()))::int, 0),
    greatest(ceil(extract(epoch from
      (e.meet_at + (e.late_after_min || ' minutes')::interval) - now()))::int, 0),
    greatest(floor(extract(epoch from
      now() - (e.meet_at + (e.late_after_min || ' minutes')::interval)))::int, 0),
    exists (
      select 1 from meeting_checkins c
       where c.event_id = e.id and c.user_id = auth.uid()
    ),
    -- กล้องเปิดเมื่อ: ถึงเวลาแล้ว และยังไม่ปิดประชุม
    (e.closed_at is null
     and now() >= e.meet_at - (e.open_before_min || ' minutes')::interval),
    e.closed_at
  from e;
$$;

grant execute on function meeting_now() to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'meeting_events' and column_name = 'closed_at') as คอลัมน์ปิดประชุม,
  (select count(*) from pg_proc where proname = 'close_meeting')       as ฟังก์ชันปิด,
  (select count(*) from pg_proc where proname = 'reopen_meeting')      as ฟังก์ชันเปิดใหม่,
  (select count(*) from meeting_events
    where cancelled_at is null and closed_at is null)                  as นัดที่ยังเปิดอยู่,
  (select count(*) from meeting_now())                                 as นัดที่โชว์ตอนนี้;
