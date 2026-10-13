-- ---------------------------------------------------------------------
-- 169 · เปิดหน้าจับคู่ให้หน้างานดูและอัปไฟล์ได้
--
-- ตอนสร้างหน้านี้ เจ้าของระบบสั่งว่าเปิดเฉพาะตัวเองกับผู้ดูแลระบบ
-- รอบนี้สั่งเปิดให้หน้างานทั้งดูและอัป แบบเดียวกับของค้างส่งออกในไฟล์ 168
--
-- ─────────────────────────────────────────────────────────────────
-- ห้ามแก้ที่ my_can_outbox() เด็ดขาด เหมือนเดิม
--
-- ฟังก์ชันนั้นยังเป็นด่านของการตั้งโซน D0 กับประวัติการอัปของค้างส่งออก
-- ซึ่งยังต้องเป็นของผู้ดูแลระบบ · แก้ตัวฟังก์ชันทีเดียวคือเปิดของพวกนั้นตามไปด้วย
-- โดยไม่มีใครสั่งและไม่มีอะไรฟ้อง
-- ─────────────────────────────────────────────────────────────────
--
-- สิ่งที่ยังล็อก
--   p48_run_list  ประวัติว่าใครอัปรอบไหน · เครื่องมือตรวจสอบของเจ้าของระบบ
--   p48_drop_run  ลบรอบไหนก็ได้ · ต่างจาก p48_undo ที่ถอยทีละขั้น
--
-- ที่เปิด p48_prune ด้วย เพราะหน้าเว็บเรียกต่อท้ายทุกการอัปเพื่อเก็บกวาดรอบเก่า
-- ถ้าไม่เปิด หน้างานจะอัปได้แต่ของเก่าไม่ถูกเก็บ แล้วพื้นที่จะบวมขึ้นเรื่อย ๆ
-- โดยไม่มีใครเห็น · ตัวมันเองลบได้เฉพาะรอบที่พ้นสองรอบล่าสุดไปแล้วอยู่ดี
--
-- p48_undo เปิดด้วย เพราะอัปได้แต่ถอนไม่ได้คือคนที่อัปผิดต้องรอแอดมินทั้งกะ
-- ตัวมันถอยได้ทีละขั้นและไม่ยอมถอยถ้าเหลือรอบเดียว จึงล้างข้อมูลทิ้งไม่ได้
-- ---------------------------------------------------------------------

do $mig$
declare
  v_name text;
  v_def  text;
  v_n    int;
  v_done int := 0;
begin
  foreach v_name in array array[
    'p48_begin', 'p48_put_parcels', 'p48_put_products', 'p48_end',
    'p48_prune', 'p48_undo',
    'p48_stats', 'p48_facets', 'p48_search', 'p48_one'
  ] loop
    select pg_get_functiondef(oid) into v_def from pg_proc where proname = v_name;
    if v_def is null then
      raise exception 'ไม่พบฟังก์ชัน %', v_name;
    end if;

    v_n := (length(v_def) - length(replace(v_def, 'my_can_outbox()', ''))) / 15;
    if v_n = 0 then
      raise notice '% เปิดแล้ว', v_name;
    elsif v_n <> 1 then
      raise exception 'ใน % เจอด่าน % จุด ไม่ใช่จุดเดียว', v_name, v_n;
    else
      execute replace(v_def, 'my_can_outbox()', '(auth.uid() is not null)');
      v_done := v_done + 1;
    end if;
  end loop;

  raise notice 'เปิดไป % ฟังก์ชัน', v_done;
end $mig$;


-- ---------------------------------------------------------------------
-- ตรวจผล
--   สิบตัวแรกต้องเป็น 0 ทั้งหมด · เปิดแล้ว
--   สองตัวหลังต้องเป็น 1 · ยังล็อกไว้ตามตั้งใจ
--   ของค้างส่งออกกับโซน D0 ต้องไม่ขยับ
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc p
    where p.proname in ('p48_begin','p48_put_parcels','p48_put_products','p48_end',
                        'p48_prune','p48_undo','p48_stats','p48_facets','p48_search','p48_one')
      and pg_get_functiondef(p.oid) like '%my_can_outbox%')      as จับคู่ที่ยังล็อกค้าง,
  (select count(*) from pg_proc p where p.proname = 'p48_run_list'
     and pg_get_functiondef(p.oid) like '%my_can_outbox%')       as ประวัติจับคู่ล็อกอยู่,
  (select count(*) from pg_proc p where p.proname = 'p48_drop_run'
     and pg_get_functiondef(p.oid) like '%my_can_outbox%')       as ลบรอบล็อกอยู่,
  (select count(*) from pg_proc p where p.proname = 'hub_out_runs'
     and pg_get_functiondef(p.oid) like '%my_can_outbox%')       as ประวัติค้างส่งออกล็อกอยู่,
  (select count(*) from pg_proc p where p.proname = 'hub_out_zone_set'
     and pg_get_functiondef(p.oid) like '%my_can_outbox%')       as ตั้งโซนล็อกอยู่;
