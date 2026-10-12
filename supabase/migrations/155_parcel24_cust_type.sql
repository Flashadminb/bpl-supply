-- ---------------------------------------------------------------------
-- 155 · เก็บประเภทลูกค้าของพัสดุค้างเกิน 24 ชม
--
-- ไฟล์ต้นทางมีคอลัมน์ "ประเภทลูกค้า" มาตลอด แต่เดิมไม่ได้เก็บ
-- ของจริงในไฟล์วันที่ 13 ต.ค. 2569 คือ shopee 2507 · tiktok 1496 · KA 1090
-- lazada 907 · 小C 418 · 天猫集运 23 · shein 18 · 菜鸟 APP 1
-- เจ้าของระบบบอกว่า "ไม่ได้สำคัญมาก แค่อยากมี" จึงเก็บไว้เฉย ๆ ก่อน
-- ไม่ได้เอาไปตัดสินใจอะไรในระบบ และไม่มีอะไรพังถ้าช่องนี้ว่าง
--
-- แก้ฟังก์ชันเดิมแบบ patch ไม่ได้เขียนใหม่ทั้งก้อน
-- เพราะ 147 กับ 148 แก้สองตัวนี้ไปแล้วคนละจุด ถ้าเขียนทับทั้งก้อน
-- ของที่สองไฟล์นั้นแก้ไว้จะหายไปเงียบ ๆ โดยไม่มีอะไรฟ้อง
-- ทุกจุดที่แก้นับจำนวนก่อนเสมอ เจอไม่ครบหนึ่งที่ก็ล้มทั้งไฟล์ ไม่แก้ครึ่ง ๆ
-- ---------------------------------------------------------------------

alter table parcel24_rows add column if not exists cust_type text;

comment on column parcel24_rows.cust_type is
  'ประเภทลูกค้าจากไฟล์ต้นทาง เช่น shopee tiktok KA lazada · เก็บไว้ดูเฉย ๆ';


do $mig$
declare
  v_src text;
  v_q   text;
  v_n   int;
begin
  ----------------------------------------------------------------- import
  select pg_get_functiondef(oid) into v_src from pg_proc where proname = 'parcel24_import';
  if v_src is null then
    raise exception 'ยังไม่มีฟังก์ชัน parcel24_import';
  end if;

  if position('cust_type' in v_src) > 0 then
    raise notice 'parcel24_import มี cust_type อยู่แล้ว';
  else
    v_q := ', actor, province)';
    v_n := (length(v_src) - length(replace(v_src, v_q, ''))) / length(v_q);
    if v_n <> 1 then
      raise exception 'หาแถวรายชื่อคอลัมน์ใน parcel24_import ไม่เจอ หรือเจอซ้ำ (%)', v_n;
    end if;
    v_src := replace(v_src, v_q, ', actor, province, cust_type)');

    v_q := 'nullif(x->>''province'', '''')';
    v_n := (length(v_src) - length(replace(v_src, v_q, ''))) / length(v_q);
    if v_n <> 1 then
      raise exception 'หาแถวค่าจังหวัดใน parcel24_import ไม่เจอ หรือเจอซ้ำ (%)', v_n;
    end if;
    v_src := replace(
      v_src,
      v_q,
      'nullif(x->>''province'', ''''),' || chr(10) ||
      '         nullif(x->>''cust_type'', '''')'
    );

    execute v_src;
  end if;

  ------------------------------------------------------------------ board
  select pg_get_functiondef(oid) into v_src from pg_proc where proname = 'parcel24_board';
  if v_src is null then
    raise exception 'ยังไม่มีฟังก์ชัน parcel24_board';
  end if;

  if position('cust_type' in v_src) > 0 then
    raise notice 'parcel24_board มี cust_type อยู่แล้ว';
  else
    v_q := '''province'', r.province';
    v_n := (length(v_src) - length(replace(v_src, v_q, ''))) / length(v_q);
    if v_n <> 1 then
      raise exception 'หาช่องจังหวัดใน parcel24_board ไม่เจอ หรือเจอซ้ำ (%)', v_n;
    end if;
    v_src := replace(
      v_src,
      v_q,
      '''province'', r.province,' || chr(10) ||
      '           ''cust_type'', r.cust_type'
    );
    execute v_src;
  end if;
end $mig$;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'parcel24_rows' and column_name = 'cust_type')        as มีคอลัมน์,
  (select count(*) from pg_proc p where p.proname = 'parcel24_import'
     and pg_get_functiondef(p.oid) like '%cust_type%')                       as importเก็บแล้ว,
  (select count(*) from pg_proc b where b.proname = 'parcel24_board'
     and pg_get_functiondef(b.oid) like '%cust_type%')                       as boardส่งแล้ว,
  (select count(*) from pg_proc p where p.proname = 'parcel24_import'
     and pg_get_functiondef(p.oid) like '%board_keep_rounds%')               as ของ148ยังอยู่,
  (select count(*) from pg_proc b where b.proname = 'parcel24_board'
     and pg_get_functiondef(b.oid) like '%hidden_count%')                    as ของ147ยังอยู่;
