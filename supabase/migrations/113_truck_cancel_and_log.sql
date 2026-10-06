-- =====================================================================
-- BPL SUPPLY — ยกเลิกรถพร้อมเหตุผล และประวัติการแก้ไข
-- รันต่อจาก 112 · ปลอดภัยที่จะรันซ้ำ
--
-- ยกเลิกไม่ใช่ลบ · แถวยังอยู่ครบ แค่ติดธงว่ายกเลิกแล้วพร้อมเหตุผลและคนกด
-- ถ้าลบจริง วันที่มีคนถามว่าทำไมรถคันนั้นหายไป จะไม่มีอะไรให้ตอบเลย
--
-- บังคับใส่เหตุผลทุกครั้ง เพราะปุ่มที่กดแล้วของหายโดยไม่ต้องอธิบาย
-- คือปุ่มที่วันหนึ่งจะถูกใช้ลบสิ่งที่ไม่อยากให้ใครเห็น
-- =====================================================================

alter table truck_runs add column if not exists cancelled_at  timestamptz;
alter table truck_runs add column if not exists cancelled_by  uuid references profiles(id);
alter table truck_runs add column if not exists cancel_reason text;

comment on column truck_runs.cancelled_at is
  'ยกเลิกเมื่อไหร่ · ว่างคือยังไม่ยกเลิก · แถวไม่เคยถูกลบจริง';

create index if not exists truck_runs_cancelled_idx
  on truck_runs (cancelled_at desc) where cancelled_at is not null;


-- ---------------------------------------------------------------------
-- วิวกระดานกับวิวสถิติ ต้องไม่นับคันที่ยกเลิกแล้ว
-- ---------------------------------------------------------------------
drop view if exists truck_board_rows;
create view truck_board_rows
with (security_invoker = true) as
select
  r.id, r.branch_id, r.branch_name, r.branch_code,
  coalesce(r.zone, b.zone) as zone,
  r.kind,
  b.full_name as branch_full, b.province, b.district, b.subdistrict,
  r.arrived_at, r.allow_min, r.due_at, r.note,
  p.full_name as by_name,
  (extract(epoch from (r.due_at - now())) / 60)::int as left_min
from truck_runs r
left join truck_branches b on b.id = r.branch_id
left join profiles p       on p.id = r.created_by
where r.left_at is null and r.cancelled_at is null;

grant select on truck_board_rows to authenticated;


drop view if exists truck_done_rows;
create view truck_done_rows
with (security_invoker = true) as
select
  r.id, r.branch_id, r.branch_name, r.branch_code,
  coalesce(r.zone, b.zone) as zone,
  r.kind,
  r.arrived_at, r.allow_min, r.due_at, r.left_at, r.late_min,
  (r.late_min = 0) as on_time,
  (extract(epoch from (r.left_at - r.arrived_at)) / 60)::int as dwell_min,
  r.note,
  p.full_name as by_name,
  c.full_name as closed_by_name
from truck_runs r
left join truck_branches b on b.id = r.branch_id
left join profiles p on p.id = r.created_by
left join profiles c on c.id = r.closed_by
where r.left_at is not null and r.cancelled_at is null;

grant select on truck_done_rows to authenticated;


-- ---------------------------------------------------------------------
-- ยกเลิกรถ
-- ---------------------------------------------------------------------
create or replace function truck_cancel(p_id bigint, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_name   text;
begin
  if not my_can_truck() then
    raise exception 'บัญชีนี้ยังใช้ตารางปล่อยรถไม่ได้';
  end if;
  if v_reason = '' then
    raise exception 'ต้องใส่เหตุผลที่ยกเลิก';
  end if;

  update truck_runs
     set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = left(v_reason, 300)
   where id = p_id and cancelled_at is null
  returning branch_name into v_name;

  if v_name is null then
    raise exception 'ไม่พบรถคันนี้ หรือถูกยกเลิกไปแล้ว';
  end if;

  return jsonb_build_object('ok', true, 'branch', v_name);
end $$;

grant execute on function truck_cancel(bigint, text) to authenticated;


-- ---------------------------------------------------------------------
-- ประวัติการแก้ไข · สามเหตุการณ์ของรถคันเดียวกันแตกเป็นสามบรรทัด
--
-- ไม่ได้ทำตารางล็อกแยก เพราะทุกอย่างที่ต้องรู้อยู่ในแถวของรถอยู่แล้ว
-- ตารางล็อกที่ซ้ำกับของเดิม คือของอีกชุดที่ต้องคอยดูแลให้ตรงกัน
-- ---------------------------------------------------------------------
drop view if exists truck_log_rows;
create view truck_log_rows
with (security_invoker = true) as
select
  r.id                                   as run_id,
  'add'::text                            as event,
  r.created_at                           as at,
  r.branch_name, r.branch_code,
  coalesce(r.zone, b.zone)               as zone,
  r.kind,
  r.arrived_at, r.due_at, r.allow_min,
  null::text                             as reason,
  pa.full_name                           as who
from truck_runs r
left join truck_branches b on b.id = r.branch_id
left join profiles pa on pa.id = r.created_by

union all

select
  r.id, 'release', r.left_at,
  r.branch_name, r.branch_code, coalesce(r.zone, b.zone), r.kind,
  r.arrived_at, r.due_at, r.allow_min,
  case when r.late_min = 0 then 'ตรงเวลา' else 'เลย ' || r.late_min || ' นาที' end,
  pc.full_name
from truck_runs r
left join truck_branches b on b.id = r.branch_id
left join profiles pc on pc.id = r.closed_by
where r.left_at is not null

union all

select
  r.id, 'cancel', r.cancelled_at,
  r.branch_name, r.branch_code, coalesce(r.zone, b.zone), r.kind,
  r.arrived_at, r.due_at, r.allow_min,
  r.cancel_reason,
  px.full_name
from truck_runs r
left join truck_branches b on b.id = r.branch_id
left join profiles px on px.id = r.cancelled_by
where r.cancelled_at is not null;

grant select on truck_log_rows to authenticated;


-- ---------------------------------------------------------------------
-- ตัวนับ · เพิ่มจำนวนที่ยกเลิกในรอบนี้
-- ---------------------------------------------------------------------
create or replace function truck_counts()
returns jsonb
language sql stable security definer set search_path = public as $$
  with c as (
    select
      truck_cycle_start()                    as cycle_start,
      truck_cycle_start() + interval '1 day' as cycle_end,
      greatest(
        truck_cycle_start(),
        coalesce((select count_since from truck_alert_settings where id), truck_cycle_start())
      )                                      as since
  )
  select jsonb_build_object(
    'in_hub',  (select count(*) from truck_runs
                 where left_at is null and cancelled_at is null),
    'late',    (select count(*) from truck_runs
                 where left_at is null and cancelled_at is null and now() > due_at),
    'soon',    (select count(*) from truck_runs
                 where left_at is null and cancelled_at is null and now() <= due_at
                   and now() > due_at - interval '20 minutes'),
    'done',    (select count(*) from truck_runs r, c
                 where r.left_at is not null and r.cancelled_at is null and r.left_at >= c.since),
    'on_time', (select count(*) from truck_runs r, c
                 where r.left_at is not null and r.cancelled_at is null
                   and r.left_at >= c.since and r.late_min = 0),
    'cancelled', (select count(*) from truck_runs r, c
                   where r.cancelled_at is not null and r.cancelled_at >= c.since),
    'since',       (select since from c),
    'cycle_start', (select cycle_start from c),
    'cycle_end',   (select cycle_end from c)
  )
  from c
  where my_can_truck();
$$;

grant execute on function truck_counts() to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'truck_runs' and column_name = 'cancelled_at') as มีช่องยกเลิก,
  (select count(*) from pg_proc where proname = 'truck_cancel')        as มีฟังก์ชันยกเลิก,
  (select count(*) from pg_views where viewname = 'truck_log_rows')    as มีวิวประวัติ,
  (select count(*) from truck_log_rows)                                as บรรทัดประวัติตอนนี้;
