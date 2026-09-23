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
