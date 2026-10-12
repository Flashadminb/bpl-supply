-- ---------------------------------------------------------------------
-- 148 · อัปทับได้จริง และไม่เก็บย้อนหลัง
--
-- เจ้าของระบบสั่งว่า "เวลาอัพทับและเลขหายไปก็ให้หายไปเลย ตรงนี้ผมเอาไว้ให้
-- หน้างานดูสถานะได้ง่ายขึ้นเฉย ๆ ไม่ต้องเซพ"
--
-- สองอย่างที่ต้องแก้
--
-- 1 · อัปไฟล์รอบเดิมซ้ำต้องทับของเดิม ไม่ใช่เมินแล้วคืนของเก่า
--     ของค้างส่งออกทับอยู่แล้วตั้งแต่แรก แต่พัสดุ 24 ชม เมินทิ้ง
--     ผลคือถ้าแก้ไฟล์แล้วอัปใหม่ด้วยเวลาเดิม เลขเก่าจะค้างอยู่โดยไม่มีใครรู้
--     ซึ่งแย่กว่าไม่มีข้อมูล เพราะคนเชื่อว่ามันอัปแล้ว
--
-- 2 · ไม่สะสมรอบเก่า · เก็บแค่ 3 รอบล่าสุดทั้งสองกระดาน
--     ที่ไม่เหลือรอบเดียว เพราะลูกศรเทียบรอบก่อนต้องใช้รอบที่แล้วเป็นตัวเทียบ
--     เหลือรอบเดียวคือลูกศรหายทั้งจอ ซึ่งเป็นของที่เจ้าของระบบสั่งทำมาเอง
--     สามรอบคือน้อยสุดที่ยังเทียบได้และเผื่อถอนรอบที่อัปผิดได้หนึ่งครั้ง
-- ---------------------------------------------------------------------

/** กี่รอบที่เก็บไว้ · เปลี่ยนที่เดียวมีผลทั้งสองกระดาน */
create or replace function board_keep_rounds() returns integer
language sql immutable as $$ select 3 $$;

grant execute on function board_keep_rounds() to authenticated;


create or replace function parcel24_import(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_at   timestamptz;
  v_id   bigint;
  v_n    integer;
  v_c    integer;
begin
  if not my_can_outbox() then
    raise exception 'บัญชีนี้อัปไฟล์นี้ไม่ได้';
  end if;

  v_at := (p->>'data_at')::timestamptz;
  if v_at is null then
    raise exception 'ไฟล์นี้ไม่มีเวลาดำเนินการล่าสุด จึงบอกไม่ได้ว่าเป็นข้อมูลรอบไหน';
  end if;

  insert into parcel24_snapshots (data_at, uploaded_by, file_name)
  values (v_at, auth.uid(), nullif(btrim(coalesce(p->>'file_name', '')), ''))
  on conflict (data_at) do update
    set uploaded_at = now(), uploaded_by = auth.uid(), file_name = excluded.file_name
  returning id into v_id;

  -- ล้างของรอบนี้ทิ้งก่อนเสมอ ของที่หายไปจากไฟล์ใหม่จึงหายจากจอจริง ๆ
  delete from parcel24_rows where snapshot_id = v_id;

  insert into parcel24_rows (snapshot_id, tracking, dest, last_action, last_at, in_wh_at, actor, province)
  select v_id,
         x->>'tracking',
         coalesce(x->>'dest', ''),
         coalesce(x->>'action', ''),
         nullif(x->>'last_at', '')::timestamptz,
         nullif(x->>'in_wh_at', '')::timestamptz,
         nullif(x->>'actor', ''),
         nullif(x->>'province', '')
    from jsonb_array_elements(p->'rows') x
   where coalesce(btrim(x->>'tracking'), '') <> ''
  on conflict (snapshot_id, tracking) do nothing;

  select count(*), count(*) filter (where last_action = 'ยกเลิกการส่งต่อพัสดุ')
    into v_n, v_c
    from parcel24_rows where snapshot_id = v_id;

  update parcel24_snapshots set row_count = v_n, cancel_count = v_c where id = v_id;

  delete from parcel24_snapshots s
   where s.id not in (
     select id from parcel24_snapshots order by data_at desc limit board_keep_rounds()
   );

  return jsonb_build_object('id', v_id, 'is_new', true, 'rows', v_n, 'cancel', v_c);
end $$;

grant execute on function parcel24_import(jsonb) to authenticated;


/* ของค้างส่งออกทับอยู่แล้ว เติมเฉพาะการตัดรอบเก่าทิ้ง โดยไม่แตะตัวฟังก์ชันที่เหลือ */
do $mig$
declare v_src text;
begin
  select pg_get_functiondef(oid) into v_src from pg_proc where proname = 'hub_out_import';
  if position('board_keep_rounds' in v_src) = 0 then
    v_src := replace(
      v_src,
      'update hub_out_snapshots set row_count = v_rows, truck_count = v_trucks where id = v_id;',
      'update hub_out_snapshots set row_count = v_rows, truck_count = v_trucks where id = v_id;

  delete from hub_out_snapshots s
   where s.id not in (
     select id from hub_out_snapshots order by snap_at desc limit board_keep_rounds()
   );'
    );
    execute v_src;
  end if;
end $mig$;

delete from parcel24_snapshots s
 where s.id not in (select id from parcel24_snapshots order by data_at desc limit 3);

delete from hub_out_snapshots s
 where s.id not in (select id from hub_out_snapshots order by snap_at desc limit 3);

select
  (select count(*) from pg_proc p where p.proname = 'parcel24_import'
     and pg_get_functiondef(p.oid) like '%board_keep_rounds%')  as p24_prune,
  (select count(*) from pg_proc p where p.proname = 'hub_out_import'
     and pg_get_functiondef(p.oid) like '%board_keep_rounds%')  as out_prune,
  (select count(*) from parcel24_snapshots)                     as p24_rounds,
  (select count(*) from hub_out_snapshots)                      as out_rounds;
