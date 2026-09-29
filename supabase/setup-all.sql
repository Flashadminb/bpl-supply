-- =====================================================================
-- BPL SUPPLY — รวมทุกอย่างไว้ไฟล์เดียว 001..031 + seed
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

do $$ begin
  alter table assets add constraint assets_held_item_fk
    foreign key (held_item_id) references asset_txn_items(id) on delete set null;
exception when duplicate_object then null; end $$;

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


-- =====================================================================
-- BPL SUPPLY — ย้ายข้อมูลเครื่องจากชีต MASTER เข้าระบบ
-- รันต่อจาก 013 · ปลอดภัยที่จะรันซ้ำ (ไม่ทับของที่แก้ไว้แล้ว)
--
-- ที่มา: "ตั้งค่าระบบถ่ายรูปอัพเดทงาน (MASTER)" แท็บ เครื่อง / หัวข้อ /
--        ช่องถ่ายรูป / เงื่อนไข — ยกมาตรงตามชีตทุกตัวอักษร
--
-- สรุป: Power Pallet 31 · ไอดาต้า 71 · เลเซอร์ลบ 32 · วิทยุสื่อสาร 5
--        รวม 139 เครื่อง · อาการค้าง 19 รายการ
-- =====================================================================

-- ── ประเภท ────────────────────────────────────────────────────────────
insert into asset_types (code, name, sort_no, photo_min, photo_max, issue_tags) values
  ('PP',    'Power Pallet', 1, 5, 6,
     array['แบตไม่เก็บไฟ','ยกไม่ขึ้น','ล้อชำรุด','จอไม่ติด','มีเสียงดัง','น้ำมันรั่ว']),
  ('IDATA', 'ไอดาต้า',      2, 1, 5,
     array['หน้าจอแตก','แบตบวม','ฝาหาย','ความจำเต็ม']),
  ('RADIO', 'วิทยุสื่อสาร',  3, 1, 5,
     array['เสาหัก','แบตเสื่อม','ปุ่มกดไม่ติด','เสียงแตก','ชาร์จไม่เข้า']),
  ('LASER', 'เลเซอร์ลบ',     4, 1, 5,
     array['ยิงไม่ออก','แบตเสื่อม','ชาร์จไม่เข้า','ปุ่มกดไม่ติด','สายชาร์จหาย'])
on conflict (code) do nothing;

-- ── ขั้นตอนถ่ายรูปบังคับ — มีเฉพาะ Power Pallet ───────────────────────
-- ไอดาต้า / วิทยุ / เลเซอร์ ไม่มีขั้นบังคับ ถ่ายอิสระ 1–5 ใบ
insert into asset_photo_steps (type_code, seq, label, hint) values
  ('PP', 1, 'กุญแจ',    'ให้เห็นกุญแจเสียบที่เครื่อง + เลขตัวเครื่อง'),
  ('PP', 2, 'ด้านหน้า', 'ยืนห่าง 2 เมตร ให้เห็นทั้งคัน'),
  ('PP', 3, 'ด้านหลัง', 'ยืนห่าง 2 เมตร ให้เห็นทั้งคัน'),
  ('PP', 4, 'ด้านซ้าย', 'ยืนห่าง 2 เมตร ให้เห็นทั้งคัน'),
  ('PP', 5, 'ด้านขวา',  'ยืนห่าง 2 เมตร ให้เห็นทั้งคัน')
on conflict (type_code, seq) do nothing;

-- ── ทะเบียนเครื่อง ────────────────────────────────────────────────────
-- สถานะ "ซ่อม" ในชีต = is_enabled false (เบิกไม่ได้จนกว่าจะเปิดเอง)

-- Power Pallet ── PP-01..PP-16 (ไม่มี 17) และ PP-18..PP-32
insert into assets (code, type_code, dept_code, is_enabled)
select 'PP-' || lpad(n::text, 2, '0'), 'PP',
       case when n in (14, 15) then 'INLHBG'
            when n >= 18       then 'BULKY'
            else 'OUT4W' end,
       n not in (3, 14)
from generate_series(1, 32) n
where n <> 17
on conflict (code) do nothing;

-- ไอดาต้า ── ประจำแผนก
insert into assets (code, type_code, dept_code, is_enabled)
select 'IN LH + BG ' || lpad(n::text, 2, '0'), 'IDATA', 'INLHBG', true
from generate_series(1, 10) n on conflict (code) do nothing;

insert into assets (code, type_code, dept_code, is_enabled)
select 'IN FD ' || lpad(n::text, 2, '0'), 'IDATA', 'INFD', n <> 8
from generate_series(1, 11) n on conflict (code) do nothing;

insert into assets (code, type_code, dept_code, is_enabled)
select 'REPACK ' || lpad(n::text, 2, '0'), 'IDATA', 'REPACK', n <> 8
from generate_series(1, 8) n on conflict (code) do nothing;

insert into assets (code, type_code, dept_code, is_enabled)
select 'BULKY ' || lpad(n::text, 2, '0'), 'IDATA', 'BULKY', n <> 2
from generate_series(1, 7) n on conflict (code) do nothing;

insert into assets (code, type_code, dept_code, is_enabled)
select 'OUT 4W ' || lpad(n::text, 2, '0'), 'IDATA', 'OUT4W', true
from generate_series(1, 14) n on conflict (code) do nothing;

insert into assets (code, type_code, dept_code, is_enabled)
select 'OUT 6W ' || lpad(n::text, 2, '0'), 'IDATA', 'OUT6W', n <> 8
from generate_series(1, 15) n on conflict (code) do nothing;

insert into assets (code, type_code, dept_code, is_enabled)
select 'MINI ' || n, 'IDATA', 'MINICS', true
from generate_series(1, 4) n on conflict (code) do nothing;

insert into assets (code, type_code, dept_code, is_enabled) values
  ('LH 4W', 'IDATA', 'OUT4W', true),
  ('LH 6W', 'IDATA', 'OUT6W', true)
on conflict (code) do nothing;

-- เลเซอร์ลบ ── ส่วนกลาง ทุกแผนกทุกกะเห็น
insert into assets (code, type_code, dept_code, is_enabled)
select 'BPL ' || lpad(n::text, 2, '0'), 'LASER', 'ALL', n <> 15
from generate_series(1, 32) n on conflict (code) do nothing;

-- วิทยุสื่อสาร ── ส่วนกลาง
insert into assets (code, type_code, dept_code, is_enabled)
select 'วิทยุสื่อสาร ' || lpad(n::text, 2, '0'), 'RADIO', 'ALL', true
from generate_series(1, 5) n on conflict (code) do nothing;

-- ── อาการชำรุดที่ยังค้าง ──────────────────────────────────────────────
-- ยกมาตรงตามชีต รวมถึงกรณีที่ดูเหมือนแจ้งซ้ำข้ามเครื่อง
-- (OUT 4W 09–12 และ REPACK 01/02/06) — เคลียร์ทิ้งได้ทีเดียวในหน้าทะเบียนเครื่อง
insert into asset_issues (asset_code, phase, symptom, reported_name, reported_at)
select v.code, v.phase::asset_txn_kind, v.symptom, v.who, v.at::timestamptz
from (values
  ('PP-10',         'in',  'ที่ดึงเปิดปิดเสีย',                        'นาย อับดุลลาฟิก อาแว',        '2026-08-23'),
  ('PP-15',         'in',  'จอไม่ติด',                                  'นางสาว สุพัตรา อันทะโย',      '2026-08-20'),
  ('PP-16',         'in',  'ที่เหยียบชำรุด',                            'นางสาว ขวัญสุข แก่นนอก',      '2026-08-15'),
  ('PP-24',         'out', 'จอไม่ติด',                                  'นายณัฐิวุฒิ จั่นมาก',          '2026-09-08'),
  ('PP-25',         'out', 'พักเท้ามีอาการง้างเล็กน้อย',                 'นางสาว ดลฤดี แสงบรรลือฤทธิ์', '2026-08-27'),
  ('PP-28',         'in',  'ยางหลุด ที่ใส่กุญแจหลวม',                    'นางสาว ดลฤดี แสงบรรลือฤทธิ์', '2026-09-04'),
  ('PP-32',         'in',  'ชาร์จแบตไม่เข้า',                           'นาย ธวัชชัย ทองติด',          '2026-09-14'),
  ('IN FD 03',      'in',  'ความจำเต็ม',                                'นาย ธวัชชัย ทองติด',          '2026-09-16'),
  ('IN FD 11',      'out', 'หน้าจอแตก',                                 'นาย ธวัชชัย ทองติด',          '2026-09-01'),
  ('REPACK 01',     'in',  'หน้าจอแตก (แจ้งรวม เบอร์ 1 เบอร์ 2 เบอร์ 5)', 'นาย ชินวัตร แสงเงิน',         '2026-09-18'),
  ('REPACK 02',     'in',  'หน้าจอแตก (แจ้งรวม เบอร์ 1 เบอร์ 2 เบอร์ 5)', 'นาย ชินวัตร แสงเงิน',         '2026-09-18'),
  ('REPACK 06',     'in',  'หน้าจอแตก (แจ้งรวม เบอร์ 1 เบอร์ 2 เบอร์ 5)', 'นาย ชินวัตร แสงเงิน',         '2026-09-18'),
  ('OUT 4W 09',     'in',  'จอแตก ส่งซ่อม',                             'นางสาว พีรยา บุญอยู่',         '2026-09-21'),
  ('OUT 4W 10',     'in',  'แจ้งรวมกับเบอร์ 09 จอแตก ส่งซ่อม',           'นางสาว พีรยา บุญอยู่',         '2026-09-21'),
  ('OUT 4W 11',     'in',  'แจ้งรวมกับเบอร์ 09 จอแตก ส่งซ่อม',           'นางสาว พีรยา บุญอยู่',         '2026-09-21'),
  ('OUT 4W 12',     'in',  'แจ้งรวมกับเบอร์ 09 จอแตก ส่งซ่อม',           'นางสาว พีรยา บุญอยู่',         '2026-09-21'),
  ('OUT 6W 04',     'in',  'อัปเดตเวอร์ชันใหม่',                        'นางสาว เนรัชญา แม้นวิลัย',     '2026-08-21'),
  ('MINI 2',        'in',  'ชาร์จแบตไม่ได้',                            'นางสาว จิตติมา บุญทอง',       '2026-08-17'),
  ('วิทยุสื่อสาร 01', 'in',  'เสียงดับ ๆ ติด ๆ',                          'นาย ชินวัตร แสงเงิน',         '2026-09-02')
) as v(code, phase, symptom, who, at)
join assets a on a.code = v.code
where not exists (
  select 1 from asset_issues x
   where x.asset_code = v.code and x.symptom = v.symptom and x.resolved_at is null
);


-- =====================================================================
-- BPL SUPPLY — รู้ว่าบรรทัดไหนส่งเข้าชีตแล้ว บรรทัดไหนยังไม่ส่ง
-- รันต่อจาก 014 · ปลอดภัยที่จะรันซ้ำ
--
-- ตาราง sheet_exports จำอยู่แล้วว่าบรรทัดไหนไปอยู่แท็บไหนแถวที่เท่าไหร่
-- แต่หน้าเว็บยังไม่เคยเอามาใช้ เลยมองไม่ออกว่าอันไหนส่งไปแล้ว
-- view นี้ต่อให้ครบในที่เดียว กรอง "ยังไม่ส่ง" ได้ที่ฐานข้อมูลเลย
-- ไม่ต้องดึงทั้งเดือนมาแล้วค่อยมานั่งคัดในเบราว์เซอร์
-- =====================================================================

drop view if exists sheet_export_rows;
create view sheet_export_rows
with (security_invoker = true) as
select
  ri.id                                         as line_id,
  r.id                                          as requisition_id,
  r.ref_no,
  r.created_at,
  r.hub_code,
  r.evidence_file_id,
  r.evidence_web_link,
  p.full_name                                   as requester_name,
  p.employee_code                               as requester_code,
  p.dept_code                                   as requester_dept,
  i.sku,
  i.name                                        as item_name,
  i.unit,
  coalesce(ri.qty_approved, ri.qty_requested)   as qty,
  se.tab,
  se.row_no,
  se.exported_at,
  (se.requisition_item_id is not null)          as is_exported
from requisition_items ri
join requisitions r on r.id = ri.requisition_id
join items i        on i.id = ri.item_id
join profiles p     on p.id = r.requester_id
left join sheet_exports se on se.requisition_item_id = ri.id
-- ตรงกับที่ Edge Function ส่งจริง — ข้ามเฉพาะบรรทัดที่ถูกปฏิเสธ
where ri.status <> 'rejected';

grant select on sheet_export_rows to authenticated;

comment on view sheet_export_rows is
  'บรรทัดที่ส่งเข้าชีตได้ พร้อมสถานะว่าส่งไปแล้วหรือยัง อยู่แท็บไหนแถวที่เท่าไหร่';


-- =====================================================================
-- BPL SUPPLY — ลบรายการวัสดุออกจากสต็อกได้
-- รันต่อจาก 015 · ปลอดภัยที่จะรันซ้ำ
--
-- ของที่เคยมีคนเบิกไปแล้ว ลบทิ้งจริงไม่ได้ ไม่งั้นประวัติการเบิกจะพัง
-- จึงแยกเป็นสองทาง: ยังไม่เคยถูกเบิก = ลบทิ้งจริง
--                  เคยถูกเบิกแล้ว   = ปิดการใช้งาน หายจากทุกหน้า ประวัติยังอ่านได้
-- =====================================================================

create or replace function delete_item(p_id bigint)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_used boolean;
  v_name text;
begin
  if my_role() not in ('supervisor', 'admin') then
    raise exception 'ไม่มีสิทธิ์ลบรายการวัสดุ';
  end if;

  select name into v_name from items where id = p_id;
  if v_name is null then
    raise exception 'ไม่พบรายการนี้';
  end if;

  select exists (select 1 from requisition_items where item_id = p_id) into v_used;

  if v_used then
    update items set is_active = false, updated_at = now() where id = p_id;
    return 'archived';
  end if;

  -- ไม่เคยถูกเบิกเลย ลบทิ้งได้สนิท พร้อมประวัติปรับสต็อกที่ผูกอยู่
  delete from stock_movements where item_id = p_id;
  delete from items where id = p_id;
  return 'deleted';
end $$;

grant execute on function delete_item(bigint) to authenticated;

comment on function delete_item(bigint) is
  'ลบวัสดุ — ลบสนิทถ้ายังไม่เคยถูกเบิก ไม่งั้นปิดการใช้งานเพื่อรักษาประวัติ';

-- ── เอาของตัวอย่างสองชิ้นที่ใส่ไว้ตอนตั้งระบบออก ─────────────────────
-- ของจริงย้ายไปอยู่ในทะเบียนเครื่อง (assets) หมดแล้ว
do $$
declare v_id bigint;
begin
  for v_id in select id from items where sku in ('SKU-RT-0401', 'SKU-RT-0402') loop
    if exists (select 1 from requisition_items where item_id = v_id) then
      update items set is_active = false, updated_at = now() where id = v_id;
    else
      delete from stock_movements where item_id = v_id;
      delete from items where id = v_id;
    end if;
  end loop;
end $$;


-- =====================================================================
-- BPL SUPPLY — ใส่กะและแผนกลงในหน้าหลักฐาน
-- รันต่อจาก 016 · ปลอดภัยที่จะรันซ้ำ
--
-- หน้าหลักฐานกรองได้แค่ช่วงวันกับประเภท พอมีพนักงาน 49 คน 5 กะ
-- ต้องเลือกดูเป็นรายกะได้ ไม่งั้นต้องไล่อ่านทีละแถว
-- =====================================================================

-- ── แผนกย่อย ──────────────────────────────────────────────────────────
-- ข้อความเปล่า ๆ ต่อท้ายแผนกไว้ระบุตัวคนให้ละเอียดขึ้น เช่น OUT 4W · DO1
-- ไม่มีผลกับสิทธิ์การมองเห็นใด ๆ ทั้งสิ้น เป็นแค่ป้ายกำกับ
alter table profiles add column if not exists sub_dept text;

comment on column profiles.sub_dept is
  'แผนกย่อย เป็นป้ายกำกับอย่างเดียว ไม่มีผลกับสิทธิ์';

-- คอลัมน์เพิ่มตรงกลาง create or replace view จึงไม่พอ ต้อง drop ก่อน
-- evidence_items สร้างทับ evidence_feed อีกที ต้องรื้อตัวลูกก่อนเสมอ
-- ไม่งั้นรันไฟล์นี้ซ้ำรอบสองจะติด "other objects depend on it"
drop view if exists evidence_items;
drop view if exists evidence_feed;

create view evidence_feed
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
  p.dept_code,
  p.sub_dept,
  p.shift_start,
  p.shift_end,
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
  p.dept_code,
  p.sub_dept,
  p.shift_start,
  p.shift_end,
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

-- ── รายชื่อกะที่มีใช้จริง ──────────────────────────────────────────────
-- ดึงจากพนักงานที่มีอยู่ ไม่ต้องมาตั้งค่ากะซ้ำอีกที่
drop view if exists shifts_in_use;
create view shifts_in_use
with (security_invoker = true) as
select
  shift_start,
  shift_end,
  substring(shift_start::text, 1, 5) || ' – ' || substring(shift_end::text, 1, 5) as label,
  count(*)::int as staff_count
from profiles
where shift_start is not null and shift_end is not null and is_active
group by shift_start, shift_end
order by shift_start;

grant select on shifts_in_use to authenticated;

-- ── แผนกย่อยและกะ ให้โผล่ในหน้าของค้างคืนและหน้าส่งออกด้วย ─────────────
drop view if exists open_borrowings;
create view open_borrowings
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
  p.sub_dept                                    as requester_sub_dept,
  p.shift_start,
  p.shift_end,
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

drop view if exists sheet_export_rows;
create view sheet_export_rows
with (security_invoker = true) as
select
  ri.id                                         as line_id,
  r.id                                          as requisition_id,
  r.ref_no,
  r.created_at,
  r.hub_code,
  r.evidence_file_id,
  r.evidence_web_link,
  p.full_name                                   as requester_name,
  p.employee_code                               as requester_code,
  p.dept_code                                   as requester_dept,
  p.sub_dept                                    as requester_sub_dept,
  p.shift_start,
  p.shift_end,
  i.sku,
  i.name                                        as item_name,
  i.unit,
  coalesce(ri.qty_approved, ri.qty_requested)   as qty,
  se.tab,
  se.row_no,
  se.exported_at,
  (se.requisition_item_id is not null)          as is_exported
from requisition_items ri
join requisitions r on r.id = ri.requisition_id
join items i        on i.id = ri.item_id
join profiles p     on p.id = r.requester_id
left join sheet_exports se on se.requisition_item_id = ri.id
where ri.status <> 'rejected';

grant select on sheet_export_rows to authenticated;


-- =====================================================================
-- BPL SUPPLY — ย้ายเครื่องข้ามแผนก และให้หลายแผนกใช้ร่วมกันได้
-- รันต่อจาก 017 · ปลอดภัยที่จะรันซ้ำ
--
-- โครงเดียวกับที่ใช้กับคน: มีแผนกหลักหนึ่งแผนก บวกแผนกอื่นที่เพิ่มให้ได้
--   dept_code    แผนกเจ้าของเครื่อง — ใช้จัดกลุ่มบนหน้าจอด้วย
--   share_depts  แผนกอื่นที่ใช้เครื่องนี้ได้ ติ๊กกี่แผนกก็ได้
-- =====================================================================

alter table assets add column if not exists share_depts text[] not null default '{}';

comment on column assets.share_depts is
  'แผนกอื่นที่ใช้เครื่องนี้ได้ นอกเหนือจาก dept_code ที่เป็นแผนกเจ้าของ';

create index if not exists assets_share_idx on assets using gin (share_depts);

-- ---------------------------------------------------------------------
-- ใครเห็นเครื่องไหน
--
-- เพิ่มกฎสำคัญหนึ่งข้อ: คนที่ถือเครื่องอยู่ต้องเห็นเครื่องนั้นเสมอ
-- ไม่งั้นย้ายเครื่องข้ามแผนกตอนที่ยังไม่ได้คืน เจ้าตัวจะมองไม่เห็นจนคืนไม่ได้
-- ---------------------------------------------------------------------
drop policy if exists read_assets on assets;
create policy read_assets on assets for select to authenticated using (
  my_role() in ('supervisor', 'admin')
  or dept_code is null
  or dept_code = 'ALL'
  or 'ALL' = any(my_depts())
  or dept_code = any(my_depts())
  or share_depts && my_depts()
  or exists (
    select 1
    from asset_txn_items ai
    join asset_txns t on t.id = ai.txn_id
    where ai.id = assets.held_item_id and t.user_id = auth.uid()
  )
);

-- ---------------------------------------------------------------------
-- RPC: ย้ายเครื่อง / ตั้งแผนกที่ใช้ร่วมได้
-- ---------------------------------------------------------------------
create or replace function set_asset_depts(
  p_code   text,
  p_dept   text,
  p_shares text[] default '{}'
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_bad text;
begin
  -- เฉพาะเจ้าของระบบ · แอดมินย้ายแผนกเครื่องไม่ได้
  if my_role() <> 'admin' then
    raise exception 'เฉพาะเจ้าของระบบเท่านั้นที่ย้ายแผนกของเครื่องได้';
  end if;

  if not exists (select 1 from assets where code = p_code) then
    raise exception 'ไม่พบเครื่อง %', p_code;
  end if;

  if p_dept is not null and not exists (select 1 from departments where code = p_dept) then
    raise exception 'ไม่รู้จักแผนก %', p_dept;
  end if;

  select s into v_bad
    from unnest(coalesce(p_shares, '{}')) s
   where not exists (select 1 from departments d where d.code = s)
   limit 1;
  if v_bad is not null then
    raise exception 'ไม่รู้จักแผนก %', v_bad;
  end if;

  update assets
     set dept_code   = p_dept,
         -- แผนกเจ้าของไม่ต้องมาซ้ำในรายการใช้ร่วม
         share_depts = coalesce(
           (select array_agg(distinct s)
              from unnest(coalesce(p_shares, '{}')) s
             where s is distinct from p_dept),
           '{}'
         )
   where code = p_code;
end $$;

grant execute on function set_asset_depts(text, text, text[]) to authenticated;

-- ---------------------------------------------------------------------
-- view ของค้างคืนฝั่ง Asset ต้องพ่วงแผนกย่อยของคนถือมาด้วย
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
  a.share_depts        as asset_share_depts,
  t.id                 as txn_id,
  t.ref_no,
  t.user_id,
  p.full_name          as holder_name,
  p.employee_code      as holder_code,
  t.dept_code          as holder_dept,
  p.sub_dept           as holder_sub_dept,
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


-- =====================================================================
-- BPL SUPPLY — จัดการแผนกได้เฉพาะเจ้าของระบบ
-- รันต่อจาก 018 · ปลอดภัยที่จะรันซ้ำ
--
-- แผนกเป็นตัวกำหนดว่าใครเห็นของอะไร ลบแผนกทิ้งกระทบทั้งคนและเครื่องพร้อมกัน
-- จึงยกขึ้นมาให้เป็นของเจ้าของระบบคนเดียว เท่ากับการย้ายแผนกของเครื่องใน 018
-- แอดมินยังอ่านรายชื่อแผนกได้ตามปกติ แค่แก้ไม่ได้
-- =====================================================================

drop policy if exists write_departments on departments;
create policy write_departments on departments for all to authenticated
  using (my_role() = 'admin')
  with check (my_role() = 'admin');

create or replace function create_department(p_name text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if my_role() <> 'admin' then
    raise exception 'เฉพาะเจ้าของระบบเท่านั้นที่เพิ่มแผนกได้';
  end if;
  if v_name = '' then
    raise exception 'ต้องใส่ชื่อแผนก';
  end if;
  if exists (select 1 from departments where lower(name) = lower(v_name)) then
    raise exception 'มีแผนกชื่อ % อยู่แล้ว', v_name;
  end if;

  -- รหัสสุ่มไม่ผูกกับชื่อ เปลี่ยนชื่อทีหลังได้โดยไม่ต้องแก้ข้อมูลที่อ้างถึง
  -- รูปแบบเดียวกับที่ใช้มาตั้งแต่ 011 เพื่อไม่ให้รหัสสองแบบปนกัน
  loop
    v_code := 'D' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from departments where code = v_code);
  end loop;

  insert into departments (code, name, sort_no)
  values (v_code, v_name, coalesce((select max(sort_no) + 1 from departments), 1));

  return v_code;
end $$;

grant execute on function create_department(text) to authenticated;

create or replace function delete_department(p_code text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_people int;
  v_items  int;
  v_assets int;
begin
  if my_role() <> 'admin' then
    raise exception 'เฉพาะเจ้าของระบบเท่านั้นที่ลบแผนกได้';
  end if;
  if p_code = 'ALL' then
    raise exception 'ลบแผนก "ทุกแผนก" ไม่ได้ ระบบใช้เป็นค่ากลาง';
  end if;

  select count(*) into v_people from profiles
   where dept_code = p_code or p_code = any(extra_depts);
  select count(*) into v_items  from items  where dept_code = p_code;
  select count(*) into v_assets from assets
   where dept_code = p_code or p_code = any(share_depts);

  if v_people + v_items + v_assets > 0 then
    raise exception 'ลบไม่ได้ ยังมีพนักงาน % คน วัสดุ % รายการ เครื่อง % ตัว ผูกอยู่กับแผนกนี้',
      v_people, v_items, v_assets;
  end if;

  delete from departments where code = p_code;
end $$;

grant execute on function delete_department(text) to authenticated;


-- =====================================================================
-- BPL SUPPLY — เลือกดูหลักฐานเฉพาะวัสดุที่ต้องการ
-- รันต่อจาก 019 · ปลอดภัยที่จะรันซ้ำ
--
-- พอของเบิกเยอะขึ้น หน้าหลักฐานจะปนกันจนหาไม่เจอว่ารายการไหนคือของอะไร
-- เดิมชื่อของอยู่ในข้อความสรุปก้อนเดียว กรองด้วยไม่ได้
-- จึงแนบรหัสวัสดุมาเป็นชุด ให้กรองที่ฐานข้อมูลได้ตรง ๆ
-- =====================================================================

-- evidence_items สร้างทับ evidence_feed อีกที ต้องรื้อตัวลูกก่อนเสมอ
-- ไม่งั้นรันไฟล์นี้ซ้ำรอบสองจะติด "other objects depend on it"
drop view if exists evidence_items;
drop view if exists evidence_feed;

create view evidence_feed
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
  p.dept_code,
  p.sub_dept,
  p.shift_start,
  p.shift_end,
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
    select array_agg(distinct ri.item_id)
    from requisition_items ri where ri.requisition_id = r.id
  ), '{}')                                  as item_ids,
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
  p.dept_code,
  p.sub_dept,
  p.shift_start,
  p.shift_end,
  true,
  i.name || ' คืน ' || rt.qty || ' (' ||
    case rt.condition when 'ok' then 'ใช้ได้' when 'damaged' then 'ชำรุด' else 'สูญหาย' end || ')',
  array[i.id],
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

-- ── รายชื่อวัสดุที่เคยมีหลักฐานจริง ─────────────────────────────────────
-- ดรอปดาวน์ควรมีเฉพาะของที่มีรูปให้ดู ไม่ใช่ทั้งคลัง
drop view if exists evidence_items;
create view evidence_items
with (security_invoker = true) as
select i.id as item_id, i.sku, i.name, count(*)::int as photo_rows
from evidence_feed e
join items i on i.id = any(e.item_ids)
group by i.id, i.sku, i.name
order by i.name;

grant select on evidence_items to authenticated;


-- =====================================================================
-- BPL SUPPLY — เปิด/ปิดสิทธิ์เห็นเครื่อง Asset เป็นรายคน
-- รันต่อจาก 020 · ปลอดภัยที่จะรันซ้ำ
--
-- บางคนมีรหัสไว้เบิกของสิ้นเปลืองอย่างเดียว ไม่ควรเห็นเครื่องเลย
-- แยกเป็นสวิตช์ของตัวเอง ไม่ปนกับเรื่องแผนก เพราะเป็นคนละคำถามกัน
--   แผนก     = เห็นเครื่อง "ของแผนกไหน"
--   can_assets = เห็นเครื่อง "ไหม" ตั้งแต่แรก
--
-- ค่าเริ่มต้นเป็นเปิด ของเดิมทุกคนจึงไม่เปลี่ยนพฤติกรรม
-- =====================================================================

alter table profiles add column if not exists can_assets boolean not null default true;

comment on column profiles.can_assets is
  'เห็นและเบิกเครื่อง Asset ได้ไหม · ปิดไว้สำหรับคนที่เบิกได้แต่ของสิ้นเปลือง';

create or replace function my_can_assets() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select can_assets from profiles where id = auth.uid()), false);
$$;

grant execute on function my_can_assets() to authenticated;

-- ---------------------------------------------------------------------
-- ใครเห็นเครื่องไหน — เพิ่มด่านแรกว่าคนนี้ดูเครื่องได้ไหม
--
-- ยกเว้นเครื่องที่ตัวเองถืออยู่ ต้องเห็นเสมอเพื่อให้คืนได้
-- เผื่อกรณีปิดสิทธิ์ทีหลังตอนที่ของยังไม่ได้คืน
-- ---------------------------------------------------------------------
drop policy if exists read_assets on assets;
create policy read_assets on assets for select to authenticated using (
  my_role() in ('supervisor', 'admin')
  or exists (
    select 1
    from asset_txn_items ai
    join asset_txns t on t.id = ai.txn_id
    where ai.id = assets.held_item_id and t.user_id = auth.uid()
  )
  or (
    my_can_assets()
    and (
      dept_code is null
      or dept_code = 'ALL'
      or 'ALL' = any(my_depts())
      or dept_code = any(my_depts())
      or share_depts && my_depts()
    )
  )
);

-- กันไว้อีกชั้นที่ตัวคำสั่งเบิก ไม่ใช่แค่ซ่อนจากหน้าจอ
create or replace function assert_can_assets() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if my_role() not in ('supervisor', 'admin') and not my_can_assets() then
    raise exception 'บัญชีนี้ไม่มีสิทธิ์เบิกอุปกรณ์ Asset';
  end if;
end $$;

grant execute on function assert_can_assets() to authenticated;

-- เรียกด่านนี้ตอนเบิกจริง (asset_checkout ถูกสร้างไว้ใน 013)
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
  if v_me.role = 'staff' and not v_me.can_assets then
    raise exception 'บัญชีนี้ไม่มีสิทธิ์เบิกอุปกรณ์ Asset';
  end if;

  if p_codes is null or array_length(p_codes, 1) is null then
    raise exception 'ยังไม่ได้เลือกเครื่อง';
  end if;

  if not exists (select 1 from asset_types where code = p_type and is_active) then
    raise exception 'ไม่พบประเภท %', p_type;
  end if;

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
    values (v_txn, coalesce((r->>'seq')::int, 1), r->>'label',
            r->>'file_id', r->>'web_link', (r->>'bytes')::int);
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


-- =====================================================================
-- BPL SUPPLY — ส่งออก Asset และใบแจ้งชำรุดเข้า Google Sheet
-- รันต่อจาก 021 · ปลอดภัยที่จะรันซ้ำ
--
-- ใช้วิธีเดียวกับของสิ้นเปลือง: จำไว้ว่าแถวไหนไปอยู่แท็บไหนแถวที่เท่าไหร่
-- ส่งซ้ำจึงเขียนทับแถวเดิม ไม่เกิดแถวซ้ำ และไม่ต้องอ่านทั้งชีตมาเทียบ
-- =====================================================================

create table if not exists asset_sheet_exports (
  asset_txn_item_id bigint primary key references asset_txn_items(id) on delete cascade,
  tab               text not null,
  row_no            integer not null,
  exported_at       timestamptz not null default now()
);

create index if not exists asset_sheet_exports_tab_idx on asset_sheet_exports (tab, row_no);

create table if not exists asset_issue_exports (
  issue_id    bigint primary key references asset_issues(id) on delete cascade,
  tab         text not null,
  row_no      integer not null,
  exported_at timestamptz not null default now()
);

create index if not exists asset_issue_exports_tab_idx on asset_issue_exports (tab, row_no);

alter table asset_sheet_exports enable row level security;
alter table asset_issue_exports enable row level security;

-- อ่านได้เฉพาะแอดมินขึ้นไป · เขียนผ่าน Edge Function (service role) เท่านั้น
drop policy if exists read_asset_sheet_exports on asset_sheet_exports;
create policy read_asset_sheet_exports on asset_sheet_exports for select to authenticated
  using (my_role() in ('supervisor', 'admin'));

drop policy if exists read_asset_issue_exports on asset_issue_exports;
create policy read_asset_issue_exports on asset_issue_exports for select to authenticated
  using (my_role() in ('supervisor', 'admin'));

-- ── สถานะการส่งออกฝั่ง Asset ให้หน้าเว็บนับได้ ─────────────────────────
drop view if exists asset_export_rows;
create view asset_export_rows
with (security_invoker = true) as
select
  ai.id                                   as line_id,
  t.ref_no,
  t.kind,
  t.created_at,
  ty.name                                 as type_name,
  ai.asset_code,
  p.full_name                             as who,
  p.employee_code,
  t.dept_code,
  se.tab,
  se.row_no,
  (se.asset_txn_item_id is not null)      as is_exported
from asset_txn_items ai
join asset_txns t   on t.id = ai.txn_id
join assets a       on a.code = ai.asset_code
join asset_types ty on ty.code = a.type_code
join profiles p     on p.id = t.user_id
left join asset_sheet_exports se on se.asset_txn_item_id = ai.id;

grant select on asset_export_rows to authenticated;


-- =====================================================================
-- BPL SUPPLY — เลเซอร์ลบเป็นของพ่วงไอดาต้า ไม่ใช่ประเภทแยก
-- รันต่อจาก 022 · ปลอดภัยที่จะรันซ้ำ
--
-- ของเดิมแยกเลเซอร์ลบเป็นเมนูของตัวเอง ซึ่งผิดจากการใช้งานจริง
-- หน้างานเบิกไอดาต้าแล้วบางครั้งหยิบเลเซอร์ลบไปด้วย ไม่ได้เบิกแยกรอบ
--
-- จึงให้ประเภทมี "ประเภทแม่" ได้ ประเภทที่มีแม่จะไม่โผล่เป็นเมนูเอง
-- แต่ไปโผล่เป็นตัวเลือกเสริมในหน้าเบิกของแม่ ข้ามได้ถ้าไม่เอา
-- =====================================================================

alter table asset_types add column if not exists parent_code text references asset_types(code);

comment on column asset_types.parent_code is
  'ถ้ามีค่า = เป็นของพ่วงประเภทนี้ ไม่ขึ้นเป็นเมนูแยก เบิกไปพร้อมกันได้';

update asset_types set parent_code = 'IDATA' where code = 'LASER' and parent_code is null;

-- เลเซอร์ลบไม่มีรูปบังคับของตัวเอง ใช้รูปชุดเดียวกับไอดาต้าที่เบิกพร้อมกัน
update asset_types set photo_min = 0 where code = 'LASER';

-- ประเภทหลักของเครื่องนี้ — ของพ่วงจะคืนค่าเป็นประเภทแม่
create or replace function asset_root_type(p_code text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(ty.parent_code, ty.code)
    from assets a join asset_types ty on ty.code = a.type_code
   where a.code = p_code;
$$;

grant execute on function asset_root_type(text) to authenticated;

-- ---------------------------------------------------------------------
-- เบิก — รับได้ทั้งประเภทหลักและของพ่วงในครั้งเดียว
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
  if v_me.role = 'staff' and not v_me.can_assets then
    raise exception 'บัญชีนี้ไม่มีสิทธิ์เบิกอุปกรณ์ Asset';
  end if;

  if p_codes is null or array_length(p_codes, 1) is null then
    raise exception 'ยังไม่ได้เลือกเครื่อง';
  end if;

  if not exists (
    select 1 from asset_types where code = p_type and is_active and parent_code is null
  ) then
    raise exception 'ไม่พบประเภท %', p_type;
  end if;

  -- จำนวนรูปคิดจากประเภทหลักเสมอ ของพ่วงไม่เพิ่มจำนวนรูป
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
    perform 1 from assets where code = v_code for update;
    if not found then
      raise exception 'ไม่พบเครื่อง %', v_code;
    end if;
    if not exists (select 1 from assets where code = v_code and is_enabled) then
      raise exception 'เครื่อง % ถูกปิดไม่ให้เบิก', v_code;
    end if;
    if asset_root_type(v_code) is distinct from p_type then
      raise exception 'เครื่อง % ไม่ได้อยู่ในกลุ่มที่เลือก', v_code;
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
    values (v_txn, coalesce((r->>'seq')::int, 1), r->>'label',
            r->>'file_id', r->>'web_link', (r->>'bytes')::int);
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
-- คืน — คืนของพ่วงพร้อมประเภทหลักได้ในครั้งเดียว
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
  v_root   text;
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

  v_root := asset_root_type(p_codes[1]);
  if v_root is null then
    raise exception 'ไม่พบเครื่อง %', p_codes[1];
  end if;

  select count(*) into v_steps from asset_photo_steps where type_code = v_root;
  select photo_min into v_min from asset_types where code = v_root;
  if v_steps > 0 then v_min := v_steps; end if;
  if v_photos < coalesce(v_min, 1) then
    raise exception 'ต้องถ่ายรูปสภาพตอนคืนให้ครบ % ใบก่อน (ถ่ายมาแล้ว % ใบ)',
      coalesce(v_min, 1), v_photos;
  end if;

  v_ref := next_asset_ref('in');
  insert into asset_txns (ref_no, kind, type_code, user_id, dept_code,
                          shift_start, shift_end, note)
  values (v_ref, 'in', v_root, v_me.id, v_me.dept_code,
          v_me.shift_start, v_me.shift_end, p_note)
  returning id into v_txn;

  foreach v_code in array p_codes loop
    perform 1 from assets where code = v_code for update;

    if asset_root_type(v_code) is distinct from v_root then
      raise exception 'เครื่อง % คนละกลุ่มกับที่เลือกไว้ ต้องคืนแยกรอบ', v_code;
    end if;

    select a.held_item_id, t.user_id into v_out, v_owner
      from assets a
      join asset_txn_items ai on ai.id = a.held_item_id
      join asset_txns t on t.id = ai.txn_id
     where a.code = v_code;

    if v_out is null then
      raise exception 'เครื่อง % ไม่ได้อยู่ในรายการค้างคืน', v_code;
    end if;
    if v_owner <> v_me.id and my_role() not in ('supervisor', 'admin') then
      raise exception 'เครื่อง % ไม่ได้เบิกโดยคุณ', v_code;
    end if;

    insert into asset_txn_items (txn_id, asset_code, out_item_id)
    values (v_txn, v_code, v_out);

    update assets set held_item_id = null where code = v_code;
  end loop;

  for r in select * from jsonb_array_elements(p_photos) loop
    insert into asset_txn_photos (txn_id, seq, label, file_id, web_link, bytes)
    values (v_txn, coalesce((r->>'seq')::int, 1), r->>'label',
            r->>'file_id', r->>'web_link', (r->>'bytes')::int);
  end loop;

  for r in select * from jsonb_array_elements(p_issues) loop
    insert into asset_issues (asset_code, txn_id, phase, symptom, reported_by, file_id, web_link)
    values (r->>'asset_code', v_txn, 'in', r->>'symptom', v_me.id, r->>'file_id', r->>'web_link');
  end loop;

  return jsonb_build_object('id', v_txn, 'ref_no', v_ref, 'count', array_length(p_codes, 1));
end $$;

grant execute on function asset_return(text[], jsonb, jsonb, text) to authenticated;


-- =====================================================================
-- BPL SUPPLY — แจ้งเตือนเข้ามือถือ
-- รันต่อจาก 023 · ปลอดภัยที่จะรันซ้ำ
--
-- เก็บว่ามือถือเครื่องไหนอนุญาตแจ้งเตือนไว้แล้วบ้าง แล้วมีนาฬิกาฝั่ง
-- เซิร์ฟเวอร์เดินทุก 5 นาที คอยดูว่าใครใกล้เลิกกะ หรือเลยเวลาคืนแล้ว
--
-- เตือนเฉพาะ Asset ตามที่ตกลง ของสิ้นเปลืองไม่เตือน
--   ก่อนเลิกกะ 10 นาที  → คนที่ถือเครื่องอยู่
--   เลยเลิกกะ 10 นาที   → คนนั้น + แอดมิน + เจ้าของระบบ
--   แจ้งชำรุดใหม่        → แอดมิน + เจ้าของระบบ
-- =====================================================================

-- ── เครื่องที่รับแจ้งเตือนได้ ──────────────────────────────────────────
-- 1 คนมีได้หลายเครื่อง (มือถือ + คอม) จึงเก็บเป็นรายอุปกรณ์
create table if not exists push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references profiles(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  -- นับครั้งที่ส่งไม่ผ่าน ถ้าเบราว์เซอร์ตอบว่าเลิกใช้แล้วจะลบทิ้งเอง
  fail_count integer not null default 0
);

create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;

-- เจ้าตัวจัดการของตัวเองได้ เจ้าของระบบดูได้หมดเพื่อไล่ปัญหา
drop policy if exists own_push on push_subscriptions;
create policy own_push on push_subscriptions for all to authenticated
  using (user_id = auth.uid() or my_role() = 'admin')
  with check (user_id = auth.uid());

-- ── กันเตือนซ้ำ ───────────────────────────────────────────────────────
-- 1 แถวต่อ 1 เรื่องต่อ 1 คน นาฬิกาเดินทุก 5 นาที จึงต้องจำว่าเตือนไปแล้ว
create table if not exists notification_log (
  id        bigserial primary key,
  kind      text not null,
  subject   text not null,
  user_id   uuid references profiles(id) on delete cascade,
  sent_at   timestamptz not null default now()
);

create unique index if not exists notification_log_uniq
  on notification_log (kind, subject, user_id);

alter table notification_log enable row level security;
drop policy if exists read_notification_log on notification_log;
create policy read_notification_log on notification_log for select to authenticated
  using (my_role() = 'admin');

-- ---------------------------------------------------------------------
-- งานที่ต้องเตือนตอนนี้
--
-- คืนค่าเป็น jsonb ก้อนเดียวให้ Edge Function เอาไปยิงต่อ
-- ตัดสินใจทั้งหมดในฐานข้อมูล ฝั่ง Edge Function แค่ส่ง
-- ---------------------------------------------------------------------
create or replace function push_due_jobs()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_jobs jsonb := '[]'::jsonb;
  v_now  timestamptz := now();
begin
  -- ① ใกล้เลิกกะ 10 นาที · เตือนคนที่ถือเครื่อง
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(j) from (
      select jsonb_build_object(
        'kind',    'due_soon',
        'subject', h.txn_id::text,
        'user_id', h.user_id,
        'title',   'ใกล้เลิกกะแล้ว',
        'body',    'คุณยังถือ ' || count(*) || ' เครื่อง — ' ||
                   string_agg(h.asset_code, ', ' order by h.asset_code),
        'url',     '/returns'
      ) as j
      from asset_holdings h
      where h.due_at is not null
        and h.due_at between v_now and v_now + interval '10 minutes'
        and not exists (
          select 1 from notification_log n
          where n.kind = 'due_soon' and n.subject = h.txn_id::text and n.user_id = h.user_id
        )
      group by h.txn_id, h.user_id
    ) g
  ), '[]'::jsonb);

  -- ② เลยเวลาคืนมาแล้ว 10 นาที · เตือนเจ้าตัว
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(j) from (
      select jsonb_build_object(
        'kind',    'overdue',
        'subject', h.txn_id::text,
        'user_id', h.user_id,
        'title',   'เลยเวลาคืนแล้ว',
        'body',    'ยังไม่ได้คืน ' || count(*) || ' เครื่อง — ' ||
                   string_agg(h.asset_code, ', ' order by h.asset_code),
        'url',     '/returns'
      ) as j
      from asset_holdings h
      where h.due_at is not null
        and v_now >= h.due_at + interval '10 minutes'
        and not exists (
          select 1 from notification_log n
          where n.kind = 'overdue' and n.subject = h.txn_id::text and n.user_id = h.user_id
        )
      group by h.txn_id, h.user_id
    ) g
  ), '[]'::jsonb);

  -- ③ สรุปของค้างให้แอดมินและเจ้าของระบบ · 1 ครั้งต่อ 1 รายการที่ค้าง
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'overdue_admin',
      'subject', x.txn_id::text,
      'user_id', m.id,
      'title',   'มีเครื่องค้างเกินกะ',
      'body',    x.holder || ' ยังไม่คืน ' || x.n || ' เครื่อง — ' || x.codes,
      'url',     '/admin/assets-out'
    ))
    from (
      select h.txn_id,
             max(h.holder_name) as holder,
             count(*)           as n,
             string_agg(h.asset_code, ', ' order by h.asset_code) as codes
      from asset_holdings h
      where h.due_at is not null and v_now >= h.due_at + interval '10 minutes'
      group by h.txn_id
    ) x
    cross join (select id from profiles where role in ('supervisor', 'admin') and is_active) m
    where not exists (
      select 1 from notification_log n
      where n.kind = 'overdue_admin' and n.subject = x.txn_id::text and n.user_id = m.id
    )
  ), '[]'::jsonb);

  -- ④ แจ้งชำรุดใหม่ · เตือนแอดมินและเจ้าของระบบทันที
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'issue',
      'subject', i.id::text,
      'user_id', m.id,
      'title',   'แจ้งชำรุด ' || i.asset_code,
      'body',    i.symptom || ' · แจ้งโดย ' || coalesce(p.full_name, i.reported_name, 'ไม่ทราบชื่อ'),
      'url',     '/admin/assets'
    ))
    from asset_issues i
    left join profiles p on p.id = i.reported_by
    cross join (select id from profiles where role in ('supervisor', 'admin') and is_active) m
    where i.resolved_at is null
      and i.reported_at > v_now - interval '1 day'
      and not exists (
        select 1 from notification_log n
        where n.kind = 'issue' and n.subject = i.id::text and n.user_id = m.id
      )
  ), '[]'::jsonb);

  return v_jobs;
end $$;

grant execute on function push_due_jobs() to authenticated, service_role;

/** จดว่าเตือนเรื่องนี้กับคนนี้ไปแล้ว จะได้ไม่เตือนซ้ำทุก 5 นาที */
create or replace function push_mark_sent(p_kind text, p_subject text, p_user uuid)
returns void
language sql security definer set search_path = public as $$
  insert into notification_log (kind, subject, user_id)
  values (p_kind, p_subject, p_user)
  on conflict (kind, subject, user_id) do nothing;
$$;

grant execute on function push_mark_sent(text, text, uuid) to authenticated, service_role;

-- เก็บกวาดบันทึกเก่า ไม่ให้ตารางโตไปเรื่อย ๆ
create or replace function push_prune_log()
returns void
language sql security definer set search_path = public as $$
  delete from notification_log where sent_at < now() - interval '30 days';
$$;

grant execute on function push_prune_log() to service_role;


-- =====================================================================
-- BPL SUPPLY — นาฬิกาเดินทุก 5 นาที คอยดูว่าใครต้องเตือนแล้ว
-- รันต่อจาก 024 · ปลอดภัยที่จะรันซ้ำ
--
-- ใช้ pg_cron เดินเวลา + pg_net ยิงไปที่ Edge Function push-sent
-- ทั้งสองตัวมีอยู่แล้วใน Supabase ไม่มีค่าใช้จ่ายเพิ่ม
--
-- ถ้าส่วนขยายยังไม่ได้เปิด ไฟล์นี้จะไม่ล้ม แต่จะขึ้น NOTICE บอกให้ไปเปิด
-- ที่ Dashboard -> Database -> Extensions แล้วรันไฟล์นี้ซ้ำอีกรอบ
-- ส่วนที่เหลือของระบบทำงานได้ตามปกติ แค่ยังไม่มีนาฬิกาเดินให้
-- =====================================================================

do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'เปิด pg_cron อัตโนมัติไม่ได้ (%) — ไปเปิดที่ Dashboard > Database > Extensions แล้วรันไฟล์นี้ซ้ำ', sqlerrm;
end $$;

do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'เปิด pg_net อัตโนมัติไม่ได้ (%) — ไปเปิดที่ Dashboard > Database > Extensions แล้วรันไฟล์นี้ซ้ำ', sqlerrm;
end $$;

-- ── ค่าลับฝั่งเซิร์ฟเวอร์ ──────────────────────────────────────────────
-- app_settings ใช้ไม่ได้ เพราะพนักงานทุกคนอ่านตารางนั้นได้
create table if not exists private_settings (
  key   text primary key,
  value text not null
);

alter table private_settings enable row level security;
-- ตั้งใจไม่ใส่ policy ใด ๆ · ไม่มีใครอ่านผ่านหน้าเว็บได้เลย
-- อ่านได้เฉพาะฟังก์ชัน security definer ข้างล่างนี้
revoke all on private_settings from anon, authenticated;

-- ---------------------------------------------------------------------
-- งานที่นาฬิกาเรียก
-- ถ้ายังไม่ได้ใส่ url หรือ key จะเงียบ ๆ ไม่ทำอะไร ไม่ error รัว ๆ
-- ---------------------------------------------------------------------
create or replace function push_tick()
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text;
  v_key text;
begin
  select value into v_url from private_settings where key = 'push_url';
  select value into v_key from private_settings where key = 'push_cron_secret';
  if v_url is null or v_key is null then
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', v_key),
    body    := jsonb_build_object('action', 'run'),
    timeout_milliseconds := 20000
  );
end $$;

-- ---------------------------------------------------------------------
-- ตั้งนาฬิกา · ทุก 5 นาที
-- ---------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('bpl-push-tick');
exception when others then
  null; -- ยังไม่เคยตั้ง หรือ pg_cron ยังไม่พร้อม
end $$;

do $$
begin
  perform cron.schedule('bpl-push-tick', '*/5 * * * *', 'select push_tick()');
  raise notice 'ตั้งนาฬิกาแจ้งเตือนเรียบร้อย เดินทุก 5 นาที';
exception when others then
  raise notice 'ตั้งนาฬิกาไม่สำเร็จ (%) — เปิด pg_cron ที่ Dashboard แล้วรันไฟล์นี้ซ้ำ', sqlerrm;
end $$;

-- =====================================================================
-- เหลืออีกขั้นเดียว — ใส่ค่าสองตัวนี้ แล้วแจ้งเตือนจะเริ่มทำงานทันที
-- ค่าที่ต้องใส่อยู่ในไฟล์ "แจ้งเตือน-ตั้งค่า.txt" หัวข้อ ②
--
--   insert into private_settings (key, value) values
--     ('push_url',         'https://<project>.supabase.co/functions/v1/push-sent'),
--     ('push_cron_secret', '<CRON_SECRET ตัวเดียวกับที่ใส่ใน Edge Function>')
--   on conflict (key) do update set value = excluded.value;
-- =====================================================================


-- =====================================================================
-- BPL SUPPLY — ส่งบาร์โค้ดจาก BY
-- รันต่อจาก 025 · ปลอดภัยที่จะรันซ้ำ
--
-- ของบางอย่างหน้างานไม่ได้กดเบิกในระบบนี้ แต่ส่งบาร์โค้ดมาให้แอดมินสแกน
-- แล้วแอดมินไปตัดสต็อกในระบบ BY เอง ที่นี่ทำหน้าที่เป็นกล่องรับเรื่อง
-- กับเป็นหลักฐานว่าใครขออะไรไปเมื่อไหร่
--
-- แยกตารางออกจากการเบิกปกติทั้งหมด เพราะเป็นคนละเรื่องกัน
-- ตัดสต็อกในระบบนี้ไม่ได้ ไม่มีรายการวัสดุ ไม่มีการอนุมัติ
-- =====================================================================

do $$ begin
  create type by_status as enum ('pending', 'done', 'rejected');
exception when duplicate_object then null; end $$;

create table if not exists by_barcodes (
  id          uuid primary key default gen_random_uuid(),
  ref_no      text unique not null,
  user_id     uuid not null references profiles(id),
  -- คัดลอกไว้ตอนส่ง เผื่อคนย้ายแผนกหรือเปลี่ยนกะทีหลัง ประวัติจะได้ไม่เพี้ยน
  dept_code   text,
  sub_dept    text,
  shift_start time,
  shift_end   time,
  reason      text not null,
  note        text,
  status      by_status not null default 'pending',
  handled_by  uuid references profiles(id),
  handled_at  timestamptz,
  handled_note text,
  created_at  timestamptz not null default now()
);

create index if not exists by_barcodes_open_idx on by_barcodes (created_at desc) where status = 'pending';
create index if not exists by_barcodes_user_idx on by_barcodes (user_id, created_at desc);

create table if not exists by_barcode_photos (
  id       bigserial primary key,
  by_id    uuid not null references by_barcodes(id) on delete cascade,
  file_id  text not null,
  web_link text,
  bytes    integer,
  sort_no  integer not null default 0
);

create index if not exists by_barcode_photos_idx on by_barcode_photos (by_id, sort_no);

-- ── เลขที่รายการ: BY-690923-0001 ──────────────────────────────────────
create sequence if not exists by_ref_seq;

create or replace function next_by_ref()
returns text language sql volatile as $$
  select 'BY-' || to_char((now() at time zone 'Asia/Bangkok'), 'YYMMDD')
      || '-' || lpad(nextval('by_ref_seq')::text, 4, '0');
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table by_barcodes       enable row level security;
alter table by_barcode_photos enable row level security;

-- หน้างานเห็นของตัวเอง แอดมินเห็นหมด
drop policy if exists read_by on by_barcodes;
create policy read_by on by_barcodes for select to authenticated
  using (user_id = auth.uid() or my_role() in ('supervisor', 'admin'));

drop policy if exists write_by on by_barcodes;
create policy write_by on by_barcodes for update to authenticated
  using (my_role() in ('supervisor', 'admin'))
  with check (my_role() in ('supervisor', 'admin'));

-- รูปบาร์โค้ดเปิดดูได้เฉพาะแอดมิน ตรงกับกติกาเดิมของรูปหลักฐาน
drop policy if exists read_by_photos on by_barcode_photos;
create policy read_by_photos on by_barcode_photos for select to authenticated
  using (my_role() in ('supervisor', 'admin'));

-- ---------------------------------------------------------------------
-- View: กล่องรับเรื่อง พร้อมรูปและคนส่ง
-- ---------------------------------------------------------------------
drop view if exists by_feed;
create view by_feed
with (security_invoker = true) as
select
  b.id,
  b.ref_no,
  b.created_at,
  b.reason,
  b.note,
  b.status,
  b.handled_at,
  b.handled_note,
  b.user_id,
  p.full_name                            as who,
  p.employee_code,
  b.dept_code,
  b.sub_dept,
  b.shift_start,
  b.shift_end,
  h.full_name                            as handled_by_name,
  coalesce((
    select count(*) from by_barcode_photos ph where ph.by_id = b.id
  ), 0)::int                             as photo_count,
  coalesce((
    select array_agg(ph.file_id order by ph.sort_no)
    from by_barcode_photos ph where ph.by_id = b.id
  ), '{}')                               as file_ids
from by_barcodes b
join profiles p on p.id = b.user_id
left join profiles h on h.id = b.handled_by;

grant select on by_feed to authenticated;

-- ---------------------------------------------------------------------
-- RPC: หน้างานส่งบาร์โค้ด
--   p_photos = [{file_id, web_link, bytes}] · ส่งได้ไม่จำกัดจำนวน
-- ---------------------------------------------------------------------
create or replace function create_by_barcode(
  p_reason text,
  p_note   text default null,
  p_photos jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me  profiles%rowtype;
  v_id  uuid;
  v_ref text;
  r     jsonb;
  i     int := 0;
begin
  select * into v_me from profiles where id = auth.uid();
  if v_me.id is null or not v_me.is_active then
    raise exception 'บัญชีนี้ใช้งานไม่ได้';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'ต้องใส่เหตุผลก่อน';
  end if;
  if coalesce(jsonb_array_length(p_photos), 0) = 0 then
    raise exception 'ต้องแนบรูปบาร์โค้ดอย่างน้อย 1 ใบ';
  end if;

  v_ref := next_by_ref();
  insert into by_barcodes (ref_no, user_id, dept_code, sub_dept,
                           shift_start, shift_end, reason, note)
  values (v_ref, v_me.id, v_me.dept_code, v_me.sub_dept,
          v_me.shift_start, v_me.shift_end, btrim(p_reason), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;

  for r in select * from jsonb_array_elements(p_photos) loop
    insert into by_barcode_photos (by_id, file_id, web_link, bytes, sort_no)
    values (v_id, r->>'file_id', r->>'web_link', (r->>'bytes')::int, i);
    i := i + 1;
  end loop;

  return jsonb_build_object('id', v_id, 'ref_no', v_ref, 'photos', i);
end $$;

grant execute on function create_by_barcode(text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- RPC: แอดมินกดว่าตัดสต็อกแล้ว หรือปัดตก
-- กดแล้วหายจากกล่องรับเรื่องทันที แต่ประวัติกับรูปยังอยู่ครบ
-- ---------------------------------------------------------------------
create or replace function set_by_status(p_id uuid, p_status by_status, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if my_role() not in ('supervisor', 'admin') then
    raise exception 'ไม่มีสิทธิ์จัดการรายการบาร์โค้ด BY';
  end if;

  update by_barcodes
     set status       = p_status,
         handled_by   = case when p_status = 'pending' then null else auth.uid() end,
         handled_at   = case when p_status = 'pending' then null else now() end,
         handled_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id;
end $$;

grant execute on function set_by_status(uuid, by_status, text) to authenticated;

-- ---------------------------------------------------------------------
-- สถิติรายเดือน ไว้ให้หน้าเว็บสรุป
-- ---------------------------------------------------------------------
drop view if exists by_stats_monthly;
create view by_stats_monthly
with (security_invoker = true) as
select
  to_char((b.created_at at time zone 'Asia/Bangkok'), 'YYYY-MM') as ym,
  b.dept_code,
  b.reason,
  count(*)::int                                                   as total,
  count(*) filter (where b.status = 'pending')::int               as pending,
  count(*) filter (where b.status = 'done')::int                  as done,
  count(*) filter (where b.status = 'rejected')::int              as rejected
from by_barcodes b
group by 1, 2, 3;

grant select on by_stats_monthly to authenticated;

-- ── ดัชนีการส่งออกชีต · แท็บแยกของตัวเอง ─────────────────────────────
create table if not exists by_sheet_exports (
  by_id       uuid primary key references by_barcodes(id) on delete cascade,
  tab         text not null,
  row_no      integer not null,
  exported_at timestamptz not null default now()
);

alter table by_sheet_exports enable row level security;
drop policy if exists read_by_sheet_exports on by_sheet_exports;
create policy read_by_sheet_exports on by_sheet_exports for select to authenticated
  using (my_role() in ('supervisor', 'admin'));

-- ---------------------------------------------------------------------
-- แจ้งเตือน: มีบาร์โค้ด BY ส่งเข้ามา → เด้งหาแอดมินและเจ้าของระบบทันที
-- ต่อท้ายงานเดิมใน push_due_jobs ไม่ได้ จึงเขียนทับทั้งฟังก์ชัน
-- ---------------------------------------------------------------------
create or replace function push_due_jobs()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_jobs jsonb := '[]'::jsonb;
  v_now  timestamptz := now();
begin
  -- ① ใกล้เลิกกะ 10 นาที · เตือนคนที่ถือเครื่อง
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(j) from (
      select jsonb_build_object(
        'kind',    'due_soon',
        'subject', h.txn_id::text,
        'user_id', h.user_id,
        'title',   'ใกล้เลิกกะแล้ว',
        'body',    'คุณยังถือ ' || count(*) || ' เครื่อง — ' ||
                   string_agg(h.asset_code, ', ' order by h.asset_code),
        'url',     '/returns'
      ) as j
      from asset_holdings h
      where h.due_at is not null
        and h.due_at between v_now and v_now + interval '10 minutes'
        and not exists (
          select 1 from notification_log n
          where n.kind = 'due_soon' and n.subject = h.txn_id::text and n.user_id = h.user_id
        )
      group by h.txn_id, h.user_id
    ) g
  ), '[]'::jsonb);

  -- ② เลยเวลาคืนมาแล้ว 10 นาที · เตือนเจ้าตัว
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(j) from (
      select jsonb_build_object(
        'kind',    'overdue',
        'subject', h.txn_id::text,
        'user_id', h.user_id,
        'title',   'เลยเวลาคืนแล้ว',
        'body',    'ยังไม่ได้คืน ' || count(*) || ' เครื่อง — ' ||
                   string_agg(h.asset_code, ', ' order by h.asset_code),
        'url',     '/returns'
      ) as j
      from asset_holdings h
      where h.due_at is not null
        and v_now >= h.due_at + interval '10 minutes'
        and not exists (
          select 1 from notification_log n
          where n.kind = 'overdue' and n.subject = h.txn_id::text and n.user_id = h.user_id
        )
      group by h.txn_id, h.user_id
    ) g
  ), '[]'::jsonb);

  -- ③ สรุปของค้างให้แอดมินและเจ้าของระบบ
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'overdue_admin',
      'subject', x.txn_id::text,
      'user_id', m.id,
      'title',   'มีเครื่องค้างเกินกะ',
      'body',    x.holder || ' ยังไม่คืน ' || x.n || ' เครื่อง — ' || x.codes,
      'url',     '/admin/assets-out'
    ))
    from (
      select h.txn_id,
             max(h.holder_name) as holder,
             count(*)           as n,
             string_agg(h.asset_code, ', ' order by h.asset_code) as codes
      from asset_holdings h
      where h.due_at is not null and v_now >= h.due_at + interval '10 minutes'
      group by h.txn_id
    ) x
    cross join (select id from profiles where role in ('supervisor', 'admin') and is_active) m
    where not exists (
      select 1 from notification_log n
      where n.kind = 'overdue_admin' and n.subject = x.txn_id::text and n.user_id = m.id
    )
  ), '[]'::jsonb);

  -- ④ แจ้งชำรุดใหม่ · เตือนแอดมินและเจ้าของระบบทันที
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'issue',
      'subject', i.id::text,
      'user_id', m.id,
      'title',   'แจ้งชำรุด ' || i.asset_code,
      'body',    i.symptom || ' · แจ้งโดย ' || coalesce(p.full_name, i.reported_name, 'ไม่ทราบชื่อ'),
      'url',     '/admin/assets'
    ))
    from asset_issues i
    left join profiles p on p.id = i.reported_by
    cross join (select id from profiles where role in ('supervisor', 'admin') and is_active) m
    where i.resolved_at is null
      and i.reported_at > v_now - interval '1 day'
      and not exists (
        select 1 from notification_log n
        where n.kind = 'issue' and n.subject = i.id::text and n.user_id = m.id
      )
  ), '[]'::jsonb);

  -- ⑤ บาร์โค้ด BY ส่งเข้ามาใหม่ · เตือนแอดมินและเจ้าของระบบทันที
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'by_new',
      'subject', b.id::text,
      'user_id', m.id,
      'title',   'มีการเบิกใน BY',
      'body',    p.full_name || ' · ' || b.reason || ' · ' ||
                 (select count(*) from by_barcode_photos ph where ph.by_id = b.id) || ' รูป',
      'url',     '/admin/by'
    ))
    from by_barcodes b
    join profiles p on p.id = b.user_id
    cross join (select id from profiles where role in ('supervisor', 'admin') and is_active) m
    where b.status = 'pending'
      and b.created_at > v_now - interval '1 day'
      and not exists (
        select 1 from notification_log n
        where n.kind = 'by_new' and n.subject = b.id::text and n.user_id = m.id
      )
  ), '[]'::jsonb);

  return v_jobs;
end $$;

grant execute on function push_due_jobs() to authenticated, service_role;


-- =====================================================================
-- BPL SUPPLY — บาร์โค้ด BY ต้องมีรูปอย่างน้อย 1 ใบ
-- รันต่อจาก 026 · ปลอดภัยที่จะรันซ้ำ
--
-- ไม่บังคับให้ถ่ายเยอะ แต่ต้องมีอย่างน้อย 1 ใบเสมอ
-- เพราะรูปบาร์โค้ดคือสิ่งที่แอดมินเอาไปสแกนตัดสต็อกจริง ๆ
-- ไม่มีรูปก็ไม่มีอะไรให้ทำต่อ
--
-- (ไฟล์นี้เคยปล่อยให้ส่งโดยไม่มีรูปได้ชั่วคราว ตอนนี้กลับมาบังคับ 1 ใบแล้ว
--  รันทับได้เลย ข้อมูลเดิมไม่กระทบ)
-- =====================================================================

create or replace function create_by_barcode(
  p_reason text,
  p_note   text default null,
  p_photos jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me  profiles%rowtype;
  v_id  uuid;
  v_ref text;
  r     jsonb;
  i     int := 0;
begin
  select * into v_me from profiles where id = auth.uid();
  if v_me.id is null or not v_me.is_active then
    raise exception 'บัญชีนี้ใช้งานไม่ได้';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'ต้องใส่เหตุผลก่อน';
  end if;
  if coalesce(jsonb_array_length(p_photos), 0) = 0 then
    raise exception 'ต้องแนบรูปบาร์โค้ดอย่างน้อย 1 ใบ';
  end if;

  v_ref := next_by_ref();
  insert into by_barcodes (ref_no, user_id, dept_code, sub_dept,
                           shift_start, shift_end, reason, note)
  values (v_ref, v_me.id, v_me.dept_code, v_me.sub_dept,
          v_me.shift_start, v_me.shift_end, btrim(p_reason),
          nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;

  for r in select * from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) loop
    insert into by_barcode_photos (by_id, file_id, web_link, bytes, sort_no)
    values (v_id, r->>'file_id', r->>'web_link', (r->>'bytes')::int, i);
    i := i + 1;
  end loop;

  return jsonb_build_object('id', v_id, 'ref_no', v_ref, 'photos', i);
end $$;

grant execute on function create_by_barcode(text, text, jsonb) to authenticated;


-- =====================================================================
-- BPL SUPPLY — ผูกรายการบาร์โค้ด BY เข้ากับวัสดุในระบบ
-- รันต่อจาก 027 · ปลอดภัยที่จะรันซ้ำ
--
-- ตอนแอดมินปิดรายการ ควรเลือกได้ว่าบาร์โค้ดนั้นคือวัสดุตัวไหนและกี่ชิ้น
-- ไม่งั้นสถิติบอกได้แค่ "เหตุผล" ซึ่งกว้างเกินกว่าจะเอาไปสั่งของ
--
-- การตัดสต็อกจริงยังเป็นเรื่องของระบบ BY เหมือนเดิม
-- ที่นี่แค่บันทึกว่าคืออะไร เว้นแต่แอดมินสั่งให้ตัดในระบบนี้ด้วย
-- =====================================================================

alter table by_barcodes
  add column if not exists item_id bigint references items(id),
  add column if not exists qty     integer;

comment on column by_barcodes.item_id is
  'วัสดุที่แอดมินระบุตอนปิดรายการ · ว่างได้ถ้าเป็นของที่ไม่มีในคลังนี้';

create index if not exists by_barcodes_item_idx on by_barcodes (item_id) where item_id is not null;

-- ── view เพิ่มชื่อวัสดุ ────────────────────────────────────────────────
drop view if exists by_feed;
create view by_feed
with (security_invoker = true) as
select
  b.id,
  b.ref_no,
  b.created_at,
  b.reason,
  b.note,
  b.status,
  b.handled_at,
  b.handled_note,
  b.user_id,
  p.full_name                            as who,
  p.employee_code,
  b.dept_code,
  b.sub_dept,
  b.shift_start,
  b.shift_end,
  h.full_name                            as handled_by_name,
  b.item_id,
  i.name                                 as item_name,
  i.sku                                  as item_sku,
  i.unit                                 as item_unit,
  b.qty,
  coalesce((
    select count(*) from by_barcode_photos ph where ph.by_id = b.id
  ), 0)::int                             as photo_count,
  coalesce((
    select array_agg(ph.file_id order by ph.sort_no)
    from by_barcode_photos ph where ph.by_id = b.id
  ), '{}')                               as file_ids
from by_barcodes b
join profiles p on p.id = b.user_id
left join profiles h on h.id = b.handled_by
left join items i   on i.id = b.item_id;

grant select on by_feed to authenticated;

-- ---------------------------------------------------------------------
-- ปิดรายการ พร้อมระบุว่าเป็นวัสดุตัวไหนกี่ชิ้น
--   p_cut_stock = true จะตัดสต็อกในระบบนี้ให้ด้วย
--   ใช้เมื่อของชิ้นนั้นมีอยู่ในคลังนี้จริง ไม่งั้นยอดจะเพี้ยน
-- ---------------------------------------------------------------------
create or replace function set_by_status(
  p_id        uuid,
  p_status    by_status,
  p_note      text default null,
  p_item_id   bigint default null,
  p_qty       integer default null,
  p_cut_stock boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_was by_status;
begin
  if my_role() not in ('supervisor', 'admin') then
    raise exception 'ไม่มีสิทธิ์จัดการรายการบาร์โค้ด BY';
  end if;

  select status into v_was from by_barcodes where id = p_id;
  if v_was is null then
    raise exception 'ไม่พบรายการนี้';
  end if;

  update by_barcodes
     set status       = p_status,
         item_id      = coalesce(p_item_id, item_id),
         qty          = coalesce(p_qty, qty),
         handled_by   = case when p_status = 'pending' then null else auth.uid() end,
         handled_at   = case when p_status = 'pending' then null else now() end,
         handled_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id;

  -- ตัดสต็อกให้เฉพาะตอนสั่ง และเฉพาะตอนเพิ่งเปลี่ยนเป็น done
  -- กันกดซ้ำแล้วตัดซ้ำ
  if p_cut_stock and p_status = 'done' and v_was <> 'done'
     and p_item_id is not null and coalesce(p_qty, 0) > 0 then
    perform adjust_stock(p_item_id, -p_qty, 'บาร์โค้ด BY');
  end if;
end $$;

grant execute on function set_by_status(uuid, by_status, text, bigint, integer, boolean) to authenticated;

-- ── สถิติเพิ่มมิติ "วัสดุ" เข้าไปด้วย ─────────────────────────────────
drop view if exists by_stats_monthly;
create view by_stats_monthly
with (security_invoker = true) as
select
  to_char((b.created_at at time zone 'Asia/Bangkok'), 'YYYY-MM') as ym,
  b.dept_code,
  b.reason,
  b.item_id,
  i.name                                                          as item_name,
  count(*)::int                                                   as total,
  count(*) filter (where b.status = 'pending')::int               as pending,
  count(*) filter (where b.status = 'done')::int                  as done,
  count(*) filter (where b.status = 'rejected')::int              as rejected,
  coalesce(sum(b.qty) filter (where b.status = 'done'), 0)::int    as qty_done
from by_barcodes b
left join items i on i.id = b.item_id
group by 1, 2, 3, 4, 5;

grant select on by_stats_monthly to authenticated;


-- =====================================================================
-- BPL SUPPLY — ประวัติ Asset และรูปหลักฐาน Asset ในหน้าเดียวกับสิ้นเปลือง
-- รันต่อจาก 028 · ปลอดภัยที่จะรันซ้ำ
--
-- สองเรื่อง
--   1. ประวัติการเบิก-คืนเครื่อง ต้องดูย้อนหลังได้ ถึงคืนไปแล้วก็ยังต้องอยู่
--      ของเดิมมีแต่ asset_holdings ซึ่งเก็บเฉพาะที่ยังไม่คืน
--   2. รูปตอนเบิก-คืนเครื่องไม่เคยโผล่ในหน้าหลักฐาน เพราะอยู่คนละตาราง
-- =====================================================================

-- ปุ่ม "ใช้แล้ว" ต้องใช้ได้กับรูปฝั่ง Asset ด้วย
alter table asset_txns add column if not exists evidence_archived boolean not null default false;

create index if not exists asset_txns_archived_idx
  on asset_txns (created_at desc) where not evidence_archived;

-- ---------------------------------------------------------------------
-- ประวัติการเบิก-คืนเครื่อง — หนึ่งแถวต่อหนึ่งเครื่องต่อหนึ่งครั้งที่เบิก
-- คืนแล้วแถวยังอยู่ แค่มีเวลาคืนเติมเข้ามา
-- ---------------------------------------------------------------------
drop view if exists asset_history;
create view asset_history
with (security_invoker = true) as
select
  ai.id                                   as out_item_id,
  ai.asset_code,
  a.type_code,
  ty.name                                 as type_name,
  a.dept_code                             as asset_dept,
  t.id                                    as txn_id,
  t.ref_no,
  t.user_id,
  p.full_name                             as who,
  p.employee_code,
  t.dept_code                             as holder_dept,
  p.sub_dept,
  t.shift_start,
  t.shift_end,
  t.due_at,
  t.created_at                            as taken_at,
  back.created_at                         as returned_at,
  back.ref_no                             as return_ref,
  backp.full_name                         as returned_by,
  (back.id is null)                       as still_out,
  -- รูปทั้งสองฝั่งติดมาในแถวเดียว จะได้เทียบสภาพก่อน-หลังได้ทันที
  coalesce((
    select array_agg(ph.file_id order by ph.seq)
    from asset_txn_photos ph where ph.txn_id = t.id
  ), '{}')                                 as out_file_ids,
  coalesce((
    select array_agg(ph.file_id order by ph.seq)
    from asset_txn_photos ph where ph.txn_id = back.id
  ), '{}')                                 as in_file_ids,
  case
    when back.created_at is not null
      then extract(epoch from (back.created_at - t.created_at)) / 3600
  end::numeric(10, 2)                     as held_hours
from asset_txn_items ai
join asset_txns t   on t.id = ai.txn_id and t.kind = 'out'
join assets a       on a.code = ai.asset_code
join asset_types ty on ty.code = a.type_code
join profiles p     on p.id = t.user_id
left join asset_txn_items back_item on back_item.out_item_id = ai.id
left join asset_txns back           on back.id = back_item.txn_id
left join profiles backp            on backp.id = back.user_id;

grant select on asset_history to authenticated;

-- ---------------------------------------------------------------------
-- หน้าหลักฐาน: รวมรูปฝั่ง Asset เข้ามาด้วย
--
-- เพิ่มสองชนิดใหม่ asset_out / asset_in และคอลัมน์ asset_type_code
-- ฝั่งสิ้นเปลืองค่าเป็น null ฝั่ง Asset ก็มี item_ids ว่าง
-- ดรอปดาวน์เลือกของจึงรวมได้ทั้งวัสดุรายชิ้นและประเภทเครื่อง
-- ---------------------------------------------------------------------
drop view if exists evidence_items;
drop view if exists evidence_feed;

create view evidence_feed
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
  p.dept_code,
  p.sub_dept,
  p.shift_start,
  p.shift_end,
  null::text                                as asset_type_code,
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
    select array_agg(distinct ri.item_id)
    from requisition_items ri where ri.requisition_id = r.id
  ), '{}')                                  as item_ids,
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
  p.dept_code,
  p.sub_dept,
  p.shift_start,
  p.shift_end,
  null::text,
  true,
  i.name || ' คืน ' || rt.qty || ' (' ||
    case rt.condition when 'ok' then 'ใช้ได้' when 'damaged' then 'ชำรุด' else 'สูญหาย' end || ')',
  array[i.id],
  coalesce((
    select array_agg(ph.file_id order by ph.sort_no)
    from return_photos ph where ph.return_id = rt.id
  ), array[rt.evidence_file_id])
from returns rt
join requisition_items ri on ri.id = rt.requisition_item_id
join requisitions rq      on rq.id = ri.requisition_id
join items i              on i.id = ri.item_id
join profiles p           on p.id = rt.returned_by
where rt.evidence_file_id is not null

union all

-- ฝั่ง Asset — หนึ่งแถวต่อหนึ่งครั้งที่เบิกหรือคืน รูปผูกกับครั้งนั้น
select
  case when t.kind = 'out' then 'asset_out' else 'asset_in' end,
  t.id::text,
  t.ref_no,
  t.created_at,
  'BPL',
  (select ph.file_id from asset_txn_photos ph where ph.txn_id = t.id order by ph.seq limit 1),
  null::text,
  t.evidence_archived,
  p.full_name,
  p.employee_code,
  t.dept_code,
  p.sub_dept,
  t.shift_start,
  t.shift_end,
  t.type_code,
  true,
  ty.name || (case when t.kind = 'out' then ' เบิก ' else ' คืน ' end) ||
    coalesce((
      select count(*)::text from asset_txn_items ai where ai.txn_id = t.id
    ), '0') || ' เครื่อง — ' ||
    coalesce((
      select string_agg(ai.asset_code, ', ' order by ai.asset_code)
      from asset_txn_items ai where ai.txn_id = t.id
    ), ''),
  '{}'::bigint[],
  coalesce((
    select array_agg(ph.file_id order by ph.seq)
    from asset_txn_photos ph where ph.txn_id = t.id
  ), '{}')
from asset_txns t
join asset_types ty on ty.code = t.type_code
join profiles p     on p.id = t.user_id
where exists (select 1 from asset_txn_photos ph where ph.txn_id = t.id);

grant select on evidence_feed to authenticated;

-- ── ตัวเลือกในดรอปดาวน์: วัสดุรายชิ้น + ประเภทเครื่อง ─────────────────
create view evidence_items
with (security_invoker = true) as
select
  'i:' || i.id::text                      as key,
  i.name                                  as name,
  i.sku                                   as sub,
  'supply'::text                          as kind,
  count(*)::int                           as photo_rows
from evidence_feed e
join items i on i.id = any(e.item_ids)
group by i.id, i.name, i.sku

union all

select
  't:' || ty.code,
  ty.name,
  'อุปกรณ์ Asset',
  'asset'::text,
  count(*)::int
from evidence_feed e
join asset_types ty on ty.code = e.asset_type_code
group by ty.code, ty.name;

grant select on evidence_items to authenticated;

-- ---------------------------------------------------------------------
-- ปุ่ม "ใช้แล้ว" รองรับรูปฝั่ง Asset
-- ---------------------------------------------------------------------
create or replace function set_evidence_archived(
  p_kind      text,
  p_source_id text,
  p_archived  boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if my_role() not in ('supervisor', 'admin') then
    raise exception 'ไม่มีสิทธิ์จัดการหลักฐาน';
  end if;

  if p_kind = 'requisition' then
    update requisitions set evidence_archived = p_archived where id = p_source_id::uuid;
  elsif p_kind = 'return' then
    update returns set evidence_archived = p_archived where id = p_source_id::bigint;
  elsif p_kind in ('asset_out', 'asset_in') then
    update asset_txns set evidence_archived = p_archived where id = p_source_id::uuid;
  else
    raise exception 'ประเภทหลักฐานไม่ถูกต้อง';
  end if;
end $$;

grant execute on function set_evidence_archived(text, text, boolean) to authenticated;


-- =====================================================================
-- BPL SUPPLY — แบ่งว่าใครควรได้แจ้งเตือนเรื่องไหน
-- รันต่อจาก 029 · ปลอดภัยที่จะรันซ้ำ
--
-- แอดมิน (supervisor) ได้เฉพาะเรื่องที่ต้องลงมือเอง
--   คำขออนุมัติ · บาร์โค้ด BY · แจ้งชำรุดใหม่ · ของใกล้หมด
-- เจ้าของระบบ (admin) ได้ทุกเรื่อง รวมของค้างเกินกะด้วย
--
-- ส่วนพนักงานยังได้แค่เรื่องของตัวเอง — ใกล้เลิกกะ และเลยเวลาคืน
-- =====================================================================

create or replace function push_due_jobs()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_jobs jsonb := '[]'::jsonb;
  v_now  timestamptz := now();
  v_day  text := to_char((now() at time zone 'Asia/Bangkok'), 'YYYY-MM-DD');
begin
  -- ① ใกล้เลิกกะ 10 นาที · เตือนคนที่ถือเครื่อง
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(j) from (
      select jsonb_build_object(
        'kind',    'due_soon',
        'subject', h.txn_id::text,
        'user_id', h.user_id,
        'title',   'ใกล้เลิกกะแล้ว',
        'body',    'คุณยังถือ ' || count(*) || ' เครื่อง — ' ||
                   string_agg(h.asset_code, ', ' order by h.asset_code),
        'url',     '/returns'
      ) as j
      from asset_holdings h
      where h.due_at is not null
        and h.due_at between v_now and v_now + interval '10 minutes'
        and not exists (
          select 1 from notification_log n
          where n.kind = 'due_soon' and n.subject = h.txn_id::text and n.user_id = h.user_id
        )
      group by h.txn_id, h.user_id
    ) g
  ), '[]'::jsonb);

  -- ② เลยเวลาคืนมาแล้ว 10 นาที · เตือนเจ้าตัว
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(j) from (
      select jsonb_build_object(
        'kind',    'overdue',
        'subject', h.txn_id::text,
        'user_id', h.user_id,
        'title',   'เลยเวลาคืนแล้ว',
        'body',    'ยังไม่ได้คืน ' || count(*) || ' เครื่อง — ' ||
                   string_agg(h.asset_code, ', ' order by h.asset_code),
        'url',     '/returns'
      ) as j
      from asset_holdings h
      where h.due_at is not null
        and v_now >= h.due_at + interval '10 minutes'
        and not exists (
          select 1 from notification_log n
          where n.kind = 'overdue' and n.subject = h.txn_id::text and n.user_id = h.user_id
        )
      group by h.txn_id, h.user_id
    ) g
  ), '[]'::jsonb);

  -- ③ ของค้างเกินกะ · เฉพาะเจ้าของระบบ ไม่กวนแอดมิน
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'overdue_admin',
      'subject', x.txn_id::text,
      'user_id', m.id,
      'title',   'มีเครื่องค้างเกินกะ',
      'body',    x.holder || ' ยังไม่คืน ' || x.n || ' เครื่อง — ' || x.codes,
      'url',     '/admin/assets-out'
    ))
    from (
      select h.txn_id,
             max(h.holder_name) as holder,
             count(*)           as n,
             string_agg(h.asset_code, ', ' order by h.asset_code) as codes
      from asset_holdings h
      where h.due_at is not null and v_now >= h.due_at + interval '10 minutes'
      group by h.txn_id
    ) x
    cross join (select id from profiles where role = 'admin' and is_active) m
    where not exists (
      select 1 from notification_log n
      where n.kind = 'overdue_admin' and n.subject = x.txn_id::text and n.user_id = m.id
    )
  ), '[]'::jsonb);

  -- ④ แจ้งชำรุดใหม่ · แอดมินและเจ้าของระบบ
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'issue',
      'subject', i.id::text,
      'user_id', m.id,
      'title',   'แจ้งชำรุด ' || i.asset_code,
      'body',    i.symptom || ' · แจ้งโดย ' || coalesce(p.full_name, i.reported_name, 'ไม่ทราบชื่อ'),
      'url',     '/admin/assets'
    ))
    from asset_issues i
    left join profiles p on p.id = i.reported_by
    cross join (select id from profiles where role in ('supervisor', 'admin') and is_active) m
    where i.resolved_at is null
      and i.reported_at > v_now - interval '1 day'
      and not exists (
        select 1 from notification_log n
        where n.kind = 'issue' and n.subject = i.id::text and n.user_id = m.id
      )
  ), '[]'::jsonb);

  -- ⑤ บาร์โค้ด BY ส่งเข้ามาใหม่ · แอดมินและเจ้าของระบบ
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'by_new',
      'subject', b.id::text,
      'user_id', m.id,
      'title',   'มีการเบิกใน BY',
      'body',    p.full_name || ' · ' || b.reason || ' · ' ||
                 (select count(*) from by_barcode_photos ph where ph.by_id = b.id) || ' รูป',
      'url',     '/admin/by'
    ))
    from by_barcodes b
    join profiles p on p.id = b.user_id
    cross join (select id from profiles where role in ('supervisor', 'admin') and is_active) m
    where b.status = 'pending'
      and b.created_at > v_now - interval '1 day'
      and not exists (
        select 1 from notification_log n
        where n.kind = 'by_new' and n.subject = b.id::text and n.user_id = m.id
      )
  ), '[]'::jsonb);

  -- ⑥ คำขอรออนุมัติ · แอดมินและเจ้าของระบบ
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'approval',
      'subject', r.id::text,
      'user_id', m.id,
      'title',   'มีคำขอรออนุมัติ',
      'body',    p.full_name || ' · ' ||
                 (select count(*) from requisition_items ri where ri.requisition_id = r.id) ||
                 ' รายการ · ' || r.ref_no,
      'url',     '/admin/approvals'
    ))
    from requisitions r
    join profiles p on p.id = r.requester_id
    cross join (select id from profiles where role in ('supervisor', 'admin') and is_active) m
    where r.status = 'pending'
      and r.created_at > v_now - interval '2 days'
      and not exists (
        select 1 from notification_log n
        where n.kind = 'approval' and n.subject = r.id::text and n.user_id = m.id
      )
  ), '[]'::jsonb);

  -- ⑦ ของใกล้หมด · แอดมินและเจ้าของระบบ · เตือนได้วันละครั้งต่อรายการ
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'low_stock',
      'subject', i.id::text || ':' || v_day,
      'user_id', m.id,
      'title',   case when i.qty_on_hand = 0 then 'ของหมดสต็อก' else 'ของใกล้หมด' end,
      'body',    i.name || ' เหลือ ' || i.qty_on_hand || ' ' || i.unit ||
                 ' (ขั้นต่ำ ' || i.min_qty || ')',
      'url',     '/admin/stock'
    ))
    from items i
    cross join (select id from profiles where role in ('supervisor', 'admin') and is_active) m
    where i.is_active
      and i.qty_on_hand <= i.min_qty
      and not exists (
        select 1 from notification_log n
        where n.kind = 'low_stock'
          and n.subject = i.id::text || ':' || v_day
          and n.user_id = m.id
      )
  ), '[]'::jsonb);

  return v_jobs;
end $$;

grant execute on function push_due_jobs() to authenticated, service_role;


-- =====================================================================
-- BPL SUPPLY — จังหวะการเตือนของค้างคืน
-- รันต่อจาก 030 · ปลอดภัยที่จะรันซ้ำ
--
-- หน้างาน (คนที่ถือเครื่อง)
--   ก่อนเลิกกะ 10 นาที        เตือนครั้งเดียว
--   เลยเวลาคืน 15 นาที        เตือน แล้วย้ำทุก 15 นาทีจนกว่าจะกดคืน
--
-- แอดมินและเจ้าของระบบ
--   เลยเวลาคืนเกิน 3 ชั่วโมง  เตือนครั้งเดียวต่อการเบิกหนึ่งครั้ง
--   ตั้งใจให้ช้ากว่าฝั่งหน้างานมาก เพราะส่วนใหญ่เจ้าตัวคืนเองภายในชั่วโมงแรก
--
-- อยากเปลี่ยนจังหวะ แก้เลขสองตัวข้างล่างนี้แล้วรันไฟล์นี้ซ้ำ
--   v_repeat_min  ทุกกี่นาทีถึงจะย้ำหน้างานอีกครั้ง
--   v_admin_hours เกินกี่ชั่วโมงถึงจะเตือนแอดมิน
-- =====================================================================

create or replace function push_due_jobs()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_jobs        jsonb := '[]'::jsonb;
  v_now         timestamptz := now();
  v_day         text := to_char((now() at time zone 'Asia/Bangkok'), 'YYYY-MM-DD');
  v_repeat_min  int := 15;
  v_admin_hours int := 3;
begin
  -- ① ใกล้เลิกกะ 10 นาที · เตือนคนที่ถือเครื่อง ครั้งเดียว
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(j) from (
      select jsonb_build_object(
        'kind',    'due_soon',
        'subject', h.txn_id::text,
        'user_id', h.user_id,
        'title',   'ใกล้เลิกกะแล้ว',
        'body',    'คุณยังถือ ' || count(*) || ' เครื่อง — ' ||
                   string_agg(h.asset_code, ', ' order by h.asset_code),
        'url',     '/returns'
      ) as j
      from asset_holdings h
      where h.due_at is not null
        and h.due_at between v_now and v_now + interval '10 minutes'
        and not exists (
          select 1 from notification_log n
          where n.kind = 'due_soon' and n.subject = h.txn_id::text and n.user_id = h.user_id
        )
      group by h.txn_id, h.user_id
    ) g
  ), '[]'::jsonb);

  -- ② เลยเวลาคืน · เตือนที่ 15 นาที แล้วย้ำทุก 15 นาทีจนกว่าจะคืน
  --
  -- กุญแจกันซ้ำใส่หมายเลขช่วงเวลาไว้ด้วย แต่ละช่วง 15 นาทีจึงเตือนได้ครั้งเดียว
  -- นาฬิกาเดินทุก 5 นาที การย้ำจึงตรงเวลาพอในทางปฏิบัติ
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(j) from (
      select jsonb_build_object(
        'kind',    'overdue',
        'subject', h.txn_id::text || ':' || slot::text,
        'user_id', h.user_id,
        'title',   'ยังไม่ได้คืนอุปกรณ์',
        'body',    'เลยเวลาคืนมาแล้ว ' ||
                   case
                     when slot * v_repeat_min < 60 then (slot * v_repeat_min)::text || ' นาที'
                     else round((slot * v_repeat_min)::numeric / 60, 1)::text || ' ชั่วโมง'
                   end || ' — ' || count(*) || ' เครื่อง: ' ||
                   string_agg(h.asset_code, ', ' order by h.asset_code),
        'url',     '/returns'
      ) as j
      from (
        select
          x.*,
          floor(extract(epoch from (v_now - x.due_at)) / (v_repeat_min * 60))::int as slot
        from asset_holdings x
        where x.due_at is not null and v_now >= x.due_at + (v_repeat_min || ' minutes')::interval
      ) h
      where not exists (
        select 1 from notification_log n
        where n.kind = 'overdue'
          and n.subject = h.txn_id::text || ':' || h.slot::text
          and n.user_id = h.user_id
      )
      group by h.txn_id, h.user_id, h.slot
    ) g
  ), '[]'::jsonb);

  -- ③ ค้างเกินหลายชั่วโมง · แอดมินและเจ้าของระบบ ครั้งเดียวต่อการเบิก
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'overdue_admin',
      'subject', x.txn_id::text,
      'user_id', m.id,
      'title',   'มีเครื่องค้างเกิน ' || v_admin_hours || ' ชั่วโมง',
      'body',    x.holder || ' ยังไม่คืน ' || x.n || ' เครื่อง — ' || x.codes,
      'url',     '/admin/assets-out'
    ))
    from (
      select h.txn_id,
             max(h.holder_name) as holder,
             count(*)           as n,
             string_agg(h.asset_code, ', ' order by h.asset_code) as codes
      from asset_holdings h
      where h.due_at is not null
        and v_now >= h.due_at + (v_admin_hours || ' hours')::interval
      group by h.txn_id
    ) x
    cross join (select id from profiles where role in ('supervisor', 'admin') and is_active) m
    where not exists (
      select 1 from notification_log n
      where n.kind = 'overdue_admin' and n.subject = x.txn_id::text and n.user_id = m.id
    )
  ), '[]'::jsonb);

  -- ④ แจ้งชำรุดใหม่ · แอดมินและเจ้าของระบบ
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'issue',
      'subject', i.id::text,
      'user_id', m.id,
      'title',   'แจ้งชำรุด ' || i.asset_code,
      'body',    i.symptom || ' · แจ้งโดย ' || coalesce(p.full_name, i.reported_name, 'ไม่ทราบชื่อ'),
      'url',     '/admin/assets'
    ))
    from asset_issues i
    left join profiles p on p.id = i.reported_by
    cross join (select id from profiles where role in ('supervisor', 'admin') and is_active) m
    where i.resolved_at is null
      and i.reported_at > v_now - interval '1 day'
      and not exists (
        select 1 from notification_log n
        where n.kind = 'issue' and n.subject = i.id::text and n.user_id = m.id
      )
  ), '[]'::jsonb);

  -- ⑤ บาร์โค้ด BY ส่งเข้ามาใหม่ · แอดมินและเจ้าของระบบ
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'by_new',
      'subject', b.id::text,
      'user_id', m.id,
      'title',   'มีการเบิกใน BY',
      'body',    p.full_name || ' · ' || b.reason || ' · ' ||
                 (select count(*) from by_barcode_photos ph where ph.by_id = b.id) || ' รูป',
      'url',     '/admin/by'
    ))
    from by_barcodes b
    join profiles p on p.id = b.user_id
    cross join (select id from profiles where role in ('supervisor', 'admin') and is_active) m
    where b.status = 'pending'
      and b.created_at > v_now - interval '1 day'
      and not exists (
        select 1 from notification_log n
        where n.kind = 'by_new' and n.subject = b.id::text and n.user_id = m.id
      )
  ), '[]'::jsonb);

  -- ⑥ คำขอรออนุมัติ · แอดมินและเจ้าของระบบ
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'approval',
      'subject', r.id::text,
      'user_id', m.id,
      'title',   'มีคำขอรออนุมัติ',
      'body',    p.full_name || ' · ' ||
                 (select count(*) from requisition_items ri where ri.requisition_id = r.id) ||
                 ' รายการ · ' || r.ref_no,
      'url',     '/admin/approvals'
    ))
    from requisitions r
    join profiles p on p.id = r.requester_id
    cross join (select id from profiles where role in ('supervisor', 'admin') and is_active) m
    where r.status = 'pending'
      and r.created_at > v_now - interval '2 days'
      and not exists (
        select 1 from notification_log n
        where n.kind = 'approval' and n.subject = r.id::text and n.user_id = m.id
      )
  ), '[]'::jsonb);

  -- ⑦ ของใกล้หมด · แอดมินและเจ้าของระบบ · วันละครั้งต่อรายการ
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'low_stock',
      'subject', i.id::text || ':' || v_day,
      'user_id', m.id,
      'title',   case when i.qty_on_hand = 0 then 'ของหมดสต็อก' else 'ของใกล้หมด' end,
      'body',    i.name || ' เหลือ ' || i.qty_on_hand || ' ' || i.unit ||
                 ' (ขั้นต่ำ ' || i.min_qty || ')',
      'url',     '/admin/stock'
    ))
    from items i
    cross join (select id from profiles where role in ('supervisor', 'admin') and is_active) m
    where i.is_active
      and i.qty_on_hand <= i.min_qty
      and not exists (
        select 1 from notification_log n
        where n.kind = 'low_stock'
          and n.subject = i.id::text || ':' || v_day
          and n.user_id = m.id
      )
  ), '[]'::jsonb);

  return v_jobs;
end $$;

grant execute on function push_due_jobs() to authenticated, service_role;


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
  ('SKU-OF-0302', 'ปากกาลูกลื่นน้ำเงิน',          (select id from categories where name = 'สำนักงาน'),    'BPL', 'ด้าม', 'C-02', 100,25, false, 'SKU-OF-0302')
on conflict (sku) do nothing;


-- ===== 032_asset_proxy_transfer.sql =====
-- =====================================================================
-- BPL SUPPLY — เบิกแทน คืนแทน และการโอนเครื่องข้ามแผนก
-- รันต่อจาก 031 · ปลอดภัยที่จะรันซ้ำ
--
-- สามเรื่องที่แก้ปัญหาเดียวกัน: เครื่องอยู่ผิดที่แล้วระบบไม่มีทางย้ายให้ถูก
--
--  ① เบิกแทน   แอดมินกดเบิกให้คนอื่น ของไปค้างชื่อคนนั้น ไม่ใช่ชื่อคนกด
--  ② ตำแหน่งใหม่ "ผู้ตรวจสอบ" เห็นทุกแผนกเพื่อจ่ายของ แต่ไม่มีสิทธิ์แอดมินใด ๆ
--  ③ โอนเครื่อง แผนกที่ถืออยู่ถูกตัดสิทธิ์ แผนกใหม่ได้สิทธิ์เบิกแทน
--
-- หมายเหตุเรื่องตำแหน่งใหม่
--   ไม่ได้เพิ่มค่าลงใน enum user_role แต่ใช้คอลัมน์ boolean แยกต่างหาก
--   เพราะ Postgres ห้ามใช้ค่า enum ที่เพิ่งเพิ่มภายในทรานแซกชันเดียวกัน
--   ซึ่งหน้า SQL Editor ของ Supabase รันทั้งไฟล์เป็นทรานแซกชันเดียว
--   ไฟล์นี้จะพังกลางทางแบบงง ๆ วิธีนี้เลี่ยงกับดักนั้นทั้งหมด
--   และเข้าชุดกับ can_assets ที่ทำไว้แล้วใน 021
-- =====================================================================


-- ---------------------------------------------------------------------
-- ① ตำแหน่ง "ผู้ตรวจสอบ"
--
-- เห็นเครื่องทุกแผนกเหมือนแอดมิน เพื่อจะได้รู้ว่าของว่างอยู่ที่ไหน
-- เบิกแทนคนอื่นได้ และโอนเครื่องข้ามแผนกได้
-- แต่ทำอย่างอื่นแบบแอดมินไม่ได้เลย — ไม่อนุมัติ ไม่แก้สต็อก ไม่เห็นหน้าแอดมิน
-- และคืนแทนคนอื่นไม่ได้ เพราะคนคืนต้องเป็นคนที่ถือของจริงถึงจะถ่ายรูปสภาพได้
-- ---------------------------------------------------------------------
alter table profiles add column if not exists can_dispatch boolean not null default false;

comment on column profiles.can_dispatch is
  'ผู้ตรวจสอบ — เห็นเครื่องทุกแผนก เบิกแทนและโอนเครื่องได้ แต่ไม่มีสิทธิ์แอดมิน';

create or replace function my_can_dispatch() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select can_dispatch from profiles where id = auth.uid()), false);
$$;

grant execute on function my_can_dispatch() to authenticated;

/** จ่ายของแทนคนอื่นได้ไหม — แอดมิน เจ้าของระบบ หรือผู้ตรวจสอบ */
create or replace function my_can_proxy() returns boolean
language sql stable security definer set search_path = public as $$
  select my_role() in ('supervisor', 'admin') or my_can_dispatch();
$$;

grant execute on function my_can_proxy() to authenticated;


-- ---------------------------------------------------------------------
-- ② เบิกแทน
--
-- user_id ยังเป็น "คนที่ของไปอยู่ด้วย" เหมือนเดิมทุกประการ
-- ของจึงไปค้างชื่อเจ้าตัว กะและกำหนดคืนคิดจากกะของเจ้าตัว
-- และการแจ้งเตือนที่เขียนไว้แล้วทั้งหมดยิงหาเจ้าตัวโดยไม่ต้องแก้อะไรเลย
--
-- acted_by คือคนที่กดให้ ว่างแปลว่าเบิกเอง
-- ---------------------------------------------------------------------
alter table asset_txns add column if not exists acted_by uuid references profiles(id);

comment on column asset_txns.acted_by is
  'คนที่กดเบิก/คืนให้ ถ้าไม่ใช่เจ้าตัว · ว่าง = ทำเอง';

create index if not exists asset_txns_acted_idx
  on asset_txns (acted_by, created_at desc) where acted_by is not null;

-- แถวที่เกิดจากการโอน ไม่ใช่การคืนจริง จะได้ไม่ปนในสถิติและไม่ต้องบังคับรูป
alter table asset_txns add column if not exists is_transfer boolean not null default false;


-- ---------------------------------------------------------------------
-- ③ โอนเครื่องข้ามแผนก
--
-- การโอนไม่ได้ยัดเครื่องใส่มือใคร แต่เปิดสิทธิ์ให้แผนกปลายทาง "ไปกดเบิกเอง"
-- ตามขั้นตอนปกติ เพื่อให้ยังมีรูปสภาพตอนรับของครบเหมือนการเบิกทุกครั้ง
--
-- ถ้าตอนโอนมีคนถืออยู่ ระบบปิดรายการค้างของคนนั้นให้เลย
-- เจ้าตัวจะไม่ต้องตามคืนเครื่องที่ไม่ได้อยู่กับตัวแล้ว
-- และปิดเฉพาะเครื่องที่ถูกโอน เครื่องอื่นในใบเดียวกันยังค้างตามเดิม
-- ---------------------------------------------------------------------
create table if not exists asset_transfers (
  id           bigserial primary key,
  asset_code   text not null references assets(code),
  -- แถวตอนเบิกของคนเดิมที่ถูกตัดออก · ว่าง = ตอนโอนเครื่องว่างอยู่
  out_item_id  bigint references asset_txn_items(id),
  from_user_id uuid references profiles(id),
  from_dept    text,
  to_dept      text not null references departments(code),
  by_user_id   uuid not null references profiles(id),
  reason       text,
  created_at   timestamptz not null default now(),
  -- ปลายทางกดเบิกแล้ว
  claimed_at   timestamptz,
  claimed_by   uuid references profiles(id),
  -- ต้นทางกดรับทราบแล้ว
  ack_at       timestamptz
);

create index if not exists asset_transfers_asset_idx on asset_transfers (asset_code, created_at desc);
create index if not exists asset_transfers_open_idx  on asset_transfers (to_dept) where claimed_at is null;
create index if not exists asset_transfers_from_idx  on asset_transfers (from_user_id) where ack_at is null;

-- แผนกที่ได้รับเครื่องมาใช้ชั่วคราว · ว่าง = ไม่ได้ถูกโอนอยู่
-- ไม่ได้ไปทับ dept_code เพราะเครื่องต้องรู้ทางกลับบ้านของตัวเอง
alter table assets add column if not exists loan_dept text references departments(code);

comment on column assets.loan_dept is
  'แผนกที่ได้รับเครื่องนี้มาใช้ชั่วคราวจากการโอน · เคลียร์เมื่อคืนเข้าระบบตามปกติ';

create index if not exists assets_loan_idx on assets (loan_dept) where loan_dept is not null;


-- ---------------------------------------------------------------------
-- ใครเห็นเครื่องไหน — เพิ่มผู้ตรวจสอบ และแผนกที่รับโอน
-- ---------------------------------------------------------------------
drop policy if exists read_assets on assets;
create policy read_assets on assets for select to authenticated using (
  my_role() in ('supervisor', 'admin')
  -- ผู้ตรวจสอบเห็นทุกเครื่อง เพราะหน้าที่คือรู้ว่าของว่างอยู่ที่ไหน
  or my_can_dispatch()
  -- คนที่ถืออยู่ต้องเห็นเสมอ ไม่งั้นคืนไม่ได้
  or exists (
    select 1
    from asset_txn_items ai
    join asset_txns t on t.id = ai.txn_id
    where ai.id = assets.held_item_id and t.user_id = auth.uid()
  )
  or (
    my_can_assets()
    and (
      dept_code is null
      or dept_code = 'ALL'
      or 'ALL' = any(my_depts())
      or dept_code = any(my_depts())
      or share_depts && my_depts()
      -- เครื่องที่ถูกโอนมาให้แผนกเรา
      or loan_dept = any(my_depts())
    )
  )
);


-- ---------------------------------------------------------------------
-- View: รายชื่อคนที่เบิกแทนได้
--
-- ต้องเป็น security definer เพราะคนเบิกแทนอาจอ่าน profiles ของแผนกอื่นไม่ได้
-- คืนเฉพาะข้อมูลที่จำเป็นต่อการเลือกคน ไม่มีอะไรที่อ่อนไหว
-- ---------------------------------------------------------------------
create or replace function proxy_targets(p_q text default null)
returns table (
  id            uuid,
  employee_code text,
  full_name     text,
  dept_code     text,
  sub_dept      text,
  shift_start   time,
  shift_end     time
)
language sql stable security definer set search_path = public as $$
  select p.id, p.employee_code, p.full_name, p.dept_code, p.sub_dept,
         p.shift_start, p.shift_end
  from profiles p
  where my_can_proxy()
    and p.is_active
    and (
      p_q is null or p_q = ''
      or p.full_name     ilike '%' || p_q || '%'
      or p.employee_code ilike '%' || p_q || '%'
      or coalesce(p.dept_code, '') ilike '%' || p_q || '%'
    )
  order by p.full_name
  limit 200;
$$;

grant execute on function proxy_targets(text) to authenticated;


-- ---------------------------------------------------------------------
-- View: ของค้างคืน — พ่วงคนที่กดเบิกให้
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
  a.share_depts        as asset_share_depts,
  a.loan_dept          as asset_loan_dept,
  t.id                 as txn_id,
  t.ref_no,
  t.user_id,
  p.full_name          as holder_name,
  p.employee_code      as holder_code,
  t.dept_code          as holder_dept,
  p.sub_dept           as holder_sub_dept,
  t.acted_by,
  ap.full_name         as acted_by_name,
  t.shift_start,
  t.shift_end,
  t.due_at,
  t.created_at         as taken_at
from assets a
join asset_txn_items ai on ai.id = a.held_item_id
join asset_txns t       on t.id = ai.txn_id
join asset_types ty     on ty.code = a.type_code
join profiles p         on p.id = t.user_id
left join profiles ap   on ap.id = t.acted_by;

grant select on asset_holdings to authenticated;


-- ---------------------------------------------------------------------
-- RPC: เบิก Asset — รับ p_for_user เพิ่มเข้ามา
--
-- ทิ้งตัวเก่าที่รับ 5 อาร์กิวเมนต์ก่อน ไม่งั้นจะมีสองตัวชื่อเดียวกัน
-- แล้ว PostgREST จะเลือกไม่ถูกว่าจะเรียกตัวไหน
-- ---------------------------------------------------------------------
drop function if exists asset_checkout(text, text[], jsonb, jsonb, text);

create or replace function asset_checkout(
  p_type     text,
  p_codes    text[],
  p_photos   jsonb default '[]'::jsonb,
  p_issues   jsonb default '[]'::jsonb,
  p_note     text default null,
  p_for_user uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me     profiles%rowtype;
  v_for    profiles%rowtype;
  v_actor  uuid;
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

  -- เบิกให้ใคร
  if p_for_user is null or p_for_user = v_me.id then
    v_for   := v_me;
    v_actor := null;
  else
    if not my_can_proxy() then
      raise exception 'บัญชีนี้เบิกแทนคนอื่นไม่ได้';
    end if;
    select * into v_for from profiles where id = p_for_user;
    if v_for.id is null or not v_for.is_active then
      raise exception 'ไม่พบผู้รับของ หรือบัญชีถูกระงับ';
    end if;
    v_actor := v_me.id;
  end if;

  -- คนกดต้องมีสิทธิ์แตะเครื่อง ส่วนคนรับไม่ต้อง
  -- เพราะทั้งหมดนี้มีไว้เพื่อคนที่มองไม่เห็นเครื่องด้วยตัวเองอยู่แล้ว
  perform assert_can_assets();

  if p_codes is null or array_length(p_codes, 1) is null then
    raise exception 'ยังไม่ได้เลือกเครื่อง';
  end if;

  if not exists (select 1 from asset_types where code = p_type and is_active) then
    raise exception 'ไม่พบประเภท %', p_type;
  end if;

  select count(*) into v_steps from asset_photo_steps where type_code = p_type;
  select photo_min into v_min from asset_types where code = p_type;
  if v_steps > 0 then v_min := v_steps; end if;
  if v_photos < coalesce(v_min, 1) then
    raise exception 'ต้องถ่ายรูปให้ครบ % ใบก่อน (ถ่ายมาแล้ว % ใบ)', coalesce(v_min, 1), v_photos;
  end if;

  -- กะและกำหนดคืนคิดจากคนที่ของไปอยู่ด้วย ไม่ใช่คนกด
  v_ref := next_asset_ref('out');
  insert into asset_txns (ref_no, kind, type_code, user_id, acted_by, dept_code,
                          shift_start, shift_end, due_at, note)
  values (v_ref, 'out', p_type, v_for.id, v_actor, v_for.dept_code,
          v_for.shift_start, v_for.shift_end,
          shift_due_at(v_for.shift_start, v_for.shift_end), p_note)
  returning id into v_txn;

  foreach v_code in array p_codes loop
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

    -- ถ้าเครื่องนี้ถูกโอนมาแล้วยังไม่มีใครรับ ถือว่าการรับเสร็จสมบูรณ์ตรงนี้
    update asset_transfers
       set claimed_at = now(), claimed_by = v_for.id
     where asset_code = v_code and claimed_at is null;
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
    'count', array_length(p_codes, 1),
    'for_name', case when v_actor is null then null else v_for.full_name end
  );
end $$;

grant execute on function asset_checkout(text, text[], jsonb, jsonb, text, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- RPC: คืน Asset — ผู้ตรวจสอบคืนแทนคนอื่นไม่ได้
--
-- เหตุผล: การคืนต้องมีรูปสภาพจริงของเครื่องตอนนั้น
-- คนที่ไม่ได้ถือของอยู่ถ่ายรูปนั้นไม่ได้ ถ้าเปิดให้กดก็จะได้รูปมั่ว ๆ มาแทน
-- แอดมินยังคืนแทนได้เหมือนเดิม เพราะเป็นคนที่รับของคืนเข้าคลังจริง
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
  v_actor  uuid := null;
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
    if v_owner <> v_me.id then
      if my_role() not in ('supervisor', 'admin') then
        raise exception 'เครื่อง % ไม่ได้เบิกโดยคุณ', v_code;
      end if;
      v_actor := v_me.id;
    end if;

    insert into asset_txn_items (txn_id, asset_code, out_item_id)
    values (v_txn, v_code, v_out);

    -- คืนเข้าระบบแล้ว เครื่องกลับไปอยู่กับแผนกเจ้าของตามเดิม
    update assets set held_item_id = null, loan_dept = null where code = v_code;
  end loop;

  if v_actor is not null then
    update asset_txns set acted_by = v_actor where id = v_txn;
  end if;

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
-- RPC: โอนเครื่องให้แผนกอื่น
-- ---------------------------------------------------------------------
create or replace function asset_transfer(
  p_code    text,
  p_to_dept text,
  p_reason  text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me      uuid := auth.uid();
  v_asset   assets%rowtype;
  v_out     bigint;
  v_from    uuid;
  v_fdept   text;
  v_txn     uuid;
  v_ref     text;
  v_id      bigint;
begin
  if not my_can_proxy() then
    raise exception 'บัญชีนี้โอนเครื่องไม่ได้';
  end if;

  if not exists (select 1 from departments where code = p_to_dept) then
    raise exception 'ไม่รู้จักแผนก %', p_to_dept;
  end if;

  select * into v_asset from assets where code = p_code for update;
  if v_asset.code is null then
    raise exception 'ไม่พบเครื่อง %', p_code;
  end if;
  if coalesce(v_asset.loan_dept, v_asset.dept_code) = p_to_dept then
    raise exception 'เครื่อง % อยู่กับแผนกนี้อยู่แล้ว', p_code;
  end if;

  -- ถ้ามีคนถืออยู่ ปิดรายการค้างของคนนั้นเฉพาะเครื่องนี้เครื่องเดียว
  v_out := v_asset.held_item_id;
  if v_out is not null then
    select t.user_id, t.dept_code into v_from, v_fdept
      from asset_txn_items ai join asset_txns t on t.id = ai.txn_id
     where ai.id = v_out;

    v_ref := next_asset_ref('in');
    insert into asset_txns (ref_no, kind, type_code, user_id, acted_by, dept_code, is_transfer, note)
    values (v_ref, 'in', v_asset.type_code, v_from, v_me, v_fdept, true,
            'โอนให้แผนก ' || p_to_dept || coalesce(' · ' || p_reason, ''))
    returning id into v_txn;

    insert into asset_txn_items (txn_id, asset_code, out_item_id)
    values (v_txn, p_code, v_out);

    update assets set held_item_id = null where code = p_code;
  end if;

  update assets set loan_dept = p_to_dept where code = p_code;

  insert into asset_transfers (asset_code, out_item_id, from_user_id, from_dept,
                               to_dept, by_user_id, reason)
  values (p_code, v_out, v_from, coalesce(v_fdept, v_asset.dept_code),
          p_to_dept, v_me, p_reason)
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'asset_code', p_code,
    'to_dept', p_to_dept,
    'cut_from', v_from
  );
end $$;

grant execute on function asset_transfer(text, text, text) to authenticated;


/** ต้นทางกดรับทราบว่าไม่ต้องตามคืนเครื่องนั้นแล้ว */
create or replace function asset_transfer_ack(p_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update asset_transfers
     set ack_at = now()
   where id = p_id
     and ack_at is null
     and (from_user_id = auth.uid() or my_can_proxy());
end $$;

grant execute on function asset_transfer_ack(bigint) to authenticated;


/** ยกเลิกการโอนที่ปลายทางยังไม่ได้รับ — เครื่องกลับไปอยู่แผนกเดิม */
create or replace function asset_transfer_cancel(p_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
begin
  if not my_can_proxy() then
    raise exception 'บัญชีนี้ยกเลิกการโอนไม่ได้';
  end if;

  select asset_code into v_code
    from asset_transfers where id = p_id and claimed_at is null;
  if v_code is null then
    raise exception 'ไม่พบรายการโอนที่ยังไม่ถูกรับ';
  end if;

  update assets set loan_dept = null where code = v_code;
  delete from asset_transfers where id = p_id;
end $$;

grant execute on function asset_transfer_cancel(bigint) to authenticated;


-- ---------------------------------------------------------------------
-- View: เรื่องโอนที่ยังค้างอยู่ — ใช้ขึ้นแถบเตือนทั้งสองฝั่ง
--
--   side = 'in'  เครื่องถูกโอนมาให้แผนกเรา รอไปกดเบิก
--   side = 'out' เครื่องของเราถูกโอนออกไป ไม่ต้องตามคืนแล้ว
-- ---------------------------------------------------------------------
drop view if exists asset_transfer_notices;
create view asset_transfer_notices
with (security_invoker = true) as
select
  tr.id,
  'in'::text            as side,
  tr.asset_code,
  ty.name               as type_name,
  tr.to_dept,
  tr.from_dept,
  fp.full_name          as from_name,
  bp.full_name          as by_name,
  tr.reason,
  tr.created_at
from asset_transfers tr
join assets a       on a.code = tr.asset_code
join asset_types ty on ty.code = a.type_code
left join profiles fp on fp.id = tr.from_user_id
join profiles bp      on bp.id = tr.by_user_id
where tr.claimed_at is null
  and (tr.to_dept = any(my_depts()) or 'ALL' = any(my_depts()))

union all

select
  tr.id,
  'out'::text,
  tr.asset_code,
  ty.name,
  tr.to_dept,
  tr.from_dept,
  fp.full_name,
  bp.full_name,
  tr.reason,
  tr.created_at
from asset_transfers tr
join assets a       on a.code = tr.asset_code
join asset_types ty on ty.code = a.type_code
left join profiles fp on fp.id = tr.from_user_id
join profiles bp      on bp.id = tr.by_user_id
where tr.ack_at is null
  and tr.from_user_id = auth.uid();

grant select on asset_transfer_notices to authenticated;


-- ---------------------------------------------------------------------
-- View: ประวัติ — บอกด้วยว่าใครกดให้ และแถวไหนเป็นการโอนไม่ใช่การคืนจริง
-- ---------------------------------------------------------------------
drop view if exists asset_history;
create view asset_history
with (security_invoker = true) as
select
  ai.id                                   as out_item_id,
  ai.asset_code,
  a.type_code,
  ty.name                                 as type_name,
  a.dept_code                             as asset_dept,
  t.id                                    as txn_id,
  t.ref_no,
  t.user_id,
  p.full_name                             as who,
  p.employee_code,
  t.dept_code                             as holder_dept,
  p.sub_dept,
  t.acted_by,
  ap.full_name                            as acted_by_name,
  t.shift_start,
  t.shift_end,
  t.due_at,
  t.created_at                            as taken_at,
  back.created_at                         as returned_at,
  back.ref_no                             as return_ref,
  backp.full_name                         as returned_by,
  coalesce(back.is_transfer, false)       as closed_by_transfer,
  (back.id is null)                       as still_out,
  coalesce((
    select array_agg(ph.file_id order by ph.seq)
    from asset_txn_photos ph where ph.txn_id = t.id
  ), '{}')                                 as out_file_ids,
  coalesce((
    select array_agg(ph.file_id order by ph.seq)
    from asset_txn_photos ph where ph.txn_id = back.id
  ), '{}')                                 as in_file_ids,
  case
    when back.created_at is not null
      then extract(epoch from (back.created_at - t.created_at)) / 3600
  end::numeric(10, 2)                     as held_hours
from asset_txn_items ai
join asset_txns t   on t.id = ai.txn_id and t.kind = 'out'
join assets a       on a.code = ai.asset_code
join asset_types ty on ty.code = a.type_code
join profiles p     on p.id = t.user_id
left join profiles ap               on ap.id = t.acted_by
left join asset_txn_items back_item on back_item.out_item_id = ai.id
left join asset_txns back           on back.id = back_item.txn_id
left join profiles backp            on backp.id = back.user_id;

grant select on asset_history to authenticated;


-- ---------------------------------------------------------------------
-- RLS ของตารางโอน
-- ---------------------------------------------------------------------
alter table asset_transfers enable row level security;

drop policy if exists read_transfers on asset_transfers;
create policy read_transfers on asset_transfers for select to authenticated using (
  my_role() in ('supervisor', 'admin')
  or my_can_dispatch()
  or from_user_id = auth.uid()
  or claimed_by = auth.uid()
  or to_dept = any(my_depts())
  or 'ALL' = any(my_depts())
);

-- เขียนผ่าน RPC เท่านั้น ไม่เปิด insert/update/delete ตรง ๆ ให้ใคร


-- ===== 033_meetings.sql =====
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


-- ===== 034_meeting_delete.sql =====
-- =====================================================================
-- BPL SUPPLY — ลบรายการเช็คอินประชุมถาวร
-- รันต่อจาก 033 · ปลอดภัยที่จะรันซ้ำ
--
-- เดิมออกแบบให้ "ตีตก" แทนการลบ เพื่อเก็บหลักฐานว่าใครตัดสินว่าอะไรปลอม
-- เจ้าของระบบขอให้ลบออกจากหน้าเว็บได้จริง จึงเพิ่มการลบถาวรเข้ามา
-- โดยยังเก็บตัวเลือก "ตีตก" ไว้ทั้งคู่ ให้เลือกใช้ตามสถานการณ์
--
-- ข้อควรรู้ที่ลบไม่ได้
--   รูปใน Google Drive ยังอยู่ ไฟล์นั้นไม่ได้ถูกลบตามไปด้วย
--   แถวที่เคยส่งขึ้น Google Sheet ไปแล้วก็ยังอยู่ในชีต
--   ลบที่นี่คือลบออกจากระบบและหน้าเว็บ ไม่ใช่ลบทุกที่ในโลก
-- =====================================================================

create or replace function delete_meetings(p_ids uuid[])
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if not my_can_audit() then
    raise exception 'บัญชีนี้ลบรายการประชุมไม่ได้';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  -- meeting_sheet_exports ผูก on delete cascade ไว้แล้ว ไม่ต้องลบเอง
  delete from meeting_checkins where id = any(p_ids);

  get diagnostics v_n = row_count;
  return v_n;
end $$;

grant execute on function delete_meetings(uuid[]) to authenticated;


-- ---------------------------------------------------------------------
-- สรุปรายวันสำหรับแดชบอร์ด
--
-- นับที่ฐานข้อมูล ไม่ได้ดึงทุกแถวมานับในเบราว์เซอร์
-- เพราะจำนวนคนกำลังจะเพิ่มเป็นสามเท่า และหน้านี้เปิดบ่อย
-- ---------------------------------------------------------------------
create or replace function meeting_daily(p_from date, p_to date)
returns table (
  day        date,
  confirmed  integer,
  pending    integer,
  rejected   integer,
  total      integer,
  people     integer
)
language sql stable security definer set search_path = public as $$
  select
    (m.created_at at time zone 'Asia/Bangkok')::date as day,
    count(*) filter (where m.status = 'confirmed')::int,
    count(*) filter (where m.status = 'pending')::int,
    count(*) filter (where m.status = 'rejected')::int,
    count(*)::int,
    count(distinct m.user_id)::int
  from meeting_checkins m
  where my_can_audit()
    and (m.created_at at time zone 'Asia/Bangkok')::date between p_from and p_to
  group by 1
  order by 1;
$$;

grant execute on function meeting_daily(date, date) to authenticated;


-- ---------------------------------------------------------------------
-- สรุปรายแผนกสำหรับแดชบอร์ด
-- ---------------------------------------------------------------------
create or replace function meeting_by_dept(p_from date, p_to date)
returns table (
  dept_code  text,
  confirmed  integer,
  total      integer,
  people     integer
)
language sql stable security definer set search_path = public as $$
  select
    coalesce(m.dept_code, 'ไม่ระบุ') as dept_code,
    count(*) filter (where m.status = 'confirmed')::int,
    count(*)::int,
    count(distinct m.user_id)::int
  from meeting_checkins m
  where my_can_audit()
    and (m.created_at at time zone 'Asia/Bangkok')::date between p_from and p_to
  group by 1
  order by 2 desc;
$$;

grant execute on function meeting_by_dept(date, date) to authenticated;


-- =====================================================================
-- นัดประชุม — ประกาศให้ทุกคนรู้ว่าใครต้องเข้า
--
-- ผู้เข้าร่วมเก็บเป็น "ข้อความอิสระ" ไม่ได้ผูกกับตำแหน่งในระบบ
-- เพราะโครงตำแหน่งจริงหน้างาน (sup, lead, ฯลฯ) ไม่ได้มีอยู่ในฐานข้อมูลนี้
-- และถ้าไปสร้างตารางตำแหน่งขึ้นมา ก็ต้องมาคอยอัปเดตทุกครั้งที่คนย้ายงาน
-- พิมพ์เป็นข้อความแล้วประกาศให้ทุกคนอ่าน ตรงกับที่ใช้จริงมากกว่า
--
-- ทุกคนได้รับแจ้งเตือน ไม่ได้ส่งเฉพาะคนที่เกี่ยว
-- เพราะระบบไม่รู้ว่าใครเป็น sup ดังนั้นการ "ไม่ส่ง" จะพลาดคนที่ต้องมา
-- ส่งให้หมดแล้วให้คนอ่านเองว่าเกี่ยวกับตัวไหม ปลอดภัยกว่าเดาแล้วพลาด
-- =====================================================================

create table if not exists meeting_events (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  meet_at      timestamptz not null,
  /** ใครต้องเข้า — ข้อความอิสระ เช่น "sup และ lead ทุกคน" */
  audience     text,
  place        text,
  note         text,
  created_by   uuid not null references profiles(id),
  created_at   timestamptz not null default now(),
  cancelled_at timestamptz
);

create index if not exists meeting_events_at_idx on meeting_events (meet_at desc);

alter table meeting_events enable row level security;

-- ประกาศ ทุกคนที่ล็อกอินต้องเห็น
drop policy if exists read_meeting_events on meeting_events;
create policy read_meeting_events on meeting_events for select to authenticated using (true);

-- นัดและยกเลิกผ่าน RPC เท่านั้น


create or replace function create_meeting_event(
  p_title    text,
  p_meet_at  timestamptz,
  p_audience text default null,
  p_place    text default null,
  p_note     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not my_can_audit() then
    raise exception 'บัญชีนี้นัดประชุมไม่ได้';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'ต้องใส่เรื่องที่จะประชุม';
  end if;
  if p_meet_at is null then
    raise exception 'ต้องเลือกวันและเวลา';
  end if;

  insert into meeting_events (title, meet_at, audience, place, note, created_by)
  values (btrim(p_title), p_meet_at, nullif(btrim(p_audience), ''),
          nullif(btrim(p_place), ''), nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;

  return jsonb_build_object('id', v_id);
end $$;

grant execute on function create_meeting_event(text, timestamptz, text, text, text) to authenticated;


create or replace function cancel_meeting_event(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not my_can_audit() then
    raise exception 'บัญชีนี้ยกเลิกนัดประชุมไม่ได้';
  end if;
  update meeting_events set cancelled_at = now() where id = p_id and cancelled_at is null;
end $$;

grant execute on function cancel_meeting_event(uuid) to authenticated;


create or replace function delete_meeting_event(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not my_can_audit() then
    raise exception 'บัญชีนี้ลบนัดประชุมไม่ได้';
  end if;
  delete from meeting_events where id = p_id;
end $$;

grant execute on function delete_meeting_event(uuid) to authenticated;


drop view if exists meeting_event_rows;
create view meeting_event_rows
with (security_invoker = true) as
select
  e.id,
  e.title,
  e.meet_at,
  e.audience,
  e.place,
  e.note,
  e.created_by,
  p.full_name as created_by_name,
  e.created_at,
  e.cancelled_at,
  (e.meet_at at time zone 'Asia/Bangkok')::date as day
from meeting_events e
join profiles p on p.id = e.created_by;

grant select on meeting_event_rows to authenticated;


-- ---------------------------------------------------------------------
-- แจ้งเตือนนัดประชุม — ต่อท้ายงานเดิมใน push_due_jobs
--
-- สองจังหวะ: ตอนประกาศ และ 30 นาทีก่อนถึงเวลา
-- ส่งให้ทุกคนที่ยังใช้งานอยู่ ไม่ได้เลือกเฉพาะบางตำแหน่ง
-- เพราะระบบไม่รู้ว่าใครเป็น sup หรือ lead การเลือกส่งจึงเสี่ยงพลาดคนที่ต้องมา
-- ---------------------------------------------------------------------
create or replace function push_meeting_jobs()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_jobs jsonb := '[]'::jsonb;
  v_now  timestamptz := now();
begin
  -- ① เพิ่งประกาศ · ส่งครั้งเดียวต่อคน
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'meeting_new',
      'subject', e.id::text,
      'user_id', m.id,
      'title',   'นัดประชุม · ' || e.title,
      'body',    to_char((e.meet_at at time zone 'Asia/Bangkok'), 'DD/MM HH24:MI') ||
                 coalesce(' · ' || e.place, '') ||
                 coalesce(' · ผู้เข้าร่วม: ' || e.audience, ''),
      'url',     '/'
    ))
    from meeting_events e
    cross join (select id from profiles where is_active) m
    where e.cancelled_at is null
      and e.created_at > v_now - interval '1 day'
      and e.meet_at > v_now
      and not exists (
        select 1 from notification_log n
        where n.kind = 'meeting_new' and n.subject = e.id::text and n.user_id = m.id
      )
  ), '[]'::jsonb);

  -- ② ใกล้ถึงเวลา 30 นาที · ส่งครั้งเดียวต่อคน
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'meeting_soon',
      'subject', e.id::text,
      'user_id', m.id,
      'title',   'อีก 30 นาทีถึงเวลาประชุม',
      'body',    e.title || coalesce(' · ' || e.place, '') ||
                 coalesce(' · ผู้เข้าร่วม: ' || e.audience, ''),
      'url',     '/'
    ))
    from meeting_events e
    cross join (select id from profiles where is_active) m
    where e.cancelled_at is null
      and e.meet_at between v_now and v_now + interval '30 minutes'
      and not exists (
        select 1 from notification_log n
        where n.kind = 'meeting_soon' and n.subject = e.id::text and n.user_id = m.id
      )
  ), '[]'::jsonb);

  return v_jobs;
end $$;

grant execute on function push_meeting_jobs() to authenticated, service_role;


-- ---------------------------------------------------------------------
-- ต่อท้ายงานประชุมเข้ากับคิวแจ้งเตือนเดิม
--
-- ย้ายตัวเดิมไปชื่อ push_core_jobs แล้วทำตัวใหม่ที่รวมสองชุดเข้าด้วยกัน
-- ทำแบบนี้เพื่อไม่ต้องก๊อป 200 บรรทัดของตัวเดิมมาวางซ้ำ
-- ซึ่งถ้าก๊อปไว้ วันหลังแก้จังหวะเตือนจะต้องไล่แก้สองที่แล้วลืมที่หนึ่งแน่นอน
--
-- ตัว Edge Function เรียก push_due_jobs เหมือนเดิม ไม่ต้อง deploy ใหม่
-- ---------------------------------------------------------------------
do $$
begin
  -- เปลี่ยนชื่อครั้งเดียวเท่านั้น ถ้ารันไฟล์นี้ซ้ำจะข้ามไป
  -- ไม่งั้นรอบสองจะไปเปลี่ยนชื่อ "ตัวห่อ" แล้วกลายเป็นเรียกตัวเอง
  if not exists (select 1 from pg_proc where proname = 'push_core_jobs') then
    alter function push_due_jobs() rename to push_core_jobs;
  end if;
end $$;

create or replace function push_due_jobs()
returns jsonb
language sql security definer set search_path = public as $$
  select push_core_jobs() || push_meeting_jobs();
$$;

grant execute on function push_due_jobs() to authenticated, service_role;


-- =====================================================================
-- ลบรายการในหน้าหลักฐานการเบิก-คืนถาวร — เฉพาะเจ้าของระบบ
--
-- อันนี้หนักกว่าลบรูปประชุมมาก เพราะลบใบเบิกคือลบประวัติการตัดสต็อกทิ้ง
-- สต็อกจะ "ไม่" ถูกคืนกลับให้ ตัวเลขคงเหลือยังเท่าเดิม
-- แต่หลักฐานว่าของหายไปไหนจะไม่เหลือแล้ว ยอดจึงอธิบายไม่ได้
-- ปุ่มนี้จึงเปิดให้เจ้าของระบบคนเดียว ไม่ใช่แอดมินหรือผู้ตรวจสอบ
--
-- ถ้าเป็นการเบิกเครื่องที่ยังไม่ได้คืน จะไม่ยอมให้ลบ
-- เพราะเครื่องจะหลุดจากรายการค้างโดยไม่มีใครรู้ว่ามันอยู่ไหน
-- ต้องกดคืนให้เรียบร้อยก่อน แล้วค่อยลบประวัติถ้ายังอยากลบ
-- =====================================================================

create or replace function delete_evidence(p_kind text, p_id text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_txn uuid;
begin
  if my_role() <> 'admin' then
    raise exception 'เฉพาะเจ้าของระบบเท่านั้นที่ลบหลักฐานได้';
  end if;

  if p_kind = 'requisition' then
    delete from requisitions where id = p_id::uuid;

  elsif p_kind = 'return' then
    delete from returns where id = p_id::bigint;

  elsif p_kind in ('asset_out', 'asset_in') then
    v_txn := p_id::uuid;

    if exists (
      select 1
      from asset_txn_items ai
      join assets a on a.held_item_id = ai.id
      where ai.txn_id = v_txn
    ) then
      raise exception 'ยังมีเครื่องในรายการนี้ที่ไม่ได้คืน กดคืนให้เรียบร้อยก่อนจึงจะลบได้';
    end if;

    delete from asset_txns where id = v_txn;

  else
    raise exception 'ไม่รู้จักประเภท %', p_kind;
  end if;
end $$;

grant execute on function delete_evidence(text, text) to authenticated;


-- ===== 035_retention.sql =====
-- =====================================================================
-- BPL SUPPLY — ล้างข้อมูลเก่า และแก้การเตือนประชุม
-- รันต่อจาก 034 · ปลอดภัยที่จะรันซ้ำ
--
-- ที่ปริมาณจริงที่คุยกันไว้ (100 คน วันละ 5 ใบ = ~182,000 ใบต่อปี)
-- หนึ่งใบเบิกกินพื้นที่รวมลูกหลานราว 2.3 KB → ~420 MB/ปี
-- โควตาฟรี 500 MB จะเต็มในราว 14 เดือน ถ้าไม่ล้างอะไรเลย
--
--  ①  เอาการเตือนซ้ำก่อนประชุม 30 นาทีออก
--  ②  แก้ FK ของตารางคืน ให้ลบใบเบิกได้จริง
--  ③  ล้าง sync_log ที่เกิน 60 วัน — ตัวกินที่ใหญ่ที่สุด
--  ④  ล้างใบเบิกเก่าที่ส่งขึ้น Google Sheet ครบแล้ว
--  ⑤  ตั้งเวลาให้ทำเองทุกคืน
--  ⑥  ฟังก์ชันดูว่าตอนนี้ใช้พื้นที่ไปเท่าไหร่
-- =====================================================================


-- ---------------------------------------------------------------------
-- ① เตือนประชุมรอบเดียวตอนประกาศ ไม่ต้องย้ำอีก
-- ---------------------------------------------------------------------
create or replace function push_meeting_jobs()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_jobs jsonb := '[]'::jsonb;
  v_now  timestamptz := now();
begin
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'meeting_new',
      'subject', e.id::text,
      'user_id', m.id,
      'title',   'นัดประชุม · ' || e.title,
      'body',    to_char((e.meet_at at time zone 'Asia/Bangkok'), 'DD/MM HH24:MI') ||
                 coalesce(' · ' || e.place, '') ||
                 coalesce(' · ผู้เข้าร่วม: ' || e.audience, ''),
      'url',     '/'
    ))
    from meeting_events e
    cross join (select id from profiles where is_active) m
    where e.cancelled_at is null
      and e.created_at > v_now - interval '1 day'
      and e.meet_at > v_now
      and not exists (
        select 1 from notification_log n
        where n.kind = 'meeting_new' and n.subject = e.id::text and n.user_id = m.id
      )
  ), '[]'::jsonb);

  return v_jobs;
end $$;

grant execute on function push_meeting_jobs() to authenticated, service_role;


-- ---------------------------------------------------------------------
-- ② ลบใบเบิกให้ได้จริง
--
-- returns ชี้ไปที่ requisition_items โดยไม่มี on delete cascade
-- ทำให้ลบใบเบิกที่เคยมีการคืนไม่ได้เลย — ติด FK แล้วขึ้น error ดิบ ๆ
-- ถ้าลบใบเบิกทิ้ง แถวการคืนของใบนั้นก็ไม่มีความหมายอะไรอีกแล้ว ให้ตามไปด้วย
-- (return_photos ผูก cascade กับ returns อยู่แล้ว จึงหลุดตามกันไปเอง)
-- ---------------------------------------------------------------------
do $$
declare
  v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'returns'::regclass
     and confrelid = 'requisition_items'::regclass
     and contype = 'f'
   limit 1;

  if v_name is not null then
    execute format('alter table returns drop constraint %I', v_name);
  end if;

  alter table returns
    add constraint returns_requisition_item_id_fkey
    foreign key (requisition_item_id) references requisition_items(id) on delete cascade;
exception when others then
  raise notice 'ข้ามการแก้ FK ของ returns: %', sqlerrm;
end $$;


-- ---------------------------------------------------------------------
-- ③ ล้าง sync_log เก่า
--
-- แถบสถานะ IMG ✓ GDV ✓ SPB ✓ มีประโยชน์ตอนใบนั้นยังสด
-- ไว้ให้หน้างานแคปหน้าจอถามว่าค้างขั้นไหน พ้นไปสองเดือนไม่มีใครเปิดดูอีก
-- แต่มันคือ 5 แถวต่อใบ แต่ละแถวมีสอง index — กินเกือบครึ่งของพื้นที่ทั้งหมด
-- ---------------------------------------------------------------------
create or replace function prune_sync_log(p_days integer default 60)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  delete from sync_log where updated_at < now() - (p_days || ' days')::interval;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

grant execute on function prune_sync_log(integer) to service_role;


-- ---------------------------------------------------------------------
-- ④ ล้างใบเบิกเก่าที่ขึ้น Google Sheet ครบแล้ว
--
-- Google Sheet คือที่เก็บถาวรจริง ฐานข้อมูลเป็นแค่โต๊ะทำงาน
-- ลบเฉพาะใบที่ "ทุกบรรทัดถูกส่งขึ้นชีตแล้ว" เท่านั้น
-- ใบไหนยังไม่ได้ส่งจะไม่ถูกแตะ ต่อให้เก่าแค่ไหน — ไม่งั้นข้อมูลหายโดยไม่มีที่ไหนเก็บ
--
-- ค่าเริ่มต้น 400 วัน (ราว 13 เดือน) เผื่อให้ย้อนดูข้ามปีได้ก่อน
-- ---------------------------------------------------------------------
create or replace function prune_old_requisitions(p_days integer default 400)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  delete from requisitions r
   where r.created_at < now() - (p_days || ' days')::interval
     and exists (select 1 from requisition_items li where li.requisition_id = r.id)
     -- ทุกบรรทัดต้องมีร่องรอยว่าส่งขึ้นชีตแล้ว
     and not exists (
       select 1
       from requisition_items li
       left join sheet_exports se on se.requisition_item_id = li.id
       where li.requisition_id = r.id
         and li.status <> 'rejected'
         and se.requisition_item_id is null
     );
  get diagnostics v_n = row_count;
  return v_n;
end $$;

grant execute on function prune_old_requisitions(integer) to service_role;


/** ล้างทุกอย่างในรอบเดียว — ตัวที่นาฬิกาเรียก */
create or replace function nightly_cleanup()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sync integer;
  v_req  integer;
begin
  v_sync := prune_sync_log(60);
  v_req  := prune_old_requisitions(400);
  return jsonb_build_object('sync_log', v_sync, 'requisitions', v_req);
end $$;

grant execute on function nightly_cleanup() to service_role;


-- ---------------------------------------------------------------------
-- ⑤ ตั้งเวลาให้ทำเองทุกคืนตีสาม (เวลาไทย = 20:00 UTC)
--
-- ห่อไว้ในตัวจับ error เพราะบางโปรเจกต์เปิด pg_cron ไม่ได้
-- ถ้าตั้งไม่สำเร็จ ไฟล์นี้ต้องไม่ล้มทั้งไฟล์ — เรียก nightly_cleanup() เองก็ได้
-- ---------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('bpl-nightly-cleanup');
exception when others then null;
end $$;

do $$
begin
  perform cron.schedule('bpl-nightly-cleanup', '0 20 * * *', 'select nightly_cleanup()');
  raise notice 'ตั้งเวลาล้างข้อมูลทุกคืนเรียบร้อย';
exception when others then
  raise notice 'ตั้ง pg_cron ไม่ได้ (%) — เรียก select nightly_cleanup(); เองได้', sqlerrm;
end $$;


-- ---------------------------------------------------------------------
-- ⑥ ดูว่าตอนนี้กินพื้นที่ไปเท่าไหร่
--
-- เรียก select * from db_usage(); เพื่อดูตารางที่ใหญ่ที่สุด
-- โควตาฟรีของ Supabase คือ 500 MB
-- ---------------------------------------------------------------------
create or replace function db_usage()
returns table (
  table_name text,
  rows_est   bigint,
  size_mb    numeric
)
language sql stable security definer set search_path = public as $$
  select
    c.relname::text,
    c.reltuples::bigint,
    round((pg_total_relation_size(c.oid) / 1024.0 / 1024.0)::numeric, 2)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and my_role() = 'admin'
  order by pg_total_relation_size(c.oid) desc
  limit 25;
$$;

grant execute on function db_usage() to authenticated;


-- ---------------------------------------------------------------------
-- ⑦ กันกดเบิกซ้ำ
--
-- เช็คอินประชุมกันไว้แล้ว เบิก Asset กันตัวเองอยู่แล้ว (เครื่องถูกยึดไปแล้ว)
-- แต่เบิกสิ้นเปลืองไม่มีอะไรกัน — กดซ้ำได้ใบสองใบและตัดสต็อกสองรอบ
-- ตอนคนน้อยยังไม่เจอ พอหลายสิบคนบนเน็ตที่ไม่นิ่งจะเริ่มเจอ
--
-- ตัวฟังก์ชันยกมาจาก 007 ทั้งดุ้น เติมแค่ด่านตรวจตอนต้น
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

  -- กันกดซ้ำ · เน็ตฮับหลุดกลางคันบ่อย คนกดยืนยันแล้วจอค้างมักกดซ้ำ
  -- ทั้งที่รอบแรกเข้าไปแล้วและตัดสต็อกไปแล้ว รอบสองจะตัดซ้ำอีกชุด
  -- ถ้าคนเดิมส่งรายการชุดเดิมเป๊ะ ๆ ภายในสองนาที ถือว่าเป็นใบเดิม
  -- ไม่ใช่ error เพราะสิ่งที่ผู้ใช้ต้องการคือ 'เบิกแล้ว' ซึ่งเป็นจริง
  select r.id, r.ref_no, r.status into v_req_id, v_ref, v_status
    from requisitions r
   where r.requester_id = v_profile.id
     and r.created_at > now() - interval '2 minutes'
     and (
       select coalesce(jsonb_agg(jsonb_build_object('item_id', li.item_id, 'qty', li.qty_requested)
                                 order by li.item_id), '[]'::jsonb)
       from requisition_items li where li.requisition_id = r.id
     ) = (
       select coalesce(jsonb_agg(jsonb_build_object('item_id', (x->>'item_id')::bigint,
                                                    'qty', (x->>'qty')::int)
                                 order by (x->>'item_id')::bigint), '[]'::jsonb)
       from jsonb_array_elements(p_lines) x
     )
   order by r.created_at desc
   limit 1;

  if v_req_id is not null then
    return jsonb_build_object('ref_no', v_ref, 'id', v_req_id,
                              'status', v_status, 'duplicate', true);
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


-- ===== 036_admin_close.sql =====
-- =====================================================================
-- BPL SUPPLY — ปิดรายการค้างจากหน้าเว็บ
-- รันต่อจาก 035 · ปลอดภัยที่จะรันซ้ำ
--
-- ในแอพคืนแทนได้อยู่แล้ว แต่ต้องถ่ายรูปสภาพตอนคืน
-- ซึ่งใช้ไม่ได้กับสองกรณีที่เกิดจริงบ่อย
--   ① เจ้าตัวกดเบิกผิด ของไม่เคยออกไปไหน จะถ่ายรูปอะไรก็ไม่มี
--   ② ของกลับเข้าคลังแล้วแต่ลืมกดคืน กว่าจะรู้ตัวก็ผ่านไปหลายวัน
--
-- ทั้งสองกรณีต้องปิดได้จากหน้าเว็บโดยไม่ต้องมีรูป
-- แต่ต้องรู้ว่าใครเป็นคนปิดและปิดด้วยเหตุผลอะไร ไม่งั้นยอดจะอธิบายไม่ได้
-- =====================================================================

-- เหตุผลที่แอดมินปิดให้ · ว่าง = คืนตามปกติโดยเจ้าตัว
alter table returns add column if not exists admin_note text;

-- แถวคืนที่แอดมินกดปิดให้ ไม่ใช่การคืนที่มีรูปจริง
alter table asset_txns add column if not exists is_forced boolean not null default false;

comment on column asset_txns.is_forced is
  'แอดมินปิดรายการให้โดยไม่มีรูป · แยกจากการคืนจริงเวลาทำสถิติ';


-- ---------------------------------------------------------------------
-- ① สิ้นเปลือง — ปิดรายการค้างให้ พร้อมคืนสต็อก
--
-- เดินทางเดียวกับการคืนปกติทุกอย่าง ยกเว้นไม่บังคับรูป
-- สต็อกถูกบวกกลับและลง stock_movements เหมือนกัน
-- ไม่งั้นของจะหายจากรายการค้างแต่ยอดคงเหลือไม่ขยับ ซึ่งแย่กว่าปล่อยค้างไว้
-- ---------------------------------------------------------------------
create or replace function admin_close_borrow(
  p_line_id bigint,
  p_qty     integer default null,
  p_note    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor    profiles%rowtype;
  v_line     requisition_items%rowtype;
  v_item     items%rowtype;
  v_returned integer;
  v_open     integer;
  v_qty      integer;
  v_after    integer;
  v_id       bigint;
begin
  select * into v_actor from profiles where id = auth.uid();
  if v_actor.id is null or not my_can_proxy() then
    raise exception 'บัญชีนี้ปิดรายการค้างแทนคนอื่นไม่ได้';
  end if;

  select * into v_line from requisition_items where id = p_line_id;
  if not found then
    raise exception 'ไม่พบบรรทัดรายการ';
  end if;

  select coalesce(sum(qty), 0) into v_returned from returns where requisition_item_id = p_line_id;
  v_open := coalesce(v_line.qty_approved, 0) - v_returned;
  if v_open <= 0 then
    raise exception 'รายการนี้ไม่มีของค้างแล้ว';
  end if;

  v_qty := coalesce(p_qty, v_open);
  if v_qty <= 0 or v_qty > v_open then
    raise exception 'จำนวนไม่ถูกต้อง · ค้างอยู่ % ชิ้น', v_open;
  end if;

  insert into returns (requisition_item_id, returned_by, qty, condition, admin_note)
  values (p_line_id, v_actor.id, v_qty, 'ok', coalesce(nullif(btrim(p_note), ''), 'ปิดโดยแอดมิน'))
  returning id into v_id;

  select * into v_item from items where id = v_line.item_id for update;
  v_after := v_item.qty_on_hand + v_qty;
  update items set qty_on_hand = v_after, updated_at = now() where id = v_item.id;
  insert into stock_movements (item_id, delta, qty_after, reason, ref_type, ref_id, actor_id)
    values (v_item.id, v_qty, v_after, 'return', 'return', v_id::text, v_actor.id);

  return jsonb_build_object('id', v_id, 'qty', v_qty, 'qty_after', v_after);
end $$;

grant execute on function admin_close_borrow(bigint, integer, text) to authenticated;


-- ---------------------------------------------------------------------
-- ② Asset — ปิดรายการค้างให้ โดยไม่ต้องมีรูป
--
-- ใช้เมื่อของกลับเข้าคลังแล้วจริง แต่เจ้าตัวลืมกดคืน
-- บันทึกเป็นการคืนตามปกติ แต่ติดธง is_forced ไว้ให้รู้ว่าไม่มีรูปประกอบ
-- ---------------------------------------------------------------------
create or replace function admin_release_asset(
  p_out_item_id bigint,
  p_note        text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor profiles%rowtype;
  v_code  text;
  v_type  text;
  v_owner uuid;
  v_txn   uuid;
  v_ref   text;
begin
  select * into v_actor from profiles where id = auth.uid();
  if v_actor.id is null or not my_can_proxy() then
    raise exception 'บัญชีนี้ปิดรายการค้างแทนคนอื่นไม่ได้';
  end if;

  select ai.asset_code, a.type_code, t.user_id
    into v_code, v_type, v_owner
    from asset_txn_items ai
    join assets a     on a.code = ai.asset_code
    join asset_txns t on t.id = ai.txn_id
   where ai.id = p_out_item_id;

  if v_code is null then
    raise exception 'ไม่พบรายการเบิกนี้';
  end if;
  if not exists (select 1 from assets where code = v_code and held_item_id = p_out_item_id) then
    raise exception 'เครื่อง % ถูกคืนไปแล้ว', v_code;
  end if;

  perform 1 from assets where code = v_code for update;

  v_ref := next_asset_ref('in');
  insert into asset_txns (ref_no, kind, type_code, user_id, acted_by, dept_code, is_forced, note)
  values (v_ref, 'in', v_type, v_owner, v_actor.id, v_actor.dept_code, true,
          coalesce(nullif(btrim(p_note), ''), 'ปิดโดยแอดมิน ไม่มีรูปประกอบ'))
  returning id into v_txn;

  insert into asset_txn_items (txn_id, asset_code, out_item_id)
  values (v_txn, v_code, p_out_item_id);

  -- คืนเข้าระบบแล้ว เครื่องกลับไปอยู่กับแผนกเจ้าของตามเดิม
  update assets set held_item_id = null, loan_dept = null where code = v_code;

  return jsonb_build_object('ref_no', v_ref, 'asset_code', v_code);
end $$;

grant execute on function admin_release_asset(bigint, text) to authenticated;


-- ---------------------------------------------------------------------
-- ③ Asset — ยกเลิกรายการที่กดเบิกผิด
--
-- ต่างจากข้อ ② ตรงที่ไม่ได้บันทึกว่ามีการคืน เพราะของไม่เคยออกไปไหน
-- ถ้าไปบันทึกเป็นการคืน ประวัติจะโกหกว่าเครื่องเคยถูกเอาออกไปใช้แล้วเอากลับมา
-- จึงลบแถวการเบิกนั้นทิ้ง และถ้าใบนั้นไม่เหลือเครื่องอื่นก็ลบทั้งใบ
-- ---------------------------------------------------------------------
create or replace function admin_cancel_asset_out(p_out_item_id bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor profiles%rowtype;
  v_code  text;
  v_txn   uuid;
  v_left  integer;
begin
  select * into v_actor from profiles where id = auth.uid();
  if v_actor.id is null or v_actor.role not in ('supervisor', 'admin') then
    raise exception 'เฉพาะแอดมินและเจ้าของระบบเท่านั้นที่ยกเลิกรายการได้';
  end if;

  select ai.asset_code, ai.txn_id into v_code, v_txn
    from asset_txn_items ai where ai.id = p_out_item_id;
  if v_code is null then
    raise exception 'ไม่พบรายการเบิกนี้';
  end if;

  if exists (select 1 from asset_txn_items r where r.out_item_id = p_out_item_id) then
    raise exception 'รายการนี้ถูกคืนไปแล้ว ยกเลิกไม่ได้';
  end if;

  perform 1 from assets where code = v_code for update;

  update assets set held_item_id = null where code = v_code and held_item_id = p_out_item_id;
  delete from asset_txn_items where id = p_out_item_id;

  select count(*) into v_left from asset_txn_items where txn_id = v_txn;
  if v_left = 0 then
    delete from asset_txns where id = v_txn;
  end if;

  return jsonb_build_object('asset_code', v_code, 'txn_removed', v_left = 0);
end $$;

grant execute on function admin_cancel_asset_out(bigint) to authenticated;


-- ---------------------------------------------------------------------
-- ④ เปิดให้ผู้ตรวจสอบคืนแทนคนอื่นได้
--
-- ตอนออกแบบครั้งแรกกันไว้ ด้วยเหตุผลว่าคนคืนควรถือของอยู่จริงถึงจะถ่ายรูปได้
-- เจ้าของระบบยืนยันว่าหน้างานต้องการให้ผู้ตรวจสอบช่วยคืนแทนได้ จึงเปิดให้
-- ส่วนการลบทิ้งยังเป็นของแอดมินกับเจ้าของระบบเหมือนเดิม เพราะลบแล้วประวัติหาย
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
  v_actor  uuid := null;
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
    if v_owner <> v_me.id then
      -- แอดมิน เจ้าของระบบ และผู้ตรวจสอบ คืนแทนคนอื่นได้
      if not my_can_proxy() then
        raise exception 'เครื่อง % ไม่ได้เบิกโดยคุณ', v_code;
      end if;
      v_actor := v_me.id;
    end if;

    insert into asset_txn_items (txn_id, asset_code, out_item_id)
    values (v_txn, v_code, v_out);

    update assets set held_item_id = null, loan_dept = null where code = v_code;
  end loop;

  if v_actor is not null then
    update asset_txns set acted_by = v_actor where id = v_txn;
  end if;

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


-- ===== 037_push_auth_header.sql =====
-- =====================================================================
-- BPL SUPPLY — แก้นาฬิกาแจ้งเตือนที่ยิงไม่ถึงปลายทาง
-- รันต่อจาก 036 · ปลอดภัยที่จะรันซ้ำ
--
-- อาการ: cron เดินทุก 5 นาทีและรายงานว่าสำเร็จ แต่ไม่มีแจ้งเตือนออกเลย
-- สาเหตุ: คำขอที่ยิงออกไปมีแต่ x-cron-key ไม่มี Authorization
--         ประตูของ Supabase ปฏิเสธตั้งแต่หน้าประตูด้วย
--           401 UNAUTHORIZED_NO_AUTH_HEADER
--         โค้ดของเราไม่เคยถูกเรียกเลยสักครั้ง
--
-- ที่มองไม่เห็นมานาน เพราะ net.http_post เป็นแบบยิงแล้วไม่รอคำตอบ
-- cron จึงได้ผลว่า "สำเร็จ" เสมอ ไม่ว่าปลายทางจะตอบอะไรกลับมา
-- ต้องไปเปิดดูที่ net._http_response ถึงจะเห็นว่าโดน 401
--
-- แก้โดยแนบ publishable key ไปด้วย (คีย์ตัวนี้อยู่ในหน้าเว็บอยู่แล้ว ไม่ใช่ความลับ)
-- ส่วน x-cron-key ยังเป็นตัวกันคนนอกเหมือนเดิม
-- =====================================================================

-- เก็บคีย์ไว้ที่เดียวกับค่าอื่น ๆ ของนาฬิกา
insert into private_settings (key, value)
values ('push_anon_key', 'sb_publishable_wWWyZ7qFBu6SR5gGLFbcCw_RCsxvgTk')
on conflict (key) do update set value = excluded.value;

create or replace function push_tick()
returns void
language plpgsql security definer set search_path = public, extensions as $fn$
declare
  v_url  text;
  v_key  text;
  v_anon text;
begin
  select value into v_url  from private_settings where key = 'push_url';
  select value into v_key  from private_settings where key = 'push_cron_secret';
  select value into v_anon from private_settings where key = 'push_anon_key';

  if v_url is null or v_key is null or v_anon is null then
    raise notice 'push_tick: ยังตั้งค่าไม่ครบ (url/secret/anon)';
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      -- ต้องมีตัวนี้ ไม่งั้นไม่ผ่านประตูของ Supabase
      'Authorization', 'Bearer ' || v_anon,
      -- ตัวนี้คือด่านจริงที่โค้ดเราตรวจเอง
      'x-cron-key',    v_key
    ),
    body    := jsonb_build_object('action', 'run'),
    timeout_milliseconds := 20000
  );
end $fn$;

grant execute on function push_tick() to service_role;


-- ---------------------------------------------------------------------
-- ดูสุขภาพนาฬิกาและการยิงล่าสุด — ไว้ตรวจเองทีหลัง
--   select * from cron_health();
--   select * from push_health();
-- ---------------------------------------------------------------------
create or replace function cron_health()
returns table (
  jobname     text,
  schedule    text,
  active      boolean,
  command     text,
  last_status text,
  last_msg    text,
  last_at     timestamptz
)
language sql stable security definer set search_path = public, cron as $fn$
  select j.jobname::text, j.schedule::text, j.active, j.command::text,
         d.status::text, d.return_message::text, d.start_time
  from cron.job j
  left join lateral (
    select r.status, r.return_message, r.start_time
    from cron.job_run_details r
    where r.jobid = j.jobid
    order by r.start_time desc
    limit 1
  ) d on true
  where my_role() = 'admin';
$fn$;

grant execute on function cron_health() to authenticated;


create or replace function push_health()
returns table (
  push_url        text,
  has_secret      boolean,
  last_http_at    timestamptz,
  last_http_code  integer,
  last_http_body  text
)
language sql stable security definer set search_path = public, net, extensions as $fn$
  select
    (select value from private_settings where key = 'push_url'),
    (select value is not null from private_settings where key = 'push_cron_secret'),
    r.created,
    r.status_code,
    left(coalesce(r.content, r.error_msg, ''), 300)
  from (
    select created, status_code, content, error_msg
    from net._http_response
    order by created desc
    limit 1
  ) r
  where my_role() = 'admin';
$fn$;

grant execute on function push_health() to authenticated;


-- ยิงทันทีหนึ่งรอบ ไม่ต้องรอนาฬิกา
select push_tick();


-- ===== 038_announce_now.sql =====
-- =====================================================================
-- BPL SUPPLY — ประกาศนัดประชุมแล้วแจ้งเตือนออกทันที
-- รันต่อจาก 037 · ปลอดภัยที่จะรันซ้ำ
--
-- เดิมทุกอย่างรอนาฬิกาที่เดินทุก 5 นาที ซึ่งพอดีกับงานที่รอได้
-- อย่างของใกล้หมดหรือของค้างคืน แต่ไม่พอดีกับการประกาศ
--
-- คนกดปุ่ม "ประกาศและแจ้งเตือนทุกคน" แล้วคาดว่าจะออกเดี๋ยวนั้น
-- พอเงียบไปสี่นาทีก็สรุปว่าพัง ทั้งที่แค่ยังไม่ถึงรอบ
-- (ของจริงที่เจอ: ประกาศตอน 11:55:47 นาฬิกาเพิ่งเดินไปตอน 11:55:00)
--
-- แก้โดยให้ตอนสร้างนัดเสร็จ เตะนาฬิกาหนึ่งทีเลยไม่ต้องรอ
-- งานอื่นยังเดินตามรอบเหมือนเดิม
-- =====================================================================

create or replace function create_meeting_event(
  p_title    text,
  p_meet_at  timestamptz,
  p_audience text default null,
  p_place    text default null,
  p_note     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_id uuid;
begin
  if not my_can_audit() then
    raise exception 'บัญชีนี้นัดประชุมไม่ได้';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'ต้องใส่เรื่องที่จะประชุม';
  end if;
  if p_meet_at is null then
    raise exception 'ต้องเลือกวันและเวลา';
  end if;

  insert into meeting_events (title, meet_at, audience, place, note, created_by)
  values (btrim(p_title), p_meet_at, nullif(btrim(p_audience), ''),
          nullif(btrim(p_place), ''), nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;

  -- เตะนาฬิกาทันที ไม่ต้องรอรอบถัดไป
  -- ถ้าเตะไม่สำเร็จก็ไม่ให้ล้มการสร้างนัด เดี๋ยวรอบปกติเก็บให้อยู่ดี
  begin
    perform push_tick();
  exception when others then
    raise notice 'ประกาศแล้วแต่เตะแจ้งเตือนไม่สำเร็จ (%) เดี๋ยวรอบถัดไปจะส่งให้เอง', sqlerrm;
  end;

  return jsonb_build_object('id', v_id);
end $fn$;

grant execute on function create_meeting_event(text, timestamptz, text, text, text) to authenticated;
-- =====================================================================
-- BPL SUPPLY — ผู้ตรวจสอบต้องเห็นของที่ยังไม่คืน
-- รันต่อจาก 038 · ปลอดภัยที่จะรันซ้ำ
--
-- อาการ: ผู้ตรวจสอบเปิดหน้า "Asset ที่ยังไม่คืน" แล้วว่างเปล่า
--        ทั้งที่มีคนเบิกออกไปจริง และปุ่มโอนเครื่องก็เลยกดไม่ได้
--
-- สาเหตุ: 032 เปิดให้ผู้ตรวจสอบเห็น "ตัวเครื่อง" (assets) แล้ว
--        แต่ลืมเปิด "รายการเบิก" (asset_txns / asset_txn_items)
--        วิว asset_holdings เป็น security_invoker และต้อง join สองตารางนั้น
--        พอ join ไม่ติดสักแถว วิวจึงคืนค่าว่างโดยไม่มี error ให้เห็น
--
-- ฝั่งวัสดุสิ้นเปลืองเป็นคนละอาการแต่รากเดียวกัน:
--        open_borrowings อ่าน returns ผ่าน lateral เพื่อหักยอดที่คืนแล้ว
--        ผู้ตรวจสอบอ่าน returns ไม่ได้ ผลรวมจึงเป็น 0 เสมอ
--        แถวที่คืนครบแล้วจะยังโผล่ว่าค้างอยู่ — ผิดแบบเงียบ ๆ อันตรายกว่าว่างเปล่า
-- =====================================================================

-- ── Asset ─────────────────────────────────────────────────────────────
-- อ่านได้อย่างเดียว การเขียนยังเป็นของ supervisor/admin เหมือนเดิม
drop policy if exists read_asset_txns on asset_txns;
create policy read_asset_txns on asset_txns for select to authenticated
  using (user_id = auth.uid() or my_can_proxy());

drop policy if exists read_asset_txn_items on asset_txn_items;
create policy read_asset_txn_items on asset_txn_items for select to authenticated using (
  my_can_proxy()
  or exists (select 1 from asset_txns t where t.id = txn_id and t.user_id = auth.uid())
);

-- รูปสภาพเครื่อง — ผู้ตรวจสอบต้องเปิดดูได้ เพราะหน้าที่คือตรวจ
-- หน้างานยังเปิดไม่ได้ ตามกติกาข้อ 4 ของโปรเจกต์
drop policy if exists read_asset_photos on asset_txn_photos;
create policy read_asset_photos on asset_txn_photos for select to authenticated
  using (my_role() in ('supervisor', 'admin') or my_can_dispatch());

-- ── วัสดุสิ้นเปลือง ───────────────────────────────────────────────────
-- เพิ่มสิทธิ์อ่านอย่างเดียวซ้อนเข้าไป ไม่แตะ rw_returns เดิม
-- เพราะ rw_returns เป็น for all การแก้ using จะพลอยเปิดสิทธิ์ลบให้ด้วย
drop policy if exists read_returns_audit on returns;
create policy read_returns_audit on returns for select to authenticated
  using (my_can_dispatch());

-- ใบแจ้งชำรุดของ Asset ผูกกับรายการเบิก ต้องตามดูได้ด้วย
drop policy if exists read_asset_issues_audit on asset_issues;
create policy read_asset_issues_audit on asset_issues for select to authenticated
  using (true);


-- ---------------------------------------------------------------------
-- ตรวจผล — รันด้วยบัญชีผู้ตรวจสอบแล้วต้องได้เลขเท่ากับที่แอดมินเห็น
-- ---------------------------------------------------------------------
select 'เครื่องที่ยังไม่คืน' as รายการ, count(*) as จำนวน from asset_holdings
union all select 'วัสดุยืม-คืนที่ค้าง', count(*) from open_borrowings;
-- =====================================================================
-- BPL SUPPLY — คืนแทนและโอนทีละหลายเครื่อง ไม่จำกัดประเภท
-- รันต่อจาก 039 · ปลอดภัยที่จะรันซ้ำ
--
-- สามข้อที่เจ้าของระบบสั่ง
--   1. คืนแทนกี่เครื่องก็ได้ ไม่ต้องเป็นของคนเดียวกันหรือประเภทเดียวกัน
--   2. โอนกี่เครื่องก็ได้ในครั้งเดียว
--   3. คืนแทนไม่บังคับถ่ายรูป · จะถ่ายกี่ใบก็ได้ไม่จำกัด
--      เพราะคนที่คืนแทนได้คือแอดมิน เจ้าของระบบ และผู้ตรวจสอบ ถือว่ามีอำนาจสูงพอ
--
-- ข้อ 3 ยกเว้นเฉพาะ "คืนแทน" เท่านั้น
-- ถ้าคนคนนั้นคืนเครื่องของตัวเอง ยังต้องถ่ายครบตามขั้นตอนเหมือนทุกคน
-- ไม่งั้นตำแหน่งจะกลายเป็นช่องทางเลี่ยงการถ่ายรูปของตัวเอง
--
-- เรื่องที่ต้องระวังตอนคืนหลายประเภทพร้อมกัน
--   asset_txns เก็บ type_code ได้ช่องเดียว ของเดิมใช้ประเภทของเครื่องแรก
--   พอปนประเภทกัน ใบคืนจะถูกนับเข้าประเภทที่ไม่เกี่ยวเลย รายงานจะเพี้ยน
--   จึงแยกใบตามประเภท ปนกันมากี่ประเภทก็ออกมากี่ใบ
--   รูปกับเหตุผลติดไปทุกใบ เพราะเป็นหลักฐานของการส่งมอบครั้งเดียวกัน
-- =====================================================================

-- ---------------------------------------------------------------------
-- RPC: คืนเครื่อง — รับได้หลายคน หลายประเภท ในครั้งเดียว
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
  v_proxy  boolean := false;
  v_type   text;
  v_txn    uuid;
  v_ref    text;
  v_code   text;
  v_out    bigint;
  v_owner  uuid;
  v_min    int;
  v_steps  int;
  v_photos int := coalesce(jsonb_array_length(p_photos), 0);
  v_refs   text[] := '{}';
  v_first  uuid := null;
  v_n      int := 0;
  r        jsonb;
begin
  select * into v_me from profiles where id = auth.uid();
  if v_me.id is null or not v_me.is_active then
    raise exception 'บัญชีนี้ใช้งานไม่ได้';
  end if;

  if p_codes is null or array_length(p_codes, 1) is null then
    raise exception 'ยังไม่ได้เลือกเครื่องที่จะคืน';
  end if;

  -- ── รอบแรก: ล็อกทุกแถว ตรวจว่าคืนได้จริง และดูว่าเป็นการคืนแทนหรือไม่ ──
  -- ต้องรู้ให้ครบก่อนตัดสินเรื่องรูป ไม่งั้นจะไปรู้เอาตอนเขียนไปครึ่งทางแล้ว
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

    if v_owner <> v_me.id then
      if not my_can_proxy() then
        raise exception 'เครื่อง % ไม่ได้เบิกโดยคุณ', v_code;
      end if;
      v_proxy := true;
    end if;
  end loop;

  -- ── รูป ── บังคับเฉพาะตอนคืนของตัวเอง
  if not v_proxy then
    select a.type_code into v_type from assets a where a.code = p_codes[1];
    select count(*) into v_steps from asset_photo_steps where type_code = v_type;
    select photo_min into v_min from asset_types where code = v_type;
    if v_steps > 0 then v_min := v_steps; end if;
    if v_photos < coalesce(v_min, 1) then
      raise exception 'ต้องถ่ายรูปสภาพตอนคืนให้ครบ % ใบก่อน (ถ่ายมาแล้ว % ใบ)',
        coalesce(v_min, 1), v_photos;
    end if;
  end if;

  -- ── รอบสอง: ออกใบคืนทีละประเภท ──
  for v_type in
    select distinct a.type_code
      from assets a
     where a.code = any(p_codes)
     order by 1
  loop
    v_ref := next_asset_ref('in');
    insert into asset_txns (ref_no, kind, type_code, user_id, acted_by, dept_code,
                            shift_start, shift_end, note)
    values (v_ref, 'in', v_type, v_me.id,
            case when v_proxy then v_me.id else null end,
            v_me.dept_code, v_me.shift_start, v_me.shift_end, p_note)
    returning id into v_txn;

    v_refs := v_refs || v_ref;
    if v_first is null then v_first := v_txn; end if;

    for v_code in
      select a.code from assets a where a.code = any(p_codes) and a.type_code = v_type
    loop
      insert into asset_txn_items (txn_id, asset_code, out_item_id)
      select v_txn, v_code, a.held_item_id from assets a where a.code = v_code;

      update assets set held_item_id = null, loan_dept = null where code = v_code;
      v_n := v_n + 1;
    end loop;

    -- รูปเดียวกันติดทุกใบ เป็นหลักฐานของการส่งมอบครั้งเดียวกัน
    -- ไม่ได้เปลืองที่เก็บ เพราะชี้ไปที่ไฟล์ใน Drive ใบเดิม
    for r in select * from jsonb_array_elements(p_photos) loop
      insert into asset_txn_photos (txn_id, seq, label, file_id, web_link, bytes)
      values (v_txn,
              coalesce((r->>'seq')::int, 1),
              r->>'label',
              r->>'file_id',
              r->>'web_link',
              (r->>'bytes')::int);
    end loop;

    -- อาการชำรุดเข้าใบของประเภทตัวเอง ไม่ใช่ใบแรกเสมอไป
    for r in
      select e.value
        from jsonb_array_elements(p_issues) e
        join assets a on a.code = e.value->>'asset_code'
       where a.type_code = v_type
    loop
      insert into asset_issues (asset_code, txn_id, phase, symptom, reported_by, file_id, web_link)
      values (r->>'asset_code', v_txn, 'in', r->>'symptom', v_me.id,
              r->>'file_id', r->>'web_link');
    end loop;
  end loop;

  return jsonb_build_object(
    'id', v_first,
    'ref_no', array_to_string(v_refs, ' · '),
    'refs', to_jsonb(v_refs),
    'count', v_n
  );
end $$;

grant execute on function asset_return(text[], jsonb, jsonb, text) to authenticated;


-- ---------------------------------------------------------------------
-- RPC: โอนหลายเครื่องให้แผนกเดียวกันในครั้งเดียว
--
-- เครื่องที่อยู่กับแผนกปลายทางอยู่แล้วจะถูกข้าม ไม่ทำให้ทั้งชุดล้ม
-- เพราะคนกดเลือกมาสิบเครื่องแล้วล้มเพราะเครื่องเดียวคือการทำงานซ้ำฟรี ๆ
-- แต่ถ้าพังด้วยเหตุอื่น ทั้งชุดต้องย้อนกลับ จะได้ไม่ค้างครึ่ง ๆ กลาง ๆ
-- ---------------------------------------------------------------------
create or replace function asset_transfer_many(
  p_codes   text[],
  p_to_dept text,
  p_reason  text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_code    text;
  v_done    text[] := '{}';
  v_skipped text[] := '{}';
  v_here    text;
begin
  if not my_can_proxy() then
    raise exception 'บัญชีนี้โอนเครื่องไม่ได้';
  end if;

  if p_codes is null or array_length(p_codes, 1) is null then
    raise exception 'ยังไม่ได้เลือกเครื่องที่จะโอน';
  end if;

  foreach v_code in array p_codes loop
    select coalesce(a.loan_dept, a.dept_code) into v_here from assets a where a.code = v_code;

    if v_here is not distinct from p_to_dept then
      v_skipped := v_skipped || v_code;
    else
      perform asset_transfer(v_code, p_to_dept, p_reason);
      v_done := v_done || v_code;
    end if;
  end loop;

  if array_length(v_done, 1) is null then
    raise exception 'ทุกเครื่องที่เลือกอยู่กับแผนกนี้อยู่แล้ว';
  end if;

  return jsonb_build_object(
    'to_dept', p_to_dept,
    'moved', to_jsonb(v_done),
    'skipped', to_jsonb(v_skipped),
    'count', array_length(v_done, 1)
  );
end $$;

grant execute on function asset_transfer_many(text[], text, text) to authenticated;
-- ---------------------------------------------------------------------
-- View: ประวัติรายเครื่อง — บอกให้ชัดว่าใครปิดรายการ และปิดด้วยวิธีไหน
--
-- ของเดิมอ่าน "คนคืน" จาก user_id ของใบคืน ซึ่งสองเส้นทางใส่ค่าไม่เหมือนกัน
--   คืนแทนผ่าน asset_return      user_id = คนกดคืน  → ขึ้นชื่อแอดมิน ถูกต้อง
--   ปิดรายการผ่าน admin_release  user_id = คนเบิก   → ขึ้นชื่อเจ้าตัว ทั้งที่เจ้าตัวไม่ได้กด
--
-- อย่างหลังคือประวัติที่โกหก และเป็นเคสที่ต้องตรวจสอบย้อนหลังบ่อยที่สุด
-- จึงอ่านจาก acted_by ก่อนเสมอ แล้วค่อยตกไปที่ user_id
-- พร้อมเปิดธงบอกวิธีปิด และข้อความเหตุผลที่คนกดพิมพ์ไว้
-- ---------------------------------------------------------------------
drop view if exists asset_history;
create view asset_history
with (security_invoker = true) as
select
  ai.id                                   as out_item_id,
  ai.asset_code,
  a.type_code,
  ty.name                                 as type_name,
  a.dept_code                             as asset_dept,
  t.id                                    as txn_id,
  t.ref_no,
  t.user_id,
  p.full_name                             as who,
  p.employee_code,
  t.dept_code                             as holder_dept,
  p.sub_dept,
  t.acted_by,
  ap.full_name                            as acted_by_name,
  t.shift_start,
  t.shift_end,
  t.due_at,
  t.created_at                            as taken_at,
  back.created_at                         as returned_at,
  back.ref_no                             as return_ref,
  -- คนที่กดปิดจริง ๆ ไม่ใช่คนที่ชื่ออยู่บนใบ
  coalesce(backa.full_name, backp.full_name) as returned_by,
  (back.acted_by is not null)             as returned_by_proxy,
  coalesce(back.is_transfer, false)       as closed_by_transfer,
  coalesce(back.is_forced, false)         as closed_forced,
  back.note                               as return_note,
  (back.id is null)                       as still_out,
  coalesce((
    select array_agg(ph.file_id order by ph.seq)
    from asset_txn_photos ph where ph.txn_id = t.id
  ), '{}')                                 as out_file_ids,
  coalesce((
    select array_agg(ph.file_id order by ph.seq)
    from asset_txn_photos ph where ph.txn_id = back.id
  ), '{}')                                 as in_file_ids,
  case
    when back.created_at is not null
      then extract(epoch from (back.created_at - t.created_at)) / 3600
  end::numeric(10, 2)                     as held_hours
from asset_txn_items ai
join asset_txns t   on t.id = ai.txn_id and t.kind = 'out'
join assets a       on a.code = ai.asset_code
join asset_types ty on ty.code = a.type_code
join profiles p     on p.id = t.user_id
left join profiles ap               on ap.id = t.acted_by
left join asset_txn_items back_item on back_item.out_item_id = ai.id
left join asset_txns back           on back.id = back_item.txn_id
left join profiles backp            on backp.id = back.user_id
left join profiles backa            on backa.id = back.acted_by;

grant select on asset_history to authenticated;
-- =====================================================================
-- BPL SUPPLY — โอนเครื่องให้ "คน" ไม่ใช่ "แผนก"
-- รันต่อจาก 040 · ปลอดภัยที่จะรันซ้ำ
--
-- เหตุผลจากเจ้าของระบบ: ยังไงเครื่องก็เข้าแผนกของคนนั้นอยู่แล้ว
-- การให้เลือกแผนกจึงเป็นการถามซ้ำในสิ่งที่รู้อยู่แล้ว
-- และเวลาโอนจริงหน้างาน คนกดคิดเป็นชื่อคนว่า "ให้พี่คนนั้นไปใช้ก่อน"
-- ไม่ได้คิดเป็นรหัสแผนก
--
-- ผลพลอยได้ที่สำคัญกว่า: ของเดิมโอนให้แผนกแปลว่าทุกคนในแผนกนั้นเห็นและแย่งกดเบิกได้
-- ตอนนี้เห็นคนเดียวคือคนที่ถูกระบุชื่อ ตรงกับเจตนา "ตัดไปให้คนนี้ใช้ชั่วคราว"
--
-- loan_dept ยังอยู่ในตารางแต่เลิกใช้แล้ว ไม่ลบทิ้งเพราะแถวเก่ายังอ้างถึง
-- ของใหม่จะเซ็ตเป็นว่างเสมอ
-- =====================================================================

-- ── โครงสร้าง ─────────────────────────────────────────────────────────
alter table assets add column if not exists loan_user uuid references profiles(id);

comment on column assets.loan_user is
  'คนที่ได้รับเครื่องมาใช้ชั่วคราวจากการโอน · ว่าง = ไม่ได้ถูกโอนอยู่';

create index if not exists assets_loan_user_idx on assets (loan_user) where loan_user is not null;

alter table asset_transfers add column if not exists to_user_id uuid references profiles(id);
-- แถวเก่าโอนเป็นแผนก แถวใหม่โอนเป็นคน คอลัมน์เดิมจึงต้องยอมให้ว่างได้
alter table asset_transfers alter column to_dept drop not null;

create index if not exists asset_transfers_touser_idx
  on asset_transfers (to_user_id) where claimed_at is null;


-- ── ใครเห็นเครื่องไหน ─────────────────────────────────────────────────
drop policy if exists read_assets on assets;
create policy read_assets on assets for select to authenticated using (
  my_role() in ('supervisor', 'admin')
  or my_can_dispatch()
  -- คนที่ถืออยู่ต้องเห็นเสมอ ไม่งั้นคืนไม่ได้
  or exists (
    select 1
    from asset_txn_items ai
    join asset_txns t on t.id = ai.txn_id
    where ai.id = assets.held_item_id and t.user_id = auth.uid()
  )
  or (
    my_can_assets()
    and (
      dept_code is null
      or dept_code = 'ALL'
      or 'ALL' = any(my_depts())
      or dept_code = any(my_depts())
      or share_depts && my_depts()
      -- เครื่องที่ถูกโอนมาให้เราคนเดียว
      or loan_user = auth.uid()
    )
  )
);


-- ---------------------------------------------------------------------
-- รายชื่อคนที่รับโอนได้
--
-- ต่างจาก proxy_targets ตรงที่กรองคนที่เบิก Asset ไม่ได้ออก
-- โอนไปให้คนที่กดเบิกไม่ได้ = เครื่องค้างเติ่งไม่มีใครรับ
-- ---------------------------------------------------------------------
create or replace function transfer_targets(p_q text default null)
returns table (
  id            uuid,
  employee_code text,
  full_name     text,
  dept_code     text,
  sub_dept      text
)
language sql stable security definer set search_path = public as $$
  select p.id, p.employee_code, p.full_name, p.dept_code, p.sub_dept
  from profiles p
  where my_can_proxy()
    and p.is_active
    and (p.role in ('supervisor', 'admin') or p.can_assets)
    and (
      p_q is null or p_q = ''
      or p.full_name     ilike '%' || p_q || '%'
      or p.employee_code ilike '%' || p_q || '%'
      or coalesce(p.dept_code, '') ilike '%' || p_q || '%'
    )
  order by p.full_name
  limit 200;
$$;

grant execute on function transfer_targets(text) to authenticated;


-- ---------------------------------------------------------------------
-- RPC: โอนเครื่องให้คน
--
-- ทิ้งตัวเก่าที่รับแผนกก่อน ไม่งั้นจะมีสองตัวชื่อเดียวกัน
-- แล้ว PostgREST จะเลือกไม่ถูกว่าจะเรียกตัวไหน
-- ---------------------------------------------------------------------
drop function if exists asset_transfer_many(text[], text, text);
drop function if exists asset_transfer(text, text, text);

create or replace function asset_transfer(
  p_code    text,
  p_to_user uuid,
  p_reason  text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me    uuid := auth.uid();
  v_to    profiles%rowtype;
  v_asset assets%rowtype;
  v_out   bigint;
  v_from  uuid;
  v_fdept text;
  v_txn   uuid;
  v_ref   text;
  v_id    bigint;
begin
  if not my_can_proxy() then
    raise exception 'บัญชีนี้โอนเครื่องไม่ได้';
  end if;

  select * into v_to from profiles where id = p_to_user;
  if v_to.id is null or not v_to.is_active then
    raise exception 'ไม่พบผู้รับโอน หรือบัญชีถูกระงับ';
  end if;
  if v_to.role = 'staff' and not v_to.can_assets then
    raise exception '% เบิก Asset ไม่ได้ โอนไปแล้วจะไม่มีใครรับ', v_to.full_name;
  end if;

  select * into v_asset from assets where code = p_code for update;
  if v_asset.code is null then
    raise exception 'ไม่พบเครื่อง %', p_code;
  end if;

  -- ── ตัดรายการค้างของคนเดิม เฉพาะเครื่องนี้เครื่องเดียว ──
  v_out := v_asset.held_item_id;
  if v_out is not null then
    select t.user_id, t.dept_code into v_from, v_fdept
      from asset_txn_items ai join asset_txns t on t.id = ai.txn_id
     where ai.id = v_out;

    if v_from = p_to_user then
      raise exception 'เครื่อง % อยู่กับ %s อยู่แล้ว', p_code, v_to.full_name;
    end if;

    v_ref := next_asset_ref('in');
    insert into asset_txns (ref_no, kind, type_code, user_id, acted_by, dept_code, is_transfer, note)
    values (v_ref, 'in', v_asset.type_code, v_from, v_me, v_fdept, true,
            'โอนให้ ' || v_to.full_name || coalesce(' · ' || p_reason, ''))
    returning id into v_txn;

    insert into asset_txn_items (txn_id, asset_code, out_item_id)
    values (v_txn, p_code, v_out);

    update assets set held_item_id = null where code = p_code;
  elsif v_asset.loan_user = p_to_user then
    raise exception 'เครื่อง % ถูกโอนให้ % อยู่แล้ว', p_code, v_to.full_name;
  end if;

  -- loan_dept เลิกใช้แล้ว ล้างทิ้งเผื่อแถวเก่ายังค้างค่าไว้
  update assets set loan_user = p_to_user, loan_dept = null where code = p_code;

  insert into asset_transfers (asset_code, out_item_id, from_user_id, from_dept,
                               to_user_id, by_user_id, reason)
  values (p_code, v_out, v_from, coalesce(v_fdept, v_asset.dept_code),
          p_to_user, v_me, p_reason)
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'asset_code', p_code,
    'to_user', p_to_user,
    'to_name', v_to.full_name,
    'cut_from', v_from
  );
end $$;

grant execute on function asset_transfer(text, uuid, text) to authenticated;


create or replace function asset_transfer_many(
  p_codes   text[],
  p_to_user uuid,
  p_reason  text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_code    text;
  v_done    text[] := '{}';
  v_skipped text[] := '{}';
  v_name    text;
  v_holder  uuid;
begin
  if not my_can_proxy() then
    raise exception 'บัญชีนี้โอนเครื่องไม่ได้';
  end if;

  if p_codes is null or array_length(p_codes, 1) is null then
    raise exception 'ยังไม่ได้เลือกเครื่องที่จะโอน';
  end if;

  select full_name into v_name from profiles where id = p_to_user;

  foreach v_code in array p_codes loop
    -- เครื่องที่อยู่กับคนนั้นอยู่แล้วให้ข้าม ไม่ใช่ล้มทั้งชุด
    select t.user_id into v_holder
      from assets a
      join asset_txn_items ai on ai.id = a.held_item_id
      join asset_txns t on t.id = ai.txn_id
     where a.code = v_code;

    if v_holder = p_to_user
       or exists (select 1 from assets a
                   where a.code = v_code
                     and a.held_item_id is null
                     and a.loan_user = p_to_user) then
      v_skipped := v_skipped || v_code;
    else
      perform asset_transfer(v_code, p_to_user, p_reason);
      v_done := v_done || v_code;
    end if;

    v_holder := null;
  end loop;

  if array_length(v_done, 1) is null then
    raise exception 'ทุกเครื่องที่เลือกอยู่กับ % อยู่แล้ว', coalesce(v_name, 'คนนี้');
  end if;

  return jsonb_build_object(
    'to_user', p_to_user,
    'to_name', v_name,
    'moved', to_jsonb(v_done),
    'skipped', to_jsonb(v_skipped),
    'count', array_length(v_done, 1)
  );
end $$;

grant execute on function asset_transfer_many(text[], uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- ยกเลิกการโอนที่ปลายทางยังไม่ได้รับ
-- ---------------------------------------------------------------------
create or replace function asset_transfer_cancel(p_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
begin
  if not my_can_proxy() then
    raise exception 'บัญชีนี้ยกเลิกการโอนไม่ได้';
  end if;

  select asset_code into v_code
    from asset_transfers where id = p_id and claimed_at is null;
  if v_code is null then
    raise exception 'ไม่พบรายการโอนที่ยังไม่ถูกรับ';
  end if;

  update assets set loan_user = null, loan_dept = null where code = v_code;
  delete from asset_transfers where id = p_id;
end $$;

grant execute on function asset_transfer_cancel(bigint) to authenticated;


-- ---------------------------------------------------------------------
-- แถบเตือนการโอน — ฝั่งรับเหลือคนเดียว ไม่ใช่ทั้งแผนก
-- ---------------------------------------------------------------------
drop view if exists asset_transfer_notices;
create view asset_transfer_notices
with (security_invoker = true) as
select
  tr.id,
  'in'::text            as side,
  tr.asset_code,
  ty.name               as type_name,
  tp.full_name          as to_name,
  tr.from_dept,
  fp.full_name          as from_name,
  bp.full_name          as by_name,
  tr.reason,
  tr.created_at
from asset_transfers tr
join assets a       on a.code = tr.asset_code
join asset_types ty on ty.code = a.type_code
left join profiles fp on fp.id = tr.from_user_id
left join profiles tp on tp.id = tr.to_user_id
join profiles bp      on bp.id = tr.by_user_id
where tr.claimed_at is null
  and tr.to_user_id = auth.uid()

union all

select
  tr.id,
  'out'::text,
  tr.asset_code,
  ty.name,
  tp.full_name,
  tr.from_dept,
  fp.full_name,
  bp.full_name,
  tr.reason,
  tr.created_at
from asset_transfers tr
join assets a       on a.code = tr.asset_code
join asset_types ty on ty.code = a.type_code
left join profiles fp on fp.id = tr.from_user_id
left join profiles tp on tp.id = tr.to_user_id
join profiles bp      on bp.id = tr.by_user_id
where tr.ack_at is null
  and tr.from_user_id = auth.uid();

grant select on asset_transfer_notices to authenticated;


-- ---------------------------------------------------------------------
-- ของค้างคืน — โชว์ชื่อคนที่ถูกโอนให้ แทนรหัสแผนก
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
  a.share_depts        as asset_share_depts,
  a.loan_user          as asset_loan_user,
  lp.full_name         as asset_loan_name,
  t.id                 as txn_id,
  t.ref_no,
  t.user_id,
  p.full_name          as holder_name,
  p.employee_code      as holder_code,
  t.dept_code          as holder_dept,
  p.sub_dept           as holder_sub_dept,
  t.acted_by,
  ap.full_name         as acted_by_name,
  t.shift_start,
  t.shift_end,
  t.due_at,
  t.created_at         as taken_at
from assets a
join asset_txn_items ai on ai.id = a.held_item_id
join asset_txns t       on t.id = ai.txn_id
join asset_types ty     on ty.code = a.type_code
join profiles p         on p.id = t.user_id
left join profiles ap   on ap.id = t.acted_by
left join profiles lp   on lp.id = a.loan_user;

grant select on asset_holdings to authenticated;


-- ---------------------------------------------------------------------
-- คืนเครื่อง — ล้าง loan_user ด้วย เครื่องกลับบ้านตัวเอง
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
  v_proxy  boolean := false;
  v_type   text;
  v_txn    uuid;
  v_ref    text;
  v_code   text;
  v_out    bigint;
  v_owner  uuid;
  v_min    int;
  v_steps  int;
  v_photos int := coalesce(jsonb_array_length(p_photos), 0);
  v_refs   text[] := '{}';
  v_first  uuid := null;
  v_n      int := 0;
  r        jsonb;
begin
  select * into v_me from profiles where id = auth.uid();
  if v_me.id is null or not v_me.is_active then
    raise exception 'บัญชีนี้ใช้งานไม่ได้';
  end if;

  if p_codes is null or array_length(p_codes, 1) is null then
    raise exception 'ยังไม่ได้เลือกเครื่องที่จะคืน';
  end if;

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

    if v_owner <> v_me.id then
      if not my_can_proxy() then
        raise exception 'เครื่อง % ไม่ได้เบิกโดยคุณ', v_code;
      end if;
      v_proxy := true;
    end if;
  end loop;

  if not v_proxy then
    select a.type_code into v_type from assets a where a.code = p_codes[1];
    select count(*) into v_steps from asset_photo_steps where type_code = v_type;
    select photo_min into v_min from asset_types where code = v_type;
    if v_steps > 0 then v_min := v_steps; end if;
    if v_photos < coalesce(v_min, 1) then
      raise exception 'ต้องถ่ายรูปสภาพตอนคืนให้ครบ % ใบก่อน (ถ่ายมาแล้ว % ใบ)',
        coalesce(v_min, 1), v_photos;
    end if;
  end if;

  for v_type in
    select distinct a.type_code
      from assets a
     where a.code = any(p_codes)
     order by 1
  loop
    v_ref := next_asset_ref('in');
    insert into asset_txns (ref_no, kind, type_code, user_id, acted_by, dept_code,
                            shift_start, shift_end, note)
    values (v_ref, 'in', v_type, v_me.id,
            case when v_proxy then v_me.id else null end,
            v_me.dept_code, v_me.shift_start, v_me.shift_end, p_note)
    returning id into v_txn;

    v_refs := v_refs || v_ref;
    if v_first is null then v_first := v_txn; end if;

    for v_code in
      select a.code from assets a where a.code = any(p_codes) and a.type_code = v_type
    loop
      insert into asset_txn_items (txn_id, asset_code, out_item_id)
      select v_txn, v_code, a.held_item_id from assets a where a.code = v_code;

      update assets set held_item_id = null, loan_user = null, loan_dept = null
       where code = v_code;
      v_n := v_n + 1;
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

    for r in
      select e.value
        from jsonb_array_elements(p_issues) e
        join assets a on a.code = e.value->>'asset_code'
       where a.type_code = v_type
    loop
      insert into asset_issues (asset_code, txn_id, phase, symptom, reported_by, file_id, web_link)
      values (r->>'asset_code', v_txn, 'in', r->>'symptom', v_me.id,
              r->>'file_id', r->>'web_link');
    end loop;
  end loop;

  return jsonb_build_object(
    'id', v_first,
    'ref_no', array_to_string(v_refs, ' · '),
    'refs', to_jsonb(v_refs),
    'count', v_n
  );
end $$;

grant execute on function asset_return(text[], jsonb, jsonb, text) to authenticated;


-- ---------------------------------------------------------------------
-- ปิดรายการค้างโดยแอดมิน — ล้าง loan_user ด้วยเหตุผลเดียวกัน
-- ---------------------------------------------------------------------
create or replace function admin_release_asset(
  p_out_item_id bigint,
  p_note        text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor profiles%rowtype;
  v_code  text;
  v_type  text;
  v_owner uuid;
  v_txn   uuid;
  v_ref   text;
begin
  select * into v_actor from profiles where id = auth.uid();
  if v_actor.id is null or not my_can_proxy() then
    raise exception 'บัญชีนี้ปิดรายการค้างแทนคนอื่นไม่ได้';
  end if;

  select ai.asset_code, a.type_code, t.user_id
    into v_code, v_type, v_owner
    from asset_txn_items ai
    join assets a     on a.code = ai.asset_code
    join asset_txns t on t.id = ai.txn_id
   where ai.id = p_out_item_id;

  if v_code is null then
    raise exception 'ไม่พบรายการเบิกนี้';
  end if;
  if not exists (select 1 from assets where code = v_code and held_item_id = p_out_item_id) then
    raise exception 'เครื่อง % ถูกคืนไปแล้ว', v_code;
  end if;

  perform 1 from assets where code = v_code for update;

  v_ref := next_asset_ref('in');
  insert into asset_txns (ref_no, kind, type_code, user_id, acted_by, dept_code, is_forced, note)
  values (v_ref, 'in', v_type, v_owner, v_actor.id, v_actor.dept_code, true,
          coalesce(nullif(btrim(p_note), ''), 'ปิดโดยแอดมิน ไม่มีรูปประกอบ'))
  returning id into v_txn;

  insert into asset_txn_items (txn_id, asset_code, out_item_id)
  values (v_txn, v_code, p_out_item_id);

  update assets set held_item_id = null, loan_user = null, loan_dept = null
   where code = v_code;

  return jsonb_build_object('ref_no', v_ref, 'asset_code', v_code);
end $$;

grant execute on function admin_release_asset(bigint, text) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select 'ฟังก์ชันโอนให้คน'   as สิ่งที่ตรวจ,
       count(*)::text        as ผล
  from pg_proc where proname = 'asset_transfer'
union all select 'ฟังก์ชันโอนหลายเครื่อง', count(*)::text
  from pg_proc where proname = 'asset_transfer_many'
union all select 'รายชื่อผู้รับโอน', count(*)::text
  from pg_proc where proname = 'transfer_targets'
union all select 'คอลัมน์ loan_user', count(*)::text
  from information_schema.columns where table_name = 'assets' and column_name = 'loan_user'
union all select 'คนที่รับโอนได้ตอนนี้', count(*)::text from transfer_targets();
-- =====================================================================
-- BPL SUPPLY — บาร์โค้ด BY หนึ่งใบ ตัดสต็อกได้หลายรายการ
-- รันต่อจาก 041 · ปลอดภัยที่จะรันซ้ำ
--
-- ของเดิมผูกได้วัสดุเดียวต่อหนึ่งบาร์โค้ด (by_barcodes.item_id + qty)
-- แต่หน้างานจริงบาร์โค้ดใบเดียวมีของหลายอย่าง คนจัดการจึงตัดได้แค่อย่างเดียว
-- ที่เหลือต้องไปตัดมือที่หน้าสต็อก ซึ่งไม่มีร่องรอยว่าตัดเพราะใบไหน
--
-- เพิ่มตารางบรรทัดแยก หนึ่งใบมีได้หลายบรรทัด
-- คอลัมน์ item_id/qty เดิมยังอยู่และยังถูกเติมด้วยบรรทัดแรกเสมอ
-- ของเก่าที่อ่านสองคอลัมน์นั้นอยู่จึงไม่พัง
-- =====================================================================

create table if not exists by_barcode_lines (
  id         bigserial primary key,
  by_id      uuid    not null references by_barcodes(id) on delete cascade,
  item_id    bigint  not null references items(id),
  qty        integer not null check (qty > 0),
  created_at timestamptz not null default now(),
  -- วัสดุเดิมซ้ำในใบเดียวไม่ได้ ให้รวมจำนวนเป็นบรรทัดเดียว
  unique (by_id, item_id)
);

create index if not exists by_lines_by_idx on by_barcode_lines (by_id);

-- ย้ายของเดิมเข้าตารางใหม่ จะได้ไม่มีใบไหนตกหล่น
insert into by_barcode_lines (by_id, item_id, qty)
select b.id, b.item_id, b.qty
  from by_barcodes b
 where b.item_id is not null and coalesce(b.qty, 0) > 0
on conflict (by_id, item_id) do nothing;

alter table by_barcode_lines enable row level security;

drop policy if exists read_by_lines on by_barcode_lines;
create policy read_by_lines on by_barcode_lines for select to authenticated using (
  my_role() in ('supervisor', 'admin')
  or exists (select 1 from by_barcodes b where b.id = by_id and b.user_id = auth.uid())
);

drop policy if exists write_by_lines on by_barcode_lines;
create policy write_by_lines on by_barcode_lines for all to authenticated
  using (my_role() in ('supervisor', 'admin'))
  with check (my_role() in ('supervisor', 'admin'));


-- ---------------------------------------------------------------------
-- RPC: ปิดงานบาร์โค้ด พร้อมตัดสต็อกหลายรายการในทีเดียว
--
-- ตัดสต็อกเฉพาะตอนที่ "เพิ่งเปลี่ยน" เป็น done เท่านั้น
-- กดซ้ำบนใบที่ done อยู่แล้วจะไม่ตัดซ้ำ แต่ยังแก้รายการได้
-- ---------------------------------------------------------------------
create or replace function set_by_status_lines(
  p_id        uuid,
  p_status    by_status,
  p_note      text    default null,
  p_lines     jsonb   default '[]'::jsonb,
  p_cut_stock boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_was    by_status;
  v_first  bigint := null;
  v_fqty   integer := null;
  v_cut    int := 0;
  r        jsonb;
  v_item   bigint;
  v_qty    integer;
begin
  if my_role() not in ('supervisor', 'admin') then
    raise exception 'ไม่มีสิทธิ์จัดการรายการบาร์โค้ด BY';
  end if;

  select status into v_was from by_barcodes where id = p_id;
  if v_was is null then
    raise exception 'ไม่พบรายการนี้';
  end if;

  -- เขียนบรรทัดใหม่ทับของเดิมทั้งชุด แก้ทีหลังได้โดยไม่ต้องไล่ลบเอง
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 0 then
    delete from by_barcode_lines where by_id = p_id;

    for r in select * from jsonb_array_elements(p_lines) loop
      v_item := (r->>'item_id')::bigint;
      v_qty  := (r->>'qty')::integer;

      if v_item is null or coalesce(v_qty, 0) <= 0 then
        raise exception 'บรรทัดรายการไม่ครบ ต้องมีทั้งวัสดุและจำนวนที่มากกว่า 0';
      end if;
      if not exists (select 1 from items where id = v_item) then
        raise exception 'ไม่พบวัสดุรหัส %', v_item;
      end if;

      insert into by_barcode_lines (by_id, item_id, qty)
      values (p_id, v_item, v_qty)
      on conflict (by_id, item_id) do update set qty = by_barcode_lines.qty + excluded.qty;

      if v_first is null then
        v_first := v_item;
        v_fqty  := v_qty;
      end if;
    end loop;
  end if;

  update by_barcodes
     set status       = p_status,
         item_id      = coalesce(v_first, item_id),
         qty          = coalesce(v_fqty, qty),
         handled_by   = case when p_status = 'pending' then null else auth.uid() end,
         handled_at   = case when p_status = 'pending' then null else now() end,
         handled_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id;

  -- ตัดสต็อกทีละบรรทัด · adjust_stock ล็อกแถววัสดุให้อยู่แล้ว
  if p_cut_stock and p_status = 'done' and v_was <> 'done' then
    for v_item, v_qty in
      select l.item_id, l.qty from by_barcode_lines l where l.by_id = p_id
    loop
      perform adjust_stock(v_item, -v_qty, 'บาร์โค้ด BY');
      v_cut := v_cut + 1;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'cut_lines', v_cut);
end $$;

grant execute on function set_by_status_lines(uuid, by_status, text, jsonb, boolean) to authenticated;


-- ---------------------------------------------------------------------
-- by_feed — พ่วงบรรทัดรายการมาให้ครบ หน้าเว็บจะได้ไม่ต้องยิงถามทีละใบ
-- ---------------------------------------------------------------------
drop view if exists by_feed;
create view by_feed
with (security_invoker = true) as
select
  b.id,
  b.ref_no,
  b.created_at,
  b.reason,
  b.note,
  b.status,
  b.handled_at,
  b.handled_note,
  b.user_id,
  p.full_name                            as who,
  p.employee_code,
  b.dept_code,
  b.sub_dept,
  b.shift_start,
  b.shift_end,
  h.full_name                            as handled_by_name,
  b.item_id,
  i.name                                 as item_name,
  i.sku                                  as item_sku,
  i.unit                                 as item_unit,
  b.qty,
  coalesce((
    select jsonb_agg(jsonb_build_object(
             'item_id', l.item_id,
             'qty',     l.qty,
             'name',    li.name,
             'sku',     li.sku,
             'unit',    li.unit
           ) order by li.name)
    from by_barcode_lines l
    join items li on li.id = l.item_id
    where l.by_id = b.id
  ), '[]'::jsonb)                        as lines,
  coalesce((
    select count(*) from by_barcode_photos ph where ph.by_id = b.id
  ), 0)::int                             as photo_count,
  coalesce((
    select array_agg(ph.file_id order by ph.sort_no)
    from by_barcode_photos ph where ph.by_id = b.id
  ), '{}')                               as file_ids
from by_barcodes b
join profiles p on p.id = b.user_id
left join profiles h on h.id = b.handled_by
left join items i   on i.id = b.item_id;

grant select on by_feed to authenticated;


-- ---------------------------------------------------------------------
-- สถิติรายเดือน — นับจากบรรทัด ไม่ใช่จากคอลัมน์เดียวในหัวใบ
--
-- ของเดิมนับได้แค่วัสดุตัวแรก ใบที่มีหลายรายการจะหายไปจากรายงานทั้งหมด
-- ---------------------------------------------------------------------
drop view if exists by_stats_monthly;
create view by_stats_monthly
with (security_invoker = true) as
select
  to_char((b.created_at at time zone 'Asia/Bangkok'), 'YYYY-MM')  as ym,
  b.dept_code,
  b.reason,
  l.item_id,
  i.name                                                          as item_name,
  count(distinct b.id)::int                                       as total,
  count(distinct b.id) filter (where b.status = 'pending')::int    as pending,
  count(distinct b.id) filter (where b.status = 'done')::int       as done,
  count(distinct b.id) filter (where b.status = 'rejected')::int   as rejected,
  coalesce(sum(l.qty) filter (where b.status = 'done'), 0)::int    as qty_done
from by_barcodes b
left join by_barcode_lines l on l.by_id = b.id
left join items i           on i.id = l.item_id
group by 1, 2, 3, 4, 5;

grant select on by_stats_monthly to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select 'ตารางบรรทัดรายการ'  as สิ่งที่ตรวจ, count(*)::text as ผล
  from information_schema.tables where table_name = 'by_barcode_lines'
union all select 'ฟังก์ชันตัดหลายรายการ', count(*)::text
  from pg_proc where proname = 'set_by_status_lines'
union all select 'บรรทัดที่ย้ายมาจากของเดิม', count(*)::text from by_barcode_lines
union all select 'บาร์โค้ด BY ทั้งหมด', count(*)::text from by_barcodes;
-- =====================================================================
-- BPL SUPPLY — คืนวัสดุยืม-คืนหลายรายการในครั้งเดียว
-- รันต่อจาก 042 · ปลอดภัยที่จะรันซ้ำ
--
-- ตอนเลิกกะคนหนึ่งอาจค้างหลายรายการ ของเดิมต้องกดคืนทีละอัน
-- ถ่ายรูปใหม่ทุกอัน ทั้งที่ของกองอยู่ตรงหน้าชุดเดียวกัน
-- แถวยาว ๆ ตอนเปลี่ยนกะเกิดจากตรงนี้
--
-- ฟังก์ชันนี้วนเรียกตรรกะเดิมทีละบรรทัด ไม่ได้เขียนกฎใหม่
-- กฎเดิมทุกข้อจึงยังอยู่ครบ: คืนเกินไม่ได้ · ต้องมีรูป · ของสภาพดีเข้าสต็อกคืน
-- ถ้าบรรทัดไหนพัง ทั้งชุดย้อนกลับ ไม่เหลือคืนครึ่ง ๆ กลาง ๆ ให้ตามแก้
-- =====================================================================

create or replace function create_return_many(
  p_lines     jsonb,
  p_condition return_cond default 'ok',
  p_photos    jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r        jsonb;
  v_line   bigint;
  v_qty    integer;
  v_n      integer := 0;
  v_units  integer := 0;
  v_main   text := p_photos->0->>'file_id';
  v_link   text := p_photos->0->>'web_link';
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'ยังไม่ได้เลือกรายการที่จะคืน';
  end if;
  if v_main is null then
    raise exception 'ต้องถ่ายรูปสภาพตอนคืนอย่างน้อย 1 ใบ';
  end if;

  for r in select * from jsonb_array_elements(p_lines) loop
    v_line := (r->>'line_id')::bigint;
    v_qty  := (r->>'qty')::integer;

    if v_line is null or coalesce(v_qty, 0) <= 0 then
      raise exception 'บรรทัดรายการไม่ครบ ต้องมีทั้งรายการและจำนวนที่มากกว่า 0';
    end if;

    -- ใช้ตรรกะเดิมทั้งหมด รูปชุดเดียวกันติดไปทุกบรรทัด
    -- เพราะเป็นการส่งมอบครั้งเดียวกันจริง ๆ
    perform create_return(v_line, v_qty, p_condition, v_main, v_link, p_photos);

    v_n     := v_n + 1;
    v_units := v_units + v_qty;
  end loop;

  return jsonb_build_object('lines', v_n, 'units', v_units);
end $$;

grant execute on function create_return_many(jsonb, return_cond, jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select 'ฟังก์ชันคืนหลายรายการ' as สิ่งที่ตรวจ, count(*)::text as ผล
  from pg_proc where proname = 'create_return_many';
-- =====================================================================
-- BPL SUPPLY — ชุดเบิก-คืน หนึ่งบรรทัดเห็นครบทั้งวงจร
-- รันต่อจาก 043 · ปลอดภัยที่จะรันซ้ำ
--
-- ปัญหาของเดิม: หน้าหลักฐานเรียงตาม "เหตุการณ์"
-- ใบเบิกอยู่แถวหนึ่ง การคืนอยู่อีกแถวหนึ่ง คนละที่กัน
-- จะรู้ว่าของกลับมาครบไหมต้องนั่งจับคู่เอง ยิ่งคืนทีละนิดยิ่งไล่ไม่ไหว
--
-- วิวนี้เรียงตาม "บรรทัดที่เบิก" แทน หนึ่งแถวคือหนึ่งรายการที่เบิกออกไป
-- แล้วพ่วงการคืนทุกครั้งของบรรทัดนั้นมาไว้ในแถวเดียวกัน พร้อมรูปของแต่ละครั้ง
-- คืน 2 วันนี้ อีก 3 พรุ่งนี้ ก็ยังเป็นแถวเดิม ยอดสะสมเดินขึ้นจนครบ
--
-- return_state บอกสถานะในคำเดียว
--   consumed = ของใช้แล้วหมดไป ไม่ต้องคืน (ห้ามขึ้นว่าค้าง ไม่งั้นทั้งหน้าจะเป็นสีแดงถาวร)
--   none     = ยังไม่ได้คืนสักชิ้น
--   partial  = คืนมาบางส่วน ยังค้างอยู่
--   full     = ครบแล้ว
-- =====================================================================

drop view if exists borrow_sets;
create view borrow_sets
with (security_invoker = true) as
select
  ri.id                                   as line_id,
  r.id                                    as requisition_id,
  r.ref_no,
  r.created_at                            as taken_at,
  r.hub_code,
  r.requester_id,
  p.full_name                             as who,
  p.employee_code,
  p.dept_code,
  p.sub_dept,
  p.shift_start,
  p.shift_end,
  i.id                                    as item_id,
  i.sku,
  i.name                                  as item_name,
  i.unit,
  i.is_returnable,
  coalesce(ri.qty_approved, 0)            as qty_taken,
  coalesce(rt.qty_returned, 0)::int       as qty_returned,
  greatest(coalesce(ri.qty_approved, 0) - coalesce(rt.qty_returned, 0), 0)::int as qty_open,
  case
    when not i.is_returnable                                        then 'consumed'
    when coalesce(rt.qty_returned, 0) = 0                           then 'none'
    when coalesce(rt.qty_returned, 0) >= coalesce(ri.qty_approved, 0) then 'full'
    else 'partial'
  end                                     as return_state,

  -- รูปตอนเบิก · ใบหลักมาก่อนเสมอ แล้วค่อยใบที่เหลือ
  coalesce((
    select array_agg(f order by ord)
    from (
      select r.evidence_file_id as f, 0 as ord where r.evidence_file_id is not null
      union all
      select ph.file_id, ph.sort_no + 1
      from requisition_photos ph
      where ph.requisition_id = r.id and ph.file_id <> coalesce(r.evidence_file_id, '')
    ) q
  ), '{}')                                as out_file_ids,

  -- การคืนทุกครั้งของบรรทัดนี้ เรียงตามเวลา พร้อมรูปของครั้งนั้น ๆ
  coalesce((
    select jsonb_agg(jsonb_build_object(
             'id',          rr.id,
             'qty',         rr.qty,
             'condition',   rr.condition,
             'at',          rr.created_at,
             'by',          bp.full_name,
             'file_ids',    coalesce((
                              select array_agg(rp.file_id order by rp.sort_no)
                              from return_photos rp where rp.return_id = rr.id
                            ), case when rr.evidence_file_id is not null
                                    then array[rr.evidence_file_id] else '{}' end)
           ) order by rr.created_at)
    from returns rr
    left join profiles bp on bp.id = rr.returned_by
    where rr.requisition_item_id = ri.id
  ), '[]'::jsonb)                         as returns

from requisition_items ri
join requisitions r on r.id = ri.requisition_id
join items i        on i.id = ri.item_id
join profiles p     on p.id = r.requester_id
left join lateral (
  select sum(qty)::int as qty_returned from returns where requisition_item_id = ri.id
) rt on true
where ri.status = 'approved';

grant select on borrow_sets to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select 'บรรทัดเบิกทั้งหมด' as สิ่งที่ตรวจ, count(*)::text as ผล from borrow_sets
union all select 'ของยืม-คืนที่ยังไม่ครบ', count(*)::text
  from borrow_sets where return_state in ('none', 'partial')
union all select 'คืนครบแล้ว', count(*)::text from borrow_sets where return_state = 'full';
-- =====================================================================
-- BPL SUPPLY — การ์ดชุดเบิก-คืน หนึ่งใบเบิกคือหนึ่งการ์ด
-- รันต่อจาก 044 · ปลอดภัยที่จะรันซ้ำ
--
-- 044 แยกเป็นรายบรรทัด ซึ่งซอยย่อยเกินไป
-- คนเดียวกดเบิกทีเดียวได้ 3 เครื่อง ต้องเป็นการ์ดเดียว ไม่ใช่ 3 แถว
-- วิวนี้จึงจับกลุ่มที่ "ใบเบิก" แทน แล้วยัดรายการกับการคืนเข้าไปเป็น JSON
--
-- ⚠️ ไม่แตะการส่งออก Google Sheet
-- ตัวส่งออกอ่าน asset_txn_items / requisitions โดยตรง ไม่ได้ผ่านวิวนี้
-- รูปแบบคอลัมน์ในชีตจึงเหมือนเดิมทุกประการ
--
-- รวมสองฝั่งไว้ในวิวเดียว (kind = supply / asset) เพราะหน้าจอวาดการ์ดแบบเดียวกัน
-- ถ้าแยกสองวิวจะต้องเขียนโค้ดวาดสองชุดแล้วมันจะเพี้ยนจากกันภายหลัง
-- =====================================================================

drop view if exists return_cards;
create view return_cards
with (security_invoker = true) as

-- ── ฝั่งวัสดุสิ้นเปลือง · การ์ด = ใบเบิกหนึ่งใบ ───────────────────────
select
  'supply'::text                          as kind,
  r.id::text                              as card_id,
  r.ref_no,
  r.created_at                            as taken_at,
  r.requester_id                          as user_id,
  p.full_name                             as who,
  p.employee_code,
  p.dept_code,
  p.sub_dept,
  p.shift_start,
  p.shift_end,

  coalesce((
    select array_agg(f order by ord)
    from (
      select r.evidence_file_id as f, 0 as ord where r.evidence_file_id is not null
      union all
      select ph.file_id, ph.sort_no + 1
      from requisition_photos ph
      where ph.requisition_id = r.id and ph.file_id <> coalesce(r.evidence_file_id, '')
    ) q
  ), '{}')                                as out_file_ids,

  -- รายการในใบ
  coalesce((
    select jsonb_agg(jsonb_build_object(
             'label',    i.name,
             'sub',      i.sku,
             'unit',     i.unit,
             'need',     case when i.is_returnable then coalesce(ri.qty_approved, 0) else 0 end,
             'taken',    coalesce(ri.qty_approved, 0),
             'returned', coalesce(rs.n, 0),
             'state',    case
                           when not i.is_returnable                     then 'consumed'
                           when coalesce(rs.n, 0) = 0                   then 'open'
                           when coalesce(rs.n, 0) >= coalesce(ri.qty_approved, 0) then 'returned'
                           else 'partial'
                         end,
             'note',     null
           ) order by i.name)
    from requisition_items ri
    join items i on i.id = ri.item_id
    left join lateral (
      select sum(qty)::int as n from returns where requisition_item_id = ri.id
    ) rs on true
    where ri.requisition_id = r.id and ri.status = 'approved'
  ), '[]'::jsonb)                         as items,

  -- การคืนแต่ละครั้ง · รวมบรรทัดที่คืนพร้อมกันเป็นครั้งเดียว
  -- จับกลุ่มด้วยเวลาที่ตรงกันเป๊ะ + คนคืนคนเดียวกัน
  -- ของที่คืนผ่าน create_return_many จะมีเวลาเดียวกันทั้งชุดเพราะอยู่ใน transaction เดียว
  coalesce((
    select jsonb_agg(ev order by (ev->>'at'))
    from (
      select jsonb_build_object(
               'at',       rr.created_at,
               'by',       max(bp.full_name),
               'detail',   string_agg(i2.name || ' ' || rr.qty || ' ' || i2.unit, ' · '
                             order by i2.name),
               'cond',     max(rr.condition::text),
               'file_ids', coalesce(max(ph.ids), '{}')
             ) as ev
      from returns rr
      join requisition_items ri2 on ri2.id = rr.requisition_item_id
      join items i2              on i2.id = ri2.item_id
      left join profiles bp      on bp.id = rr.returned_by
      left join lateral (
        select array_agg(rp.file_id order by rp.sort_no) as ids
        from return_photos rp where rp.return_id = rr.id
      ) ph on true
      where ri2.requisition_id = r.id
      group by rr.created_at, rr.returned_by, rr.qty
    ) g
  ), '[]'::jsonb)                         as events

from requisitions r
join profiles p on p.id = r.requester_id

union all

-- ── ฝั่งอุปกรณ์ Asset · การ์ด = ใบเบิกหนึ่งใบ ─────────────────────────
select
  'asset'::text,
  t.id::text,
  t.ref_no,
  t.created_at,
  t.user_id,
  p.full_name,
  p.employee_code,
  t.dept_code,
  p.sub_dept,
  t.shift_start,
  t.shift_end,

  coalesce((
    select array_agg(ph.file_id order by ph.seq)
    from asset_txn_photos ph where ph.txn_id = t.id
  ), '{}'),

  -- เครื่องในใบ · สถานะแยกว่าคืนแล้ว โดนโอน หรือยังค้าง
  coalesce((
    select jsonb_agg(jsonb_build_object(
             'label',    ai.asset_code,
             'sub',      ty.name,
             'unit',     'เครื่อง',
             'need',     case when coalesce(back.is_transfer, false) then 0 else 1 end,
             'taken',    1,
             'returned', case when back.id is not null and not coalesce(back.is_transfer, false)
                              then 1 else 0 end,
             'state',    case
                           when back.id is null                          then 'open'
                           when coalesce(back.is_transfer, false)        then 'transferred'
                           when coalesce(back.is_forced, false)          then 'forced'
                           else 'returned'
                         end,
             'note',     case
                           when coalesce(back.is_transfer, false) then back.note
                           when coalesce(back.is_forced, false)   then back.note
                           else null
                         end
           ) order by ai.asset_code)
    from asset_txn_items ai
    join assets a       on a.code = ai.asset_code
    join asset_types ty on ty.code = a.type_code
    left join asset_txn_items bi on bi.out_item_id = ai.id
    left join asset_txns back    on back.id = bi.txn_id
    where ai.txn_id = t.id
  ), '[]'::jsonb),

  -- ใบคืนที่มาปิดเครื่องของใบนี้ · หนึ่งใบคืนคือหนึ่งครั้ง
  coalesce((
    select jsonb_agg(ev order by (ev->>'at'))
    from (
      select jsonb_build_object(
               'at',       back.created_at,
               'by',       coalesce(ba.full_name, bp.full_name),
               'detail',   string_agg(bi.asset_code, ' · ' order by bi.asset_code),
               'cond',     case
                             when coalesce(back.is_transfer, false) then 'transfer'
                             when coalesce(back.is_forced, false)   then 'forced'
                             else 'ok'
                           end,
               'file_ids', coalesce((
                             select array_agg(ph.file_id order by ph.seq)
                             from asset_txn_photos ph where ph.txn_id = back.id
                           ), '{}')
             ) as ev
      from asset_txn_items ai2
      join asset_txn_items bi   on bi.out_item_id = ai2.id
      join asset_txns back      on back.id = bi.txn_id
      left join profiles bp     on bp.id = back.user_id
      left join profiles ba     on ba.id = back.acted_by
      where ai2.txn_id = t.id
      group by back.id, back.created_at, back.is_transfer, back.is_forced,
               ba.full_name, bp.full_name
    ) g
  ), '[]'::jsonb)

from asset_txns t
join profiles p on p.id = t.user_id
where t.kind = 'out';

grant select on return_cards to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select case when count(*) >= 0 then 'วิว return_cards ใช้งานได้ · มี ' || count(*) || ' ใบ'
       end as ผลตรวจ
  from return_cards;
-- =====================================================================
-- BPL SUPPLY — เบิกแบบตะกร้า หลายประเภทในรอบเดียว
-- รันต่อจาก 045 · ปลอดภัยที่จะรันซ้ำ
--
-- หน้างานเลือกเครื่องข้ามประเภทในตะกร้าเดียว แล้วกดส่งทีเดียว
-- เบื้องหลังยังออกใบแยกตามประเภทเหมือนเดิม เพราะจำนวนรูปบังคับไม่เท่ากัน
-- (Power Pallet ห้าใบตามขั้นตอน ที่เหลือหนึ่งใบขึ้นไป)
-- ถ้ายัดใบเดียวรูปจะผูกผิดประเภทแล้วหลักฐานใช้ไม่ได้
--
-- ฟังก์ชันนี้วนเรียก asset_checkout ของเดิมทีละประเภท ไม่ได้เขียนกฎใหม่
-- กฎเดิมอยู่ครบทุกข้อ: สิทธิ์แผนก · เครื่องซ้ำ · จำนวนรูปขั้นต่ำ · เบิกแทน
-- ถ้าประเภทไหนพัง ทั้งตะกร้าย้อนกลับ ไม่เหลือเบิกครึ่ง ๆ กลาง ๆ
--
-- แจ้งของหาย: เดิมต้องรอนาฬิกาเดินรอบถัดไป (ไม่เกิน 5 นาที) ถึงจะเด้ง
-- ของหายรอไม่ได้ จึงเตะนาฬิกาทันทีเมื่อมีการแจ้งอาการใด ๆ ติดมากับใบ
-- =====================================================================

create or replace function asset_checkout_many(
  p_groups   jsonb,
  p_note     text default null,
  p_for_user uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  g        jsonb;
  v_type   text;
  v_codes  text[];
  v_photos jsonb;
  v_issues jsonb;
  v_one    jsonb;
  v_refs   text[] := '{}';
  v_n      int := 0;
  v_has_issue boolean := false;
begin
  if p_groups is null or jsonb_array_length(p_groups) = 0 then
    raise exception 'ยังไม่ได้เลือกเครื่อง';
  end if;

  for g in select * from jsonb_array_elements(p_groups) loop
    v_type := g->>'type_code';

    select array_agg(value::text) into v_codes
      from jsonb_array_elements_text(coalesce(g->'codes', '[]'::jsonb));

    v_photos := coalesce(g->'photos', '[]'::jsonb);
    v_issues := coalesce(g->'issues', '[]'::jsonb);

    if v_type is null or v_codes is null or array_length(v_codes, 1) is null then
      raise exception 'ข้อมูลประเภทไม่ครบ ต้องมีทั้งประเภทและรหัสเครื่อง';
    end if;

    if jsonb_array_length(v_issues) > 0 then
      v_has_issue := true;
    end if;

    v_one := asset_checkout(v_type, v_codes, v_photos, v_issues, p_note, p_for_user);

    v_refs := v_refs || (v_one->>'ref_no');
    v_n := v_n + array_length(v_codes, 1);
  end loop;

  -- ของหายหรือของเสียต้องถึงมือแอดมินเดี๋ยวนั้น ไม่ใช่รออีกห้านาที
  if v_has_issue then
    begin
      perform push_tick();
    exception when others then
      -- ส่งแจ้งเตือนไม่ได้ต้องไม่ทำให้การเบิกล้ม ของออกไปแล้วจริง ๆ
      null;
    end;
  end if;

  return jsonb_build_object(
    'ok', true,
    'count', v_n,
    'groups', jsonb_array_length(p_groups),
    'ref_no', array_to_string(v_refs, ' · '),
    'refs', to_jsonb(v_refs)
  );
end $$;

grant execute on function asset_checkout_many(jsonb, text, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- คืนเครื่อง — เตะนาฬิกาทันทีเช่นกันเมื่อมีการแจ้งอาการ
--
-- เขียนทับ asset_return ของ 041 โดยเพิ่มแค่ท่อนแจ้งเตือนท้ายฟังก์ชัน
-- ตรรกะอื่นเหมือนเดิมทุกบรรทัด
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
  v_proxy  boolean := false;
  v_type   text;
  v_txn    uuid;
  v_ref    text;
  v_code   text;
  v_out    bigint;
  v_owner  uuid;
  v_min    int;
  v_steps  int;
  v_photos int := coalesce(jsonb_array_length(p_photos), 0);
  v_refs   text[] := '{}';
  v_first  uuid := null;
  v_n      int := 0;
  r        jsonb;
begin
  select * into v_me from profiles where id = auth.uid();
  if v_me.id is null or not v_me.is_active then
    raise exception 'บัญชีนี้ใช้งานไม่ได้';
  end if;

  if p_codes is null or array_length(p_codes, 1) is null then
    raise exception 'ยังไม่ได้เลือกเครื่องที่จะคืน';
  end if;

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

    if v_owner <> v_me.id then
      if not my_can_proxy() then
        raise exception 'เครื่อง % ไม่ได้เบิกโดยคุณ', v_code;
      end if;
      v_proxy := true;
    end if;
  end loop;

  if not v_proxy then
    select a.type_code into v_type from assets a where a.code = p_codes[1];
    select count(*) into v_steps from asset_photo_steps where type_code = v_type;
    select photo_min into v_min from asset_types where code = v_type;
    if v_steps > 0 then v_min := v_steps; end if;
    if v_photos < coalesce(v_min, 1) then
      raise exception 'ต้องถ่ายรูปสภาพตอนคืนให้ครบ % ใบก่อน (ถ่ายมาแล้ว % ใบ)',
        coalesce(v_min, 1), v_photos;
    end if;
  end if;

  for v_type in
    select distinct a.type_code
      from assets a
     where a.code = any(p_codes)
     order by 1
  loop
    v_ref := next_asset_ref('in');
    insert into asset_txns (ref_no, kind, type_code, user_id, acted_by, dept_code,
                            shift_start, shift_end, note)
    values (v_ref, 'in', v_type, v_me.id,
            case when v_proxy then v_me.id else null end,
            v_me.dept_code, v_me.shift_start, v_me.shift_end, p_note)
    returning id into v_txn;

    v_refs := v_refs || v_ref;
    if v_first is null then v_first := v_txn; end if;

    for v_code in
      select a.code from assets a where a.code = any(p_codes) and a.type_code = v_type
    loop
      insert into asset_txn_items (txn_id, asset_code, out_item_id)
      select v_txn, v_code, a.held_item_id from assets a where a.code = v_code;

      update assets set held_item_id = null, loan_user = null, loan_dept = null
       where code = v_code;
      v_n := v_n + 1;
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

    for r in
      select e.value
        from jsonb_array_elements(p_issues) e
        join assets a on a.code = e.value->>'asset_code'
       where a.type_code = v_type
    loop
      insert into asset_issues (asset_code, txn_id, phase, symptom, reported_by, file_id, web_link)
      values (r->>'asset_code', v_txn, 'in', r->>'symptom', v_me.id,
              r->>'file_id', r->>'web_link');
    end loop;
  end loop;

  if coalesce(jsonb_array_length(p_issues), 0) > 0 then
    begin
      perform push_tick();
    exception when others then
      null;
    end;
  end if;

  return jsonb_build_object(
    'id', v_first,
    'ref_no', array_to_string(v_refs, ' · '),
    'refs', to_jsonb(v_refs),
    'count', v_n
  );
end $$;

grant execute on function asset_return(text[], jsonb, jsonb, text) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select 'ฟังก์ชันเบิกแบบตะกร้า' as สิ่งที่ตรวจ, count(*)::text as ผล
  from pg_proc where proname = 'asset_checkout_many';
-- =====================================================================
-- BPL SUPPLY — ของพ่วงเบิกรวมกับประเภทแม่ได้จริง
-- รันต่อจาก 046 · ปลอดภัยที่จะรันซ้ำ
--
-- เลเซอร์ลบ (LASER) ตั้งไว้เป็นของพ่วงใต้ไอดาต้า (IDATA) ตั้งแต่แรก
-- เจตนาคือ "มันคือไอดาต้า แค่เป็นรุ่นเลเซอร์ลบ" เบิกไม่บ่อยเลยซ่อนไว้ใต้หัวข้อแม่
-- แต่ asset_checkout ตรวจว่า type_code ต้องตรงกับประเภทที่ส่งมาแบบเป๊ะ ๆ
-- พอเบิกจริงจึงตีกลับว่า "ไม่ใช่ประเภทที่เลือก" — ของพ่วงเลยเบิกไม่ได้เลยมาตลอด
--
-- นี่เป็นบั๊กที่มีมาตั้งแต่ทำฟีเจอร์ของพ่วง ไม่ใช่ของใหม่
-- เพิ่งโผล่เพราะหน้าตะกร้าเอาของพ่วงมาแสดงให้กดได้เป็นครั้งแรก
--
-- แก้ให้รับได้ทั้งประเภทตรง ๆ และประเภทที่เป็นลูกของมัน
-- ใบเบิกยังออกเป็นประเภทแม่ใบเดียว ตามที่เจ้าของระบบต้องการ
-- (เบิกเลเซอร์ลบมาแล้วต้องขึ้นเป็นไอดาต้า)
--
-- ฝั่งคืนก็ต้องม้วนเข้าประเภทแม่เหมือนกัน ไม่งั้นเบิกเป็นไอดาต้าแต่คืนเป็นเลเซอร์ลบ
-- แล้วรายงานจะไม่บาลานซ์
-- =====================================================================

create or replace function asset_checkout(
  p_type     text,
  p_codes    text[],
  p_photos   jsonb default '[]'::jsonb,
  p_issues   jsonb default '[]'::jsonb,
  p_note     text default null,
  p_for_user uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me     profiles%rowtype;
  v_for    profiles%rowtype;
  v_actor  uuid;
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

  if p_for_user is null or p_for_user = v_me.id then
    v_for   := v_me;
    v_actor := null;
  else
    if not my_can_proxy() then
      raise exception 'บัญชีนี้เบิกแทนคนอื่นไม่ได้';
    end if;
    select * into v_for from profiles where id = p_for_user;
    if v_for.id is null or not v_for.is_active then
      raise exception 'ไม่พบผู้รับของ หรือบัญชีถูกระงับ';
    end if;
    v_actor := v_me.id;
  end if;

  perform assert_can_assets();

  if p_codes is null or array_length(p_codes, 1) is null then
    raise exception 'ยังไม่ได้เลือกเครื่อง';
  end if;

  if not exists (select 1 from asset_types where code = p_type and is_active) then
    raise exception 'ไม่พบประเภท %', p_type;
  end if;

  select count(*) into v_steps from asset_photo_steps where type_code = p_type;
  select photo_min into v_min from asset_types where code = p_type;
  if v_steps > 0 then v_min := v_steps; end if;
  if v_photos < coalesce(v_min, 1) then
    raise exception 'ต้องถ่ายรูปให้ครบ % ใบก่อน (ถ่ายมาแล้ว % ใบ)', coalesce(v_min, 1), v_photos;
  end if;

  v_ref := next_asset_ref('out');
  insert into asset_txns (ref_no, kind, type_code, user_id, acted_by, dept_code,
                          shift_start, shift_end, due_at, note)
  values (v_ref, 'out', p_type, v_for.id, v_actor, v_for.dept_code,
          v_for.shift_start, v_for.shift_end,
          shift_due_at(v_for.shift_start, v_for.shift_end), p_note)
  returning id into v_txn;

  foreach v_code in array p_codes loop
    perform 1 from assets where code = v_code for update;

    if not found then
      raise exception 'ไม่พบเครื่อง %', v_code;
    end if;
    if not exists (select 1 from assets where code = v_code and is_enabled) then
      raise exception 'เครื่อง % ถูกปิดไม่ให้เบิก', v_code;
    end if;

    -- ยอมรับประเภทตรง ๆ หรือของพ่วงที่อยู่ใต้ประเภทนั้น
    if not exists (
      select 1
        from assets a
        left join asset_types ty on ty.code = a.type_code
       where a.code = v_code
         and (a.type_code = p_type or ty.parent_code = p_type)
    ) then
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

    update asset_transfers
       set claimed_at = now(), claimed_by = v_for.id
     where asset_code = v_code and claimed_at is null;
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
    'count', array_length(p_codes, 1),
    'for_name', case when v_actor is null then null else v_for.full_name end
  );
end $$;

grant execute on function asset_checkout(text, text[], jsonb, jsonb, text, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- คืนเครื่อง — ม้วนของพ่วงเข้าประเภทแม่ ให้ตรงกับตอนเบิก
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
  v_proxy  boolean := false;
  v_type   text;
  v_txn    uuid;
  v_ref    text;
  v_code   text;
  v_out    bigint;
  v_owner  uuid;
  v_min    int;
  v_steps  int;
  v_photos int := coalesce(jsonb_array_length(p_photos), 0);
  v_refs   text[] := '{}';
  v_first  uuid := null;
  v_n      int := 0;
  r        jsonb;
begin
  select * into v_me from profiles where id = auth.uid();
  if v_me.id is null or not v_me.is_active then
    raise exception 'บัญชีนี้ใช้งานไม่ได้';
  end if;

  if p_codes is null or array_length(p_codes, 1) is null then
    raise exception 'ยังไม่ได้เลือกเครื่องที่จะคืน';
  end if;

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

    if v_owner <> v_me.id then
      if not my_can_proxy() then
        raise exception 'เครื่อง % ไม่ได้เบิกโดยคุณ', v_code;
      end if;
      v_proxy := true;
    end if;
  end loop;

  if not v_proxy then
    select coalesce(ty.parent_code, a.type_code) into v_type
      from assets a
      left join asset_types ty on ty.code = a.type_code
     where a.code = p_codes[1];
    select count(*) into v_steps from asset_photo_steps where type_code = v_type;
    select photo_min into v_min from asset_types where code = v_type;
    if v_steps > 0 then v_min := v_steps; end if;
    if v_photos < coalesce(v_min, 1) then
      raise exception 'ต้องถ่ายรูปสภาพตอนคืนให้ครบ % ใบก่อน (ถ่ายมาแล้ว % ใบ)',
        coalesce(v_min, 1), v_photos;
    end if;
  end if;

  for v_type in
    select distinct coalesce(ty.parent_code, a.type_code)
      from assets a
      left join asset_types ty on ty.code = a.type_code
     where a.code = any(p_codes)
     order by 1
  loop
    v_ref := next_asset_ref('in');
    insert into asset_txns (ref_no, kind, type_code, user_id, acted_by, dept_code,
                            shift_start, shift_end, note)
    values (v_ref, 'in', v_type, v_me.id,
            case when v_proxy then v_me.id else null end,
            v_me.dept_code, v_me.shift_start, v_me.shift_end, p_note)
    returning id into v_txn;

    v_refs := v_refs || v_ref;
    if v_first is null then v_first := v_txn; end if;

    for v_code in
      select a.code
        from assets a
        left join asset_types ty on ty.code = a.type_code
       where a.code = any(p_codes)
         and coalesce(ty.parent_code, a.type_code) = v_type
    loop
      insert into asset_txn_items (txn_id, asset_code, out_item_id)
      select v_txn, v_code, a.held_item_id from assets a where a.code = v_code;

      update assets set held_item_id = null, loan_user = null, loan_dept = null
       where code = v_code;
      v_n := v_n + 1;
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

    for r in
      select e.value
        from jsonb_array_elements(p_issues) e
        join assets a on a.code = e.value->>'asset_code'
        left join asset_types ty on ty.code = a.type_code
       where coalesce(ty.parent_code, a.type_code) = v_type
    loop
      insert into asset_issues (asset_code, txn_id, phase, symptom, reported_by, file_id, web_link)
      values (r->>'asset_code', v_txn, 'in', r->>'symptom', v_me.id,
              r->>'file_id', r->>'web_link');
    end loop;
  end loop;

  if coalesce(jsonb_array_length(p_issues), 0) > 0 then
    begin
      perform push_tick();
    exception when others then
      null;
    end;
  end if;

  return jsonb_build_object(
    'id', v_first,
    'ref_no', array_to_string(v_refs, ' · '),
    'refs', to_jsonb(v_refs),
    'count', v_n
  );
end $$;

grant execute on function asset_return(text[], jsonb, jsonb, text) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล — ของพ่วงต้องผ่านการตรวจประเภทของแม่ได้แล้ว
-- ---------------------------------------------------------------------
select a.code                              as เครื่อง,
       a.type_code                         as ประเภทจริง,
       coalesce(ty.parent_code, a.type_code) as นับเป็นประเภท
  from assets a
  left join asset_types ty on ty.code = a.type_code
 where ty.parent_code is not null
 order by a.code
 limit 10;
-- =====================================================================
-- BPL SUPPLY — ลบใบเบิก Asset ที่คืนไปแล้วได้
-- รันต่อจาก 047 · ปลอดภัยที่จะรันซ้ำ
--
-- อาการ: กดลบในหน้าหลักฐาน แล้วขึ้น
--   violates foreign key constraint "asset_txn_items_out_item_id_fkey"
--
-- สาเหตุ: แถวตอนคืนชี้กลับไปหาแถวตอนเบิก (out_item_id)
-- พอลบใบเบิก แถวของใบนั้นถูกลบตาม แต่แถวตอนคืนยังชี้อยู่ที่เดิม
-- ฐานข้อมูลจึงไม่ยอมลบ เพราะจะเหลือตัวชี้ที่ชี้ไปหาของที่ไม่มีแล้ว
--
-- ตัวกันของเดิมดูแค่ "ยังมีเครื่องไม่ได้คืนไหม" ซึ่งไม่ครอบเคสนี้
-- ใบที่คืนเรียบร้อยแล้วต่างหากที่มีตัวชี้ค้างอยู่ จึงลบไม่ได้มาตลอด
--
-- แก้โดยบอกฐานข้อมูลว่า ถ้าแถวตอนเบิกถูกลบ ให้ล้างตัวชี้เป็นว่าง
-- ไม่ใช่ลบแถวตอนคืนตามไปด้วย เพราะการคืนเกิดขึ้นจริง ลบทิ้งคือโกหกประวัติ
-- แถวคืนจะยังอยู่ แค่ไม่รู้แล้วว่าคู่กับการเบิกครั้งไหน — ซึ่งถูกต้อง
-- เพราะคนสั่งลบการเบิกครั้งนั้นทิ้งไปเอง
-- =====================================================================

alter table asset_txn_items
  drop constraint if exists asset_txn_items_out_item_id_fkey;

alter table asset_txn_items
  add constraint asset_txn_items_out_item_id_fkey
  foreign key (out_item_id) references asset_txn_items(id) on delete set null;


-- ---------------------------------------------------------------------
-- ตัวกันตอนลบ — อธิบายให้ตรงกับสิ่งที่เกิดขึ้นจริง
--
-- ของเดิมห้ามลบเฉพาะตอนยังมีเครื่องค้างอยู่ ซึ่งถูกแล้ว
-- เพิ่มคำอธิบายให้รู้ว่าลบใบเบิกแล้วประวัติการคืนที่คู่กันจะขาดคู่
-- ---------------------------------------------------------------------
create or replace function delete_evidence(p_kind text, p_id text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_txn uuid;
begin
  if my_role() <> 'admin' then
    raise exception 'เฉพาะเจ้าของระบบเท่านั้นที่ลบหลักฐานได้';
  end if;

  if p_kind = 'requisition' then
    delete from requisitions where id = p_id::uuid;

  elsif p_kind = 'return' then
    delete from returns where id = p_id::bigint;

  elsif p_kind in ('asset_out', 'asset_in') then
    v_txn := p_id::uuid;

    -- เครื่องที่ยังไม่ได้คืนห้ามลบ ไม่งั้นมันจะหลุดจากรายการค้างโดยไม่มีใครรู้ว่าอยู่ไหน
    if exists (
      select 1
      from asset_txn_items ai
      join assets a on a.held_item_id = ai.id
      where ai.txn_id = v_txn
    ) then
      raise exception 'ยังมีเครื่องในรายการนี้ที่ไม่ได้คืน กดคืนให้เรียบร้อยก่อนจึงจะลบได้';
    end if;

    delete from asset_txns where id = v_txn;

  else
    raise exception 'ไม่รู้จักประเภท %', p_kind;
  end if;
end $$;

grant execute on function delete_evidence(text, text) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล — ต้องขึ้น SET NULL
-- ---------------------------------------------------------------------
select tc.constraint_name                  as ชื่อเงื่อนไข,
       rc.delete_rule                      as เมื่อถูกลบให้ทำอะไร
  from information_schema.table_constraints tc
  join information_schema.referential_constraints rc
    on rc.constraint_name = tc.constraint_name
 where tc.table_name = 'asset_txn_items'
   and tc.constraint_name = 'asset_txn_items_out_item_id_fkey';
-- =====================================================================
-- BPL SUPPLY — ลบใบเบิกที่เคยถูกโอนได้
-- รันต่อจาก 048 · ปลอดภัยที่จะรันซ้ำ
--
-- 048 แก้ตัวชี้ระหว่างแถวเบิกกับแถวคืนไปแล้ว แต่ยังเหลืออีกตัวที่ชี้มาที่เดียวกัน
--   asset_transfers.out_item_id → asset_txn_items
-- ประวัติการโอนเครื่องจำไว้ว่า "ตัดของจากการเบิกแถวไหน"
-- พอลบใบเบิกนั้น ตัวชี้ก็ค้าง ฐานข้อมูลเลยไม่ยอมลบเหมือนเดิม
--
-- ไล่ตรวจทั้งฐานข้อมูลแล้ว เหลือตัวนี้ตัวเดียวที่ขวางการลบใบเบิก
-- อีกสองตัวที่ยังเป็น NO ACTION คือ asset_code ที่ชี้ไปตารางทะเบียนเครื่อง
-- สองตัวนั้นตั้งใจให้ขวาง เพราะห้ามลบเครื่องออกจากทะเบียนทั้งที่มีประวัติใช้งานอยู่
--
-- ล้างตัวชี้เป็นว่างแทนการลบแถวโอนตาม เพราะการโอนเกิดขึ้นจริง
-- ลบทิ้งคือลบหลักฐานว่าเครื่องเคยถูกย้ายมือ ซึ่งเป็นคนละเรื่องกับการลบใบเบิก
-- =====================================================================

alter table asset_transfers
  drop constraint if exists asset_transfers_out_item_id_fkey;

alter table asset_transfers
  add constraint asset_transfers_out_item_id_fkey
  foreign key (out_item_id) references asset_txn_items(id) on delete set null;


-- ---------------------------------------------------------------------
-- ตรวจผล — ต้องไม่เหลือตัวไหนชี้มาที่ asset_txn_items แบบ NO ACTION
-- ---------------------------------------------------------------------
select tc.table_name || '.' || kcu.column_name || '  [' || rc.delete_rule || ']' as ผลตรวจ
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
  join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
  join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name
 where tc.constraint_type = 'FOREIGN KEY'
   and ccu.table_name = 'asset_txn_items'
 order by 1;
-- =====================================================================
-- BPL SUPPLY — ลิงก์งาน
-- รันต่อจาก 049 · ปลอดภัยที่จะรันซ้ำ
--
-- ปุ่มสายฟ้าบนหัวแอพ เก็บลิงก์งานที่ต้องเปิดบ่อย
-- เจ้าของระบบเป็นคนใส่และแก้จากหน้าเว็บ ที่เหลือแค่กดเปิด
--
-- เห็นปุ่ม: แอดมิน เจ้าของระบบ และผู้ตรวจสอบ
-- แก้ลิงก์: เจ้าของระบบคนเดียว
--
-- ทำไมต้องคุมสิทธิ์ที่ฐานข้อมูล ไม่ใช่แค่ซ่อนปุ่ม
-- เพราะลิงก์บางอันอาจเป็นเอกสารภายในที่หน้างานไม่ควรเห็น
-- ซ่อนปุ่มอย่างเดียวคือใครเปิดหน้าเว็บดูก็ยังอ่านได้
-- =====================================================================

create table if not exists work_links (
  id         bigserial primary key,
  title      text not null,
  url        text not null,
  note       text,
  sort_no    integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists work_links_order_idx on work_links (sort_no, id);

alter table work_links enable row level security;

-- อ่านได้: แอดมิน เจ้าของระบบ ผู้ตรวจสอบ
drop policy if exists read_work_links on work_links;
create policy read_work_links on work_links for select to authenticated
  using (my_can_proxy());

-- แก้ได้: เจ้าของระบบคนเดียว
drop policy if exists write_work_links on work_links;
create policy write_work_links on work_links for all to authenticated
  using (my_role() = 'admin')
  with check (my_role() = 'admin');


-- ---------------------------------------------------------------------
-- บันทึกเวลาแก้ล่าสุด ไว้ดูว่าลิงก์ไหนเก่าแล้ว
-- ---------------------------------------------------------------------
create or replace function touch_work_link() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists work_links_touch on work_links;
create trigger work_links_touch before update on work_links
  for each row execute function touch_work_link();


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select 'ตาราง work_links' as สิ่งที่ตรวจ, count(*)::text as ผล
  from information_schema.tables where table_name = 'work_links'
union all select 'จำนวนลิงก์ตอนนี้', count(*)::text from work_links;
-- =====================================================================
-- BPL SUPPLY — แก้ชื่อและลบเครื่องในทะเบียน
-- รันต่อจาก 050 · ปลอดภัยที่จะรันซ้ำ
--
-- สองอย่างที่ทำไม่ได้มาตลอด
--   1. แก้รหัสเครื่อง — รหัสเป็นกุญแจที่ตารางอื่นชี้มา พอแก้แล้วตัวชี้ค้าง
--   2. ลบเครื่องที่เคยถูกเบิก — ประวัติชี้มาที่เครื่องนั้นอยู่
--
-- ข้อ 1 แก้ด้วย on update cascade · เปลี่ยนรหัสแล้วทุกที่ที่อ้างถึงเปลี่ยนตาม
--        ประวัติไม่ขาด เพราะมันตามไปเอง
--
-- ข้อ 2 เจ้าของระบบเลือกให้ลบได้หมด รวมประวัติ โดยยืนยันสองชั้น
--        จึงทำเป็น RPC ที่ไล่ลบลูกให้ครบก่อน ไม่ใช่เปิด cascade ทิ้งไว้
--        เพราะ cascade จะทำให้ลบพลาดทีเดียวหายทั้งประวัติโดยไม่มีอะไรทัดทาน
--
-- กันไว้ข้อเดียว: เครื่องที่มีคนถืออยู่ตอนนี้ลบไม่ได้
-- ไม่งั้นรายการค้างของเขาจะหายไปเฉย ๆ โดยไม่มีใครรู้ว่าเครื่องอยู่ไหน
-- ให้กดคืนหรือปิดรายการก่อน แล้วค่อยลบ
-- =====================================================================

-- ── แก้รหัสเครื่องแล้วให้ทุกที่ตามไปด้วย ──────────────────────────────
alter table asset_txn_items drop constraint if exists asset_txn_items_asset_code_fkey;
alter table asset_txn_items
  add constraint asset_txn_items_asset_code_fkey
  foreign key (asset_code) references assets(code) on update cascade;

alter table asset_transfers drop constraint if exists asset_transfers_asset_code_fkey;
alter table asset_transfers
  add constraint asset_transfers_asset_code_fkey
  foreign key (asset_code) references assets(code) on update cascade;

alter table asset_issues drop constraint if exists asset_issues_asset_code_fkey;
alter table asset_issues
  add constraint asset_issues_asset_code_fkey
  foreign key (asset_code) references assets(code) on update cascade on delete cascade;


-- ---------------------------------------------------------------------
-- RPC: ลบเครื่องออกจากทะเบียน พร้อมประวัติทั้งหมด
--
-- คืนค่าจำนวนที่ลบไป เพื่อให้หน้าจอบอกได้ว่าหายไปเท่าไหร่จริง ๆ
-- ---------------------------------------------------------------------
create or replace function delete_asset(p_code text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_holder text;
  v_txn    int := 0;
  v_iss    int := 0;
  v_trf    int := 0;
begin
  if my_role() not in ('supervisor', 'admin') then
    raise exception 'เฉพาะแอดมินและเจ้าของระบบเท่านั้นที่ลบเครื่องได้';
  end if;

  if not exists (select 1 from assets where code = p_code) then
    raise exception 'ไม่พบเครื่อง %', p_code;
  end if;

  -- เครื่องที่ยังอยู่ในมือใครลบไม่ได้ · รายการค้างจะหายเงียบ ๆ
  select h.holder_name into v_holder
    from asset_holdings h where h.asset_code = p_code;
  if v_holder is not null then
    raise exception 'เครื่อง % ยังอยู่กับ % · กดคืนหรือปิดรายการก่อนจึงจะลบได้', p_code, v_holder;
  end if;

  select count(*) into v_txn from asset_txn_items where asset_code = p_code;
  select count(*) into v_iss from asset_issues   where asset_code = p_code;
  select count(*) into v_trf from asset_transfers where asset_code = p_code;

  -- ตัดสายที่ชี้หากันเองก่อน ไม่งั้นลบไม่ได้เพราะติดกันเป็นลูกโซ่
  update asset_txn_items set out_item_id = null
   where out_item_id in (select id from asset_txn_items where asset_code = p_code);

  update assets set held_item_id = null, loan_user = null, loan_dept = null
   where code = p_code;

  delete from asset_transfers where asset_code = p_code;
  delete from asset_txn_items  where asset_code = p_code;
  delete from asset_issues     where asset_code = p_code;

  -- ใบไหนไม่เหลือเครื่องแล้วก็ลบทิ้ง จะได้ไม่มีใบเปล่าค้างในรายงาน
  delete from asset_txns t
   where not exists (select 1 from asset_txn_items i where i.txn_id = t.id);

  delete from assets where code = p_code;

  return jsonb_build_object(
    'code', p_code,
    'txn_items', v_txn,
    'issues', v_iss,
    'transfers', v_trf
  );
end $$;

grant execute on function delete_asset(text) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select 'ฟังก์ชันลบเครื่อง' as สิ่งที่ตรวจ, count(*)::text as ผล
  from pg_proc where proname = 'delete_asset'
union all
select tc.table_name || ' แก้รหัสตามได้', rc.update_rule
  from information_schema.table_constraints tc
  join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
  join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name
 where tc.constraint_type = 'FOREIGN KEY'
   and ccu.table_name = 'assets' and ccu.column_name = 'code'
 order by 1;
-- =====================================================================
-- BPL SUPPLY — ปรับกติกาการถ่ายรูปตามที่หน้างานใช้จริง
-- รันต่อจาก 051 · ปลอดภัยที่จะรันซ้ำ
--
-- Power Pallet
--   เดิม 5 ขั้น กุญแจ/หน้า/หลัง/ซ้าย/ขวา ซึ่งหน้างานต้องกดเปิดกล้อง 5 รอบ
--   จริง ๆ เขาเดินถ่ายรอบคันรวดเดียวแล้วค่อยเลือกทีหลัง
--   จึงเหลือ กุญแจ 1 ใบ แล้วรอบคันอีก 4 ใบ เลือกพร้อมกันได้
--   ยังบังคับ 5 ใบเท่าเดิม แค่เปลี่ยนวิธีเก็บให้ตรงกับที่เขาทำ
--
-- ไอดาต้าและเลเซอร์ลบ
--   บังคับอย่างน้อย 2 ใบ ด้านหน้าและด้านหลัง
--   แต่ไม่จำกัดจำนวนสูงสุด เผื่อใครอยากถ่ายเพิ่มให้ชัด
--   ไม่ใช้ระบบขั้นตอน เพราะจะไปล็อกจำนวนสูงสุดไว้เท่าจำนวนขั้น
-- =====================================================================

-- ── Power Pallet ─────────────────────────────────────────────────────
delete from asset_photo_steps where type_code = 'PP';

insert into asset_photo_steps (type_code, seq, label, hint) values
  ('PP', 1, 'กุญแจ',          'ถ่ายกุญแจที่ได้รับมา'),
  ('PP', 2, 'รอบคัน ใบที่ 1', 'ด้านหน้า'),
  ('PP', 3, 'รอบคัน ใบที่ 2', 'ด้านหลัง'),
  ('PP', 4, 'รอบคัน ใบที่ 3', 'ด้านซ้าย'),
  ('PP', 5, 'รอบคัน ใบที่ 4', 'ด้านขวา');

update asset_types set photo_min = 5, photo_max = 8 where code = 'PP';

-- ── ไอดาต้า และเลเซอร์ลบ ─────────────────────────────────────────────
-- ไม่มีขั้นตอนบังคับ ใช้จำนวนขั้นต่ำแทน จะได้ถ่ายเพิ่มได้ไม่จำกัด
delete from asset_photo_steps where type_code in ('IDATA', 'LASER');

update asset_types set photo_min = 2, photo_max = 10 where code = 'IDATA';

-- เลเซอร์ลบเป็นของพ่วง ถ่ายรวมกับไอดาต้าในใบเดียวกัน
-- จึงไม่บังคับรูปของตัวเอง ไม่งั้นจะโดนขอรูปสองรอบ
update asset_types set photo_min = 0, photo_max = 10 where code = 'LASER';

-- ── วิทยุ ────────────────────────────────────────────────────────────
update asset_types set photo_max = greatest(photo_max, 5) where code = 'RADIO';


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select t.name || '  ·  ขั้นต่ำ ' || t.photo_min || ' ใบ  ·  สูงสุด ' || t.photo_max ||
       ' ใบ  ·  ขั้นตอนบังคับ ' || coalesce(st.n, 0) || ' ขั้น' as ผลตรวจ
  from asset_types t
  left join lateral (
    select count(*) as n from asset_photo_steps s where s.type_code = t.code
  ) st on true
 where t.is_active
 order by t.sort_no;
-- =====================================================================
-- BPL SUPPLY — ลิงก์งาน เลือกได้ว่าใครเห็น
-- รันต่อจาก 052 · ปลอดภัยที่จะรันซ้ำ
--
-- เดิมลิงก์งานเห็นได้เฉพาะแอดมินกับผู้ตรวจสอบ ปุ่มสายฟ้าจึงซ่อนจากหน้างาน
-- ตอนนี้เปิดปุ่มให้ทุกคนเห็น แต่ "เห็นลิงก์ไหน" ต้องคุมเป็นรายลิงก์
-- ไม่งั้นเอกสารภายในจะหลุดไปถึงหน้างานทันทีที่เปิดปุ่ม
--
-- สามโหมดต่อหนึ่งลิงก์
--   all      ทุกคนในระบบเห็น
--   managers แอดมิน เจ้าของระบบ ผู้ตรวจสอบ (เหมือนเดิม — เป็นค่าตั้งต้น)
--   custom   เลือกเองว่าแผนกไหนบ้าง และ/หรือ ใครบ้างเป็นรายคน
--
-- ทำไมใช้ตารางเชื่อมแทน array ของรหัสแผนก
--   เจ้าของระบบเปลี่ยนชื่อแผนกได้อิสระ ถ้าเก็บเป็น array รหัสจะค้างเป็นของเก่า
--   แล้วสิทธิ์จะเพี้ยนเงียบ ๆ โดยไม่มีอะไรฟ้อง
--   ตารางเชื่อมมี foreign key + on update cascade รหัสจึงตามไปเอง
-- =====================================================================

-- ── โหมดผู้ชมของแต่ละลิงก์ ───────────────────────────────────────────
alter table work_links
  add column if not exists audience text not null default 'managers';

-- ของเดิมทั้งหมดเป็น managers อยู่แล้วจากค่าตั้งต้น พฤติกรรมเก่าจึงไม่เปลี่ยน
alter table work_links drop constraint if exists work_links_audience_chk;
alter table work_links add constraint work_links_audience_chk
  check (audience in ('all', 'managers', 'custom'));


-- ── แผนกที่เห็นลิงก์นี้ ──────────────────────────────────────────────
create table if not exists work_link_depts (
  link_id   bigint not null references work_links (id) on delete cascade,
  dept_code text   not null references departments (code) on update cascade on delete cascade,
  primary key (link_id, dept_code)
);

-- ── คนที่เห็นลิงก์นี้เป็นรายคน ───────────────────────────────────────
create table if not exists work_link_users (
  link_id bigint not null references work_links (id) on delete cascade,
  user_id uuid   not null references profiles (id) on delete cascade,
  primary key (link_id, user_id)
);

create index if not exists work_link_users_user_idx on work_link_users (user_id);


-- ---------------------------------------------------------------------
-- ตัวตัดสินว่าเห็นไหมในโหมด custom
--
-- ต้องเป็น security definer เพราะถูกเรียกจาก policy ของ work_links
-- ถ้าอ่านตารางเชื่อมตรง ๆ ใน policy มันจะไปติด RLS ของตารางเชื่อมอีกชั้น
-- แล้วหน้างานจะไม่เห็นอะไรเลยทั้งที่ตั้งสิทธิ์ให้แล้ว
-- ---------------------------------------------------------------------
create or replace function my_sees_work_link(p_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from work_link_depts d
     where d.link_id = p_id
       and (
            d.dept_code = 'ALL'          -- ตั้งไว้ว่าทุกแผนก
         or 'ALL' = any(my_depts())      -- คนที่สังกัด "ทุกแผนก"
         or d.dept_code = any(my_depts())
       )
  )
  or exists (
    select 1 from work_link_users u
     where u.link_id = p_id and u.user_id = auth.uid()
  );
$$;

grant execute on function my_sees_work_link(bigint) to authenticated;


-- ---------------------------------------------------------------------
-- สิทธิ์อ่าน
--
-- เจ้าของระบบเห็นทุกอันรวมที่ปิดอยู่ เพราะต้องจัดการในหน้าเว็บ
-- ที่เหลือเห็นเฉพาะที่เปิดใช้และตรงกับโหมดผู้ชม
-- ---------------------------------------------------------------------
drop policy if exists read_work_links on work_links;
create policy read_work_links on work_links for select to authenticated
  using (
    my_role() = 'admin'
    or (
      is_active
      and (
           audience = 'all'
        or (audience = 'managers' and my_can_proxy())
        or (audience = 'custom' and my_sees_work_link(id))
      )
    )
  );

-- ตารางเชื่อมเปิดให้เจ้าของระบบอย่างเดียว คนอื่นไม่ต้องอ่านเอง
-- เพราะการกรองเกิดที่ policy ของ work_links ไปแล้ว
alter table work_link_depts enable row level security;
alter table work_link_users enable row level security;

drop policy if exists manage_work_link_depts on work_link_depts;
create policy manage_work_link_depts on work_link_depts for all to authenticated
  using (my_role() = 'admin') with check (my_role() = 'admin');

drop policy if exists manage_work_link_users on work_link_users;
create policy manage_work_link_users on work_link_users for all to authenticated
  using (my_role() = 'admin') with check (my_role() = 'admin');


-- ---------------------------------------------------------------------
-- บันทึกลิงก์พร้อมผู้ชมในครั้งเดียว
--
-- ถ้าแยกเป็นหลายคำสั่งจากฝั่งหน้าเว็บ เน็ตหลุดกลางคันจะได้ลิงก์ที่
-- ตั้งโหมด custom ไว้แต่ไม่มีใครอยู่ในรายชื่อ = ไม่มีใครเห็นเลย
-- ---------------------------------------------------------------------
create or replace function save_work_link(
  p_id        bigint,
  p_title     text,
  p_url       text,
  p_note      text,
  p_sort_no   integer,
  p_is_active boolean,
  p_audience  text,
  p_depts     text[],
  p_users     uuid[]
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if my_role() <> 'admin' then
    raise exception 'เฉพาะเจ้าของระบบเท่านั้นที่แก้ลิงก์งานได้';
  end if;

  if coalesce(btrim(p_title), '') = '' or coalesce(btrim(p_url), '') = '' then
    raise exception 'ต้องใส่ทั้งชื่อและลิงก์';
  end if;

  if p_audience not in ('all', 'managers', 'custom') then
    raise exception 'โหมดผู้ชมไม่ถูกต้อง';
  end if;

  -- เลือกเองแต่ไม่ได้เลือกใครเลย = ลิงก์ที่ไม่มีใครเห็น ซึ่งไม่ใช่สิ่งที่ตั้งใจแน่ ๆ
  if p_audience = 'custom'
     and coalesce(array_length(p_depts, 1), 0) = 0
     and coalesce(array_length(p_users, 1), 0) = 0 then
    raise exception 'เลือกเองต้องเลือกอย่างน้อยหนึ่งแผนกหรือหนึ่งคน';
  end if;

  if p_id is null then
    insert into work_links (title, url, note, sort_no, is_active, audience)
    values (btrim(p_title), btrim(p_url), nullif(btrim(coalesce(p_note, '')), ''),
            coalesce(p_sort_no, 0), coalesce(p_is_active, true), p_audience)
    returning id into v_id;
  else
    update work_links
       set title     = btrim(p_title),
           url       = btrim(p_url),
           note      = nullif(btrim(coalesce(p_note, '')), ''),
           sort_no   = coalesce(p_sort_no, 0),
           is_active = coalesce(p_is_active, true),
           audience  = p_audience
     where id = p_id
    returning id into v_id;

    if v_id is null then
      raise exception 'ไม่พบลิงก์ที่จะแก้';
    end if;
  end if;

  -- เขียนทับรายชื่อทั้งชุด ง่ายกว่าไล่เทียบว่าอันไหนเพิ่มอันไหนลบ
  delete from work_link_depts where link_id = v_id;
  delete from work_link_users where link_id = v_id;

  if p_audience = 'custom' then
    insert into work_link_depts (link_id, dept_code)
    select v_id, d from unnest(coalesce(p_depts, '{}')) as d
     where exists (select 1 from departments x where x.code = d)
    on conflict do nothing;

    insert into work_link_users (link_id, user_id)
    select v_id, u from unnest(coalesce(p_users, '{}')) as u
     where exists (select 1 from profiles x where x.id = u)
    on conflict do nothing;
  end if;

  return v_id;
end $$;

grant execute on function save_work_link(bigint, text, text, text, integer, boolean, text, text[], uuid[])
  to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select 'คอลัมน์ audience' as สิ่งที่ตรวจ,
       count(*)::text as ผล
  from information_schema.columns
 where table_name = 'work_links' and column_name = 'audience'
union all
select 'ตาราง work_link_depts', count(*)::text
  from information_schema.tables where table_name = 'work_link_depts'
union all
select 'ตาราง work_link_users', count(*)::text
  from information_schema.tables where table_name = 'work_link_users'
union all
select 'ฟังก์ชัน save_work_link', count(*)::text
  from pg_proc where proname = 'save_work_link'
union all
select 'ลิงก์ที่เป็นโหมด managers อยู่', count(*)::text
  from work_links where audience = 'managers';
-- =====================================================================
-- BPL SUPPLY — ลิงก์งาน เลือกตามตำแหน่งได้ด้วย
-- รันต่อจาก 053 · ปลอดภัยที่จะรันซ้ำ
--
-- 053 เลือกได้แค่ "แผนกไหน" กับ "ใครบ้าง" ซึ่งยังไม่พอ
-- ของจริงคือบางลิงก์ให้เห็นแค่แอดมิน บางอันแค่ผู้ตรวจสอบ
-- บางอันแค่หน้างาน และบางอันแค่เจ้าของระบบคนเดียว
--
-- ผู้ตรวจสอบไม่ใช่ role ในฐานข้อมูล เป็นธงที่ปักบนคนที่ role เป็นอะไรก็ได้
-- จึงเก็บเป็น "คีย์ตำแหน่ง" 4 ค่าแทนที่จะอ้าง enum user_role ตรง ๆ
--   staff      หน้างาน
--   supervisor แอดมิน
--   admin      เจ้าของระบบ
--   dispatch   ผู้ตรวจสอบ (มาจากธง can_dispatch)
--
-- เจ้าของระบบยังเห็นทุกลิงก์เสมอไม่ว่าตั้งอะไรไว้ เพราะต้องเข้าไปแก้ได้
-- =====================================================================

create table if not exists work_link_roles (
  link_id  bigint not null references work_links (id) on delete cascade,
  role_key text   not null,
  primary key (link_id, role_key)
);

alter table work_link_roles drop constraint if exists work_link_roles_key_chk;
alter table work_link_roles add constraint work_link_roles_key_chk
  check (role_key in ('staff', 'supervisor', 'admin', 'dispatch'));

alter table work_link_roles enable row level security;

drop policy if exists manage_work_link_roles on work_link_roles;
create policy manage_work_link_roles on work_link_roles for all to authenticated
  using (my_role() = 'admin') with check (my_role() = 'admin');


-- ---------------------------------------------------------------------
-- ย้ายลิงก์โหมด managers เดิมมาเป็นการเลือกตำแหน่ง
--
-- ความหมายเท่าเดิมเป๊ะ (แอดมิน + เจ้าของระบบ + ผู้ตรวจสอบ)
-- แต่พอเป็นตำแหน่งแล้วเจ้าของระบบแก้ทีหลังได้ เช่นตัดผู้ตรวจสอบออก
-- ---------------------------------------------------------------------
insert into work_link_roles (link_id, role_key)
select l.id, r.k
  from work_links l
 cross join (values ('supervisor'), ('admin'), ('dispatch')) as r(k)
 where l.audience = 'managers'
on conflict do nothing;

update work_links set audience = 'custom' where audience = 'managers';


-- ---------------------------------------------------------------------
-- ตัวตัดสินว่าเห็นไหมในโหมด custom — เพิ่มเงื่อนไขตำแหน่ง
--
-- สามเงื่อนไขเป็น "หรือ" กัน ใครเข้าข้อใดข้อหนึ่งก็เห็น
-- ตั้งตำแหน่งกับแผนกพร้อมกันจึงหมายถึง "ตำแหน่งนี้ หรือ แผนกนี้"
-- ไม่ใช่ "ตำแหน่งนี้ที่อยู่แผนกนี้" — ถ้าอยากเจาะขนาดนั้นให้เลือกรายคนแทน
-- ---------------------------------------------------------------------
create or replace function my_sees_work_link(p_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from work_link_roles r
     where r.link_id = p_id
       and (
            r.role_key = my_role()::text
         or (r.role_key = 'dispatch' and my_can_dispatch())
       )
  )
  or exists (
    select 1
      from work_link_depts d
     where d.link_id = p_id
       and (
            d.dept_code = 'ALL'
         or 'ALL' = any(my_depts())
         or d.dept_code = any(my_depts())
       )
  )
  or exists (
    select 1 from work_link_users u
     where u.link_id = p_id and u.user_id = auth.uid()
  );
$$;

grant execute on function my_sees_work_link(bigint) to authenticated;


-- ---------------------------------------------------------------------
-- บันทึกลิงก์ — รับรายการตำแหน่งเพิ่มเข้ามา
--
-- ต้องทิ้งตัวเดิมก่อน ไม่งั้นจะมีฟังก์ชันชื่อซ้ำสองตัวคนละจำนวนพารามิเตอร์
-- แล้ว PostgREST จะเลือกไม่ถูกและตอบ 300 กลับมา
-- ---------------------------------------------------------------------
drop function if exists save_work_link(bigint, text, text, text, integer, boolean, text, text[], uuid[]);

create or replace function save_work_link(
  p_id        bigint,
  p_title     text,
  p_url       text,
  p_note      text,
  p_sort_no   integer,
  p_is_active boolean,
  p_audience  text,
  p_roles     text[],
  p_depts     text[],
  p_users     uuid[]
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
  v_n  integer;
begin
  if my_role() <> 'admin' then
    raise exception 'เฉพาะเจ้าของระบบเท่านั้นที่แก้ลิงก์งานได้';
  end if;

  if coalesce(btrim(p_title), '') = '' or coalesce(btrim(p_url), '') = '' then
    raise exception 'ต้องใส่ทั้งชื่อและลิงก์';
  end if;

  if p_audience not in ('all', 'custom') then
    raise exception 'โหมดผู้ชมไม่ถูกต้อง';
  end if;

  v_n := coalesce(array_length(p_roles, 1), 0)
       + coalesce(array_length(p_depts, 1), 0)
       + coalesce(array_length(p_users, 1), 0);

  -- เลือกเองแต่ไม่ได้เลือกใครเลย = ลิงก์ที่ไม่มีใครเห็น ซึ่งไม่ใช่สิ่งที่ตั้งใจแน่ ๆ
  if p_audience = 'custom' and v_n = 0 then
    raise exception 'เลือกเองต้องเลือกอย่างน้อยหนึ่งอย่าง — ตำแหน่ง แผนก หรือรายคน';
  end if;

  if p_id is null then
    insert into work_links (title, url, note, sort_no, is_active, audience)
    values (btrim(p_title), btrim(p_url), nullif(btrim(coalesce(p_note, '')), ''),
            coalesce(p_sort_no, 0), coalesce(p_is_active, true), p_audience)
    returning id into v_id;
  else
    update work_links
       set title     = btrim(p_title),
           url       = btrim(p_url),
           note      = nullif(btrim(coalesce(p_note, '')), ''),
           sort_no   = coalesce(p_sort_no, 0),
           is_active = coalesce(p_is_active, true),
           audience  = p_audience
     where id = p_id
    returning id into v_id;

    if v_id is null then
      raise exception 'ไม่พบลิงก์ที่จะแก้';
    end if;
  end if;

  -- เขียนทับทั้งชุด ง่ายกว่าไล่เทียบว่าอันไหนเพิ่มอันไหนลบ
  delete from work_link_roles where link_id = v_id;
  delete from work_link_depts where link_id = v_id;
  delete from work_link_users where link_id = v_id;

  if p_audience = 'custom' then
    insert into work_link_roles (link_id, role_key)
    select v_id, r from unnest(coalesce(p_roles, '{}')) as r
     where r in ('staff', 'supervisor', 'admin', 'dispatch')
    on conflict do nothing;

    insert into work_link_depts (link_id, dept_code)
    select v_id, d from unnest(coalesce(p_depts, '{}')) as d
     where exists (select 1 from departments x where x.code = d)
    on conflict do nothing;

    insert into work_link_users (link_id, user_id)
    select v_id, u from unnest(coalesce(p_users, '{}')) as u
     where exists (select 1 from profiles x where x.id = u)
    on conflict do nothing;
  end if;

  return v_id;
end $$;

grant execute on function
  save_work_link(bigint, text, text, text, integer, boolean, text, text[], text[], uuid[])
  to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_name = 'work_link_roles')                            as ตาราง_roles,
  (select count(*) from pg_proc where proname = 'save_work_link')    as จำนวนฟังก์ชันบันทึก,
  (select count(*) from work_links where audience = 'managers')      as ลิงก์ที่ยังค้างโหมดเก่า,
  (select count(*) from work_links where audience = 'all')           as ลิงก์ทุกคนเห็น,
  (select count(*) from work_links where audience = 'custom')        as ลิงก์เลือกเอง,
  (select count(*) from work_link_roles)                             as แถวตำแหน่งทั้งหมด;
-- =====================================================================
-- BPL SUPPLY — สถานะระบบ ดูว่าใกล้เต็มแผนฟรีหรือยัง
-- รันต่อจาก 054 · ปลอดภัยที่จะรันซ้ำ
--
-- เจ้าของระบบต้องรู้ได้เองว่าเหลือที่เท่าไหร่ ไม่ต้องรอให้ระบบล่มก่อน
-- แล้วค่อยมาถาม
--
-- ตัวเลขแบ่งเป็นสองชั้น ต้องแยกให้ชัดว่าอันไหนเป็นอันไหน
--   วัดจริง    ขนาดฐานข้อมูล จำนวนแถว จำนวนคนที่ล็อกอิน — ถามจาก Postgres ตรง ๆ
--   ประมาณการ  egress กับจำนวนครั้งที่เรียก Edge Function
--
-- ทำไม egress ถึงได้แค่ประมาณ
--   Supabase นับ egress ที่ชั้นเครือข่าย ไม่ได้เก็บไว้ในฐานข้อมูลของเรา
--   เราจึงคำนวณย้อนจากขนาดรูปที่บันทึกไว้ในคอลัมน์ bytes
--   ซึ่งครอบคลุมส่วนที่กินเยอะสุดจริง แต่ไม่รวมพวก JSON ปลีกย่อย
--   ตัวเลขทางการยังต้องดูที่หน้า Usage ของ Supabase หน้าจอจึงลิงก์ไปให้ด้วย
-- =====================================================================

create or replace function system_health() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_db        bigint;
  v_photo_n   bigint;
  v_photo_b   bigint;
  v_push      bigint;
  v_mau       bigint;
  v_first     timestamptz;
  v_days      numeric;
begin
  if not my_can_proxy() then
    raise exception 'ดูสถานะระบบได้เฉพาะแอดมินและผู้ตรวจสอบ';
  end if;

  v_db := pg_database_size(current_database());

  -- รูปในรอบ 30 วัน — รวมทั้งสามทาง เบิก คืน และ asset
  select count(*), coalesce(sum(bytes), 0) into v_photo_n, v_photo_b
    from (
      select p.bytes
        from asset_txn_photos p
        join asset_txns t on t.id = p.txn_id
       where t.created_at > now() - interval '30 days'
      union all
      select bytes from requisition_photos where created_at > now() - interval '30 days'
      union all
      select bytes from return_photos      where created_at > now() - interval '30 days'
    ) x;

  select count(*) into v_push
    from notification_log where sent_at > now() - interval '30 days';

  -- คนที่ล็อกอินหรือต่ออายุโทเคนใน 30 วัน = นิยาม MAU ของ Supabase
  select count(*) into v_mau
    from auth.users where last_sign_in_at > now() - interval '30 days';

  -- อัตราการโตของฐานข้อมูล คิดจากอายุข้อมูลจริงที่มีอยู่
  select min(created_at) into v_first from requisitions;
  v_first := least(v_first, (select min(created_at) from asset_txns));
  v_days  := greatest(extract(epoch from (now() - coalesce(v_first, now() - interval '1 day'))) / 86400, 1);

  return jsonb_build_object(
    'measured_at', now(),

    'db', jsonb_build_object(
      'bytes', v_db,
      'limit_bytes', 500 * 1024 * 1024,
      'per_day_bytes', round(v_db / v_days),
      'days_of_data', round(v_days)
    ),

    'tables', (
      select jsonb_agg(jsonb_build_object('name', t, 'bytes', b, 'rows', r) order by b desc)
        from (
          select c.relname as t,
                 pg_total_relation_size(c.oid) as b,
                 coalesce(s.n_live_tup, 0) as r
            from pg_class c
            join pg_namespace ns on ns.oid = c.relnamespace
            left join pg_stat_user_tables s on s.relid = c.oid
           where ns.nspname = 'public' and c.relkind = 'r'
           order by pg_total_relation_size(c.oid) desc
           limit 6
        ) y
    ),

    -- คูณสอง เพราะรูปหนึ่งใบวิ่งผ่าน Edge Function สองรอบ
    -- ขามาตอนอัปขึ้น Drive และขากลับตอนแอดมินเปิดดู
    'egress', jsonb_build_object(
      'est_bytes', v_photo_b * 2,
      'limit_bytes', 5::bigint * 1024 * 1024 * 1024,
      'photo_count', v_photo_n,
      'photo_bytes', v_photo_b
    ),

    'edge', jsonb_build_object(
      'est_calls', v_photo_n * 2 + v_push,
      'limit_calls', 500000,
      'uploads', v_photo_n,
      'pushes', v_push
    ),

    'mau', jsonb_build_object(
      'used', v_mau,
      'limit', 50000,
      'active_profiles', (select count(*) from profiles where is_active)
    ),

    'storage', jsonb_build_object(
      'note', 'รูปเก็บที่ Google Drive ไม่กินโควตา Supabase'
    )
  );
end $$;

grant execute on function system_health() to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select jsonb_pretty(system_health()) as ผลตรวจ;
-- =====================================================================
-- BPL SUPPLY — เก็บสถิติขนาดฐานข้อมูลรายวัน
-- รันต่อจาก 055 · ปลอดภัยที่จะรันซ้ำ
--
-- 055 คำนวณอัตราการโตด้วยวิธีที่ผิด คือเอาขนาดฐานข้อมูลทั้งก้อน
-- หารด้วยอายุของข้อมูลที่เก่าที่สุด
--
-- ปัญหาคือขนาดฐานข้อมูลส่วนใหญ่เป็นของที่มีมาตั้งแต่วันแรก
-- ทั้ง Postgres เอง ส่วนขยาย และระบบ auth ของ Supabase ซึ่งไม่โตตามการใช้งาน
-- พอเพิ่งล้างข้อมูลเทสไป อายุข้อมูลเหลือ 1 วัน สูตรเลยอ่านว่า
-- "โตวันละ 15.6 MB จะเต็มใน 31 วัน" ทั้งที่ความจริงโตวันละไม่กี่สิบ KB
--
-- ตัวเลขที่ผิดแบบน่าตกใจแย่กว่าไม่มีตัวเลข เพราะทำให้คนเลิกเชื่อทั้งหน้า
--
-- วิธีที่ถูกคือวัดของจริง จดขนาดไว้วันละครั้ง แล้วเทียบระหว่างวัน
-- ส่วนต่างที่ได้คือการโตจริง ไม่ปนกับฐานที่มีมาแต่แรก
-- ระหว่างที่ยังจดไม่ครบสัปดาห์ ให้บอกตรง ๆ ว่ายังบอกไม่ได้
-- =====================================================================

create table if not exists db_size_log (
  day   date   primary key,
  bytes bigint not null
);

alter table db_size_log enable row level security;

drop policy if exists read_db_size_log on db_size_log;
create policy read_db_size_log on db_size_log for select to authenticated
  using (my_can_proxy());


create or replace function system_health() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_db        bigint;
  v_photo_n   bigint;
  v_photo_b   bigint;
  v_push      bigint;
  v_mau       bigint;
  v_first     date;
  v_first_b   bigint;
  v_span      integer;
  v_per_day   bigint := null;
  v_days_left integer := null;
begin
  if not my_can_proxy() then
    raise exception 'ดูสถานะระบบได้เฉพาะแอดมินและผู้ตรวจสอบ';
  end if;

  v_db := pg_database_size(current_database());

  -- จดขนาดของวันนี้ไว้ เรียกกี่ครั้งก็ได้ เก็บแค่ค่าล่าสุดของวัน
  insert into db_size_log (day, bytes) values (current_date, v_db)
  on conflict (day) do update set bytes = excluded.bytes;

  -- เทียบกับวันที่เก่าที่สุดที่จดไว้ ต้องมีอย่างน้อย 7 วันถึงจะเชื่อได้
  select day, bytes into v_first, v_first_b
    from db_size_log order by day limit 1;

  v_span := current_date - v_first;

  if v_span >= 7 and v_db > v_first_b then
    v_per_day := (v_db - v_first_b) / v_span;
    if v_per_day > 0 then
      v_days_left := greatest((500 * 1024 * 1024 - v_db) / v_per_day, 0);
    end if;
  end if;

  select count(*), coalesce(sum(bytes), 0) into v_photo_n, v_photo_b
    from (
      select p.bytes
        from asset_txn_photos p
        join asset_txns t on t.id = p.txn_id
       where t.created_at > now() - interval '30 days'
      union all
      select bytes from requisition_photos where created_at > now() - interval '30 days'
      union all
      select bytes from return_photos      where created_at > now() - interval '30 days'
    ) x;

  select count(*) into v_push
    from notification_log where sent_at > now() - interval '30 days';

  select count(*) into v_mau
    from auth.users where last_sign_in_at > now() - interval '30 days';

  return jsonb_build_object(
    'measured_at', now(),

    'db', jsonb_build_object(
      'bytes', v_db,
      'limit_bytes', 500 * 1024 * 1024,
      -- null = ยังจดสถิติไม่ครบ 7 วัน หน้าจอต้องเขียนว่ายังบอกไม่ได้ ห้ามเดา
      'per_day_bytes', v_per_day,
      'days_left', v_days_left,
      'tracked_days', v_span
    ),

    'tables', (
      select jsonb_agg(jsonb_build_object('name', t, 'bytes', b, 'rows', r) order by b desc)
        from (
          select c.relname as t,
                 pg_total_relation_size(c.oid) as b,
                 coalesce(s.n_live_tup, 0) as r
            from pg_class c
            join pg_namespace ns on ns.oid = c.relnamespace
            left join pg_stat_user_tables s on s.relid = c.oid
           where ns.nspname = 'public' and c.relkind = 'r'
           order by pg_total_relation_size(c.oid) desc
           limit 6
        ) y
    ),

    -- คูณสอง เพราะรูปหนึ่งใบวิ่งผ่าน Edge Function สองรอบ
    -- ขามาตอนอัปขึ้น Drive และขากลับตอนแอดมินเปิดดู
    'egress', jsonb_build_object(
      'est_bytes', v_photo_b * 2,
      'limit_bytes', 5::bigint * 1024 * 1024 * 1024,
      'photo_count', v_photo_n,
      'photo_bytes', v_photo_b
    ),

    'edge', jsonb_build_object(
      'est_calls', v_photo_n * 2 + v_push,
      'limit_calls', 500000,
      'uploads', v_photo_n,
      'pushes', v_push
    ),

    'mau', jsonb_build_object(
      'used', v_mau,
      'limit', 50000,
      'active_profiles', (select count(*) from profiles where is_active)
    )
  );
end $$;

grant execute on function system_health() to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select jsonb_pretty(system_health() -> 'db') as ผลตรวจ_ส่วนฐานข้อมูล;
-- =====================================================================
-- BPL SUPPLY — สถานะวัสดุ "ดูอย่างเดียว"
-- รันต่อจาก 056 · ปลอดภัยที่จะรันซ้ำ
--
-- ของบางอย่างต้องเบิกผ่านระบบ BY ไม่ใช่แอพนี้
-- แต่หน้างานยังเข้ามากดเบิกในแอพอยู่เรื่อย ๆ เพราะไม่รู้
-- เลยกลายเป็นสต็อกในแอพถูกตัดทั้งที่ของจริงไม่ได้ออกจากชั้น
--
-- ทางแก้คือให้ของชิ้นนั้นยังเห็นสต็อกได้ แต่กดเบิกไม่ได้
-- พร้อมบอกเหตุผลไว้ตรงนั้นเลยว่าต้องไปเบิกที่ไหนแทน
-- ถ้าแค่ซ่อนของทิ้ง หน้างานจะนึกว่าของหมดแล้วเดินไปหยิบเองที่ชั้น
--
-- กระทบของที่ใช้อยู่ไหม — ไม่
--   คอลัมน์ใหม่มีค่าตั้งต้นเป็น false ทุกแถวเดิมจึงยังเบิกได้เหมือนเดิม
--   ด่านในฟังก์ชันเบิกจะเงียบสนิทจนกว่าจะมีคนกดสวิตช์เป็นรายตัว
--   ตัวฟังก์ชันคัดลอกมาจากของจริงที่ใช้อยู่ (035) เติมเฉพาะด่านนี้ ไม่แตะอย่างอื่น
-- =====================================================================

alter table items
  add column if not exists view_only      boolean not null default false,
  add column if not exists view_only_note text;

comment on column items.view_only is
  'true = โชว์สต็อกได้แต่กดเบิกในแอพไม่ได้ เช่นของที่ต้องเบิกผ่านระบบ BY';
comment on column items.view_only_note is
  'เหตุผลที่เบิกไม่ได้ · แสดงให้หน้างานเห็นตรงหน้ารายการ';


-- ---------------------------------------------------------------------
-- ฟังก์ชันเบิก — เหมือนเดิมทุกบรรทัด เพิ่มแค่ด่านตรวจ view_only
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

  -- กันกดซ้ำ · เน็ตฮับหลุดกลางคันบ่อย คนกดยืนยันแล้วจอค้างมักกดซ้ำ
  -- ทั้งที่รอบแรกเข้าไปแล้วและตัดสต็อกไปแล้ว รอบสองจะตัดซ้ำอีกชุด
  -- ถ้าคนเดิมส่งรายการชุดเดิมเป๊ะ ๆ ภายในสองนาที ถือว่าเป็นใบเดิม
  -- ไม่ใช่ error เพราะสิ่งที่ผู้ใช้ต้องการคือ 'เบิกแล้ว' ซึ่งเป็นจริง
  select r.id, r.ref_no, r.status into v_req_id, v_ref, v_status
    from requisitions r
   where r.requester_id = v_profile.id
     and r.created_at > now() - interval '2 minutes'
     and (
       select coalesce(jsonb_agg(jsonb_build_object('item_id', li.item_id, 'qty', li.qty_requested)
                                 order by li.item_id), '[]'::jsonb)
       from requisition_items li where li.requisition_id = r.id
     ) = (
       select coalesce(jsonb_agg(jsonb_build_object('item_id', (x->>'item_id')::bigint,
                                                    'qty', (x->>'qty')::int)
                                 order by (x->>'item_id')::bigint), '[]'::jsonb)
       from jsonb_array_elements(p_lines) x
     )
   order by r.created_at desc
   limit 1;

  if v_req_id is not null then
    return jsonb_build_object('ref_no', v_ref, 'id', v_req_id,
                              'status', v_status, 'duplicate', true);
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

    -- ด่านของ "ดูอย่างเดียว"
    -- ของบางอย่างต้องไปเบิกในระบบ BY แต่หน้างานยังเผลอมากดเบิกในแอพนี้
    -- ซ่อนปุ่มอย่างเดียวไม่พอ เพราะยิง API ตรงก็ยังเบิกได้อยู่ดี
    -- ทุกแถวตอนนี้ view_only = false ด่านนี้จึงยังไม่ทำงานกับใครเลย
    -- จนกว่าเจ้าของระบบจะกดสวิตช์เป็นรายตัวเอง
    if v_item.view_only then
      raise exception '% เบิกในแอพนี้ไม่ได้ · %',
        v_item.name,
        coalesce(nullif(btrim(v_item.view_only_note), ''), 'ดูสต็อกได้อย่างเดียว');
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
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'items' and column_name = 'view_only')      as มีคอลัมน์สถานะ,
  (select count(*) from information_schema.columns
    where table_name = 'items' and column_name = 'view_only_note') as มีคอลัมน์เหตุผล,
  (select count(*) from items where view_only)                     as ของที่ตั้งเป็นดูอย่างเดียว,
  (select count(*) from items where is_active)                     as ของที่เปิดใช้ทั้งหมด;
-- =====================================================================
-- BPL SUPPLY — เปิดสิทธิ์แอดมินให้ทำงานแทนเจ้าของระบบได้
-- รันต่อจาก 057 · ปลอดภัยที่จะรันซ้ำ
--
-- เจ้าของระบบจะให้แอดมิน (role = supervisor) ทำงานแทนได้ทุกอย่าง
-- ที่เหลือไว้เฉพาะเจ้าของมีสองกลุ่มเท่านั้น
--
--   ① ลิงก์งานที่ตั้งให้เห็นเฉพาะเจ้าของ
--      แอดมินยังเห็นเฉพาะลิงก์ที่ตัวเองมีสิทธิ์เหมือนเดิม
--      และแก้ได้เฉพาะอันที่ตัวเองเห็น — อันที่มองไม่เห็นก็แตะไม่ได้ด้วย
--
--   ② การแต่งตั้งเจ้าของระบบ
--      แอดมินแก้บัญชีคนอื่นได้หมด แต่แตะบัญชีที่เป็นเจ้าของระบบไม่ได้
--      และตั้งใครเป็นเจ้าของระบบไม่ได้ รวมถึงตั้งตัวเองด้วย
--      ถ้าไม่กันข้อนี้ คำว่า "เท่ากัน" จะกลายเป็น "ใครก็ยึดระบบได้"
--      ซึ่งไม่ใช่สิ่งที่เจ้าของขอ
-- =====================================================================

-- ---------------------------------------------------------------------
-- ① จัดการผู้ใช้ — แอดมินทำได้ ยกเว้นแตะบัญชีเจ้าของระบบ
--
-- using      = แถวเดิมที่จะไปยุ่งด้วย ต้องไม่ใช่เจ้าของระบบ
-- with check = แถวหลังแก้ ต้องไม่กลายเป็นเจ้าของระบบ
-- สองอันคู่กันจึงกันได้ทั้ง "ไปลดขั้นเจ้าของ" และ "เลื่อนขั้นตัวเอง"
-- ---------------------------------------------------------------------
drop policy if exists write_profiles on profiles;
create policy write_profiles on profiles for all to authenticated
  using (
    my_role() = 'admin'
    or (my_role() = 'supervisor' and role <> 'admin')
  )
  with check (
    my_role() = 'admin'
    or (my_role() = 'supervisor' and role <> 'admin')
  );


-- ---------------------------------------------------------------------
-- ② ลิงก์งาน — แอดมินจัดการได้เฉพาะอันที่ตัวเองมองเห็น
--
-- นโยบายอ่านไม่แตะเลย แอดมินจึงยังเห็นเท่าเดิมเป๊ะ
-- ส่วนการเขียน ผูกกับ "มองเห็นไหม" เพื่อไม่ให้ลบหรือแก้อันที่ไม่เคยเห็น
-- ด้วยการเดาเลข id เอา
-- ---------------------------------------------------------------------
drop policy if exists write_work_links on work_links;
create policy write_work_links on work_links for all to authenticated
  using (
    my_role() = 'admin'
    or (my_role() = 'supervisor' and (audience = 'all' or my_sees_work_link(id)))
  )
  with check (
    my_role() = 'admin' or my_role() = 'supervisor'
  );

-- ตารางผู้ชม — เปิดให้แอดมินเฉพาะแถวของลิงก์ที่ตัวเองเห็น
-- ตัว exists ข้างในวิ่งผ่าน RLS ของ work_links อีกชั้น จึงกรองให้เองอัตโนมัติ
drop policy if exists manage_work_link_roles on work_link_roles;
create policy manage_work_link_roles on work_link_roles for all to authenticated
  using (
    my_role() = 'admin'
    or (my_role() = 'supervisor'
        and exists (select 1 from work_links l where l.id = link_id))
  )
  with check (my_role() in ('admin', 'supervisor'));

drop policy if exists manage_work_link_depts on work_link_depts;
create policy manage_work_link_depts on work_link_depts for all to authenticated
  using (
    my_role() = 'admin'
    or (my_role() = 'supervisor'
        and exists (select 1 from work_links l where l.id = link_id))
  )
  with check (my_role() in ('admin', 'supervisor'));

drop policy if exists manage_work_link_users on work_link_users;
create policy manage_work_link_users on work_link_users for all to authenticated
  using (
    my_role() = 'admin'
    or (my_role() = 'supervisor'
        and exists (select 1 from work_links l where l.id = link_id))
  )
  with check (my_role() in ('admin', 'supervisor'));


-- ---------------------------------------------------------------------
-- ฟังก์ชันบันทึกลิงก์ — เปิดให้แอดมิน แต่แก้ได้เฉพาะอันที่ตัวเองเห็น
--
-- ฟังก์ชันนี้เป็น security definer จึงข้าม RLS ไปเลย
-- ต้องเช็คเองในตัวฟังก์ชัน ไม่งั้นแอดมินจะยิงแก้ลิงก์ของเจ้าของได้ตรง ๆ
-- ---------------------------------------------------------------------
create or replace function save_work_link(
  p_id        bigint,
  p_title     text,
  p_url       text,
  p_note      text,
  p_sort_no   integer,
  p_is_active boolean,
  p_audience  text,
  p_roles     text[],
  p_depts     text[],
  p_users     uuid[]
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
  v_n  integer;
begin
  if my_role() not in ('admin', 'supervisor') then
    raise exception 'เฉพาะเจ้าของระบบและแอดมินเท่านั้นที่แก้ลิงก์งานได้';
  end if;

  -- แอดมินแก้ได้เฉพาะลิงก์ที่ตัวเองมองเห็น
  if p_id is not null and my_role() = 'supervisor' then
    if not exists (
      select 1 from work_links
       where id = p_id and (audience = 'all' or my_sees_work_link(id))
    ) then
      raise exception 'ลิงก์นี้ตั้งไว้ให้เห็นเฉพาะบางคน คุณจึงแก้ไม่ได้';
    end if;
  end if;

  if coalesce(btrim(p_title), '') = '' or coalesce(btrim(p_url), '') = '' then
    raise exception 'ต้องใส่ทั้งชื่อและลิงก์';
  end if;

  if p_audience not in ('all', 'custom') then
    raise exception 'โหมดผู้ชมไม่ถูกต้อง';
  end if;

  v_n := coalesce(array_length(p_roles, 1), 0)
       + coalesce(array_length(p_depts, 1), 0)
       + coalesce(array_length(p_users, 1), 0);

  if p_audience = 'custom' and v_n = 0 then
    raise exception 'เลือกเองต้องเลือกอย่างน้อยหนึ่งอย่าง — ตำแหน่ง แผนก หรือรายคน';
  end if;

  if p_id is null then
    insert into work_links (title, url, note, sort_no, is_active, audience)
    values (btrim(p_title), btrim(p_url), nullif(btrim(coalesce(p_note, '')), ''),
            coalesce(p_sort_no, 0), coalesce(p_is_active, true), p_audience)
    returning id into v_id;
  else
    update work_links
       set title     = btrim(p_title),
           url       = btrim(p_url),
           note      = nullif(btrim(coalesce(p_note, '')), ''),
           sort_no   = coalesce(p_sort_no, 0),
           is_active = coalesce(p_is_active, true),
           audience  = p_audience
     where id = p_id
    returning id into v_id;

    if v_id is null then
      raise exception 'ไม่พบลิงก์ที่จะแก้';
    end if;
  end if;

  delete from work_link_roles where link_id = v_id;
  delete from work_link_depts where link_id = v_id;
  delete from work_link_users where link_id = v_id;

  if p_audience = 'custom' then
    insert into work_link_roles (link_id, role_key)
    select v_id, r from unnest(coalesce(p_roles, '{}')) as r
     where r in ('staff', 'supervisor', 'admin', 'dispatch')
    on conflict do nothing;

    insert into work_link_depts (link_id, dept_code)
    select v_id, d from unnest(coalesce(p_depts, '{}')) as d
     where exists (select 1 from departments x where x.code = d)
    on conflict do nothing;

    insert into work_link_users (link_id, user_id)
    select v_id, u from unnest(coalesce(p_users, '{}')) as u
     where exists (select 1 from profiles x where x.id = u)
    on conflict do nothing;
  end if;

  return v_id;
end $$;

grant execute on function
  save_work_link(bigint, text, text, text, integer, boolean, text, text[], text[], uuid[])
  to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_policies
    where tablename = 'profiles' and policyname = 'write_profiles')      as นโยบายผู้ใช้,
  (select count(*) from pg_policies
    where tablename = 'work_links' and policyname = 'write_work_links')  as นโยบายลิงก์,
  (select count(*) from profiles where role = 'admin'  and is_active)    as เจ้าของระบบ,
  (select count(*) from profiles where role = 'supervisor' and is_active) as แอดมิน,
  (select count(*) from profiles where can_dispatch and is_active)       as ผู้ตรวจสอบ;
-- =====================================================================
-- BPL SUPPLY — หน้าต่างเวลาเช็คชื่อประชุม และป้ายประกาศ
-- รันต่อจาก 058 · ปลอดภัยที่จะรันซ้ำ
--
-- ① หน้าต่างเวลาเช็คชื่อ
--    เดิมประกาศนัดแล้วเช็คอินได้ทันทีตลอดเวลา ไม่มีคำว่าสาย
--    ตอนนี้แบ่งเป็นสามช่วง เปิดก่อนกี่นาที และสายหลังกี่นาที
--
--    เวลาทั้งหมดคิดจากนาฬิกาของฐานข้อมูล ไม่ใช่นาฬิกาในมือถือ
--    ถ้าเชื่อเครื่องผู้ใช้ ใครหมุนเวลาถอยหลังก็เช็คอินไม่สายได้ตลอด
--    หน้าจอจึงได้รับ "เหลืออีกกี่วินาที" มาจากเซิร์ฟเวอร์แล้วนับถอยหลังเอง
--
-- ② ป้ายประกาศ
--    ที่เดียวกันกับที่คนเปิดมาเช็คอิน จึงเป็นที่ที่คนมองอยู่แล้ว
--    บังคับวันหมดอายุเสมอ เพราะป้ายที่ค้างสิบอันคือป้ายที่ไม่มีใครอ่าน
--
-- กระทบของที่ใช้อยู่ไหม — ไม่
--    คอลัมน์ใหม่มีค่าตั้งต้น นัดเก่าที่ยังไม่ถึงเวลาจึงได้กติกาเดียวกันอัตโนมัติ
--    ตารางประกาศเป็นของใหม่ทั้งตาราง ไม่มีอะไรเดิมพึ่งพามัน
-- =====================================================================

-- ---------------------------------------------------------------------
-- ① กติกาเวลาของการประชุม
-- ---------------------------------------------------------------------
alter table meeting_events
  add column if not exists open_before_min integer not null default 15,
  add column if not exists late_after_min  integer not null default 10;

alter table meeting_events drop constraint if exists meeting_events_window_chk;
alter table meeting_events add constraint meeting_events_window_chk
  check (open_before_min between 0 and 240 and late_after_min between 0 and 240);

comment on column meeting_events.open_before_min is
  'เปิดให้เช็คชื่อก่อนเวลานัดกี่นาที';
comment on column meeting_events.late_after_min is
  'เลยเวลานัดเกินกี่นาทีถือว่าสาย';

-- ค่าตั้งต้นกลาง ใช้ตอนสร้างนัดใหม่ ปรับรายนัดทีหลังได้
insert into app_settings (key, value) values
  ('meeting_open_before_min', '15'::jsonb),
  ('meeting_late_after_min',  '10'::jsonb)
on conflict (key) do nothing;

-- เช็คอินผูกกับนัด และจำไว้ว่าสายไหม
alter table meeting_checkins
  add column if not exists event_id uuid references meeting_events (id) on delete set null,
  add column if not exists is_late  boolean not null default false,
  add column if not exists late_min integer;

create index if not exists meeting_checkins_event_idx on meeting_checkins (event_id);


-- ---------------------------------------------------------------------
-- นัดที่กำลังเปิดให้เช็คชื่อ พร้อมตัวเลขนับถอยหลัง
--
-- คืนค่าเป็น "อีกกี่วินาที" ไม่ใช่เวลาเป้าหมาย
-- เพราะถ้าส่งเวลาเป้าหมายไป หน้าจอจะเอาไปลบกับนาฬิกาเครื่องตัวเอง
-- ซึ่งเป็นสิ่งที่เราตั้งใจไม่เชื่อตั้งแต่แรก
-- ---------------------------------------------------------------------
create or replace function meeting_now()
returns table (
  id            uuid,
  title         text,
  meet_at       timestamptz,
  place         text,
  audience      text,
  note          text,
  phase         text,      -- soon | open | late
  opens_in_sec  integer,   -- > 0 = ยังไม่ถึงเวลาเปิด
  closes_in_sec integer,   -- > 0 = เหลือเวลาก่อนถือว่าสาย
  late_by_sec   integer,   -- > 0 = เลยมาแล้วกี่วินาที
  checked_in    boolean
)
language sql stable security definer set search_path = public as $$
  with e as (
    select *
      from meeting_events
     where cancelled_at is null
       and now() < meet_at + (late_after_min || ' minutes')::interval + interval '6 hours'
       and now() > meet_at - interval '1 day'
     order by meet_at
     limit 1
  )
  select
    e.id, e.title, e.meet_at, e.place, e.audience, e.note,
    case
      when now() < e.meet_at - (e.open_before_min || ' minutes')::interval then 'soon'
      when now() <= e.meet_at + (e.late_after_min  || ' minutes')::interval then 'open'
      else 'late'
    end,
    greatest(ceil(extract(epoch from
      (e.meet_at - (e.open_before_min || ' minutes')::interval) - now()))::int, 0),
    greatest(ceil(extract(epoch from
      (e.meet_at + (e.late_after_min || ' minutes')::interval) - now()))::int, 0),
    greatest(floor(extract(epoch from
      now() - (e.meet_at + (e.late_after_min || ' minutes')::interval)))::int, 0),
    exists (
      select 1 from meeting_checkins c
       where c.event_id = e.id and c.user_id = auth.uid()
    )
  from e;
$$;

grant execute on function meeting_now() to authenticated;


-- ---------------------------------------------------------------------
-- เช็คอิน — ผูกกับนัดและตัดสินว่าสายไหมที่ฝั่งนี้
--
-- ห้ามให้หน้าจอส่งคำว่า "สาย" มาเอง ต้องคำนวณจากนาฬิกาฐานข้อมูลเท่านั้น
-- ไม่งั้นแก้ค่าใน DevTools แล้วไม่สายได้ทุกครั้ง
-- ---------------------------------------------------------------------
create or replace function meeting_checkin(
  p_file_id  text,
  p_web_link text default null,
  p_bytes    integer default null,
  p_note     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me    profiles%rowtype;
  v_dup   meeting_checkins%rowtype;
  v_ref   text;
  v_id    uuid;
  v_ev    meeting_events%rowtype;
  v_late  boolean := false;
  v_lmin  integer := null;
begin
  select * into v_me from profiles where id = auth.uid();
  if v_me.id is null or not v_me.is_active then
    raise exception 'บัญชีนี้ใช้งานไม่ได้';
  end if;

  if p_file_id is null or btrim(p_file_id) = '' then
    raise exception 'ต้องมีรูปเซลฟี่ก่อนถึงจะเช็คอินได้';
  end if;

  -- หานัดที่ใกล้ที่สุดที่ยังอยู่ในกรอบเวลา
  select * into v_ev
    from meeting_events
   where cancelled_at is null
     and now() >= meet_at - (open_before_min || ' minutes')::interval
     and now() <  meet_at + (late_after_min  || ' minutes')::interval + interval '6 hours'
   order by meet_at
   limit 1;

  -- มีนัดอยู่ แต่ยังไม่ถึงเวลาเปิด = ห้ามเช็คอิน
  if v_ev.id is null then
    if exists (
      select 1 from meeting_events
       where cancelled_at is null
         and now() < meet_at - (open_before_min || ' minutes')::interval
         and meet_at < now() + interval '1 day'
    ) then
      raise exception 'ยังไม่ถึงเวลาเช็คชื่อ รอให้ถึงเวลาที่ประกาศไว้ก่อน';
    end if;
  else
    if now() > v_ev.meet_at + (v_ev.late_after_min || ' minutes')::interval then
      v_late := true;
      v_lmin := floor(extract(epoch from
        now() - (v_ev.meet_at + (v_ev.late_after_min || ' minutes')::interval)) / 60)::int;
    end if;
  end if;

  select * into v_dup
    from meeting_checkins
   where user_id = v_me.id
     and created_at > now() - interval '10 minutes'
   order by created_at desc
   limit 1;

  if v_dup.id is not null then
    return jsonb_build_object(
      'id', v_dup.id, 'ref_no', v_dup.ref_no,
      'created_at', v_dup.created_at, 'duplicate', true,
      'is_late', v_dup.is_late, 'late_min', v_dup.late_min
    );
  end if;

  v_ref := next_meeting_ref();
  insert into meeting_checkins (ref_no, user_id, hub_code, dept_code, sub_dept,
                                shift_start, shift_end, note, file_id, web_link, bytes,
                                event_id, is_late, late_min)
  values (v_ref, v_me.id, coalesce(v_me.hub_code, 'BPL'), v_me.dept_code, v_me.sub_dept,
          v_me.shift_start, v_me.shift_end, nullif(btrim(p_note), ''),
          p_file_id, p_web_link, p_bytes,
          v_ev.id, v_late, v_lmin)
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id, 'ref_no', v_ref, 'created_at', now(), 'duplicate', false,
    'is_late', v_late, 'late_min', v_lmin
  );
end $$;

grant execute on function meeting_checkin(text, text, integer, text) to authenticated;


-- ---------------------------------------------------------------------
-- สร้างนัด — รับกติกาเวลาเข้ามาด้วย
-- ---------------------------------------------------------------------
drop function if exists create_meeting_event(text, timestamptz, text, text, text);

create or replace function create_meeting_event(
  p_title       text,
  p_meet_at     timestamptz,
  p_audience    text default null,
  p_place       text default null,
  p_note        text default null,
  p_open_before integer default null,
  p_late_after  integer default null
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_id   uuid;
  v_open integer;
  v_late integer;
begin
  if not my_can_audit() then
    raise exception 'บัญชีนี้นัดประชุมไม่ได้';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'ต้องใส่เรื่องที่จะประชุม';
  end if;
  if p_meet_at is null then
    raise exception 'ต้องเลือกวันและเวลา';
  end if;

  v_open := coalesce(p_open_before,
    (select (value)::int from app_settings where key = 'meeting_open_before_min'), 15);
  v_late := coalesce(p_late_after,
    (select (value)::int from app_settings where key = 'meeting_late_after_min'), 10);

  insert into meeting_events (title, meet_at, audience, place, note, created_by,
                              open_before_min, late_after_min)
  values (btrim(p_title), p_meet_at, nullif(btrim(p_audience), ''),
          nullif(btrim(p_place), ''), nullif(btrim(p_note), ''), auth.uid(),
          v_open, v_late)
  returning id into v_id;

  begin
    perform push_tick();
  exception when others then
    raise notice 'ประกาศแล้วแต่เตะแจ้งเตือนไม่สำเร็จ (%) เดี๋ยวรอบถัดไปจะส่งให้เอง', sqlerrm;
  end;

  return jsonb_build_object('id', v_id);
end $fn$;

grant execute on function
  create_meeting_event(text, timestamptz, text, text, text, integer, integer)
  to authenticated;


-- =====================================================================
-- ② ป้ายประกาศ
-- =====================================================================
create table if not exists announcements (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text,
  level      text not null default 'info',
  /** หมดอายุแล้วหายจากหน้าแอพเอง ไม่ต้องมีใครมาตามลบ */
  expires_at timestamptz not null,
  notify     boolean not null default true,
  created_by uuid not null references profiles (id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);

alter table announcements drop constraint if exists announcements_level_chk;
alter table announcements add constraint announcements_level_chk
  check (level in ('urgent', 'warn', 'info'));

create index if not exists announcements_live_idx
  on announcements (expires_at desc) where cancelled_at is null;

alter table announcements enable row level security;

-- ทุกคนอ่านได้เฉพาะที่ยังไม่หมดอายุ ส่วนคนคุมเห็นหมดรวมที่หมดแล้ว
drop policy if exists read_announcements on announcements;
create policy read_announcements on announcements for select to authenticated
  using (my_can_audit() or (cancelled_at is null and expires_at > now()));

-- เขียนได้: เจ้าของระบบ แอดมิน ผู้ตรวจสอบ
drop policy if exists write_announcements on announcements;
create policy write_announcements on announcements for all to authenticated
  using (my_can_audit()) with check (my_can_audit());


-- ---------------------------------------------------------------------
-- ประกาศแล้วแจ้งเตือนออกทันที ไม่ต้องรอรอบนาฬิกา
-- ---------------------------------------------------------------------
create or replace function create_announcement(
  p_title   text,
  p_body    text default null,
  p_level   text default 'info',
  p_days    integer default 3,
  p_notify  boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not my_can_audit() then
    raise exception 'บัญชีนี้ประกาศไม่ได้';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'ต้องใส่หัวข้อประกาศ';
  end if;
  if p_level not in ('urgent', 'warn', 'info') then
    raise exception 'ระดับความสำคัญไม่ถูกต้อง';
  end if;

  insert into announcements (title, body, level, expires_at, notify, created_by)
  values (btrim(p_title), nullif(btrim(coalesce(p_body, '')), ''), p_level,
          now() + (greatest(coalesce(p_days, 3), 1) || ' days')::interval,
          coalesce(p_notify, true), auth.uid())
  returning id into v_id;

  if coalesce(p_notify, true) then
    begin
      perform push_tick();
    exception when others then
      raise notice 'ประกาศแล้วแต่เตะแจ้งเตือนไม่สำเร็จ (%)', sqlerrm;
    end;
  end if;

  return jsonb_build_object('id', v_id);
end $$;

grant execute on function create_announcement(text, text, text, integer, boolean) to authenticated;


-- ---------------------------------------------------------------------
-- งานแจ้งเตือนของประกาศ — ต่อท้ายของประชุมที่มีอยู่แล้ว
--
-- ยิงรอบเดียวต่อคนต่อประกาศ เหมือนที่นัดประชุมทำ
-- คนประกาศได้รับด้วย เพราะเจ้าของระบบขอให้เตือนตัวเองด้วย
-- ---------------------------------------------------------------------
create or replace function push_announcement_jobs()
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'announce_new',
      'subject', a.id::text,
      'user_id', m.id,
      'title',   case a.level when 'urgent' then 'ด่วน · ' when 'warn' then 'แจ้งเตือน · '
                              else 'ประกาศ · ' end || a.title,
      'body',    coalesce(a.body, 'เปิดแอพเพื่อดูรายละเอียด'),
      'url',     '/'
    ))
    from announcements a
    cross join (select id from profiles where is_active) m
    where a.cancelled_at is null
      and a.notify
      and a.expires_at > now()
      and a.created_at > now() - interval '1 day'
      and not exists (
        select 1 from notification_log n
        where n.kind = 'announce_new' and n.subject = a.id::text and n.user_id = m.id
      )
  ), '[]'::jsonb);
end $$;

grant execute on function push_announcement_jobs() to authenticated, service_role;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'meeting_events' and column_name = 'open_before_min')  as กติกาเวลา,
  (select count(*) from information_schema.columns
    where table_name = 'meeting_checkins' and column_name = 'is_late')        as ช่องบันทึกสาย,
  (select count(*) from information_schema.tables
    where table_name = 'announcements')                                       as ตารางประกาศ,
  (select count(*) from pg_proc where proname = 'meeting_now')                as ฟังก์ชันนับถอยหลัง,
  (select count(*) from pg_proc where proname = 'create_meeting_event')       as ฟังก์ชันนัดประชุม,
  (select count(*) from meeting_events where cancelled_at is null)            as นัดที่ยังอยู่;


-- ---------------------------------------------------------------------
-- ต่อประกาศเข้ากับคิวแจ้งเตือนเดิม
--
-- ต้องมาหลังจากประกาศฟังก์ชันงานประกาศแล้ว ไม่งั้นตัวห่อจะอ้างถึงของที่ยังไม่มี
-- ---------------------------------------------------------------------
create or replace function push_due_jobs()
returns jsonb
language sql security definer set search_path = public as $$
  select push_core_jobs() || push_meeting_jobs() || push_announcement_jobs();
$$;

grant execute on function push_due_jobs() to authenticated, service_role;

select 'คิวแจ้งเตือนรวมประกาศแล้ว' as ผลตรวจ,
       jsonb_array_length(push_due_jobs())::text as งานที่รออยู่ตอนนี้;
-- =====================================================================
-- BPL SUPPLY — เด้งเตือนตอนหน้าต่างเช็คชื่อเปิด
-- รันต่อจาก 059 · ปลอดภัยที่จะรันซ้ำ
--
-- เดิมมีแจ้งเตือนรอบเดียวคือตอนประกาศนัด ซึ่งอาจเป็นเมื่อวาน
-- พอถึงวันจริงคนลืม ต้องมานั่งกดดูเองว่าเปิดให้เช็คชื่อหรือยัง
--
-- เพิ่มรอบที่สอง ยิงตอนหน้าต่างเปิดพอดี บอกว่าเช็คชื่อได้แล้ว
-- และบอกด้วยว่ามีเวลากี่นาทีก่อนจะถือว่าสาย
--
-- ข้อจำกัดที่ต้องรู้ไว้
--   นาฬิกาของระบบเดินทุก 5 นาที แจ้งเตือนจึงออกช้าได้ถึง 5 นาที
--   ถ้าตั้ง "เปิดก่อน 0 นาที" กับ "สายหลัง 0 นาที" พร้อมกัน
--   แจ้งเตือนอาจมาถึงตอนที่สายไปแล้ว ซึ่งไม่มีประโยชน์
--   จึงยิงเฉพาะตอนที่ยังมีเวลาเหลือให้เช็คจริง ๆ
-- =====================================================================

create or replace function push_meeting_open_jobs()
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'meeting_open',
      'subject', e.id::text,
      'user_id', m.id,
      'title',   'เช็คชื่อได้แล้ว · ' || e.title,
      'body',    case
                   when e.late_after_min = 0
                     then 'ต้องเช็คภายใน ' ||
                          to_char(e.meet_at at time zone 'Asia/Bangkok', 'HH24:MI') ||
                          ' พอดี เลยจากนั้นถือว่าสาย'
                   else 'เช็คได้ถึง ' ||
                        to_char((e.meet_at + (e.late_after_min || ' minutes')::interval)
                                at time zone 'Asia/Bangkok', 'HH24:MI') ||
                        ' หลังจากนั้นจะบันทึกว่าสาย'
                 end,
      'url',     '/'
    ))
    from meeting_events e
    cross join (select id from profiles where is_active) m
    where e.cancelled_at is null
      -- หน้าต่างเปิดแล้ว
      and now() >= e.meet_at - (e.open_before_min || ' minutes')::interval
      -- และยังไม่สาย — ส่งตอนสายไปแล้วไม่มีประโยชน์
      and now() <= e.meet_at + (e.late_after_min || ' minutes')::interval
      and not exists (
        select 1 from notification_log n
        where n.kind = 'meeting_open' and n.subject = e.id::text and n.user_id = m.id
      )
      -- คนที่เช็คไปแล้วไม่ต้องกวน
      and not exists (
        select 1 from meeting_checkins c
        where c.event_id = e.id and c.user_id = m.id
      )
  ), '[]'::jsonb);
end $$;

grant execute on function push_meeting_open_jobs() to authenticated, service_role;


create or replace function push_due_jobs()
returns jsonb
language sql security definer set search_path = public as $$
  select push_core_jobs()
      || push_meeting_jobs()
      || push_meeting_open_jobs()
      || push_announcement_jobs();
$$;

grant execute on function push_due_jobs() to authenticated, service_role;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname = 'push_meeting_open_jobs') as ฟังก์ชันเตือนเปิดเช็คชื่อ,
  jsonb_array_length(push_meeting_open_jobs())                            as งานรอส่งตอนนี้,
  jsonb_array_length(push_due_jobs())                                     as งานรวมทุกชนิด;
-- =====================================================================
-- BPL SUPPLY — สถานะการเข้าประชุม และการกำหนดผู้เข้าร่วม
-- รันต่อจาก 060 · ปลอดภัยที่จะรันซ้ำ
--
-- ① ใครต้องเข้าประชุม — สามแบบ
--      all    ทุกคนที่เปิดใช้งานในระบบ
--      picked เลือกเป็นแผนกและ/หรือรายคน
--      free   พิมพ์เอาเอง (ของเดิม) — ไม่มีรายชื่อจึงนับขาดไม่ได้
--    ค่าตั้งต้นของแถวเดิมคือ free พฤติกรรมของนัดเก่าจึงไม่เปลี่ยน
--
-- ② สถานะรายคน — คิดสดทุกครั้ง ไม่เก็บค่าตายตัว
--      ontime  เช็คทันเวลา
--      late    เช็คหลังหมดเวลาผ่อนผัน
--      absent  ยังไม่เช็คและเลยเวลาผ่อนผันแล้ว
--      excused ผู้ตรวจสอบแก้ให้ถือว่ามา
--
--    ทำไมคิดสดไม่เก็บค่า — คนที่ขึ้นแดงยังเดินมาสแกนทีหลังได้
--    ถ้าเก็บเป็นค่าตายตัวจะต้องมีใครสักคนคอยไล่อัปเดตทั้งฮับทุกนาที
--    ซึ่งพลาดเมื่อไหร่ก็ค้างแดงทั้งที่เขามาแล้ว
--
-- ③ การแก้ของผู้ตรวจสอบ
--    เก็บแยกตาราง ไม่ทับของจริง ค่าที่ระบบคำนวณไว้ยังอยู่ครบ
--    บังคับใส่เหตุผล — ถ้าแก้ได้เปล่า ๆ สถิติจะเชื่อไม่ได้เลย
--    และคนที่โดนแก้ต้องรู้ว่าทำไมตัวเองได้ผ่อนผันแต่เพื่อนไม่ได้
--
-- ④ ประกาศก็ล็อกผู้รับได้ ใช้กติกาเดียวกับนัดประชุม
-- =====================================================================

-- ---------------------------------------------------------------------
-- ① ผู้เข้าร่วม
-- ---------------------------------------------------------------------
alter table meeting_events
  add column if not exists audience_mode text not null default 'free';

alter table meeting_events drop constraint if exists meeting_events_mode_chk;
alter table meeting_events add constraint meeting_events_mode_chk
  check (audience_mode in ('all', 'picked', 'free'));

create table if not exists meeting_event_depts (
  event_id  uuid not null references meeting_events (id) on delete cascade,
  dept_code text not null references departments (code) on update cascade on delete cascade,
  primary key (event_id, dept_code)
);

create table if not exists meeting_event_users (
  event_id uuid not null references meeting_events (id) on delete cascade,
  user_id  uuid not null references profiles (id) on delete cascade,
  primary key (event_id, user_id)
);

create index if not exists meeting_event_users_user_idx on meeting_event_users (user_id);

alter table meeting_event_depts enable row level security;
alter table meeting_event_users enable row level security;

-- ทุกคนอ่านได้ เพราะแอพต้องรู้ว่าตัวเองต้องเข้านัดไหน
drop policy if exists read_meeting_event_depts on meeting_event_depts;
create policy read_meeting_event_depts on meeting_event_depts for select to authenticated using (true);
drop policy if exists write_meeting_event_depts on meeting_event_depts;
create policy write_meeting_event_depts on meeting_event_depts for all to authenticated
  using (my_can_audit()) with check (my_can_audit());

drop policy if exists read_meeting_event_users on meeting_event_users;
create policy read_meeting_event_users on meeting_event_users for select to authenticated using (true);
drop policy if exists write_meeting_event_users on meeting_event_users;
create policy write_meeting_event_users on meeting_event_users for all to authenticated
  using (my_can_audit()) with check (my_can_audit());


-- ---------------------------------------------------------------------
-- ③ การแก้สถานะโดยผู้ตรวจสอบ
-- ---------------------------------------------------------------------
create table if not exists meeting_overrides (
  event_id uuid not null references meeting_events (id) on delete cascade,
  user_id  uuid not null references profiles (id) on delete cascade,
  state    text not null,
  reason   text not null,
  by_user  uuid not null references profiles (id),
  at       timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table meeting_overrides drop constraint if exists meeting_overrides_state_chk;
alter table meeting_overrides add constraint meeting_overrides_state_chk
  check (state in ('ontime', 'late', 'excused', 'absent'));

alter table meeting_overrides enable row level security;

-- เจ้าตัวเห็นของตัวเอง คนคุมเห็นหมด
drop policy if exists read_meeting_overrides on meeting_overrides;
create policy read_meeting_overrides on meeting_overrides for select to authenticated
  using (my_can_audit() or user_id = auth.uid());

drop policy if exists write_meeting_overrides on meeting_overrides;
create policy write_meeting_overrides on meeting_overrides for all to authenticated
  using (my_can_audit()) with check (my_can_audit());


-- ---------------------------------------------------------------------
-- ใครต้องเข้านัดนี้บ้าง
-- ---------------------------------------------------------------------
create or replace function meeting_expected(p_event uuid)
returns table (user_id uuid)
language sql stable security definer set search_path = public as $$
  with e as (select * from meeting_events where id = p_event)
  select p.id
    from profiles p, e
   where p.is_active
     and (
       e.audience_mode = 'all'
       or (e.audience_mode = 'picked' and (
            exists (select 1 from meeting_event_users u
                     where u.event_id = e.id and u.user_id = p.id)
         or exists (select 1 from meeting_event_depts d
                     where d.event_id = e.id
                       and (d.dept_code = 'ALL'
                            or d.dept_code = p.dept_code
                            or d.dept_code = any(coalesce(p.extra_depts, '{}'))))
       ))
     );
$$;

grant execute on function meeting_expected(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- รายชื่อพร้อมสถานะ — คิดสดทุกครั้งที่เรียก
-- ---------------------------------------------------------------------
create or replace function meeting_roster(p_event uuid)
returns table (
  user_id       uuid,
  full_name     text,
  employee_code text,
  dept_code     text,
  checked_at    timestamptz,
  ref_no        text,
  raw_state     text,
  state         text,
  late_min      integer,
  reason        text,
  by_name       text,
  changed_at    timestamptz
)
language sql stable security definer set search_path = public as $$
  with e as (select * from meeting_events where id = p_event),
  base as (
    select p.id, p.full_name, p.employee_code, p.dept_code,
           c.created_at as checked_at, c.ref_no, c.is_late, c.late_min
      from meeting_expected(p_event) x
      join profiles p on p.id = x.user_id
      left join meeting_checkins c on c.event_id = p_event and c.user_id = p.id
  )
  select
    b.id, b.full_name, b.employee_code, b.dept_code,
    b.checked_at, b.ref_no,
    -- สถานะที่ระบบคำนวณ เก็บไว้ให้เห็นแม้จะถูกแก้แล้ว
    case
      when b.checked_at is not null and b.is_late then 'late'
      when b.checked_at is not null                then 'ontime'
      when now() > (select meet_at + (late_after_min || ' minutes')::interval from e)
                                                   then 'absent'
      else 'waiting'
    end,
    -- สถานะที่ใช้จริง — ของผู้ตรวจสอบชนะเสมอ
    coalesce(o.state, case
      when b.checked_at is not null and b.is_late then 'late'
      when b.checked_at is not null                then 'ontime'
      when now() > (select meet_at + (late_after_min || ' minutes')::interval from e)
                                                   then 'absent'
      else 'waiting'
    end),
    b.late_min,
    o.reason,
    bp.full_name,
    o.at
  from base b
  left join meeting_overrides o on o.event_id = p_event and o.user_id = b.id
  left join profiles bp on bp.id = o.by_user
  order by
    case coalesce(o.state, case
      when b.checked_at is not null and b.is_late then 'late'
      when b.checked_at is not null                then 'ontime'
      else 'absent' end)
      when 'absent' then 0 when 'late' then 1 when 'excused' then 2 else 3 end,
    b.full_name;
$$;

grant execute on function meeting_roster(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- ผู้ตรวจสอบแก้สถานะ — บังคับใส่เหตุผล
-- ---------------------------------------------------------------------
create or replace function set_meeting_attendance(
  p_event  uuid,
  p_user   uuid,
  p_state  text,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not my_can_audit() then
    raise exception 'เฉพาะผู้ตรวจสอบและแอดมินเท่านั้นที่แก้สถานะได้';
  end if;
  if p_state not in ('ontime', 'late', 'excused', 'absent') then
    raise exception 'สถานะไม่ถูกต้อง';
  end if;
  -- เหตุผลคือสิ่งเดียวที่ทำให้การแก้ตรวจสอบย้อนหลังได้ จึงบังคับ
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'ต้องใส่เหตุผลกำกับทุกครั้งที่แก้สถานะ';
  end if;

  insert into meeting_overrides (event_id, user_id, state, reason, by_user, at)
  values (p_event, p_user, p_state, btrim(p_reason), auth.uid(), now())
  on conflict (event_id, user_id) do update
    set state = excluded.state, reason = excluded.reason,
        by_user = excluded.by_user, at = excluded.at;

  return jsonb_build_object('ok', true);
end $$;

grant execute on function set_meeting_attendance(uuid, uuid, text, text) to authenticated;


/** ถอนการแก้ กลับไปใช้ค่าที่ระบบคำนวณ */
create or replace function clear_meeting_attendance(p_event uuid, p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not my_can_audit() then
    raise exception 'เฉพาะผู้ตรวจสอบและแอดมินเท่านั้นที่แก้สถานะได้';
  end if;
  delete from meeting_overrides where event_id = p_event and user_id = p_user;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function clear_meeting_attendance(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- สรุปตัวเลขของนัดหนึ่ง ๆ
-- ---------------------------------------------------------------------
create or replace function meeting_summary(p_event uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'expected', count(*),
    'ontime',   count(*) filter (where state = 'ontime'),
    'late',     count(*) filter (where state = 'late'),
    'absent',   count(*) filter (where state = 'absent'),
    'excused',  count(*) filter (where state = 'excused'),
    'waiting',  count(*) filter (where state = 'waiting')
  )
  from meeting_roster(p_event);
$$;

grant execute on function meeting_summary(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- สถานะของตัวเองในนัดที่กำลังเปิด — ให้หน้างานเห็นในแอพ
-- ---------------------------------------------------------------------
create or replace function my_meeting_state(p_event uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object(
       'state', r.state, 'raw_state', r.raw_state, 'late_min', r.late_min,
       'reason', r.reason, 'by_name', r.by_name, 'checked_at', r.checked_at)
       from meeting_roster(p_event) r where r.user_id = auth.uid()),
    jsonb_build_object('state', 'notlisted')
  );
$$;

grant execute on function my_meeting_state(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- สร้างนัด — รับโหมดผู้เข้าร่วมและรายชื่อ
-- ---------------------------------------------------------------------
drop function if exists create_meeting_event(text, timestamptz, text, text, text, integer, integer);

create or replace function create_meeting_event(
  p_title       text,
  p_meet_at     timestamptz,
  p_audience    text default null,
  p_place       text default null,
  p_note        text default null,
  p_open_before integer default null,
  p_late_after  integer default null,
  p_mode        text default 'free',
  p_depts       text[] default '{}',
  p_users       uuid[] default '{}'
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_id   uuid;
  v_open integer;
  v_late integer;
begin
  if not my_can_audit() then
    raise exception 'บัญชีนี้นัดประชุมไม่ได้';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'ต้องใส่เรื่องที่จะประชุม';
  end if;
  if p_meet_at is null then
    raise exception 'ต้องเลือกวันและเวลา';
  end if;
  if p_mode not in ('all', 'picked', 'free') then
    raise exception 'โหมดผู้เข้าร่วมไม่ถูกต้อง';
  end if;
  if p_mode = 'picked'
     and coalesce(array_length(p_depts, 1), 0) = 0
     and coalesce(array_length(p_users, 1), 0) = 0 then
    raise exception 'เลือกเจาะจงต้องเลือกอย่างน้อยหนึ่งแผนกหรือหนึ่งคน';
  end if;

  v_open := coalesce(p_open_before,
    (select (value)::int from app_settings where key = 'meeting_open_before_min'), 15);
  v_late := coalesce(p_late_after,
    (select (value)::int from app_settings where key = 'meeting_late_after_min'), 10);

  insert into meeting_events (title, meet_at, audience, place, note, created_by,
                              open_before_min, late_after_min, audience_mode)
  values (btrim(p_title), p_meet_at, nullif(btrim(p_audience), ''),
          nullif(btrim(p_place), ''), nullif(btrim(p_note), ''), auth.uid(),
          v_open, v_late, p_mode)
  returning id into v_id;

  if p_mode = 'picked' then
    insert into meeting_event_depts (event_id, dept_code)
    select v_id, d from unnest(coalesce(p_depts, '{}')) as d
     where exists (select 1 from departments x where x.code = d)
    on conflict do nothing;

    insert into meeting_event_users (event_id, user_id)
    select v_id, u from unnest(coalesce(p_users, '{}')) as u
     where exists (select 1 from profiles x where x.id = u)
    on conflict do nothing;
  end if;

  begin
    perform push_tick();
  exception when others then
    raise notice 'ประกาศแล้วแต่เตะแจ้งเตือนไม่สำเร็จ (%)', sqlerrm;
  end;

  return jsonb_build_object('id', v_id);
end $fn$;

grant execute on function
  create_meeting_event(text, timestamptz, text, text, text, integer, integer, text, text[], uuid[])
  to authenticated;


-- ---------------------------------------------------------------------
-- แจ้งเตือนเฉพาะคนที่ต้องเข้า ไม่กวนคนที่ไม่เกี่ยว
-- ---------------------------------------------------------------------
create or replace function push_meeting_jobs()
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'meeting_new',
      'subject', e.id::text,
      'user_id', m.user_id,
      'title',   'นัดประชุม · ' || e.title,
      'body',    to_char((e.meet_at at time zone 'Asia/Bangkok'), 'DD/MM HH24:MI') ||
                 coalesce(' · ' || e.place, '') ||
                 coalesce(' · ผู้เข้าร่วม: ' || e.audience, ''),
      'url',     '/'
    ))
    from meeting_events e
    cross join lateral (
      -- โหมด free ไม่มีรายชื่อ จึงส่งหาทุกคนเหมือนเดิม
      select case when e.audience_mode = 'free' then p.id else x.user_id end as user_id
        from profiles p
        left join lateral (select * from meeting_expected(e.id)) x on x.user_id = p.id
       where p.is_active
         and (e.audience_mode = 'free' or x.user_id is not null)
    ) m
    where e.cancelled_at is null
      and e.created_at > now() - interval '1 day'
      and e.meet_at > now()
      and not exists (
        select 1 from notification_log n
        where n.kind = 'meeting_new' and n.subject = e.id::text and n.user_id = m.user_id
      )
  ), '[]'::jsonb);
end $$;

grant execute on function push_meeting_jobs() to authenticated, service_role;


-- ---------------------------------------------------------------------
-- ④ ประกาศล็อกผู้รับได้
-- ---------------------------------------------------------------------
alter table announcements
  add column if not exists audience_mode text not null default 'all';

alter table announcements drop constraint if exists announcements_mode_chk;
alter table announcements add constraint announcements_mode_chk
  check (audience_mode in ('all', 'picked'));

create table if not exists announcement_depts (
  ann_id    uuid not null references announcements (id) on delete cascade,
  dept_code text not null references departments (code) on update cascade on delete cascade,
  primary key (ann_id, dept_code)
);

create table if not exists announcement_users (
  ann_id  uuid not null references announcements (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  primary key (ann_id, user_id)
);

alter table announcement_depts enable row level security;
alter table announcement_users enable row level security;

drop policy if exists read_announcement_depts on announcement_depts;
create policy read_announcement_depts on announcement_depts for select to authenticated using (true);
drop policy if exists write_announcement_depts on announcement_depts;
create policy write_announcement_depts on announcement_depts for all to authenticated
  using (my_can_audit()) with check (my_can_audit());

drop policy if exists read_announcement_users on announcement_users;
create policy read_announcement_users on announcement_users for select to authenticated using (true);
drop policy if exists write_announcement_users on announcement_users;
create policy write_announcement_users on announcement_users for all to authenticated
  using (my_can_audit()) with check (my_can_audit());


/** ประกาศนี้ถึงฉันไหม — security definer เพราะถูกเรียกจาก policy */
create or replace function my_sees_announcement(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from announcement_users u where u.ann_id = p_id and u.user_id = auth.uid()
  ) or exists (
    select 1 from announcement_depts d
     where d.ann_id = p_id
       and (d.dept_code = 'ALL'
            or 'ALL' = any(my_depts())
            or d.dept_code = any(my_depts()))
  );
$$;

grant execute on function my_sees_announcement(uuid) to authenticated;

drop policy if exists read_announcements on announcements;
create policy read_announcements on announcements for select to authenticated
  using (
    my_can_audit()
    or (
      cancelled_at is null and expires_at > now()
      and (audience_mode = 'all' or my_sees_announcement(id))
    )
  );


drop function if exists create_announcement(text, text, text, integer, boolean);

create or replace function create_announcement(
  p_title   text,
  p_body    text default null,
  p_level   text default 'info',
  p_days    integer default 3,
  p_notify  boolean default true,
  p_mode    text default 'all',
  p_depts   text[] default '{}',
  p_users   uuid[] default '{}'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not my_can_audit() then
    raise exception 'บัญชีนี้ประกาศไม่ได้';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'ต้องใส่หัวข้อประกาศ';
  end if;
  if p_level not in ('urgent', 'warn', 'info') then
    raise exception 'ระดับความสำคัญไม่ถูกต้อง';
  end if;
  if p_mode not in ('all', 'picked') then
    raise exception 'โหมดผู้รับไม่ถูกต้อง';
  end if;
  if p_mode = 'picked'
     and coalesce(array_length(p_depts, 1), 0) = 0
     and coalesce(array_length(p_users, 1), 0) = 0 then
    raise exception 'เลือกเจาะจงต้องเลือกอย่างน้อยหนึ่งแผนกหรือหนึ่งคน';
  end if;

  insert into announcements (title, body, level, expires_at, notify, created_by, audience_mode)
  values (btrim(p_title), nullif(btrim(coalesce(p_body, '')), ''), p_level,
          now() + (greatest(coalesce(p_days, 3), 1) || ' days')::interval,
          coalesce(p_notify, true), auth.uid(), p_mode)
  returning id into v_id;

  if p_mode = 'picked' then
    insert into announcement_depts (ann_id, dept_code)
    select v_id, d from unnest(coalesce(p_depts, '{}')) as d
     where exists (select 1 from departments x where x.code = d)
    on conflict do nothing;

    insert into announcement_users (ann_id, user_id)
    select v_id, u from unnest(coalesce(p_users, '{}')) as u
     where exists (select 1 from profiles x where x.id = u)
    on conflict do nothing;
  end if;

  if coalesce(p_notify, true) then
    begin
      perform push_tick();
    exception when others then
      raise notice 'ประกาศแล้วแต่เตะแจ้งเตือนไม่สำเร็จ (%)', sqlerrm;
    end;
  end if;

  return jsonb_build_object('id', v_id);
end $$;

grant execute on function
  create_announcement(text, text, text, integer, boolean, text, text[], uuid[])
  to authenticated;


create or replace function push_announcement_jobs()
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'announce_new',
      'subject', a.id::text,
      'user_id', p.id,
      'title',   case a.level when 'urgent' then 'ด่วน · ' when 'warn' then 'แจ้งเตือน · '
                              else 'ประกาศ · ' end || a.title,
      'body',    coalesce(a.body, 'เปิดแอพเพื่อดูรายละเอียด'),
      'url',     '/'
    ))
    from announcements a
    cross join (select id, dept_code, extra_depts from profiles where is_active) p
    where a.cancelled_at is null
      and a.notify
      and a.expires_at > now()
      and a.created_at > now() - interval '1 day'
      and (
        a.audience_mode = 'all'
        or exists (select 1 from announcement_users u where u.ann_id = a.id and u.user_id = p.id)
        or exists (
          select 1 from announcement_depts d
           where d.ann_id = a.id
             and (d.dept_code = 'ALL'
                  or d.dept_code = p.dept_code
                  or d.dept_code = any(coalesce(p.extra_depts, '{}')))
        )
      )
      and not exists (
        select 1 from notification_log n
        where n.kind = 'announce_new' and n.subject = a.id::text and n.user_id = p.id
      )
  ), '[]'::jsonb);
end $$;

grant execute on function push_announcement_jobs() to authenticated, service_role;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'meeting_events' and column_name = 'audience_mode')  as โหมดผู้เข้าร่วม,
  (select count(*) from information_schema.tables
    where table_name = 'meeting_overrides')                                 as ตารางแก้สถานะ,
  (select count(*) from pg_proc where proname = 'meeting_roster')           as ฟังก์ชันรายชื่อ,
  (select count(*) from pg_proc where proname = 'meeting_summary')          as ฟังก์ชันสรุป,
  (select count(*) from information_schema.columns
    where table_name = 'announcements' and column_name = 'audience_mode')   as ประกาศล็อกผู้รับ,
  (select count(*) from meeting_events where audience_mode = 'free')        as นัดเก่าที่ไม่เปลี่ยน;
-- =====================================================================
-- BPL SUPPLY — สถานะการเข้าประชุมใน Google Sheet
-- รันต่อจาก 061 · ปลอดภัยที่จะรันซ้ำ
--
-- วิว meeting_rows เป็นตัวที่ Edge Function ส่งออกลงชีต
-- เพิ่มสถานะเข้ามา และถ้ามีการแก้โดยผู้ตรวจสอบให้ต่อท้ายไว้
--
-- คอลัมน์เดิมไม่ขยับสักตัว เพิ่มของใหม่ต่อท้ายอย่างเดียว
-- ชีตที่ส่งไปแล้วจึงยังอ่านตรงคอลัมน์เดิมได้เหมือนเดิม
--
-- สองชั้นที่ต้องแยกให้ออก
--   status   ผู้ตรวจสอบกดยืนยัน/ไม่นับรูปเซลฟี่ (ของเดิม มีมาตั้งแต่แรก)
--   attend   มาตรงเวลา/สาย/ผ่อนผัน (ของใหม่ คิดจากเวลาที่เช็ค)
-- คนละเรื่องกัน รูปใช้ได้แต่มาสายก็มี รูปไม่ผ่านแต่มาตรงเวลาก็มี
-- =====================================================================

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
  (m.created_at at time zone 'Asia/Bangkok')::date as day,

  -- ── ของใหม่ ต่อท้าย ────────────────────────────────────────────────
  m.event_id,
  e.title            as event_title,
  e.meet_at          as event_at,
  m.is_late,
  m.late_min,
  -- สถานะที่ใช้จริง — ของผู้ตรวจสอบชนะค่าที่ระบบคำนวณ
  coalesce(o.state, case when m.is_late then 'late' else 'ontime' end) as attend_state,
  o.reason           as attend_reason,
  ob.full_name       as attend_by_name,
  o.at               as attend_at
from meeting_checkins m
join profiles p      on p.id = m.user_id
left join profiles d on d.id = m.decided_by
left join meeting_events e on e.id = m.event_id
left join meeting_overrides o on o.event_id = m.event_id and o.user_id = m.user_id
left join profiles ob on ob.id = o.by_user;

grant select on meeting_rows to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'meeting_rows' and column_name = 'attend_state')  as มีสถานะเข้าประชุม,
  (select count(*) from information_schema.columns
    where table_name = 'meeting_rows' and column_name = 'attend_reason') as มีเหตุผลที่แก้,
  (select count(*) from information_schema.columns
    where table_name = 'meeting_rows')                                   as คอลัมน์ทั้งหมด,
  (select count(*) from meeting_rows)                                    as แถวข้อมูลที่มี;
-- =====================================================================
-- BPL SUPPLY — รูปประกอบการแจ้งซ่อม
-- รันต่อจาก 062 · ปลอดภัยที่จะรันซ้ำ
--
-- เดิมใบแจ้งซ่อมแนบรูปได้ใบเดียว (คอลัมน์ file_id/web_link)
-- ซึ่งไม่พอกับของจริง — จอแตกต้องถ่ายทั้งจอและมุมที่ร้าว
-- แบตเสื่อมต้องถ่ายหน้าจอแสดงเปอร์เซ็นต์ด้วย
--
-- ทำเป็นตารางลูก แนบได้ไม่จำกัด คอลัมน์เดิมไม่แตะ
-- ของเก่าที่แนบไว้ใบเดียวจึงยังอ่านได้เหมือนเดิมทุกที่
--
-- ใครเห็นรูปได้ — แอดมิน เจ้าของระบบ ผู้ตรวจสอบ เท่านั้น
-- หน้างานห้ามเห็นลิงก์ Drive เด็ดขาด (CLAUDE.md ข้อ 4)
-- =====================================================================

create table if not exists asset_issue_photos (
  id         bigserial primary key,
  issue_id   bigint not null references asset_issues (id) on delete cascade,
  seq        integer not null default 1,
  file_id    text not null,
  web_link   text,
  bytes      integer,
  created_at timestamptz not null default now()
);

create index if not exists asset_issue_photos_issue_idx on asset_issue_photos (issue_id, seq);

alter table asset_issue_photos enable row level security;

drop policy if exists read_asset_issue_photos on asset_issue_photos;
create policy read_asset_issue_photos on asset_issue_photos for select to authenticated
  using (my_can_dispatch() or my_role() in ('supervisor', 'admin'));

-- เขียนผ่าน RPC ที่เป็น security definer เท่านั้น ฝั่ง client ไม่ต้องเขียนตรง
drop policy if exists write_asset_issue_photos on asset_issue_photos;
create policy write_asset_issue_photos on asset_issue_photos for all to authenticated
  using (my_role() in ('supervisor', 'admin'))
  with check (my_role() in ('supervisor', 'admin'));


-- ---------------------------------------------------------------------
-- ตัวช่วยแนบรูปเข้าใบแจ้งซ่อม
--
-- แยกเป็นฟังก์ชันเพราะทั้งขาเบิกและขาคืนเรียกเหมือนกัน
-- เขียนซ้ำสองที่แล้วแก้ไม่ครบทั้งคู่คือเรื่องที่เกิดขึ้นเสมอ
-- ---------------------------------------------------------------------
create or replace function attach_issue_photos(p_issue bigint, p_photos jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n integer := 0;
begin
  if p_photos is null or jsonb_typeof(p_photos) <> 'array' then
    return 0;
  end if;

  insert into asset_issue_photos (issue_id, seq, file_id, web_link, bytes)
  select p_issue,
         (row_number() over ())::int,
         ph->>'file_id',
         ph->>'web_link',
         nullif(ph->>'bytes', '')::int
    from jsonb_array_elements(p_photos) ph
   where coalesce(ph->>'file_id', '') <> '';

  get diagnostics v_n = row_count;

  -- ใบเดิมอ่าน file_id ตรงหัวใบอยู่ เติมใบแรกไว้ด้วยจะได้ไม่ต้องแก้ที่อื่น
  update asset_issues i
     set file_id  = coalesce(i.file_id, f.file_id),
         web_link = coalesce(i.web_link, f.web_link)
    from (
      select file_id, web_link from asset_issue_photos
       where issue_id = p_issue order by seq limit 1
    ) f
   where i.id = p_issue;

  return v_n;
end $$;

grant execute on function attach_issue_photos(bigint, jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- แนบรูปหลังแจ้งซ่อมเสร็จ โดยอ้างจากรหัสเครื่อง
--
-- ทำไมไม่ไปแก้ asset_checkout / asset_return ให้รับรูปเข้าไปเลย
--   สองตัวนั้นเป็นหัวใจของการเบิกและคืน ยาวหลักร้อยบรรทัด และมีการล็อกแถว
--   แก้ทับแล้วพลาดคือทั้งฮับเบิกไม่ได้ ส่วนการแนบรูปเป็นของประกอบ
--   ต่อให้แนบไม่สำเร็จ ใบแจ้งซ่อมก็ยังอยู่ครบ เรื่องสำคัญไม่พัง
--
-- หาใบล่าสุดของเครื่องนั้นที่ตัวเองเพิ่งแจ้งและยังไม่ถูกปิด
-- จำกัด 10 นาทีเพื่อไม่ให้ไปแปะทับใบเก่าของเดือนที่แล้ว
-- ---------------------------------------------------------------------
create or replace function attach_issue_photos_by_code(
  p_asset_code text,
  p_photos     jsonb
) returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  v_issue bigint;
begin
  select id into v_issue
    from asset_issues
   where asset_code = p_asset_code
     and reported_by = auth.uid()
     and resolved_at is null
     and reported_at > now() - interval '10 minutes'
   order by reported_at desc
   limit 1;

  if v_issue is null then
    return 0;
  end if;

  return attach_issue_photos(v_issue, p_photos);
end $fn$;

grant execute on function attach_issue_photos_by_code(text, jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- ใบแจ้งซ่อมพร้อมรูปทั้งหมด — ใช้ในหน้าเว็บ
-- ---------------------------------------------------------------------
create or replace view asset_issue_rows
with (security_invoker = true) as
select
  i.id,
  i.asset_code,
  i.txn_id,
  i.phase,
  i.symptom,
  i.reported_by,
  coalesce(p.full_name, i.reported_name) as reported_name,
  i.reported_at,
  i.file_id,
  i.web_link,
  i.resolved_at,
  i.resolved_by,
  r.full_name as resolved_by_name,
  i.resolve_note,
  a.type_code,
  t.name as type_name,
  coalesce(
    (select jsonb_agg(jsonb_build_object(
       'seq', ph.seq, 'file_id', ph.file_id, 'web_link', ph.web_link
     ) order by ph.seq)
       from asset_issue_photos ph where ph.issue_id = i.id),
    '[]'::jsonb
  ) as photos
from asset_issues i
left join profiles p on p.id = i.reported_by
left join profiles r on r.id = i.resolved_by
left join assets a   on a.code = i.asset_code
left join asset_types t on t.code = a.type_code;

grant select on asset_issue_rows to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_name = 'asset_issue_photos')                  as ตารางรูปแจ้งซ่อม,
  (select count(*) from pg_proc where proname = 'attach_issue_photos') as ฟังก์ชันแนบรูป,
  (select count(*) from information_schema.views
    where table_name = 'asset_issue_rows')                    as วิวใบแจ้งซ่อม,
  (select count(*) from asset_issues)                         as ใบแจ้งซ่อมที่มีอยู่,
  (select count(*) from asset_issue_photos)                   as รูปที่แนบแล้ว;
-- =====================================================================
-- BPL SUPPLY — เช็คชื่อได้เฉพาะตอนที่ประชุมเปิดอยู่จริง
-- รันต่อจาก 063 · ปลอดภัยที่จะรันซ้ำ
--
-- เดิมกล้องเปิดตลอดเวลา ใครจะถ่ายเซลฟี่ส่งเมื่อไหร่ก็ได้
-- แม้ไม่มีนัดประชุมอยู่เลย ซึ่งทำให้ใบเช็คอินลอย ๆ ไม่ผูกกับอะไร
--
-- ต่อจากนี้มีสี่ช่วง และกล้องเปิดแค่ช่วงเดียว
--   ไม่มีนัด   กล้องปิด — ไม่มีอะไรให้เช็คชื่อ
--   ยังไม่ถึง  กล้องปิด · นับถอยหลังให้ดู
--   เปิดอยู่   กล้องเปิด — ตั้งแต่ถึงเวลาจนกว่าจะมีคนกดปิดประชุม
--   ปิดแล้ว    กล้องปิด — สายแค่ไหนก็หมดสิทธิ์แล้ว
--
-- ทำไมต้องให้คนกดปิดเอง ไม่ปิดอัตโนมัติตามเวลา
--   ประชุมจริงเลิกไม่ตรงเวลาที่นัดไว้เสมอ ถ้าปิดเองตามนาฬิกา
--   คนที่เข้าประชุมอยู่จริงจะเช็คชื่อไม่ทันแล้วต้องมาตามแก้ทีหลังทุกครั้ง
--   ให้คนที่อยู่ในห้องเป็นคนตัดสินว่าจบแล้ว ตรงกับความจริงมากกว่า
--
-- หนักระบบไหม — ไม่
--   สถานะคิดจากแถวเดียวของนัดที่ใกล้ที่สุด ไม่ได้ไล่ทั้งตาราง
--   นับถอยหลังเดินในเครื่องผู้ใช้ เซิร์ฟเวอร์ถูกถามแค่ตอนเปิดแผ่น
--   กับตอนนับถอยหลังถึงศูนย์เท่านั้น
-- =====================================================================

alter table meeting_events
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references profiles (id);

comment on column meeting_events.closed_at is
  'ปิดประชุมแล้วเมื่อไหร่ · ว่าง = ยังเปิดอยู่ กล้องเช็คชื่อยังใช้ได้';


-- ---------------------------------------------------------------------
-- ปิด / เปิดประชุมใหม่
-- ---------------------------------------------------------------------
create or replace function close_meeting(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not my_can_audit() then
    raise exception 'เฉพาะผู้ตรวจสอบและแอดมินเท่านั้นที่ปิดประชุมได้';
  end if;

  update meeting_events
     set closed_at = now(), closed_by = auth.uid()
   where id = p_id and cancelled_at is null and closed_at is null;

  if not found then
    raise exception 'ไม่พบนัดนี้ หรือปิดไปแล้ว';
  end if;

  return jsonb_build_object('ok', true);
end $$;

grant execute on function close_meeting(uuid) to authenticated;


/** เผลอกดปิดเร็วไป เปิดใหม่ได้ — คนยังเช็คชื่อไม่ครบก็เกิดขึ้นได้ */
create or replace function reopen_meeting(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not my_can_audit() then
    raise exception 'เฉพาะผู้ตรวจสอบและแอดมินเท่านั้นที่เปิดประชุมใหม่ได้';
  end if;

  update meeting_events
     set closed_at = null, closed_by = null
   where id = p_id and cancelled_at is null;

  if not found then
    raise exception 'ไม่พบนัดนี้';
  end if;

  return jsonb_build_object('ok', true);
end $$;

grant execute on function reopen_meeting(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- นัดที่เกี่ยวข้องตอนนี้ พร้อมบอกว่ากล้องเปิดได้ไหม
--
-- ไม่มีแถวตอบกลับ = ไม่มีนัด = กล้องปิด หน้าจออ่านง่ายกว่าส่งค่าว่างมา
-- เลิกใช้เงื่อนไข "เลยเวลาสายแล้ว 6 ชั่วโมงให้หายไป" ของเดิม
-- เพราะตอนนี้ตัวตัดสินคือการกดปิด ไม่ใช่นาฬิกา
-- ---------------------------------------------------------------------
create or replace function meeting_now()
returns table (
  id            uuid,
  title         text,
  meet_at       timestamptz,
  place         text,
  audience      text,
  note          text,
  phase         text,      -- soon | open | late | closed
  opens_in_sec  integer,
  closes_in_sec integer,
  late_by_sec   integer,
  checked_in    boolean,
  can_shoot     boolean,
  closed_at     timestamptz
)
language sql stable security definer set search_path = public as $$
  with e as (
    select *
      from meeting_events
     where cancelled_at is null
       and meet_at > now() - interval '2 days'
       -- ปิดแล้วยังโชว์อีก 2 ชั่วโมง ให้คนที่เพิ่งพลาดรู้ว่าเกิดอะไรขึ้น
       and (closed_at is null or closed_at > now() - interval '2 hours')
     order by meet_at
     limit 1
  )
  select
    e.id, e.title, e.meet_at, e.place, e.audience, e.note,
    case
      when e.closed_at is not null then 'closed'
      when now() < e.meet_at - (e.open_before_min || ' minutes')::interval then 'soon'
      when now() <= e.meet_at + (e.late_after_min  || ' minutes')::interval then 'open'
      else 'late'
    end,
    greatest(ceil(extract(epoch from
      (e.meet_at - (e.open_before_min || ' minutes')::interval) - now()))::int, 0),
    greatest(ceil(extract(epoch from
      (e.meet_at + (e.late_after_min || ' minutes')::interval) - now()))::int, 0),
    greatest(floor(extract(epoch from
      now() - (e.meet_at + (e.late_after_min || ' minutes')::interval)))::int, 0),
    exists (
      select 1 from meeting_checkins c
       where c.event_id = e.id and c.user_id = auth.uid()
    ),
    -- กล้องเปิดเมื่อ: ถึงเวลาแล้ว และยังไม่ปิดประชุม
    (e.closed_at is null
     and now() >= e.meet_at - (e.open_before_min || ' minutes')::interval),
    e.closed_at
  from e;
$$;

grant execute on function meeting_now() to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'meeting_events' and column_name = 'closed_at') as คอลัมน์ปิดประชุม,
  (select count(*) from pg_proc where proname = 'close_meeting')       as ฟังก์ชันปิด,
  (select count(*) from pg_proc where proname = 'reopen_meeting')      as ฟังก์ชันเปิดใหม่,
  (select count(*) from meeting_events
    where cancelled_at is null and closed_at is null)                  as นัดที่ยังเปิดอยู่,
  (select count(*) from meeting_now())                                 as นัดที่โชว์ตอนนี้;
-- =====================================================================
-- BPL SUPPLY — กระจายกระสอบไปสาขา
-- รันต่อจาก 065 · ปลอดภัยที่จะรันซ้ำ
--
-- สาขาใหญ่ส่งกระสอบมาที่ 21BPL แล้วเรากระจายต่อไปสาขาปลายทาง
-- เจ้าของระบบกับแอดมินเป็นคนตั้งรายการว่าสาขาไหนขออะไรเท่าไหร่
-- หน้างานเปิดลิงก์มากดว่าส่งแล้ว แล้วได้ฟอร์มไปส่งต่อในแชท
--
-- สองทางที่ส่งได้
--   direct  ส่งตรงสาขา — ใช้บ่อยสุด เพราะฮับนี้เป็นคนกระจายเอง
--   relay   ฝากสาขาอื่นส่งต่อ — ต้องระบุว่าฝากสาขาไหน
--
-- ทำไม relay ต้องบังคับใส่ชื่อสาขาที่ฝาก
--   ฟอร์มที่ส่งออกไปเขียนว่า "ฝาก ___ ส่งต่อสาขา ___"
--   ถ้าปล่อยว่างได้ ส่วนกลางจะได้ข้อความที่อ่านไม่รู้เรื่อง
--   และเราจะตามของไม่ได้ว่าไปค้างอยู่ที่ไหน
--
-- แยกขาดจากระบบเบิก-คืน ไม่แตะตารางเดิมสักตัว
-- =====================================================================

create sequence if not exists sack_ref_seq;

create or replace function next_sack_ref() returns text
language sql volatile as $$
  select 'SH-' || to_char((now() at time zone 'Asia/Bangkok'), 'YYMMDD')
      || '-' || lpad(nextval('sack_ref_seq')::text, 3, '0');
$$;

create table if not exists sack_orders (
  id          uuid primary key default gen_random_uuid(),
  ref_no      text unique not null,
  /** ฮับที่จัดส่ง — ของเราคือ 21BPL แต่เก็บไว้เผื่อวันหนึ่งมีมากกว่าหนึ่งฮับ */
  hub_code    text not null default '21BPL',
  qty         integer not null check (qty > 0),
  unit        text not null default 'ชิ้น',
  /** สาขาปลายทางที่ขอของ */
  branch      text not null,
  note        text,

  status      text not null default 'pending',
  /** relay เท่านั้นที่มีค่า — ชื่อสาขาที่เราฝากให้ส่งต่อ */
  relay_via   text,

  created_by  uuid not null references profiles (id),
  created_at  timestamptz not null default now(),
  sent_by     uuid references profiles (id),
  sent_at     timestamptz
);

alter table sack_orders drop constraint if exists sack_orders_unit_chk;
alter table sack_orders add constraint sack_orders_unit_chk
  check (unit in ('ชิ้น', 'กระสอบ'));

alter table sack_orders drop constraint if exists sack_orders_status_chk;
alter table sack_orders add constraint sack_orders_status_chk
  check (status in ('pending', 'direct', 'relay'));

-- ฝากส่งต้องมีชื่อสาขาที่ฝากเสมอ ทางอื่นต้องไม่มี
alter table sack_orders drop constraint if exists sack_orders_relay_chk;
alter table sack_orders add constraint sack_orders_relay_chk
  check (
    (status = 'relay' and coalesce(btrim(relay_via), '') <> '')
    or (status <> 'relay' and relay_via is null)
  );

create index if not exists sack_orders_pending_idx
  on sack_orders (created_at desc) where status = 'pending';
create index if not exists sack_orders_branch_idx on sack_orders (branch);


create table if not exists sack_order_photos (
  id         bigserial primary key,
  order_id   uuid not null references sack_orders (id) on delete cascade,
  seq        integer not null default 1,
  file_id    text not null,
  web_link   text,
  bytes      integer,
  created_at timestamptz not null default now()
);

create index if not exists sack_order_photos_order_idx on sack_order_photos (order_id, seq);


-- ---------------------------------------------------------------------
-- สิทธิ์
--
-- อ่าน   ทุกคนที่ล็อกอิน — หน้างานต้องเห็นว่ามีอะไรรอส่ง
-- ตั้ง   เจ้าของระบบกับแอดมินเท่านั้น
-- กดส่ง  ทุกคนที่ล็อกอิน ผ่าน RPC ที่คุมไว้ ไม่ได้เปิด update ตรง ๆ
--
-- รูปเปิดให้ทุกคนที่ล็อกอินอ่าน ต่างจากรูปหลักฐานเบิก-คืน
-- เพราะรูปกระสอบคือสิ่งที่หน้างานต้องเอาไปแปะในแชทเอง ไม่ใช่ของลับ
-- ---------------------------------------------------------------------
alter table sack_orders enable row level security;
alter table sack_order_photos enable row level security;

drop policy if exists read_sack_orders on sack_orders;
create policy read_sack_orders on sack_orders for select to authenticated using (true);

drop policy if exists write_sack_orders on sack_orders;
create policy write_sack_orders on sack_orders for all to authenticated
  using (my_role() in ('admin', 'supervisor'))
  with check (my_role() in ('admin', 'supervisor'));

drop policy if exists read_sack_photos on sack_order_photos;
create policy read_sack_photos on sack_order_photos for select to authenticated using (true);

drop policy if exists write_sack_photos on sack_order_photos;
create policy write_sack_photos on sack_order_photos for all to authenticated
  using (my_role() in ('admin', 'supervisor'))
  with check (my_role() in ('admin', 'supervisor'));


-- ---------------------------------------------------------------------
-- ตั้งรายการ — เจ้าของระบบกับแอดมิน
-- ---------------------------------------------------------------------
create or replace function create_sack_order(
  p_branch text,
  p_qty    integer,
  p_unit   text default 'ชิ้น',
  p_note   text default null,
  p_hub    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id  uuid;
  v_ref text;
begin
  if my_role() not in ('admin', 'supervisor') then
    raise exception 'เฉพาะเจ้าของระบบและแอดมินเท่านั้นที่ตั้งรายการได้';
  end if;
  if coalesce(btrim(p_branch), '') = '' then
    raise exception 'ต้องใส่ชื่อสาขาที่ขอ';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'จำนวนต้องมากกว่าศูนย์';
  end if;
  if p_unit not in ('ชิ้น', 'กระสอบ') then
    raise exception 'หน่วยต้องเป็นชิ้นหรือกระสอบ';
  end if;

  v_ref := next_sack_ref();

  insert into sack_orders (ref_no, hub_code, qty, unit, branch, note, created_by)
  values (v_ref,
          coalesce(nullif(btrim(p_hub), ''), '21BPL'),
          p_qty, p_unit, btrim(p_branch),
          nullif(btrim(coalesce(p_note, '')), ''),
          auth.uid())
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'ref_no', v_ref);
end $$;

grant execute on function create_sack_order(text, integer, text, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- กดว่าส่งแล้ว — ใครที่ล็อกอินก็กดได้ ระบบจำว่าใครกด
--
-- กันกดซ้ำด้วยการเช็คสถานะก่อน ไม่ใช่เช็คที่หน้าจอ
-- เน็ตในฮับไม่นิ่ง คนกดค้างแล้วกดซ้ำเป็นเรื่องปกติ
-- ---------------------------------------------------------------------
create or replace function mark_sack_sent(
  p_id     uuid,
  p_mode   text,
  p_relay  text default null,
  p_photos jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row sack_orders%rowtype;
begin
  if p_mode not in ('direct', 'relay') then
    raise exception 'ต้องเลือกว่าส่งตรงหรือฝากส่ง';
  end if;
  if p_mode = 'relay' and coalesce(btrim(p_relay), '') = '' then
    raise exception 'ฝากส่งต้องใส่ชื่อสาขาที่ฝากด้วย';
  end if;

  select * into v_row from sack_orders where id = p_id for update;
  if not found then
    raise exception 'ไม่พบรายการนี้';
  end if;

  -- กดซ้ำไม่ถือว่าผิด ผลลัพธ์ที่คนกดต้องการคือ "ส่งแล้ว" ซึ่งเป็นจริงอยู่
  if v_row.status <> 'pending' then
    return jsonb_build_object('ref_no', v_row.ref_no, 'duplicate', true,
                              'status', v_row.status, 'relay_via', v_row.relay_via);
  end if;

  update sack_orders
     set status    = p_mode,
         relay_via = case when p_mode = 'relay' then btrim(p_relay) else null end,
         sent_by   = auth.uid(),
         sent_at   = now()
   where id = p_id;

  insert into sack_order_photos (order_id, seq, file_id, web_link, bytes)
  select p_id, (row_number() over ())::int,
         ph->>'file_id', ph->>'web_link', nullif(ph->>'bytes', '')::int
    from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) ph
   where coalesce(ph->>'file_id', '') <> '';

  return jsonb_build_object('ref_no', v_row.ref_no, 'duplicate', false,
                            'status', p_mode, 'relay_via', nullif(btrim(p_relay), ''));
end $$;

grant execute on function mark_sack_sent(uuid, text, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- รายชื่อสาขาที่เคยใช้ — รายการจะโตเองจากการใช้งาน
--
-- เจ้าของระบบไม่ต้องรู้ล่วงหน้าว่ามีสาขาอะไรบ้าง
-- พิมพ์ครั้งแรกระบบจำไว้ ครั้งต่อไปเลือกจากรายการได้
-- ช่วยไม่ให้ได้ "6PPD_PDC-พระประแดง" บ้าง "พระประแดง" บ้าง จนนับยอดไม่ได้
-- ---------------------------------------------------------------------
create or replace function sack_branches()
returns table (branch text, used integer, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select branch, count(*)::int, max(created_at)
    from sack_orders
   group by branch
   order by max(created_at) desc
   limit 300;
$$;

grant execute on function sack_branches() to authenticated;

/** สาขาที่เคยใช้เป็นตัวกลางฝากส่ง — ช่องฝากส่งก็มีตัวช่วยเหมือนกัน */
create or replace function sack_relays()
returns table (via text, used integer)
language sql stable security definer set search_path = public as $$
  select relay_via, count(*)::int
    from sack_orders
   where relay_via is not null
   group by relay_via
   order by count(*) desc
   limit 100;
$$;

grant execute on function sack_relays() to authenticated;


-- ---------------------------------------------------------------------
-- วิวสำหรับหน้าจอ — พ่วงชื่อคนและรูปมาให้พร้อม
-- ---------------------------------------------------------------------
create or replace view sack_rows
with (security_invoker = true) as
select
  o.id, o.ref_no, o.hub_code, o.qty, o.unit, o.branch, o.note,
  o.status, o.relay_via, o.created_at, o.sent_at,
  cb.full_name as created_by_name,
  sb.full_name as sent_by_name,
  coalesce(
    (select jsonb_agg(jsonb_build_object('seq', p.seq, 'file_id', p.file_id, 'web_link', p.web_link)
            order by p.seq)
       from sack_order_photos p where p.order_id = o.id),
    '[]'::jsonb
  ) as photos,
  (select count(*) from sack_order_photos p where p.order_id = o.id)::int as photo_count
from sack_orders o
left join profiles cb on cb.id = o.created_by
left join profiles sb on sb.id = o.sent_by;

grant select on sack_rows to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.tables where table_name = 'sack_orders')        as ตารางรายการ,
  (select count(*) from information_schema.tables where table_name = 'sack_order_photos')  as ตารางรูป,
  (select count(*) from pg_proc where proname = 'create_sack_order')                       as ฟังก์ชันตั้งรายการ,
  (select count(*) from pg_proc where proname = 'mark_sack_sent')                          as ฟังก์ชันกดส่ง,
  (select count(*) from information_schema.views where table_name = 'sack_rows')           as วิวสำหรับหน้าจอ,
  (select count(*) from sack_orders)                                                       as รายการที่มีอยู่;
-- =====================================================================
-- BPL SUPPLY — แจ้งเตือนเมื่อมีรายการกระสอบเข้าคิว
-- รันต่อจาก 066 · ปลอดภัยที่จะรันซ้ำ
--
-- ใครได้รับ
--   ① เจ้าของระบบ      role = 'admin'
--   ② แอดมินทุกคน       role = 'supervisor'
--   ③ ทีมซัพพอร์ต       sub_dept ตรงกับค่าที่ตั้งไว้ (ตั้งต้น SPADMIN)
--
-- ทำไมผูกกับ sub_dept ไม่ทำธงใหม่
--   คอลัมน์นี้มีอยู่แล้ว และแก้ได้ในหน้าผู้ใช้โดยไม่ต้องแตะโค้ด
--   ตั้งคนใหม่เข้าทีมซัพพอร์ต = พิมพ์ SPADMIN ในช่องแผนกย่อย จบ
--   ถ้าทำธงใหม่ต้องแก้ฐานข้อมูล หน้าจอ และสิทธิ์ ทั้งที่ได้ผลเท่ากัน
--
-- ชื่อแผนกย่อยเก็บเป็นค่าตั้งค่า ไม่ได้ฝังในโค้ด
--   วันหนึ่งอยากเปลี่ยนเป็น SUPPORT หรือ SP2 ก็แก้ค่าเดียวจบ ไม่ต้อง deploy
--
-- เทียบแบบไม่สนตัวพิมพ์เล็กใหญ่และตัดช่องว่างหัวท้าย
--   เพราะคนกรอกมือ พิมพ์ spadmin บ้าง SPADMIN บ้าง เว้นวรรคติดมาบ้าง
--   ถ้าเทียบตรง ๆ คนที่พิมพ์ผิดนิดเดียวจะไม่ได้รับแจ้งเตือนโดยไม่มีใครรู้
-- =====================================================================

insert into app_settings (key, value) values
  ('sack_notify_sub_dept', '"SPADMIN"'::jsonb)
on conflict (key) do nothing;


create or replace function push_sack_jobs()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tag text;
begin
  select btrim(both '"' from value::text) into v_tag
    from app_settings where key = 'sack_notify_sub_dept';
  v_tag := coalesce(nullif(btrim(v_tag), ''), 'SPADMIN');

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'sack_new',
      'subject', o.id::text,
      'user_id', p.id,
      'title',   'มีกระสอบรอส่ง · ' || o.branch,
      'body',    o.hub_code || ' · ' ||
                 to_char(o.qty, 'FM999,999,999') || ' ' || o.unit ||
                 coalesce(' · ' || o.note, ''),
      'url',     '/ship'
    ))
    from sack_orders o
    cross join profiles p
    where o.status = 'pending'
      and o.created_at > now() - interval '1 day'
      and p.is_active
      and (
        p.role in ('admin', 'supervisor')
        or upper(btrim(coalesce(p.sub_dept, ''))) = upper(v_tag)
      )
      and not exists (
        select 1 from notification_log n
        where n.kind = 'sack_new' and n.subject = o.id::text and n.user_id = p.id
      )
  ), '[]'::jsonb);
end $$;

grant execute on function push_sack_jobs() to authenticated, service_role;


-- ---------------------------------------------------------------------
-- ต่อเข้าคิวแจ้งเตือนเดิม
-- ---------------------------------------------------------------------
create or replace function push_due_jobs()
returns jsonb
language sql security definer set search_path = public as $$
  select push_core_jobs()
      || push_meeting_jobs()
      || push_meeting_open_jobs()
      || push_announcement_jobs()
      || push_sack_jobs();
$$;

grant execute on function push_due_jobs() to authenticated, service_role;


-- ---------------------------------------------------------------------
-- ตั้งรายการแล้วเตะนาฬิกาทันที ไม่ต้องรอรอบ 5 นาที
--
-- คนตั้งรายการคาดว่าทีมจะรู้เดี๋ยวนั้น ไม่ใช่อีกห้านาที
-- ถ้าเตะไม่สำเร็จก็ไม่ให้ล้มการตั้งรายการ เดี๋ยวรอบปกติเก็บให้อยู่ดี
-- ---------------------------------------------------------------------
create or replace function create_sack_order(
  p_branch text,
  p_qty    integer,
  p_unit   text default 'ชิ้น',
  p_note   text default null,
  p_hub    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id  uuid;
  v_ref text;
begin
  if my_role() not in ('admin', 'supervisor') then
    raise exception 'เฉพาะเจ้าของระบบและแอดมินเท่านั้นที่ตั้งรายการได้';
  end if;
  if coalesce(btrim(p_branch), '') = '' then
    raise exception 'ต้องใส่ชื่อสาขาที่ขอ';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'จำนวนต้องมากกว่าศูนย์';
  end if;
  if p_unit not in ('ชิ้น', 'กระสอบ') then
    raise exception 'หน่วยต้องเป็นชิ้นหรือกระสอบ';
  end if;

  v_ref := next_sack_ref();

  insert into sack_orders (ref_no, hub_code, qty, unit, branch, note, created_by)
  values (v_ref,
          coalesce(nullif(btrim(p_hub), ''), '21BPL'),
          p_qty, p_unit, btrim(p_branch),
          nullif(btrim(coalesce(p_note, '')), ''),
          auth.uid())
  returning id into v_id;

  begin
    perform push_tick();
  exception when others then
    raise notice 'ตั้งรายการแล้วแต่เตะแจ้งเตือนไม่สำเร็จ (%)', sqlerrm;
  end;

  return jsonb_build_object('id', v_id, 'ref_no', v_ref);
end $$;

grant execute on function create_sack_order(text, integer, text, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- ใครจะได้รับแจ้งเตือนบ้าง — ไว้ให้หน้าจอโชว์ก่อนกดตั้งรายการ
-- ---------------------------------------------------------------------
create or replace function sack_notify_targets()
returns table (full_name text, employee_code text, reason text, has_push boolean)
language sql stable security definer set search_path = public as $$
  with cfg as (
    select coalesce(
      nullif(btrim(btrim(both '"' from (select value::text from app_settings
                                         where key = 'sack_notify_sub_dept'))), ''),
      'SPADMIN') as tag
  )
  select p.full_name, p.employee_code,
         case
           when p.role = 'admin' then 'เจ้าของระบบ'
           when p.role = 'supervisor' then 'แอดมิน'
           else 'ทีมซัพพอร์ต (' || coalesce(p.sub_dept, '') || ')'
         end,
         exists (select 1 from push_subscriptions s where s.user_id = p.id)
    from profiles p, cfg
   where p.is_active
     and (p.role in ('admin', 'supervisor')
          or upper(btrim(coalesce(p.sub_dept, ''))) = upper(cfg.tag))
   order by p.role desc, p.full_name;
$$;

grant execute on function sack_notify_targets() to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname = 'push_sack_jobs')       as ฟังก์ชันแจ้งเตือน,
  (select btrim(both '"' from value::text) from app_settings
    where key = 'sack_notify_sub_dept')                                 as แผนกย่อยที่ตั้งไว้,
  (select count(*) from sack_notify_targets())                          as คนที่จะได้รับตอนนี้,
  (select count(*) from sack_notify_targets() where has_push)           as ในนั้นเปิดแจ้งเตือนแล้ว,
  jsonb_array_length(push_sack_jobs())                                  as งานรอส่งตอนนี้;
