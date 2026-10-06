-- =====================================================================
-- BPL SUPPLY — โซนของสาขา (เลขสายพาน) และตัวนำเข้ารายชื่อสาขาจากชีต
-- รันต่อจาก 107 · ปลอดภัยที่จะรันซ้ำ
--
-- ชีตขององค์กรมีคอลัมน์ "เลขสายพาน" ค่าเป็น D04 D05 D06 D07 D08 ...
-- หน้าเว็บจะไม่ใช้คำว่าเลขสายพาน ใช้คำว่า "โซน" แทน ตามที่เจ้าของระบบสั่ง
-- ชื่อคอลัมน์ในฐานข้อมูลจึงเป็น zone เพื่อให้ตรงกับคำที่คนอ่านเห็นบนจอ
--
-- เก็บโซนซ้ำไว้ที่ truck_runs ด้วย ไม่ใช่อ่านจากสาขาอย่างเดียว
-- เพราะวันที่มีการย้ายสาขาไปสายพานอื่น ประวัติเก่าต้องยังบอกว่าตอนนั้นอยู่สายไหน
-- ไม่ใช่ถูกเขียนทับให้กลายเป็นสายใหม่ย้อนหลังทั้งหมด
-- =====================================================================

alter table truck_branches add column if not exists zone text;
alter table truck_runs     add column if not exists zone text;

comment on column truck_branches.zone is
  'โซน · มาจากคอลัมน์เลขสายพานในชีตขององค์กร เช่น D04 D05';
comment on column truck_runs.zone is
  'โซนตอนที่รถเข้าคลัง · เก็บซ้ำไว้เพื่อให้ประวัติเก่าไม่เปลี่ยนตามสาขา';

create index if not exists truck_runs_zone_idx on truck_runs (zone) where left_at is null;


-- ---------------------------------------------------------------------
-- วิวทั้งสองตัวต้องส่งโซนออกมาด้วย
-- ---------------------------------------------------------------------
drop view if exists truck_board_rows;
create view truck_board_rows
with (security_invoker = true) as
select
  r.id,
  r.branch_id,
  r.branch_name,
  r.branch_code,
  coalesce(r.zone, b.zone) as zone,
  b.full_name   as branch_full,
  b.province,
  b.district,
  b.subdistrict,
  r.arrived_at,
  r.allow_min,
  r.due_at,
  r.note,
  p.full_name   as by_name,
  (extract(epoch from (r.due_at - now())) / 60)::int as left_min
from truck_runs r
left join truck_branches b on b.id = r.branch_id
left join profiles p       on p.id = r.created_by
where r.left_at is null;

grant select on truck_board_rows to authenticated;


drop view if exists truck_done_rows;
create view truck_done_rows
with (security_invoker = true) as
select
  r.id,
  r.branch_id,
  r.branch_name,
  r.branch_code,
  coalesce(r.zone, b.zone) as zone,
  r.arrived_at,
  r.allow_min,
  r.due_at,
  r.left_at,
  r.late_min,
  (r.late_min = 0)                                        as on_time,
  (extract(epoch from (r.left_at - r.arrived_at)) / 60)::int as dwell_min,
  r.note,
  p.full_name as by_name,
  c.full_name as closed_by_name
from truck_runs r
left join truck_branches b on b.id = r.branch_id
left join profiles p on p.id = r.created_by
left join profiles c on c.id = r.closed_by
where r.left_at is not null;

grant select on truck_done_rows to authenticated;


-- ---------------------------------------------------------------------
-- เพิ่มรถ · ติดโซนของสาขานั้นไปกับรถด้วย
-- ---------------------------------------------------------------------
create or replace function truck_add(
  p_name    text,
  p_arrived timestamptz default null,
  p_min     integer default 120,
  p_note    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_b    truck_branches%rowtype;
  v_at   timestamptz := coalesce(p_arrived, now());
  v_id   bigint;
begin
  if not my_can_truck() then
    raise exception 'บัญชีนี้ยังใช้ตารางปล่อยรถไม่ได้';
  end if;
  if v_name = '' then
    raise exception 'ต้องใส่ชื่อสาขา';
  end if;

  select * into v_b from truck_branches
   where lower(btrim(name)) = lower(v_name)
      or (code is not null and upper(btrim(code)) = upper(v_name))
   limit 1;

  if v_b.id is null then
    insert into truck_branches (name, created_by) values (v_name, auth.uid())
    returning * into v_b;
  end if;

  insert into truck_runs (branch_id, branch_name, branch_code, zone, arrived_at, allow_min, due_at, note, created_by)
  values (v_b.id, v_b.name, v_b.code, v_b.zone, v_at, p_min,
          v_at + make_interval(mins => p_min),
          nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'branch', v_b.name, 'zone', v_b.zone);
end $$;

grant execute on function truck_add(text, timestamptz, integer, text) to authenticated;


-- ---------------------------------------------------------------------
-- หน้าหลังบ้านแก้สาขาได้ · เพิ่มช่องโซน
-- ---------------------------------------------------------------------
create or replace function truck_branch_save(
  p_id          bigint,
  p_name        text,
  p_code        text default null,
  p_full        text default null,
  p_province    text default null,
  p_district    text default null,
  p_subdistrict text default null,
  p_ref         text default null,
  p_open        boolean default true,
  p_active      boolean default true,
  p_zone        text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if my_role() <> 'admin' then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่แก้รายชื่อสาขาได้';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'ต้องใส่ชื่อสาขา';
  end if;

  if p_id is null then
    insert into truck_branches (name, code, full_name, province, district, subdistrict,
                                branch_ref, is_open, is_active, zone, created_by)
    values (btrim(p_name), nullif(btrim(coalesce(p_code,'')),''), nullif(btrim(coalesce(p_full,'')),''),
            nullif(btrim(coalesce(p_province,'')),''), nullif(btrim(coalesce(p_district,'')),''),
            nullif(btrim(coalesce(p_subdistrict,'')),''), nullif(btrim(coalesce(p_ref,'')),''),
            coalesce(p_open, true), coalesce(p_active, true),
            nullif(upper(btrim(coalesce(p_zone,''))),''), auth.uid())
    returning id into v_id;
  else
    update truck_branches set
      name        = btrim(p_name),
      code        = nullif(btrim(coalesce(p_code,'')),''),
      full_name   = nullif(btrim(coalesce(p_full,'')),''),
      province    = nullif(btrim(coalesce(p_province,'')),''),
      district    = nullif(btrim(coalesce(p_district,'')),''),
      subdistrict = nullif(btrim(coalesce(p_subdistrict,'')),''),
      branch_ref  = nullif(btrim(coalesce(p_ref,'')),''),
      is_open     = coalesce(p_open, true),
      is_active   = coalesce(p_active, true),
      zone        = nullif(upper(btrim(coalesce(p_zone,''))),'')
    where id = p_id
    returning id into v_id;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

grant execute on function truck_branch_save(bigint, text, text, text, text, text, text, text, boolean, boolean, text)
  to authenticated;


-- ---------------------------------------------------------------------
-- นำเข้ารายชื่อสาขาทั้งก้อนจากชีต
--
-- จับคู่ด้วยรหัสสาขา ไม่ใช่ชื่อ เพราะชื่อไทยสะกดกันคนละแบบได้
-- แต่รหัสเป็นของที่องค์กรออกให้และไม่เปลี่ยน
--
-- ชื่อไทยซ้ำกันข้ามสาขาได้จริง เช่น ปราณบุรี มีทั้ง 2PNB และ 7PNB
-- ตารางนี้บังคับชื่อไม่ซ้ำ เพราะหน้างานพิมพ์ชื่อไทยเพื่อเพิ่มรถ
-- ถ้าชื่อซ้ำ ระบบจะไม่รู้ว่าหมายถึงคันไหน จึงต่อรหัสท้ายชื่อให้ตัวที่มาทีหลัง
-- ---------------------------------------------------------------------
create or replace function truck_branches_import(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r         jsonb;
  v_code    text;
  v_full    text;
  v_name    text;
  v_zone    text;
  v_open    boolean;
  v_id      bigint;
  v_added   int := 0;
  v_updated int := 0;
  v_renamed int := 0;
begin
  if my_role() <> 'admin' then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่นำเข้ารายชื่อสาขาได้';
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_code := upper(btrim(coalesce(r->>'code', '')));
    v_full := btrim(coalesce(r->>'full', ''));
    v_zone := nullif(upper(btrim(coalesce(r->>'zone', ''))), '');
    v_open := coalesce(r->>'open', '') like 'เปิด%';
    -- ชื่อไทยคือส่วนที่อยู่หลังขีดกลางตัวสุดท้าย เช่น 2TND_BDC-ท่านัด จะได้ ท่านัด
    v_name := btrim(regexp_replace(v_full, '^.*-', ''));
    if v_name = '' then v_name := v_full; end if;
    continue when v_code = '' or v_name = '';

    select id into v_id from truck_branches where upper(btrim(code)) = v_code limit 1;

    if exists (select 1 from truck_branches b
                where lower(btrim(b.name)) = lower(v_name)
                  and (v_id is null or b.id <> v_id)) then
      v_name := v_name || ' ' || v_code;
      v_renamed := v_renamed + 1;
    end if;

    if v_id is null then
      insert into truck_branches
        (name, code, full_name, kind, province, district, subdistrict, branch_ref, zone,
         is_open, is_active, created_by)
      values
        (v_name, v_code, nullif(v_full,''),
         nullif(btrim(coalesce(r->>'kind','')),''),
         nullif(btrim(coalesce(r->>'prov','')),''),
         nullif(btrim(coalesce(r->>'dist','')),''),
         nullif(btrim(coalesce(r->>'sub','')),''),
         nullif(btrim(coalesce(r->>'ref','')),''),
         v_zone, v_open, true, auth.uid());
      v_added := v_added + 1;
    else
      update truck_branches set
        name        = v_name,
        full_name   = coalesce(nullif(v_full,''), full_name),
        kind        = coalesce(nullif(btrim(coalesce(r->>'kind','')),''), kind),
        province    = coalesce(nullif(btrim(coalesce(r->>'prov','')),''), province),
        district    = coalesce(nullif(btrim(coalesce(r->>'dist','')),''), district),
        subdistrict = coalesce(nullif(btrim(coalesce(r->>'sub','')),''), subdistrict),
        branch_ref  = coalesce(nullif(btrim(coalesce(r->>'ref','')),''), branch_ref),
        zone        = coalesce(v_zone, zone),
        is_open     = v_open,
        is_active   = true
      where id = v_id;
      v_updated := v_updated + 1;
    end if;
  end loop;

  -- รถที่ยังอยู่ในคลังและยังไม่มีโซน ให้ไปหยิบจากสาขามาเติม
  update truck_runs r set zone = b.zone
    from truck_branches b
   where b.id = r.branch_id and r.zone is null and b.zone is not null;

  return jsonb_build_object('added', v_added, 'updated', v_updated, 'renamed', v_renamed);
end $$;

grant execute on function truck_branches_import(jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'truck_branches' and column_name = 'zone')  as มีช่องโซนที่สาขา,
  (select count(*) from information_schema.columns
    where table_name = 'truck_runs' and column_name = 'zone')      as มีช่องโซนที่รถ,
  (select count(*) from pg_proc where proname = 'truck_branches_import') as มีตัวนำเข้า,
  (select count(*) from truck_branches)                            as สาขาตอนนี้;
