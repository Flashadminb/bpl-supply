-- =====================================================================
-- BPL SUPPLY — แจ้งเตือนรถ เตือนครั้งเดียวจบ
-- รันต่อจาก 104 · ปลอดภัยที่จะรันซ้ำ
--
-- เดิมทำการย้ำซ้ำไว้ให้ ซึ่งเจ้าของระบบไม่ได้สั่ง และไม่อยากได้
-- เหตุผลที่เขาถูก: คนที่ได้เตือนคือคนที่กดปล่อยรถไม่ได้ด้วยตัวเอง
-- การย้ำทุก 15 นาทีจึงไม่ได้ทำให้รถออกเร็วขึ้น ได้แค่ทำให้คนปิดแจ้งเตือนทิ้ง
--
-- ช่อง repeat_min กับ stop_min ยังอยู่ในตาราง แต่ไม่มีอะไรอ่านมันแล้ว
-- ไม่ลบทิ้งเพราะการลบคอลัมน์ที่เคยมีค่าไม่ได้ทำให้อะไรดีขึ้น
-- =====================================================================

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

  -- ② เลยกำหนดแล้ว · ยิงครั้งเดียวต่อคันเหมือนกัน
  --
  -- subject เป็นเลขคันเปล่า ๆ ไม่มีเลขรอบต่อท้ายแล้ว
  -- notification_log จึงกันซ้ำให้เองตลอดอายุของแถวนั้น
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(j) from (
      select jsonb_build_object(
        'kind',    'truck_late',
        'subject', r.id::text,
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
      where r.left_at is null
        and now() >= r.due_at + make_interval(mins => v_s.after_min)
        -- กันเคสเปิดแจ้งเตือนย้อนหลังแล้วรถค้างเก่ายิงพรวดเดียวสิบคัน
        and now() <  r.due_at + make_interval(mins => v_s.after_min + 720)
        and not exists (select 1 from notification_log n
                         where n.kind = 'truck_late'
                           and n.subject = r.id::text
                           and n.user_id = w.id)
    ) g2
  ), '[]'::jsonb);

  return v_jobs;
end $$;

grant execute on function push_truck_jobs() to authenticated, service_role;


-- ---------------------------------------------------------------------
-- หน้าหลังบ้านไม่ส่งสองค่านั้นมาแล้ว · ใส่ค่าปริยายไว้ให้เรียกสั้นลงได้
-- ---------------------------------------------------------------------
create or replace function truck_alert_save(
  p_before int,
  p_after  int,
  p_repeat int default 0,
  p_stop   int default 0,
  p_on     boolean default false,
  p_roles  text[] default '{}'
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if my_role() <> 'admin' then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ตั้งค่าแจ้งเตือนรถได้';
  end if;

  update truck_alert_settings set
    before_min = greatest(0, least(720, coalesce(p_before, 0))),
    after_min  = greatest(0, least(720, coalesce(p_after, 0))),
    repeat_min = greatest(0, least(720, coalesce(p_repeat, 0))),
    stop_min   = greatest(0, least(1440, coalesce(p_stop, 0))),
    is_on      = coalesce(p_on, false),
    roles      = coalesce(p_roles, '{}'),
    updated_at = now(),
    updated_by = auth.uid()
  where id;

  return jsonb_build_object('ok', true);
end $$;

grant execute on function truck_alert_save(int, int, int, int, boolean, text[]) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc
    where proname = 'push_truck_jobs'
      and prosrc like '%ยิงครั้งเดียวต่อคันเหมือนกัน%')     as เตือนครั้งเดียวแล้ว,
  (select jsonb_array_length(push_truck_jobs()))            as งานเตือนที่รอส่งตอนนี้;
