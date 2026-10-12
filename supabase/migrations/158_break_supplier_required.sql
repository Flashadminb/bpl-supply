-- ---------------------------------------------------------------------
-- 158 · บังคับชื่อซัพที่ฝั่งฐานข้อมูล
--
-- ⚠ ห้ามรันไฟล์นี้ก่อนที่แอพตัวใหม่จะขึ้นครบแล้ว
--
-- เหตุผล · PWA ตัวเก่าค้างในเครื่องคนได้อีกหลายชั่วโมงหลัง deploy
-- แอพตัวเก่าไม่รู้จักช่องซัพ จึงส่งมาเป็น null เสมอ
-- ถ้ารันไฟล์นี้ตอนนั้น หัวหน้าที่ยังไม่ได้อัปเดตจะปล่อยบัตรไม่ได้เลยทั้งกะ
-- ทั้งที่เขาไม่ได้ทำอะไรผิด และเขาแก้เองไม่ได้ด้วยถ้าไม่มีใครบอกให้รีเฟรช
--
-- วิธีเช็กว่าพร้อมรันหรือยัง — ดูว่าใบที่ปล่อยในชั่วโมงที่ผ่านมามีซัพครบทุกใบไหม
--
--   select count(*) filter (where supplier is null) as ยังไม่มีซัพ,
--          count(*)                                  as ใบทั้งหมด
--     from break_passes
--    where issued_at > now() - interval '2 hours';
--
-- ถ้า "ยังไม่มีซัพ" เป็น 0 แปลว่าทุกคนใช้แอพตัวใหม่แล้ว รันไฟล์นี้ได้
-- ---------------------------------------------------------------------

do $mig$
declare v_src text;
begin
  select pg_get_functiondef(oid) into v_src
    from pg_proc where proname = 'break_issue';
  if v_src is null then
    raise exception 'ยังไม่มีฟังก์ชัน break_issue';
  end if;

  if position('ต้องเลือกชื่อซัพ' in v_src) > 0 then
    raise notice 'break_issue บังคับซัพอยู่แล้ว';
    return;
  end if;

  if (length(v_src) - length(replace(v_src, '  if v_supc <> '''' then', ''))) = 0 then
    raise exception 'หาจุดตรวจซัพใน break_issue ไม่เจอ · ไฟล์ 156 ลงครบหรือยัง';
  end if;

  v_src := replace(
    v_src,
    '  if v_supc <> '''' then',
    '  if v_supc = '''' then' || chr(10) ||
    '    raise exception ''ต้องเลือกชื่อซัพก่อนปล่อยบัตร · ถ้าไม่เห็นปุ่มซัพ ให้ปิดแอพแล้วเปิดใหม่'';' || chr(10) ||
    '  end if;' || chr(10) ||
    '  if v_supc <> '''' then'
  );
  execute v_src;
end $mig$;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc p where p.proname = 'break_issue'
     and pg_get_functiondef(p.oid) like '%ต้องเลือกชื่อซัพ%')             as บังคับแล้ว,
  (select count(*) from break_passes
    where issued_at > now() - interval '2 hours' and supplier is null)   as ใบ2ชมที่ยังไม่มีซัพ,
  (select count(*) from break_passes
    where issued_at > now() - interval '2 hours')                        as ใบ2ชมทั้งหมด;
