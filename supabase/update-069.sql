-- =====================================================================
-- BPL SUPPLY — เบิกพัสดุสิ้นเปลืองแทนคนอื่น
-- รันต่อจาก 068 · ปลอดภัยที่จะรันซ้ำ
--
-- ฝั่ง Asset ทำได้มาตั้งแต่ 032 แล้ว ฝั่งสิ้นเปลืองยังไม่ได้
-- ทั้งที่เป็นปัญหาเดียวกัน คนที่ต้องใช้ของอยู่หน้างาน เปิดแอพไม่ทัน
-- หรือเข้าไม่ได้ แล้วมาฝากแอดมินกด สุดท้ายของไปค้างชื่อแอดมิน
--
-- ใครเบิกแทนได้ — ชุดเดียวกับ Asset เป๊ะ ๆ ผ่าน my_can_proxy()
--   เจ้าของระบบ · แอดมิน · ผู้ตรวจสอบ
-- ไม่ได้เขียนเงื่อนไขชุดใหม่ เพราะสองที่ที่คุมสิทธิ์เหมือนกันแต่เขียนคนละแบบ
-- จะเพี้ยนออกจากกันเมื่อไหร่ก็ได้โดยไม่มีใครรู้
--
-- requester_id ยังเป็น "คนที่ของไปอยู่ด้วย" เหมือนเดิมทุกประการ
--   ของค้างคืนไปค้างชื่อเจ้าตัว ประวัติขึ้นที่เจ้าตัว
--   แจ้งเตือนอนุมัติที่เขียนไว้แล้วยิงหาเจ้าตัวเอง ไม่ต้องแก้อะไรเลย
-- acted_by คือคนที่กดให้ ว่าง = เบิกเอง ซึ่งคือทุกแถวที่มีอยู่ตอนนี้
--
-- กระทบหน้างานที่ใช้อยู่ไหม — ไม่
--   พารามิเตอร์ใหม่อยู่ท้ายสุดและมีค่าตั้งต้นเป็น null
--   ไม่ส่งมาก็คือเบิกให้ตัวเอง ซึ่งเป็นพฤติกรรมเดิมทุกบรรทัด
--   ตัวฟังก์ชันคัดลอกมาจากของจริงที่ใช้อยู่ (057) แก้เฉพาะหกจุดที่ว่าไว้ในไฟล์นี้
-- =====================================================================

alter table requisitions
  add column if not exists acted_by uuid references profiles (id);

comment on column requisitions.acted_by is
  'คนที่กดเบิกให้ ถ้าไม่ใช่เจ้าตัว · ว่าง = เบิกเอง';

create index if not exists req_acted_idx
  on requisitions (acted_by, created_at desc) where acted_by is not null;


-- ---------------------------------------------------------------------
-- ฟังก์ชันเบิก
--
-- ทิ้งตัวเก่าที่รับ 6 อาร์กิวเมนต์ก่อน ไม่งั้นจะมีสองตัวชื่อเดียวกัน
-- แล้ว PostgREST จะเลือกไม่ถูกว่าจะเรียกตัวไหน
-- ทั้งสคริปต์รันในธุรกรรมเดียว ระหว่างนี้จึงไม่มีช่วงที่แอพเบิกไม่ได้
-- ---------------------------------------------------------------------
drop function if exists create_requisition(jsonb, text, text, text, text, integer);

create or replace function create_requisition(
  p_lines            jsonb,
  p_purpose          text default null,
  p_note             text default null,
  p_evidence_file_id text default null,
  p_evidence_link    text default null,
  p_evidence_bytes   integer default null,
  p_for_user         uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me         profiles%rowtype;
  v_profile    profiles%rowtype;   -- คนที่ของไปอยู่ด้วย (ของเดิมคือคนกด)
  v_actor      uuid;               -- คนกดให้ - ว่าง = เบิกเอง
  v_req_id     uuid;
  v_ref        text;
  v_line       jsonb;
  v_item       items%rowtype;
  v_qty        integer;
  v_auto       boolean;
  v_all_auto   boolean := true;
  v_status     req_status;
begin
  select * into v_me from profiles where id = auth.uid();
  if not found or not v_me.is_active then
    raise exception 'ไม่พบผู้ใช้หรือบัญชีถูกระงับ';
  end if;

  -- เบิกให้ใคร - โครงเดียวกับ asset_checkout ทุกบรรทัด
  --
  -- v_profile ยังหมายถึง "คนที่ของไปอยู่ด้วย" เหมือนเดิม
  -- ของค้างคืน กะ ประวัติ และการแจ้งเตือนที่เขียนไว้แล้วจึงไม่ต้องแก้สักที่
  -- สิ่งที่เพิ่มคือ acted_by ซึ่งบอกว่าใครเป็นคนกดให้
  if p_for_user is null or p_for_user = v_me.id then
    v_profile := v_me;
    v_actor   := null;
  else
    if not my_can_proxy() then
      raise exception 'บัญชีนี้เบิกแทนคนอื่นไม่ได้';
    end if;
    select * into v_profile from profiles where id = p_for_user;
    if v_profile.id is null or not v_profile.is_active then
      raise exception 'ไม่พบผู้รับของ หรือบัญชีถูกระงับ';
    end if;
    v_actor := v_me.id;
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
                            decided_at, decided_by, acted_by)
  values (v_ref, v_profile.id, v_profile.hub_code, p_purpose, p_note, v_status,
          p_evidence_file_id, p_evidence_link, p_evidence_bytes,
          case when v_status = 'approved' then now() end,
          case when v_status = 'approved' then v_me.id end,
          v_actor)
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
                'requisition', v_req_id::text, v_me.id);
    end if;
  end loop;

  insert into sync_log (requisition_id, channel, state) values
    (v_req_id, 'SPB'::sync_channel, 'done'::sync_state),
    (v_req_id, 'GDV'::sync_channel,
      case when p_evidence_file_id is null then 'pending'::sync_state else 'done'::sync_state end),
    (v_req_id, 'GSH'::sync_channel, 'pending'::sync_state)
  on conflict do nothing;

  return jsonb_build_object('ref_no', v_ref, 'id', v_req_id, 'status', v_status,
                            'for_name', case when v_actor is null then null
                                             else v_profile.full_name end);
end $$;

grant execute on function create_requisition(jsonb, text, text, text, text, integer, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- ใบที่เบิกแทน พ่วงชื่อคนกดมาให้ — ไว้ให้หน้าอนุมัติและหน้าประวัติอ่าน
--
-- ทำเป็นวิวแทนการ join ในทุกหน้าจอ
-- เพราะถ้าปล่อยให้แต่ละหน้า join เอง วันหนึ่งจะมีหน้าที่ลืม
-- แล้วใบที่เบิกแทนจะดูเหมือนเจ้าตัวกดเองโดยไม่มีอะไรบอก
-- ---------------------------------------------------------------------
drop view if exists requisition_actors;
create view requisition_actors
with (security_invoker = true) as
select
  r.id            as requisition_id,
  r.ref_no,
  r.requester_id,
  r.acted_by,
  a.full_name     as acted_by_name,
  a.employee_code as acted_by_code
from requisitions r
join profiles a on a.id = r.acted_by
where r.acted_by is not null;

grant select on requisition_actors to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'requisitions' and column_name = 'acted_by')      as คอลัมน์คนกดให้,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'create_requisition' and n.nspname = 'public')     as ฟังก์ชันเบิก,
  (select pg_get_function_identity_arguments(p.oid)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'create_requisition' and n.nspname = 'public')     as ลายเซ็น,
  (select count(*) from requisitions where acted_by is not null)         as ใบที่เบิกแทน,
  (select count(*) from information_schema.views
    where table_name = 'requisition_actors')                             as วิวคนกดให้;
