-- =====================================================================
-- BPL SUPPLY — นาฬิกาเดินทุก 5 นาที คอยดูว่าใครต้องเตือนแล้ว
-- รันต่อจาก 024 · ปลอดภัยที่จะรันซ้ำ
--
-- ใช้ pg_cron เดินเวลา + pg_net ยิงไปที่ Edge Function push-send
-- ทั้งสองตัวมีอยู่แล้วใน Supabase ไม่มีค่าใช้จ่ายเพิ่ม
--
-- ค่าที่เป็นความลับเก็บในตารางที่ไม่มีใครอ่านได้ผ่านหน้าเว็บ
-- app_settings ใช้ไม่ได้เพราะพนักงานทุกคนอ่านตารางนั้นได้
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── ค่าลับฝั่งเซิร์ฟเวอร์ ──────────────────────────────────────────────
create table if not exists private_settings (
  key   text primary key,
  value text not null
);

alter table private_settings enable row level security;
-- ตั้งใจไม่ใส่ policy ใด ๆ · ไม่มีใครอ่านผ่าน PostgREST ได้เลย
-- อ่านได้เฉพาะฟังก์ชัน security definer ข้างล่างนี้

revoke all on private_settings from anon, authenticated;

-- ---------------------------------------------------------------------
-- งานที่นาฬิกาเรียก
-- ถ้ายังไม่ได้ตั้งค่า url หรือ key จะเงียบ ๆ ไม่ทำอะไร ไม่ error รัว ๆ
-- ---------------------------------------------------------------------
create or replace function push_tick()
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text;
  v_key text;
begin
  select value into v_url from private_settings where key = 'push_url';
  select value into v_key from private_settings where key = 'push_cron_secret';
  if v_url is null or v_key is null then
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', v_key),
    body    := jsonb_build_object('action', 'run'),
    timeout_milliseconds := 20000
  );
end $$;

-- ---------------------------------------------------------------------
-- ตั้งนาฬิกา · ทุก 5 นาที
-- ---------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('bpl-push-tick');
exception when others then null;
end $$;

select cron.schedule('bpl-push-tick', '*/5 * * * *', $$select push_tick()$$);

-- =====================================================================
-- เหลืออีกขั้นเดียว — ใส่ค่าสองตัวนี้ แล้วแจ้งเตือนจะเริ่มทำงานทันที
-- ดูค่าที่ต้องใส่ได้ในไฟล์ "แจ้งเตือน-ตั้งค่า.txt"
--
--   insert into private_settings (key, value) values
--     ('push_url',          'https://<project>.supabase.co/functions/v1/push-send'),
--     ('push_cron_secret',  '<CRON_SECRET ตัวเดียวกับที่ใส่ใน Edge Function>')
--   on conflict (key) do update set value = excluded.value;
-- =====================================================================
