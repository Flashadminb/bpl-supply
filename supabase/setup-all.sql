-- =====================================================================
-- BPL SUPPLY — รวมทุกอย่างไว้ไฟล์เดียว 001..012 + seed
-- ปลอดภัยที่จะรันซ้ำ รันทับของเดิมได้ ไม่ทำข้อมูลหาย
-- =====================================================================

-- =====================================================================
-- BPL SUPPLY — Supabase schema
-- Run this in the Supabase SQL editor on a fresh project.
-- Postgres 15+. Safe to re-run: uses IF NOT EXISTS / OR REPLACE.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
do $$ begin
  create type user_role      as enum ('staff', 'supervisor', 'admin');
  create type req_status     as enum ('pending', 'approved', 'partial', 'rejected');
  create type line_status    as enum ('pending', 'approved', 'rejected');
  create type return_cond    as enum ('ok', 'damaged', 'lost');
  create type sync_channel   as enum ('IMG', 'GDV', 'SPB', 'TMP', 'GSH');
  create type sync_state     as enum ('pending', 'running', 'done', 'failed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Reference tables
-- ---------------------------------------------------------------------
create table if not exists hubs (
  code        text primary key,               -- 'BPL', 'AYU', 'PDT', 'WNO', 'BAG'
  name        text not null,
  is_active   boolean not null default true
);

create table if not exists profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  employee_code text unique not null,         -- 'FE-10482'
  full_name     text not null,
  hub_code      text not null references hubs(code),
  role          user_role not null default 'staff',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists categories (
  id              bigserial primary key,
  name            text not null,
  -- true = ของสิ้นเปลือง อนุมัติอัตโนมัติได้ถ้าเปิดสวิตช์ไว้
  auto_approvable boolean not null default true
);

create table if not exists items (
  id            bigserial primary key,
  sku           text unique not null,         -- 'SKU-CL-0091'
  name          text not null,
  category_id   bigint references categories(id),
  hub_code      text not null references hubs(code),
  unit          text not null,                -- 'ขวด', 'ถุง', 'คู่'
  shelf_code    text,                         -- 'A-03'
  qty_on_hand   integer not null default 0 check (qty_on_hand >= 0),
  min_qty       integer not null default 0 check (min_qty >= 0),
  is_returnable boolean not null default false,  -- true = ประเภทยืม-คืน
  image_path    text,                         -- catalog image in Supabase Storage (ไม่ใช่รูปหลักฐาน)
  qr_payload    text unique,                  -- ค่าใน QR ที่ติดชั้นวาง
  is_active     boolean not null default true,
  updated_at    timestamptz not null default now()
);
create index if not exists items_hub_active_idx on items (hub_code, is_active);
create index if not exists items_low_stock_idx  on items (hub_code) where qty_on_hand <= min_qty;

create table if not exists app_settings (
  key   text primary key,
  value jsonb not null
);
insert into app_settings (key, value) values
  ('auto_approve_consumables', 'true'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Requisitions — 1 หัวคำขอ : N บรรทัดรายการ
-- ---------------------------------------------------------------------
create table if not exists requisitions (
  id                 uuid primary key default gen_random_uuid(),
  ref_no             text unique not null,    -- 'REQ-2026-0912'
  requester_id       uuid not null references profiles(id),
  hub_code           text not null references hubs(code),
  purpose            text,
  note               text,
  status             req_status not null default 'pending',
  -- รูปหลักฐาน 1 รูปต่อคำขอ เก็บแค่ pointer ไป Google Drive
  evidence_file_id   text,
  evidence_web_link  text,
  evidence_bytes     integer,
  created_at         timestamptz not null default now(),
  decided_by         uuid references profiles(id),
  decided_at         timestamptz,
  reject_reason      text
);
create index if not exists req_hub_created_idx on requisitions (hub_code, created_at desc);
create index if not exists req_status_idx      on requisitions (status) where status = 'pending';
create index if not exists req_requester_idx   on requisitions (requester_id, created_at desc);

create table if not exists requisition_items (
  id               bigserial primary key,
  requisition_id   uuid not null references requisitions(id) on delete cascade,
  item_id          bigint not null references items(id),
  qty_requested    integer not null check (qty_requested > 0),
  qty_approved     integer,
  status           line_status not null default 'pending',
  qty_before       integer,                   -- สต็อกก่อนตัด (ใส่ตอนตัดจริง)
  qty_after        integer,
  unique (requisition_id, item_id)
);
create index if not exists req_items_req_idx on requisition_items (requisition_id);

-- ---------------------------------------------------------------------
-- Returns (เฉพาะของประเภทยืม-คืน)
-- ---------------------------------------------------------------------
create table if not exists returns (
  id                   bigserial primary key,
  requisition_item_id  bigint not null references requisition_items(id),
  returned_by          uuid not null references profiles(id),
  qty                  integer not null check (qty > 0),
  condition            return_cond not null default 'ok',
  evidence_file_id     text,
  evidence_web_link    text,
  created_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Audit trail ของสต็อก — ทุกการเปลี่ยนแปลงต้องมีแถวที่นี่
-- ---------------------------------------------------------------------
create table if not exists stock_movements (
  id          bigserial primary key,
  item_id     bigint not null references items(id),
  delta       integer not null,               -- ลบ = ตัดออก, บวก = รับเข้า/คืน
  qty_after   integer not null,
  reason      text not null,                  -- 'requisition' | 'return' | 'adjust' | 'receive'
  ref_type    text,
  ref_id      text,
  actor_id    uuid references profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists stock_mov_item_idx on stock_movements (item_id, created_at desc);

-- ---------------------------------------------------------------------
-- Sync log — เติมแถบรหัสย่อ IMG / GDV / SPB / TMP / GSH บนหน้าพนักงาน
-- ---------------------------------------------------------------------
create table if not exists sync_log (
  id              bigserial primary key,
  requisition_id  uuid not null references requisitions(id) on delete cascade,
  channel         sync_channel not null,
  state           sync_state not null default 'pending',
  detail          text,
  updated_at      timestamptz not null default now(),
  unique (requisition_id, channel)
);

-- ---------------------------------------------------------------------
-- Ref number generator — REQ-<ปีพ.ศ.>-<running 4 หลัก>
-- ---------------------------------------------------------------------
create sequence if not exists requisition_seq;

create or replace function next_ref_no() returns text
language sql as $$
  select 'REQ-' || (extract(year from now())::int + 543)::text
         || '-' || lpad(nextval('requisition_seq')::text, 4, '0');
$$;

-- ---------------------------------------------------------------------
-- RPC หลัก: สร้างคำขอหลายรายการ + ตัดสต็อกใน transaction เดียว
--
-- p_lines ตัวอย่าง: '[{"item_id":1,"qty":2},{"item_id":7,"qty":4}]'
-- คืน jsonb: { ref_no, status, lines: [...] }
-- ล้มทั้งคำขอถ้าบรรทัดใดสต็อกไม่พอ (raise exception → rollback)
-- ---------------------------------------------------------------------
create or replace function create_requisition(
  p_lines            jsonb,
  p_purpose          text default null,
  p_note             text default null,
  p_evidence_file_id text default null,
  p_evidence_link    text default null,
  p_evidence_bytes   integer default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile    profiles%rowtype;
  v_req_id     uuid;
  v_ref        text;
  v_line       jsonb;
  v_item       items%rowtype;
  v_qty        integer;
  v_auto       boolean;
  v_all_auto   boolean := true;
  v_status     req_status;
begin
  select * into v_profile from profiles where id = auth.uid();
  if not found or not v_profile.is_active then
    raise exception 'ไม่พบผู้ใช้หรือบัญชีถูกระงับ';
  end if;

  if jsonb_array_length(p_lines) = 0 then
    raise exception 'ตะกร้าว่าง';
  end if;

  select (value)::boolean into v_auto from app_settings where key = 'auto_approve_consumables';
  v_auto := coalesce(v_auto, false);

  -- รอบแรก: ล็อกแถวและตรวจสต็อกให้ครบทุกบรรทัดก่อน แล้วค่อยตัด
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_line->>'qty')::int;
    if v_qty is null or v_qty <= 0 then
      raise exception 'จำนวนไม่ถูกต้อง';
    end if;

    select * into v_item from items
      where id = (v_line->>'item_id')::bigint and is_active
      for update;                                  -- ล็อกกันเบิกชนกัน

    if not found then
      raise exception 'ไม่พบวัสดุรหัส %', v_line->>'item_id';
    end if;
    if v_item.qty_on_hand < v_qty then
      raise exception 'สต็อกไม่พอ: % เหลือ % ขอ %', v_item.name, v_item.qty_on_hand, v_qty;
    end if;

    -- บรรทัดไหนไม่เข้าเงื่อนไข auto → ทั้งคำขอเข้าคิวรออนุมัติ
    if not exists (
      select 1 from categories c
      where c.id = v_item.category_id
        and c.auto_approvable
        and not v_item.is_returnable
        and (v_item.qty_on_hand - v_qty) >= v_item.min_qty
    ) then
      v_all_auto := false;
    end if;
  end loop;

  v_status := case when v_auto and v_all_auto then 'approved'::req_status
                   else 'pending'::req_status end;
  v_ref := next_ref_no();

  insert into requisitions (ref_no, requester_id, hub_code, purpose, note, status,
                            evidence_file_id, evidence_web_link, evidence_bytes,
                            decided_at, decided_by)
  values (v_ref, v_profile.id, v_profile.hub_code, p_purpose, p_note, v_status,
          p_evidence_file_id, p_evidence_link, p_evidence_bytes,
          case when v_status = 'approved' then now() end,
          case when v_status = 'approved' then v_profile.id end)
  returning id into v_req_id;

  -- รอบสอง: เขียนบรรทัด และตัดสต็อกเฉพาะเมื่ออนุมัติอัตโนมัติ
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_line->>'qty')::int;
    select * into v_item from items where id = (v_line->>'item_id')::bigint;

    insert into requisition_items (requisition_id, item_id, qty_requested,
                                   qty_approved, status, qty_before, qty_after)
    values (v_req_id, v_item.id, v_qty,
            case when v_status = 'approved' then v_qty end,
            case when v_status = 'approved' then 'approved'::line_status
                 else 'pending'::line_status end,
            v_item.qty_on_hand,
            case when v_status = 'approved' then v_item.qty_on_hand - v_qty end);

    if v_status = 'approved' then
      update items set qty_on_hand = qty_on_hand - v_qty, updated_at = now()
        where id = v_item.id;
      insert into stock_movements (item_id, delta, qty_after, reason, ref_type, ref_id, actor_id)
        values (v_item.id, -v_qty, v_item.qty_on_hand - v_qty, 'requisition',
                'requisition', v_req_id::text, v_profile.id);
    end if;
  end loop;

  insert into sync_log (requisition_id, channel, state) values
    (v_req_id, 'SPB'::sync_channel, 'done'::sync_state),
    (v_req_id, 'GDV'::sync_channel,
      case when p_evidence_file_id is null then 'pending'::sync_state else 'done'::sync_state end),
    (v_req_id, 'GSH'::sync_channel, 'pending'::sync_state)
  on conflict do nothing;

  return jsonb_build_object('ref_no', v_ref, 'id', v_req_id, 'status', v_status);
end $$;

-- ---------------------------------------------------------------------
-- RPC: อนุมัติรายบรรทัด (แอดมิน/หัวหน้า) — ตัดสต็อกเฉพาะบรรทัดที่เลือก
-- p_line_ids = array ของ requisition_items.id ที่อนุมัติ
-- ---------------------------------------------------------------------
create or replace function approve_requisition(
  p_requisition_id uuid,
  p_line_ids       bigint[]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor    profiles%rowtype;
  v_line     requisition_items%rowtype;
  v_item     items%rowtype;
  v_approved int := 0;
  v_total    int := 0;
  v_status   req_status;
begin
  select * into v_actor from profiles where id = auth.uid();
  if not found or v_actor.role = 'staff' then
    raise exception 'ไม่มีสิทธิ์อนุมัติ';
  end if;

  for v_line in
    select * from requisition_items where requisition_id = p_requisition_id order by id
  loop
    v_total := v_total + 1;

    if v_line.id = any(p_line_ids) then
      select * into v_item from items where id = v_line.item_id for update;
      if v_item.qty_on_hand < v_line.qty_requested then
        raise exception 'สต็อกไม่พอ: % เหลือ %', v_item.name, v_item.qty_on_hand;
      end if;

      update items set qty_on_hand = qty_on_hand - v_line.qty_requested, updated_at = now()
        where id = v_item.id;

      update requisition_items
        set status = 'approved', qty_approved = qty_requested,
            qty_before = v_item.qty_on_hand,
            qty_after  = v_item.qty_on_hand - v_line.qty_requested
        where id = v_line.id;

      insert into stock_movements (item_id, delta, qty_after, reason, ref_type, ref_id, actor_id)
        values (v_item.id, -v_line.qty_requested, v_item.qty_on_hand - v_line.qty_requested,
                'requisition', 'requisition', p_requisition_id::text, v_actor.id);

      v_approved := v_approved + 1;
    else
      update requisition_items set status = 'rejected', qty_approved = 0 where id = v_line.id;
    end if;
  end loop;

  v_status := case when v_approved = 0        then 'rejected'::req_status
                   when v_approved = v_total  then 'approved'::req_status
                   else 'partial'::req_status end;

  update requisitions
    set status = v_status, decided_by = v_actor.id, decided_at = now()
    where id = p_requisition_id;

  return jsonb_build_object('status', v_status, 'approved_lines', v_approved, 'total_lines', v_total);
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table profiles          enable row level security;
alter table items             enable row level security;
alter table requisitions      enable row level security;
alter table requisition_items enable row level security;
alter table returns           enable row level security;
alter table stock_movements   enable row level security;
alter table sync_log          enable row level security;
alter table app_settings      enable row level security;
alter table categories        enable row level security;
alter table hubs              enable row level security;

create or replace function my_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function my_hub() returns text
language sql stable security definer set search_path = public as $$
  select hub_code from profiles where id = auth.uid();
$$;

-- อ่านได้ทุกคนที่ล็อกอิน
drop policy if exists read_hubs on hubs;
create policy read_hubs on hubs for select to authenticated using (true);

drop policy if exists read_categories on categories;
create policy read_categories on categories for select to authenticated using (true);

drop policy if exists read_items on items;
create policy read_items on items for select to authenticated using (hub_code = my_hub() or my_role() = 'admin');

drop policy if exists write_items on items;
create policy write_items on items for all to authenticated
  using (my_role() = 'admin') with check (my_role() = 'admin');

-- โปรไฟล์: เห็นของตัวเอง, หัวหน้าเห็นทั้งฮับ, แอดมินเห็นหมด
drop policy if exists read_profiles on profiles;
create policy read_profiles on profiles for select to authenticated using (
  id = auth.uid()
  or (my_role() = 'supervisor' and hub_code = my_hub())
  or my_role() = 'admin'
);
drop policy if exists write_profiles on profiles;
create policy write_profiles on profiles for all to authenticated
  using (my_role() = 'admin') with check (my_role() = 'admin');

-- คำขอ: staff เห็นของตัวเอง, supervisor เห็นทั้งฮับ, admin เห็นหมด
drop policy if exists read_requisitions on requisitions;
create policy read_requisitions on requisitions for select to authenticated using (
  requester_id = auth.uid()
  or (my_role() = 'supervisor' and hub_code = my_hub())
  or my_role() = 'admin'
);
drop policy if exists update_requisitions on requisitions;
create policy update_requisitions on requisitions for update to authenticated
  using (my_role() in ('supervisor', 'admin'));

drop policy if exists read_req_items on requisition_items;
create policy read_req_items on requisition_items for select to authenticated using (
  exists (select 1 from requisitions r where r.id = requisition_id and (
    r.requester_id = auth.uid()
    or (my_role() = 'supervisor' and r.hub_code = my_hub())
    or my_role() = 'admin'))
);

drop policy if exists read_sync_log on sync_log;
create policy read_sync_log on sync_log for select to authenticated using (
  exists (select 1 from requisitions r where r.id = requisition_id and (
    r.requester_id = auth.uid() or my_role() in ('supervisor', 'admin')))
);

drop policy if exists rw_returns on returns;
create policy rw_returns on returns for all to authenticated
  using (returned_by = auth.uid() or my_role() in ('supervisor', 'admin'))
  with check (returned_by = auth.uid() or my_role() in ('supervisor', 'admin'));

drop policy if exists read_movements on stock_movements;
create policy read_movements on stock_movements for select to authenticated
  using (my_role() in ('supervisor', 'admin'));

drop policy if exists read_settings on app_settings;
create policy read_settings on app_settings for select to authenticated using (true);
drop policy if exists write_settings on app_settings;
create policy write_settings on app_settings for all to authenticated
  using (my_role() = 'admin') with check (my_role() = 'admin');

-- หมายเหตุ: ไม่มี policy INSERT บน requisitions / requisition_items โดยตั้งใจ
-- การสร้างคำขอต้องผ่าน RPC create_requisition (security definer) เท่านั้น

-- ---------------------------------------------------------------------
-- ข้อมูลตั้งต้น
-- ---------------------------------------------------------------------
insert into hubs (code, name) values
  ('BPL','BPL HUB'), ('AYU','AYU HUB'), ('PDT','PDT HUB'),
  ('WNO','WNO HUB'), ('BAG','BAG HUB')
on conflict do nothing;

insert into categories (name, auto_approvable) values
  ('ทำความสะอาด', true), ('สำนักงาน', true), ('PPE', true), ('อุปกรณ์ยืม-คืน', false)
on conflict do nothing;


-- =====================================================================
-- BPL SUPPLY — ส่วนเสริมที่แอปต้องใช้จริง (รันต่อจาก 001_init.sql)
-- ปลอดภัยที่จะรันซ้ำ
-- =====================================================================

-- 001 ใส่ข้อมูลตั้งต้นหมวดด้วย "on conflict do nothing" แต่ยังไม่มี unique
-- ทำให้รันซ้ำแล้วหมวดซ้ำ — ปิดช่องนี้ก่อน แล้วค่อยลบตัวซ้ำที่เกิดไปแล้ว
delete from categories a
  using categories b
  where a.name = b.name and a.id > b.id
    and not exists (select 1 from items i where i.category_id = a.id);

create unique index if not exists categories_name_key on categories (name);

-- ---------------------------------------------------------------------
-- RPC: ปฏิเสธทั้งคำขอ
-- ---------------------------------------------------------------------
create or replace function reject_requisition(
  p_requisition_id uuid,
  p_reason         text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor profiles%rowtype;
begin
  select * into v_actor from profiles where id = auth.uid();
  if not found or v_actor.role = 'staff' then
    raise exception 'ไม่มีสิทธิ์ปฏิเสธคำขอ';
  end if;

  update requisition_items
    set status = 'rejected', qty_approved = 0
    where requisition_id = p_requisition_id and status = 'pending';

  update requisitions
    set status = 'rejected', reject_reason = p_reason, decided_by = v_actor.id, decided_at = now()
    where id = p_requisition_id;

  return jsonb_build_object('status', 'rejected');
end $$;

-- ---------------------------------------------------------------------
-- RPC: อัปเดตแถบรหัสสถานะย่อ (sync_log ไม่มี policy เขียนโดยตั้งใจ)
-- ---------------------------------------------------------------------
create or replace function set_sync(
  p_requisition_id uuid,
  p_channel        sync_channel,
  p_state          sync_state,
  p_detail         text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_owner uuid;
begin
  select role into v_role from profiles where id = auth.uid();
  select requester_id into v_owner from requisitions where id = p_requisition_id;
  if v_owner is null then
    raise exception 'ไม่พบคำขอ';
  end if;
  if v_owner <> auth.uid() and coalesce(v_role, 'staff') = 'staff' then
    raise exception 'ไม่มีสิทธิ์แก้สถานะคำขอนี้';
  end if;

  insert into sync_log (requisition_id, channel, state, detail, updated_at)
  values (p_requisition_id, p_channel, p_state, p_detail, now())
  on conflict (requisition_id, channel)
  do update set state = excluded.state, detail = excluded.detail, updated_at = now();
end $$;

-- ---------------------------------------------------------------------
-- RPC: บันทึกการคืนของประเภทยืม-คืน
-- สภาพ ok เท่านั้นที่คืนเข้าสต็อก ชำรุด/สูญหายบันทึกไว้ให้แอดมินตรวจ
-- ---------------------------------------------------------------------
create or replace function create_return(
  p_line_id   bigint,
  p_qty       integer,
  p_condition return_cond default 'ok',
  p_file_id   text default null,
  p_link      text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor    profiles%rowtype;
  v_line     requisition_items%rowtype;
  v_req      requisitions%rowtype;
  v_item     items%rowtype;
  v_returned integer;
  v_after    integer;
  v_id       bigint;
begin
  select * into v_actor from profiles where id = auth.uid();
  if not found or not v_actor.is_active then
    raise exception 'ไม่พบผู้ใช้หรือบัญชีถูกระงับ';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'จำนวนที่คืนไม่ถูกต้อง';
  end if;

  select * into v_line from requisition_items where id = p_line_id;
  if not found then
    raise exception 'ไม่พบบรรทัดรายการ';
  end if;
  select * into v_req from requisitions where id = v_line.requisition_id;

  if v_req.requester_id <> v_actor.id and v_actor.role = 'staff' then
    raise exception 'คืนได้เฉพาะของที่ตัวเองเบิก';
  end if;
  if v_line.status <> 'approved' then
    raise exception 'บรรทัดนี้ยังไม่ได้อนุมัติ จึงยังคืนไม่ได้';
  end if;

  select coalesce(sum(qty), 0) into v_returned from returns where requisition_item_id = p_line_id;
  if v_returned + p_qty > coalesce(v_line.qty_approved, 0) then
    raise exception 'คืนเกินจำนวนที่เบิกไป (ค้างอยู่ %)', coalesce(v_line.qty_approved, 0) - v_returned;
  end if;

  insert into returns (requisition_item_id, returned_by, qty, condition, evidence_file_id, evidence_web_link)
  values (p_line_id, v_actor.id, p_qty, p_condition, p_file_id, p_link)
  returning id into v_id;

  if p_condition = 'ok' then
    select * into v_item from items where id = v_line.item_id for update;
    v_after := v_item.qty_on_hand + p_qty;
    update items set qty_on_hand = v_after, updated_at = now() where id = v_item.id;
    insert into stock_movements (item_id, delta, qty_after, reason, ref_type, ref_id, actor_id)
      values (v_item.id, p_qty, v_after, 'return', 'return', v_id::text, v_actor.id);
  end if;

  return jsonb_build_object('id', v_id, 'qty_after', v_after);
end $$;

-- ---------------------------------------------------------------------
-- RPC: รับของเข้า / ปรับยอด (แอดมินเท่านั้น) — ต้องมี audit trail เสมอ
-- ---------------------------------------------------------------------
create or replace function adjust_stock(
  p_item_id bigint,
  p_delta   integer,
  p_reason  text default 'adjust'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor profiles%rowtype;
  v_item  items%rowtype;
  v_after integer;
begin
  select * into v_actor from profiles where id = auth.uid();
  if not found or v_actor.role <> 'admin' then
    raise exception 'เฉพาะแอดมินเท่านั้นที่ปรับสต็อกได้';
  end if;
  if p_delta = 0 then
    raise exception 'จำนวนที่เปลี่ยนต้องไม่เป็นศูนย์';
  end if;

  select * into v_item from items where id = p_item_id for update;
  if not found then
    raise exception 'ไม่พบวัสดุ';
  end if;

  v_after := v_item.qty_on_hand + p_delta;
  if v_after < 0 then
    raise exception 'ยอดคงเหลือติดลบไม่ได้ (ปัจจุบัน %)', v_item.qty_on_hand;
  end if;

  update items set qty_on_hand = v_after, updated_at = now() where id = p_item_id;
  insert into stock_movements (item_id, delta, qty_after, reason, ref_type, ref_id, actor_id)
    values (p_item_id, p_delta, v_after, p_reason, 'adjust', null, v_actor.id);

  return jsonb_build_object('qty_after', v_after);
end $$;

-- ---------------------------------------------------------------------
-- View: ของยืม-คืนที่ยังค้างอยู่ — security_invoker ให้ RLS ของตารางต้นทางทำงาน
-- ---------------------------------------------------------------------
create or replace view open_borrowings
with (security_invoker = true) as
select
  ri.id                                         as requisition_item_id,
  r.id                                          as requisition_id,
  r.ref_no,
  r.requester_id,
  r.hub_code,
  i.id                                          as item_id,
  i.sku,
  i.name                                        as item_name,
  i.unit,
  i.shelf_code,
  coalesce(ri.qty_approved, 0)                  as qty_taken,
  coalesce(rt.qty_returned, 0)::int             as qty_returned,
  (coalesce(ri.qty_approved, 0) - coalesce(rt.qty_returned, 0))::int as qty_open,
  r.created_at
from requisition_items ri
join requisitions r on r.id = ri.requisition_id
join items i        on i.id = ri.item_id
left join lateral (
  select sum(qty)::int as qty_returned from returns where requisition_item_id = ri.id
) rt on true
where i.is_returnable
  and ri.status = 'approved'
  and coalesce(ri.qty_approved, 0) > coalesce(rt.qty_returned, 0);

-- ---------------------------------------------------------------------
-- ให้ผู้ใช้ที่ล็อกอินเรียก RPC เหล่านี้ได้
-- ---------------------------------------------------------------------
grant execute on function create_requisition(jsonb, text, text, text, text, integer) to authenticated;
grant execute on function approve_requisition(uuid, bigint[])                        to authenticated;
grant execute on function reject_requisition(uuid, text)                             to authenticated;
grant execute on function set_sync(uuid, sync_channel, sync_state, text)             to authenticated;
grant execute on function create_return(bigint, integer, return_cond, text, text)    to authenticated;
grant execute on function adjust_stock(bigint, integer, text)                        to authenticated;
grant select on open_borrowings to authenticated;


-- =====================================================================
-- BPL SUPPLY — บังคับตั้งรหัสผ่านใหม่ตอนล็อกอินครั้งแรก
-- รันต่อจาก 002_extras.sql · ปลอดภัยที่จะรันซ้ำ
--
-- แอดมินส่งรหัสชั่วคราวให้พนักงานปากเปล่า พนักงานล็อกอินแล้วต้องตั้งรหัสใหม่ทันที
-- แอดมินจึงรู้รหัสของพนักงานแค่ครั้งเดียวตอนส่งมอบ
-- =====================================================================

alter table profiles
  add column if not exists must_change_password boolean not null default false;

-- ---------------------------------------------------------------------
-- RPC: พนักงานเคลียร์ธงของตัวเองหลังตั้งรหัสใหม่สำเร็จ
-- profiles ไม่มี policy ให้ staff แก้แถวตัวเอง จึงต้องผ่าน security definer
-- ---------------------------------------------------------------------
create or replace function clear_password_flag() returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'ต้องเข้าสู่ระบบก่อน';
  end if;
  update profiles set must_change_password = false where id = auth.uid();
end $$;

grant execute on function clear_password_flag() to authenticated;


-- =====================================================================
-- BPL SUPPLY — ยุบเหลือผู้ดูแล 2 ระดับ ไม่มี "หัวหน้างาน"
-- รันต่อจาก 003_first_login.sql · ปลอดภัยที่จะรันซ้ำ
--
-- ค่าใน enum ยังเป็น staff / supervisor / admin เหมือนเดิม
-- เปลี่ยนแค่ว่า supervisor ทำอะไรได้บ้าง และหน้าจอเรียกเขาว่า "แอดมิน"
--
--   supervisor = "แอดมิน"       อนุมัติคำขอ · แก้สต็อก · รับของเข้า · ส่งออก Sheet
--   admin      = "ผู้ดูแลระบบ"   ทุกอย่างข้างบน + เพิ่มบัญชี/รีเซ็ตรหัสผ่านคนอื่น
-- =====================================================================

-- ---- แก้สต็อก / เพิ่มวัสดุ: เดิม admin เท่านั้น -> เปิดให้ supervisor ด้วย ----
drop policy if exists write_items on items;
create policy write_items on items for all to authenticated
  using (my_role() in ('supervisor', 'admin'))
  with check (my_role() in ('supervisor', 'admin'));

-- ---- สวิตช์อนุมัติอัตโนมัติ: เดิม admin เท่านั้น -> เปิดให้ supervisor ด้วย ----
drop policy if exists write_settings on app_settings;
create policy write_settings on app_settings for all to authenticated
  using (my_role() in ('supervisor', 'admin'))
  with check (my_role() in ('supervisor', 'admin'));

-- ---- จัดการผู้ใช้: ยังเป็นของ admin คนเดียวเหมือนเดิม (ไม่แตะ write_profiles) ----

-- ---- รับของเข้า / ปรับยอด: เดิม admin เท่านั้น -> เปิดให้ supervisor ด้วย ----
create or replace function adjust_stock(
  p_item_id bigint,
  p_delta   integer,
  p_reason  text default 'adjust'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor profiles%rowtype;
  v_item  items%rowtype;
  v_after integer;
begin
  select * into v_actor from profiles where id = auth.uid();
  if not found or not v_actor.is_active or v_actor.role = 'staff' then
    raise exception 'ไม่มีสิทธิ์ปรับสต็อก';
  end if;
  if p_delta = 0 then
    raise exception 'จำนวนที่เปลี่ยนต้องไม่เป็นศูนย์';
  end if;

  select * into v_item from items where id = p_item_id for update;
  if not found then
    raise exception 'ไม่พบวัสดุ';
  end if;

  v_after := v_item.qty_on_hand + p_delta;
  if v_after < 0 then
    raise exception 'ยอดคงเหลือติดลบไม่ได้ (ปัจจุบัน %)', v_item.qty_on_hand;
  end if;

  update items set qty_on_hand = v_after, updated_at = now() where id = p_item_id;
  insert into stock_movements (item_id, delta, qty_after, reason, ref_type, ref_id, actor_id)
    values (p_item_id, p_delta, v_after, p_reason, 'adjust', null, v_actor.id);

  return jsonb_build_object('qty_after', v_after);
end $$;

grant execute on function adjust_stock(bigint, integer, text) to authenticated;


-- =====================================================================
-- BPL SUPPLY — ตั้งได้รายตัวว่าวัสดุชิ้นไหนต้องขออนุมัติทุกครั้ง
-- รันต่อจาก 004 · ปลอดภัยที่จะรันซ้ำ
--
-- เดิมคุมได้แค่ระดับหมวด (categories.auto_approvable)
-- ของราคาแพงหรือของที่ต้องคุมการใช้ จึงต้องแยกหมวดออกมาเอง ซึ่งไม่สะดวก
-- คอลัมน์นี้ทับกฎของหมวดเสมอ: ติ๊กแล้ว = ต้องอนุมัติ ไม่ว่าหมวดจะตั้งไว้ยังไง
-- =====================================================================

alter table items
  add column if not exists requires_approval boolean not null default false;

comment on column items.requires_approval is
  'true = ต้องให้แอดมินอนุมัติทุกครั้ง แม้หมวดจะเปิดอนุมัติอัตโนมัติไว้';

-- ---------------------------------------------------------------------
-- create_requisition — เพิ่มเงื่อนไข requires_approval
-- (รวมการแก้ cast sync_state ของเดิมไว้แล้ว)
-- ---------------------------------------------------------------------
create or replace function create_requisition(
  p_lines            jsonb,
  p_purpose          text default null,
  p_note             text default null,
  p_evidence_file_id text default null,
  p_evidence_link    text default null,
  p_evidence_bytes   integer default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile    profiles%rowtype;
  v_req_id     uuid;
  v_ref        text;
  v_line       jsonb;
  v_item       items%rowtype;
  v_qty        integer;
  v_auto       boolean;
  v_all_auto   boolean := true;
  v_status     req_status;
begin
  select * into v_profile from profiles where id = auth.uid();
  if not found or not v_profile.is_active then
    raise exception 'ไม่พบผู้ใช้หรือบัญชีถูกระงับ';
  end if;

  if jsonb_array_length(p_lines) = 0 then
    raise exception 'ตะกร้าว่าง';
  end if;

  select (value)::boolean into v_auto from app_settings where key = 'auto_approve_consumables';
  v_auto := coalesce(v_auto, false);

  -- รอบแรก: ล็อกแถวและตรวจสต็อกให้ครบทุกบรรทัดก่อน แล้วค่อยตัด
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_line->>'qty')::int;
    if v_qty is null or v_qty <= 0 then
      raise exception 'จำนวนไม่ถูกต้อง';
    end if;

    select * into v_item from items
      where id = (v_line->>'item_id')::bigint and is_active
      for update;

    if not found then
      raise exception 'ไม่พบวัสดุรหัส %', v_line->>'item_id';
    end if;
    if v_item.qty_on_hand < v_qty then
      raise exception 'สต็อกไม่พอ: % เหลือ % ขอ %', v_item.name, v_item.qty_on_hand, v_qty;
    end if;

    -- บรรทัดไหนไม่เข้าเงื่อนไข auto → ทั้งคำขอเข้าคิวรออนุมัติ
    if v_item.requires_approval then
      v_all_auto := false;
    elsif not exists (
      select 1 from categories c
      where c.id = v_item.category_id
        and c.auto_approvable
        and not v_item.is_returnable
        and (v_item.qty_on_hand - v_qty) >= v_item.min_qty
    ) then
      v_all_auto := false;
    end if;
  end loop;

  v_status := case when v_auto and v_all_auto then 'approved'::req_status
                   else 'pending'::req_status end;
  v_ref := next_ref_no();

  insert into requisitions (ref_no, requester_id, hub_code, purpose, note, status,
                            evidence_file_id, evidence_web_link, evidence_bytes,
                            decided_at, decided_by)
  values (v_ref, v_profile.id, v_profile.hub_code, p_purpose, p_note, v_status,
          p_evidence_file_id, p_evidence_link, p_evidence_bytes,
          case when v_status = 'approved' then now() end,
          case when v_status = 'approved' then v_profile.id end)
  returning id into v_req_id;

  -- รอบสอง: เขียนบรรทัด และตัดสต็อกเฉพาะเมื่ออนุมัติอัตโนมัติ
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_line->>'qty')::int;
    select * into v_item from items where id = (v_line->>'item_id')::bigint;

    insert into requisition_items (requisition_id, item_id, qty_requested,
                                   qty_approved, status, qty_before, qty_after)
    values (v_req_id, v_item.id, v_qty,
            case when v_status = 'approved' then v_qty end,
            case when v_status = 'approved' then 'approved'::line_status
                 else 'pending'::line_status end,
            v_item.qty_on_hand,
            case when v_status = 'approved' then v_item.qty_on_hand - v_qty end);

    if v_status = 'approved' then
      update items set qty_on_hand = qty_on_hand - v_qty, updated_at = now()
        where id = v_item.id;
      insert into stock_movements (item_id, delta, qty_after, reason, ref_type, ref_id, actor_id)
        values (v_item.id, -v_qty, v_item.qty_on_hand - v_qty, 'requisition',
                'requisition', v_req_id::text, v_profile.id);
    end if;
  end loop;

  -- ต้อง cast ชนิดให้ชัด ไม่งั้น Postgres มองเป็น text แล้วล้มทั้งคำขอ
  insert into sync_log (requisition_id, channel, state) values
    (v_req_id, 'SPB'::sync_channel, 'done'::sync_state),
    (v_req_id, 'GDV'::sync_channel,
      case when p_evidence_file_id is null then 'pending'::sync_state else 'done'::sync_state end),
    (v_req_id, 'GSH'::sync_channel, 'pending'::sync_state)
  on conflict do nothing;

  return jsonb_build_object('ref_no', v_ref, 'id', v_req_id, 'status', v_status);
end $$;

grant execute on function create_requisition(jsonb, text, text, text, text, integer) to authenticated;


-- =====================================================================
-- BPL SUPPLY — ให้แอดมินเพิ่ม/แก้/ลบหมวดวัสดุได้จากในเว็บ
-- รันต่อจาก 005 · ปลอดภัยที่จะรันซ้ำ
--
-- เดิม categories มีแต่ policy อ่าน ไม่มี policy เขียน
-- จึงเพิ่มหมวดได้เฉพาะทาง SQL เท่านั้น
-- =====================================================================

drop policy if exists write_categories on categories;
create policy write_categories on categories for all to authenticated
  using (my_role() in ('supervisor', 'admin'))
  with check (my_role() in ('supervisor', 'admin'));

-- ---------------------------------------------------------------------
-- ลบหมวดอย่างปลอดภัย — ห้ามลบถ้ายังมีวัสดุผูกอยู่
-- ถ้าลบตรง ๆ จะติด foreign key แล้วขึ้น error ที่คนทั่วไปอ่านไม่รู้เรื่อง
-- ---------------------------------------------------------------------
create or replace function delete_category(p_id bigint) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role  user_role;
  v_count integer;
  v_name  text;
begin
  select role into v_role from profiles where id = auth.uid();
  if coalesce(v_role, 'staff') = 'staff' then
    raise exception 'ไม่มีสิทธิ์ลบหมวด';
  end if;

  select name into v_name from categories where id = p_id;
  if v_name is null then
    raise exception 'ไม่พบหมวดนี้';
  end if;

  select count(*) into v_count from items where category_id = p_id;
  if v_count > 0 then
    raise exception 'ลบไม่ได้ หมวด "%" ยังมีวัสดุอยู่ % รายการ ย้ายวัสดุไปหมวดอื่นก่อน', v_name, v_count;
  end if;

  delete from categories where id = p_id;
end $$;

grant execute on function delete_category(bigint) to authenticated;


-- =====================================================================
-- BPL SUPPLY — แกลเลอรีหลักฐาน + แยกเรื่อง "ยืม-คืน" ออกจาก "ต้องอนุมัติ"
-- รันต่อจาก 006 · ปลอดภัยที่จะรันซ้ำ
--
-- 1. ของยืม-คืนไม่ต้องรออนุมัติอัตโนมัติอีกต่อไป
--    เดิมบังคับว่าของยืม-คืนต้องรออนุมัติเสมอ แต่ความต้องการจริงคือ
--    "อยากเห็นหลักฐานการยืม-คืน" ไม่ใช่ "อยากกดอนุมัติ"
--    ถ้าชิ้นไหนอยากให้อนุมัติจริง ๆ ให้ติ๊ก requires_approval เอา
--
-- 2. เพิ่มธงซ่อนรูปที่จัดการเสร็จแล้ว เหลือไว้แค่ข้อมูลกับลิงก์
-- =====================================================================

alter table requisitions
  add column if not exists evidence_archived boolean not null default false;

alter table returns
  add column if not exists evidence_archived boolean not null default false;

comment on column requisitions.evidence_archived is
  'true = แอดมินเอารูปไปใช้เรียบร้อยแล้ว ซ่อนจากแกลเลอรี แต่ลิงก์ยังอยู่';

-- ---------------------------------------------------------------------
-- create_requisition — เอาเงื่อนไข is_returnable ออกจากกฎอนุมัติอัตโนมัติ
-- ---------------------------------------------------------------------
create or replace function create_requisition(
  p_lines            jsonb,
  p_purpose          text default null,
  p_note             text default null,
  p_evidence_file_id text default null,
  p_evidence_link    text default null,
  p_evidence_bytes   integer default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile    profiles%rowtype;
  v_req_id     uuid;
  v_ref        text;
  v_line       jsonb;
  v_item       items%rowtype;
  v_qty        integer;
  v_auto       boolean;
  v_all_auto   boolean := true;
  v_status     req_status;
begin
  select * into v_profile from profiles where id = auth.uid();
  if not found or not v_profile.is_active then
    raise exception 'ไม่พบผู้ใช้หรือบัญชีถูกระงับ';
  end if;

  if jsonb_array_length(p_lines) = 0 then
    raise exception 'ตะกร้าว่าง';
  end if;

  select (value)::boolean into v_auto from app_settings where key = 'auto_approve_consumables';
  v_auto := coalesce(v_auto, false);

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_line->>'qty')::int;
    if v_qty is null or v_qty <= 0 then
      raise exception 'จำนวนไม่ถูกต้อง';
    end if;

    select * into v_item from items
      where id = (v_line->>'item_id')::bigint and is_active
      for update;

    if not found then
      raise exception 'ไม่พบวัสดุรหัส %', v_line->>'item_id';
    end if;
    if v_item.qty_on_hand < v_qty then
      raise exception 'สต็อกไม่พอ: % เหลือ % ขอ %', v_item.name, v_item.qty_on_hand, v_qty;
    end if;

    -- ติ๊กไว้รายตัว = รออนุมัติเสมอ ชนะทุกกฎ
    if v_item.requires_approval then
      v_all_auto := false;
    elsif not exists (
      select 1 from categories c
      where c.id = v_item.category_id
        and c.auto_approvable
        and (v_item.qty_on_hand - v_qty) >= v_item.min_qty
    ) then
      v_all_auto := false;
    end if;
  end loop;

  v_status := case when v_auto and v_all_auto then 'approved'::req_status
                   else 'pending'::req_status end;
  v_ref := next_ref_no();

  insert into requisitions (ref_no, requester_id, hub_code, purpose, note, status,
                            evidence_file_id, evidence_web_link, evidence_bytes,
                            decided_at, decided_by)
  values (v_ref, v_profile.id, v_profile.hub_code, p_purpose, p_note, v_status,
          p_evidence_file_id, p_evidence_link, p_evidence_bytes,
          case when v_status = 'approved' then now() end,
          case when v_status = 'approved' then v_profile.id end)
  returning id into v_req_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_line->>'qty')::int;
    select * into v_item from items where id = (v_line->>'item_id')::bigint;

    insert into requisition_items (requisition_id, item_id, qty_requested,
                                   qty_approved, status, qty_before, qty_after)
    values (v_req_id, v_item.id, v_qty,
            case when v_status = 'approved' then v_qty end,
            case when v_status = 'approved' then 'approved'::line_status
                 else 'pending'::line_status end,
            v_item.qty_on_hand,
            case when v_status = 'approved' then v_item.qty_on_hand - v_qty end);

    if v_status = 'approved' then
      update items set qty_on_hand = qty_on_hand - v_qty, updated_at = now()
        where id = v_item.id;
      insert into stock_movements (item_id, delta, qty_after, reason, ref_type, ref_id, actor_id)
        values (v_item.id, -v_qty, v_item.qty_on_hand - v_qty, 'requisition',
                'requisition', v_req_id::text, v_profile.id);
    end if;
  end loop;

  insert into sync_log (requisition_id, channel, state) values
    (v_req_id, 'SPB'::sync_channel, 'done'::sync_state),
    (v_req_id, 'GDV'::sync_channel,
      case when p_evidence_file_id is null then 'pending'::sync_state else 'done'::sync_state end),
    (v_req_id, 'GSH'::sync_channel, 'pending'::sync_state)
  on conflict do nothing;

  return jsonb_build_object('ref_no', v_ref, 'id', v_req_id, 'status', v_status);
end $$;

grant execute on function create_requisition(jsonb, text, text, text, text, integer) to authenticated;

-- ---------------------------------------------------------------------
-- View: รวมหลักฐานทั้งขาเบิกและขาคืนไว้ที่เดียว
-- security_invoker ให้ RLS ของตารางต้นทางทำงานตามปกติ
-- ---------------------------------------------------------------------
create or replace view evidence_feed
with (security_invoker = true) as
select
  'requisition'::text                       as kind,
  r.id::text                                as source_id,
  r.ref_no,
  r.created_at,
  r.hub_code,
  r.evidence_file_id                        as file_id,
  r.evidence_web_link                       as web_link,
  r.evidence_archived                       as archived,
  p.full_name                               as who,
  p.employee_code,
  coalesce((
    select bool_or(i.is_returnable)
    from requisition_items ri join items i on i.id = ri.item_id
    where ri.requisition_id = r.id
  ), false)                                 as has_returnable,
  coalesce((
    select string_agg(i.name || ' x' || ri.qty_requested, ', ' order by ri.id)
    from requisition_items ri join items i on i.id = ri.item_id
    where ri.requisition_id = r.id
  ), '')                                    as summary
from requisitions r
join profiles p on p.id = r.requester_id
where r.evidence_file_id is not null

union all

select
  'return'::text,
  rt.id::text,
  rq.ref_no,
  rt.created_at,
  rq.hub_code,
  rt.evidence_file_id,
  rt.evidence_web_link,
  rt.evidence_archived,
  p.full_name,
  p.employee_code,
  true,
  i.name || ' คืน ' || rt.qty || ' (' ||
    case rt.condition when 'ok' then 'ใช้ได้' when 'damaged' then 'ชำรุด' else 'สูญหาย' end || ')'
from returns rt
join requisition_items ri on ri.id = rt.requisition_item_id
join requisitions rq      on rq.id = ri.requisition_id
join items i              on i.id = ri.item_id
join profiles p           on p.id = rt.returned_by
where rt.evidence_file_id is not null;

grant select on evidence_feed to authenticated;

-- ---------------------------------------------------------------------
-- RPC: ซ่อน/เลิกซ่อนรูปในแกลเลอรี (แอดมินขึ้นไปเท่านั้น)
-- ---------------------------------------------------------------------
create or replace function set_evidence_archived(
  p_kind      text,
  p_source_id text,
  p_archived  boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
begin
  select role into v_role from profiles where id = auth.uid();
  if coalesce(v_role, 'staff') = 'staff' then
    raise exception 'ไม่มีสิทธิ์จัดการหลักฐาน';
  end if;

  if p_kind = 'requisition' then
    update requisitions set evidence_archived = p_archived where id = p_source_id::uuid;
  elsif p_kind = 'return' then
    update returns set evidence_archived = p_archived where id = p_source_id::bigint;
  else
    raise exception 'ประเภทหลักฐานไม่ถูกต้อง';
  end if;
end $$;

grant execute on function set_evidence_archived(text, text, boolean) to authenticated;


-- =====================================================================
-- BPL SUPPLY — ทำให้ส่งออก Google Sheet เร็วคงที่ ไม่อืดเมื่อข้อมูลเยอะ
-- รันต่อจาก 007 · ปลอดภัยที่จะรันซ้ำ
--
-- ปัญหาเดิม: ทุกครั้งที่ส่งออก ต้องอ่านทั้งชีตมาเทียบว่าแถวไหนมีแล้ว
-- พอถึงหลายหมื่นแถวจะช้าลงเรื่อย ๆ จนอาจหมดเวลาทำงานของ Edge Function
--
-- วิธีใหม่: จำไว้ในฐานข้อมูลว่าบรรทัดไหนไปอยู่แท็บไหน แถวที่เท่าไหร่
-- แถวใหม่ต่อท้าย แถวเดิมเขียนทับเฉพาะตำแหน่งนั้น ไม่ต้องอ่านทั้งชีตอีก
-- แถมแยกแท็บรายเดือน แต่ละแท็บจึงเล็กและเปิดเร็วเสมอ
-- =====================================================================

create table if not exists sheet_exports (
  requisition_item_id bigint primary key references requisition_items(id) on delete cascade,
  tab                 text    not null,
  row_no              integer not null,
  exported_at         timestamptz not null default now()
);

create index if not exists sheet_exports_tab_idx on sheet_exports (tab, row_no);

alter table sheet_exports enable row level security;

-- อ่านได้เฉพาะแอดมินขึ้นไป · เขียนผ่าน Edge Function (service role) เท่านั้น
drop policy if exists read_sheet_exports on sheet_exports;
create policy read_sheet_exports on sheet_exports for select to authenticated
  using (my_role() in ('supervisor', 'admin'));

comment on table sheet_exports is
  'จำว่าบรรทัดรายการไหนถูกส่งไปอยู่แท็บไหน แถวที่เท่าไหร่ ใช้กันแถวซ้ำโดยไม่ต้องอ่านทั้งชีต';


-- =====================================================================
-- BPL SUPPLY — แนบรูปหลักฐานได้หลายใบต่อ 1 คำขอ (สูงสุด 5)
-- รันต่อจาก 008 · ปลอดภัยที่จะรันซ้ำ
--
-- คอลัมน์ evidence_file_id เดิมบน requisitions ยังอยู่และยังใช้ได้
-- มันคือ "รูปหลัก" = ใบแรก ของเดิมทุกอย่างจึงไม่พัง
-- รูปที่เหลือเก็บในตารางใหม่นี้
-- =====================================================================

create table if not exists requisition_photos (
  id             bigserial primary key,
  requisition_id uuid not null references requisitions(id) on delete cascade,
  file_id        text not null,
  web_link       text,
  bytes          integer,
  sort_no        integer not null default 0,
  created_at     timestamptz not null default now(),
  unique (requisition_id, file_id)
);

create index if not exists req_photos_req_idx on requisition_photos (requisition_id, sort_no);

alter table requisition_photos enable row level security;

-- เห็นได้เหมือนเงื่อนไขของคำขอต้นทาง (เจ้าของคำขอ / แอดมิน)
-- หมายเหตุ: หน้าฝั่งพนักงานยังห้ามโชว์ลิงก์รูปตามกติกาข้อ 4 — บังคับที่ UI
drop policy if exists read_req_photos on requisition_photos;
create policy read_req_photos on requisition_photos for select to authenticated using (
  exists (
    select 1 from requisitions r
    where r.id = requisition_id
      and (r.requester_id = auth.uid() or my_role() in ('supervisor', 'admin'))
  )
);

-- ไม่มี policy insert โดยตั้งใจ — ต้องผ่าน RPC ด้านล่างเท่านั้น

-- ---------------------------------------------------------------------
-- RPC: แนบรูปเข้าคำขอ
-- p_photos ตัวอย่าง: '[{"file_id":"abc","web_link":"https://...","bytes":16000}]'
-- ---------------------------------------------------------------------
create or replace function add_requisition_photos(
  p_requisition_id uuid,
  p_photos         jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req    requisitions%rowtype;
  v_role   user_role;
  v_photo  jsonb;
  v_next   integer;
  v_added  integer := 0;
  v_total  integer;
begin
  select * into v_req from requisitions where id = p_requisition_id;
  if not found then
    raise exception 'ไม่พบคำขอ';
  end if;

  select role into v_role from profiles where id = auth.uid();
  if v_req.requester_id <> auth.uid() and coalesce(v_role, 'staff') = 'staff' then
    raise exception 'แนบรูปได้เฉพาะคำขอของตัวเอง';
  end if;

  select coalesce(max(sort_no) + 1, 0) into v_next
    from requisition_photos where requisition_id = p_requisition_id;

  for v_photo in select * from jsonb_array_elements(p_photos) loop
    if (v_photo->>'file_id') is null or length(v_photo->>'file_id') = 0 then
      continue;
    end if;

    select count(*) into v_total from requisition_photos where requisition_id = p_requisition_id;
    if v_total >= 5 then
      raise exception 'แนบรูปได้สูงสุด 5 ใบต่อคำขอ';
    end if;

    insert into requisition_photos (requisition_id, file_id, web_link, bytes, sort_no)
    values (p_requisition_id, v_photo->>'file_id', v_photo->>'web_link',
            (v_photo->>'bytes')::int, v_next)
    on conflict (requisition_id, file_id) do nothing;

    if found then
      v_next  := v_next + 1;
      v_added := v_added + 1;
    end if;
  end loop;

  -- ใบแรกเป็นรูปหลัก เพื่อให้ทุกอย่างที่อ่าน evidence_file_id เดิมยังทำงานได้
  if v_req.evidence_file_id is null then
    update requisitions r
      set evidence_file_id  = p.file_id,
          evidence_web_link = p.web_link,
          evidence_bytes    = p.bytes
      from (
        select file_id, web_link, bytes from requisition_photos
        where requisition_id = p_requisition_id order by sort_no limit 1
      ) p
      where r.id = p_requisition_id;
  end if;

  select count(*) into v_total from requisition_photos where requisition_id = p_requisition_id;
  return jsonb_build_object('added', v_added, 'total', v_total);
end $$;

grant execute on function add_requisition_photos(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- View: เพิ่มจำนวนรูปและรายการ file_id ทั้งหมด
-- ---------------------------------------------------------------------
create or replace view evidence_feed
with (security_invoker = true) as
select
  'requisition'::text                       as kind,
  r.id::text                                as source_id,
  r.ref_no,
  r.created_at,
  r.hub_code,
  r.evidence_file_id                        as file_id,
  r.evidence_web_link                       as web_link,
  r.evidence_archived                       as archived,
  p.full_name                               as who,
  p.employee_code,
  coalesce((
    select bool_or(i.is_returnable)
    from requisition_items ri join items i on i.id = ri.item_id
    where ri.requisition_id = r.id
  ), false)                                 as has_returnable,
  coalesce((
    select string_agg(i.name || ' x' || ri.qty_requested, ', ' order by ri.id)
    from requisition_items ri join items i on i.id = ri.item_id
    where ri.requisition_id = r.id
  ), '')                                    as summary,
  coalesce((
    select array_agg(ph.file_id order by ph.sort_no)
    from requisition_photos ph where ph.requisition_id = r.id
  ), array[r.evidence_file_id])             as file_ids
from requisitions r
join profiles p on p.id = r.requester_id
where r.evidence_file_id is not null

union all

select
  'return'::text,
  rt.id::text,
  rq.ref_no,
  rt.created_at,
  rq.hub_code,
  rt.evidence_file_id,
  rt.evidence_web_link,
  rt.evidence_archived,
  p.full_name,
  p.employee_code,
  true,
  i.name || ' คืน ' || rt.qty || ' (' ||
    case rt.condition when 'ok' then 'ใช้ได้' when 'damaged' then 'ชำรุด' else 'สูญหาย' end || ')',
  array[rt.evidence_file_id]
from returns rt
join requisition_items ri on ri.id = rt.requisition_item_id
join requisitions rq      on rq.id = ri.requisition_id
join items i              on i.id = ri.item_id
join profiles p           on p.id = rt.returned_by
where rt.evidence_file_id is not null;

grant select on evidence_feed to authenticated;


-- =====================================================================
-- BPL SUPPLY — แผนกแทนฮับ + รูปตอนคืนหลายใบและบังคับถ่าย
-- รันต่อจาก 009 · ปลอดภัยที่จะรันซ้ำ
--
-- 1. ใช้ฮับเดียว (BPL) จึงเลิกใช้ฮับเป็นตัวแบ่ง เปลี่ยนเป็น "แผนก"
--    คอลัมน์ hub_code ยังอยู่เพื่อไม่ให้ของเดิมพัง แต่ไม่ใช้แบ่งสิทธิ์แล้ว
-- 2. ของประเภทยืม-คืน บังคับถ่ายรูปตอนคืน และแนบได้หลายใบเหมือนตอนเบิก
-- =====================================================================

-- ── แผนก ──────────────────────────────────────────────────────────────
create table if not exists departments (
  code      text primary key,
  name      text not null,
  sort_no   integer not null default 0,
  is_active boolean not null default true
);

insert into departments (code, name, sort_no) values
  ('ALL',      'ทุกแผนก',   0),
  ('OUT4W',    'OUT 4W',    1),
  ('OUT6W',    'OUT 6W',    2),
  ('INLHBG',   'IN LH+BG',  3),
  ('INFD',     'IN FD',     4),
  ('BULKY',    'BULKY',     5),
  ('REPACK',   'REPACK',    6),
  ('MINICS',   'MINI CS',   7)
on conflict (code) do nothing;

alter table departments enable row level security;
drop policy if exists read_departments on departments;
create policy read_departments on departments for select to authenticated using (true);
drop policy if exists write_departments on departments;
create policy write_departments on departments for all to authenticated
  using (my_role() in ('supervisor', 'admin'))
  with check (my_role() in ('supervisor', 'admin'));

-- ── คนอยู่แผนกไหน และเห็นแผนกอื่นได้บ้าง ───────────────────────────────
alter table profiles
  add column if not exists dept_code   text references departments(code),
  -- แผนกพิเศษที่คนนี้เห็นเพิ่มนอกจากแผนกตัวเอง เตรียมไว้ตอนย้ายเครื่องเข้าระบบ
  add column if not exists extra_depts text[] not null default '{}';

comment on column profiles.extra_depts is
  'แผนกเพิ่มเติมที่ผู้ใช้คนนี้มองเห็นของได้ นอกเหนือจาก dept_code ของตัวเอง';

update profiles set dept_code = 'ALL' where dept_code is null;

-- ── ของอยู่แผนกไหน ────────────────────────────────────────────────────
alter table items
  add column if not exists dept_code text references departments(code);

-- ของสิ้นเปลืองเดิมให้ทุกแผนกเห็นหมด ไม่งั้นของหายไปจากหน้าจอทันทีที่รัน
update items set dept_code = 'ALL' where dept_code is null;

create index if not exists items_dept_idx on items (dept_code) where is_active;

-- ── ใครเห็นของชิ้นไหน ─────────────────────────────────────────────────
create or replace function my_depts() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array[dept_code] || extra_depts, '{}') from profiles where id = auth.uid();
$$;

grant execute on function my_depts() to authenticated;

-- แทน read_items เดิมที่กรองด้วยฮับ
drop policy if exists read_items on items;
create policy read_items on items for select to authenticated using (
  my_role() in ('supervisor', 'admin')                 -- แอดมินเห็นหมด
  or dept_code = 'ALL'                                 -- ของกลางทุกคนเห็น
  or 'ALL' = any(my_depts())                           -- คนที่อยู่ "ทุกแผนก" เห็นหมด
  or dept_code = any(my_depts())                       -- แผนกตัวเอง + แผนกพิเศษ
);

-- ── รูปตอนคืน หลายใบ ──────────────────────────────────────────────────
create table if not exists return_photos (
  id         bigserial primary key,
  return_id  bigint not null references returns(id) on delete cascade,
  file_id    text not null,
  web_link   text,
  bytes      integer,
  sort_no    integer not null default 0,
  created_at timestamptz not null default now(),
  unique (return_id, file_id)
);

create index if not exists return_photos_idx on return_photos (return_id, sort_no);

alter table return_photos enable row level security;
drop policy if exists read_return_photos on return_photos;
create policy read_return_photos on return_photos for select to authenticated using (
  exists (
    select 1 from returns rt
    where rt.id = return_id
      and (rt.returned_by = auth.uid() or my_role() in ('supervisor', 'admin'))
  )
);

-- ── บังคับถ่ายรูปตอนคืน ───────────────────────────────────────────────
-- ตรวจที่ฐานข้อมูล ไม่ใช่แค่ซ่อนปุ่ม แก้ HTML ในเครื่องแล้วยิงตรงก็ยังไม่ผ่าน
create or replace function create_return(
  p_line_id   bigint,
  p_qty       integer,
  p_condition return_cond default 'ok',
  p_file_id   text default null,
  p_link      text default null,
  p_photos    jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor    profiles%rowtype;
  v_line     requisition_items%rowtype;
  v_req      requisitions%rowtype;
  v_item     items%rowtype;
  v_returned integer;
  v_after    integer;
  v_id       bigint;
  v_photo    jsonb;
  v_n        integer := 0;
  v_main     text := p_file_id;
begin
  select * into v_actor from profiles where id = auth.uid();
  if not found or not v_actor.is_active then
    raise exception 'ไม่พบผู้ใช้หรือบัญชีถูกระงับ';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'จำนวนที่คืนไม่ถูกต้อง';
  end if;

  select * into v_line from requisition_items where id = p_line_id;
  if not found then
    raise exception 'ไม่พบบรรทัดรายการ';
  end if;
  select * into v_req from requisitions where id = v_line.requisition_id;

  if v_req.requester_id <> v_actor.id and v_actor.role = 'staff' then
    raise exception 'คืนได้เฉพาะของที่ตัวเองเบิก';
  end if;
  if v_line.status <> 'approved' then
    raise exception 'บรรทัดนี้ยังไม่ได้อนุมัติ จึงยังคืนไม่ได้';
  end if;

  if v_main is null then
    v_main := p_photos->0->>'file_id';
  end if;
  if v_main is null then
    raise exception 'ต้องถ่ายรูปสภาพตอนคืนอย่างน้อย 1 ใบ';
  end if;

  select coalesce(sum(qty), 0) into v_returned from returns where requisition_item_id = p_line_id;
  if v_returned + p_qty > coalesce(v_line.qty_approved, 0) then
    raise exception 'คืนเกินจำนวนที่เบิกไป (ค้างอยู่ %)', coalesce(v_line.qty_approved, 0) - v_returned;
  end if;

  insert into returns (requisition_item_id, returned_by, qty, condition, evidence_file_id, evidence_web_link)
  values (p_line_id, v_actor.id, p_qty, p_condition, v_main, p_link)
  returning id into v_id;

  for v_photo in select * from jsonb_array_elements(p_photos) loop
    if (v_photo->>'file_id') is null then continue; end if;
    if v_n >= 5 then exit; end if;
    insert into return_photos (return_id, file_id, web_link, bytes, sort_no)
    values (v_id, v_photo->>'file_id', v_photo->>'web_link', (v_photo->>'bytes')::int, v_n)
    on conflict do nothing;
    v_n := v_n + 1;
  end loop;

  if p_condition = 'ok' then
    select * into v_item from items where id = v_line.item_id for update;
    v_after := v_item.qty_on_hand + p_qty;
    update items set qty_on_hand = v_after, updated_at = now() where id = v_item.id;
    insert into stock_movements (item_id, delta, qty_after, reason, ref_type, ref_id, actor_id)
      values (v_item.id, p_qty, v_after, 'return', 'return', v_id::text, v_actor.id);
  end if;

  return jsonb_build_object('id', v_id, 'qty_after', v_after, 'photos', v_n);
end $$;

grant execute on function create_return(bigint, integer, return_cond, text, text, jsonb) to authenticated;

-- ── view หลักฐาน: รวมรูปตอนคืนหลายใบด้วย ──────────────────────────────
create or replace view evidence_feed
with (security_invoker = true) as
select
  'requisition'::text                       as kind,
  r.id::text                                as source_id,
  r.ref_no,
  r.created_at,
  r.hub_code,
  r.evidence_file_id                        as file_id,
  r.evidence_web_link                       as web_link,
  r.evidence_archived                       as archived,
  p.full_name                               as who,
  p.employee_code,
  coalesce((
    select bool_or(i.is_returnable)
    from requisition_items ri join items i on i.id = ri.item_id
    where ri.requisition_id = r.id
  ), false)                                 as has_returnable,
  coalesce((
    select string_agg(i.name || ' x' || ri.qty_requested, ', ' order by ri.id)
    from requisition_items ri join items i on i.id = ri.item_id
    where ri.requisition_id = r.id
  ), '')                                    as summary,
  coalesce((
    select array_agg(ph.file_id order by ph.sort_no)
    from requisition_photos ph where ph.requisition_id = r.id
  ), array[r.evidence_file_id])             as file_ids
from requisitions r
join profiles p on p.id = r.requester_id
where r.evidence_file_id is not null

union all

select
  'return'::text,
  rt.id::text,
  rq.ref_no,
  rt.created_at,
  rq.hub_code,
  rt.evidence_file_id,
  rt.evidence_web_link,
  rt.evidence_archived,
  p.full_name,
  p.employee_code,
  true,
  i.name || ' คืน ' || rt.qty || ' (' ||
    case rt.condition when 'ok' then 'ใช้ได้' when 'damaged' then 'ชำรุด' else 'สูญหาย' end || ')',
  coalesce((
    select array_agg(ph.file_id order by ph.sort_no)
    from return_photos ph where ph.return_id = rt.id
  ), array[rt.evidence_file_id])
from returns rt
join requisition_items ri on ri.id = rt.requisition_item_id
join requisitions rq      on rq.id = ri.requisition_id
join items i              on i.id = ri.item_id
join profiles p           on p.id = rt.returned_by
where rt.evidence_file_id is not null;

grant select on evidence_feed to authenticated;


-- =====================================================================
-- BPL SUPPLY — เพิ่ม/แก้/ลบแผนกได้เองจากในเว็บ
-- รันต่อจาก 010 · ปลอดภัยที่จะรันซ้ำ
--
-- รหัสแผนกสร้างให้อัตโนมัติ ผู้ใช้กรอกแค่ชื่อ
-- เพราะรหัสถูกอ้างอิงจาก profiles และ items ถ้าให้แก้เองแล้วเปลี่ยนชื่อรหัสทีหลัง
-- ข้อมูลที่ผูกไว้จะขาด — แยกรหัส (ตายตัว) ออกจากชื่อ (แก้ได้อิสระ) จึงปลอดภัยกว่า
-- =====================================================================

create or replace function create_department(p_name text) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_code text;
  v_name text := btrim(p_name);
begin
  select role into v_role from profiles where id = auth.uid();
  if coalesce(v_role, 'staff') = 'staff' then
    raise exception 'ไม่มีสิทธิ์เพิ่มแผนก';
  end if;
  if v_name is null or length(v_name) = 0 then
    raise exception 'ต้องใส่ชื่อแผนก';
  end if;
  if exists (select 1 from departments where lower(name) = lower(v_name)) then
    raise exception 'มีแผนกชื่อ "%" อยู่แล้ว', v_name;
  end if;

  -- วนจนได้รหัสที่ยังไม่ซ้ำ
  loop
    v_code := 'D' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from departments where code = v_code);
  end loop;

  insert into departments (code, name, sort_no)
  values (v_code, v_name, coalesce((select max(sort_no) + 1 from departments), 1));

  return v_code;
end $$;

grant execute on function create_department(text) to authenticated;

-- ---------------------------------------------------------------------
-- ลบแผนกอย่างปลอดภัย — ห้ามลบถ้ายังมีคนหรือของผูกอยู่
-- ---------------------------------------------------------------------
create or replace function delete_department(p_code text) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role  user_role;
  v_name  text;
  v_users integer;
  v_items integer;
  v_extra integer;
begin
  select role into v_role from profiles where id = auth.uid();
  if coalesce(v_role, 'staff') = 'staff' then
    raise exception 'ไม่มีสิทธิ์ลบแผนก';
  end if;
  if p_code = 'ALL' then
    raise exception 'ลบแผนก "ทุกแผนก" ไม่ได้ ระบบใช้เป็นค่าตั้งต้น';
  end if;

  select name into v_name from departments where code = p_code;
  if v_name is null then
    raise exception 'ไม่พบแผนกนี้';
  end if;

  select count(*) into v_users from profiles where dept_code = p_code;
  select count(*) into v_items from items    where dept_code = p_code;
  select count(*) into v_extra from profiles where p_code = any(extra_depts);

  if v_users > 0 or v_items > 0 or v_extra > 0 then
    raise exception
      'ลบไม่ได้ แผนก "%" ยังมีพนักงาน % คน · วัสดุ % รายการ · สิทธิพิเศษ % คน ย้ายออกก่อน',
      v_name, v_users, v_items, v_extra;
  end if;

  delete from departments where code = p_code;
end $$;

grant execute on function delete_department(text) to authenticated;


-- =====================================================================
-- BPL SUPPLY — ใส่ชื่อผู้เบิกและแผนกลงใน view ของค้างคืน
-- รันต่อจาก 011 · ปลอดภัยที่จะรันซ้ำ
--
-- เดิม view คืนแค่ requester_id ซึ่งเป็นรหัสยาว ๆ อ่านไม่รู้เรื่อง
-- หน้า "ของค้างคืน" ต้องตอบให้ได้ว่า "ใคร" ยังไม่คืน จึงต้องมีชื่อติดมาด้วย
-- =====================================================================

-- Postgres ไม่ยอมให้ create or replace view สลับตำแหน่งคอลัมน์
-- (ERROR 42P16) จึงต้อง drop ทิ้งก่อนแล้วสร้างใหม่ — view ไม่เก็บข้อมูล ไม่มีอะไรหาย
drop view if exists open_borrowings;

create or replace view open_borrowings
with (security_invoker = true) as
select
  ri.id                                         as requisition_item_id,
  r.id                                          as requisition_id,
  r.ref_no,
  r.requester_id,
  r.hub_code,
  p.full_name                                   as requester_name,
  p.employee_code                               as requester_code,
  p.dept_code                                   as requester_dept,
  i.id                                          as item_id,
  i.sku,
  i.name                                        as item_name,
  i.unit,
  i.shelf_code,
  coalesce(ri.qty_approved, 0)                  as qty_taken,
  coalesce(rt.qty_returned, 0)::int             as qty_returned,
  (coalesce(ri.qty_approved, 0) - coalesce(rt.qty_returned, 0))::int as qty_open,
  r.created_at
from requisition_items ri
join requisitions r on r.id = ri.requisition_id
join items i        on i.id = ri.item_id
join profiles p     on p.id = r.requester_id
left join lateral (
  select sum(qty)::int as qty_returned from returns where requisition_item_id = ri.id
) rt on true
where i.is_returnable
  and ri.status = 'approved'
  and coalesce(ri.qty_approved, 0) > coalesce(rt.qty_returned, 0);

grant select on open_borrowings to authenticated;


-- =====================================================================
-- BPL SUPPLY — ข้อมูลตัวอย่างสำหรับทดสอบ (รันหลัง 001 และ 002)
-- ลบทิ้งได้ทั้งหมดก่อนขึ้นใช้งานจริง
-- =====================================================================

insert into items (sku, name, category_id, hub_code, unit, shelf_code, qty_on_hand, min_qty, is_returnable, qr_payload)
values
  ('SKU-CL-0091', 'น้ำยาล้างห้องน้ำ 900 มล.',  (select id from categories where name = 'ทำความสะอาด'), 'BPL', 'ขวด', 'A-03', 24, 6,  false, 'SKU-CL-0091'),
  ('SKU-CL-0092', 'ผงซักฟอก 1 กก.',            (select id from categories where name = 'ทำความสะอาด'), 'BPL', 'ถุง', 'A-04', 12, 4,  false, 'SKU-CL-0092'),
  ('SKU-CL-0093', 'ไม้กวาดดอกหญ้า',             (select id from categories where name = 'ทำความสะอาด'), 'BPL', 'ด้าม', 'A-07', 5,  5,  false, 'SKU-CL-0093'),
  ('SKU-CL-0094', 'ถุงขยะดำ 30x40 นิ้ว',        (select id from categories where name = 'ทำความสะอาด'), 'BPL', 'แพ็ก', 'A-08', 0,  3,  false, 'SKU-CL-0094'),
  ('SKU-PP-0201', 'ถุงมือผ้าเคลือบยาง',          (select id from categories where name = 'PPE'),         'BPL', 'คู่',  'B-01', 60, 20, false, 'SKU-PP-0201'),
  ('SKU-PP-0202', 'หน้ากากอนามัย (กล่อง 50)',    (select id from categories where name = 'PPE'),         'BPL', 'กล่อง','B-02', 18, 5,  false, 'SKU-PP-0202'),
  ('SKU-OF-0301', 'กระดาษ A4 80 แกรม',          (select id from categories where name = 'สำนักงาน'),    'BPL', 'รีม',  'C-01', 30, 10, false, 'SKU-OF-0301'),
  ('SKU-OF-0302', 'ปากกาลูกลื่นน้ำเงิน',          (select id from categories where name = 'สำนักงาน'),    'BPL', 'ด้าม', 'C-02', 100,25, false, 'SKU-OF-0302'),
  ('SKU-RT-0401', 'เครื่องสแกนบาร์โค้ดมือถือ',     (select id from categories where name = 'อุปกรณ์ยืม-คืน'), 'BPL', 'เครื่อง','D-01', 8, 2, true,  'SKU-RT-0401'),
  ('SKU-RT-0402', 'รถเข็นลากพาเลท',              (select id from categories where name = 'อุปกรณ์ยืม-คืน'), 'BPL', 'คัน',  'D-02', 4, 1, true,  'SKU-RT-0402')
on conflict (sku) do nothing;
