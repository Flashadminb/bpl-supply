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
