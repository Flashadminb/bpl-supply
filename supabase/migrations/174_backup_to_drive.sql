-- ---------------------------------------------------------------------
-- 174 · สำรองฐานข้อมูลขึ้น Google Drive ทุกสัปดาห์
--
-- ─────────────────────────────────────────────────────────────────
-- ทำไมถึงต้องมี
--
-- ระบบนี้มี 87 ตาราง แต่มีแค่สิบตัวที่ส่งประวัติขึ้นชีต และนั่นคือประวัติธุรกรรม
-- ส่วนของที่อยู่ที่เดียวในโลกและไม่มีสำเนาที่ไหนเลยคือของที่สำคัญที่สุด
--   รายชื่อพนักงานกับสิทธิ์ · สต็อกคงเหลือ · ทะเบียนทรัพย์สิน
--   บัตรเบรคกับกลุ่มและเหตุผล · โซนสาขา · ค่าตั้ง SLA
--
-- Supabase แผนฟรีไม่มีการสำรองอัตโนมัติให้
-- แปลว่าคำสั่งลบผิดครั้งเดียว migration พลาดครั้งเดียว หรือบัญชีมีปัญหา
-- คือหายทั้งหมดโดยไม่มีทางได้คืน · รูปหลักฐานอยู่ไดรฟ์แล้ว เหลือฐานข้อมูลที่ยังเปลือย
-- ─────────────────────────────────────────────────────────────────
--
-- ไฟล์นี้เตรียมฝั่งฐานข้อมูลอย่างเดียว · ตัวที่อัปขึ้นไดรฟ์คือ Edge Function backup-db
-- แบ่งกันแบบนี้เพราะ SQL คุยกับ Google ไม่ได้ และ Deno อ่านตารางทั้งก้อนเองไม่ได้
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- ① รายชื่อตารางที่ต้องสำรอง
--
-- อ่านจากแคตตาล็อกแทนการไล่พิมพ์ชื่อ · ตารางใหม่ที่เพิ่มวันหลังจะถูกสำรองเอง
-- ไม่ต้องมีใครจำว่าต้องกลับมาแก้ไฟล์นี้ ซึ่งเป็นสิ่งที่ไม่มีใครจำได้จริง
--
-- ข้ามสามตารางที่เป็นร่องรอยการทำงานล้วน ๆ ไม่ใช่ของที่เป็นหลักฐาน
-- ทั้งสามตัวถูกล้างทิ้งเป็นรอบอยู่แล้วโดย nightly_cleanup()
-- สำรองไปก็ได้ของที่พรุ่งนี้ระบบจะลบเองอยู่ดี แต่กินพื้นที่กับเวลามากที่สุด
-- ---------------------------------------------------------------------
create or replace function backup_tables()
returns table (name text, est_rows bigint)
language sql
stable
security definer
set search_path = public
as $$
  select c.relname::text, greatest(c.reltuples::bigint, 0)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and c.relname not in ('sync_log', 'notification_log', 'db_size_log')
   order by c.relname
$$;

revoke all on function backup_tables() from public, anon, authenticated;
grant execute on function backup_tables() to service_role;


-- ---------------------------------------------------------------------
-- ② อ่านตารางหนึ่งออกมาเป็น JSON ทีละหน้า
--
-- ─────────────────────────────────────────────────────────────────
-- สองเรื่องที่ห้ามพลาดในฟังก์ชันนี้
--
-- หนึ่ง ชื่อตารางมาจากข้างนอก จึงต้องเทียบกับแคตตาล็อกก่อนเสมอ
-- แล้วค่อยต่อด้วย format %I · ถ้าต่อสตริงดิบ ๆ คือเปิดช่องให้สั่งอะไรก็ได้
-- ในฟังก์ชันที่เป็น security definer ซึ่งอ่านได้ทุกตารางโดยไม่ติด RLS
--
-- สอง ต้องมี order by ที่นิ่ง ไม่งั้น offset กับ limit จะข้ามแถวหรือได้แถวซ้ำ
-- ใช้ ctid เพราะเป็นตำแหน่งจริงบนดิสก์ มีทุกตารางโดยไม่ต้องมีคอลัมน์ไหนเป็นพิเศษ
-- และไม่ต้องเรียงใหม่ให้เสียเวลา · นิ่งพอตราบใดที่ไม่มีใครเขียนระหว่างอ่าน
-- ซึ่งคือเหตุผลที่งานนี้ตั้งไว้ตีสี่คืนวันอาทิตย์
-- ─────────────────────────────────────────────────────────────────
-- ---------------------------------------------------------------------
create or replace function backup_table(
  p_name   text,
  p_offset integer default 0,
  p_limit  integer default 2000
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v jsonb;
begin
  if not exists (
    select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relname = p_name
  ) then
    raise exception 'ไม่มีตารางชื่อนี้ใน public: %', p_name;
  end if;

  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb)
       from (select * from public.%I order by ctid offset $1 limit $2) t',
    p_name
  ) into v using p_offset, greatest(1, least(p_limit, 5000));

  return v;
end $$;

revoke all on function backup_table(text, integer, integer) from public, anon, authenticated;
grant execute on function backup_table(text, integer, integer) to service_role;


-- ---------------------------------------------------------------------
-- ③ ที่อยู่กับกุญแจของงานสำรอง
--
-- เก็บที่เดียวกับของนาฬิกาแจ้งเตือน เพราะเป็นเรื่องเดียวกันคือ
-- ค่าที่ cron ต้องใช้ตอนยิงไปหา Edge Function
--
-- กุญแจตั้งเป็นค่าสุ่มตอนรันครั้งแรก และจะไม่ถูกเขียนทับถ้ามีอยู่แล้ว
-- เพราะถ้าเขียนทับทุกครั้งที่รันไฟล์ซ้ำ ฝั่ง Edge Function จะตามไม่ทันแล้วงานหยุดเงียบ ๆ
-- ---------------------------------------------------------------------
insert into private_settings (key, value)
values (
  'backup_url',
  (select value from private_settings where key = 'push_url' limit 1)
)
on conflict (key) do nothing;

update private_settings
   set value = regexp_replace(value, '/[^/]+$', '/backup-db')
 where key = 'backup_url'
   and value like '%/functions/v1/%'
   and value not like '%/backup-db';

insert into private_settings (key, value)
values ('backup_cron_secret', encode(gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;


-- ---------------------------------------------------------------------
-- ④ ตัวที่นาฬิกาเรียก
--
-- ยืมรูปแบบมาจาก push_tick() ทั้งดุ้น รวมถึงบทเรียนที่แลกมาด้วยเวลาหลายวัน
-- ต้องแนบ Authorization ไปด้วย ไม่งั้นโดนประตูของ Supabase ปฏิเสธตั้งแต่หน้าประตู
-- ด้วย 401 โดยที่โค้ดเราไม่เคยถูกเรียกเลย และ cron ยังรายงานว่าสำเร็จ
-- เพราะ net.http_post เป็นแบบยิงแล้วไม่รอคำตอบ
-- ---------------------------------------------------------------------
create or replace function backup_tick()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_url  text;
  v_key  text;
  v_anon text;
begin
  select value into v_url  from private_settings where key = 'backup_url';
  select value into v_key  from private_settings where key = 'backup_cron_secret';
  select value into v_anon from private_settings where key = 'push_anon_key';

  if v_url is null or v_key is null or v_anon is null then
    raise notice 'backup_tick: ยังตั้งค่าไม่ครบ (url/secret/anon)';
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_anon,
      'x-cron-key',    v_key
    ),
    body    := jsonb_build_object('action', 'run'),
    /* ให้เวลาเยอะเพราะต้องอ่าน 84 ตารางแล้วอัปขึ้นไดรฟ์ทีละไฟล์
       ถ้าตั้งสั้นเกิน pg_net จะตัดสายทิ้งกลางคัน ได้สำรองที่ไม่ครบซึ่งแย่กว่าไม่มี */
    timeout_milliseconds := 300000
  );
end $fn$;

revoke all on function backup_tick() from public, anon, authenticated;
grant execute on function backup_tick() to service_role;


-- ---------------------------------------------------------------------
-- ⑤ ตั้งเวลา · ตีสี่คืนวันอาทิตย์ตามเวลาไทย = 21:00 UTC วันเสาร์
--
-- เลือกเวลานี้เพราะเป็นช่วงที่ไม่มีใครเขียนข้อมูล ซึ่งทำให้ ctid นิ่ง
-- และห่างจากงานล้างข้อมูลตีสามหนึ่งชั่วโมง จะได้ไม่ไปแย่ง CPU กัน
-- บทเรียนจากคืนวันที่ 13 ต.ค. ที่ CPU ตันเพราะงานหนักสองอย่างชนกัน
-- ---------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('bpl-weekly-backup');
exception when others then null;
end $$;

do $$
begin
  perform cron.schedule('bpl-weekly-backup', '0 21 * * 6', 'select backup_tick()');
  raise notice 'ตั้งเวลาสำรองข้อมูลทุกคืนวันอาทิตย์เรียบร้อย';
exception when others then
  raise notice 'ตั้ง pg_cron ไม่ได้ (%) — เรียก select backup_tick(); เองได้', sqlerrm;
end $$;


-- ---------------------------------------------------------------------
-- ⑥ ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from backup_tables())                                   as ตารางที่จะสำรอง,
  (select jsonb_array_length(backup_table('profiles', 0, 1)))              as อ่านตัวอย่างได้,
  (select value is not null from private_settings where key = 'backup_url')     as มีที่อยู่แล้ว,
  (select value is not null from private_settings where key = 'backup_cron_secret') as มีกุญแจแล้ว,
  (select schedule from cron.job where jobname = 'bpl-weekly-backup')      as ตั้งเวลาไว้ว่า;
