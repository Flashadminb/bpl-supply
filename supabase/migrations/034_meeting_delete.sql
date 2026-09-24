-- =====================================================================
-- BPL SUPPLY — ลบรายการเช็คอินประชุมถาวร
-- รันต่อจาก 033 · ปลอดภัยที่จะรันซ้ำ
--
-- เดิมออกแบบให้ "ตีตก" แทนการลบ เพื่อเก็บหลักฐานว่าใครตัดสินว่าอะไรปลอม
-- เจ้าของระบบขอให้ลบออกจากหน้าเว็บได้จริง จึงเพิ่มการลบถาวรเข้ามา
-- โดยยังเก็บตัวเลือก "ตีตก" ไว้ทั้งคู่ ให้เลือกใช้ตามสถานการณ์
--
-- ข้อควรรู้ที่ลบไม่ได้
--   รูปใน Google Drive ยังอยู่ ไฟล์นั้นไม่ได้ถูกลบตามไปด้วย
--   แถวที่เคยส่งขึ้น Google Sheet ไปแล้วก็ยังอยู่ในชีต
--   ลบที่นี่คือลบออกจากระบบและหน้าเว็บ ไม่ใช่ลบทุกที่ในโลก
-- =====================================================================

create or replace function delete_meetings(p_ids uuid[])
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if not my_can_audit() then
    raise exception 'บัญชีนี้ลบรายการประชุมไม่ได้';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  -- meeting_sheet_exports ผูก on delete cascade ไว้แล้ว ไม่ต้องลบเอง
  delete from meeting_checkins where id = any(p_ids);

  get diagnostics v_n = row_count;
  return v_n;
end $$;

grant execute on function delete_meetings(uuid[]) to authenticated;


-- ---------------------------------------------------------------------
-- สรุปรายวันสำหรับแดชบอร์ด
--
-- นับที่ฐานข้อมูล ไม่ได้ดึงทุกแถวมานับในเบราว์เซอร์
-- เพราะจำนวนคนกำลังจะเพิ่มเป็นสามเท่า และหน้านี้เปิดบ่อย
-- ---------------------------------------------------------------------
create or replace function meeting_daily(p_from date, p_to date)
returns table (
  day        date,
  confirmed  integer,
  pending    integer,
  rejected   integer,
  total      integer,
  people     integer
)
language sql stable security definer set search_path = public as $$
  select
    (m.created_at at time zone 'Asia/Bangkok')::date as day,
    count(*) filter (where m.status = 'confirmed')::int,
    count(*) filter (where m.status = 'pending')::int,
    count(*) filter (where m.status = 'rejected')::int,
    count(*)::int,
    count(distinct m.user_id)::int
  from meeting_checkins m
  where my_can_audit()
    and (m.created_at at time zone 'Asia/Bangkok')::date between p_from and p_to
  group by 1
  order by 1;
$$;

grant execute on function meeting_daily(date, date) to authenticated;


-- ---------------------------------------------------------------------
-- สรุปรายแผนกสำหรับแดชบอร์ด
-- ---------------------------------------------------------------------
create or replace function meeting_by_dept(p_from date, p_to date)
returns table (
  dept_code  text,
  confirmed  integer,
  total      integer,
  people     integer
)
language sql stable security definer set search_path = public as $$
  select
    coalesce(m.dept_code, 'ไม่ระบุ') as dept_code,
    count(*) filter (where m.status = 'confirmed')::int,
    count(*)::int,
    count(distinct m.user_id)::int
  from meeting_checkins m
  where my_can_audit()
    and (m.created_at at time zone 'Asia/Bangkok')::date between p_from and p_to
  group by 1
  order by 2 desc;
$$;

grant execute on function meeting_by_dept(date, date) to authenticated;


-- =====================================================================
-- นัดประชุม — ประกาศให้ทุกคนรู้ว่าใครต้องเข้า
--
-- ผู้เข้าร่วมเก็บเป็น "ข้อความอิสระ" ไม่ได้ผูกกับตำแหน่งในระบบ
-- เพราะโครงตำแหน่งจริงหน้างาน (sup, lead, ฯลฯ) ไม่ได้มีอยู่ในฐานข้อมูลนี้
-- และถ้าไปสร้างตารางตำแหน่งขึ้นมา ก็ต้องมาคอยอัปเดตทุกครั้งที่คนย้ายงาน
-- พิมพ์เป็นข้อความแล้วประกาศให้ทุกคนอ่าน ตรงกับที่ใช้จริงมากกว่า
--
-- ทุกคนได้รับแจ้งเตือน ไม่ได้ส่งเฉพาะคนที่เกี่ยว
-- เพราะระบบไม่รู้ว่าใครเป็น sup ดังนั้นการ "ไม่ส่ง" จะพลาดคนที่ต้องมา
-- ส่งให้หมดแล้วให้คนอ่านเองว่าเกี่ยวกับตัวไหม ปลอดภัยกว่าเดาแล้วพลาด
-- =====================================================================

create table if not exists meeting_events (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  meet_at      timestamptz not null,
  /** ใครต้องเข้า — ข้อความอิสระ เช่น "sup และ lead ทุกคน" */
  audience     text,
  place        text,
  note         text,
  created_by   uuid not null references profiles(id),
  created_at   timestamptz not null default now(),
  cancelled_at timestamptz
);

create index if not exists meeting_events_at_idx on meeting_events (meet_at desc);

alter table meeting_events enable row level security;

-- ประกาศ ทุกคนที่ล็อกอินต้องเห็น
drop policy if exists read_meeting_events on meeting_events;
create policy read_meeting_events on meeting_events for select to authenticated using (true);

-- นัดและยกเลิกผ่าน RPC เท่านั้น


create or replace function create_meeting_event(
  p_title    text,
  p_meet_at  timestamptz,
  p_audience text default null,
  p_place    text default null,
  p_note     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
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

  insert into meeting_events (title, meet_at, audience, place, note, created_by)
  values (btrim(p_title), p_meet_at, nullif(btrim(p_audience), ''),
          nullif(btrim(p_place), ''), nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;

  return jsonb_build_object('id', v_id);
end $$;

grant execute on function create_meeting_event(text, timestamptz, text, text, text) to authenticated;


create or replace function cancel_meeting_event(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not my_can_audit() then
    raise exception 'บัญชีนี้ยกเลิกนัดประชุมไม่ได้';
  end if;
  update meeting_events set cancelled_at = now() where id = p_id and cancelled_at is null;
end $$;

grant execute on function cancel_meeting_event(uuid) to authenticated;


create or replace function delete_meeting_event(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not my_can_audit() then
    raise exception 'บัญชีนี้ลบนัดประชุมไม่ได้';
  end if;
  delete from meeting_events where id = p_id;
end $$;

grant execute on function delete_meeting_event(uuid) to authenticated;


drop view if exists meeting_event_rows;
create view meeting_event_rows
with (security_invoker = true) as
select
  e.id,
  e.title,
  e.meet_at,
  e.audience,
  e.place,
  e.note,
  e.created_by,
  p.full_name as created_by_name,
  e.created_at,
  e.cancelled_at,
  (e.meet_at at time zone 'Asia/Bangkok')::date as day
from meeting_events e
join profiles p on p.id = e.created_by;

grant select on meeting_event_rows to authenticated;


-- ---------------------------------------------------------------------
-- แจ้งเตือนนัดประชุม — ต่อท้ายงานเดิมใน push_due_jobs
--
-- สองจังหวะ: ตอนประกาศ และ 30 นาทีก่อนถึงเวลา
-- ส่งให้ทุกคนที่ยังใช้งานอยู่ ไม่ได้เลือกเฉพาะบางตำแหน่ง
-- เพราะระบบไม่รู้ว่าใครเป็น sup หรือ lead การเลือกส่งจึงเสี่ยงพลาดคนที่ต้องมา
-- ---------------------------------------------------------------------
create or replace function push_meeting_jobs()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_jobs jsonb := '[]'::jsonb;
  v_now  timestamptz := now();
begin
  -- ① เพิ่งประกาศ · ส่งครั้งเดียวต่อคน
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'meeting_new',
      'subject', e.id::text,
      'user_id', m.id,
      'title',   'นัดประชุม · ' || e.title,
      'body',    to_char((e.meet_at at time zone 'Asia/Bangkok'), 'DD/MM HH24:MI') ||
                 coalesce(' · ' || e.place, '') ||
                 coalesce(' · ผู้เข้าร่วม: ' || e.audience, ''),
      'url',     '/'
    ))
    from meeting_events e
    cross join (select id from profiles where is_active) m
    where e.cancelled_at is null
      and e.created_at > v_now - interval '1 day'
      and e.meet_at > v_now
      and not exists (
        select 1 from notification_log n
        where n.kind = 'meeting_new' and n.subject = e.id::text and n.user_id = m.id
      )
  ), '[]'::jsonb);

  -- ② ใกล้ถึงเวลา 30 นาที · ส่งครั้งเดียวต่อคน
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'meeting_soon',
      'subject', e.id::text,
      'user_id', m.id,
      'title',   'อีก 30 นาทีถึงเวลาประชุม',
      'body',    e.title || coalesce(' · ' || e.place, '') ||
                 coalesce(' · ผู้เข้าร่วม: ' || e.audience, ''),
      'url',     '/'
    ))
    from meeting_events e
    cross join (select id from profiles where is_active) m
    where e.cancelled_at is null
      and e.meet_at between v_now and v_now + interval '30 minutes'
      and not exists (
        select 1 from notification_log n
        where n.kind = 'meeting_soon' and n.subject = e.id::text and n.user_id = m.id
      )
  ), '[]'::jsonb);

  return v_jobs;
end $$;

grant execute on function push_meeting_jobs() to authenticated, service_role;


-- ---------------------------------------------------------------------
-- ต่อท้ายงานประชุมเข้ากับคิวแจ้งเตือนเดิม
--
-- ย้ายตัวเดิมไปชื่อ push_core_jobs แล้วทำตัวใหม่ที่รวมสองชุดเข้าด้วยกัน
-- ทำแบบนี้เพื่อไม่ต้องก๊อป 200 บรรทัดของตัวเดิมมาวางซ้ำ
-- ซึ่งถ้าก๊อปไว้ วันหลังแก้จังหวะเตือนจะต้องไล่แก้สองที่แล้วลืมที่หนึ่งแน่นอน
--
-- ตัว Edge Function เรียก push_due_jobs เหมือนเดิม ไม่ต้อง deploy ใหม่
-- ---------------------------------------------------------------------
do $$
begin
  -- เปลี่ยนชื่อครั้งเดียวเท่านั้น ถ้ารันไฟล์นี้ซ้ำจะข้ามไป
  -- ไม่งั้นรอบสองจะไปเปลี่ยนชื่อ "ตัวห่อ" แล้วกลายเป็นเรียกตัวเอง
  if not exists (select 1 from pg_proc where proname = 'push_core_jobs') then
    alter function push_due_jobs() rename to push_core_jobs;
  end if;
end $$;

create or replace function push_due_jobs()
returns jsonb
language sql security definer set search_path = public as $$
  select push_core_jobs() || push_meeting_jobs();
$$;

grant execute on function push_due_jobs() to authenticated, service_role;


-- =====================================================================
-- ลบรายการในหน้าหลักฐานการเบิก-คืนถาวร — เฉพาะเจ้าของระบบ
--
-- อันนี้หนักกว่าลบรูปประชุมมาก เพราะลบใบเบิกคือลบประวัติการตัดสต็อกทิ้ง
-- สต็อกจะ "ไม่" ถูกคืนกลับให้ ตัวเลขคงเหลือยังเท่าเดิม
-- แต่หลักฐานว่าของหายไปไหนจะไม่เหลือแล้ว ยอดจึงอธิบายไม่ได้
-- ปุ่มนี้จึงเปิดให้เจ้าของระบบคนเดียว ไม่ใช่แอดมินหรือผู้ตรวจสอบ
--
-- ถ้าเป็นการเบิกเครื่องที่ยังไม่ได้คืน จะไม่ยอมให้ลบ
-- เพราะเครื่องจะหลุดจากรายการค้างโดยไม่มีใครรู้ว่ามันอยู่ไหน
-- ต้องกดคืนให้เรียบร้อยก่อน แล้วค่อยลบประวัติถ้ายังอยากลบ
-- =====================================================================

create or replace function delete_evidence(p_kind text, p_id text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_txn uuid;
begin
  if my_role() <> 'admin' then
    raise exception 'เฉพาะเจ้าของระบบเท่านั้นที่ลบหลักฐานได้';
  end if;

  if p_kind = 'requisition' then
    delete from requisitions where id = p_id::uuid;

  elsif p_kind = 'return' then
    delete from returns where id = p_id::bigint;

  elsif p_kind in ('asset_out', 'asset_in') then
    v_txn := p_id::uuid;

    if exists (
      select 1
      from asset_txn_items ai
      join assets a on a.held_item_id = ai.id
      where ai.txn_id = v_txn
    ) then
      raise exception 'ยังมีเครื่องในรายการนี้ที่ไม่ได้คืน กดคืนให้เรียบร้อยก่อนจึงจะลบได้';
    end if;

    delete from asset_txns where id = v_txn;

  else
    raise exception 'ไม่รู้จักประเภท %', p_kind;
  end if;
end $$;

grant execute on function delete_evidence(text, text) to authenticated;
