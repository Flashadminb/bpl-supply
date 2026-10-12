-- ---------------------------------------------------------------------
-- 147 · หน้าหลังบ้านของสาขา เพิ่ม ลบ แก้ไข และปิดการโชว์
--
-- เดิมหน้าโซนทำได้อย่างเดียวคือตั้งโซนให้สาขาที่โผล่มาจากไฟล์รอบล่าสุด
-- สามอย่างที่ยังทำไม่ได้และเจ้าของระบบสั่งเพิ่ม
--   เพิ่ม   สาขาที่รู้ว่าจะมา แต่รอบนี้ยังไม่มีของ ตั้งโซนรอไว้ล่วงหน้าได้
--   ลบ     แถวที่ตั้งผิดหรือสาขาที่เลิกใช้แล้ว
--   ปิดโชว์ สาขาที่ไม่อยากให้ขึ้นบนจอ เช่นคลังรีเทิร์นที่ไม่ใช่สาขาจริง
--
-- "ปิดโชว์" แปลว่าไม่ขึ้นบนกระดานและไม่ถูกนับในยอดรวมด้วย
-- ซึ่งแรง จึงต้องมีตัวบอกว่าซ่อนอยู่กี่สาขาติดไปกับกระดานเสมอ
-- ไม่งั้นวันหนึ่งจะมีคนสงสัยว่าทำไมยอดไม่ตรงกับไฟล์ แล้วหาสาเหตุไม่เจอ
-- ---------------------------------------------------------------------

alter table hub_out_zones add column if not exists hidden boolean not null default false;


/** ตั้งโซนของสาขาหนึ่ง · เพิ่มสาขาใหม่ก็ใช้ตัวนี้ ส่งชื่อที่ยังไม่มีมาได้เลย */
create or replace function hub_out_zone_set(
  p_station text,
  p_zone text,
  p_note text default null,
  p_hidden boolean default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not my_can_outbox() then
    raise exception 'บัญชีนี้ตั้งโซนไม่ได้';
  end if;
  if coalesce(btrim(p_station), '') = '' then
    raise exception 'ไม่ได้ระบุสาขา';
  end if;

  insert into hub_out_zones (station, zone, note, hidden, from_seed, updated_at, updated_by)
  values (btrim(p_station), nullif(upper(btrim(p_zone)), ''), nullif(btrim(coalesce(p_note, '')), ''),
          coalesce(p_hidden, false), false, now(), auth.uid())
  on conflict (station) do update
    set zone = excluded.zone,
        note = excluded.note,
        hidden = coalesce(p_hidden, hub_out_zones.hidden),
        from_seed = false,
        updated_at = now(),
        updated_by = auth.uid();

  return jsonb_build_object('ok', true);
end $$;

grant execute on function hub_out_zone_set(text, text, text, boolean) to authenticated;


/** ลบแถวทิ้ง · ใช้กับสาขาที่เลิกใช้หรือตั้งผิด · ถ้าสาขายังอยู่ในไฟล์ มันจะกลับมาแบบไม่มีโซน */
create or replace function hub_out_zone_delete(p_station text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not my_can_outbox() then
    raise exception 'บัญชีนี้ลบไม่ได้';
  end if;
  delete from hub_out_zones where station = p_station;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function hub_out_zone_delete(text) to authenticated;


/** ปิดหรือเปิดการโชว์ทีละหลายสาขา · ใช้ตอนไล่ปิดพวกคลังรีเทิร์นทีเดียว */
create or replace function hub_out_zone_hide_many(p_stations text[], p_hidden boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not my_can_outbox() then
    raise exception 'บัญชีนี้แก้ไม่ได้';
  end if;

  insert into hub_out_zones (station, hidden, from_seed, updated_at, updated_by)
  select btrim(s), coalesce(p_hidden, false), false, now(), auth.uid()
    from unnest(coalesce(p_stations, '{}')) s
   where coalesce(btrim(s), '') <> ''
  on conflict (station) do update
    set hidden = excluded.hidden, updated_at = now(), updated_by = auth.uid();

  get diagnostics v_n = row_count;
  return jsonb_build_object('n', v_n);
end $$;

grant execute on function hub_out_zone_hide_many(text[], boolean) to authenticated;


/**
 * รายชื่อสาขาของหน้าหลังบ้าน
 *
 * รวมสามแหล่ง ไฟล์ของค้างส่งออกรอบล่าสุด ไฟล์พัสดุ 24 ชมรอบล่าสุด
 * และแถวที่คนเพิ่มเองไว้แล้วซึ่งอาจยังไม่โผล่ในไฟล์ไหนเลย
 * ถ้าเอาเฉพาะจากไฟล์ สาขาที่เพิ่งเพิ่มเองจะหายไปทันทีที่กดบันทึก
 * แล้วคนจะคิดว่าเพิ่มไม่สำเร็จ
 */
drop function if exists hub_out_zone_rows();
create or replace function hub_out_zone_rows()
returns table (
  station   text,
  dir       text,
  in_wh     integer,
  on_truck  integer,
  p24       integer,
  zone      text,
  note      text,
  from_seed boolean,
  hidden    boolean,
  src       text
)
language sql stable security definer set search_path = public as $$
  with o as (
    select r.station, r.dir, r.in_wh, r.on_truck
      from hub_out_rows r
     where r.snapshot_id = (select id from hub_out_snapshots order by snap_at desc limit 1)
  ),
  p as (
    select r.dest as station, count(*)::integer as n
      from parcel24_rows r
     where r.snapshot_id = (select id from parcel24_snapshots order by data_at desc limit 1)
       and coalesce(btrim(r.dest), '') <> ''
     group by 1
  ),
  names as (
    select station from o
    union select station from p
    union select station from hub_out_zones
  )
  select n.station,
         coalesce(o.dir, ''),
         coalesce(o.in_wh, 0),
         coalesce(o.on_truck, 0),
         coalesce(p.n, 0),
         z.zone,
         z.note,
         coalesce(z.from_seed, false),
         coalesce(z.hidden, false),
         case
           when o.station is not null and p.station is not null then 'both'
           when o.station is not null then 'out'
           when p.station is not null then 'p24'
           else 'manual'
         end
    from names n
    left join o on o.station = n.station
    left join p on p.station = n.station
    left join hub_out_zones z on z.station = n.station
   where my_can_outbox()
   order by coalesce(nullif(btrim(z.zone), ''), 'zzz'),
            coalesce(o.in_wh, 0) + coalesce(o.on_truck, 0) + coalesce(p.n, 0) desc,
            n.station;
$$;

grant execute on function hub_out_zone_rows() to authenticated;


/* ---------------------------------------------------------------------
   กระดานทั้งสองใบ ไม่เอาสาขาที่ปิดโชว์ไว้ แต่บอกจำนวนที่ซ่อนติดไปด้วย
   --------------------------------------------------------------------- */

do $mig$
declare
  v_src text;
begin
  -- ของค้างส่งออก
  select pg_get_functiondef(oid) into v_src from pg_proc where proname = 'hub_out_board';
  v_src := replace(
    v_src,
    'left join hub_out_zones z
          on z.station = c.station
       where c.snapshot_id = v_cur.id',
    'left join hub_out_zones z
          on z.station = c.station
       where c.snapshot_id = v_cur.id
         and coalesce(z.hidden, false) = false'
  );
  v_src := replace(
    v_src,
    '''prev_at'', v_prev.snap_at',
    '''prev_at'', v_prev.snap_at,
      ''hidden_count'', (select count(*) from hub_out_rows x
                           join hub_out_zones h on h.station = x.station and h.hidden
                          where x.snapshot_id = v_cur.id)'
  );
  execute v_src;

  -- พัสดุค้างเกิน 24 ชม
  select pg_get_functiondef(oid) into v_src from pg_proc where proname = 'parcel24_board';
  v_src := replace(
    v_src,
    'left join hub_out_zones z on z.station = r.dest
   where r.snapshot_id = v_cur.id',
    'left join hub_out_zones z on z.station = r.dest
   where r.snapshot_id = v_cur.id
     and coalesce(z.hidden, false) = false'
  );
  v_src := replace(
    v_src,
    '''prev_cancel'', v_prev.cancel_count',
    '''prev_cancel'', v_prev.cancel_count,
      ''hidden_count'', (select count(*) from parcel24_rows x
                           join hub_out_zones h on h.station = x.dest and h.hidden
                          where x.snapshot_id = v_cur.id)'
  );
  execute v_src;
end $mig$;

select
  (select count(*) from information_schema.columns
    where table_name = 'hub_out_zones' and column_name = 'hidden')            as col_hidden,
  (select count(*) from pg_proc where proname = 'hub_out_zone_delete')        as f_delete,
  (select count(*) from pg_proc where proname = 'hub_out_zone_hide_many')     as f_hide,
  (select count(*) from pg_proc p where p.proname = 'hub_out_board'
     and pg_get_functiondef(p.oid) like '%hidden_count%')                     as board_hidden,
  (select count(*) from pg_proc p where p.proname = 'parcel24_board'
     and pg_get_functiondef(p.oid) like '%hidden_count%')                     as p24_hidden;
