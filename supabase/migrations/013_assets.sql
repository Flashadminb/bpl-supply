-- =====================================================================
-- BPL SUPPLY — โมดูล Asset (ไอดาต้า / Power Pallet / วิทยุ / เลเซอร์ลบ)
-- รันต่อจาก 012 · ปลอดภัยที่จะรันซ้ำ
--
-- ของสิ้นเปลืองนับเป็น "จำนวน" แต่ Asset ต้องรู้ว่า "เครื่องไหน" อยู่กับใคร
-- จึงแยกตารางออกจาก items ทั้งชุด หน้าสิ้นเปลืองเดิมจะไม่ช้าลงเลย
--
--   asset_types        ประเภท (PP / IDATA / RADIO / LASER)
--   asset_photo_steps  ขั้นตอนถ่ายรูปบังคับของแต่ละประเภท
--   assets             ทะเบียนเครื่องรายตัว
--   asset_txns         ครั้งที่เบิกหรือคืน (รูปผูกที่นี่ ถ่ายรวมครั้งเดียว)
--   asset_txn_items    เครื่องที่อยู่ในครั้งนั้น (แถวคืนชี้กลับไปที่แถวเบิก)
--   asset_txn_photos   รูปของครั้งนั้น
--   asset_issues       ใบแจ้งชำรุด — ค้างไว้จนแอดมินกดเคลียร์
-- =====================================================================

-- ── กะการทำงานของพนักงาน ──────────────────────────────────────────────
-- เก็บเป็นเวลาเปล่า ๆ ไม่ผูกชื่อกะ จะได้เพิ่มแก้ได้อิสระ
-- ข้ามเที่ยงคืนได้ (18:00–03:00) โดยดูว่า end <= start
alter table profiles
  add column if not exists shift_start time,
  add column if not exists shift_end   time;

comment on column profiles.shift_end is
  'เวลาเลิกกะ ใช้คำนวณกำหนดคืนและการแจ้งเตือน ถ้า <= shift_start แปลว่าข้ามเที่ยงคืน';

-- ── ประเภท Asset ──────────────────────────────────────────────────────
create table if not exists asset_types (
  code       text primary key,
  name       text not null,
  sort_no    integer not null default 0,
  is_active  boolean not null default true,
  -- ใช้เมื่อประเภทนั้นไม่มีขั้นตอนบังคับ (ไอดาต้า วิทยุ เลเซอร์)
  photo_min  integer not null default 1,
  photo_max  integer not null default 5,
  -- ปุ่มลัดอาการที่พบบ่อย ให้หน้างานกดแทนพิมพ์
  issue_tags text[] not null default '{}'
);

-- ── ขั้นตอนถ่ายรูปบังคับ (ตอนนี้มีแค่ Power Pallet) ────────────────────
create table if not exists asset_photo_steps (
  type_code text not null references asset_types(code) on delete cascade,
  seq       integer not null,
  label     text not null,
  hint      text,
  primary key (type_code, seq)
);

-- ── ทะเบียนเครื่อง ────────────────────────────────────────────────────
create table if not exists assets (
  code       text primary key,
  type_code  text not null references asset_types(code),
  -- null หรือ 'ALL' = เครื่องส่วนกลาง ทุกแผนกทุกกะเห็น
  dept_code  text references departments(code),
  -- แอดมินกดปิด = หายจากรายการเบิกทันที แต่ประวัติยังอยู่ครบ
  is_enabled boolean not null default true,
  note       text,
  created_at timestamptz not null default now()
);

-- ชี้ไปที่แถวตอนเบิกที่ยังไม่ถูกคืน · ว่าง = เครื่องว่าง
-- มีคอลัมน์นี้เพื่อให้ "ใครถืออะไรอยู่" อ่านแค่ตารางเครื่อง 139 แถว
-- ไม่ต้องไล่ประวัติย้อนหลังทั้งหมดซึ่งโตขึ้นทุกเดือน
alter table assets add column if not exists held_item_id bigint;

create index if not exists assets_held_idx on assets (held_item_id) where held_item_id is not null;
create index if not exists assets_type_idx on assets (type_code) where is_enabled;
create index if not exists assets_dept_idx on assets (dept_code) where is_enabled;

-- ── ครั้งที่เบิก / คืน ────────────────────────────────────────────────
do $$ begin
  create type asset_txn_kind as enum ('out', 'in');
exception when duplicate_object then null; end $$;

create table if not exists asset_txns (
  id          uuid primary key default gen_random_uuid(),
  ref_no      text unique not null,
  kind        asset_txn_kind not null,
  type_code   text not null references asset_types(code),
  user_id     uuid not null references profiles(id),
  dept_code   text,
  shift_start time,
  shift_end   time,
  -- กำหนดคืน = เวลาเลิกกะของคนที่เบิก ใช้ยิงแจ้งเตือน
  due_at      timestamptz,
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists asset_txns_user_idx on asset_txns (user_id, created_at desc);
create index if not exists asset_txns_due_idx  on asset_txns (due_at) where kind = 'out';

create table if not exists asset_txn_items (
  id          bigserial primary key,
  txn_id      uuid not null references asset_txns(id) on delete cascade,
  asset_code  text not null references assets(code),
  -- แถวของการคืน ชี้กลับไปที่แถวตอนเบิก — ว่างแปลว่ายังไม่ได้คืน
  out_item_id bigint references asset_txn_items(id)
);

create index if not exists asset_txn_items_txn_idx   on asset_txn_items (txn_id);
create index if not exists asset_txn_items_asset_idx on asset_txn_items (asset_code);
-- คืนซ้ำแถวเดิมไม่ได้เด็ดขาด
create unique index if not exists asset_txn_items_out_uniq
  on asset_txn_items (out_item_id) where out_item_id is not null;

do $ begin
  alter table assets add constraint assets_held_item_fk
    foreign key (held_item_id) references asset_txn_items(id) on delete set null;
exception when duplicate_object then null; end $;

-- เผื่อเคยรันเวอร์ชันก่อนหน้าไปแล้วและมีรายการค้างอยู่ — เติมให้ตรงกับความจริง
update assets a set held_item_id = ai.id
from asset_txn_items ai
join asset_txns t on t.id = ai.txn_id and t.kind = 'out'
where ai.asset_code = a.code
  and ai.out_item_id is null
  and a.held_item_id is null
  and not exists (select 1 from asset_txn_items r where r.out_item_id = ai.id);

create table if not exists asset_txn_photos (
  id       bigserial primary key,
  txn_id   uuid not null references asset_txns(id) on delete cascade,
  seq      integer not null default 1,
  label    text,
  file_id  text not null,
  web_link text,
  bytes    integer
);

create index if not exists asset_txn_photos_txn_idx on asset_txn_photos (txn_id);

-- ── ใบแจ้งชำรุด ───────────────────────────────────────────────────────
-- ค้างไว้เรื่อย ๆ จนแอดมินกดเคลียร์ หน้างานจึงไม่ต้องแจ้งซ้ำทุกกะ
create table if not exists asset_issues (
  id            bigserial primary key,
  asset_code    text not null references assets(code) on delete cascade,
  txn_id        uuid references asset_txns(id) on delete set null,
  phase         asset_txn_kind,
  symptom       text not null,
  reported_by   uuid references profiles(id),
  -- ชื่อที่ย้ายมาจากชีตเดิม ตอนนั้นยังไม่มีบัญชีในระบบ
  reported_name text,
  reported_at   timestamptz not null default now(),
  file_id       text,
  web_link      text,
  resolved_at   timestamptz,
  resolved_by   uuid references profiles(id),
  resolve_note  text
);

create index if not exists asset_issues_open_idx
  on asset_issues (asset_code) where resolved_at is null;

-- ---------------------------------------------------------------------
-- View: เครื่องที่ยังไม่ถูกคืน
-- ---------------------------------------------------------------------
drop view if exists asset_holdings;
create view asset_holdings
with (security_invoker = true) as
select
  ai.id                as out_item_id,
  a.code               as asset_code,
  a.type_code,
  ty.name              as type_name,
  a.dept_code          as asset_dept,
  t.id                 as txn_id,
  t.ref_no,
  t.user_id,
  p.full_name          as holder_name,
  p.employee_code      as holder_code,
  t.dept_code          as holder_dept,
  t.shift_start,
  t.shift_end,
  t.due_at,
  t.created_at         as taken_at
from assets a
join asset_txn_items ai on ai.id = a.held_item_id
join asset_txns t       on t.id = ai.txn_id
join asset_types ty     on ty.code = a.type_code
join profiles p         on p.id = t.user_id;

grant select on asset_holdings to authenticated;

-- ---------------------------------------------------------------------
-- View: อาการชำรุดที่ยังค้างอยู่ รวมเป็นบรรทัดเดียวต่อเครื่อง
-- ---------------------------------------------------------------------
drop view if exists asset_open_issues;
create view asset_open_issues
with (security_invoker = true) as
select
  asset_code,
  count(*)::int                                  as issue_count,
  string_agg(symptom, ' · ' order by reported_at) as symptoms,
  max(reported_at)                               as last_reported_at
from asset_issues
where resolved_at is null
group by asset_code;

grant select on asset_open_issues to authenticated;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table asset_types       enable row level security;
alter table asset_photo_steps enable row level security;
alter table assets            enable row level security;
alter table asset_txns        enable row level security;
alter table asset_txn_items   enable row level security;
alter table asset_txn_photos  enable row level security;
alter table asset_issues      enable row level security;

-- ประเภทและขั้นตอนถ่ายรูป ทุกคนอ่านได้ แอดมินแก้ได้
drop policy if exists read_asset_types on asset_types;
create policy read_asset_types on asset_types for select to authenticated using (true);
drop policy if exists write_asset_types on asset_types;
create policy write_asset_types on asset_types for all to authenticated
  using (my_role() in ('supervisor', 'admin'))
  with check (my_role() in ('supervisor', 'admin'));

drop policy if exists read_asset_steps on asset_photo_steps;
create policy read_asset_steps on asset_photo_steps for select to authenticated using (true);
drop policy if exists write_asset_steps on asset_photo_steps;
create policy write_asset_steps on asset_photo_steps for all to authenticated
  using (my_role() in ('supervisor', 'admin'))
  with check (my_role() in ('supervisor', 'admin'));

-- เครื่อง: เห็นเฉพาะแผนกตัวเอง + ส่วนกลาง + แผนกที่ได้สิทธิ์พิเศษ
drop policy if exists read_assets on assets;
create policy read_assets on assets for select to authenticated using (
  my_role() in ('supervisor', 'admin')
  or dept_code is null
  or dept_code = 'ALL'
  or 'ALL' = any(my_depts())
  or dept_code = any(my_depts())
);
drop policy if exists write_assets on assets;
create policy write_assets on assets for all to authenticated
  using (my_role() in ('supervisor', 'admin'))
  with check (my_role() in ('supervisor', 'admin'));

-- รายการเบิกคืน: หน้างานเห็นของตัวเอง แอดมินเห็นหมด
drop policy if exists read_asset_txns on asset_txns;
create policy read_asset_txns on asset_txns for select to authenticated
  using (user_id = auth.uid() or my_role() in ('supervisor', 'admin'));

drop policy if exists read_asset_txn_items on asset_txn_items;
create policy read_asset_txn_items on asset_txn_items for select to authenticated using (
  my_role() in ('supervisor', 'admin')
  or exists (select 1 from asset_txns t where t.id = txn_id and t.user_id = auth.uid())
);

-- รูปหลักฐาน หน้างานเปิดดูไม่ได้ ตามกติกาเดิมของระบบ
drop policy if exists read_asset_photos on asset_txn_photos;
create policy read_asset_photos on asset_txn_photos for select to authenticated
  using (my_role() in ('supervisor', 'admin'));

-- อาการชำรุด ทุกคนต้องเห็น ไม่งั้นจะแจ้งซ้ำกันทุกกะ
drop policy if exists read_asset_issues on asset_issues;
create policy read_asset_issues on asset_issues for select to authenticated using (true);
drop policy if exists write_asset_issues on asset_issues;
create policy write_asset_issues on asset_issues for all to authenticated
  using (my_role() in ('supervisor', 'admin'))
  with check (my_role() in ('supervisor', 'admin'));

-- ---------------------------------------------------------------------
-- ตัวช่วย
-- ---------------------------------------------------------------------

-- เลขที่รายการ: AO-690923-0007 (เบิก) / AR-690923-0008 (คืน)
create sequence if not exists asset_ref_seq;

create or replace function next_asset_ref(p_kind asset_txn_kind)
returns text language sql volatile as $$
  select case when p_kind = 'out' then 'AO-' else 'AR-' end
      || to_char((now() at time zone 'Asia/Bangkok'), 'YYMMDD')
      || '-' || lpad(nextval('asset_ref_seq')::text, 4, '0');
$$;

-- เวลาเลิกกะครั้งถัดไป นับจากตอนนี้ รองรับกะข้ามเที่ยงคืน
create or replace function shift_due_at(p_start time, p_end time)
returns timestamptz language plpgsql volatile as $$
declare
  v_now   timestamptz := now();
  v_local timestamp   := (now() at time zone 'Asia/Bangkok');
  v_due   timestamp;
begin
  if p_end is null then return null; end if;
  v_due := date_trunc('day', v_local) + p_end;
  -- กะข้ามคืน (18:00–03:00) หรือเลยเวลาเลิกกะไปแล้ว ให้ขยับไปวันถัดไป
  if v_due <= v_local then
    v_due := v_due + interval '1 day';
  end if;
  return v_due at time zone 'Asia/Bangkok';
end $$;

-- ---------------------------------------------------------------------
-- RPC: เบิก Asset
--   p_codes   รหัสเครื่องที่ติ๊กมา
--   p_photos  [{file_id, web_link, bytes, seq, label}]
--   p_issues  [{asset_code, symptom, file_id, web_link}]
-- ล็อกทุกแถวที่เกี่ยวก่อนเสมอ สองคนกดพร้อมกันจะได้ไม่ได้เครื่องเดียวกัน
-- ---------------------------------------------------------------------
create or replace function asset_checkout(
  p_type   text,
  p_codes  text[],
  p_photos jsonb default '[]'::jsonb,
  p_issues jsonb default '[]'::jsonb,
  p_note   text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me     profiles%rowtype;
  v_txn    uuid;
  v_ref    text;
  v_code   text;
  v_taken  text;
  v_item   bigint;
  v_min    int;
  v_steps  int;
  v_photos int := coalesce(jsonb_array_length(p_photos), 0);
  r        jsonb;
begin
  select * into v_me from profiles where id = auth.uid();
  if v_me.id is null or not v_me.is_active then
    raise exception 'บัญชีนี้ใช้งานไม่ได้';
  end if;

  if p_codes is null or array_length(p_codes, 1) is null then
    raise exception 'ยังไม่ได้เลือกเครื่อง';
  end if;

  if not exists (select 1 from asset_types where code = p_type and is_active) then
    raise exception 'ไม่พบประเภท %', p_type;
  end if;

  -- จำนวนรูปขั้นต่ำ: ถ้าประเภทนี้มีขั้นตอนบังคับ ต้องครบทุกขั้น
  select count(*) into v_steps from asset_photo_steps where type_code = p_type;
  select photo_min into v_min from asset_types where code = p_type;
  if v_steps > 0 then v_min := v_steps; end if;
  if v_photos < coalesce(v_min, 1) then
    raise exception 'ต้องถ่ายรูปให้ครบ % ใบก่อน (ถ่ายมาแล้ว % ใบ)', coalesce(v_min, 1), v_photos;
  end if;

  v_ref := next_asset_ref('out');
  insert into asset_txns (ref_no, kind, type_code, user_id, dept_code,
                          shift_start, shift_end, due_at, note)
  values (v_ref, 'out', p_type, v_me.id, v_me.dept_code,
          v_me.shift_start, v_me.shift_end,
          shift_due_at(v_me.shift_start, v_me.shift_end), p_note)
  returning id into v_txn;

  foreach v_code in array p_codes loop
    -- ล็อกเครื่องไว้ก่อน แล้วค่อยเช็คว่ายังว่างจริงไหม
    perform 1 from assets where code = v_code for update;

    if not found then
      raise exception 'ไม่พบเครื่อง %', v_code;
    end if;
    if not exists (select 1 from assets where code = v_code and is_enabled) then
      raise exception 'เครื่อง % ถูกปิดไม่ให้เบิก', v_code;
    end if;
    if exists (select 1 from assets where code = v_code and type_code <> p_type) then
      raise exception 'เครื่อง % ไม่ใช่ประเภทที่เลือก', v_code;
    end if;

    select h.holder_name into v_taken
      from assets x join asset_holdings h on h.asset_code = x.code
     where x.code = v_code and x.held_item_id is not null;
    if v_taken is not null then
      raise exception 'เครื่อง % ยังไม่ได้คืน อยู่กับ %', v_code, v_taken;
    end if;

    insert into asset_txn_items (txn_id, asset_code)
    values (v_txn, v_code) returning id into v_item;

    update assets set held_item_id = v_item where code = v_code;
  end loop;

  for r in select * from jsonb_array_elements(p_photos) loop
    insert into asset_txn_photos (txn_id, seq, label, file_id, web_link, bytes)
    values (v_txn,
            coalesce((r->>'seq')::int, 1),
            r->>'label',
            r->>'file_id',
            r->>'web_link',
            (r->>'bytes')::int);
  end loop;

  for r in select * from jsonb_array_elements(p_issues) loop
    insert into asset_issues (asset_code, txn_id, phase, symptom, reported_by, file_id, web_link)
    values (r->>'asset_code', v_txn, 'out', r->>'symptom', v_me.id, r->>'file_id', r->>'web_link');
  end loop;

  return jsonb_build_object(
    'id', v_txn, 'ref_no', v_ref,
    'due_at', (select due_at from asset_txns where id = v_txn),
    'count', array_length(p_codes, 1)
  );
end $$;

grant execute on function asset_checkout(text, text[], jsonb, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------
-- RPC: คืน Asset — คืนบางเครื่องได้ ที่เหลือยังค้างชื่อเดิม เวลาไม่รีเซ็ต
-- ---------------------------------------------------------------------
create or replace function asset_return(
  p_codes  text[],
  p_photos jsonb default '[]'::jsonb,
  p_issues jsonb default '[]'::jsonb,
  p_note   text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me     profiles%rowtype;
  v_txn    uuid;
  v_ref    text;
  v_code   text;
  v_type   text;
  v_out    bigint;
  v_owner  uuid;
  v_min    int;
  v_steps  int;
  v_photos int := coalesce(jsonb_array_length(p_photos), 0);
  r        jsonb;
begin
  select * into v_me from profiles where id = auth.uid();
  if v_me.id is null or not v_me.is_active then
    raise exception 'บัญชีนี้ใช้งานไม่ได้';
  end if;

  if p_codes is null or array_length(p_codes, 1) is null then
    raise exception 'ยังไม่ได้เลือกเครื่องที่จะคืน';
  end if;

  select a.type_code into v_type from assets a where a.code = p_codes[1];
  if v_type is null then
    raise exception 'ไม่พบเครื่อง %', p_codes[1];
  end if;

  select count(*) into v_steps from asset_photo_steps where type_code = v_type;
  select photo_min into v_min from asset_types where code = v_type;
  if v_steps > 0 then v_min := v_steps; end if;
  if v_photos < coalesce(v_min, 1) then
    raise exception 'ต้องถ่ายรูปสภาพตอนคืนให้ครบ % ใบก่อน (ถ่ายมาแล้ว % ใบ)',
      coalesce(v_min, 1), v_photos;
  end if;

  v_ref := next_asset_ref('in');
  insert into asset_txns (ref_no, kind, type_code, user_id, dept_code,
                          shift_start, shift_end, note)
  values (v_ref, 'in', v_type, v_me.id, v_me.dept_code,
          v_me.shift_start, v_me.shift_end, p_note)
  returning id into v_txn;

  foreach v_code in array p_codes loop
    perform 1 from assets where code = v_code for update;

    select a.held_item_id, t.user_id into v_out, v_owner
      from assets a
      join asset_txn_items ai on ai.id = a.held_item_id
      join asset_txns t on t.id = ai.txn_id
     where a.code = v_code;

    if v_out is null then
      raise exception 'เครื่อง % ไม่ได้อยู่ในรายการค้างคืน', v_code;
    end if;
    -- คืนแทนคนอื่นได้เฉพาะแอดมิน
    if v_owner <> v_me.id and my_role() not in ('supervisor', 'admin') then
      raise exception 'เครื่อง % ไม่ได้เบิกโดยคุณ', v_code;
    end if;

    insert into asset_txn_items (txn_id, asset_code, out_item_id)
    values (v_txn, v_code, v_out);

    update assets set held_item_id = null where code = v_code;
  end loop;

  for r in select * from jsonb_array_elements(p_photos) loop
    insert into asset_txn_photos (txn_id, seq, label, file_id, web_link, bytes)
    values (v_txn,
            coalesce((r->>'seq')::int, 1),
            r->>'label',
            r->>'file_id',
            r->>'web_link',
            (r->>'bytes')::int);
  end loop;

  for r in select * from jsonb_array_elements(p_issues) loop
    insert into asset_issues (asset_code, txn_id, phase, symptom, reported_by, file_id, web_link)
    values (r->>'asset_code', v_txn, 'in', r->>'symptom', v_me.id, r->>'file_id', r->>'web_link');
  end loop;

  return jsonb_build_object('id', v_txn, 'ref_no', v_ref, 'count', array_length(p_codes, 1));
end $$;

grant execute on function asset_return(text[], jsonb, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------
-- RPC ฝั่งแอดมิน
-- ---------------------------------------------------------------------

-- เคลียร์อาการชำรุด — ซ่อมเสร็จแล้วกดปิด จะไม่ขึ้นโชว์อีก แต่ประวัติยังอยู่
create or replace function resolve_asset_issue(p_id bigint, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if my_role() not in ('supervisor', 'admin') then
    raise exception 'ไม่มีสิทธิ์เคลียร์อาการชำรุด';
  end if;
  update asset_issues
     set resolved_at = now(), resolved_by = auth.uid(), resolve_note = p_note
   where id = p_id and resolved_at is null;
end $$;

grant execute on function resolve_asset_issue(bigint, text) to authenticated;

-- เคลียร์ทุกอาการของเครื่องนั้นรวดเดียว
create or replace function resolve_asset_issues_for(p_code text, p_note text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if my_role() not in ('supervisor', 'admin') then
    raise exception 'ไม่มีสิทธิ์เคลียร์อาการชำรุด';
  end if;
  update asset_issues
     set resolved_at = now(), resolved_by = auth.uid(), resolve_note = p_note
   where asset_code = p_code and resolved_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

grant execute on function resolve_asset_issues_for(text, text) to authenticated;

-- เปิด/ปิดไม่ให้เบิก
create or replace function set_asset_enabled(p_code text, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if my_role() not in ('supervisor', 'admin') then
    raise exception 'ไม่มีสิทธิ์เปิดปิดเครื่อง';
  end if;
  update assets set is_enabled = p_on where code = p_code;
end $$;

grant execute on function set_asset_enabled(text, boolean) to authenticated;
