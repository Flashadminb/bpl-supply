-- =====================================================================
-- BPL SUPPLY — แจ้งเตือนเมื่อมีรายการกระสอบเข้าคิว
-- รันต่อจาก 066 · ปลอดภัยที่จะรันซ้ำ
--
-- ใครได้รับ
--   ① เจ้าของระบบ      role = 'admin'
--   ② แอดมินทุกคน       role = 'supervisor'
--   ③ ทีมซัพพอร์ต       sub_dept ตรงกับค่าที่ตั้งไว้ (ตั้งต้น SPADMIN)
--
-- ทำไมผูกกับ sub_dept ไม่ทำธงใหม่
--   คอลัมน์นี้มีอยู่แล้ว และแก้ได้ในหน้าผู้ใช้โดยไม่ต้องแตะโค้ด
--   ตั้งคนใหม่เข้าทีมซัพพอร์ต = พิมพ์ SPADMIN ในช่องแผนกย่อย จบ
--   ถ้าทำธงใหม่ต้องแก้ฐานข้อมูล หน้าจอ และสิทธิ์ ทั้งที่ได้ผลเท่ากัน
--
-- ชื่อแผนกย่อยเก็บเป็นค่าตั้งค่า ไม่ได้ฝังในโค้ด
--   วันหนึ่งอยากเปลี่ยนเป็น SUPPORT หรือ SP2 ก็แก้ค่าเดียวจบ ไม่ต้อง deploy
--
-- เทียบแบบไม่สนตัวพิมพ์เล็กใหญ่และตัดช่องว่างหัวท้าย
--   เพราะคนกรอกมือ พิมพ์ spadmin บ้าง SPADMIN บ้าง เว้นวรรคติดมาบ้าง
--   ถ้าเทียบตรง ๆ คนที่พิมพ์ผิดนิดเดียวจะไม่ได้รับแจ้งเตือนโดยไม่มีใครรู้
-- =====================================================================

insert into app_settings (key, value) values
  ('sack_notify_sub_dept', '"SPADMIN"'::jsonb)
on conflict (key) do nothing;


create or replace function push_sack_jobs()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tag text;
begin
  -- value #>> '{}' ดึงข้อความออกจาก jsonb โดยไม่ติดเครื่องหมายคำพูด
  select value #>> '{}' into v_tag
    from app_settings where key = 'sack_notify_sub_dept';
  v_tag := coalesce(nullif(btrim(v_tag), ''), 'SPADMIN');

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'sack_new',
      'subject', o.id::text,
      'user_id', p.id,
      'title',   'มีกระสอบรอส่ง · ' || o.branch,
      'body',    o.hub_code || ' · ' ||
                 to_char(o.qty, 'FM999,999,999') || ' ' || o.unit ||
                 coalesce(' · ' || o.note, ''),
      'url',     '/ship'
    ))
    from sack_orders o
    cross join profiles p
    where o.status = 'pending'
      and o.created_at > now() - interval '1 day'
      and p.is_active
      and (
        p.role in ('admin', 'supervisor')
        or upper(btrim(coalesce(p.sub_dept, ''))) = upper(v_tag)
      )
      and not exists (
        select 1 from notification_log n
        where n.kind = 'sack_new' and n.subject = o.id::text and n.user_id = p.id
      )
  ), '[]'::jsonb);
end $$;

grant execute on function push_sack_jobs() to authenticated, service_role;


-- ---------------------------------------------------------------------
-- ต่อเข้าคิวแจ้งเตือนเดิม
-- ---------------------------------------------------------------------
create or replace function push_due_jobs()
returns jsonb
language sql security definer set search_path = public as $$
  select push_core_jobs()
      || push_meeting_jobs()
      || push_meeting_open_jobs()
      || push_announcement_jobs()
      || push_sack_jobs();
$$;

grant execute on function push_due_jobs() to authenticated, service_role;


-- ---------------------------------------------------------------------
-- ตั้งรายการแล้วเตะนาฬิกาทันที ไม่ต้องรอรอบ 5 นาที
--
-- คนตั้งรายการคาดว่าทีมจะรู้เดี๋ยวนั้น ไม่ใช่อีกห้านาที
-- ถ้าเตะไม่สำเร็จก็ไม่ให้ล้มการตั้งรายการ เดี๋ยวรอบปกติเก็บให้อยู่ดี
-- ---------------------------------------------------------------------
create or replace function create_sack_order(
  p_branch text,
  p_qty    integer,
  p_unit   text default 'ชิ้น',
  p_note   text default null,
  p_hub    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id  uuid;
  v_ref text;
begin
  if my_role() not in ('admin', 'supervisor') then
    raise exception 'เฉพาะเจ้าของระบบและแอดมินเท่านั้นที่ตั้งรายการได้';
  end if;
  if coalesce(btrim(p_branch), '') = '' then
    raise exception 'ต้องใส่ชื่อสาขาที่ขอ';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'จำนวนต้องมากกว่าศูนย์';
  end if;
  if p_unit not in ('ชิ้น', 'กระสอบ') then
    raise exception 'หน่วยต้องเป็นชิ้นหรือกระสอบ';
  end if;

  v_ref := next_sack_ref();

  insert into sack_orders (ref_no, hub_code, qty, unit, branch, note, created_by)
  values (v_ref,
          coalesce(nullif(btrim(p_hub), ''), '21BPL'),
          p_qty, p_unit, btrim(p_branch),
          nullif(btrim(coalesce(p_note, '')), ''),
          auth.uid())
  returning id into v_id;

  begin
    perform push_tick();
  exception when others then
    raise notice 'ตั้งรายการแล้วแต่เตะแจ้งเตือนไม่สำเร็จ (%)', sqlerrm;
  end;

  return jsonb_build_object('id', v_id, 'ref_no', v_ref);
end $$;

grant execute on function create_sack_order(text, integer, text, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- ใครจะได้รับแจ้งเตือนบ้าง — ไว้ให้หน้าจอโชว์ก่อนกดตั้งรายการ
-- ---------------------------------------------------------------------
create or replace function sack_notify_targets()
returns table (full_name text, employee_code text, reason text, has_push boolean)
language sql stable security definer set search_path = public as $$
  with cfg as (
    select coalesce(
      nullif(btrim((select value #>> '{}' from app_settings
                     where key = 'sack_notify_sub_dept')), ''),
      'SPADMIN') as tag
  )
  select p.full_name, p.employee_code,
         case
           when p.role = 'admin' then 'เจ้าของระบบ'
           when p.role = 'supervisor' then 'แอดมิน'
           else 'ทีมซัพพอร์ต (' || coalesce(p.sub_dept, '') || ')'
         end,
         exists (select 1 from push_subscriptions s where s.user_id = p.id)
    from profiles p, cfg
   where p.is_active
     and (p.role in ('admin', 'supervisor')
          or upper(btrim(coalesce(p.sub_dept, ''))) = upper(cfg.tag))
   order by p.role desc, p.full_name;
$$;

grant execute on function sack_notify_targets() to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname = 'push_sack_jobs')       as ฟังก์ชันแจ้งเตือน,
  (select value #>> '{}' from app_settings
    where key = 'sack_notify_sub_dept')                                 as แผนกย่อยที่ตั้งไว้,
  (select count(*) from sack_notify_targets())                          as คนที่จะได้รับตอนนี้,
  (select count(*) from sack_notify_targets() where has_push)           as ในนั้นเปิดแจ้งเตือนแล้ว,
  jsonb_array_length(push_sack_jobs())                                  as งานรอส่งตอนนี้;
