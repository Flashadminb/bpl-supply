-- ---------------------------------------------------------------------
-- 160 · เปิดให้หน้างานดูพัสดุค้างเกิน 24 ชม ได้
--
-- เจ้าของระบบสั่งให้หน้างานเห็นได้ · เปิดเฉพาะ "ดู" เท่านั้น
-- การอัปไฟล์กับถอนรอบยังเป็นของผู้ดูแลระบบเหมือนเดิม
-- เพราะอัปทับคือลบของเดิมทิ้งทั้งกระดาน ถ้าใครก็กดได้ วันหนึ่งจะมีคนกดพลาด
-- แล้วทั้งฮับจะมองกระดานเปล่าโดยไม่มีใครรู้ว่าเกิดอะไรขึ้น
--
-- ของในกระดานนี้เป็นเลขพัสดุกับชื่อสาขา ไม่มีข้อมูลส่วนบุคคลของใคร
-- การเปิดให้ดูจึงไม่ได้เพิ่มความเสี่ยงเรื่องข้อมูลเลย
--
-- แก้ที่ตัวเงื่อนไขจุดเดียว ไม่ได้เขียนฟังก์ชันใหม่ทั้งก้อน
-- เพราะ 147 (ซ่อนสาขา) กับ 155 (ประเภทลูกค้า) แก้ parcel24_board ไว้แล้วคนละจุด
-- เขียนทับทั้งก้อนเมื่อไหร่ ของสองไฟล์นั้นหายเงียบ ๆ โดยไม่มีอะไรฟ้อง
-- นับจำนวนจุดที่จะแก้ก่อนเสมอ เจอไม่ครบหนึ่งจุดก็ล้มทั้งไฟล์
-- ---------------------------------------------------------------------

do $mig$
declare v_name text; v_def text; v_n int;
begin
  foreach v_name in array array['parcel24_board', 'parcel24_runs'] loop
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
-- ตรวจผล · สองตัวแรกต้องเป็น 0 สองตัวหลังต้องเป็น 1
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc p where p.proname = 'parcel24_board'
     and pg_get_functiondef(p.oid) like '%my_can_outbox%')   as boardยังล็อกไหม,
  (select count(*) from pg_proc p where p.proname = 'parcel24_runs'
     and pg_get_functiondef(p.oid) like '%my_can_outbox%')   as runsยังล็อกไหม,
  (select count(*) from pg_proc p where p.proname = 'parcel24_import'
     and pg_get_functiondef(p.oid) like '%my_can_outbox%')   as อัปไฟล์ยังล็อก,
  (select count(*) from pg_proc p where p.proname = 'parcel24_undo'
     and pg_get_functiondef(p.oid) like '%my_can_outbox%')   as ถอนรอบยังล็อก,
  (select count(*) from pg_proc p where p.proname = 'parcel24_board'
     and pg_get_functiondef(p.oid) like '%hidden_count%')    as ของ147ยังอยู่,
  (select count(*) from pg_proc p where p.proname = 'parcel24_board'
     and pg_get_functiondef(p.oid) like '%cust_type%')       as ของ155ยังอยู่;
