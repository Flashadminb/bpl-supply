-- =====================================================================
-- BPL SUPPLY — สถานะการเข้าประชุม และการกำหนดผู้เข้าร่วม
-- รันต่อจาก 060 · ปลอดภัยที่จะรันซ้ำ
--
-- ① ใครต้องเข้าประชุม — สามแบบ
--      all    ทุกคนที่เปิดใช้งานในระบบ
--      picked เลือกเป็นแผนกและ/หรือรายคน
--      free   พิมพ์เอาเอง (ของเดิม) — ไม่มีรายชื่อจึงนับขาดไม่ได้
--    ค่าตั้งต้นของแถวเดิมคือ free พฤติกรรมของนัดเก่าจึงไม่เปลี่ยน
--
-- ② สถานะรายคน — คิดสดทุกครั้ง ไม่เก็บค่าตายตัว
--      ontime  เช็คทันเวลา
--      late    เช็คหลังหมดเวลาผ่อนผัน
--      absent  ยังไม่เช็คและเลยเวลาผ่อนผันแล้ว
--      excused ผู้ตรวจสอบแก้ให้ถือว่ามา
--
--    ทำไมคิดสดไม่เก็บค่า — คนที่ขึ้นแดงยังเดินมาสแกนทีหลังได้
--    ถ้าเก็บเป็นค่าตายตัวจะต้องมีใครสักคนคอยไล่อัปเดตทั้งฮับทุกนาที
--    ซึ่งพลาดเมื่อไหร่ก็ค้างแดงทั้งที่เขามาแล้ว
--
-- ③ การแก้ของผู้ตรวจสอบ
--    เก็บแยกตาราง ไม่ทับของจริง ค่าที่ระบบคำนวณไว้ยังอยู่ครบ
--    บังคับใส่เหตุผล — ถ้าแก้ได้เปล่า ๆ สถิติจะเชื่อไม่ได้เลย
--    และคนที่โดนแก้ต้องรู้ว่าทำไมตัวเองได้ผ่อนผันแต่เพื่อนไม่ได้
--
-- ④ ประกาศก็ล็อกผู้รับได้ ใช้กติกาเดียวกับนัดประชุม
-- =====================================================================

-- ---------------------------------------------------------------------
-- ① ผู้เข้าร่วม
-- ---------------------------------------------------------------------
alter table meeting_events
  add column if not exists audience_mode text not null default 'free';

alter table meeting_events drop constraint if exists meeting_events_mode_chk;
alter table meeting_events add constraint meeting_events_mode_chk
  check (audience_mode in ('all', 'picked', 'free'));

create table if not exists meeting_event_depts (
  event_id  uuid not null references meeting_events (id) on delete cascade,
  dept_code text not null references departments (code) on update cascade on delete cascade,
  primary key (event_id, dept_code)
);

create table if not exists meeting_event_users (
  event_id uuid not null references meeting_events (id) on delete cascade,
  user_id  uuid not null references profiles (id) on delete cascade,
  primary key (event_id, user_id)
);

create index if not exists meeting_event_users_user_idx on meeting_event_users (user_id);

alter table meeting_event_depts enable row level security;
alter table meeting_event_users enable row level security;

-- ทุกคนอ่านได้ เพราะแอพต้องรู้ว่าตัวเองต้องเข้านัดไหน
drop policy if exists read_meeting_event_depts on meeting_event_depts;
create policy read_meeting_event_depts on meeting_event_depts for select to authenticated using (true);
drop policy if exists write_meeting_event_depts on meeting_event_depts;
create policy write_meeting_event_depts on meeting_event_depts for all to authenticated
  using (my_can_audit()) with check (my_can_audit());

drop policy if exists read_meeting_event_users on meeting_event_users;
create policy read_meeting_event_users on meeting_event_users for select to authenticated using (true);
drop policy if exists write_meeting_event_users on meeting_event_users;
create policy write_meeting_event_users on meeting_event_users for all to authenticated
  using (my_can_audit()) with check (my_can_audit());


-- ---------------------------------------------------------------------
-- ③ การแก้สถานะโดยผู้ตรวจสอบ
-- ---------------------------------------------------------------------
create table if not exists meeting_overrides (
  event_id uuid not null references meeting_events (id) on delete cascade,
  user_id  uuid not null references profiles (id) on delete cascade,
  state    text not null,
  reason   text not null,
  by_user  uuid not null references profiles (id),
  at       timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table meeting_overrides drop constraint if exists meeting_overrides_state_chk;
alter table meeting_overrides add constraint meeting_overrides_state_chk
  check (state in ('ontime', 'late', 'excused', 'absent'));

alter table meeting_overrides enable row level security;

-- เจ้าตัวเห็นของตัวเอง คนคุมเห็นหมด
drop policy if exists read_meeting_overrides on meeting_overrides;
create policy read_meeting_overrides on meeting_overrides for select to authenticated
  using (my_can_audit() or user_id = auth.uid());

drop policy if exists write_meeting_overrides on meeting_overrides;
create policy write_meeting_overrides on meeting_overrides for all to authenticated
  using (my_can_audit()) with check (my_can_audit());


-- ---------------------------------------------------------------------
-- ใครต้องเข้านัดนี้บ้าง
-- ---------------------------------------------------------------------
create or replace function meeting_expected(p_event uuid)
returns table (user_id uuid)
language sql stable security definer set search_path = public as $$
  with e as (select * from meeting_events where id = p_event)
  select p.id
    from profiles p, e
   where p.is_active
     and (
       e.audience_mode = 'all'
       or (e.audience_mode = 'picked' and (
            exists (select 1 from meeting_event_users u
                     where u.event_id = e.id and u.user_id = p.id)
         or exists (select 1 from meeting_event_depts d
                     where d.event_id = e.id
                       and (d.dept_code = 'ALL'
                            or d.dept_code = p.dept_code
                            or d.dept_code = any(coalesce(p.extra_depts, '{}'))))
       ))
     );
$$;

grant execute on function meeting_expected(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- รายชื่อพร้อมสถานะ — คิดสดทุกครั้งที่เรียก
-- ---------------------------------------------------------------------
create or replace function meeting_roster(p_event uuid)
returns table (
  user_id       uuid,
  full_name     text,
  employee_code text,
  dept_code     text,
  checked_at    timestamptz,
  ref_no        text,
  raw_state     text,
  state         text,
  late_min      integer,
  reason        text,
  by_name       text,
  changed_at    timestamptz
)
language sql stable security definer set search_path = public as $$
  with e as (select * from meeting_events where id = p_event),
  base as (
    select p.id, p.full_name, p.employee_code, p.dept_code,
           c.created_at as checked_at, c.ref_no, c.is_late, c.late_min
      from meeting_expected(p_event) x
      join profiles p on p.id = x.user_id
      left join meeting_checkins c on c.event_id = p_event and c.user_id = p.id
  )
  select
    b.id, b.full_name, b.employee_code, b.dept_code,
    b.checked_at, b.ref_no,
    -- สถานะที่ระบบคำนวณ เก็บไว้ให้เห็นแม้จะถูกแก้แล้ว
    case
      when b.checked_at is not null and b.is_late then 'late'
      when b.checked_at is not null                then 'ontime'
      when now() > (select meet_at + (late_after_min || ' minutes')::interval from e)
                                                   then 'absent'
      else 'waiting'
    end,
    -- สถานะที่ใช้จริง — ของผู้ตรวจสอบชนะเสมอ
    coalesce(o.state, case
      when b.checked_at is not null and b.is_late then 'late'
      when b.checked_at is not null                then 'ontime'
      when now() > (select meet_at + (late_after_min || ' minutes')::interval from e)
                                                   then 'absent'
      else 'waiting'
    end),
    b.late_min,
    o.reason,
    bp.full_name,
    o.at
  from base b
  left join meeting_overrides o on o.event_id = p_event and o.user_id = b.id
  left join profiles bp on bp.id = o.by_user
  order by
    case coalesce(o.state, case
      when b.checked_at is not null and b.is_late then 'late'
      when b.checked_at is not null                then 'ontime'
      else 'absent' end)
      when 'absent' then 0 when 'late' then 1 when 'excused' then 2 else 3 end,
    b.full_name;
$$;

grant execute on function meeting_roster(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- ผู้ตรวจสอบแก้สถานะ — บังคับใส่เหตุผล
-- ---------------------------------------------------------------------
create or replace function set_meeting_attendance(
  p_event  uuid,
  p_user   uuid,
  p_state  text,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not my_can_audit() then
    raise exception 'เฉพาะผู้ตรวจสอบและแอดมินเท่านั้นที่แก้สถานะได้';
  end if;
  if p_state not in ('ontime', 'late', 'excused', 'absent') then
    raise exception 'สถานะไม่ถูกต้อง';
  end if;
  -- เหตุผลคือสิ่งเดียวที่ทำให้การแก้ตรวจสอบย้อนหลังได้ จึงบังคับ
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'ต้องใส่เหตุผลกำกับทุกครั้งที่แก้สถานะ';
  end if;

  insert into meeting_overrides (event_id, user_id, state, reason, by_user, at)
  values (p_event, p_user, p_state, btrim(p_reason), auth.uid(), now())
  on conflict (event_id, user_id) do update
    set state = excluded.state, reason = excluded.reason,
        by_user = excluded.by_user, at = excluded.at;

  return jsonb_build_object('ok', true);
end $$;

grant execute on function set_meeting_attendance(uuid, uuid, text, text) to authenticated;


/** ถอนการแก้ กลับไปใช้ค่าที่ระบบคำนวณ */
create or replace function clear_meeting_attendance(p_event uuid, p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not my_can_audit() then
    raise exception 'เฉพาะผู้ตรวจสอบและแอดมินเท่านั้นที่แก้สถานะได้';
  end if;
  delete from meeting_overrides where event_id = p_event and user_id = p_user;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function clear_meeting_attendance(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- สรุปตัวเลขของนัดหนึ่ง ๆ
-- ---------------------------------------------------------------------
create or replace function meeting_summary(p_event uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'expected', count(*),
    'ontime',   count(*) filter (where state = 'ontime'),
    'late',     count(*) filter (where state = 'late'),
    'absent',   count(*) filter (where state = 'absent'),
    'excused',  count(*) filter (where state = 'excused'),
    'waiting',  count(*) filter (where state = 'waiting')
  )
  from meeting_roster(p_event);
$$;

grant execute on function meeting_summary(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- สถานะของตัวเองในนัดที่กำลังเปิด — ให้หน้างานเห็นในแอพ
-- ---------------------------------------------------------------------
create or replace function my_meeting_state(p_event uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object(
       'state', r.state, 'raw_state', r.raw_state, 'late_min', r.late_min,
       'reason', r.reason, 'by_name', r.by_name, 'checked_at', r.checked_at)
       from meeting_roster(p_event) r where r.user_id = auth.uid()),
    jsonb_build_object('state', 'notlisted')
  );
$$;

grant execute on function my_meeting_state(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- สร้างนัด — รับโหมดผู้เข้าร่วมและรายชื่อ
-- ---------------------------------------------------------------------
drop function if exists create_meeting_event(text, timestamptz, text, text, text, integer, integer);

create or replace function create_meeting_event(
  p_title       text,
  p_meet_at     timestamptz,
  p_audience    text default null,
  p_place       text default null,
  p_note        text default null,
  p_open_before integer default null,
  p_late_after  integer default null,
  p_mode        text default 'free',
  p_depts       text[] default '{}',
  p_users       uuid[] default '{}'
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
  if p_mode not in ('all', 'picked', 'free') then
    raise exception 'โหมดผู้เข้าร่วมไม่ถูกต้อง';
  end if;
  if p_mode = 'picked'
     and coalesce(array_length(p_depts, 1), 0) = 0
     and coalesce(array_length(p_users, 1), 0) = 0 then
    raise exception 'เลือกเจาะจงต้องเลือกอย่างน้อยหนึ่งแผนกหรือหนึ่งคน';
  end if;

  v_open := coalesce(p_open_before,
    (select (value)::int from app_settings where key = 'meeting_open_before_min'), 15);
  v_late := coalesce(p_late_after,
    (select (value)::int from app_settings where key = 'meeting_late_after_min'), 10);

  insert into meeting_events (title, meet_at, audience, place, note, created_by,
                              open_before_min, late_after_min, audience_mode)
  values (btrim(p_title), p_meet_at, nullif(btrim(p_audience), ''),
          nullif(btrim(p_place), ''), nullif(btrim(p_note), ''), auth.uid(),
          v_open, v_late, p_mode)
  returning id into v_id;

  if p_mode = 'picked' then
    insert into meeting_event_depts (event_id, dept_code)
    select v_id, d from unnest(coalesce(p_depts, '{}')) as d
     where exists (select 1 from departments x where x.code = d)
    on conflict do nothing;

    insert into meeting_event_users (event_id, user_id)
    select v_id, u from unnest(coalesce(p_users, '{}')) as u
     where exists (select 1 from profiles x where x.id = u)
    on conflict do nothing;
  end if;

  begin
    perform push_tick();
  exception when others then
    raise notice 'ประกาศแล้วแต่เตะแจ้งเตือนไม่สำเร็จ (%)', sqlerrm;
  end;

  return jsonb_build_object('id', v_id);
end $fn$;

grant execute on function
  create_meeting_event(text, timestamptz, text, text, text, integer, integer, text, text[], uuid[])
  to authenticated;


-- ---------------------------------------------------------------------
-- แจ้งเตือนเฉพาะคนที่ต้องเข้า ไม่กวนคนที่ไม่เกี่ยว
-- ---------------------------------------------------------------------
create or replace function push_meeting_jobs()
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'meeting_new',
      'subject', e.id::text,
      'user_id', m.user_id,
      'title',   'นัดประชุม · ' || e.title,
      'body',    to_char((e.meet_at at time zone 'Asia/Bangkok'), 'DD/MM HH24:MI') ||
                 coalesce(' · ' || e.place, '') ||
                 coalesce(' · ผู้เข้าร่วม: ' || e.audience, ''),
      'url',     '/'
    ))
    from meeting_events e
    cross join lateral (
      -- โหมด free ไม่มีรายชื่อ จึงส่งหาทุกคนเหมือนเดิม
      select case when e.audience_mode = 'free' then p.id else x.user_id end as user_id
        from profiles p
        left join lateral (select * from meeting_expected(e.id)) x on x.user_id = p.id
       where p.is_active
         and (e.audience_mode = 'free' or x.user_id is not null)
    ) m
    where e.cancelled_at is null
      and e.created_at > now() - interval '1 day'
      and e.meet_at > now()
      and not exists (
        select 1 from notification_log n
        where n.kind = 'meeting_new' and n.subject = e.id::text and n.user_id = m.user_id
      )
  ), '[]'::jsonb);
end $$;

grant execute on function push_meeting_jobs() to authenticated, service_role;


-- ---------------------------------------------------------------------
-- ④ ประกาศล็อกผู้รับได้
-- ---------------------------------------------------------------------
alter table announcements
  add column if not exists audience_mode text not null default 'all';

alter table announcements drop constraint if exists announcements_mode_chk;
alter table announcements add constraint announcements_mode_chk
  check (audience_mode in ('all', 'picked'));

create table if not exists announcement_depts (
  ann_id    uuid not null references announcements (id) on delete cascade,
  dept_code text not null references departments (code) on update cascade on delete cascade,
  primary key (ann_id, dept_code)
);

create table if not exists announcement_users (
  ann_id  uuid not null references announcements (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  primary key (ann_id, user_id)
);

alter table announcement_depts enable row level security;
alter table announcement_users enable row level security;

drop policy if exists read_announcement_depts on announcement_depts;
create policy read_announcement_depts on announcement_depts for select to authenticated using (true);
drop policy if exists write_announcement_depts on announcement_depts;
create policy write_announcement_depts on announcement_depts for all to authenticated
  using (my_can_audit()) with check (my_can_audit());

drop policy if exists read_announcement_users on announcement_users;
create policy read_announcement_users on announcement_users for select to authenticated using (true);
drop policy if exists write_announcement_users on announcement_users;
create policy write_announcement_users on announcement_users for all to authenticated
  using (my_can_audit()) with check (my_can_audit());


/** ประกาศนี้ถึงฉันไหม — security definer เพราะถูกเรียกจาก policy */
create or replace function my_sees_announcement(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from announcement_users u where u.ann_id = p_id and u.user_id = auth.uid()
  ) or exists (
    select 1 from announcement_depts d
     where d.ann_id = p_id
       and (d.dept_code = 'ALL'
            or 'ALL' = any(my_depts())
            or d.dept_code = any(my_depts()))
  );
$$;

grant execute on function my_sees_announcement(uuid) to authenticated;

drop policy if exists read_announcements on announcements;
create policy read_announcements on announcements for select to authenticated
  using (
    my_can_audit()
    or (
      cancelled_at is null and expires_at > now()
      and (audience_mode = 'all' or my_sees_announcement(id))
    )
  );


drop function if exists create_announcement(text, text, text, integer, boolean);

create or replace function create_announcement(
  p_title   text,
  p_body    text default null,
  p_level   text default 'info',
  p_days    integer default 3,
  p_notify  boolean default true,
  p_mode    text default 'all',
  p_depts   text[] default '{}',
  p_users   uuid[] default '{}'
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
  if p_mode not in ('all', 'picked') then
    raise exception 'โหมดผู้รับไม่ถูกต้อง';
  end if;
  if p_mode = 'picked'
     and coalesce(array_length(p_depts, 1), 0) = 0
     and coalesce(array_length(p_users, 1), 0) = 0 then
    raise exception 'เลือกเจาะจงต้องเลือกอย่างน้อยหนึ่งแผนกหรือหนึ่งคน';
  end if;

  insert into announcements (title, body, level, expires_at, notify, created_by, audience_mode)
  values (btrim(p_title), nullif(btrim(coalesce(p_body, '')), ''), p_level,
          now() + (greatest(coalesce(p_days, 3), 1) || ' days')::interval,
          coalesce(p_notify, true), auth.uid(), p_mode)
  returning id into v_id;

  if p_mode = 'picked' then
    insert into announcement_depts (ann_id, dept_code)
    select v_id, d from unnest(coalesce(p_depts, '{}')) as d
     where exists (select 1 from departments x where x.code = d)
    on conflict do nothing;

    insert into announcement_users (ann_id, user_id)
    select v_id, u from unnest(coalesce(p_users, '{}')) as u
     where exists (select 1 from profiles x where x.id = u)
    on conflict do nothing;
  end if;

  if coalesce(p_notify, true) then
    begin
      perform push_tick();
    exception when others then
      raise notice 'ประกาศแล้วแต่เตะแจ้งเตือนไม่สำเร็จ (%)', sqlerrm;
    end;
  end if;

  return jsonb_build_object('id', v_id);
end $$;

grant execute on function
  create_announcement(text, text, text, integer, boolean, text, text[], uuid[])
  to authenticated;


create or replace function push_announcement_jobs()
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'announce_new',
      'subject', a.id::text,
      'user_id', p.id,
      'title',   case a.level when 'urgent' then 'ด่วน · ' when 'warn' then 'แจ้งเตือน · '
                              else 'ประกาศ · ' end || a.title,
      'body',    coalesce(a.body, 'เปิดแอพเพื่อดูรายละเอียด'),
      'url',     '/'
    ))
    from announcements a
    cross join (select id, dept_code, extra_depts from profiles where is_active) p
    where a.cancelled_at is null
      and a.notify
      and a.expires_at > now()
      and a.created_at > now() - interval '1 day'
      and (
        a.audience_mode = 'all'
        or exists (select 1 from announcement_users u where u.ann_id = a.id and u.user_id = p.id)
        or exists (
          select 1 from announcement_depts d
           where d.ann_id = a.id
             and (d.dept_code = 'ALL'
                  or d.dept_code = p.dept_code
                  or d.dept_code = any(coalesce(p.extra_depts, '{}')))
        )
      )
      and not exists (
        select 1 from notification_log n
        where n.kind = 'announce_new' and n.subject = a.id::text and n.user_id = p.id
      )
  ), '[]'::jsonb);
end $$;

grant execute on function push_announcement_jobs() to authenticated, service_role;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'meeting_events' and column_name = 'audience_mode')  as โหมดผู้เข้าร่วม,
  (select count(*) from information_schema.tables
    where table_name = 'meeting_overrides')                                 as ตารางแก้สถานะ,
  (select count(*) from pg_proc where proname = 'meeting_roster')           as ฟังก์ชันรายชื่อ,
  (select count(*) from pg_proc where proname = 'meeting_summary')          as ฟังก์ชันสรุป,
  (select count(*) from information_schema.columns
    where table_name = 'announcements' and column_name = 'audience_mode')   as ประกาศล็อกผู้รับ,
  (select count(*) from meeting_events where audience_mode = 'free')        as นัดเก่าที่ไม่เปลี่ยน;
