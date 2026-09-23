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
