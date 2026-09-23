-- =====================================================================
-- BPL SUPPLY — เช็คอินเข้าประชุม
-- รันต่อจาก 032 · ปลอดภัยที่จะรันซ้ำ
--
-- หน้างานกดไอคอนเดียว ถ่ายเซลฟี่ ส่ง จบ
-- ชื่อ เวลา แผนก กะ ระบบเติมให้เองทั้งหมด ไม่ต้องกรอกอะไรเลย
-- เพราะทุกช่องที่ให้กรอกเองคือช่องที่กรอกผิดได้ และงานนี้ไม่มีอะไรต้องกรอก
--
-- เวลาที่บันทึกใช้ now() ของฐานข้อมูล ไม่ได้เชื่อนาฬิกาในเครื่อง
-- ไม่งั้นคนที่ตั้งเวลามือถือเองจะเช็คอินย้อนหลังได้
--
--   meeting_checkins        หนึ่งแถวต่อการเช็คอินหนึ่งครั้ง
--   meeting_rows            วิวที่พ่วงชื่อ รหัส แผนก มาให้พร้อมใช้
--   meeting_sheet_exports   กันส่งซ้ำลง Google Sheet
-- =====================================================================

do $$ begin
  create type meeting_status as enum ('pending', 'confirmed', 'rejected');
exception when duplicate_object then null; end $$;

create sequence if not exists meeting_ref_seq;

create or replace function next_meeting_ref() returns text
language sql volatile as $$
  select 'MTG-' || to_char((now() at time zone 'Asia/Bangkok'), 'YYMMDD')
      || '-' || lpad(nextval('meeting_ref_seq')::text, 4, '0');
$$;

create table if not exists meeting_checkins (
  id          uuid primary key default gen_random_uuid(),
  ref_no      text unique not null,
  user_id     uuid not null references profiles(id),
  hub_code    text not null default 'BPL',
  -- คัดลอกแผนกและกะไว้ตอนเช็คอิน ไม่ได้ join สด
  -- เพราะคนย้ายแผนกได้ แล้วประวัติเก่าต้องบอกว่าตอนนั้นอยู่แผนกไหน
  dept_code   text,
  sub_dept    text,
  shift_start time,
  shift_end   time,
  note        text,
  file_id     text not null,
  web_link    text,
  bytes       integer,
  status      meeting_status not null default 'pending',
  decided_by  uuid references profiles(id),
  decided_at  timestamptz,
  decide_note text,
  created_at  timestamptz not null default now()
);

create index if not exists meeting_user_idx on meeting_checkins (user_id, created_at desc);
create index if not exists meeting_date_idx on meeting_checkins (created_at desc);
create index if not exists meeting_open_idx on meeting_checkins (created_at desc) where status = 'pending';


-- ---------------------------------------------------------------------
-- ใครตรวจสอบรายชื่อประชุมได้ — แอดมิน เจ้าของระบบ และผู้ตรวจสอบ
-- ---------------------------------------------------------------------
create or replace function my_can_audit() returns boolean
language sql stable security definer set search_path = public as $$
  select my_role() in ('supervisor', 'admin') or my_can_dispatch();
$$;

grant execute on function my_can_audit() to authenticated;


-- ---------------------------------------------------------------------
-- View: รายชื่อประชุมพร้อมชื่อคน
--
-- day เป็นวันที่ตามเวลาไทย ไม่ใช่ UTC
-- ประชุมรอบดึกข้ามเที่ยงคืน UTC อยู่เรื่อย ถ้าใช้ UTC วันจะเพี้ยนไปหนึ่งวัน
-- ---------------------------------------------------------------------
drop view if exists meeting_rows;
create view meeting_rows
with (security_invoker = true) as
select
  m.id,
  m.ref_no,
  m.user_id,
  p.full_name,
  p.employee_code,
  m.dept_code,
  m.sub_dept,
  m.shift_start,
  m.shift_end,
  m.note,
  m.file_id,
  m.web_link,
  m.status,
  m.decided_by,
  d.full_name as decided_by_name,
  m.decided_at,
  m.decide_note,
  m.created_at,
  (m.created_at at time zone 'Asia/Bangkok')::date as day
from meeting_checkins m
join profiles p      on p.id = m.user_id
left join profiles d on d.id = m.decided_by;

grant select on meeting_rows to authenticated;


-- ---------------------------------------------------------------------
-- RPC: เช็คอิน
--
-- กันกดซ้ำภายใน 10 นาที เพราะเน็ตในฮับหลุดบ่อย
-- คนกดส่งแล้วจอค้าง มักกดซ้ำอีกรอบ ซึ่งของเดิมเข้าไปแล้ว
-- 10 นาทีสั้นพอที่ประชุมสองรอบในวันเดียวยังเช็คอินได้ครบทั้งสองรอบ
-- ---------------------------------------------------------------------
create or replace function meeting_checkin(
  p_file_id  text,
  p_web_link text default null,
  p_bytes    integer default null,
  p_note     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me   profiles%rowtype;
  v_dup  meeting_checkins%rowtype;
  v_ref  text;
  v_id   uuid;
begin
  select * into v_me from profiles where id = auth.uid();
  if v_me.id is null or not v_me.is_active then
    raise exception 'บัญชีนี้ใช้งานไม่ได้';
  end if;

  if p_file_id is null or btrim(p_file_id) = '' then
    raise exception 'ต้องมีรูปเซลฟี่ก่อนถึงจะเช็คอินได้';
  end if;

  select * into v_dup
    from meeting_checkins
   where user_id = v_me.id
     and created_at > now() - interval '10 minutes'
   order by created_at desc
   limit 1;

  if v_dup.id is not null then
    -- ไม่ถือว่าเป็น error เพราะผลลัพธ์ที่ผู้ใช้ต้องการคือ "เช็คอินแล้ว" ซึ่งจริง
    return jsonb_build_object(
      'id', v_dup.id, 'ref_no', v_dup.ref_no,
      'created_at', v_dup.created_at, 'duplicate', true
    );
  end if;

  v_ref := next_meeting_ref();
  insert into meeting_checkins (ref_no, user_id, hub_code, dept_code, sub_dept,
                                shift_start, shift_end, note, file_id, web_link, bytes)
  values (v_ref, v_me.id, coalesce(v_me.hub_code, 'BPL'), v_me.dept_code, v_me.sub_dept,
          v_me.shift_start, v_me.shift_end, nullif(btrim(p_note), ''),
          p_file_id, p_web_link, p_bytes)
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id, 'ref_no', v_ref, 'created_at', now(), 'duplicate', false
  );
end $$;

grant execute on function meeting_checkin(text, text, integer, text) to authenticated;


-- ---------------------------------------------------------------------
-- RPC: ยืนยัน / ตีตก หลายรายการพร้อมกัน
--
-- ไม่ลบแถวทิ้งแม้จะตีตก เพราะ "รูปปลอม" เป็นข้อกล่าวหา
-- ต้องเหลือหลักฐานไว้ให้ย้อนดูได้ว่าใครตัดสิน ตอนไหน ด้วยเหตุผลอะไร
-- ---------------------------------------------------------------------
create or replace function set_meeting_status(
  p_ids    uuid[],
  p_status meeting_status,
  p_note   text default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if not my_can_audit() then
    raise exception 'บัญชีนี้ตรวจสอบรายชื่อประชุมไม่ได้';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  update meeting_checkins
     set status      = p_status,
         decided_by  = auth.uid(),
         decided_at  = now(),
         decide_note = nullif(btrim(p_note), '')
   where id = any(p_ids);

  get diagnostics v_n = row_count;
  return v_n;
end $$;

grant execute on function set_meeting_status(uuid[], meeting_status, text) to authenticated;


-- ---------------------------------------------------------------------
-- RPC: สรุปว่าใครเข้าประชุมกี่ครั้งในช่วงที่เลือก
--
-- นับทั้งคนที่ไม่เคยเช็คอินเลยด้วย เพราะคำถามจริงคือ "ใครไม่มา"
-- ไม่ใช่ "ใครมา" — คนที่หายไปจากรายการคือคนที่ต้องตามหา
-- ---------------------------------------------------------------------
create or replace function meeting_stats(p_from date, p_to date)
returns table (
  user_id       uuid,
  full_name     text,
  employee_code text,
  dept_code     text,
  sub_dept      text,
  confirmed     integer,
  pending       integer,
  rejected      integer,
  total         integer,
  last_at       timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    p.id, p.full_name, p.employee_code, p.dept_code, p.sub_dept,
    count(*) filter (where m.status = 'confirmed')::int,
    count(*) filter (where m.status = 'pending')::int,
    count(*) filter (where m.status = 'rejected')::int,
    count(m.id)::int,
    max(m.created_at)
  from profiles p
  left join meeting_checkins m
    on m.user_id = p.id
   and (m.created_at at time zone 'Asia/Bangkok')::date between p_from and p_to
  where my_can_audit() and p.is_active
  group by p.id, p.full_name, p.employee_code, p.dept_code, p.sub_dept
  order by count(*) filter (where m.status = 'confirmed') desc, p.full_name;
$$;

grant execute on function meeting_stats(date, date) to authenticated;


-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table meeting_checkins enable row level security;

drop policy if exists read_meetings on meeting_checkins;
create policy read_meetings on meeting_checkins for select to authenticated using (
  user_id = auth.uid() or my_can_audit()
);

-- เช็คอินแทนคนอื่นไม่ได้เด็ดขาด นี่คือหลักฐานการเข้าประชุมของตัวเอง
drop policy if exists insert_meetings on meeting_checkins;
create policy insert_meetings on meeting_checkins for insert to authenticated
  with check (user_id = auth.uid());

-- แก้สถานะผ่าน RPC เท่านั้น ไม่เปิด update ตรง ๆ ให้ใคร


-- ---------------------------------------------------------------------
-- ผู้ตรวจสอบดูประวัติการเบิกสิ้นเปลืองได้
--
-- อ่านอย่างเดียว อนุมัติไม่ได้ แก้ไม่ได้ — ตรงนั้นยังเป็นของแอดมินเหมือนเดิม
-- ต้องเปิด profiles ให้อ่านด้วย ไม่งั้นได้ใบเบิกมาแต่ไม่รู้ว่าใครเบิก
-- ---------------------------------------------------------------------
drop policy if exists read_profiles on profiles;
create policy read_profiles on profiles for select to authenticated using (
  id = auth.uid()
  or (my_role() = 'supervisor' and hub_code = my_hub())
  or my_role() = 'admin'
  or my_can_dispatch()
);

drop policy if exists read_requisitions on requisitions;
create policy read_requisitions on requisitions for select to authenticated using (
  requester_id = auth.uid()
  or (my_role() = 'supervisor' and hub_code = my_hub())
  or my_role() = 'admin'
  or my_can_dispatch()
);

drop policy if exists read_req_items on requisition_items;
create policy read_req_items on requisition_items for select to authenticated using (
  exists (select 1 from requisitions r where r.id = requisition_id and (
    r.requester_id = auth.uid()
    or (my_role() = 'supervisor' and r.hub_code = my_hub())
    or my_role() = 'admin'
    or my_can_dispatch()))
);


-- ---------------------------------------------------------------------
-- กันส่งซ้ำลง Google Sheet — โครงเดียวกับ sheet_exports ของฝั่งเบิก
-- ---------------------------------------------------------------------
create table if not exists meeting_sheet_exports (
  meeting_id  uuid primary key references meeting_checkins(id) on delete cascade,
  tab         text not null,
  row_no      integer not null,
  exported_at timestamptz not null default now()
);

alter table meeting_sheet_exports enable row level security;

drop policy if exists read_meeting_exports on meeting_sheet_exports;
create policy read_meeting_exports on meeting_sheet_exports for select to authenticated using (
  my_can_audit()
);

drop view if exists meeting_export_rows;
create view meeting_export_rows
with (security_invoker = true) as
select
  m.id,
  m.ref_no,
  m.created_at,
  m.full_name,
  m.employee_code,
  m.dept_code,
  m.status,
  e.tab,
  e.row_no,
  e.exported_at,
  (e.tab is not null) as is_exported
from meeting_rows m
left join meeting_sheet_exports e on e.meeting_id = m.id;

grant select on meeting_export_rows to authenticated;
