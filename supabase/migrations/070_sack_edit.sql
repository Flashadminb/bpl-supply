-- =====================================================================
-- BPL SUPPLY — แก้ไขรายการกระสอบที่ตั้งผิด
-- รันต่อจาก 069 · ปลอดภัยที่จะรันซ้ำ
--
-- เดิมพิมพ์จำนวนผิดแล้วทำได้อย่างเดียวคือลบทิ้งแล้วตั้งใหม่
-- ซึ่งได้เลขที่ใหม่ ทั้งที่เป็นงานชิ้นเดิม
-- ถ้าหน้างานเห็นใบเก่าไปแล้ว เขาจะงงว่าตกลงต้องส่งใบไหน
-- และถ้าส่งลงชีตไปแล้ว แถวเก่าจะค้างอยู่โดยไม่มีอะไรมาแทน
--
-- แก้ได้ทั้งใบที่ยังไม่ส่งและใบที่ส่งไปแล้ว
--   ที่ต้องยอมให้แก้ใบที่ส่งแล้วด้วย เพราะกรณีที่เจอบ่อยคือ
--   ตั้งไว้ผิด หน้างานส่งของตามจำนวนจริง แล้วค่อยมารู้ทีหลังว่าเลขในระบบผิด
--   ถ้าล็อกไว้ ตัวเลขในระบบจะผิดถาวรโดยไม่มีทางแก้
--
-- ทุกครั้งที่แก้จะบันทึกว่าใครแก้และแก้เมื่อไหร่
-- ตัวเลขที่เปลี่ยนได้เงียบ ๆ โดยไม่รู้ว่าใครเปลี่ยน เชื่อถือไม่ได้พอ ๆ กับไม่มีตัวเลข
-- =====================================================================

alter table sack_orders
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by uuid references profiles (id);

comment on column sack_orders.updated_at is
  'แก้ไขล่าสุดเมื่อไหร่ · ว่าง = ยังไม่เคยถูกแก้';


-- ---------------------------------------------------------------------
-- แก้ไขรายการ — เจ้าของระบบกับแอดมินเท่านั้น เหมือนตอนตั้ง
--
-- ส่ง null มาในช่องไหน แปลว่าไม่แตะช่องนั้น ไม่ใช่ล้างค่าทิ้ง
-- เพราะหน้าจอส่งมาเฉพาะช่องที่แก้จริง จะได้ไม่เผลอลบของที่ไม่ได้ตั้งใจแตะ
-- ยกเว้นหมายเหตุที่ต้องลบได้ จึงใช้สตริงว่างเป็นสัญญาณว่า "เอาออก"
-- ---------------------------------------------------------------------
create or replace function update_sack_order(
  p_id     uuid,
  p_branch text default null,
  p_qty    integer default null,
  p_unit   text default null,
  p_note   text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row sack_orders%rowtype;
begin
  if my_role() not in ('admin', 'supervisor') then
    raise exception 'เฉพาะเจ้าของระบบและแอดมินเท่านั้นที่แก้รายการได้';
  end if;

  select * into v_row from sack_orders where id = p_id for update;
  if not found then
    raise exception 'ไม่พบรายการนี้';
  end if;

  if p_qty is not null and p_qty <= 0 then
    raise exception 'จำนวนต้องมากกว่าศูนย์';
  end if;
  if p_unit is not null and p_unit not in ('ชิ้น', 'กระสอบ') then
    raise exception 'หน่วยต้องเป็นชิ้นหรือกระสอบ';
  end if;
  if p_branch is not null and btrim(p_branch) = '' then
    raise exception 'ต้องใส่ชื่อสาขาที่ขอ';
  end if;

  update sack_orders
     set branch     = coalesce(nullif(btrim(p_branch), ''), branch),
         qty        = coalesce(p_qty, qty),
         unit       = coalesce(p_unit, unit),
         note       = case when p_note is null then note
                           else nullif(btrim(p_note), '') end,
         updated_at = now(),
         updated_by = auth.uid()
   where id = p_id;

  select * into v_row from sack_orders where id = p_id;

  return jsonb_build_object(
    'id', v_row.id, 'ref_no', v_row.ref_no, 'branch', v_row.branch,
    'qty', v_row.qty, 'unit', v_row.unit, 'note', v_row.note,
    'was_sent', v_row.status <> 'pending');
end $$;

grant execute on function update_sack_order(uuid, text, integer, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- วิวหน้าจอ — พ่วงคนที่แก้ล่าสุดมาด้วย
-- ---------------------------------------------------------------------
drop view if exists sack_rows;
create view sack_rows
with (security_invoker = true) as
select
  o.id, o.ref_no, o.hub_code, o.qty, o.unit, o.branch, o.note,
  o.status, o.relay_via, o.created_at, o.sent_at,
  o.updated_at,
  cb.full_name as created_by_name,
  sb.full_name as sent_by_name,
  ub.full_name as updated_by_name,
  coalesce(
    (select jsonb_agg(jsonb_build_object('seq', p.seq, 'file_id', p.file_id, 'web_link', p.web_link)
            order by p.seq)
       from sack_order_photos p where p.order_id = o.id),
    '[]'::jsonb
  ) as photos,
  (select count(*) from sack_order_photos p where p.order_id = o.id)::int as photo_count
from sack_orders o
left join profiles cb on cb.id = o.created_by
left join profiles sb on sb.id = o.sent_by
left join profiles ub on ub.id = o.updated_by;

grant select on sack_rows to authenticated;
grant select on sack_rows to service_role;


-- ---------------------------------------------------------------------
-- ตัวนับ "ยังต้องส่งลงชีต" ต้องนับการแก้ไขด้วย
--
-- เดิมเทียบกับเวลาที่ส่งของเท่านั้น แก้จำนวนแล้วชีตจะไม่รู้เรื่อง
-- แถวในชีตจึงค้างเป็นตัวเลขเก่าตลอดไปโดยไม่มีอะไรบอก
-- ---------------------------------------------------------------------
drop view if exists sack_export_rows;
create view sack_export_rows
with (security_invoker = true) as
select
  o.id,
  o.ref_no,
  o.created_at,
  o.branch,
  o.status,
  e.tab,
  e.row_no,
  e.exported_at,
  (e.tab is not null) as is_exported,
  (e.tab is null
   or e.exported_at < greatest(o.created_at,
                               coalesce(o.sent_at, o.created_at),
                               coalesce(o.updated_at, o.created_at))) as needs_push
from sack_orders o
left join sack_sheet_exports e on e.sack_id = o.id;

grant select on sack_export_rows to authenticated;
grant select on sack_export_rows to service_role;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'sack_orders' and column_name = 'updated_at')  as คอลัมน์เวลาแก้,
  (select count(*) from pg_proc where proname = 'update_sack_order')  as ฟังก์ชันแก้ไข,
  (select count(*) from information_schema.columns
    where table_name = 'sack_rows' and column_name = 'updated_by_name') as วิวพ่วงคนแก้,
  (select count(*) from sack_orders)                                  as รายการทั้งหมด,
  (select count(*) from sack_export_rows where needs_push)            as ที่ยังต้องส่งลงชีต;
