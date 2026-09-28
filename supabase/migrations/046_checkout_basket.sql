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
-- RPC: คืนแบบตะกร้า — หลายประเภทในรอบเดียว รูปแยกตามประเภท
--
-- asset_return รับรูปชุดเดียวแล้วติดให้ทุกใบที่ออก
-- ซึ่งถูกตอนคืนประเภทเดียว แต่พอคืนข้ามประเภทรูปรถแดงจะไปติดใบวิทยุด้วย
-- ตัวนี้จึงแยกเรียกทีละประเภท แต่ละประเภทได้รูปของตัวเอง
-- ---------------------------------------------------------------------
create or replace function asset_return_groups(
  p_groups jsonb,
  p_note   text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  g        jsonb;
  v_codes  text[];
  v_one    jsonb;
  v_refs   text[] := '{}';
  v_n      int := 0;
begin
  if p_groups is null or jsonb_array_length(p_groups) = 0 then
    raise exception 'ยังไม่ได้เลือกเครื่องที่จะคืน';
  end if;

  for g in select * from jsonb_array_elements(p_groups) loop
    select array_agg(value::text) into v_codes
      from jsonb_array_elements_text(coalesce(g->'codes', '[]'::jsonb));

    if v_codes is null or array_length(v_codes, 1) is null then
      continue;
    end if;

    v_one := asset_return(
      v_codes,
      coalesce(g->'photos', '[]'::jsonb),
      coalesce(g->'issues', '[]'::jsonb),
      p_note
    );

    v_refs := v_refs || (v_one->>'ref_no');
    v_n := v_n + (v_one->>'count')::int;
  end loop;

  if array_length(v_refs, 1) is null then
    raise exception 'ไม่มีเครื่องที่คืนได้';
  end if;

  return jsonb_build_object(
    'ok', true,
    'count', v_n,
    'ref_no', array_to_string(v_refs, ' · '),
    'refs', to_jsonb(v_refs)
  );
end $$;

grant execute on function asset_return_groups(jsonb, text) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select 'ฟังก์ชันเบิกแบบตะกร้า' as สิ่งที่ตรวจ, count(*)::text as ผล
  from pg_proc where proname = 'asset_checkout_many'
union all select 'ฟังก์ชันคืนแบบตะกร้า', count(*)::text
  from pg_proc where proname = 'asset_return_groups';
