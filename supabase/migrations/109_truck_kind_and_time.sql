-- =====================================================================
-- BPL SUPPLY — รถหลัก/รถเสริม และกรอกเวลาถึงคลังย้อนหลังได้
-- รันต่อจาก 108 · ปลอดภัยที่จะรันซ้ำ
--
-- เดิมป้ายบนการ์ดบอกแค่ "คันที่ 2" ซึ่งบอกลำดับ แต่ไม่ได้บอกว่าคันนั้นคืออะไร
-- หน้างานแยกรถหลักกับรถเสริมอยู่แล้วในหัว ป้ายจึงควรพูดภาษาเดียวกับเขา
--
-- เวลาถึงคลังรับค่าที่กรอกเองได้ เพราะบางทีลืมกดตอนรถเข้าจริง
-- แต่ต้องกันค่าที่เป็นไปไม่ได้ ไม่งั้นพิมพ์ผิดทีเดียวรถจะไปโผล่ปีหน้า
-- =====================================================================

alter table truck_runs add column if not exists kind text not null default 'main';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'truck_runs_kind_ck') then
    alter table truck_runs add constraint truck_runs_kind_ck check (kind in ('main', 'extra'));
  end if;
end $$;

comment on column truck_runs.kind is
  'main = รถหลัก · extra = รถเสริม';


-- ---------------------------------------------------------------------
-- วิวทั้งสองตัวส่งประเภทรถออกมาด้วย
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
  r.kind,
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
  r.kind,
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
-- เพิ่มรถ · รับประเภทรถ และรับเวลาถึงคลังที่กรอกเอง
--
-- ย้อนหลังได้ไม่เกินเจ็ดวัน และล่วงหน้าได้ไม่เกินหนึ่งชั่วโมง
-- ล่วงหน้านิดหน่อยต้องรับได้ เพราะนาฬิกาเครื่องหน้างานกับเซิร์ฟเวอร์ไม่ตรงกันเป๊ะ
-- แต่เกินกว่านั้นคือพิมพ์ผิด ซึ่งถ้าปล่อยผ่านจะได้รถที่ไม่มีวันครบกำหนด
-- ---------------------------------------------------------------------
-- ตัวเดิมรับสี่ตัวแปร ต้องทิ้งก่อน ไม่งั้นจะมีสองตัวชื่อเดียวกัน
-- แล้ว PostgREST จะเลือกไม่ถูกว่าหน้าเว็บเรียกตัวไหน
drop function if exists truck_add(text, timestamptz, integer, text);

create or replace function truck_add(
  p_name    text,
  p_arrived timestamptz default null,
  p_min     integer default 120,
  p_note    text default null,
  p_kind    text default 'main'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_kind text := case when lower(coalesce(p_kind,'')) = 'extra' then 'extra' else 'main' end;
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
  if v_at < now() - interval '7 days' then
    raise exception 'เวลาถึงคลังย้อนหลังได้ไม่เกิน 7 วัน';
  end if;
  if v_at > now() + interval '1 hour' then
    raise exception 'เวลาถึงคลังล่วงหน้าได้ไม่เกิน 1 ชั่วโมง · ตรวจเวลาที่กรอกอีกครั้ง';
  end if;

  select * into v_b from truck_branches
   where lower(btrim(name)) = lower(v_name)
      or (code is not null and upper(btrim(code)) = upper(v_name))
   limit 1;

  if v_b.id is null then
    insert into truck_branches (name, created_by) values (v_name, auth.uid())
    returning * into v_b;
  end if;

  insert into truck_runs (branch_id, branch_name, branch_code, zone, kind,
                          arrived_at, allow_min, due_at, note, created_by)
  values (v_b.id, v_b.name, v_b.code, v_b.zone, v_kind, v_at, p_min,
          v_at + make_interval(mins => p_min),
          nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'branch', v_b.name,
                            'zone', v_b.zone, 'kind', v_kind, 'arrived', v_at);
end $$;

grant execute on function truck_add(text, timestamptz, integer, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'truck_runs' and column_name = 'kind')          as มีช่องประเภทรถ,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'truck_add' and n.nspname = 'public'
      and pg_get_function_arguments(p.oid) like '%p_kind%')            as truck_addรับประเภทแล้ว,
  (select count(*) from truck_runs where kind = 'main')                as รถหลักตอนนี้,
  (select count(*) from truck_runs where kind = 'extra')               as รถเสริมตอนนี้;
