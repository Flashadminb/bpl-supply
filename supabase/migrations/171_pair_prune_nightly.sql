-- ---------------------------------------------------------------------
-- 171 · หน้าจับคู่ · เก็บกวาดรอบเก่าให้ได้จริง ไม่ต้องพึ่งเบราว์เซอร์ใคร
--
-- ─────────────────────────────────────────────────────────────────
-- สิ่งที่วัดได้วันที่ 13 ต.ค. 2569 เวลา 17:00
--
--   p48_parcels   132,025 แถว  99 MB   ควรมี  77,453 (สองรอบ)
--   p48_products  230,617 แถว  77 MB   ควรมี  94,125 (สองรอบ)
--   ฐานข้อมูลรวม 236 MB จากโควตาฟรี 500 MB = 47%
--
-- รอบที่ควรถูกลบไปนานแล้วยังอยู่ครบสี่รอบ รวม 191,326 แถว
-- หนึ่งในนั้นคือรอบที่อัปค้างตั้งแต่ 14:25 ซึ่งเข้าเงื่อนไขให้ลบมาสามชั่วโมงแล้ว
--
-- ทดสอบไส้ในของ p48_prune ตรง ๆ แล้วลบได้หมดในครั้งเดียว ตรรกะจึงไม่ผิด
-- ที่ผิดคือออกแบบให้หน้าเว็บเป็นคนเรียกหลังอัปเสร็จ
-- ซึ่งแปลว่าถ้าใครปิดแท็บก่อน เน็ตสะดุด หรือ RPC ล้มเงียบ ๆ
-- ก็จะไม่มีใครเก็บกวาดเลย และไม่มีอะไรฟ้องว่าไม่ได้เก็บ
-- งานบ้านที่ขึ้นกับว่าใครจะอยู่หน้าจอถึงวินาทีสุดท้ายไหม คืองานบ้านที่ไม่ได้ทำ
-- ─────────────────────────────────────────────────────────────────
--
-- ทางแก้สองชั้น ไม่พึ่งอะไรชั้นเดียว
--   ชั้นที่ 1  p48_end เก็บกวาดให้นิดหน่อยทุกครั้งที่ปิดรอบ
--             จำกัดไว้ไม่เกินสองหมื่นแถว ใช้เวลาไม่กี่วินาที ไม่ชน timeout
--             อัปไม่กี่รอบของเก่าก็หมดเอง โดยไม่ต้องมีใครทำอะไร
--   ชั้นที่ 2  งานรอบดึกที่มีอยู่แล้วเก็บกวาดส่วนที่เหลือ ไม่จำกัดจำนวน
--             รันด้วย service_role ไม่เกี่ยวกับว่าใครเปิดเว็บอยู่หรือเปล่า
--
-- ของเดิมที่หน้าเว็บเรียกเองยังอยู่ ไม่ได้ถอดออก · เป็นชั้นที่สาม
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- ① ตัวเก็บกวาดที่ใช้ซ้ำได้ · ไม่มีด่านสิทธิ์ เพราะเรียกจากในระบบเท่านั้น
--
-- p_limit = 0 แปลว่าไม่จำกัด ไว้ให้งานรอบดึกเก็บให้เกลี้ยงในทีเดียว
-- ตัวที่มีด่านสิทธิ์คือ p48_prune ที่หน้าเว็บเรียก ซึ่งมาเรียกตัวนี้ต่ออีกที
-- ---------------------------------------------------------------------
create or replace function p48_sweep(p_limit integer default 20000) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_dead  bigint[];
  v_left  integer := case when coalesce(p_limit, 0) <= 0 then 2147483647 else p_limit end;
  v_step  integer;
  v_gone  integer := 0;
  v_batch integer;
begin
  select coalesce(array_agg(id), array[]::bigint[]) into v_dead
    from p48_runs r
   where (not r.done and r.uploaded_at < now() - interval '1 hour')
      or (r.done and r.id not in (
            select id from p48_runs x where x.kind = r.kind and x.done
             order by id desc limit 2));

  if array_length(v_dead, 1) is null then
    return 0;
  end if;

  /* ลบทีละก้อนไม่เกินสองหมื่นแถว ก้อนใหญ่กว่านี้เริ่มเสี่ยงชน statement timeout */
  while v_left > 0 loop
    v_batch := least(v_left, 20000);

    with x as (select ctid from p48_parcels where run_id = any (v_dead) limit v_batch)
    delete from p48_parcels p using x where p.ctid = x.ctid;
    get diagnostics v_step = row_count;

    if v_step < v_batch then
      with x as (select ctid from p48_products where run_id = any (v_dead) limit v_batch - v_step)
      delete from p48_products q using x where q.ctid = x.ctid;
      get diagnostics v_batch = row_count;
      v_step := v_step + v_batch;
    end if;

    exit when v_step = 0;
    v_gone := v_gone + v_step;
    v_left := v_left - v_step;
  end loop;

  /* หัวรอบลบได้เมื่อไม่เหลือแถวของมันแล้ว */
  delete from p48_runs r
   where r.id = any (v_dead)
     and not exists (select 1 from p48_parcels  where run_id = r.id)
     and not exists (select 1 from p48_products where run_id = r.id);

  return v_gone;
end $$;

revoke all on function p48_sweep(integer) from public;
grant execute on function p48_sweep(integer) to service_role;


-- ---------------------------------------------------------------------
-- ② ตัวที่หน้าเว็บเรียก · เรียกตัวข้างบนต่อ ไม่ได้เขียนตรรกะซ้ำ
-- ---------------------------------------------------------------------
create or replace function p48_prune(p_limit integer default 20000) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_gone integer;
begin
  if auth.uid() is null then
    raise exception 'บัญชีนี้ทำรายการนี้ไม่ได้';
  end if;

  v_gone := p48_sweep(least(greatest(coalesce(p_limit, 20000), 1000), 50000));

  return jsonb_build_object(
    'deleted', v_gone,
    'left', (select count(*) from p48_parcels  p
              where p.run_id not in (select id from p48_runs where kind = 'parcel'  and done order by id desc limit 2))
          + (select count(*) from p48_products q
              where q.run_id not in (select id from p48_runs where kind = 'product' and done order by id desc limit 2)));
end $$;

grant execute on function p48_prune(integer) to authenticated;


-- ---------------------------------------------------------------------
-- ③ ปิดรอบแล้วเก็บกวาดให้นิดหน่อยทันที
--
-- สองหมื่นแถวใช้เวลาไม่กี่วินาที เทียบกับการอัปที่ใช้เป็นนาที ไม่รู้สึก
-- และทำให้ของเก่าหมดเองภายในไม่กี่รอบ โดยไม่ต้องมีใครกดอะไร
--
-- ห่อด้วย exception เพราะงานบ้านล้มต้องไม่ทำให้ไฟล์ที่อัปสำเร็จแล้วล้มตาม
-- ของเก่าค้างอีกรอบไม่เป็นไร แต่อัปไฟล์ใหม่ไม่เข้าเป็นเรื่องใหญ่
-- ---------------------------------------------------------------------
create or replace function p48_end(p_run bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_kind text;
  v_n    integer;
  v_gone integer := 0;
begin
  if auth.uid() is null then
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

  begin
    v_gone := p48_sweep(20000);
  exception when others then
    v_gone := -1;
  end;

  return jsonb_build_object('id', p_run, 'kind', v_kind, 'rows', v_n, 'swept', v_gone);
end $$;

grant execute on function p48_end(bigint) to authenticated;


-- ---------------------------------------------------------------------
-- ④ งานรอบดึกเก็บส่วนที่เหลือให้เกลี้ยง
--
-- เขียนทับทั้งตัวเพราะ plpgsql แก้ทีละบรรทัดไม่ได้ · ของเดิมสี่บรรทัดยกมาครบ
-- ที่เพิ่มคือบรรทัดเดียว · ไม่จำกัดจำนวนเพราะตอนตีสามไม่มีใครรออยู่
-- ---------------------------------------------------------------------
create or replace function nightly_cleanup()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sync integer;
  v_req  integer;
  v_note integer;
  v_wait integer;
  v_pair integer;
begin
  v_sync := prune_sync_log(60);
  v_req  := prune_old_requisitions(400);
  v_note := prune_notification_log(90);
  v_wait := prune_wait_trucks(400);
  v_pair := p48_sweep(0);
  return jsonb_build_object('sync_log', v_sync, 'requisitions', v_req,
                            'notification_log', v_note, 'wait_trucks', v_wait,
                            'pair_rows', v_pair);
end $$;

grant execute on function nightly_cleanup() to service_role;


-- ---------------------------------------------------------------------
-- ตรวจผล · งานรอบดึกต้องมีอยู่และตั้งเวลาไว้จริง
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname = 'p48_sweep')         as มีตัวเก็บกวาด,
  (select count(*) from pg_proc p where p.proname = 'nightly_cleanup'
     and pg_get_functiondef(p.oid) like '%p48_sweep%')               as งานรอบดึกเรียกแล้ว,
  (select count(*) from pg_proc p where p.proname = 'p48_end'
     and pg_get_functiondef(p.oid) like '%p48_sweep%')               as ปิดรอบเก็บกวาดด้วย,
  (select string_agg(schedule, ' · ') from cron.job
    where command like '%nightly_cleanup%')                          as ตั้งเวลาไว้,
  (select count(*) from p48_parcels)                                 as แถวรายละเอียด,
  (select count(*) from p48_products)                                as แถวสินค้า;
