-- ---------------------------------------------------------------------
-- 144 · โซน D0x ของสาขาปลายทาง สำหรับของค้างส่งออก
--
-- เจ้าของระบบสั่งว่า "ดึงข้อมูลมาให้แค่ตอนแรกก็ได้ แต่ทำหลังบ้านไว้ให้
-- แบบไม่ต้องสัมพันธ์กัน"
--
-- จึงเป็นตารางของตัวเอง ไม่ใช่ join ไปหา truck_branches ตอนอ่าน
-- เหตุผล · สองระบบนี้ใช้ชื่อสาขาคนละแบบ จับคู่อัตโนมัติได้ 80 จาก 104
-- ถ้าผูกกันตอนอ่าน วันที่ใครไปแก้ชื่อสาขาฝั่งปล่อยรถ โซนฝั่งนี้จะหายไปเงียบ ๆ
-- และเจ้าของระบบจะแก้เองไม่ได้ เพราะของจริงอยู่อีกตาราง
--
-- ดึงมาครั้งแรกด้วย hub_out_zone_seed() แล้วหลังจากนั้นแก้มือที่หลังบ้าน
-- ตัวดึงเติมเฉพาะช่องที่ยังว่าง ไม่ทับของที่คนตั้งเอง กดซ้ำกี่รอบก็ปลอดภัย
-- ---------------------------------------------------------------------

create table if not exists hub_out_zones (
  station    text primary key,
  zone       text,
  note       text,
  /** มาจากการดึงอัตโนมัติ หรือคนตั้งเอง · ไว้ให้รู้ว่าอันไหนเชื่อได้แค่ไหน */
  from_seed  boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles (id)
);

alter table hub_out_zones enable row level security;

drop policy if exists own_hub_out_zones on hub_out_zones;
create policy own_hub_out_zones on hub_out_zones for all to authenticated
  using (my_can_outbox()) with check (my_can_outbox());


/**
 * ดึงโซนจากรายชื่อสาขาของงานปล่อยรถ ครั้งแรกครั้งเดียว
 *
 * จับคู่สองทาง รหัสหน้าชื่อก่อน แล้วค่อยชื่อไทยหลังขีด
 * ไม่ใช้การจับคู่แบบหลวม เพราะลองแล้วได้ 130 ครั้งจาก 104 สาขา
 * แปลว่าชนกันหลายอัน ซึ่งจะได้โซนผิดโดยไม่มีใครรู้ — ผิดเงียบแย่กว่าว่างเปล่า
 */
create or replace function hub_out_zone_seed() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_add integer;
  v_left integer;
begin
  if not my_can_outbox() then
    raise exception 'บัญชีนี้ตั้งโซนไม่ได้';
  end if;

  with cur as (
    select distinct r.station
      from hub_out_rows r
     where r.snapshot_id = (select id from hub_out_snapshots order by snap_at desc limit 1)
  ),
  x as (
    select c.station,
           btrim(split_part(c.station, '-', 2)) as thai,
           btrim(split_part(split_part(c.station, '-', 1), '_', 1)) as pre
      from cur c
  ),
  m as (
    select x.station,
           coalesce(
             (select b.zone from truck_branches b
               where b.is_active and upper(btrim(b.code)) = upper(x.pre)
                 and coalesce(btrim(b.zone), '') <> '' limit 1),
             (select b.zone from truck_branches b
               where b.is_active and lower(btrim(b.name)) = lower(x.thai)
                 and coalesce(btrim(b.zone), '') <> '' limit 1)
           ) as zone
      from x
  )
  insert into hub_out_zones (station, zone, from_seed, updated_by)
  select m.station, btrim(m.zone), true, auth.uid()
    from m
   where coalesce(btrim(m.zone), '') <> ''
  on conflict (station) do nothing;

  get diagnostics v_add = row_count;

  select count(*) into v_left
    from (
      select distinct r.station from hub_out_rows r
       where r.snapshot_id = (select id from hub_out_snapshots order by snap_at desc limit 1)
    ) s
   where not exists (
     select 1 from hub_out_zones z
      where z.station = s.station and coalesce(btrim(z.zone), '') <> ''
   );

  return jsonb_build_object('added', v_add, 'left', v_left);
end $$;

grant execute on function hub_out_zone_seed() to authenticated;


/** รายชื่อสาขาของรอบล่าสุด พร้อมโซนที่ตั้งไว้ · ไว้ให้หลังบ้านแสดงและแก้ */
create or replace function hub_out_zone_rows()
returns table (
  station   text,
  dir       text,
  in_wh     integer,
  on_truck  integer,
  zone      text,
  note      text,
  from_seed boolean
)
language sql stable security definer set search_path = public as $$
  select r.station, r.dir, r.in_wh, r.on_truck,
         z.zone, z.note, coalesce(z.from_seed, false)
    from hub_out_rows r
    left join hub_out_zones z on z.station = r.station
   where my_can_outbox()
     and r.snapshot_id = (select id from hub_out_snapshots order by snap_at desc limit 1)
   order by coalesce(nullif(btrim(z.zone), ''), 'zzz'), r.in_wh + r.on_truck desc;
$$;

grant execute on function hub_out_zone_rows() to authenticated;


/** ตั้งโซนของสาขาหนึ่ง · ส่งโซนว่างมาคือเอาออก */
create or replace function hub_out_zone_set(p_station text, p_zone text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not my_can_outbox() then
    raise exception 'บัญชีนี้ตั้งโซนไม่ได้';
  end if;
  if coalesce(btrim(p_station), '') = '' then
    raise exception 'ไม่ได้ระบุสาขา';
  end if;

  if coalesce(btrim(p_zone), '') = '' and coalesce(btrim(coalesce(p_note, '')), '') = '' then
    delete from hub_out_zones where station = p_station;
    return jsonb_build_object('ok', true, 'removed', true);
  end if;

  insert into hub_out_zones (station, zone, note, from_seed, updated_at, updated_by)
  values (p_station, nullif(upper(btrim(p_zone)), ''), nullif(btrim(coalesce(p_note, '')), ''),
          false, now(), auth.uid())
  on conflict (station) do update
    set zone = excluded.zone, note = excluded.note,
        from_seed = false, updated_at = now(), updated_by = auth.uid();

  return jsonb_build_object('ok', true);
end $$;

grant execute on function hub_out_zone_set(text, text, text) to authenticated;


/** ตั้งทีละหลายสาขาให้โซนเดียวกัน · ใช้ตอนไล่เก็บสาขาที่ยังว่าง */
create or replace function hub_out_zone_set_many(p_stations text[], p_zone text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not my_can_outbox() then
    raise exception 'บัญชีนี้ตั้งโซนไม่ได้';
  end if;

  insert into hub_out_zones (station, zone, from_seed, updated_at, updated_by)
  select s, nullif(upper(btrim(p_zone)), ''), false, now(), auth.uid()
    from unnest(coalesce(p_stations, '{}')) s
   where coalesce(btrim(s), '') <> ''
  on conflict (station) do update
    set zone = excluded.zone, from_seed = false, updated_at = now(), updated_by = auth.uid();

  get diagnostics v_n = row_count;
  return jsonb_build_object('n', v_n);
end $$;

grant execute on function hub_out_zone_set_many(text[], text) to authenticated;

select
  (select count(*) from pg_tables where tablename = 'hub_out_zones')   as tbl,
  (select count(*) from pg_proc where proname like 'hub_out_zone%')    as fns;
