-- =====================================================================
-- BPL SUPPLY — หน่วยของจำนวนที่ส่งจริง
-- รันต่อจาก 074 · ปลอดภัยที่จะรันซ้ำ
--
-- สาขาขอมาเป็นชิ้น แต่หน้างานนับตอนขึ้นรถเป็นกระสอบ
-- ของเดิมหน่วยถูกล็อกไว้ตั้งแต่ตอนตั้งรายการ คนกดส่งเปลี่ยนไม่ได้
-- ต้องไปแปลงหัวคิดเอาเอง ซึ่งแปลว่ามีวันที่แปลงผิด
--
-- ว่างแปลว่าหน่วยเดียวกับที่ขอ เหมือน sent_qty
-- =====================================================================

alter table sack_orders add column if not exists sent_unit text;

alter table sack_orders drop constraint if exists sack_orders_sent_unit_chk;
alter table sack_orders add constraint sack_orders_sent_unit_chk
  check (sent_unit is null or sent_unit in ('ชิ้น', 'กระสอบ'));


-- ---------------------------------------------------------------------
-- กดส่ง — รับหน่วยเพิ่มมาอีกช่อง
--
-- ของเดิมมีห้าช่อง ต้อง drop ก่อนเพราะเปลี่ยนลายเซ็น
-- ช่องใหม่มีค่าเริ่มต้น แอปรุ่นเก่าที่เรียกแบบสี่หรือห้าช่องจึงยังทำงานได้
-- ---------------------------------------------------------------------
drop function if exists mark_sack_sent(uuid, text, text, jsonb, integer);

create or replace function mark_sack_sent(
  p_id        uuid,
  p_mode      text,
  p_relay     text default null,
  p_photos    jsonb default '[]'::jsonb,
  p_sent_qty  integer default null,
  p_sent_unit text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row  sack_orders%rowtype;
  v_sent integer;
  v_unit text;
begin
  if p_mode not in ('direct', 'relay') then
    raise exception 'ต้องเลือกว่าส่งตรงหรือฝากส่ง';
  end if;
  if p_mode = 'relay' and coalesce(btrim(p_relay), '') = '' then
    raise exception 'ฝากส่งต้องใส่ชื่อสาขาที่ฝากด้วย';
  end if;
  if p_sent_unit is not null and p_sent_unit not in ('ชิ้น', 'กระสอบ') then
    raise exception 'หน่วยต้องเป็นชิ้นหรือกระสอบเท่านั้น';
  end if;

  select * into v_row from sack_orders where id = p_id for update;
  if not found then
    raise exception 'ไม่พบรายการนี้';
  end if;

  -- กดซ้ำไม่ถือว่าผิด ผลลัพธ์ที่คนกดต้องการคือ "ส่งแล้ว" ซึ่งเป็นจริงอยู่
  if v_row.status <> 'pending' then
    return jsonb_build_object('ref_no', v_row.ref_no, 'duplicate', true,
                              'status', v_row.status, 'relay_via', v_row.relay_via,
                              'sent_qty', coalesce(v_row.sent_qty, v_row.qty),
                              'sent_unit', coalesce(v_row.sent_unit, v_row.unit),
                              'qty', v_row.qty, 'unit', v_row.unit);
  end if;

  -- ไม่กรอกมา = ส่งเต็มจำนวนหน่วยเดิม ซึ่งเป็นเคสปกติที่สุด
  v_sent := coalesce(p_sent_qty, v_row.qty);
  v_unit := coalesce(p_sent_unit, v_row.unit);

  if v_sent <= 0 then
    raise exception 'จำนวนที่ส่งต้องมากกว่าศูนย์';
  end if;

  -- กันพิมพ์ตกหลัก เทียบได้เฉพาะตอนหน่วยเดียวกัน
  -- ขอมา 10 กระสอบ แล้วส่ง 500 ชิ้น เป็นเรื่องปกติ ไม่ใช่พิมพ์ผิด
  if v_unit = v_row.unit and v_sent > v_row.qty * 10 then
    raise exception 'จำนวนที่ส่ง % มากกว่าที่ขอ % หลายเท่า กรอกผิดหรือเปล่า', v_sent, v_row.qty;
  end if;

  update sack_orders
     set status    = p_mode,
         relay_via = case when p_mode = 'relay' then btrim(p_relay) else null end,
         sent_qty  = v_sent,
         sent_unit = v_unit,
         sent_by   = auth.uid(),
         sent_at   = now()
   where id = p_id;

  insert into sack_order_photos (order_id, seq, file_id, web_link, bytes)
  select p_id, (row_number() over ())::int,
         ph->>'file_id', ph->>'web_link', nullif(ph->>'bytes', '')::int
    from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) ph
   where coalesce(ph->>'file_id', '') <> '';

  return jsonb_build_object('ref_no', v_row.ref_no, 'duplicate', false,
                            'status', p_mode, 'relay_via', nullif(btrim(p_relay), ''),
                            'sent_qty', v_sent, 'sent_unit', v_unit,
                            'qty', v_row.qty, 'unit', v_row.unit);
end $$;

grant execute on function mark_sack_sent(uuid, text, text, jsonb, integer, text) to authenticated;


-- ---------------------------------------------------------------------
-- วิวหลัก — เพิ่มหน่วยที่ส่งจริง
--
-- qty_differs เทียบได้เฉพาะตอนหน่วยเดียวกัน
-- ขอ 700 ชิ้น ส่ง 20 กระสอบ ไม่ได้แปลว่าส่งขาด 680 แต่แปลว่าคนละหน่วย
-- ---------------------------------------------------------------------
drop view if exists sack_rows cascade;
create view sack_rows
with (security_invoker = true) as
select
  o.id, o.ref_no, o.hub_code, o.qty, o.unit, o.branch, o.note,
  o.status, o.relay_via, o.created_at, o.sent_at,
  o.updated_at,
  o.sent_qty,
  o.sent_unit,
  coalesce(o.sent_qty, o.qty)   as qty_out,
  coalesce(o.sent_unit, o.unit) as unit_out,
  (o.sent_unit is not null and o.sent_unit <> o.unit) as unit_differs,
  (o.sent_qty is not null
     and coalesce(o.sent_unit, o.unit) = o.unit
     and o.sent_qty <> o.qty) as qty_differs,
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


-- cascade เมื่อกี้ลบวิวที่พึ่งพา sack_rows ไปด้วย ต้องสร้างคืน
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
  (e.tab is null or e.exported_at < coalesce(o.sent_at, o.created_at)) as needs_push
from sack_orders o
left join sack_sheet_exports e on e.sack_id = o.id;

grant select on sack_export_rows to authenticated;
grant select on sack_export_rows to service_role;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'sack_orders' and column_name = 'sent_unit')   as มีช่องหน่วยที่ส่ง,
  (select count(*) from pg_proc
    where proname = 'mark_sack_sent' and pronargs = 6)                as ฟังก์ชันรับหกช่อง,
  (select count(*) from information_schema.columns
    where table_name = 'sack_rows' and column_name = 'unit_out')      as วิวมีหน่วยที่ส่ง,
  (select count(*) from sack_rows where unit_differs)                 as ที่ส่งคนละหน่วย;
