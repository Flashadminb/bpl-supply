-- ---------------------------------------------------------------------
-- 176 · ส่งข้อมูลขึ้นชีตเองทุกคืน
--
-- ─────────────────────────────────────────────────────────────────
-- ทำไมต้องมี
--
-- การส่งขึ้นชีตเป็นการกดเองมาตลอดตั้งแต่วันแรก ไม่เคยมีตัวตั้งเวลา
-- ผลคือวันที่ 14 ต.ค. พบว่าส่งครั้งสุดท้ายคือ 12 ต.ค.
-- และมีบัตรเบรค 1,363 ใบจาก 3,380 ใบ ที่ไม่เคยมีสำเนาอยู่นอกฐานข้อมูลเลย
--
-- เรื่องนี้สำคัญกว่าที่เห็น เพราะแผนลดขนาดฐานข้อมูลทั้งแผน
-- ยืนอยู่บนกติกาเดียวคือ ลบได้เฉพาะแถวที่ขึ้นชีตแล้ว
-- ถ้าการส่งไม่สม่ำเสมอ กติกานั้นจะทำให้ลบอะไรไม่ได้เลย
-- ─────────────────────────────────────────────────────────────────
--
-- แยกเป็นห้ารอบห่างกันรอบละสิบนาที ไม่ยิงทีเดียวพร้อมกัน
-- เพราะ scope 'all' ไม่ครอบคลุมสี่งานที่เหลือ และการยิงพร้อมกันห้าก้อน
-- คือการสร้างภาระก้อนใหญ่ก้อนเดียว ซึ่งเป็นสิ่งที่พยายามเลี่ยงอยู่
-- ---------------------------------------------------------------------

create or replace function export_tick(p_scope text default 'all')
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
    raise notice 'export_tick: ยังตั้งค่าไม่ครบ';
    return;
  end if;

  /* ที่อยู่ของงานสำรองกับงานส่งชีตอยู่โดเมนเดียวกัน ต่างกันแค่ชื่อฟังก์ชันท้าย URL
     หยิบของที่มีอยู่แล้วมาดัดแทนการเก็บค่าใหม่อีกตัว
     ค่าที่ต้องตั้งเองน้อยลงหนึ่งตัว คือโอกาสตั้งผิดน้อยลงหนึ่งจุด */
  v_url := regexp_replace(v_url, '/[^/]+$', '/export-sheet');

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      -- ขาดตัวนี้คือโดนประตูของ Supabase ปฏิเสธตั้งแต่หน้าประตู โค้ดไม่เคยถูกเรียก
      'Authorization', 'Bearer ' || v_anon,
      -- ตัวนี้คือด่านจริงที่ฝั่ง Edge Function ตรวจเอง
      'x-cron-key',    v_key
    ),
    body    := jsonb_build_object('scope', p_scope),
    timeout_milliseconds := 280000
  );
end $fn$;

revoke all on function export_tick(text) from public, anon, authenticated;
grant execute on function export_tick(text) to service_role;

comment on function export_tick(text) is
  'ยิงให้ export-sheet ส่งข้อมูลขึ้นชีตตาม scope ที่ให้ · เรียกโดย pg_cron ทุกคืน';


-- ---------------------------------------------------------------------
-- ตั้งเวลา · ตีสามสิบถึงตีสามห้าสิบตามเวลาไทย = 20:10-20:50 UTC
--
-- ห่างจากงานล้างข้อมูลตอน 20:00 UTC สิบนาที และห่างกันเองรอบละสิบนาที
-- ไม่มีรอบไหนทับกัน และแต่ละรอบเป็นภาระสั้น ๆ ไม่ใช่ก้อนใหญ่ก้อนเดียว
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select unnest(array[
    'bpl-export-all', 'bpl-export-break', 'bpl-export-truck',
    'bpl-export-wait', 'bpl-export-osscan'
  ]) as nm
  loop
    begin perform cron.unschedule(r.nm); exception when others then null; end;
  end loop;
end $$;

do $$
begin
  perform cron.schedule('bpl-export-all',    '10 20 * * *', 'select export_tick(''all'')');
  perform cron.schedule('bpl-export-break',  '20 20 * * *', 'select export_tick(''break'')');
  perform cron.schedule('bpl-export-truck',  '30 20 * * *', 'select export_tick(''truck'')');
  perform cron.schedule('bpl-export-wait',   '40 20 * * *', 'select export_tick(''wait'')');
  perform cron.schedule('bpl-export-osscan', '50 20 * * *', 'select export_tick(''osscan'')');
exception when others then
  raise notice 'ตั้ง pg_cron ไม่ได้ (%)', sqlerrm;
end $$;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select jobname, schedule, active from cron.job order by jobname;
