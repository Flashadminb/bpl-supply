-- =====================================================================
-- BPL SUPPLY — คืนแทนและโอนทีละหลายเครื่อง ไม่จำกัดประเภท
-- รันต่อจาก 039 · ปลอดภัยที่จะรันซ้ำ
--
-- สามข้อที่เจ้าของระบบสั่ง
--   1. คืนแทนกี่เครื่องก็ได้ ไม่ต้องเป็นของคนเดียวกันหรือประเภทเดียวกัน
--   2. โอนกี่เครื่องก็ได้ในครั้งเดียว
--   3. คืนแทนไม่บังคับถ่ายรูป · จะถ่ายกี่ใบก็ได้ไม่จำกัด
--      เพราะคนที่คืนแทนได้คือแอดมิน เจ้าของระบบ และผู้ตรวจสอบ ถือว่ามีอำนาจสูงพอ
--
-- ข้อ 3 ยกเว้นเฉพาะ "คืนแทน" เท่านั้น
-- ถ้าคนคนนั้นคืนเครื่องของตัวเอง ยังต้องถ่ายครบตามขั้นตอนเหมือนทุกคน
-- ไม่งั้นตำแหน่งจะกลายเป็นช่องทางเลี่ยงการถ่ายรูปของตัวเอง
--
-- เรื่องที่ต้องระวังตอนคืนหลายประเภทพร้อมกัน
--   asset_txns เก็บ type_code ได้ช่องเดียว ของเดิมใช้ประเภทของเครื่องแรก
--   พอปนประเภทกัน ใบคืนจะถูกนับเข้าประเภทที่ไม่เกี่ยวเลย รายงานจะเพี้ยน
--   จึงแยกใบตามประเภท ปนกันมากี่ประเภทก็ออกมากี่ใบ
--   รูปกับเหตุผลติดไปทุกใบ เพราะเป็นหลักฐานของการส่งมอบครั้งเดียวกัน
-- =====================================================================

-- ---------------------------------------------------------------------
-- RPC: คืนเครื่อง — รับได้หลายคน หลายประเภท ในครั้งเดียว
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

  -- ── รอบแรก: ล็อกทุกแถว ตรวจว่าคืนได้จริง และดูว่าเป็นการคืนแทนหรือไม่ ──
  -- ต้องรู้ให้ครบก่อนตัดสินเรื่องรูป ไม่งั้นจะไปรู้เอาตอนเขียนไปครึ่งทางแล้ว
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

  -- ── รูป ── บังคับเฉพาะตอนคืนของตัวเอง
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

  -- ── รอบสอง: ออกใบคืนทีละประเภท ──
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

      update assets set held_item_id = null, loan_dept = null where code = v_code;
      v_n := v_n + 1;
    end loop;

    -- รูปเดียวกันติดทุกใบ เป็นหลักฐานของการส่งมอบครั้งเดียวกัน
    -- ไม่ได้เปลืองที่เก็บ เพราะชี้ไปที่ไฟล์ใน Drive ใบเดิม
    for r in select * from jsonb_array_elements(p_photos) loop
      insert into asset_txn_photos (txn_id, seq, label, file_id, web_link, bytes)
      values (v_txn,
              coalesce((r->>'seq')::int, 1),
              r->>'label',
              r->>'file_id',
              r->>'web_link',
              (r->>'bytes')::int);
    end loop;

    -- อาการชำรุดเข้าใบของประเภทตัวเอง ไม่ใช่ใบแรกเสมอไป
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

  return jsonb_build_object(
    'id', v_first,
    'ref_no', array_to_string(v_refs, ' · '),
    'refs', to_jsonb(v_refs),
    'count', v_n
  );
end $$;

grant execute on function asset_return(text[], jsonb, jsonb, text) to authenticated;


-- ---------------------------------------------------------------------
-- RPC: โอนหลายเครื่องให้แผนกเดียวกันในครั้งเดียว
--
-- เครื่องที่อยู่กับแผนกปลายทางอยู่แล้วจะถูกข้าม ไม่ทำให้ทั้งชุดล้ม
-- เพราะคนกดเลือกมาสิบเครื่องแล้วล้มเพราะเครื่องเดียวคือการทำงานซ้ำฟรี ๆ
-- แต่ถ้าพังด้วยเหตุอื่น ทั้งชุดต้องย้อนกลับ จะได้ไม่ค้างครึ่ง ๆ กลาง ๆ
-- ---------------------------------------------------------------------
create or replace function asset_transfer_many(
  p_codes   text[],
  p_to_dept text,
  p_reason  text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_code    text;
  v_done    text[] := '{}';
  v_skipped text[] := '{}';
  v_here    text;
begin
  if not my_can_proxy() then
    raise exception 'บัญชีนี้โอนเครื่องไม่ได้';
  end if;

  if p_codes is null or array_length(p_codes, 1) is null then
    raise exception 'ยังไม่ได้เลือกเครื่องที่จะโอน';
  end if;

  foreach v_code in array p_codes loop
    select coalesce(a.loan_dept, a.dept_code) into v_here from assets a where a.code = v_code;

    if v_here is not distinct from p_to_dept then
      v_skipped := v_skipped || v_code;
    else
      perform asset_transfer(v_code, p_to_dept, p_reason);
      v_done := v_done || v_code;
    end if;
  end loop;

  if array_length(v_done, 1) is null then
    raise exception 'ทุกเครื่องที่เลือกอยู่กับแผนกนี้อยู่แล้ว';
  end if;

  return jsonb_build_object(
    'to_dept', p_to_dept,
    'moved', to_jsonb(v_done),
    'skipped', to_jsonb(v_skipped),
    'count', array_length(v_done, 1)
  );
end $$;

grant execute on function asset_transfer_many(text[], text, text) to authenticated;


-- ---------------------------------------------------------------------
-- View: ประวัติรายเครื่อง — บอกให้ชัดว่าใครปิดรายการ และปิดด้วยวิธีไหน
--
-- ของเดิมอ่าน "คนคืน" จาก user_id ของใบคืน ซึ่งสองเส้นทางใส่ค่าไม่เหมือนกัน
--   คืนแทนผ่าน asset_return      user_id = คนกดคืน  → ขึ้นชื่อแอดมิน ถูกต้อง
--   ปิดรายการผ่าน admin_release  user_id = คนเบิก   → ขึ้นชื่อเจ้าตัว ทั้งที่เจ้าตัวไม่ได้กด
--
-- อย่างหลังคือประวัติที่โกหก และเป็นเคสที่ต้องตรวจสอบย้อนหลังบ่อยที่สุด
-- จึงอ่านจาก acted_by ก่อนเสมอ แล้วค่อยตกไปที่ user_id
-- พร้อมเปิดธงบอกวิธีปิด และข้อความเหตุผลที่คนกดพิมพ์ไว้
-- ---------------------------------------------------------------------
drop view if exists asset_history;
create view asset_history
with (security_invoker = true) as
select
  ai.id                                   as out_item_id,
  ai.asset_code,
  a.type_code,
  ty.name                                 as type_name,
  a.dept_code                             as asset_dept,
  t.id                                    as txn_id,
  t.ref_no,
  t.user_id,
  p.full_name                             as who,
  p.employee_code,
  t.dept_code                             as holder_dept,
  p.sub_dept,
  t.acted_by,
  ap.full_name                            as acted_by_name,
  t.shift_start,
  t.shift_end,
  t.due_at,
  t.created_at                            as taken_at,
  back.created_at                         as returned_at,
  back.ref_no                             as return_ref,
  -- คนที่กดปิดจริง ๆ ไม่ใช่คนที่ชื่ออยู่บนใบ
  coalesce(backa.full_name, backp.full_name) as returned_by,
  (back.acted_by is not null)             as returned_by_proxy,
  coalesce(back.is_transfer, false)       as closed_by_transfer,
  coalesce(back.is_forced, false)         as closed_forced,
  back.note                               as return_note,
  (back.id is null)                       as still_out,
  coalesce((
    select array_agg(ph.file_id order by ph.seq)
    from asset_txn_photos ph where ph.txn_id = t.id
  ), '{}')                                 as out_file_ids,
  coalesce((
    select array_agg(ph.file_id order by ph.seq)
    from asset_txn_photos ph where ph.txn_id = back.id
  ), '{}')                                 as in_file_ids,
  case
    when back.created_at is not null
      then extract(epoch from (back.created_at - t.created_at)) / 3600
  end::numeric(10, 2)                     as held_hours
from asset_txn_items ai
join asset_txns t   on t.id = ai.txn_id and t.kind = 'out'
join assets a       on a.code = ai.asset_code
join asset_types ty on ty.code = a.type_code
join profiles p     on p.id = t.user_id
left join profiles ap               on ap.id = t.acted_by
left join asset_txn_items back_item on back_item.out_item_id = ai.id
left join asset_txns back           on back.id = back_item.txn_id
left join profiles backp            on backp.id = back.user_id
left join profiles backa            on backa.id = back.acted_by;

grant select on asset_history to authenticated;
