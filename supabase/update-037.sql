-- =====================================================================
-- BPL SUPPLY — แก้นาฬิกาแจ้งเตือนที่ยิงไม่ถึงปลายทาง
-- รันต่อจาก 036 · ปลอดภัยที่จะรันซ้ำ
--
-- อาการ: cron เดินทุก 5 นาทีและรายงานว่าสำเร็จ แต่ไม่มีแจ้งเตือนออกเลย
-- สาเหตุ: คำขอที่ยิงออกไปมีแต่ x-cron-key ไม่มี Authorization
--         ประตูของ Supabase ปฏิเสธตั้งแต่หน้าประตูด้วย
--           401 UNAUTHORIZED_NO_AUTH_HEADER
--         โค้ดของเราไม่เคยถูกเรียกเลยสักครั้ง
--
-- ที่มองไม่เห็นมานาน เพราะ net.http_post เป็นแบบยิงแล้วไม่รอคำตอบ
-- cron จึงได้ผลว่า "สำเร็จ" เสมอ ไม่ว่าปลายทางจะตอบอะไรกลับมา
-- ต้องไปเปิดดูที่ net._http_response ถึงจะเห็นว่าโดน 401
--
-- แก้โดยแนบ publishable key ไปด้วย (คีย์ตัวนี้อยู่ในหน้าเว็บอยู่แล้ว ไม่ใช่ความลับ)
-- ส่วน x-cron-key ยังเป็นตัวกันคนนอกเหมือนเดิม
-- =====================================================================

-- เก็บคีย์ไว้ที่เดียวกับค่าอื่น ๆ ของนาฬิกา
insert into private_settings (key, value)
values ('push_anon_key', 'sb_publishable_wWWyZ7qFBu6SR5gGLFbcCw_RCsxvgTk')
on conflict (key) do update set value = excluded.value;

create or replace function push_tick()
returns void
language plpgsql security definer set search_path = public, extensions as $fn$
declare
  v_url  text;
  v_key  text;
  v_anon text;
begin
  select value into v_url  from private_settings where key = 'push_url';
  select value into v_key  from private_settings where key = 'push_cron_secret';
  select value into v_anon from private_settings where key = 'push_anon_key';

  if v_url is null or v_key is null or v_anon is null then
    raise notice 'push_tick: ยังตั้งค่าไม่ครบ (url/secret/anon)';
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      -- ต้องมีตัวนี้ ไม่งั้นไม่ผ่านประตูของ Supabase
      'Authorization', 'Bearer ' || v_anon,
      -- ตัวนี้คือด่านจริงที่โค้ดเราตรวจเอง
      'x-cron-key',    v_key
    ),
    body    := jsonb_build_object('action', 'run'),
    timeout_milliseconds := 20000
  );
end $fn$;

grant execute on function push_tick() to service_role;


-- ---------------------------------------------------------------------
-- ดูสุขภาพนาฬิกาและการยิงล่าสุด — ไว้ตรวจเองทีหลัง
--   select * from cron_health();
--   select * from push_health();
-- ---------------------------------------------------------------------
create or replace function cron_health()
returns table (
  jobname     text,
  schedule    text,
  active      boolean,
  command     text,
  last_status text,
  last_msg    text,
  last_at     timestamptz
)
language sql stable security definer set search_path = public, cron as $fn$
  select j.jobname::text, j.schedule::text, j.active, j.command::text,
         d.status::text, d.return_message::text, d.start_time
  from cron.job j
  left join lateral (
    select r.status, r.return_message, r.start_time
    from cron.job_run_details r
    where r.jobid = j.jobid
    order by r.start_time desc
    limit 1
  ) d on true
  where my_role() = 'admin';
$fn$;

grant execute on function cron_health() to authenticated;


create or replace function push_health()
returns table (
  push_url        text,
  has_secret      boolean,
  last_http_at    timestamptz,
  last_http_code  integer,
  last_http_body  text
)
language sql stable security definer set search_path = public, net, extensions as $fn$
  select
    (select value from private_settings where key = 'push_url'),
    (select value is not null from private_settings where key = 'push_cron_secret'),
    r.created,
    r.status_code,
    left(coalesce(r.content, r.error_msg, ''), 300)
  from (
    select created, status_code, content, error_msg
    from net._http_response
    order by created desc
    limit 1
  ) r
  where my_role() = 'admin';
$fn$;

grant execute on function push_health() to authenticated;


-- ยิงทันทีหนึ่งรอบ ไม่ต้องรอนาฬิกา
select push_tick();
