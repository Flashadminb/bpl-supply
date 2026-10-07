-- =====================================================================
-- BPL SUPPLY — ซ่อมรายชื่อผู้เข้าประชุม
-- รันต่อจาก 118 · ปลอดภัยที่จะรันซ้ำ
--
-- เจ้าของระบบแจ้งว่า "เหมือนมีคนที่ไม่ได้เลือกในรายชื่อขึ้นมาด้วย และขึ้นขาด"
-- ตรวจของจริงแล้วเจอสี่เรื่องที่พันกันอยู่
--
-- ① ติ๊กแผนก "ทุกแผนก" แล้วกลายเป็นเหมาทั้งฮับ
--    ปุ่มแผนกในหน้าประกาศดึงรายชื่อแผนกมาทั้งตาราง ซึ่งมีแถว ALL ชื่อ "ทุกแผนก"
--    ปนอยู่ด้วย แถวนั้นไม่ใช่แผนกจริง เป็นค่าตั้งต้นของระบบที่แปลว่า "ไม่สังกัดแผนกไหน"
--    แต่ meeting_expected อ่าน ALL ว่า "เชิญทุกคนในระบบ"
--    นัด ประชุมประจำสัปดาห์ที่ W39 เลือกไว้ 28 คน กับ 3 แผนก แล้วเผลอติ๊ก ทุกแผนก ไปด้วย
--    รายชื่อจึงบานเป็น 85 คน ซึ่งคือจำนวนคนทั้งฮับพอดี แล้วคนที่ไม่รู้เรื่องก็ขึ้นขาดกันหมด
--    แถมแจ้งเตือนก็ถูกส่งไปหาทั้งฮับด้วยเหตุเดียวกัน
--    ของใหม่ ALL แปลว่า "คนที่แผนกของเขาคือทุกแผนก" ตรงกับที่ปุ่มเขียนไว้
--    ถ้าจะเชิญทั้งฮับจริง ๆ มีตัวเลือก "ทุกคนในระบบ" อยู่แล้วตั้งแต่แรก
--
-- ② extra_depts ถูกเอามาตัดสินว่าใครต้องเข้าประชุม
--    คอลัมน์นั้นแปลว่า "คนนี้มองเห็นของแผนกอื่นได้" ไม่ใช่ "คนนี้สังกัดแผนกอื่น"
--    ปล่อยไว้แปลว่าวันไหนเปิดให้ใครเห็นของแผนก QC เขาจะถูกเรียกเข้าประชุม QC ไปด้วย
--    ตอนนี้มี 8 คนที่ถือสิทธิ์แบบนี้อยู่ ยังไม่โดนเพราะบังเอิญไม่ตรงกับแผนกที่เลือก
--
-- ③ รายชื่อคิดสดทุกครั้งที่เปิดดู ไม่ได้ล็อกไว้ตอนประกาศ
--    คนเข้าใหม่วันนี้จะไปโผล่เป็น "ขาด" ในประชุมของเดือนที่แล้ว
--    คนที่ลาออกแล้วหายไปจากประวัติเก่าทั้งที่วันนั้นเขามาจริง
--    ของใหม่ล็อกรายชื่อตอนประกาศ แล้วมีปุ่มดึงคนเข้าใหม่เพิ่มทีหลังถ้าต้องการ
--
-- ④ แก้สถานะเข้าประชุมไม่ได้เลยสักครั้ง
--    092 ตั้งใจเลิกบังคับให้พิมพ์เหตุผล แก้ฟังก์ชันให้ส่ง null ไปแล้วจริง
--    แต่ลืมปลด not null ที่ตัวคอลัมน์ ทุกการกดแก้สถานะที่ไม่พิมพ์เหตุผลจึงล้ม
--    ซึ่งคือทุกครั้งที่กดจากหน้าจอ เพราะหน้าจอไม่เคยส่งเหตุผลมา
--    ตาราง meeting_overrides จึงยังว่างเปล่าสนิท ปุ่ม "เช็คทั้งหมดว่ามา" ก็พังด้วยเหตุเดียวกัน
-- =====================================================================

-- ---------------------------------------------------------------------
-- ④ ปลดล็อกที่ 092 ลืมไว้ · ทำก่อนเพื่อน เพราะทุกอย่างข้างล่างใช้ตารางนี้
-- ---------------------------------------------------------------------
alter table meeting_overrides alter column reason drop not null;

comment on column meeting_overrides.reason is
  'โน้ตของผู้ตรวจสอบ · ไม่บังคับ · ใครแก้ แก้เมื่อไหร่ และสถานะเดิม ยังตรวจย้อนได้จาก raw_state';


-- ---------------------------------------------------------------------
-- ①② กติกาว่าใครเข้าข่ายถูกเชิญ
--
-- แยกออกมาเป็นฟังก์ชันของตัวเอง เพราะตอนนี้มีสามที่ที่ต้องใช้กติกาเดียวกัน
-- คือตอนประกาศ ตอนกดดึงคนเพิ่ม และตอนย้อนไปเติมให้นัดเก่าในไฟล์นี้
-- ถ้าเขียนซ้ำสามรอบ วันหนึ่งจะแก้ที่เดียวแล้วอีกสองที่คิดคนละแบบ
-- ---------------------------------------------------------------------
create or replace function meeting_audience_members(p_event uuid)
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
            -- เทียบกับแผนกของตัวเองเท่านั้น · ไม่เอา extra_depts
            -- และ ALL ที่นี่คือแผนกของคนที่ไม่สังกัดแผนกไหน ไม่ใช่ทั้งฮับ
         or exists (select 1 from meeting_event_depts d
                     where d.event_id = e.id and d.dept_code = p.dept_code)
       ))
     );
$$;

grant execute on function meeting_audience_members(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- ③ รายชื่อที่ล็อกไว้แล้ว
-- ---------------------------------------------------------------------
create table if not exists meeting_members (
  event_id uuid not null references meeting_events (id) on delete cascade,
  user_id  uuid not null references profiles (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index if not exists meeting_members_user_idx on meeting_members (user_id);

alter table meeting_members enable row level security;

-- ทุกคนอ่านได้ เพราะแอพต้องรู้ว่าตัวเองต้องเข้านัดไหน เหมือน meeting_event_users
drop policy if exists read_meeting_members on meeting_members;
create policy read_meeting_members on meeting_members for select to authenticated using (true);

drop policy if exists write_meeting_members on meeting_members;
create policy write_meeting_members on meeting_members for all to authenticated
  using (my_can_audit()) with check (my_can_audit());


-- ย้อนเติมให้นัดที่มีอยู่แล้ว ด้วยกติกาที่แก้แล้ว
-- โหมด free ไม่มีรายชื่อมาแต่ไหนแต่ไร จึงไม่ต้องเติม
--
-- เติมเฉพาะนัดที่ยังไม่มีรายชื่อเลย ไม่ใช่ทุกนัด
-- เพราะถ้าวันหลังมีใครรันไฟล์นี้ซ้ำ คนที่ถูกถอดออกไปแล้วจะกลับเข้ามาเงียบ ๆ
with blank_events as (
  select e.id from meeting_events e
   where e.audience_mode <> 'free'
     and not exists (select 1 from meeting_members m where m.event_id = e.id)
)
insert into meeting_members (event_id, user_id)
select v.id, m.user_id from blank_events v cross join lateral meeting_audience_members(v.id) m
union
-- คนที่เคยส่งใบเช็คอินมาจริงต้องอยู่ในรายชื่อเสมอ
-- ถึงวันนี้เขาจะย้ายแผนกหรือถูกปิดบัญชีไปแล้วก็ตาม ไม่งั้นประวัติจะหายไปทั้งใบ
select v.id, c.user_id from blank_events v join meeting_checkins c on c.event_id = v.id
on conflict do nothing;


-- ---------------------------------------------------------------------
-- รายชื่อที่ใช้จริง — อ่านจากที่ล็อกไว้
-- ---------------------------------------------------------------------
create or replace function meeting_expected(p_event uuid)
returns table (user_id uuid)
language sql stable security definer set search_path = public as $$
  select m.user_id from meeting_members m where m.event_id = p_event;
$$;

grant execute on function meeting_expected(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- ดึงคนที่เข้าข่ายแต่ยังไม่อยู่ในรายชื่อ เข้ามาเพิ่ม
--
-- ใช้ตอนมีคนเข้าใหม่หลังประกาศไปแล้ว หรือตอนเพิ่งย้ายใครเข้าแผนก
-- ถอดออกเฉพาะคนที่ไม่เข้าข่ายแล้ว และยังไม่ได้ส่งใบ ไม่ได้ถูกแก้สถานะไว้
-- คนที่มีร่องรอยอยู่ในนัดนี้แล้วห้ามหาย ไม่งั้นหลักฐานที่เขาส่งมาจะกลายเป็นใบไร้เจ้าของ
-- ---------------------------------------------------------------------
create or replace function meeting_sync_members(p_event uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_add int; v_del int;
begin
  if not my_can_audit() then
    raise exception 'เฉพาะผู้ตรวจสอบและแอดมินเท่านั้นที่แก้รายชื่อผู้เข้าประชุมได้';
  end if;
  if not exists (select 1 from meeting_events where id = p_event) then
    raise exception 'ไม่พบนัดประชุมนี้';
  end if;

  delete from meeting_members m
   where m.event_id = p_event
     and not exists (select 1 from meeting_audience_members(p_event) a where a.user_id = m.user_id)
     and not exists (select 1 from meeting_checkins c
                      where c.event_id = p_event and c.user_id = m.user_id)
     and not exists (select 1 from meeting_overrides o
                      where o.event_id = p_event and o.user_id = m.user_id);
  get diagnostics v_del = row_count;

  insert into meeting_members (event_id, user_id)
  select p_event, a.user_id from meeting_audience_members(p_event) a
  on conflict do nothing;
  get diagnostics v_add = row_count;

  return jsonb_build_object('ok', true, 'added', v_add, 'removed', v_del,
    'total', (select count(*) from meeting_members where event_id = p_event));
end $$;

grant execute on function meeting_sync_members(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- แก้ว่าใครต้องเข้านัดนี้ หลังประกาศไปแล้ว
--
-- จำเป็นต้องมี เพราะพอรายชื่อถูกล็อก การติ๊กผิดตอนประกาศจะแก้ไม่ได้เลย
-- ซึ่งคือสถานการณ์ที่เพิ่งเกิดกับนัด W39 พอดี
-- ---------------------------------------------------------------------
create or replace function meeting_set_audience(
  p_event uuid,
  p_depts text[] default '{}',
  p_users uuid[] default '{}'
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not my_can_audit() then
    raise exception 'เฉพาะผู้ตรวจสอบและแอดมินเท่านั้นที่แก้รายชื่อผู้เข้าประชุมได้';
  end if;
  if not exists (select 1 from meeting_events where id = p_event) then
    raise exception 'ไม่พบนัดประชุมนี้';
  end if;
  if coalesce(array_length(p_depts, 1), 0) = 0
     and coalesce(array_length(p_users, 1), 0) = 0 then
    raise exception 'ต้องเลือกอย่างน้อยหนึ่งแผนกหรือหนึ่งคน';
  end if;

  update meeting_events set audience_mode = 'picked' where id = p_event;

  delete from meeting_event_depts where event_id = p_event;
  insert into meeting_event_depts (event_id, dept_code)
  select p_event, d from unnest(coalesce(p_depts, '{}')) as d
   where exists (select 1 from departments x where x.code = d)
  on conflict do nothing;

  delete from meeting_event_users where event_id = p_event;
  insert into meeting_event_users (event_id, user_id)
  select p_event, u from unnest(coalesce(p_users, '{}')) as u
   where exists (select 1 from profiles x where x.id = u)
  on conflict do nothing;

  return meeting_sync_members(p_event);
end $$;

grant execute on function meeting_set_audience(uuid, text[], uuid[]) to authenticated;


-- ---------------------------------------------------------------------
-- ประกาศนัด — ล็อกรายชื่อทันทีที่ประกาศ
--
-- และถ้าไม่ได้พิมพ์ว่าใครเข้าบ้าง เขียนให้เองจากที่ติ๊กไว้
-- เพราะการ์ดนัดโชว์ช่องนี้ ของเดิมปล่อยว่างแล้วเปิดมาอ่านไม่ออกว่านัดนี้ของใคร
-- ---------------------------------------------------------------------
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
  v_id    uuid;
  v_open  integer;
  v_late  integer;
  v_aud   text := nullif(btrim(coalesce(p_audience, '')), '');
  v_n     integer;
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
  values (btrim(p_title), p_meet_at, v_aud,
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

  -- ล็อกรายชื่อ ณ ตอนประกาศ
  if p_mode <> 'free' then
    insert into meeting_members (event_id, user_id)
    select v_id, a.user_id from meeting_audience_members(v_id) a
    on conflict do nothing;
  end if;

  select count(*) into v_n from meeting_members where event_id = v_id;

  if v_aud is null then
    v_aud := case
      when p_mode = 'all'  then 'ทุกคนในระบบ ' || v_n || ' คน'
      when p_mode = 'free' then null
      else coalesce(
        (select string_agg(dp.name, ', ' order by dp.sort_no)
           from meeting_event_depts d join departments dp on dp.code = d.dept_code
          where d.event_id = v_id), '')
        || case when coalesce(array_length(p_users, 1), 0) > 0
                then (case when exists (select 1 from meeting_event_depts where event_id = v_id)
                           then ' และอีก ' else 'เลือกรายคน ' end)
                     || array_length(p_users, 1) || ' คน'
                else '' end
        || ' · รวม ' || v_n || ' คน'
    end;
    update meeting_events set audience = nullif(btrim(coalesce(v_aud, '')), '') where id = v_id;
  end if;

  begin
    perform push_tick();
  exception when others then
    raise notice 'ประกาศแล้วแต่เตะแจ้งเตือนไม่สำเร็จ (%)', sqlerrm;
  end;

  return jsonb_build_object('id', v_id, 'members', v_n);
end $fn$;

grant execute on function
  create_meeting_event(text, timestamptz, text, text, text, integer, integer, text, text[], uuid[])
  to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select is_nullable from information_schema.columns
    where table_name = 'meeting_overrides' and column_name = 'reason')  as เหตุผลว่างได้แล้วหรือยัง,
  (select count(*) from pg_proc where proname = 'meeting_audience_members') as ฟังก์ชันกติกาผู้เข้าร่วม,
  (select count(*) from pg_proc where proname = 'meeting_expected'
     and prosrc like '%extra_depts%')                                   as ยังใช้extradeptsอยู่ไหม,
  e.title                                                               as นัด,
  (select count(*) from meeting_members m where m.event_id = e.id)      as รายชื่อหลังแก้,
  (select count(*) from meeting_checkins c where c.event_id = e.id)     as ส่งใบมา
from meeting_events e
where e.audience_mode <> 'free'
order by e.meet_at desc;
