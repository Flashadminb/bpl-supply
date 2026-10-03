-- =====================================================================
-- BPL SUPPLY — แก้ปุ่ม "ไม่ส่งลงชีต" ที่ทำให้การส่งออกล้มทั้งงาน
-- รันต่อจาก 094 · ปลอดภัยที่จะรันซ้ำ
--
-- 094 ผมทำเครื่องหมายว่าข้ามด้วยการยัดแถวลง sheet_exports เป็น tab='ข้าม' row_no=0
-- ซึ่งผิด เพราะ sheet_exports ไม่ได้แปลว่า "สถานะ" แต่แปลว่า
-- "บรรทัดนี้นั่งอยู่ที่แท็บไหน แถวที่เท่าไหร่ของชีตแล้ว"
-- ตัวส่งออกจึงหยิบไปสั่ง Google Sheets ให้เขียนทับช่วง ข้าม!A0:L0
-- ซึ่งไม่มีอยู่จริงและเลขแถวศูนย์ก็ไม่มีในชีต งานส่งออกเลยล้มทั้งก้อน
--   Invalid data[2017]: Unable to parse range: ข้าม!A0:L0
--
-- ที่ถูกคือเก็บ "ไม่ต้องส่ง" ไว้คนละตารางกับ "ส่งไปแล้วอยู่ตรงไหน"
-- สองอย่างนี้เป็นคนละเรื่องกัน และการเอามาปนกันคือต้นเหตุทั้งหมด
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. เก็บกวาดแถวที่ 094 ใส่ผิดไว้ — ต้องทำก่อน ไม่งั้นส่งออกยังล้มเหมือนเดิม
-- ---------------------------------------------------------------------
create table if not exists export_skips (
  kind    text   not null check (kind in ('supply', 'asset')),
  line_id bigint not null,
  by_user uuid references profiles(id),
  at      timestamptz not null default now(),
  primary key (kind, line_id)
);

-- ย้ายของที่เคยทำเครื่องหมายไว้มาที่ใหม่ก่อน จะได้ไม่เสียเจตนาที่เขากดไว้
insert into export_skips (kind, line_id)
select 'supply', requisition_item_id from sheet_exports where tab = 'ข้าม'
on conflict do nothing;

insert into export_skips (kind, line_id)
select 'asset', asset_txn_item_id from asset_sheet_exports where tab = 'ข้าม'
on conflict do nothing;

delete from sheet_exports       where tab = 'ข้าม';
delete from asset_sheet_exports where tab = 'ข้าม';

alter table export_skips enable row level security;

-- อ่านได้เฉพาะผู้ตรวจสอบและแอดมิน · เขียนผ่าน RPC เท่านั้น ไม่มี policy เขียน
drop policy if exists read_export_skips on export_skips;
create policy read_export_skips on export_skips for select to authenticated
  using (my_can_audit());

grant select on export_skips to authenticated;


-- ---------------------------------------------------------------------
-- 2. ปุ่มไม่ส่ง / เอากลับเข้าคิว — เขียนลงตารางใหม่แทน
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
  if p_kind not in ('supply', 'asset') then
    raise exception 'ชนิดไม่ถูกต้อง';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  if p_skip then
    -- บรรทัดที่ลงชีตไปแล้วกดข้ามไม่ได้ ของอยู่ในชีตแล้วจริง ๆ การทำเครื่องหมายทีหลัง
    -- ไม่ได้ลบมันออกจากชีต แค่ทำให้หน้าจอโกหกว่าไม่ได้ส่ง
    if exists (
      select 1 from sheet_exports where p_kind = 'supply' and requisition_item_id = any(p_ids)
      union all
      select 1 from asset_sheet_exports where p_kind = 'asset' and asset_txn_item_id = any(p_ids)
    ) then
      raise exception 'มีบรรทัดที่ลงชีตไปแล้วปนอยู่ ลบในชีตเองก่อน แล้วค่อยกดข้าม';
    end if;

    insert into export_skips (kind, line_id, by_user)
    select p_kind, unnest(p_ids), auth.uid()
    on conflict (kind, line_id) do nothing;
  else
    delete from export_skips where kind = p_kind and line_id = any(p_ids);
  end if;

  get diagnostics v_n = row_count;
  return v_n;
end $$;

grant execute on function export_line_skip(text, bigint[], boolean) to authenticated;


-- ---------------------------------------------------------------------
-- 3. หน้าจอยังอ่านว่า tab='ข้าม' เหมือนเดิม แต่คราวนี้เป็นค่าที่คำนวณในวิว
--    ไม่ใช่ค่าที่เก็บจริง ตัวส่งออกจึงไม่มีทางหยิบไปใช้เป็นที่อยู่ในชีตได้อีก
--
--    ผลพลอยได้ที่สำคัญ — ตัวกรอง "ยังไม่ส่ง" ใช้ tab is null
--    บรรทัดที่กดข้ามจึงหลุดจากคิวรอส่งเองโดยไม่ต้องแก้ตัวนับที่ไหนเลย
-- ---------------------------------------------------------------------
drop view if exists sheet_export_rows;
create view sheet_export_rows
with (security_invoker = true) as
select
  ri.id                                         as line_id,
  r.id                                          as requisition_id,
  r.ref_no,
  r.created_at,
  r.hub_code,
  r.evidence_file_id,
  r.evidence_web_link,
  p.full_name                                   as requester_name,
  p.employee_code                               as requester_code,
  p.dept_code                                   as requester_dept,
  p.sub_dept                                    as requester_sub_dept,
  p.shift_start,
  p.shift_end,
  i.sku,
  i.name                                        as item_name,
  i.unit,
  coalesce(ri.qty_approved, ri.qty_requested)   as qty,
  coalesce(se.tab, case when sk.line_id is not null then 'ข้าม' end) as tab,
  se.row_no,
  se.exported_at,
  (se.requisition_item_id is not null)          as is_exported,
  (sk.line_id is not null)                      as is_skipped
from requisition_items ri
join requisitions r on r.id = ri.requisition_id
join items i        on i.id = ri.item_id
join profiles p     on p.id = r.requester_id
left join sheet_exports se on se.requisition_item_id = ri.id
left join export_skips sk  on sk.kind = 'supply' and sk.line_id = ri.id
where ri.status <> 'rejected';

grant select on sheet_export_rows to authenticated;


drop view if exists asset_export_rows;
create view asset_export_rows
with (security_invoker = true) as
select
  ai.id                                   as line_id,
  t.ref_no,
  t.kind,
  t.created_at,
  ty.name                                 as type_name,
  ai.asset_code,
  p.full_name                             as who,
  p.employee_code,
  t.dept_code,
  coalesce(se.tab, case when sk.line_id is not null then 'ข้าม' end) as tab,
  se.row_no,
  (se.asset_txn_item_id is not null)      as is_exported,
  (sk.line_id is not null)                as is_skipped
from asset_txn_items ai
join asset_txns t   on t.id = ai.txn_id
join assets a       on a.code = ai.asset_code
join asset_types ty on ty.code = a.type_code
join profiles p     on p.id = t.user_id
left join asset_sheet_exports se on se.asset_txn_item_id = ai.id
left join export_skips sk        on sk.kind = 'asset' and sk.line_id = ai.id;

grant select on asset_export_rows to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
--
-- "แถวพิษที่เหลือ" ต้องเป็นศูนย์ ถ้าไม่ใช่ แปลว่าส่งออกจะล้มเหมือนเดิม
-- ---------------------------------------------------------------------
select
  (select count(*) from sheet_exports where tab = 'ข้าม')
    + (select count(*) from asset_sheet_exports where tab = 'ข้าม')   as แถวพิษที่เหลือ,
  (select count(*) from export_skips where kind = 'supply')           as วัสดุที่สั่งไม่ส่ง,
  (select count(*) from export_skips where kind = 'asset')            as assetที่สั่งไม่ส่ง,
  (select count(*) from sheet_export_rows where tab is null)          as วัสดุที่ยังรอส่ง;
