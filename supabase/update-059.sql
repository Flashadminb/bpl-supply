-- =====================================================================
-- BPL SUPPLY — หน้าต่างเวลาเช็คชื่อประชุม และป้ายประกาศ
-- รันต่อจาก 058 · ปลอดภัยที่จะรันซ้ำ
--
-- ① หน้าต่างเวลาเช็คชื่อ
--    เดิมประกาศนัดแล้วเช็คอินได้ทันทีตลอดเวลา ไม่มีคำว่าสาย
--    ตอนนี้แบ่งเป็นสามช่วง เปิดก่อนกี่นาที และสายหลังกี่นาที
--
--    เวลาทั้งหมดคิดจากนาฬิกาของฐานข้อมูล ไม่ใช่นาฬิกาในมือถือ
--    ถ้าเชื่อเครื่องผู้ใช้ ใครหมุนเวลาถอยหลังก็เช็คอินไม่สายได้ตลอด
--    หน้าจอจึงได้รับ "เหลืออีกกี่วินาที" มาจากเซิร์ฟเวอร์แล้วนับถอยหลังเอง
--
-- ② ป้ายประกาศ
--    ที่เดียวกันกับที่คนเปิดมาเช็คอิน จึงเป็นที่ที่คนมองอยู่แล้ว
--    บังคับวันหมดอายุเสมอ เพราะป้ายที่ค้างสิบอันคือป้ายที่ไม่มีใครอ่าน
--
-- กระทบของที่ใช้อยู่ไหม — ไม่
--    คอลัมน์ใหม่มีค่าตั้งต้น นัดเก่าที่ยังไม่ถึงเวลาจึงได้กติกาเดียวกันอัตโนมัติ
--    ตารางประกาศเป็นของใหม่ทั้งตาราง ไม่มีอะไรเดิมพึ่งพามัน
-- =====================================================================

-- ---------------------------------------------------------------------
-- ① กติกาเวลาของการประชุม
-- ---------------------------------------------------------------------
alter table meeting_events
  add column if not exists open_before_min integer not null default 15,
  add column if not exists late_after_min  integer not null default 10;

alter table meeting_events drop constraint if exists meeting_events_window_chk;
alter table meeting_events add constraint meeting_events_window_chk
  check (open_before_min between 0 and 240 and late_after_min between 0 and 240);

comment on column meeting_events.open_before_min is
  'เปิดให้เช็คชื่อก่อนเวลานัดกี่นาที';
comment on column meeting_events.late_after_min is
  'เลยเวลานัดเกินกี่นาทีถือว่าสาย';

-- ค่าตั้งต้นกลาง ใช้ตอนสร้างนัดใหม่ ปรับรายนัดทีหลังได้
insert into app_settings (key, value) values
  ('meeting_open_before_min', '15'::jsonb),
  ('meeting_late_after_min',  '10'::jsonb)
on conflict (key) do nothing;

-- เช็คอินผูกกับนัด และจำไว้ว่าสายไหม
alter table meeting_checkins
  add column if not exists event_id uuid references meeting_events (id) on delete set null,
  add column if not exists is_late  boolean not null default false,
  add column if not exists late_min integer;

create index if not exists meeting_checkins_event_idx on meeting_checkins (event_id);


-- ---------------------------------------------------------------------
-- นัดที่กำลังเปิดให้เช็คชื่อ พร้อมตัวเลขนับถอยหลัง
--
-- คืนค่าเป็น "อีกกี่วินาที" ไม่ใช่เวลาเป้าหมาย
-- เพราะถ้าส่งเวลาเป้าหมายไป หน้าจอจะเอาไปลบกับนาฬิกาเครื่องตัวเอง
-- ซึ่งเป็นสิ่งที่เราตั้งใจไม่เชื่อตั้งแต่แรก
-- ---------------------------------------------------------------------
create or replace function meeting_now()
returns table (
  id            uuid,
  title         text,
  meet_at       timestamptz,
  place         text,
  audience      text,
  note          text,
  phase         text,      -- soon | open | late
  opens_in_sec  integer,   -- > 0 = ยังไม่ถึงเวลาเปิด
  closes_in_sec integer,   -- > 0 = เหลือเวลาก่อนถือว่าสาย
  late_by_sec   integer,   -- > 0 = เลยมาแล้วกี่วินาที
  checked_in    boolean
)
language sql stable security definer set search_path = public as $$
  with e as (
    select *
      from meeting_events
     where cancelled_at is null
       and now() < meet_at + (late_after_min || ' minutes')::interval + interval '6 hours'
       and now() > meet_at - interval '1 day'
     order by meet_at
     limit 1
  )
  select
    e.id, e.title, e.meet_at, e.place, e.audience, e.note,
    case
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
    )
  from e;
$$;

grant execute on function meeting_now() to authenticated;


-- ---------------------------------------------------------------------
-- เช็คอิน — ผูกกับนัดและตัดสินว่าสายไหมที่ฝั่งนี้
--
-- ห้ามให้หน้าจอส่งคำว่า "สาย" มาเอง ต้องคำนวณจากนาฬิกาฐานข้อมูลเท่านั้น
-- ไม่งั้นแก้ค่าใน DevTools แล้วไม่สายได้ทุกครั้ง
-- ---------------------------------------------------------------------
create or replace function meeting_checkin(
  p_file_id  text,
  p_web_link text default null,
  p_bytes    integer default null,
  p_note     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me    profiles%rowtype;
  v_dup   meeting_checkins%rowtype;
  v_ref   text;
  v_id    uuid;
  v_ev    meeting_events%rowtype;
  v_late  boolean := false;
  v_lmin  integer := null;
begin
  select * into v_me from profiles where id = auth.uid();
  if v_me.id is null or not v_me.is_active then
    raise exception 'บัญชีนี้ใช้งานไม่ได้';
  end if;

  if p_file_id is null or btrim(p_file_id) = '' then
    raise exception 'ต้องมีรูปเซลฟี่ก่อนถึงจะเช็คอินได้';
  end if;

  -- หานัดที่ใกล้ที่สุดที่ยังอยู่ในกรอบเวลา
  select * into v_ev
    from meeting_events
   where cancelled_at is null
     and now() >= meet_at - (open_before_min || ' minutes')::interval
     and now() <  meet_at + (late_after_min  || ' minutes')::interval + interval '6 hours'
   order by meet_at
   limit 1;

  -- มีนัดอยู่ แต่ยังไม่ถึงเวลาเปิด = ห้ามเช็คอิน
  if v_ev.id is null then
    if exists (
      select 1 from meeting_events
       where cancelled_at is null
         and now() < meet_at - (open_before_min || ' minutes')::interval
         and meet_at < now() + interval '1 day'
    ) then
      raise exception 'ยังไม่ถึงเวลาเช็คชื่อ รอให้ถึงเวลาที่ประกาศไว้ก่อน';
    end if;
  else
    if now() > v_ev.meet_at + (v_ev.late_after_min || ' minutes')::interval then
      v_late := true;
      v_lmin := floor(extract(epoch from
        now() - (v_ev.meet_at + (v_ev.late_after_min || ' minutes')::interval)) / 60)::int;
    end if;
  end if;

  select * into v_dup
    from meeting_checkins
   where user_id = v_me.id
     and created_at > now() - interval '10 minutes'
   order by created_at desc
   limit 1;

  if v_dup.id is not null then
    return jsonb_build_object(
      'id', v_dup.id, 'ref_no', v_dup.ref_no,
      'created_at', v_dup.created_at, 'duplicate', true,
      'is_late', v_dup.is_late, 'late_min', v_dup.late_min
    );
  end if;

  v_ref := next_meeting_ref();
  insert into meeting_checkins (ref_no, user_id, hub_code, dept_code, sub_dept,
                                shift_start, shift_end, note, file_id, web_link, bytes,
                                event_id, is_late, late_min)
  values (v_ref, v_me.id, coalesce(v_me.hub_code, 'BPL'), v_me.dept_code, v_me.sub_dept,
          v_me.shift_start, v_me.shift_end, nullif(btrim(p_note), ''),
          p_file_id, p_web_link, p_bytes,
          v_ev.id, v_late, v_lmin)
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id, 'ref_no', v_ref, 'created_at', now(), 'duplicate', false,
    'is_late', v_late, 'late_min', v_lmin
  );
end $$;

grant execute on function meeting_checkin(text, text, integer, text) to authenticated;


-- ---------------------------------------------------------------------
-- สร้างนัด — รับกติกาเวลาเข้ามาด้วย
-- ---------------------------------------------------------------------
drop function if exists create_meeting_event(text, timestamptz, text, text, text);

create or replace function create_meeting_event(
  p_title       text,
  p_meet_at     timestamptz,
  p_audience    text default null,
  p_place       text default null,
  p_note        text default null,
  p_open_before integer default null,
  p_late_after  integer default null
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_id   uuid;
  v_open integer;
  v_late integer;
begin
  if not my_can_audit() then
    raise exception 'บัญชีนี้นัดประชุมไม่ได้';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'ต้องใส่เรื่องที่จะประชุม';
  end if;
  if p_meet_at is null then
    raise exception 'ต้องเลือกวันและเวลา';
  end if;

  v_open := coalesce(p_open_before,
    (select (value)::int from app_settings where key = 'meeting_open_before_min'), 15);
  v_late := coalesce(p_late_after,
    (select (value)::int from app_settings where key = 'meeting_late_after_min'), 10);

  insert into meeting_events (title, meet_at, audience, place, note, created_by,
                              open_before_min, late_after_min)
  values (btrim(p_title), p_meet_at, nullif(btrim(p_audience), ''),
          nullif(btrim(p_place), ''), nullif(btrim(p_note), ''), auth.uid(),
          v_open, v_late)
  returning id into v_id;

  begin
    perform push_tick();
  exception when others then
    raise notice 'ประกาศแล้วแต่เตะแจ้งเตือนไม่สำเร็จ (%) เดี๋ยวรอบถัดไปจะส่งให้เอง', sqlerrm;
  end;

  return jsonb_build_object('id', v_id);
end $fn$;

grant execute on function
  create_meeting_event(text, timestamptz, text, text, text, integer, integer)
  to authenticated;


-- =====================================================================
-- ② ป้ายประกาศ
-- =====================================================================
create table if not exists announcements (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text,
  level      text not null default 'info',
  /** หมดอายุแล้วหายจากหน้าแอพเอง ไม่ต้องมีใครมาตามลบ */
  expires_at timestamptz not null,
  notify     boolean not null default true,
  created_by uuid not null references profiles (id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);

alter table announcements drop constraint if exists announcements_level_chk;
alter table announcements add constraint announcements_level_chk
  check (level in ('urgent', 'warn', 'info'));

create index if not exists announcements_live_idx
  on announcements (expires_at desc) where cancelled_at is null;

alter table announcements enable row level security;

-- ทุกคนอ่านได้เฉพาะที่ยังไม่หมดอายุ ส่วนคนคุมเห็นหมดรวมที่หมดแล้ว
drop policy if exists read_announcements on announcements;
create policy read_announcements on announcements for select to authenticated
  using (my_can_audit() or (cancelled_at is null and expires_at > now()));

-- เขียนได้: เจ้าของระบบ แอดมิน ผู้ตรวจสอบ
drop policy if exists write_announcements on announcements;
create policy write_announcements on announcements for all to authenticated
  using (my_can_audit()) with check (my_can_audit());


-- ---------------------------------------------------------------------
-- ประกาศแล้วแจ้งเตือนออกทันที ไม่ต้องรอรอบนาฬิกา
-- ---------------------------------------------------------------------
create or replace function create_announcement(
  p_title   text,
  p_body    text default null,
  p_level   text default 'info',
  p_days    integer default 3,
  p_notify  boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not my_can_audit() then
    raise exception 'บัญชีนี้ประกาศไม่ได้';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'ต้องใส่หัวข้อประกาศ';
  end if;
  if p_level not in ('urgent', 'warn', 'info') then
    raise exception 'ระดับความสำคัญไม่ถูกต้อง';
  end if;

  insert into announcements (title, body, level, expires_at, notify, created_by)
  values (btrim(p_title), nullif(btrim(coalesce(p_body, '')), ''), p_level,
          now() + (greatest(coalesce(p_days, 3), 1) || ' days')::interval,
          coalesce(p_notify, true), auth.uid())
  returning id into v_id;

  if coalesce(p_notify, true) then
    begin
      perform push_tick();
    exception when others then
      raise notice 'ประกาศแล้วแต่เตะแจ้งเตือนไม่สำเร็จ (%)', sqlerrm;
    end;
  end if;

  return jsonb_build_object('id', v_id);
end $$;

grant execute on function create_announcement(text, text, text, integer, boolean) to authenticated;


-- ---------------------------------------------------------------------
-- งานแจ้งเตือนของประกาศ — ต่อท้ายของประชุมที่มีอยู่แล้ว
--
-- ยิงรอบเดียวต่อคนต่อประกาศ เหมือนที่นัดประชุมทำ
-- คนประกาศได้รับด้วย เพราะเจ้าของระบบขอให้เตือนตัวเองด้วย
-- ---------------------------------------------------------------------
create or replace function push_announcement_jobs()
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'announce_new',
      'subject', a.id::text,
      'user_id', m.id,
      'title',   case a.level when 'urgent' then 'ด่วน · ' when 'warn' then 'แจ้งเตือน · '
                              else 'ประกาศ · ' end || a.title,
      'body',    coalesce(a.body, 'เปิดแอพเพื่อดูรายละเอียด'),
      'url',     '/'
    ))
    from announcements a
    cross join (select id from profiles where is_active) m
    where a.cancelled_at is null
      and a.notify
      and a.expires_at > now()
      and a.created_at > now() - interval '1 day'
      and not exists (
        select 1 from notification_log n
        where n.kind = 'announce_new' and n.subject = a.id::text and n.user_id = m.id
      )
  ), '[]'::jsonb);
end $$;

grant execute on function push_announcement_jobs() to authenticated, service_role;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'meeting_events' and column_name = 'open_before_min')  as กติกาเวลา,
  (select count(*) from information_schema.columns
    where table_name = 'meeting_checkins' and column_name = 'is_late')        as ช่องบันทึกสาย,
  (select count(*) from information_schema.tables
    where table_name = 'announcements')                                       as ตารางประกาศ,
  (select count(*) from pg_proc where proname = 'meeting_now')                as ฟังก์ชันนับถอยหลัง,
  (select count(*) from pg_proc where proname = 'create_meeting_event')       as ฟังก์ชันนัดประชุม,
  (select count(*) from meeting_events where cancelled_at is null)            as นัดที่ยังอยู่;


-- ---------------------------------------------------------------------
-- ต่อประกาศเข้ากับคิวแจ้งเตือนเดิม
--
-- ต้องมาหลังจากประกาศฟังก์ชันงานประกาศแล้ว ไม่งั้นตัวห่อจะอ้างถึงของที่ยังไม่มี
-- ---------------------------------------------------------------------
create or replace function push_due_jobs()
returns jsonb
language sql security definer set search_path = public as $$
  select push_core_jobs() || push_meeting_jobs() || push_announcement_jobs();
$$;

grant execute on function push_due_jobs() to authenticated, service_role;

select 'คิวแจ้งเตือนรวมประกาศแล้ว' as ผลตรวจ,
       jsonb_array_length(push_due_jobs())::text as งานที่รออยู่ตอนนี้;
