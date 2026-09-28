-- =====================================================================
-- BPL SUPPLY — โอนเครื่องให้ "คน" ไม่ใช่ "แผนก"
-- รันต่อจาก 040 · ปลอดภัยที่จะรันซ้ำ
--
-- เหตุผลจากเจ้าของระบบ: ยังไงเครื่องก็เข้าแผนกของคนนั้นอยู่แล้ว
-- การให้เลือกแผนกจึงเป็นการถามซ้ำในสิ่งที่รู้อยู่แล้ว
-- และเวลาโอนจริงหน้างาน คนกดคิดเป็นชื่อคนว่า "ให้พี่คนนั้นไปใช้ก่อน"
-- ไม่ได้คิดเป็นรหัสแผนก
--
-- ผลพลอยได้ที่สำคัญกว่า: ของเดิมโอนให้แผนกแปลว่าทุกคนในแผนกนั้นเห็นและแย่งกดเบิกได้
-- ตอนนี้เห็นคนเดียวคือคนที่ถูกระบุชื่อ ตรงกับเจตนา "ตัดไปให้คนนี้ใช้ชั่วคราว"
--
-- loan_dept ยังอยู่ในตารางแต่เลิกใช้แล้ว ไม่ลบทิ้งเพราะแถวเก่ายังอ้างถึง
-- ของใหม่จะเซ็ตเป็นว่างเสมอ
-- =====================================================================

-- ── โครงสร้าง ─────────────────────────────────────────────────────────
alter table assets add column if not exists loan_user uuid references profiles(id);

comment on column assets.loan_user is
  'คนที่ได้รับเครื่องมาใช้ชั่วคราวจากการโอน · ว่าง = ไม่ได้ถูกโอนอยู่';

create index if not exists assets_loan_user_idx on assets (loan_user) where loan_user is not null;

alter table asset_transfers add column if not exists to_user_id uuid references profiles(id);
-- แถวเก่าโอนเป็นแผนก แถวใหม่โอนเป็นคน คอลัมน์เดิมจึงต้องยอมให้ว่างได้
alter table asset_transfers alter column to_dept drop not null;

create index if not exists asset_transfers_touser_idx
  on asset_transfers (to_user_id) where claimed_at is null;


-- ── ใครเห็นเครื่องไหน ─────────────────────────────────────────────────
drop policy if exists read_assets on assets;
create policy read_assets on assets for select to authenticated using (
  my_role() in ('supervisor', 'admin')
  or my_can_dispatch()
  -- คนที่ถืออยู่ต้องเห็นเสมอ ไม่งั้นคืนไม่ได้
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
      -- เครื่องที่ถูกโอนมาให้เราคนเดียว
      or loan_user = auth.uid()
    )
  )
);


-- ---------------------------------------------------------------------
-- รายชื่อคนที่รับโอนได้
--
-- ต่างจาก proxy_targets ตรงที่กรองคนที่เบิก Asset ไม่ได้ออก
-- โอนไปให้คนที่กดเบิกไม่ได้ = เครื่องค้างเติ่งไม่มีใครรับ
-- ---------------------------------------------------------------------
create or replace function transfer_targets(p_q text default null)
returns table (
  id            uuid,
  employee_code text,
  full_name     text,
  dept_code     text,
  sub_dept      text
)
language sql stable security definer set search_path = public as $$
  select p.id, p.employee_code, p.full_name, p.dept_code, p.sub_dept
  from profiles p
  where my_can_proxy()
    and p.is_active
    and (p.role in ('supervisor', 'admin') or p.can_assets)
    and (
      p_q is null or p_q = ''
      or p.full_name     ilike '%' || p_q || '%'
      or p.employee_code ilike '%' || p_q || '%'
      or coalesce(p.dept_code, '') ilike '%' || p_q || '%'
    )
  order by p.full_name
  limit 200;
$$;

grant execute on function transfer_targets(text) to authenticated;


-- ---------------------------------------------------------------------
-- RPC: โอนเครื่องให้คน
--
-- ทิ้งตัวเก่าที่รับแผนกก่อน ไม่งั้นจะมีสองตัวชื่อเดียวกัน
-- แล้ว PostgREST จะเลือกไม่ถูกว่าจะเรียกตัวไหน
-- ---------------------------------------------------------------------
drop function if exists asset_transfer_many(text[], text, text);
drop function if exists asset_transfer(text, text, text);

create or replace function asset_transfer(
  p_code    text,
  p_to_user uuid,
  p_reason  text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me    uuid := auth.uid();
  v_to    profiles%rowtype;
  v_asset assets%rowtype;
  v_out   bigint;
  v_from  uuid;
  v_fdept text;
  v_txn   uuid;
  v_ref   text;
  v_id    bigint;
begin
  if not my_can_proxy() then
    raise exception 'บัญชีนี้โอนเครื่องไม่ได้';
  end if;

  select * into v_to from profiles where id = p_to_user;
  if v_to.id is null or not v_to.is_active then
    raise exception 'ไม่พบผู้รับโอน หรือบัญชีถูกระงับ';
  end if;
  if v_to.role = 'staff' and not v_to.can_assets then
    raise exception '% เบิก Asset ไม่ได้ โอนไปแล้วจะไม่มีใครรับ', v_to.full_name;
  end if;

  select * into v_asset from assets where code = p_code for update;
  if v_asset.code is null then
    raise exception 'ไม่พบเครื่อง %', p_code;
  end if;

  -- ── ตัดรายการค้างของคนเดิม เฉพาะเครื่องนี้เครื่องเดียว ──
  v_out := v_asset.held_item_id;
  if v_out is not null then
    select t.user_id, t.dept_code into v_from, v_fdept
      from asset_txn_items ai join asset_txns t on t.id = ai.txn_id
     where ai.id = v_out;

    if v_from = p_to_user then
      raise exception 'เครื่อง % อยู่กับ %s อยู่แล้ว', p_code, v_to.full_name;
    end if;

    v_ref := next_asset_ref('in');
    insert into asset_txns (ref_no, kind, type_code, user_id, acted_by, dept_code, is_transfer, note)
    values (v_ref, 'in', v_asset.type_code, v_from, v_me, v_fdept, true,
            'โอนให้ ' || v_to.full_name || coalesce(' · ' || p_reason, ''))
    returning id into v_txn;

    insert into asset_txn_items (txn_id, asset_code, out_item_id)
    values (v_txn, p_code, v_out);

    update assets set held_item_id = null where code = p_code;
  elsif v_asset.loan_user = p_to_user then
    raise exception 'เครื่อง % ถูกโอนให้ % อยู่แล้ว', p_code, v_to.full_name;
  end if;

  -- loan_dept เลิกใช้แล้ว ล้างทิ้งเผื่อแถวเก่ายังค้างค่าไว้
  update assets set loan_user = p_to_user, loan_dept = null where code = p_code;

  insert into asset_transfers (asset_code, out_item_id, from_user_id, from_dept,
                               to_user_id, by_user_id, reason)
  values (p_code, v_out, v_from, coalesce(v_fdept, v_asset.dept_code),
          p_to_user, v_me, p_reason)
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'asset_code', p_code,
    'to_user', p_to_user,
    'to_name', v_to.full_name,
    'cut_from', v_from
  );
end $$;

grant execute on function asset_transfer(text, uuid, text) to authenticated;


create or replace function asset_transfer_many(
  p_codes   text[],
  p_to_user uuid,
  p_reason  text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_code    text;
  v_done    text[] := '{}';
  v_skipped text[] := '{}';
  v_name    text;
  v_holder  uuid;
begin
  if not my_can_proxy() then
    raise exception 'บัญชีนี้โอนเครื่องไม่ได้';
  end if;

  if p_codes is null or array_length(p_codes, 1) is null then
    raise exception 'ยังไม่ได้เลือกเครื่องที่จะโอน';
  end if;

  select full_name into v_name from profiles where id = p_to_user;

  foreach v_code in array p_codes loop
    -- เครื่องที่อยู่กับคนนั้นอยู่แล้วให้ข้าม ไม่ใช่ล้มทั้งชุด
    select t.user_id into v_holder
      from assets a
      join asset_txn_items ai on ai.id = a.held_item_id
      join asset_txns t on t.id = ai.txn_id
     where a.code = v_code;

    if v_holder = p_to_user
       or exists (select 1 from assets a
                   where a.code = v_code
                     and a.held_item_id is null
                     and a.loan_user = p_to_user) then
      v_skipped := v_skipped || v_code;
    else
      perform asset_transfer(v_code, p_to_user, p_reason);
      v_done := v_done || v_code;
    end if;

    v_holder := null;
  end loop;

  if array_length(v_done, 1) is null then
    raise exception 'ทุกเครื่องที่เลือกอยู่กับ % อยู่แล้ว', coalesce(v_name, 'คนนี้');
  end if;

  return jsonb_build_object(
    'to_user', p_to_user,
    'to_name', v_name,
    'moved', to_jsonb(v_done),
    'skipped', to_jsonb(v_skipped),
    'count', array_length(v_done, 1)
  );
end $$;

grant execute on function asset_transfer_many(text[], uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- ยกเลิกการโอนที่ปลายทางยังไม่ได้รับ
-- ---------------------------------------------------------------------
create or replace function asset_transfer_cancel(p_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
begin
  if not my_can_proxy() then
    raise exception 'บัญชีนี้ยกเลิกการโอนไม่ได้';
  end if;

  select asset_code into v_code
    from asset_transfers where id = p_id and claimed_at is null;
  if v_code is null then
    raise exception 'ไม่พบรายการโอนที่ยังไม่ถูกรับ';
  end if;

  update assets set loan_user = null, loan_dept = null where code = v_code;
  delete from asset_transfers where id = p_id;
end $$;

grant execute on function asset_transfer_cancel(bigint) to authenticated;


-- ---------------------------------------------------------------------
-- แถบเตือนการโอน — ฝั่งรับเหลือคนเดียว ไม่ใช่ทั้งแผนก
-- ---------------------------------------------------------------------
drop view if exists asset_transfer_notices;
create view asset_transfer_notices
with (security_invoker = true) as
select
  tr.id,
  'in'::text            as side,
  tr.asset_code,
  ty.name               as type_name,
  tp.full_name          as to_name,
  tr.from_dept,
  fp.full_name          as from_name,
  bp.full_name          as by_name,
  tr.reason,
  tr.created_at
from asset_transfers tr
join assets a       on a.code = tr.asset_code
join asset_types ty on ty.code = a.type_code
left join profiles fp on fp.id = tr.from_user_id
left join profiles tp on tp.id = tr.to_user_id
join profiles bp      on bp.id = tr.by_user_id
where tr.claimed_at is null
  and tr.to_user_id = auth.uid()

union all

select
  tr.id,
  'out'::text,
  tr.asset_code,
  ty.name,
  tp.full_name,
  tr.from_dept,
  fp.full_name,
  bp.full_name,
  tr.reason,
  tr.created_at
from asset_transfers tr
join assets a       on a.code = tr.asset_code
join asset_types ty on ty.code = a.type_code
left join profiles fp on fp.id = tr.from_user_id
left join profiles tp on tp.id = tr.to_user_id
join profiles bp      on bp.id = tr.by_user_id
where tr.ack_at is null
  and tr.from_user_id = auth.uid();

grant select on asset_transfer_notices to authenticated;


-- ---------------------------------------------------------------------
-- ของค้างคืน — โชว์ชื่อคนที่ถูกโอนให้ แทนรหัสแผนก
-- ---------------------------------------------------------------------
drop view if exists asset_holdings;
create view asset_holdings
with (security_invoker = true) as
select
  ai.id                as out_item_id,
  a.code               as asset_code,
  a.type_code,
  ty.name              as type_name,
  a.dept_code          as asset_dept,
  a.share_depts        as asset_share_depts,
  a.loan_user          as asset_loan_user,
  lp.full_name         as asset_loan_name,
  t.id                 as txn_id,
  t.ref_no,
  t.user_id,
  p.full_name          as holder_name,
  p.employee_code      as holder_code,
  t.dept_code          as holder_dept,
  p.sub_dept           as holder_sub_dept,
  t.acted_by,
  ap.full_name         as acted_by_name,
  t.shift_start,
  t.shift_end,
  t.due_at,
  t.created_at         as taken_at
from assets a
join asset_txn_items ai on ai.id = a.held_item_id
join asset_txns t       on t.id = ai.txn_id
join asset_types ty     on ty.code = a.type_code
join profiles p         on p.id = t.user_id
left join profiles ap   on ap.id = t.acted_by
left join profiles lp   on lp.id = a.loan_user;

grant select on asset_holdings to authenticated;


-- ---------------------------------------------------------------------
-- คืนเครื่อง — ล้าง loan_user ด้วย เครื่องกลับบ้านตัวเอง
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

  return jsonb_build_object(
    'id', v_first,
    'ref_no', array_to_string(v_refs, ' · '),
    'refs', to_jsonb(v_refs),
    'count', v_n
  );
end $$;

grant execute on function asset_return(text[], jsonb, jsonb, text) to authenticated;


-- ---------------------------------------------------------------------
-- ปิดรายการค้างโดยแอดมิน — ล้าง loan_user ด้วยเหตุผลเดียวกัน
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

  update assets set held_item_id = null, loan_user = null, loan_dept = null
   where code = v_code;

  return jsonb_build_object('ref_no', v_ref, 'asset_code', v_code);
end $$;

grant execute on function admin_release_asset(bigint, text) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select 'ฟังก์ชันโอนให้คน'   as สิ่งที่ตรวจ,
       count(*)::text        as ผล
  from pg_proc where proname = 'asset_transfer'
union all select 'ฟังก์ชันโอนหลายเครื่อง', count(*)::text
  from pg_proc where proname = 'asset_transfer_many'
union all select 'รายชื่อผู้รับโอน', count(*)::text
  from pg_proc where proname = 'transfer_targets'
union all select 'คอลัมน์ loan_user', count(*)::text
  from information_schema.columns where table_name = 'assets' and column_name = 'loan_user'
union all select 'คนที่รับโอนได้ตอนนี้', count(*)::text from transfer_targets();
