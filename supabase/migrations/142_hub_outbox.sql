-- ---------------------------------------------------------------------
-- 142 · ของค้างส่งออก
--
-- ไฟล์ตรวจสอบการปล่อยรถของ HUB ที่ระบบส่งออกมาเป็น .xlsx ทุกครึ่งชั่วโมง
-- หน้างานเดิมวางไฟล์ลง Excel แล้ว VLOOKUP หรือไพวอทเอาเอง
--
-- ของสำคัญที่ไฟล์เดียวตอบไม่ได้คือ "ขึ้นหรือลงจากรอบที่แล้ว"
-- จึงเก็บเป็นภาพนิ่งรายรอบ แล้วให้ฐานข้อมูลเทียบรอบก่อนหน้าให้
--
-- กุญแจคือเวลาที่อยู่ในไฟล์เอง (ชีต th_update_time) ไม่ใช่เวลาที่กดอัป
-- ได้สามอย่างฟรี · อัปไฟล์เดิมซ้ำไม่เกิดข้อมูลซ้ำ · อัปย้อนหลังไม่ทับรอบล่าสุด
-- และรอบที่ลืมอัปจะเห็นเป็นรูบนกราฟ ไม่ได้หายเงียบ
--
-- รอบแรกเปิดให้เจ้าของระบบคนเดียวตามที่สั่ง · ด่านอยู่ที่ RLS ไม่ใช่แค่ซ่อนเมนู
-- ---------------------------------------------------------------------

create table if not exists hub_out_snapshots (
  id          bigserial primary key,
  /** เวลาที่ระบบ HUB ถ่ายข้อมูล · มาจากในไฟล์ ห้ามซ้ำ */
  snap_at     timestamptz not null unique,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid references profiles (id),
  file_name   text,
  row_count   integer not null default 0,
  truck_count integer not null default 0
);

create index if not exists hub_out_snap_idx on hub_out_snapshots (snap_at desc);

create table if not exists hub_out_rows (
  snapshot_id bigint not null references hub_out_snapshots (id) on delete cascade,
  /** LH สายหลัก · FD สายรอง */
  dir         text    not null,
  station     text    not null,
  /** เข้าคลังแต่ไม่สแกนออก — งานทีมคัดแยก */
  in_wh       integer not null default 0,
  /** สแกนออกแต่รถไม่ออก — งานทีมปล่อยรถ */
  on_truck    integer not null default 0,
  waiting     integer not null default 0,
  in_transit  integer not null default 0,
  arrived_in  integer not null default 0,
  bagged_in   integer not null default 0,
  fd_early    integer not null default 0,
  trucks      integer not null default 0,
  main_trucks integer not null default 0,
  extra_trucks integer not null default 0,
  approving   integer not null default 0,
  finding     integer not null default 0,
  printed     integer not null default 0,
  no_print    integer not null default 0,
  primary key (snapshot_id, dir, station)
);

create table if not exists hub_out_trucks (
  id          bigserial primary key,
  snapshot_id bigint not null references hub_out_snapshots (id) on delete cascade,
  dir         text    not null,
  station     text    not null,
  depart_at   timestamptz,
  vehicle     text,
  is_printed  boolean not null default false
);

create index if not exists hub_out_trucks_idx on hub_out_trucks (snapshot_id, station);

alter table hub_out_snapshots enable row level security;
alter table hub_out_rows      enable row level security;
alter table hub_out_trucks    enable row level security;

drop policy if exists own_hub_out_snapshots on hub_out_snapshots;
create policy own_hub_out_snapshots on hub_out_snapshots for all to authenticated
  using (my_is_owner()) with check (my_is_owner());

drop policy if exists own_hub_out_rows on hub_out_rows;
create policy own_hub_out_rows on hub_out_rows for all to authenticated
  using (my_is_owner()) with check (my_is_owner());

drop policy if exists own_hub_out_trucks on hub_out_trucks;
create policy own_hub_out_trucks on hub_out_trucks for all to authenticated
  using (my_is_owner()) with check (my_is_owner());


-- ---------------------------------------------------------------------
-- รับไฟล์หนึ่งรอบ
--
-- อัปรอบเดิมซ้ำ = ลบของเดิมของรอบนั้นแล้วใส่ใหม่ ไม่ใช่เพิ่มซ้อน
-- ทำในคำสั่งเดียว ถ้าพังกลางทางจะไม่เหลือรอบที่มีแถวครึ่ง ๆ กลาง ๆ
-- ---------------------------------------------------------------------
create or replace function hub_out_import(
  p_snap   timestamptz,
  p_file   text,
  p_rows   jsonb,
  p_trucks jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
  v_rows integer;
  v_trucks integer;
begin
  if not my_is_owner() then
    raise exception 'เฉพาะเจ้าของระบบเท่านั้นที่อัปไฟล์นี้ได้';
  end if;
  if p_snap is null then
    raise exception 'ไฟล์นี้ไม่มีเวลาในชีต th_update_time';
  end if;
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) = 0 then
    raise exception 'ไม่พบตารางรายสาขาในไฟล์';
  end if;

  insert into hub_out_snapshots (snap_at, uploaded_by, file_name)
  values (p_snap, auth.uid(), nullif(btrim(coalesce(p_file, '')), ''))
  on conflict (snap_at) do update
    set uploaded_at = now(), uploaded_by = auth.uid(), file_name = excluded.file_name
  returning id into v_id;

  delete from hub_out_rows   where snapshot_id = v_id;
  delete from hub_out_trucks where snapshot_id = v_id;

  insert into hub_out_rows (
    snapshot_id, dir, station, in_wh, on_truck, waiting, in_transit,
    arrived_in, bagged_in, fd_early, trucks, main_trucks, extra_trucks,
    approving, finding, printed, no_print
  )
  select v_id,
         r->>'dir',
         r->>'station',
         coalesce((r->>'in_wh')::int, 0),
         coalesce((r->>'on_truck')::int, 0),
         coalesce((r->>'waiting')::int, 0),
         coalesce((r->>'in_transit')::int, 0),
         coalesce((r->>'arrived_in')::int, 0),
         coalesce((r->>'bagged_in')::int, 0),
         coalesce((r->>'fd_early')::int, 0),
         coalesce((r->>'trucks')::int, 0),
         coalesce((r->>'main_trucks')::int, 0),
         coalesce((r->>'extra_trucks')::int, 0),
         coalesce((r->>'approving')::int, 0),
         coalesce((r->>'finding')::int, 0),
         coalesce((r->>'printed')::int, 0),
         coalesce((r->>'no_print')::int, 0)
    from jsonb_array_elements(p_rows) r
   where coalesce(btrim(r->>'station'), '') <> ''
  on conflict (snapshot_id, dir, station) do nothing;

  get diagnostics v_rows = row_count;

  insert into hub_out_trucks (snapshot_id, dir, station, depart_at, vehicle, is_printed)
  select v_id, t->>'dir', t->>'station',
         nullif(t->>'depart_at', '')::timestamptz,
         nullif(btrim(coalesce(t->>'vehicle', '')), ''),
         coalesce((t->>'printed')::boolean, false)
    from jsonb_array_elements(coalesce(p_trucks, '[]'::jsonb)) t
   where coalesce(btrim(t->>'station'), '') <> '';

  get diagnostics v_trucks = row_count;

  update hub_out_snapshots set row_count = v_rows, truck_count = v_trucks where id = v_id;

  return jsonb_build_object('id', v_id, 'rows', v_rows, 'trucks', v_trucks, 'snap_at', p_snap);
end $$;

grant execute on function hub_out_import(timestamptz, text, jsonb, jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- กระดาน · รอบล่าสุดพร้อมค่าของรอบก่อนหน้าให้เทียบ
--
-- เทียบกับ "รอบก่อนหน้าตามเวลาในไฟล์" ไม่ใช่รอบที่อัปก่อน
-- เพราะถ้าอัปย้อนหลัง ลำดับการอัปกับลำดับเวลาจริงจะไม่ตรงกัน
-- ---------------------------------------------------------------------
create or replace function hub_out_board()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_cur  hub_out_snapshots%rowtype;
  v_prev hub_out_snapshots%rowtype;
  v_rows jsonb;
begin
  if not my_is_owner() then
    raise exception 'บัญชีนี้ดูหน้านี้ไม่ได้';
  end if;

  select * into v_cur from hub_out_snapshots order by snap_at desc limit 1;
  if v_cur.id is null then
    return jsonb_build_object('snapshot', null, 'rows', '[]'::jsonb);
  end if;

  select * into v_prev
    from hub_out_snapshots where snap_at < v_cur.snap_at order by snap_at desc limit 1;

  select coalesce(jsonb_agg(x order by x->>'station'), '[]'::jsonb) into v_rows
    from (
      select jsonb_build_object(
               'dir', c.dir,
               'station', c.station,
               'in_wh', c.in_wh,
               'on_truck', c.on_truck,
               'prev_in', p.in_wh,
               'prev_on', p.on_truck,
               'waiting', c.waiting,
               'in_transit', c.in_transit,
               'trucks', c.trucks,
               'main_trucks', c.main_trucks,
               'extra_trucks', c.extra_trucks,
               'approving', c.approving,
               'finding', c.finding,
               'no_print', c.no_print,
               'trucks_list', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'at', to_char(t.depart_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI'),
                          'v', t.vehicle,
                          'p', t.is_printed)
                        order by t.depart_at)
                   from hub_out_trucks t
                  where t.snapshot_id = c.snapshot_id and t.station = c.station and t.dir = c.dir
               ), '[]'::jsonb)
             ) as x
        from hub_out_rows c
        left join hub_out_rows p
          on p.snapshot_id = v_prev.id and p.dir = c.dir and p.station = c.station
       where c.snapshot_id = v_cur.id
    ) q;

  return jsonb_build_object(
    'snapshot', jsonb_build_object(
      'id', v_cur.id,
      'snap_at', v_cur.snap_at,
      'uploaded_at', v_cur.uploaded_at,
      'file_name', v_cur.file_name,
      'row_count', v_cur.row_count,
      'truck_count', v_cur.truck_count,
      'prev_at', v_prev.snap_at
    ),
    'rows', v_rows
  );
end $$;

grant execute on function hub_out_board() to authenticated;


/** เวลาของรอบล่าสุด · ถามบ่อย ๆ ได้โดยไม่กิน egress เพราะตอบแค่บรรทัดเดียว */
create or replace function hub_out_latest() returns timestamptz
language sql stable security definer set search_path = public as $$
  select case when my_is_owner()
              then (select max(snap_at) from hub_out_snapshots) end;
$$;

grant execute on function hub_out_latest() to authenticated;


/** ถอนรอบที่เพิ่งอัป */
create or replace function hub_out_undo(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not my_is_owner() then
    raise exception 'เฉพาะเจ้าของระบบเท่านั้น';
  end if;
  delete from hub_out_snapshots where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function hub_out_undo(bigint) to authenticated;


/** รายการรอบที่อัปไว้ · ไว้ดูว่ารอบไหนขาด */
create or replace function hub_out_runs(p_limit integer default 48)
returns table (id bigint, snap_at timestamptz, uploaded_at timestamptz, row_count integer, truck_count integer)
language sql stable security definer set search_path = public as $$
  select s.id, s.snap_at, s.uploaded_at, s.row_count, s.truck_count
    from hub_out_snapshots s
   where my_is_owner()
   order by s.snap_at desc
   limit greatest(1, least(coalesce(p_limit, 48), 200));
$$;

grant execute on function hub_out_runs(integer) to authenticated;

select
  (select count(*) from pg_proc where proname = 'hub_out_import') as f_import,
  (select count(*) from pg_proc where proname = 'hub_out_board')  as f_board,
  (select count(*) from pg_proc where proname = 'hub_out_latest') as f_latest,
  (select count(*) from pg_tables where tablename like 'hub_out%') as tables;
