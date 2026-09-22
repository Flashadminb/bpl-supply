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
