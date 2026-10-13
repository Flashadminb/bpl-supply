-- =====================================================================
-- BPL SUPPLY — หน้าจับคู่ · อัปไฟล์ให้ไม่ถูกตัดกลางทาง
-- รันต่อจาก 165 · ปลอดภัยที่จะรันซ้ำ
--
-- อาการที่เจ้าของระบบเจอ · อัปแล้วโดนยกเลิก และนานมาก
--
-- ── สาเหตุที่หาเจอในโค้ดเดิม ──
--
-- ① p48_end ลบรอบเก่าทิ้งในคำสั่งเดียวกับที่ปิดรอบ
--    ลบ p48_runs หนึ่งแถว = cascade ลบ p48_parcels ห้าหมื่นแถวพร้อมดัชนีทั้งชุด
--    ซึ่งกินเวลานานพอจะชน statement timeout ของฐานข้อมูล
--    แล้ว Postgres จะยกเลิกคำสั่งนั้นเอง ขึ้นว่า canceling statement
--    คนอัปเห็นคำว่ายกเลิกทั้งที่ไม่มีใครกดยกเลิก และของที่ส่งไปแล้วก็ไม่ถูกปิดรอบ
--    กลายเป็นรอบค้างที่ไม่มีใครใช้ แล้วต้องอัปใหม่ทั้งก้อน
--
-- ② p48_begin ก็ลบรอบค้างแบบ cascade เหมือนกัน อยู่หัวแถวของทุกการอัป
--
-- ── ทางแก้ ──
-- แยกการลบออกมาเป็น p48_prune() ที่ลบทีละไม่เกินสองหมื่นแถวต่อการเรียกหนึ่งครั้ง
-- แล้วให้หน้าเว็บเรียกวนหลังอัปเสร็จและรายงานผลไปแล้ว
-- การลบล้มกลางทางจึงไม่ทำให้การอัปล้มตามไปด้วย แค่เหลือของเก่าค้างไว้อีกรอบ
--
-- เรื่องความเร็วที่เหลือแก้ฝั่งหน้าเว็บ · ก้อนเล็กลง ส่งพร้อมกันหลายก้อน
-- และไม่ส่งช่องที่ไม่มีค่า ซึ่งตัดขนาดที่ต้องส่งลงเกินครึ่ง
-- =====================================================================

-- ---------------------------------------------------------------------
-- ① ปิดรอบ · ไม่ลบอะไรทั้งนั้น
--
-- หน้าที่เดียวคือทำให้รอบใหม่เป็นรอบที่ทุกคนเห็น ซึ่งต้องเร็วและต้องไม่พลาด
-- ของเก่าปล่อยให้ p48_prune จัดการทีหลัง ช้าไปอีกนาทีไม่มีใครเดือดร้อน
-- ---------------------------------------------------------------------
create or replace function p48_end(p_run bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_kind text;
  v_n    integer;
begin
  if not my_can_outbox() then
    raise exception 'บัญชีนี้อัปไฟล์นี้ไม่ได้';
  end if;

  select kind into v_kind from p48_runs where id = p_run and not done;
  if v_kind is null then
    raise exception 'รอบนี้ปิดไปแล้วหรือไม่มีอยู่';
  end if;

  if v_kind = 'parcel' then
    select count(*) into v_n from p48_parcels where run_id = p_run;
  else
    select count(*) into v_n from p48_products where run_id = p_run;
  end if;

  if v_n = 0 then
    delete from p48_runs where id = p_run;
    raise exception 'ไฟล์นี้ไม่มีแถวไหนเข้าเลย จึงไม่ได้บันทึกรอบใหม่ ของเดิมยังอยู่ครบ';
  end if;

  update p48_runs set row_count = v_n, done = true where id = p_run;

  return jsonb_build_object('id', p_run, 'kind', v_kind, 'rows', v_n);
end $$;

grant execute on function p48_end(bigint) to authenticated;


-- ---------------------------------------------------------------------
-- ② เปิดรอบ · ไม่ลบรอบค้างแล้ว แค่ทำเครื่องหมายว่าหมดอายุ
--
-- ของเดิมลบตรงนี้ ซึ่งอยู่หัวแถวของทุกการอัป · ช้าตรงนี้คือช้าทุกครั้ง
-- ---------------------------------------------------------------------
create or replace function p48_begin(p_kind text, p_file text, p_file_rows integer)
returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not my_can_outbox() then
    raise exception 'บัญชีนี้อัปไฟล์นี้ไม่ได้';
  end if;
  if p_kind not in ('parcel', 'product') then
    raise exception 'ชนิดไฟล์ไม่ถูกต้อง';
  end if;

  insert into p48_runs (kind, uploaded_by, file_name, file_rows)
  values (p_kind, auth.uid(), p_file, coalesce(p_file_rows, 0))
  returning id into v_id;

  return v_id;
end $$;

grant execute on function p48_begin(text, text, integer) to authenticated;


-- ---------------------------------------------------------------------
-- ③ เก็บกวาด · ลบทีละก้อนเล็ก เรียกวนจนหมด
--
-- รอบที่ต้องไป มีสองแบบ
--   รอบที่อัปค้างไว้เกินหนึ่งชั่วโมงแล้วไม่เคยปิด · อัปไม่จบแล้วปิดหน้าไป
--   รอบที่เก่ากว่าสองรอบล่าสุดของชนิดนั้น · เก็บรอบปัจจุบันกับรอบก่อนหน้าพอ
--
-- ลบแถวข้อมูลก่อนทีละไม่เกิน p_limit แถว แล้วค่อยลบหัวรอบเมื่อไม่เหลือแถวแล้ว
-- คืนค่าว่ายังเหลือให้ลบอีกไหม หน้าเว็บจะได้รู้ว่าต้องเรียกซ้ำ
--
-- ปลอดภัยที่จะหยุดกลางคัน · รอบที่โดนลบไปครึ่งเดียวไม่มีใครเห็นอยู่แล้ว
-- เพราะ p48_live หยิบเฉพาะรอบใหม่สุดที่ปิดแล้ว
-- ---------------------------------------------------------------------
create or replace function p48_prune(p_limit integer default 20000) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_lim  integer := least(greatest(coalesce(p_limit, 20000), 1000), 50000);
  v_dead bigint[];
  v_n    integer := 0;
  v_m    integer;
begin
  if not my_can_outbox() then
    raise exception 'บัญชีนี้ทำรายการนี้ไม่ได้';
  end if;

  select coalesce(array_agg(id), array[]::bigint[]) into v_dead
    from p48_runs r
   where (not r.done and r.uploaded_at < now() - interval '1 hour')
      or (r.done and r.id not in (
            select id from p48_runs x where x.kind = r.kind and x.done
             order by id desc limit 2));

  if array_length(v_dead, 1) is null then
    return jsonb_build_object('left', 0, 'deleted', 0, 'runs', 0);
  end if;

  with x as (
    select ctid from p48_parcels where run_id = any (v_dead) limit v_lim
  )
  delete from p48_parcels p using x where p.ctid = x.ctid;
  get diagnostics v_n = row_count;

  if v_n < v_lim then
    with x as (
      select ctid from p48_products where run_id = any (v_dead) limit v_lim - v_n
    )
    delete from p48_products p using x where p.ctid = x.ctid;
    get diagnostics v_m = row_count;
    v_n := v_n + v_m;
  end if;

  /* หัวรอบลบได้เมื่อไม่เหลือแถวของมันแล้ว */
  delete from p48_runs r
   where r.id = any (v_dead)
     and not exists (select 1 from p48_parcels  where run_id = r.id)
     and not exists (select 1 from p48_products where run_id = r.id);

  return jsonb_build_object(
    'deleted', v_n,
    'runs', array_length(v_dead, 1),
    'left', (select count(*) from p48_parcels  where run_id = any (v_dead))
          + (select count(*) from p48_products where run_id = any (v_dead))
  );
end $$;

grant execute on function p48_prune(integer) to authenticated;


-- ---------------------------------------------------------------------
-- ④ ย้อนกลับ · ของเดิมลบรอบปัจจุบันทั้งก้อนในคำสั่งเดียว ชน timeout เหมือนกัน
--
-- เปลี่ยนเป็นถอดธง done ออกแทนการลบ · รอบนั้นจึงหายจากสายตาทันที
-- แล้ว p48_prune ค่อยตามเก็บทีหลัง เพราะรอบที่ไม่ done และเก่ากว่าหนึ่งชั่วโมง
-- เข้าเงื่อนไขที่ต้องไปอยู่แล้ว
-- ---------------------------------------------------------------------
create or replace function p48_undo(p_kind text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cur  bigint;
  v_prev bigint;
begin
  if not my_can_outbox() then
    raise exception 'บัญชีนี้ย้อนกลับไม่ได้';
  end if;

  select id into v_cur from p48_runs where kind = p_kind and done order by id desc limit 1;
  if v_cur is null then
    raise exception 'ยังไม่เคยอัปไฟล์ชนิดนี้ จึงไม่มีอะไรให้ย้อน';
  end if;

  select id into v_prev
    from p48_runs where kind = p_kind and done and id < v_cur order by id desc limit 1;
  if v_prev is null then
    raise exception 'มีอยู่รอบเดียว ย้อนกลับแล้วจะไม่เหลือข้อมูลเลย · ถ้าตั้งใจจะล้างให้ลบจากรายการรอบ';
  end if;

  /* ถอยเวลาอัปไปหนึ่งวันด้วย จะได้เข้าเงื่อนไขของ p48_prune ทันที
     ไม่ต้องรอให้ครบหนึ่งชั่วโมงก่อนถึงจะถูกเก็บกวาด */
  update p48_runs set done = false, uploaded_at = now() - interval '1 day' where id = v_cur;

  return jsonb_build_object('ok', true, 'back_to', v_prev);
end $$;

grant execute on function p48_undo(text) to authenticated;


-- ---------------------------------------------------------------------
-- ⑤ ลบรอบที่ระบุ · ก็ถอดธงเหมือนกัน แล้วให้ตัวเก็บกวาดตามเช็ด
-- ---------------------------------------------------------------------
create or replace function p48_drop_run(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not my_can_outbox() then
    raise exception 'บัญชีนี้ลบรอบไม่ได้';
  end if;
  update p48_runs set done = false, uploaded_at = now() - interval '1 day' where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function p48_drop_run(bigint) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname = 'p48_prune')  as มีตัวเก็บกวาด,
  (select count(*) from p48_runs)                             as รอบทั้งหมด,
  (select count(*) from p48_runs where done)                  as รอบที่ใช้งานได้,
  (select count(*) from p48_parcels)                          as แถวรายละเอียด,
  (select count(*) from p48_products)                         as แถวสินค้า;
