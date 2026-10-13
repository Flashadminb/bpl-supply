-- ---------------------------------------------------------------------
-- 167 · เปิดให้หน้างานดูของค้างส่งออกได้
--
-- เจ้าของระบบสั่งให้หน้างานเห็นได้ · เปิดเฉพาะ "ดู" เท่านั้น
-- อัปไฟล์ ถอนรอบ และตั้งโซน D0 ยังเป็นของผู้ดูแลระบบเหมือนเดิม
-- เพราะอัปทับคือลบของเดิมทิ้งทั้งกระดาน ถ้าใครก็กดได้ วันหนึ่งจะมีคนกดพลาด
-- แล้วทั้งฮับจะมองกระดานเปล่าโดยไม่มีใครรู้ว่าเกิดอะไรขึ้น
--
-- ของในกระดานนี้เป็นชื่อสาขากับจำนวนชิ้น ไม่มีข้อมูลส่วนบุคคลของใคร
-- การเปิดให้ดูจึงไม่ได้เพิ่มความเสี่ยงเรื่องข้อมูลเลย
--
-- ─────────────────────────────────────────────────────────────────
-- ห้ามแก้ที่ my_can_outbox() เด็ดขาด
--
-- ฟังก์ชันนั้นถูกใช้ร่วมกันสามระบบ · ของค้างส่งออก พัสดุค้างเกิน 24 ชม
-- และหน้าจับคู่ ซึ่งเจ้าของระบบสั่งไว้ชัดว่าหน้าจับคู่เปิดให้เฉพาะ
-- เจ้าของระบบกับผู้ดูแลระบบ · แก้ตัวฟังก์ชันทีเดียวคือเปิดหน้าจับคู่
-- ให้ทั้งฮับโดยไม่มีใครสั่ง และจะไม่มีอะไรฟ้องว่าเพิ่งเกิดขึ้น
--
-- จึงแก้ที่ตัวฟังก์ชันอ่านสองตัวเท่านั้น วิธีเดียวกับไฟล์ 160
-- ─────────────────────────────────────────────────────────────────
--
-- แก้ที่ตัวเงื่อนไขจุดเดียว ไม่ได้เขียนฟังก์ชันใหม่ทั้งก้อน
-- เพราะฟังก์ชันพวกนี้ถูกแก้มาหลายไฟล์แล้วคนละจุด
-- เขียนทับทั้งก้อนเมื่อไหร่ ของไฟล์ก่อน ๆ หายเงียบ ๆ โดยไม่มีอะไรฟ้อง
-- นับจำนวนจุดที่จะแก้ก่อนเสมอ เจอไม่ครบหนึ่งจุดก็ล้มทั้งไฟล์
-- ---------------------------------------------------------------------

do $mig$
declare v_name text; v_def text; v_n int;
begin
  foreach v_name in array array['hub_out_board', 'hub_out_latest'] loop
    select pg_get_functiondef(oid) into v_def from pg_proc where proname = v_name;
    if v_def is null then
      raise exception 'ไม่พบฟังก์ชัน %', v_name;
    end if;

    v_n := (length(v_def) - length(replace(v_def, 'my_can_outbox()', ''))) / 15;
    if v_n = 0 then
      raise notice '% เปิดให้ดูแล้ว', v_name;
    elsif v_n <> 1 then
      raise exception 'ใน % เจอด่าน % จุด ไม่ใช่จุดเดียว', v_name, v_n;
    else
      execute replace(v_def, 'my_can_outbox()', '(auth.uid() is not null)');
    end if;
  end loop;
end $mig$;


-- ---------------------------------------------------------------------
-- ตรวจผล
--   สองตัวแรกต้องเป็น 0 · เปิดให้ดูแล้ว
--   สามตัวหลังต้องเป็น 1 · ยังล็อกอยู่ตามเดิม
--   ตัวสุดท้ายต้องเป็น 1 · หน้าจับคู่ต้องไม่โดนเปิดตามไปด้วย
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc p where p.proname = 'hub_out_board'
     and pg_get_functiondef(p.oid) like '%my_can_outbox%')      as boardยังล็อกไหม,
  (select count(*) from pg_proc p where p.proname = 'hub_out_latest'
     and pg_get_functiondef(p.oid) like '%my_can_outbox%')      as latestยังล็อกไหม,
  (select count(*) from pg_proc p where p.proname = 'hub_out_import'
     and pg_get_functiondef(p.oid) like '%my_can_outbox%')      as อัปไฟล์ล็อกอยู่,
  (select count(*) from pg_proc p where p.proname = 'hub_out_undo'
     and pg_get_functiondef(p.oid) like '%my_can_outbox%')      as ถอนรอบล็อกอยู่,
  (select count(*) from pg_proc p where p.proname = 'hub_out_zone_set'
     and pg_get_functiondef(p.oid) like '%my_can_outbox%')      as ตั้งโซนล็อกอยู่,
  (select count(*) from pg_proc p where p.proname = 'p48_search'
     and pg_get_functiondef(p.oid) like '%my_can_outbox%')      as จับคู่ยังล็อกอยู่;
