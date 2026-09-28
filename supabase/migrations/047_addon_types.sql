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
