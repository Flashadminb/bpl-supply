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
