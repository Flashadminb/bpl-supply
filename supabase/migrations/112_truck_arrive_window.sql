-- =====================================================================
-- BPL SUPPLY — เปิดให้กรอกเวลาถึงคลังล่วงหน้าได้
-- รันต่อจาก 111 · ปลอดภัยที่จะรันซ้ำ
--
-- ของเดิมล่วงหน้าได้แค่ 1 ชั่วโมง เผื่อไว้แค่นาฬิกาเครื่องไม่ตรงกัน
-- แต่ของจริงมีคนกรอกตอนตีสามว่ารถจะถึงตอนตีห้า ซึ่งคือการจองคิวล่วงหน้า
-- ไม่ใช่การพิมพ์ผิด · ปิดไว้แล้วเขาจะไปกรอกเวลาปลอมแทน ซึ่งแย่กว่า
--
-- ล่วงหน้าได้ 12 ชั่วโมง ย้อนหลังได้ 7 วันเหมือนเดิม
-- เกินกว่านั้นคือพิมพ์ผิดจริง ๆ ยังปฏิเสธเหมือนเดิม
-- =====================================================================

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
  if v_at > now() + interval '12 hours' then
    raise exception 'เวลาถึงคลังล่วงหน้าได้ไม่เกิน 12 ชั่วโมง · ตรวจวันที่และเวลาที่กรอกอีกครั้ง';
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
-- ตรวจผล · และดูรอบตีสามของวันนี้ด้วย
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc
    where proname = 'truck_add' and prosrc like '%12 hours%')                    as ล่วงหน้า12ชมแล้ว,
  to_char(truck_cycle_start() at time zone 'Asia/Bangkok', 'DD/MM HH24:MI')      as รอบนี้เริ่ม,
  to_char((truck_cycle_start() + interval '1 day') at time zone 'Asia/Bangkok',
          'DD/MM HH24:MI')                                                       as รอบนี้จบ,
  to_char(now() at time zone 'Asia/Bangkok', 'DD/MM HH24:MI')                     as ตอนนี้;
