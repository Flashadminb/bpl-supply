-- ---------------------------------------------------------------------
-- 168 · ให้หน้างานอัปไฟล์ของค้างส่งออกได้ แลกกับประวัติที่ตามตัวได้
--
-- 167 เปิดให้หน้างานดูอย่างเดียว · รอบนี้เจ้าของระบบสั่งให้อัปได้ด้วย
-- สิ่งที่แลกมาคือทุกการอัปต้องรู้ว่าใครทำ เมื่อไหร่ ไฟล์ชื่ออะไร
-- ตารางเก็บ uploaded_by กับ file_name ไว้ตั้งแต่ไฟล์ 142 แล้ว
-- แต่ไม่เคยมีใครเอาออกมาโชว์ · รอบนี้เอาออกมา
--
-- ─────────────────────────────────────────────────────────────────
-- ถอนรอบ · เปิดให้หน้างานแก้ของตัวเองได้ แต่ไม่ให้ลบของคนอื่น
--
-- ถ้าอัปได้แต่ถอนไม่ได้ คนที่อัปผิดไฟล์จะทำอะไรไม่ได้เลยนอกจากรอแอดมิน
-- ซึ่งแปลว่ากระดานผิดค้างอยู่ทั้งกะ · แย่กว่าปล่อยให้เขาแก้เอง
--
-- แต่เปิดถอนแบบไม่จำกัดคือเปิดให้ลบประวัติย้อนหลังได้ทั้งหมด
-- จึงให้หน้างานถอนได้เฉพาะรอบที่
--   ตัวเองเป็นคนอัป
--   เป็นรอบใหม่สุด · ถอนรอบกลาง ๆ ไม่ได้ ประวัติจะได้ไม่มีรู
--   ภายในสองชั่วโมง · พ้นจากนั้นถือว่ามีคนใช้งานข้อมูลรอบนั้นไปแล้ว
-- ผู้ดูแลระบบยังถอนรอบไหนก็ได้เหมือนเดิม
-- ─────────────────────────────────────────────────────────────────
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- ① อัปไฟล์ · เปิดให้ทุกคนที่ล็อกอินอยู่
--
-- แก้ที่ตัวเงื่อนไขจุดเดียว ไม่เขียนฟังก์ชันใหม่ทั้งก้อน วิธีเดียวกับ 160 และ 167
-- hub_out_import ถูกแก้มาหลายไฟล์แล้ว เขียนทับทั้งก้อนคือของเก่าหายเงียบ ๆ
-- ---------------------------------------------------------------------
do $mig$
declare v_def text; v_n int;
begin
  select pg_get_functiondef(oid) into v_def from pg_proc where proname = 'hub_out_import';
  if v_def is null then raise exception 'ไม่พบ hub_out_import'; end if;

  v_n := (length(v_def) - length(replace(v_def, 'my_can_outbox()', ''))) / 15;
  if v_n = 0 then
    raise notice 'hub_out_import เปิดแล้ว';
  elsif v_n <> 1 then
    raise exception 'ใน hub_out_import เจอด่าน % จุด ไม่ใช่จุดเดียว', v_n;
  else
    execute replace(v_def, 'my_can_outbox()', '(auth.uid() is not null)');
  end if;
end $mig$;


-- ---------------------------------------------------------------------
-- ② ถอนรอบ · ของตัวเอง รอบใหม่สุด ภายในสองชั่วโมง
-- ---------------------------------------------------------------------
create or replace function hub_out_undo(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s hub_out_snapshots%rowtype;
  v_newest bigint;
begin
  if auth.uid() is null then
    raise exception 'ต้องเข้าสู่ระบบก่อน';
  end if;

  select * into s from hub_out_snapshots where id = p_id;
  if s.id is null then
    raise exception 'ไม่เจอรอบนี้ อาจถูกถอนไปแล้ว';
  end if;

  /* ผู้ดูแลระบบถอนรอบไหนก็ได้ · ที่เหลือมีเงื่อนไขสามข้อ */
  if not my_can_outbox() then
    if s.uploaded_by is distinct from auth.uid() then
      raise exception 'ถอนได้เฉพาะรอบที่ตัวเองอัป · รอบนี้คนอื่นเป็นคนอัป';
    end if;

    select id into v_newest from hub_out_snapshots order by snap_at desc limit 1;
    if v_newest is distinct from p_id then
      raise exception 'ถอนได้เฉพาะรอบใหม่สุด · มีคนอัปรอบใหม่กว่านี้ไปแล้ว';
    end if;

    if s.uploaded_at < now() - interval '2 hours' then
      raise exception 'รอบนี้อัปไว้เกินสองชั่วโมงแล้ว ถอนเองไม่ได้ ให้แจ้งผู้ดูแลระบบ';
    end if;
  end if;

  delete from hub_out_snapshots where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function hub_out_undo(bigint) to authenticated;


-- ---------------------------------------------------------------------
-- ③ ประวัติการอัป · เพิ่มชื่อคนอัปกับชื่อไฟล์
--
-- ต้องทิ้งแล้วสร้างใหม่ เพราะเปลี่ยนรูปตารางที่คืนกลับไป
-- create or replace เปลี่ยนคอลัมน์ที่คืนไม่ได้
--
-- ยังเป็นของผู้ดูแลระบบเหมือนเดิม · เจ้าของระบบขอไว้ดูเอง
-- ไม่ได้เปิดให้ทุกคนดู เพราะนี่คือเครื่องมือตรวจสอบ ไม่ใช่ข้อมูลหน้างาน
-- ---------------------------------------------------------------------
drop function if exists hub_out_runs(integer);

create function hub_out_runs(p_limit integer default 48)
returns table (
  id          bigint,
  snap_at     timestamptz,
  uploaded_at timestamptz,
  row_count   integer,
  truck_count integer,
  file_name   text,
  by_name     text,
  by_code     text
)
language sql stable security definer set search_path = public as $$
  select s.id, s.snap_at, s.uploaded_at, s.row_count, s.truck_count,
         s.file_name,
         coalesce(i.full_name, ''),
         coalesce(i.employee_code, '')
    from hub_out_snapshots s
    left join profiles i on i.id = s.uploaded_by
   where my_can_outbox()
   order by s.snap_at desc
   limit greatest(1, least(coalesce(p_limit, 48), 200));
$$;

grant execute on function hub_out_runs(integer) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
--   อัปไฟล์เปิดแล้ว = 0
--   ประวัติยังล็อก = 1 · ตั้งโซนยังล็อก > 0
--   จับคู่ยังล็อกอยู่ = 1 · ต้องไม่โดนเปิดตามไปด้วย
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc p where p.proname = 'hub_out_import'
     and pg_get_functiondef(p.oid) like '%my_can_outbox%')   as อัปไฟล์ยังล็อกไหม,
  (select count(*) from pg_proc p where p.proname = 'hub_out_runs'
     and pg_get_functiondef(p.oid) like '%my_can_outbox%')   as ประวัติล็อกอยู่,
  (select count(*) from pg_proc p where p.proname = 'hub_out_zone_set'
     and pg_get_functiondef(p.oid) like '%my_can_outbox%')   as ตั้งโซนล็อกอยู่,
  (select count(*) from pg_proc p where p.proname = 'p48_search'
     and pg_get_functiondef(p.oid) like '%my_can_outbox%')   as จับคู่ยังล็อกอยู่,
  (select count(*) from hub_out_snapshots)                   as รอบที่มีอยู่,
  (select count(*) from hub_out_snapshots where uploaded_by is null) as รอบที่ไม่รู้คนอัป;
