-- ---------------------------------------------------------------------
-- 161 · เก็บเลขถุงแบ๊กกิ้งของพัสดุค้างเกิน 24 ชม
--
-- วัดจากไฟล์จริงวันที่ 13 ต.ค. 2569
--   อยู่ในถุง 2,354 จาก 6,460 ชิ้น (36%) · ที่เหลือไม่ได้อยู่ในถุง
--   มี 1,916 ถุง · 1,767 ถุงมีของค้างชิ้นเดียว · 149 ถุงมีตั้งแต่สองชิ้นขึ้นไป
--   ถุงใหญ่สุดมี 45 ชิ้น
--
-- เก็บเป็นข้อความตามที่ไฟล์ให้มา ไม่ได้ทำตารางถุงแยก
-- เพราะถุงไม่ใช่ของที่ระบบนี้ดูแล เป็นแค่เลขอ้างอิงจากระบบต้นทาง
-- และของเก่าที่อัปไปแล้วจะไม่มีเลขถุงจนกว่าจะอัปไฟล์รอบใหม่ ซึ่งไม่พังอะไร
--
-- แก้แบบ patch ไม่ได้เขียนฟังก์ชันใหม่ทั้งก้อน
-- เพราะ 147 (ซ่อนสาขา) 155 (ประเภทลูกค้า) 160 (เปิดให้หน้างานดู)
-- แก้สองฟังก์ชันนี้ไว้คนละจุด เขียนทับคือของสามไฟล์นั้นหายเงียบ ๆ
-- ---------------------------------------------------------------------

alter table parcel24_rows add column if not exists bag_no text;

comment on column parcel24_rows.bag_no is
  'เลขถุงแบ๊กกิ้งจากไฟล์ต้นทาง · ว่าง = ชิ้นนี้ไม่ได้อยู่ในถุง';

create index if not exists parcel24_rows_bag
  on parcel24_rows (snapshot_id, bag_no) where bag_no is not null;


do $mig$
declare v_src text; v_q text; v_n int;
begin
  ----------------------------------------------------------------- import
  select pg_get_functiondef(oid) into v_src from pg_proc where proname = 'parcel24_import';
  if position('bag_no' in v_src) > 0 then
    raise notice 'import มี bag_no แล้ว';
  else
    v_q := ', actor, province, cust_type)';
    v_n := (length(v_src) - length(replace(v_src, v_q, ''))) / length(v_q);
    if v_n <> 1 then raise exception 'หารายชื่อคอลัมน์ไม่เจอ (%)', v_n; end if;
    v_src := replace(v_src, v_q, ', actor, province, cust_type, bag_no)');

    v_q := 'nullif(x->>''cust_type'', '''')';
    v_n := (length(v_src) - length(replace(v_src, v_q, ''))) / length(v_q);
    if v_n <> 1 then raise exception 'หาแถวค่า cust_type ไม่เจอ (%)', v_n; end if;
    v_src := replace(v_src, v_q,
      'nullif(x->>''cust_type'', ''''),' || chr(10) ||
      '         nullif(x->>''bag_no'', '''')');
    execute v_src;
  end if;

  ------------------------------------------------------------------ board
  select pg_get_functiondef(oid) into v_src from pg_proc where proname = 'parcel24_board';
  if position('bag_no' in v_src) > 0 then
    raise notice 'board มี bag_no แล้ว';
  else
    v_q := '''cust_type'', r.cust_type';
    v_n := (length(v_src) - length(replace(v_src, v_q, ''))) / length(v_q);
    if v_n <> 1 then raise exception 'หาช่อง cust_type ใน board ไม่เจอ (%)', v_n; end if;
    v_src := replace(v_src, v_q,
      '''cust_type'', r.cust_type,' || chr(10) ||
      '           ''bag_no'', r.bag_no');
    execute v_src;
  end if;
end $mig$;


-- ---------------------------------------------------------------------
-- ตรวจผล · สี่ตัวแรกต้องเป็น 1 ตัวสุดท้ายต้องเป็น 0
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'parcel24_rows' and column_name = 'bag_no')      as มีคอลัมน์,
  (select count(*) from pg_proc p where p.proname = 'parcel24_import'
     and pg_get_functiondef(p.oid) like '%bag_no%')                     as importเก็บแล้ว,
  (select count(*) from pg_proc p where p.proname = 'parcel24_board'
     and pg_get_functiondef(p.oid) like '%bag_no%')                     as boardส่งแล้ว,
  (select count(*) from pg_proc p where p.proname = 'parcel24_board'
     and pg_get_functiondef(p.oid) like '%hidden_count%')               as ของ147ยังอยู่,
  (select count(*) from pg_proc p where p.proname = 'parcel24_board'
     and pg_get_functiondef(p.oid) like '%my_can_outbox%')              as ของ160ยังอยู่ต้อง0;
