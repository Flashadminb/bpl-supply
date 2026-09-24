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
