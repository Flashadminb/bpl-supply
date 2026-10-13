-- ---------------------------------------------------------------------
-- 162 · ปิดบัตรเบรคด้วยเหตุผล "อื่น ๆ" ได้
--
-- อาการ · หลังบ้านกดยกเลิกใบค้าง เลือก "อื่น ๆ" พิมพ์เหตุผลแล้วกดส่ง
--         เด้ง "เกิดข้อผิดพลาด เหตุผลไม่ถูกต้อง"
--
-- สาเหตุ · ตอนเพิ่มตัวเลือก "อื่น ๆ" ใส่ไว้แค่ฝั่งหน้าจอ (BREAK_CLOSE_REASONS)
--         แต่รายการที่ break_close ยอมรับไม่ได้ถูกเพิ่มตาม
--         เป็นของที่หลุดตอนเพิ่มฟีเจอร์ ไม่ใช่เรื่องสิทธิ์หรือข้อมูล
--
-- ข้อความที่พิมพ์ถูกเก็บอยู่แล้วที่ problem_note ไม่ต้องแก้อะไรเพิ่ม
-- และหน้าจอบังคับให้พิมพ์ก่อนอยู่แล้วเมื่อเลือก "อื่น ๆ" (ปุ่มส่งยังกดไม่ได้ถ้าว่าง)
--
-- แก้ที่รายการเดียว ไม่ได้เขียนฟังก์ชันใหม่ทั้งก้อน
-- นับจำนวนจุดก่อนเสมอ เจอไม่ครบหนึ่งจุดก็ล้มทั้งไฟล์ ไม่แก้ครึ่ง ๆ
-- ---------------------------------------------------------------------

do $mig$
declare v_src text; v_q text; v_n int;
begin
  select pg_get_functiondef(oid) into v_src from pg_proc where proname = 'break_close';
  if v_src is null then
    raise exception 'ไม่พบฟังก์ชัน break_close';
  end if;

  if position('''other''' in v_src) > 0 then
    raise notice 'break_close รับ other อยู่แล้ว';
    return;
  end if;

  v_q := '(''no_scan_in'', ''no_scan_out'', ''wrong_card'', ''cancel'')';
  v_n := (length(v_src) - length(replace(v_src, v_q, ''))) / length(v_q);
  if v_n <> 1 then
    raise exception 'หารายการเหตุผลใน break_close ไม่เจอ หรือเจอซ้ำ (%)', v_n;
  end if;

  v_src := replace(v_src, v_q,
    '(''no_scan_in'', ''no_scan_out'', ''wrong_card'', ''cancel'', ''other'')');

  execute v_src;
end $mig$;


-- ---------------------------------------------------------------------
-- ตรวจผล · ต้องเป็น 1 ทั้งคู่
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc p where p.proname = 'break_close'
     and pg_get_functiondef(p.oid) like '%''other''%')     as รับotherแล้ว,
  (select count(*) from pg_proc p where p.proname = 'break_close'
     and pg_get_functiondef(p.oid) like '%no_scan_in%')    as ของเดิมยังอยู่;
