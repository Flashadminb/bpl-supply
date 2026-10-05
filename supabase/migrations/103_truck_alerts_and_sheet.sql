-- =====================================================================
-- BPL SUPPLY — ตารางปล่อยรถ ชุดที่สอง
--   แจ้งเตือน · ส่งลงชีต · ลบของเก่าที่ส่งแล้ว
-- รันต่อจาก 102 · ปลอดภัยที่จะรันซ้ำ
--
-- ใช้นาฬิกาเดิมที่เดินทุกนาทีอยู่แล้ว ไม่ได้สร้างตัวจับเวลาใหม่
-- ซึ่งเป็นเหตุผลทั้งหมดที่เอาเรื่องรถมาไว้ในแอพนี้แทนที่จะทำเว็บแยก
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. ตั้งค่าแจ้งเตือน · แถวเดียวทั้งระบบ
--
-- แยกสองจังหวะชัดเจน เพราะเป็นคนละเรื่องกัน
--   ก่อนครบกำหนด = เตือนให้รีบ ยังแก้ทัน
--   หลังครบกำหนด = บอกว่าสายแล้ว ซึ่งต้องย้ำจนกว่าจะปล่อย
-- ---------------------------------------------------------------------
create table if not exists truck_alert_settings (
  id          boolean primary key default true check (id),
  -- เตือนล่วงหน้ากี่นาทีก่อนครบกำหนด · 0 = ไม่เตือนล่วงหน้า
  before_min  integer not null default 30 check (before_min between 0 and 240),
  -- เลยกำหนดไปกี่นาทีถึงเริ่มเตือน · 0 = เตือนทันทีที่เลย
  after_min   integer not null default 0 check (after_min between 0 and 240),
  -- ย้ำซ้ำทุกกี่นาทีหลังจากนั้น
  repeat_min  integer not null default 15 check (repeat_min between 5 and 120),
  -- ย้ำได้นานสุดกี่นาที แล้วหยุด · กันมือถือสั่นทั้งคืนถ้าลืมปิดใบ
  stop_min    integer not null default 120 check (stop_min between 15 and 720),
  is_on       boolean not null default false,
  -- ตำแหน่งที่ได้รับ · เก็บเป็นชื่อ role ตรง ๆ
  roles       text[] not null default '{}',
  updated_at  timestamptz not null default now(),
  updated_by  uuid references profiles(id)
);

insert into truck_alert_settings (id) values (true) on conflict (id) do nothing;

alter table truck_alert_settings enable row level security;
drop policy if exists read_truck_alert_settings on truck_alert_settings;
create policy read_truck_alert_settings on truck_alert_settings for select to authenticated
  using (my_can_truck());
grant select on truck_alert_settings to authenticated;


-- รายคนที่เลือกไว้เอง · รวมกับ roles ข้างบนแบบ union
create table if not exists truck_alert_subs (
  user_id uuid primary key references profiles(id) on delete cascade,
  at      timestamptz not null default now(),
  by_user uuid references profiles(id)
);

alter table truck_alert_subs enable row level security;
drop policy if exists read_truck_alert_subs on truck_alert_subs;
create policy read_truck_alert_subs on truck_alert_subs for select to authenticated
  using (my_can_truck());
grant select on truck_alert_subs to authenticated;


create or replace function truck_alert_save(
  p_before integer,
  p_after  integer,
  p_repeat integer,
  p_stop   integer,
  p_on     boolean,
  p_roles  text[]
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if my_role() <> 'admin' then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ตั้งค่าแจ้งเตือนรถได้';
  end if;

  update truck_alert_settings
     set before_min = p_before, after_min = p_after, repeat_min = p_repeat,
         stop_min = p_stop, is_on = p_on,
         roles = coalesce(p_roles, '{}'), updated_at = now(), updated_by = auth.uid()
   where id;

  return jsonb_build_object('ok', true);
end $$;

grant execute on function truck_alert_save(integer, integer, integer, integer, boolean, text[]) to authenticated;


create or replace function truck_alert_sub_set(p_user uuid, p_on boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if my_role() <> 'admin' then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่เลือกผู้รับแจ้งเตือนได้';
  end if;

  if p_on then
    insert into truck_alert_subs (user_id, by_user) values (p_user, auth.uid())
    on conflict (user_id) do nothing;
  else
    delete from truck_alert_subs where user_id = p_user;
  end if;

  return jsonb_build_object('ok', true);
end $$;

grant execute on function truck_alert_sub_set(uuid, boolean) to authenticated;


-- ---------------------------------------------------------------------
-- 2. งานแจ้งเตือน · ต่อท้ายนาฬิกาเดิมที่เดินทุกนาที
--
-- subject ของรอบย้ำใช้เลขช่องเวลา ไม่ใช่เวลาจริง
-- เพราะ notification_log กันซ้ำด้วย subject ถ้าใช้เวลาจริงจะไม่ซ้ำสักครั้ง
-- แล้วมือถือจะสั่นทุกนาที · วิธีนี้ยิงได้รอบเดียวต่อหนึ่งช่วง repeat_min
-- ---------------------------------------------------------------------
create or replace function push_truck_jobs() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_s    truck_alert_settings%rowtype;
  v_jobs jsonb := '[]'::jsonb;
begin
  select * into v_s from truck_alert_settings where id;
  if v_s is null or not v_s.is_on then
    return '[]'::jsonb;
  end if;

  with who as (
    select p.id from profiles p
     where p.is_active and p.role = any(v_s.roles)
    union
    select s.user_id from truck_alert_subs s
      join profiles p2 on p2.id = s.user_id and p2.is_active
  )

  -- ① ใกล้ครบกำหนด · ยิงครั้งเดียวต่อคัน
  select coalesce(jsonb_agg(j), '[]'::jsonb) into v_jobs from (
    select jsonb_build_object(
      'kind',    'truck_soon',
      'subject', r.id::text,
      'user_id', w.id,
      'title',   '🚚 ใกล้ถึงเวลาปล่อยรถ · ' || r.branch_name,
      'body',    'ครบกำหนด ' ||
                 to_char(r.due_at at time zone 'Asia/Bangkok', 'HH24:MI') ||
                 ' · เหลืออีก ' ||
                 greatest(0, floor(extract(epoch from (r.due_at - now())) / 60))::int || ' นาที',
      'url',     '/trucks'
    ) as j
    from truck_runs r
    cross join who w
    where v_s.before_min > 0
      and r.left_at is null
      and now() >= r.due_at - make_interval(mins => v_s.before_min)
      and now() <  r.due_at
      and not exists (select 1 from notification_log n
                       where n.kind = 'truck_soon' and n.subject = r.id::text and n.user_id = w.id)
  ) g;

  -- ② เลยกำหนดแล้ว · ย้ำทุก repeat_min จนครบ stop_min
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(j) from (
      select jsonb_build_object(
        'kind',    'truck_late',
        'subject', r.id::text || ':' || slot::text,
        'user_id', w.id,
        'title',   '🔴 รถเลยเวลาปล่อย · ' || r.branch_name,
        'body',    'ควรออก ' ||
                   to_char(r.due_at at time zone 'Asia/Bangkok', 'HH24:MI') ||
                   ' · เลยมาแล้ว ' ||
                   floor(extract(epoch from (now() - r.due_at)) / 60)::int || ' นาที',
        'url',     '/trucks'
      ) as j
      from truck_runs r
      cross join who w
      cross join lateral (
        select floor(extract(epoch from (now() - r.due_at - make_interval(mins => v_s.after_min)))
                     / (v_s.repeat_min * 60))::int as slot
      ) s
      where r.left_at is null
        and now() >= r.due_at + make_interval(mins => v_s.after_min)
        and now() <  r.due_at + make_interval(mins => v_s.after_min + v_s.stop_min)
        and not exists (select 1 from notification_log n
                         where n.kind = 'truck_late'
                           and n.subject = r.id::text || ':' || s.slot::text
                           and n.user_id = w.id)
    ) g2
  ), '[]'::jsonb);

  return v_jobs;
end $$;

grant execute on function push_truck_jobs() to authenticated, service_role;


create or replace function push_due_jobs() returns jsonb
language sql security definer set search_path = public as $$
  select push_core_jobs()
      || push_meeting_jobs()
      || push_meeting_open_jobs()
      || push_announcement_jobs()
      || push_break_jobs()
      || push_truck_jobs();
$$;

grant execute on function push_due_jobs() to authenticated, service_role;


-- ---------------------------------------------------------------------
-- 3. ส่งลงชีต · โครงเดียวกับของบัตรเบรค
--
-- ส่งเฉพาะคันที่ปล่อยแล้ว คันที่ยังอยู่ในคลังยังไม่รู้ผล
-- ชีตเป็นที่เก็บระยะยาว เพราะวันละ 200-400 คันคือปีละราวแสนแถว
-- ---------------------------------------------------------------------
create table if not exists truck_sheet_exports (
  run_id      bigint primary key references truck_runs (id) on delete cascade,
  tab         text not null,
  row_no      integer not null,
  exported_at timestamptz not null default now()
);

alter table truck_sheet_exports enable row level security;
drop policy if exists read_truck_sheet_exports on truck_sheet_exports;
create policy read_truck_sheet_exports on truck_sheet_exports for select to authenticated
  using (my_can_truck());
grant select on truck_sheet_exports to authenticated;
grant all on truck_sheet_exports to service_role;


drop view if exists truck_export_rows;
create view truck_export_rows
with (security_invoker = true) as
select
  r.id,
  r.branch_name,
  r.branch_code,
  b.full_name   as branch_full,
  b.province,
  b.district,
  b.subdistrict,
  b.branch_ref,
  r.arrived_at,
  r.allow_min,
  r.due_at,
  r.left_at,
  r.late_min,
  (r.late_min = 0)                                           as on_time,
  (extract(epoch from (r.left_at - r.arrived_at)) / 60)::int as dwell_min,
  r.note,
  p.full_name as by_name,
  c.full_name as closed_by_name,
  e.tab,
  e.row_no,
  e.exported_at,
  (e.tab is not null)                                        as is_exported,
  (e.tab is null or e.exported_at < r.left_at)               as needs_push
from truck_runs r
left join truck_branches b     on b.id = r.branch_id
left join profiles p           on p.id = r.created_by
left join profiles c           on c.id = r.closed_by
left join truck_sheet_exports e on e.run_id = r.id
where r.left_at is not null;

grant select on truck_export_rows to authenticated;
grant select on truck_export_rows to service_role;


-- ลบของเก่า · ต้องส่งลงชีตไปแล้วเท่านั้น เหตุผลเดียวกับบัตรเบรค
create or replace function truck_purge_exported(p_days integer default 180)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cut   timestamptz := now() - make_interval(days => greatest(p_days, 30));
  v_stuck integer;
  v_n     integer;
begin
  if my_role() <> 'admin' then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ลบประวัติรถยกชุดได้';
  end if;

  select count(*) into v_stuck
    from truck_runs r
    left join truck_sheet_exports e on e.run_id = r.id
   where r.left_at is not null and r.arrived_at < v_cut and e.run_id is null;

  if v_stuck > 0 then
    raise exception 'มี % คันที่เก่าพอจะลบแต่ยังไม่ได้ส่งลงชีต กดส่งก่อน', v_stuck;
  end if;

  delete from truck_runs r
   using truck_sheet_exports e
   where e.run_id = r.id and r.left_at is not null and r.arrived_at < v_cut;

  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'deleted', v_n, 'before', v_cut);
end $$;

grant execute on function truck_purge_exported(integer) to authenticated;


-- ---------------------------------------------------------------------
-- 4. แก้ไขรายชื่อสาขา · เจ้าของ แอดมิน ผู้ตรวจสอบ
-- ---------------------------------------------------------------------
create or replace function truck_branch_save(
  p_id          bigint,
  p_name        text,
  p_code        text default null,
  p_full        text default null,
  p_province    text default null,
  p_district    text default null,
  p_subdistrict text default null,
  p_ref         text default null,
  p_open        boolean default true,
  p_active      boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
begin
  if my_role() not in ('supervisor', 'admin') and not my_can_audit() then
    raise exception 'ไม่มีสิทธิ์แก้รายชื่อสาขา';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'ต้องใส่ชื่อสาขา';
  end if;

  if p_id is null then
    insert into truck_branches (name, code, full_name, province, district, subdistrict,
                                branch_ref, is_open, is_active, created_by)
    values (btrim(p_name), nullif(btrim(coalesce(p_code, '')), ''), nullif(btrim(coalesce(p_full, '')), ''),
            nullif(btrim(coalesce(p_province, '')), ''), nullif(btrim(coalesce(p_district, '')), ''),
            nullif(btrim(coalesce(p_subdistrict, '')), ''), nullif(btrim(coalesce(p_ref, '')), ''),
            p_open, p_active, auth.uid())
    returning id into v_id;
  else
    update truck_branches
       set name = btrim(p_name),
           code = nullif(btrim(coalesce(p_code, '')), ''),
           full_name = nullif(btrim(coalesce(p_full, '')), ''),
           province = nullif(btrim(coalesce(p_province, '')), ''),
           district = nullif(btrim(coalesce(p_district, '')), ''),
           subdistrict = nullif(btrim(coalesce(p_subdistrict, '')), ''),
           branch_ref = nullif(btrim(coalesce(p_ref, '')), ''),
           is_open = p_open, is_active = p_active
     where id = p_id
    returning id into v_id;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

grant execute on function truck_branch_save(bigint, text, text, text, text, text, text, text, boolean, boolean) to authenticated;


create or replace function truck_branches_delete(p_ids bigint[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_used text;
  v_n    integer;
begin
  if my_role() not in ('supervisor', 'admin') and not my_can_audit() then
    raise exception 'ไม่มีสิทธิ์ลบสาขา';
  end if;

  -- สาขาที่เคยมีรถเข้าแล้วลบไม่ได้ ไม่งั้นประวัติจะชี้ไปที่ของที่ไม่มีอยู่
  -- ปิดใช้งานแทนได้ ซึ่งทำให้มันหลุดจากรายการค้นหาแต่ประวัติยังอ่านได้
  select string_agg(distinct b.name, ', ') into v_used
    from truck_branches b join truck_runs r on r.branch_id = b.id
   where b.id = any(p_ids);
  if v_used is not null then
    raise exception 'สาขา % เคยมีรถเข้าแล้ว ลบไม่ได้ · ปิดใช้งานแทน', v_used;
  end if;

  delete from truck_branches where id = any(p_ids);
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'deleted', v_n);
end $$;

grant execute on function truck_branches_delete(bigint[]) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc
    where proname in ('push_truck_jobs', 'truck_alert_save', 'truck_alert_sub_set',
                      'truck_purge_exported', 'truck_branch_save',
                      'truck_branches_delete'))                        as ฟังก์ชันที่เพิ่ม,
  (select is_on::text from truck_alert_settings where id)              as แจ้งเตือนเปิดอยู่ไหม,
  (select count(*) from truck_export_rows)                             as คันที่ส่งลงชีตได้,
  (select jsonb_array_length(push_truck_jobs()))                       as งานเตือนที่รอส่งตอนนี้;
