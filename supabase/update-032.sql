-- =====================================================================
-- BPL SUPPLY — เบิกแทน คืนแทน และการโอนเครื่องข้ามแผนก
-- รันต่อจาก 031 · ปลอดภัยที่จะรันซ้ำ
--
-- สามเรื่องที่แก้ปัญหาเดียวกัน: เครื่องอยู่ผิดที่แล้วระบบไม่มีทางย้ายให้ถูก
--
--  ① เบิกแทน   แอดมินกดเบิกให้คนอื่น ของไปค้างชื่อคนนั้น ไม่ใช่ชื่อคนกด
--  ② ตำแหน่งใหม่ "ผู้ตรวจสอบ" เห็นทุกแผนกเพื่อจ่ายของ แต่ไม่มีสิทธิ์แอดมินใด ๆ
--  ③ โอนเครื่อง แผนกที่ถืออยู่ถูกตัดสิทธิ์ แผนกใหม่ได้สิทธิ์เบิกแทน
--
-- หมายเหตุเรื่องตำแหน่งใหม่
--   ไม่ได้เพิ่มค่าลงใน enum user_role แต่ใช้คอลัมน์ boolean แยกต่างหาก
--   เพราะ Postgres ห้ามใช้ค่า enum ที่เพิ่งเพิ่มภายในทรานแซกชันเดียวกัน
--   ซึ่งหน้า SQL Editor ของ Supabase รันทั้งไฟล์เป็นทรานแซกชันเดียว
--   ไฟล์นี้จะพังกลางทางแบบงง ๆ วิธีนี้เลี่ยงกับดักนั้นทั้งหมด
--   และเข้าชุดกับ can_assets ที่ทำไว้แล้วใน 021
-- =====================================================================


-- ---------------------------------------------------------------------
-- ① ตำแหน่ง "ผู้ตรวจสอบ"
--
-- เห็นเครื่องทุกแผนกเหมือนแอดมิน เพื่อจะได้รู้ว่าของว่างอยู่ที่ไหน
-- เบิกแทนคนอื่นได้ และโอนเครื่องข้ามแผนกได้
-- แต่ทำอย่างอื่นแบบแอดมินไม่ได้เลย — ไม่อนุมัติ ไม่แก้สต็อก ไม่เห็นหน้าแอดมิน
-- และคืนแทนคนอื่นไม่ได้ เพราะคนคืนต้องเป็นคนที่ถือของจริงถึงจะถ่ายรูปสภาพได้
-- ---------------------------------------------------------------------
alter table profiles add column if not exists can_dispatch boolean not null default false;

comment on column profiles.can_dispatch is
  'ผู้ตรวจสอบ — เห็นเครื่องทุกแผนก เบิกแทนและโอนเครื่องได้ แต่ไม่มีสิทธิ์แอดมิน';

create or replace function my_can_dispatch() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select can_dispatch from profiles where id = auth.uid()), false);
$$;

grant execute on function my_can_dispatch() to authenticated;

/** จ่ายของแทนคนอื่นได้ไหม — แอดมิน เจ้าของระบบ หรือผู้ตรวจสอบ */
create or replace function my_can_proxy() returns boolean
language sql stable security definer set search_path = public as $$
  select my_role() in ('supervisor', 'admin') or my_can_dispatch();
$$;

grant execute on function my_can_proxy() to authenticated;


-- ---------------------------------------------------------------------
-- ② เบิกแทน
--
-- user_id ยังเป็น "คนที่ของไปอยู่ด้วย" เหมือนเดิมทุกประการ
-- ของจึงไปค้างชื่อเจ้าตัว กะและกำหนดคืนคิดจากกะของเจ้าตัว
-- และการแจ้งเตือนที่เขียนไว้แล้วทั้งหมดยิงหาเจ้าตัวโดยไม่ต้องแก้อะไรเลย
--
-- acted_by คือคนที่กดให้ ว่างแปลว่าเบิกเอง
-- ---------------------------------------------------------------------
alter table asset_txns add column if not exists acted_by uuid references profiles(id);

comment on column asset_txns.acted_by is
  'คนที่กดเบิก/คืนให้ ถ้าไม่ใช่เจ้าตัว · ว่าง = ทำเอง';

create index if not exists asset_txns_acted_idx
  on asset_txns (acted_by, created_at desc) where acted_by is not null;

-- แถวที่เกิดจากการโอน ไม่ใช่การคืนจริง จะได้ไม่ปนในสถิติและไม่ต้องบังคับรูป
alter table asset_txns add column if not exists is_transfer boolean not null default false;


-- ---------------------------------------------------------------------
-- ③ โอนเครื่องข้ามแผนก
--
-- การโอนไม่ได้ยัดเครื่องใส่มือใคร แต่เปิดสิทธิ์ให้แผนกปลายทาง "ไปกดเบิกเอง"
-- ตามขั้นตอนปกติ เพื่อให้ยังมีรูปสภาพตอนรับของครบเหมือนการเบิกทุกครั้ง
--
-- ถ้าตอนโอนมีคนถืออยู่ ระบบปิดรายการค้างของคนนั้นให้เลย
-- เจ้าตัวจะไม่ต้องตามคืนเครื่องที่ไม่ได้อยู่กับตัวแล้ว
-- และปิดเฉพาะเครื่องที่ถูกโอน เครื่องอื่นในใบเดียวกันยังค้างตามเดิม
-- ---------------------------------------------------------------------
create table if not exists asset_transfers (
  id           bigserial primary key,
  asset_code   text not null references assets(code),
  -- แถวตอนเบิกของคนเดิมที่ถูกตัดออก · ว่าง = ตอนโอนเครื่องว่างอยู่
  out_item_id  bigint references asset_txn_items(id),
  from_user_id uuid references profiles(id),
  from_dept    text,
  to_dept      text not null references departments(code),
  by_user_id   uuid not null references profiles(id),
  reason       text,
  created_at   timestamptz not null default now(),
  -- ปลายทางกดเบิกแล้ว
  claimed_at   timestamptz,
  claimed_by   uuid references profiles(id),
  -- ต้นทางกดรับทราบแล้ว
  ack_at       timestamptz
);

create index if not exists asset_transfers_asset_idx on asset_transfers (asset_code, created_at desc);
create index if not exists asset_transfers_open_idx  on asset_transfers (to_dept) where claimed_at is null;
create index if not exists asset_transfers_from_idx  on asset_transfers (from_user_id) where ack_at is null;

-- แผนกที่ได้รับเครื่องมาใช้ชั่วคราว · ว่าง = ไม่ได้ถูกโอนอยู่
-- ไม่ได้ไปทับ dept_code เพราะเครื่องต้องรู้ทางกลับบ้านของตัวเอง
alter table assets add column if not exists loan_dept text references departments(code);

comment on column assets.loan_dept is
  'แผนกที่ได้รับเครื่องนี้มาใช้ชั่วคราวจากการโอน · เคลียร์เมื่อคืนเข้าระบบตามปกติ';

create index if not exists assets_loan_idx on assets (loan_dept) where loan_dept is not null;


-- ---------------------------------------------------------------------
-- ใครเห็นเครื่องไหน — เพิ่มผู้ตรวจสอบ และแผนกที่รับโอน
-- ---------------------------------------------------------------------
drop policy if exists read_assets on assets;
create policy read_assets on assets for select to authenticated using (
  my_role() in ('supervisor', 'admin')
  -- ผู้ตรวจสอบเห็นทุกเครื่อง เพราะหน้าที่คือรู้ว่าของว่างอยู่ที่ไหน
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
      -- เครื่องที่ถูกโอนมาให้แผนกเรา
      or loan_dept = any(my_depts())
    )
  )
);


-- ---------------------------------------------------------------------
-- View: รายชื่อคนที่เบิกแทนได้
--
-- ต้องเป็น security definer เพราะคนเบิกแทนอาจอ่าน profiles ของแผนกอื่นไม่ได้
-- คืนเฉพาะข้อมูลที่จำเป็นต่อการเลือกคน ไม่มีอะไรที่อ่อนไหว
-- ---------------------------------------------------------------------
create or replace function proxy_targets(p_q text default null)
returns table (
  id            uuid,
  employee_code text,
  full_name     text,
  dept_code     text,
  sub_dept      text,
  shift_start   time,
  shift_end     time
)
language sql stable security definer set search_path = public as $$
  select p.id, p.employee_code, p.full_name, p.dept_code, p.sub_dept,
         p.shift_start, p.shift_end
  from profiles p
  where my_can_proxy()
    and p.is_active
    and (
      p_q is null or p_q = ''
      or p.full_name     ilike '%' || p_q || '%'
      or p.employee_code ilike '%' || p_q || '%'
      or coalesce(p.dept_code, '') ilike '%' || p_q || '%'
    )
  order by p.full_name
  limit 200;
$$;

grant execute on function proxy_targets(text) to authenticated;


-- ---------------------------------------------------------------------
-- View: ของค้างคืน — พ่วงคนที่กดเบิกให้
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
  a.loan_dept          as asset_loan_dept,
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
left join profiles ap   on ap.id = t.acted_by;

grant select on asset_holdings to authenticated;


-- ---------------------------------------------------------------------
-- RPC: เบิก Asset — รับ p_for_user เพิ่มเข้ามา
--
-- ทิ้งตัวเก่าที่รับ 5 อาร์กิวเมนต์ก่อน ไม่งั้นจะมีสองตัวชื่อเดียวกัน
-- แล้ว PostgREST จะเลือกไม่ถูกว่าจะเรียกตัวไหน
-- ---------------------------------------------------------------------
drop function if exists asset_checkout(text, text[], jsonb, jsonb, text);

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

  -- เบิกให้ใคร
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

  -- คนกดต้องมีสิทธิ์แตะเครื่อง ส่วนคนรับไม่ต้อง
  -- เพราะทั้งหมดนี้มีไว้เพื่อคนที่มองไม่เห็นเครื่องด้วยตัวเองอยู่แล้ว
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

  -- กะและกำหนดคืนคิดจากคนที่ของไปอยู่ด้วย ไม่ใช่คนกด
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

    -- ถ้าเครื่องนี้ถูกโอนมาแล้วยังไม่มีใครรับ ถือว่าการรับเสร็จสมบูรณ์ตรงนี้
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
-- RPC: คืน Asset — ผู้ตรวจสอบคืนแทนคนอื่นไม่ได้
--
-- เหตุผล: การคืนต้องมีรูปสภาพจริงของเครื่องตอนนั้น
-- คนที่ไม่ได้ถือของอยู่ถ่ายรูปนั้นไม่ได้ ถ้าเปิดให้กดก็จะได้รูปมั่ว ๆ มาแทน
-- แอดมินยังคืนแทนได้เหมือนเดิม เพราะเป็นคนที่รับของคืนเข้าคลังจริง
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
      if my_role() not in ('supervisor', 'admin') then
        raise exception 'เครื่อง % ไม่ได้เบิกโดยคุณ', v_code;
      end if;
      v_actor := v_me.id;
    end if;

    insert into asset_txn_items (txn_id, asset_code, out_item_id)
    values (v_txn, v_code, v_out);

    -- คืนเข้าระบบแล้ว เครื่องกลับไปอยู่กับแผนกเจ้าของตามเดิม
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


-- ---------------------------------------------------------------------
-- RPC: โอนเครื่องให้แผนกอื่น
-- ---------------------------------------------------------------------
create or replace function asset_transfer(
  p_code    text,
  p_to_dept text,
  p_reason  text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me      uuid := auth.uid();
  v_asset   assets%rowtype;
  v_out     bigint;
  v_from    uuid;
  v_fdept   text;
  v_txn     uuid;
  v_ref     text;
  v_id      bigint;
begin
  if not my_can_proxy() then
    raise exception 'บัญชีนี้โอนเครื่องไม่ได้';
  end if;

  if not exists (select 1 from departments where code = p_to_dept) then
    raise exception 'ไม่รู้จักแผนก %', p_to_dept;
  end if;

  select * into v_asset from assets where code = p_code for update;
  if v_asset.code is null then
    raise exception 'ไม่พบเครื่อง %', p_code;
  end if;
  if coalesce(v_asset.loan_dept, v_asset.dept_code) = p_to_dept then
    raise exception 'เครื่อง % อยู่กับแผนกนี้อยู่แล้ว', p_code;
  end if;

  -- ถ้ามีคนถืออยู่ ปิดรายการค้างของคนนั้นเฉพาะเครื่องนี้เครื่องเดียว
  v_out := v_asset.held_item_id;
  if v_out is not null then
    select t.user_id, t.dept_code into v_from, v_fdept
      from asset_txn_items ai join asset_txns t on t.id = ai.txn_id
     where ai.id = v_out;

    v_ref := next_asset_ref('in');
    insert into asset_txns (ref_no, kind, type_code, user_id, acted_by, dept_code, is_transfer, note)
    values (v_ref, 'in', v_asset.type_code, v_from, v_me, v_fdept, true,
            'โอนให้แผนก ' || p_to_dept || coalesce(' · ' || p_reason, ''))
    returning id into v_txn;

    insert into asset_txn_items (txn_id, asset_code, out_item_id)
    values (v_txn, p_code, v_out);

    update assets set held_item_id = null where code = p_code;
  end if;

  update assets set loan_dept = p_to_dept where code = p_code;

  insert into asset_transfers (asset_code, out_item_id, from_user_id, from_dept,
                               to_dept, by_user_id, reason)
  values (p_code, v_out, v_from, coalesce(v_fdept, v_asset.dept_code),
          p_to_dept, v_me, p_reason)
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'asset_code', p_code,
    'to_dept', p_to_dept,
    'cut_from', v_from
  );
end $$;

grant execute on function asset_transfer(text, text, text) to authenticated;


/** ต้นทางกดรับทราบว่าไม่ต้องตามคืนเครื่องนั้นแล้ว */
create or replace function asset_transfer_ack(p_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update asset_transfers
     set ack_at = now()
   where id = p_id
     and ack_at is null
     and (from_user_id = auth.uid() or my_can_proxy());
end $$;

grant execute on function asset_transfer_ack(bigint) to authenticated;


/** ยกเลิกการโอนที่ปลายทางยังไม่ได้รับ — เครื่องกลับไปอยู่แผนกเดิม */
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

  update assets set loan_dept = null where code = v_code;
  delete from asset_transfers where id = p_id;
end $$;

grant execute on function asset_transfer_cancel(bigint) to authenticated;


-- ---------------------------------------------------------------------
-- View: เรื่องโอนที่ยังค้างอยู่ — ใช้ขึ้นแถบเตือนทั้งสองฝั่ง
--
--   side = 'in'  เครื่องถูกโอนมาให้แผนกเรา รอไปกดเบิก
--   side = 'out' เครื่องของเราถูกโอนออกไป ไม่ต้องตามคืนแล้ว
-- ---------------------------------------------------------------------
drop view if exists asset_transfer_notices;
create view asset_transfer_notices
with (security_invoker = true) as
select
  tr.id,
  'in'::text            as side,
  tr.asset_code,
  ty.name               as type_name,
  tr.to_dept,
  tr.from_dept,
  fp.full_name          as from_name,
  bp.full_name          as by_name,
  tr.reason,
  tr.created_at
from asset_transfers tr
join assets a       on a.code = tr.asset_code
join asset_types ty on ty.code = a.type_code
left join profiles fp on fp.id = tr.from_user_id
join profiles bp      on bp.id = tr.by_user_id
where tr.claimed_at is null
  and (tr.to_dept = any(my_depts()) or 'ALL' = any(my_depts()))

union all

select
  tr.id,
  'out'::text,
  tr.asset_code,
  ty.name,
  tr.to_dept,
  tr.from_dept,
  fp.full_name,
  bp.full_name,
  tr.reason,
  tr.created_at
from asset_transfers tr
join assets a       on a.code = tr.asset_code
join asset_types ty on ty.code = a.type_code
left join profiles fp on fp.id = tr.from_user_id
join profiles bp      on bp.id = tr.by_user_id
where tr.ack_at is null
  and tr.from_user_id = auth.uid();

grant select on asset_transfer_notices to authenticated;


-- ---------------------------------------------------------------------
-- View: ประวัติ — บอกด้วยว่าใครกดให้ และแถวไหนเป็นการโอนไม่ใช่การคืนจริง
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
  backp.full_name                         as returned_by,
  coalesce(back.is_transfer, false)       as closed_by_transfer,
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
left join profiles backp            on backp.id = back.user_id;

grant select on asset_history to authenticated;


-- ---------------------------------------------------------------------
-- RLS ของตารางโอน
-- ---------------------------------------------------------------------
alter table asset_transfers enable row level security;

drop policy if exists read_transfers on asset_transfers;
create policy read_transfers on asset_transfers for select to authenticated using (
  my_role() in ('supervisor', 'admin')
  or my_can_dispatch()
  or from_user_id = auth.uid()
  or claimed_by = auth.uid()
  or to_dept = any(my_depts())
  or 'ALL' = any(my_depts())
);

-- เขียนผ่าน RPC เท่านั้น ไม่เปิด insert/update/delete ตรง ๆ ให้ใคร
