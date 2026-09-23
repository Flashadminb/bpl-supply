-- =====================================================================
-- BPL SUPPLY — ย้ายเครื่องข้ามแผนก และให้หลายแผนกใช้ร่วมกันได้
-- รันต่อจาก 017 · ปลอดภัยที่จะรันซ้ำ
--
-- โครงเดียวกับที่ใช้กับคน: มีแผนกหลักหนึ่งแผนก บวกแผนกอื่นที่เพิ่มให้ได้
--   dept_code    แผนกเจ้าของเครื่อง — ใช้จัดกลุ่มบนหน้าจอด้วย
--   share_depts  แผนกอื่นที่ใช้เครื่องนี้ได้ ติ๊กกี่แผนกก็ได้
-- =====================================================================

alter table assets add column if not exists share_depts text[] not null default '{}';

comment on column assets.share_depts is
  'แผนกอื่นที่ใช้เครื่องนี้ได้ นอกเหนือจาก dept_code ที่เป็นแผนกเจ้าของ';

create index if not exists assets_share_idx on assets using gin (share_depts);

-- ---------------------------------------------------------------------
-- ใครเห็นเครื่องไหน
--
-- เพิ่มกฎสำคัญหนึ่งข้อ: คนที่ถือเครื่องอยู่ต้องเห็นเครื่องนั้นเสมอ
-- ไม่งั้นย้ายเครื่องข้ามแผนกตอนที่ยังไม่ได้คืน เจ้าตัวจะมองไม่เห็นจนคืนไม่ได้
-- ---------------------------------------------------------------------
drop policy if exists read_assets on assets;
create policy read_assets on assets for select to authenticated using (
  my_role() in ('supervisor', 'admin')
  or dept_code is null
  or dept_code = 'ALL'
  or 'ALL' = any(my_depts())
  or dept_code = any(my_depts())
  or share_depts && my_depts()
  or exists (
    select 1
    from asset_txn_items ai
    join asset_txns t on t.id = ai.txn_id
    where ai.id = assets.held_item_id and t.user_id = auth.uid()
  )
);

-- ---------------------------------------------------------------------
-- RPC: ย้ายเครื่อง / ตั้งแผนกที่ใช้ร่วมได้
-- ---------------------------------------------------------------------
create or replace function set_asset_depts(
  p_code   text,
  p_dept   text,
  p_shares text[] default '{}'
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_bad text;
begin
  -- เฉพาะเจ้าของระบบ · แอดมินย้ายแผนกเครื่องไม่ได้
  if my_role() <> 'admin' then
    raise exception 'เฉพาะเจ้าของระบบเท่านั้นที่ย้ายแผนกของเครื่องได้';
  end if;

  if not exists (select 1 from assets where code = p_code) then
    raise exception 'ไม่พบเครื่อง %', p_code;
  end if;

  if p_dept is not null and not exists (select 1 from departments where code = p_dept) then
    raise exception 'ไม่รู้จักแผนก %', p_dept;
  end if;

  select s into v_bad
    from unnest(coalesce(p_shares, '{}')) s
   where not exists (select 1 from departments d where d.code = s)
   limit 1;
  if v_bad is not null then
    raise exception 'ไม่รู้จักแผนก %', v_bad;
  end if;

  update assets
     set dept_code   = p_dept,
         -- แผนกเจ้าของไม่ต้องมาซ้ำในรายการใช้ร่วม
         share_depts = coalesce(
           (select array_agg(distinct s)
              from unnest(coalesce(p_shares, '{}')) s
             where s is distinct from p_dept),
           '{}'
         )
   where code = p_code;
end $$;

grant execute on function set_asset_depts(text, text, text[]) to authenticated;

-- ---------------------------------------------------------------------
-- view ของค้างคืนฝั่ง Asset ต้องพ่วงแผนกย่อยของคนถือมาด้วย
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
  t.id                 as txn_id,
  t.ref_no,
  t.user_id,
  p.full_name          as holder_name,
  p.employee_code      as holder_code,
  t.dept_code          as holder_dept,
  p.sub_dept           as holder_sub_dept,
  t.shift_start,
  t.shift_end,
  t.due_at,
  t.created_at         as taken_at
from assets a
join asset_txn_items ai on ai.id = a.held_item_id
join asset_txns t       on t.id = ai.txn_id
join asset_types ty     on ty.code = a.type_code
join profiles p         on p.id = t.user_id;

grant select on asset_holdings to authenticated;
