-- =====================================================================
-- BPL SUPPLY — ตารางปล่อยรถ (ชุดแรก)
-- รันต่อจาก 101 · ปลอดภัยที่จะรันซ้ำ
--
-- งานคนละเรื่องกับเบิกของ จึงแยกตารางของตัวเองทั้งหมด ไม่ไปปนกับของเดิม
-- ใช้ร่วมกันแค่ profiles กับระบบแจ้งเตือน ซึ่งเป็นเหตุผลที่เอามาไว้ในแอพนี้
--
-- ด่านสิทธิ์รอบแรก — เจ้าของระบบคนเดียว
--   เจ้าของขอให้สร้างไว้ดูก่อน ยังไม่เปิดให้หน้างานใช้
--   เปิดให้คนอื่นทีหลังคือแก้ policy ไฟล์เดียว ไม่ต้องแตะโครงสร้าง
--   ตั้งใจล็อกที่ RLS ไม่ใช่แค่ซ่อนเมนู เพราะซ่อนเมนูไม่ใช่การกันคน
--
-- ปริมาณที่ออกแบบเผื่อไว้ — วันละ 200-400 คัน ปีละราวแสนแถว
--   ดัชนีจึงผูกกับสองคำถามที่ถามจริง "คันไหนยังอยู่ในคลัง" กับ "ย้อนดูช่วงนี้"
--   ไม่ได้ทำดัชนีเผื่อทุกช่อง เพราะดัชนีที่ไม่มีใครใช้คือพื้นที่ที่เสียเปล่า
-- =====================================================================


-- ---------------------------------------------------------------------
-- สาขา
--
-- code ว่างได้ เพราะหน้างานพิมพ์ชื่อสาขาใหม่เองได้โดยไม่ต้องรู้รหัส
-- กันชื่อซ้ำด้วยดัชนีบน lower(name) ไม่ใช่ unique ตรง ๆ
-- เพราะ "บางนา" กับ "บางนา " ต้องนับเป็นอันเดียวกัน ไม่งั้นรายการเลือกจะมีสองอัน
-- ---------------------------------------------------------------------
create table if not exists truck_branches (
  id          bigserial primary key,
  code        text,
  name        text not null,
  full_name   text,
  branch_ref  text,
  kind        text,
  province    text,
  district    text,
  subdistrict text,
  -- สถานะเปิดบริการจากชีตต้นทาง · เชื่อไม่ได้ร้อยเปอร์เซ็นต์จึงไม่เอาไปซ่อนสาขา
  -- แค่ขึ้นป้ายบอก เพราะถ้าซ่อนแล้วข้อมูลผิด หน้างานจะหาสาขาไม่เจอทั้งที่รถจอดอยู่ตรงหน้า
  is_open     boolean not null default true,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references profiles(id)
);

create unique index if not exists truck_branches_name_uniq
  on truck_branches (lower(btrim(name)));
create unique index if not exists truck_branches_code_uniq
  on truck_branches (upper(btrim(code))) where code is not null and btrim(code) <> '';


-- ---------------------------------------------------------------------
-- รถหนึ่งคันที่เข้ามาหนึ่งรอบ
--
-- เก็บ branch_name ซ้ำไว้ในแถว ทั้งที่มี branch_id ชี้อยู่แล้ว
-- เพราะชื่อสาขาแก้ได้ และประวัติเมื่อสามเดือนก่อนต้องบอกว่าตอนนั้นเรียกว่าอะไร
-- เป็นกติกาเดียวกับที่ใบเบิกคัดลอกแผนกกับกะไว้ตอนเบิก
--
-- due_at เก็บเป็นค่าจริง ไม่ได้คำนวณสด
-- เพราะหน้าจอต้องนิ่ง เวลาที่ควรออกห้ามขยับหลังจากกดบันทึกแล้ว
-- ---------------------------------------------------------------------
create table if not exists truck_runs (
  id          bigserial primary key,
  branch_id   bigint references truck_branches(id) on delete set null,
  branch_name text not null,
  branch_code text,
  arrived_at  timestamptz not null,
  allow_min   integer not null default 120 check (allow_min between 5 and 1440),
  due_at      timestamptz not null,
  left_at     timestamptz,
  -- ช้าไปกี่นาที · 0 = ตรงเวลา · ว่าง = ยังไม่ปล่อย
  late_min    integer,
  note        text,
  created_by  uuid references profiles(id),
  closed_by   uuid references profiles(id),
  created_at  timestamptz not null default now()
);

-- "คันไหนยังอยู่ในคลัง" — คำถามที่ถามทุกวินาที ดัชนีบางส่วนจึงเล็กและเร็วเสมอ
create index if not exists truck_runs_open_idx on truck_runs (due_at) where left_at is null;
-- "ย้อนดูช่วงวันที่นี้" — ของแดชบอร์ด
create index if not exists truck_runs_time_idx on truck_runs (arrived_at desc);


-- ---------------------------------------------------------------------
-- ด่านสิทธิ์
-- ---------------------------------------------------------------------
create or replace function my_can_truck() returns boolean
language sql stable security definer set search_path = public as $$
  -- รอบแรกเปิดให้เจ้าของระบบคนเดียว · เปิดให้คนอื่นค่อยแก้ฟังก์ชันนี้ที่เดียว
  select my_role() = 'admin';
$$;

grant execute on function my_can_truck() to authenticated;

alter table truck_branches enable row level security;
alter table truck_runs     enable row level security;

drop policy if exists read_truck_branches on truck_branches;
create policy read_truck_branches on truck_branches for select to authenticated
  using (my_can_truck());

drop policy if exists read_truck_runs on truck_runs;
create policy read_truck_runs on truck_runs for select to authenticated
  using (my_can_truck());

-- ไม่มี policy เขียนโดยตั้งใจ · ทุกการเขียนผ่าน RPC ข้างล่างเท่านั้น
grant select on truck_branches, truck_runs to authenticated;


-- ---------------------------------------------------------------------
-- วิวสำหรับกระดาน · คันที่ยังไม่ปล่อย
-- ---------------------------------------------------------------------
drop view if exists truck_board_rows;
create view truck_board_rows
with (security_invoker = true) as
select
  r.id,
  r.branch_id,
  r.branch_name,
  r.branch_code,
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


-- ---------------------------------------------------------------------
-- วิวสำหรับสถิติ · คันที่ปล่อยแล้ว
-- ---------------------------------------------------------------------
drop view if exists truck_done_rows;
create view truck_done_rows
with (security_invoker = true) as
select
  r.id,
  r.branch_id,
  r.branch_name,
  r.branch_code,
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
left join profiles p on p.id = r.created_by
left join profiles c on c.id = r.closed_by
where r.left_at is not null;

grant select on truck_done_rows to authenticated;


-- ---------------------------------------------------------------------
-- เพิ่มรถเข้าคลัง
--
-- รับได้ทั้งสาขาที่เลือกจากรายการและสาขาที่พิมพ์ชื่อใหม่มาเลย
-- ชื่อใหม่จะถูกสร้างเป็นสาขาให้เองโดยอัตโนมัติ ไม่ต้องให้หน้างานไปสร้างก่อน
-- เพราะรถมาจอดอยู่แล้ว การบังคับให้ไปสร้างสาขาก่อนคือการขวางงานที่ด่วนกว่า
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

  insert into truck_runs (branch_id, branch_name, branch_code, arrived_at, allow_min, due_at, note, created_by)
  values (v_b.id, v_b.name, v_b.code, v_at, p_min,
          v_at + make_interval(mins => p_min),
          nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'branch', v_b.name, 'new_branch', (v_b.created_by = auth.uid()));
end $$;

grant execute on function truck_add(text, timestamptz, integer, text) to authenticated;


-- ---------------------------------------------------------------------
-- ปล่อยรถ · กดครั้งเดียวจบ ไม่ถามยืนยัน
--
-- วันละ 300 คัน การถามยืนยันทุกครั้งคือการถาม 300 ครั้งต่อวัน
-- ซึ่งคนจะกดผ่านโดยไม่อ่านอยู่ดี จึงให้กดเลิกทำได้แทนการถามก่อน
-- ---------------------------------------------------------------------
create or replace function truck_release(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_r truck_runs%rowtype;
  v_late integer;
begin
  if not my_can_truck() then
    raise exception 'บัญชีนี้ยังใช้ตารางปล่อยรถไม่ได้';
  end if;

  select * into v_r from truck_runs where id = p_id and left_at is null;
  if v_r.id is null then
    raise exception 'ไม่พบคันนี้ หรือปล่อยไปแล้ว';
  end if;

  v_late := greatest(0, ceil(extract(epoch from (now() - v_r.due_at)) / 60))::int;

  update truck_runs
     set left_at = now(), late_min = v_late, closed_by = auth.uid()
   where id = p_id;

  return jsonb_build_object('ok', true, 'id', p_id, 'late_min', v_late);
end $$;

grant execute on function truck_release(bigint) to authenticated;


-- เลิกทำ · ได้ภายใน 10 นาทีหลังกดปล่อย กดผิดคันเกิดขึ้นจริงตอนงานชุก
create or replace function truck_unrelease(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_at timestamptz;
begin
  if not my_can_truck() then
    raise exception 'บัญชีนี้ยังใช้ตารางปล่อยรถไม่ได้';
  end if;

  select left_at into v_at from truck_runs where id = p_id;
  if v_at is null then
    raise exception 'คันนี้ยังไม่ได้ปล่อย';
  end if;
  if v_at < now() - interval '10 minutes' then
    raise exception 'เลิกทำได้ภายใน 10 นาทีหลังกดปล่อยเท่านั้น';
  end if;

  update truck_runs set left_at = null, late_min = null, closed_by = null where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function truck_unrelease(bigint) to authenticated;


-- ---------------------------------------------------------------------
-- เพิ่มสาขาทีละหลายอัน
--
-- รับทั้ง "2BNA01 บางนา" "2BNA01,บางนา" และ "บางนา" เฉย ๆ
-- เพราะคนวางข้อมูลมาจากที่ต่างกัน และการบังคับรูปแบบเดียวแปลว่า
-- คนต้องไปจัดข้อมูลก่อนวาง ซึ่งเป็นงานที่เครื่องทำแทนได้
-- ---------------------------------------------------------------------
create or replace function truck_branches_add(p_lines text[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_line  text;
  v_code  text;
  v_name  text;
  v_added integer := 0;
  v_skip  integer := 0;
  v_parts text[];
begin
  if my_role() not in ('supervisor', 'admin') and not my_can_audit() then
    raise exception 'ไม่มีสิทธิ์แก้รายชื่อสาขา';
  end if;

  foreach v_line in array coalesce(p_lines, '{}') loop
    v_line := btrim(regexp_replace(coalesce(v_line, ''), E'[\t,]+', ' ', 'g'));
    if v_line = '' then continue; end if;

    v_parts := regexp_split_to_array(v_line, '\s+');
    -- ขึ้นต้นด้วยรหัสแบบ 2BNA01 ถึงจะนับว่าช่องแรกเป็นรหัส
    if array_length(v_parts, 1) > 1 and v_parts[1] ~ '^[0-9A-Za-z]{3,10}$' and v_parts[1] ~ '[0-9]' then
      v_code := upper(v_parts[1]);
      v_name := btrim(array_to_string(v_parts[2:array_length(v_parts, 1)], ' '));
    else
      v_code := null;
      v_name := v_line;
    end if;

    if exists (select 1 from truck_branches where lower(btrim(name)) = lower(v_name))
       or (v_code is not null and exists (select 1 from truck_branches where upper(btrim(code)) = v_code)) then
      v_skip := v_skip + 1;
      continue;
    end if;

    insert into truck_branches (code, name, created_by) values (v_code, v_name, auth.uid());
    v_added := v_added + 1;
  end loop;

  return jsonb_build_object('ok', true, 'added', v_added, 'skipped', v_skip);
end $$;

grant execute on function truck_branches_add(text[]) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_name in ('truck_branches', 'truck_runs'))          as ตารางที่สร้าง,
  (select count(*) from pg_proc
    where proname in ('truck_add', 'truck_release', 'truck_unrelease',
                      'truck_branches_add', 'my_can_truck'))       as ฟังก์ชันที่สร้าง,
  (select count(*) from truck_branches)                            as สาขาที่มี,
  (select count(*) from truck_runs)                                as รถที่บันทึกแล้ว;
