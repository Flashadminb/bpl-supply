-- =====================================================================
-- BPL SUPPLY — ล้างใบเสร็จแจ้งเตือนที่หมดอายุแล้ว
-- รันต่อจาก 123 · ปลอดภัยที่จะรันซ้ำ
--
-- notification_log ไม่ใช่ตัวแจ้งเตือน ตัวแจ้งเตือนส่งไปแล้วจบไปตั้งแต่ตอนนั้น
-- ที่ค้างอยู่คือใบเสร็จว่า "เรื่องนี้ ส่งให้คนนี้ ไปแล้ว" ซึ่งมีไว้กันเตือนซ้ำ
-- เพราะนาฬิกาเดินทุกนาที ไม่จดไว้คนจะโดนเตือนเรื่องเดิมซ้ำทุกนาที
--
-- แต่ใบเสร็จไม่เคยถูกลบเลยตั้งแต่ 024 ทั้งที่หมดประโยชน์ไปนานแล้ว
-- หน้าต่างกันซ้ำที่ยาวที่สุดในระบบคือหนึ่งวัน (meeting_new)
-- ใบเสร็จอายุเกิน 90 วันจึงไม่มีทางถูกใช้อีก เหลือไว้เป็นน้ำหนักเปล่า ๆ
--
-- เรื่องขนาดยังไม่ใช่ปัญหา 616 kB จากเพดาน 500 MB โตราว 8 MB ต่อปี
-- ที่ทำเพราะตารางนี้ใหญ่สุดในฐานข้อมูลและถูกค้นทุกนาที
-- ปล่อยไว้หลายปีคำค้นกันซ้ำจะเริ่มถ่วงนาฬิกา
-- =====================================================================

create or replace function prune_notification_log(p_days integer default 90)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  delete from notification_log where sent_at < now() - make_interval(days => p_days);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

comment on function prune_notification_log(integer) is
  'ลบใบเสร็จแจ้งเตือนที่เก่ากว่า N วัน · ไม่กระทบการแจ้งเตือนที่ส่งไปแล้ว';

revoke all on function prune_notification_log(integer) from public;
grant execute on function prune_notification_log(integer) to service_role;


-- ---------------------------------------------------------------------
-- ใส่เข้างานกวาดกลางคืนที่มีอยู่แล้ว · ตีสามเวลาไทย
--
-- เขียนทับทั้งตัวเพราะ plpgsql แก้ทีละบรรทัดไม่ได้
-- สองบรรทัดเดิมยกมาครบ ที่เพิ่มคือบรรทัดเดียว
-- ---------------------------------------------------------------------
create or replace function nightly_cleanup()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sync integer;
  v_req  integer;
  v_note integer;
begin
  v_sync := prune_sync_log(60);
  v_req  := prune_old_requisitions(400);
  v_note := prune_notification_log(90);
  return jsonb_build_object('sync_log', v_sync, 'requisitions', v_req,
                            'notification_log', v_note);
end $$;

grant execute on function nightly_cleanup() to service_role;


-- ---------------------------------------------------------------------
-- ล้างรอบแรกเลย ไม่ต้องรอถึงตีสาม
-- ---------------------------------------------------------------------
select
  (select count(*) from notification_log)                                as ใบเสร็จก่อนล้าง,
  prune_notification_log(90)                                             as ลบไปกี่ใบ,
  (select count(*) from notification_log)                                as เหลือหลังล้าง,
  (select pg_size_pretty(pg_total_relation_size('notification_log')))    as ขนาดตาราง,
  (select count(*) from pg_proc where proname = 'nightly_cleanup'
     and prosrc like '%prune_notification_log%')                         as ต่อเข้างานกวาดแล้ว;
