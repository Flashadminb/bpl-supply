-- =====================================================================
-- BPL SUPPLY — ประวัติแบบตัวหนังสือ และการลบที่ไม่ทำให้ประวัติหาย
-- รันต่อจาก 093 · ปลอดภัยที่จะรันซ้ำ
--
-- สามเรื่องในไฟล์เดียว เพราะมันเป็นเรื่องเดียวกัน คือ "ลบได้ แต่ต้องไม่ลืม"
--
-- 1. เคลียร์ใบแจ้งชำรุด ไม่บังคับรูปแล้ว แต่บังคับว่าต้องมีอย่างน้อยหนึ่งอย่าง
--    รูปหรือข้อความ · ของเดิมบังคับรูปอย่างเดียว ซึ่งงานจริงบางครั้งไม่มีอะไรให้ถ่าย
--    เช่น ส่งศูนย์เคลมไปแล้ว หรือเป็นอาการที่ถ่ายไม่ติด การบังคับถ่ายในกรณีพวกนี้
--    ได้รูปเครื่องเฉย ๆ ที่ไม่บอกอะไร ส่วนคำอธิบายที่มีค่าจริงกลับไม่ถูกบังคับ
--
-- 2. ตารางประวัติแบบตัวหนังสือ history_notes
--    ของที่ถูกลบจะถูกย่อเป็นข้อความเก็บไว้ก่อนเสมอ พร้อมลิงก์ไดร์ฟของรูป
--    เก็บแค่ตัวหนังสือ ไม่เก็บรูปซ้ำ เพราะรูปอยู่ในไดร์ฟอยู่แล้วและไดร์ฟไม่ใช่ข้อจำกัด
--    แถวข้อความหนึ่งแถวหนักไม่ถึงหนึ่งกิโลไบต์ อ่านย้อนหลังทั้งปีก็ยังเบากว่ารูปใบเดียว
--
-- 3. ฟังก์ชันลบที่เขียนประวัติก่อนลบ และคืนสถานะให้ตรงกับความจริงเสมอ
--    ลบใบเบิกวัสดุ = สต็อกกลับคืน · ลบใบเบิกเครื่อง = เครื่องว่าง
--    ลบใบคืนเครื่อง = เครื่องกลับไปอยู่ในมือคนเดิม
--    ถ้าไม่ทำแบบนี้ การลบแถวเทสหนึ่งแถวจะทำให้ตัวเลขสต็อกผิดไปตลอดกาล
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. ประวัติแบบตัวหนังสือ
-- ---------------------------------------------------------------------
create table if not exists history_notes (
  id               bigserial primary key,
  -- 'issue' แจ้งเสีย · 'asset' เบิกคืนเครื่อง · 'supply' เบิกวัสดุ
  kind             text not null,
  ref_no           text,
  -- รหัสเครื่องหรือหัวข้อสั้น ๆ ไว้ค้นหา
  subject          text,
  who              text,
  -- เวลาที่เรื่องเกิดจริง ไม่ใช่เวลาที่ลบ · ใช้ตัวนี้เรียงและกรองตามปฏิทิน
  happened_at      timestamptz,
  body             text not null,
  -- ลิงก์ไดร์ฟคั่นบรรทัด · ตามหารูปเองได้ภายหลังโดยไม่ต้องเก็บรูปไว้ในฐานข้อมูล
  links            text,
  photos           integer not null default 0,
  -- เหตุผลที่ลบ ถ้าคนลบพิมพ์มา
  reason           text,
  archived_at      timestamptz not null default now(),
  archived_by      uuid references profiles(id),
  archived_by_name text
);

create index if not exists history_notes_kind_idx on history_notes (kind, happened_at desc);
create index if not exists history_notes_subject_idx on history_notes (subject);

alter table history_notes enable row level security;

-- อ่านได้เฉพาะผู้ตรวจสอบและแอดมิน · เขียนผ่าน RPC เท่านั้น ไม่มี policy เขียน
drop policy if exists read_history_notes on history_notes;
create policy read_history_notes on history_notes for select to authenticated
  using (my_can_audit());

grant select on history_notes to authenticated;


-- เขียนประวัติหนึ่งแถว · ใช้ซ้ำในทุกฟังก์ชันลบข้างล่าง
create or replace function history_note_add(
  p_kind    text,
  p_ref     text,
  p_subject text,
  p_who     text,
  p_at      timestamptz,
  p_body    text,
  p_links   text,
  p_photos  integer,
  p_reason  text
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
begin
  insert into history_notes (kind, ref_no, subject, who, happened_at, body, links, photos,
                             reason, archived_by, archived_by_name)
  values (p_kind, p_ref, p_subject, p_who, p_at, p_body, nullif(p_links, ''),
          coalesce(p_photos, 0), nullif(btrim(coalesce(p_reason, '')), ''), auth.uid(),
          (select full_name from profiles where id = auth.uid()))
  returning id into v_id;
  return v_id;
end $$;

-- ตัวช่วยภายใน ไม่มีด่านตรวจสิทธิ์ของตัวเอง เพราะคนเรียกคือฟังก์ชันลบที่ตรวจไปแล้ว
-- Postgres ให้สิทธิ์เรียกกับ public มาตั้งแต่ตอนสร้าง จึงต้องถอนออกเอง
-- ไม่ถอนแปลว่าใครก็ได้ยิงประวัติปลอมเข้ามาได้
revoke execute on function history_note_add(text, text, text, text, timestamptz, text, text, integer, text) from public;


-- ---------------------------------------------------------------------
-- 2. เคลียร์ใบแจ้งชำรุด — รูปหรือข้อความ อย่างน้อยหนึ่งอย่าง
-- ---------------------------------------------------------------------
create or replace function resolve_asset_issue(
  p_id     bigint,
  p_note   text,
  p_photos jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_shots integer := 0;
  v_note  text;
  v_code  text;
begin
  if not my_can_audit() then
    raise exception 'ไม่มีสิทธิ์เคลียร์ใบแจ้งชำรุด';
  end if;

  select asset_code into v_code from asset_issues where id = p_id and resolved_at is null;
  if v_code is null then
    raise exception 'ไม่พบใบนี้ หรือเคลียร์ไปแล้ว';
  end if;

  select count(*) into v_shots
    from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) e
   where coalesce(e->>'file_id', '') <> '';
  v_note := nullif(btrim(coalesce(p_note, '')), '');

  -- ไม่ถ่ายรูปก็ได้ แต่ต้องเขียนว่าซ่อมอะไรไป ปล่อยว่างทั้งคู่ไม่ได้
  -- เพราะอย่างนั้นประวัติจะบอกได้แค่ว่า "มีคนกดว่าซ่อมแล้ว" ซึ่งเท่ากับไม่มีประวัติ
  if v_shots = 0 and v_note is null then
    raise exception 'ต้องใส่อย่างน้อยหนึ่งอย่าง — รูปตอนซ่อมเสร็จ หรือข้อความว่าซ่อมอะไรไป';
  end if;

  if v_shots > 0 then
    insert into asset_issue_photos (issue_id, phase, seq, file_id, web_link, bytes, taken_by)
    select p_id, 'fix', (row_number() over ())::int, e->>'file_id', e->>'web_link',
           (e->>'bytes')::integer, auth.uid()
      from jsonb_array_elements(p_photos) e
     where coalesce(e->>'file_id', '') <> '';
  end if;

  update asset_issues
     set resolved_at = now(), resolved_by = auth.uid(), resolve_note = v_note
   where id = p_id;

  return jsonb_build_object('ok', true, 'id', p_id, 'asset_code', v_code);
end $$;

grant execute on function resolve_asset_issue(bigint, text, jsonb) to authenticated;


create or replace function resolve_asset_issues_for(
  p_code   text,
  p_note   text,
  p_photos jsonb
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n     integer;
  v_shots integer := 0;
  v_note  text;
begin
  if my_role() not in ('supervisor', 'admin') then
    raise exception 'ไม่มีสิทธิ์เคลียร์อาการชำรุด';
  end if;

  select count(*) into v_shots
    from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) e
   where coalesce(e->>'file_id', '') <> '';
  v_note := nullif(btrim(coalesce(p_note, '')), '');

  if v_shots = 0 and v_note is null then
    raise exception 'ต้องใส่อย่างน้อยหนึ่งอย่าง — รูปตอนซ่อมเสร็จ หรือข้อความว่าซ่อมอะไรไป';
  end if;

  if v_shots > 0 then
    insert into asset_issue_photos (issue_id, phase, seq, file_id, web_link, bytes, taken_by)
    select i.id, 'fix', (row_number() over (partition by i.id))::int, e->>'file_id',
           e->>'web_link', (e->>'bytes')::integer, auth.uid()
      from asset_issues i
      cross join jsonb_array_elements(p_photos) e
     where i.asset_code = p_code and i.resolved_at is null
       and coalesce(e->>'file_id', '') <> '';
  end if;

  update asset_issues
     set resolved_at = now(), resolved_by = auth.uid(), resolve_note = v_note
   where asset_code = p_code and resolved_at is null;

  get diagnostics v_n = row_count;
  return v_n;
end $$;

grant execute on function resolve_asset_issues_for(text, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- 3. ลบใบแจ้งชำรุด — ย่อเป็นข้อความเก็บไว้ก่อนเสมอ
-- ---------------------------------------------------------------------
create or replace function asset_issues_delete(p_ids bigint[], p_why text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
  r   record;
begin
  if my_role() not in ('supervisor', 'admin') then
    raise exception 'ไม่มีสิทธิ์ลบใบแจ้งชำรุด';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  for r in
    select i.*,
           ty.name                                 as type_name,
           coalesce(rp.full_name, i.reported_name) as reporter,
           sp.full_name                            as fixer,
           (select count(*) from asset_issue_photos p where p.issue_id = i.id)::int as n_shots,
           (select string_agg(coalesce(p.web_link, p.file_id), E'\n' order by p.created_at, p.id)
              from asset_issue_photos p where p.issue_id = i.id)                    as shot_links
      from asset_issues i
      left join assets a      on a.code = i.asset_code
      left join asset_types ty on ty.code = a.type_code
      left join profiles rp   on rp.id = i.reported_by
      left join profiles sp   on sp.id = i.resolved_by
     where i.id = any(p_ids)
  loop
    perform history_note_add(
      'issue', null, r.asset_code, r.reporter, r.reported_at,
      concat_ws(E'\n',
        'แจ้งเสีย ' || r.asset_code || coalesce(' · ' || r.type_name, ''),
        'อาการ: ' || r.symptom,
        case r.phase::text
          when 'out' then 'แจ้งตอนเบิก'
          when 'in'  then 'แจ้งตอนคืน'
          else 'แจ้งจากหน้าทะเบียน'
        end,
        case
          when r.resolved_at is null then 'ตอนลบยังไม่ได้เคลียร์'
          else 'เคลียร์แล้ว ' ||
               to_char(r.resolved_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI') ||
               coalesce(' โดย ' || r.fixer, '')
        end,
        case when r.resolve_note is null then null else 'บันทึกการซ่อม: ' || r.resolve_note end),
      r.shot_links, r.n_shots, p_why);
  end loop;

  delete from asset_issues where id = any(p_ids);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

grant execute on function asset_issues_delete(bigint[], text) to authenticated;


-- ---------------------------------------------------------------------
-- 4. ลบใบเบิก/คืนเครื่อง — คืนสถานะเครื่องให้ตรงกับความจริงด้วย
--
-- ลบใบคืนแล้วไม่คืนสถานะ = เครื่องหายไปจากรายการที่ต้องตามคืน ทั้งที่ยังอยู่ในมือคน
-- ลบใบเบิกแล้วไม่คืนสถานะ = เครื่องค้างว่า "ถูกยืมอยู่" ตลอดกาล เบิกใหม่ไม่ได้
-- ---------------------------------------------------------------------
create or replace function asset_txns_delete(p_ids uuid[], p_why text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n       integer;
  v_blocked text;
  v_ret     uuid[];
  v_all     uuid[];
  r         record;
begin
  if my_role() not in ('supervisor', 'admin') then
    raise exception 'ไม่มีสิทธิ์ลบรายการเบิก-คืนเครื่อง';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  -- หน้าจอส่งมาแค่ใบเบิก เพราะการ์ดหนึ่งใบคือใบเบิกหนึ่งใบ ส่วนการคืนเป็นเหตุการณ์ในการ์ด
  -- จึงต้องตามเก็บใบคืนของมันมาลบด้วย ไม่งั้นแถวคืนจะชี้ไปที่แถวเบิกที่ไม่มีอยู่แล้ว
  select coalesce(array_agg(distinct rt.id), '{}')
    into v_ret
    from asset_txn_items ri
    join asset_txns rt      on rt.id = ri.txn_id and rt.kind = 'in'
    join asset_txn_items oi on oi.id = ri.out_item_id
   where oi.txn_id = any(p_ids);

  -- ใบคืนใบเดียวคืนเครื่องของหลายใบเบิกพร้อมกันได้ · ใบแบบนั้นลบไม่ได้
  -- เพราะจะพาเครื่องของใบเบิกอื่นที่เขาไม่ได้สั่งลบหายไปด้วย
  select string_agg(distinct rt.ref_no, ', ') into v_blocked
    from asset_txn_items ri
    join asset_txns rt      on rt.id = ri.txn_id
    join asset_txn_items oi on oi.id = ri.out_item_id
   where rt.id = any(v_ret) and not (oi.txn_id = any(p_ids));
  if v_blocked is not null then
    raise exception 'ใบคืน % มีเครื่องของใบเบิกอื่นปนอยู่ ลบจากหน้านี้ไม่ได้', v_blocked;
  end if;

  v_all := p_ids || v_ret;

  for r in
    select t.*,
           p.full_name as who_name,
           p.employee_code,
           ty.name     as type_name,
           (select string_agg(ai.asset_code, ' · ' order by ai.asset_code)
              from asset_txn_items ai where ai.txn_id = t.id)                     as codes,
           (select count(*) from asset_txn_photos ph where ph.txn_id = t.id)::int as n_shots,
           (select string_agg(coalesce(ph.web_link, ph.file_id), E'\n' order by ph.seq, ph.id)
              from asset_txn_photos ph where ph.txn_id = t.id)                    as shot_links
      from asset_txns t
      left join profiles p     on p.id = t.user_id
      left join asset_types ty on ty.code = t.type_code
     where t.id = any(v_all)
  loop
    perform history_note_add(
      'asset', r.ref_no, r.codes, r.who_name, r.created_at,
      concat_ws(E'\n',
        case when r.kind::text = 'out' then 'เบิกเครื่อง' else 'คืนเครื่อง' end ||
          coalesce(' · ' || r.type_name, ''),
        'เครื่อง: ' || coalesce(r.codes, '—'),
        'คน: ' || coalesce(r.who_name, '—') || coalesce(' (' || r.employee_code || ')', '') ||
          coalesce(' · ' || r.dept_code, ''),
        case when r.due_at is null then null
             else 'กำหนดคืน ' ||
                  to_char(r.due_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI') end,
        case when r.note is null then null else 'หมายเหตุ: ' || r.note end),
      r.shot_links, r.n_shots, p_why);
  end loop;

  -- ลบใบคืน → เครื่องกลับไปอยู่ในมือคนเดิม (ต้องทำก่อน)
  update assets a
     set held_item_id = ri.out_item_id
    from asset_txn_items ri
    join asset_txns t on t.id = ri.txn_id
   where t.id = any(v_all) and t.kind = 'in'
     and ri.out_item_id is not null and a.code = ri.asset_code;

  -- ลบใบเบิก → เครื่องว่าง · ถ้าลบคู่กับใบคืน บรรทัดนี้จะล้างของบรรทัดบนให้เอง
  update assets a
     set held_item_id = null
    from asset_txn_items oi
    join asset_txns t on t.id = oi.txn_id
   where t.id = any(v_all) and t.kind = 'out' and a.held_item_id = oi.id;

  delete from asset_txns where id = any(v_all);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

grant execute on function asset_txns_delete(uuid[], text) to authenticated;


-- ---------------------------------------------------------------------
-- 5. ลบใบเบิกวัสดุ — สต็อกต้องกลับคืน
--
-- ของที่ตัดไปตอนเบิกคือ qty_approved · ส่วนที่คืนมาสภาพดีถูกบวกกลับไปแล้วตอนคืน
-- ที่ต้องบวกคืนตอนลบจึงเหลือแค่ส่วนต่าง และบันทึกเป็น stock_movements ไว้ด้วย
-- จะได้ไม่มีวันที่ตัวเลขสต็อกขยับโดยไม่มีบรรทัดอธิบาย
-- ---------------------------------------------------------------------
create or replace function requisitions_delete(p_ids uuid[], p_why text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n     integer;
  v_after integer;
  r       record;
  l       record;
begin
  if my_role() not in ('supervisor', 'admin') then
    raise exception 'ไม่มีสิทธิ์ลบใบเบิกวัสดุ';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  for r in
    select q.*,
           p.full_name as who_name,
           p.employee_code,
           p.dept_code,
           (select string_agg(i.name || ' ' || coalesce(ri.qty_approved, ri.qty_requested) ||
                              ' ' || i.unit, ' · ' order by i.name)
              from requisition_items ri join items i on i.id = ri.item_id
             where ri.requisition_id = q.id)                                     as lines,
           (select count(*) from requisition_photos ph where ph.requisition_id = q.id)::int
             + (case when q.evidence_file_id is null then 0 else 1 end)          as n_shots,
           concat_ws(E'\n', q.evidence_web_link,
             (select string_agg(coalesce(ph.web_link, ph.file_id), E'\n' order by ph.sort_no)
                from requisition_photos ph where ph.requisition_id = q.id))      as shot_links
      from requisitions q
      left join profiles p on p.id = q.requester_id
     where q.id = any(p_ids)
  loop
    perform history_note_add(
      'supply', r.ref_no, r.ref_no, r.who_name, r.created_at,
      concat_ws(E'\n',
        'ใบเบิกวัสดุ ' || r.ref_no || ' · ' || r.status::text,
        'คน: ' || coalesce(r.who_name, '—') || coalesce(' (' || r.employee_code || ')', '') ||
          coalesce(' · ' || r.dept_code, ''),
        'รายการ: ' || coalesce(r.lines, '—'),
        case when r.purpose is null then null else 'เอาไปทำอะไร: ' || r.purpose end,
        case when r.note is null then null else 'หมายเหตุ: ' || r.note end),
      r.shot_links, r.n_shots, p_why);
  end loop;

  -- คืนสต็อกเฉพาะส่วนที่ยังไม่ได้ถูกบวกกลับไปตอนคืนของ
  for l in
    select ri.item_id,
           (coalesce(ri.qty_approved, 0) -
            coalesce((select sum(rr.qty) from returns rr
                       where rr.requisition_item_id = ri.id and rr.condition = 'ok'), 0))::int as back,
           q.ref_no
      from requisition_items ri
      join requisitions q on q.id = ri.requisition_id
     where q.id = any(p_ids) and ri.status = 'approved'
  loop
    if l.back <> 0 then
      update items set qty_on_hand = qty_on_hand + l.back, updated_at = now()
       where id = l.item_id
      returning qty_on_hand into v_after;

      insert into stock_movements (item_id, delta, qty_after, reason, ref_type, ref_id, actor_id)
      values (l.item_id, l.back, v_after, 'ลบใบเบิก', 'requisition', l.ref_no, auth.uid());
    end if;
  end loop;

  delete from requisitions where id = any(p_ids);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

grant execute on function requisitions_delete(uuid[], text) to authenticated;


-- ---------------------------------------------------------------------
-- 6. บรรทัดที่ไม่อยากให้เขียนลงชีต
--
-- ไม่ได้ลบใบเบิกทิ้ง เพราะใบเบิกคือของจริงที่ตัดสต็อกไปแล้ว
-- แค่ทำเครื่องหมายว่า "ข้าม" ให้มันหลุดจากคิวรอส่ง ชีตจึงไม่มีวันได้บรรทัดนี้
-- กดคืนได้ถ้าเปลี่ยนใจ · อยากลบของจริงให้ไปลบที่หน้าสถานะเบิก-คืน
-- ---------------------------------------------------------------------
create or replace function export_line_skip(
  p_kind text,
  p_ids  bigint[],
  p_skip boolean default true
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if my_role() not in ('supervisor', 'admin') then
    raise exception 'ไม่มีสิทธิ์แก้คิวส่งชีต';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  if p_kind = 'supply' then
    if p_skip then
      insert into sheet_exports (requisition_item_id, tab, row_no)
      select unnest(p_ids), 'ข้าม', 0
      on conflict (requisition_item_id) do nothing;
    else
      delete from sheet_exports where requisition_item_id = any(p_ids) and tab = 'ข้าม';
    end if;
  elsif p_kind = 'asset' then
    if p_skip then
      insert into asset_sheet_exports (asset_txn_item_id, tab, row_no)
      select unnest(p_ids), 'ข้าม', 0
      on conflict (asset_txn_item_id) do nothing;
    else
      delete from asset_sheet_exports where asset_txn_item_id = any(p_ids) and tab = 'ข้าม';
    end if;
  else
    raise exception 'ชนิดไม่ถูกต้อง';
  end if;

  get diagnostics v_n = row_count;
  return v_n;
end $$;

grant execute on function export_line_skip(text, bigint[], boolean) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_name = 'history_notes')                              as ตารางประวัติ,
  (select count(*) from pg_proc
    where proname in ('asset_issues_delete', 'asset_txns_delete',
                      'requisitions_delete', 'export_line_skip',
                      'history_note_add'))                           as ฟังก์ชันที่เพิ่ม,
  (select count(*) from asset_issues where resolved_at is null)      as ใบแจ้งเสียที่ยังค้าง,
  (select count(*) from history_notes)                               as ประวัติที่เก็บไว้แล้ว;
