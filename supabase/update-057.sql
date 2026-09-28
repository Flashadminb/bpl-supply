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
