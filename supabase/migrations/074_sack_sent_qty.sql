-- =====================================================================
-- BPL SUPPLY — จำนวนที่ส่งจริงของกระสอบ
-- รันต่อจาก 073 · ปลอดภัยที่จะรันซ้ำ
--
-- สาขาขอมา 500 แต่ของในฮับมีไม่พอ ส่งไปได้จริง 200
-- ของเดิมบันทึกได้แค่ "ส่งแล้ว" ไม่ได้บอกว่าส่งไปเท่าไหร่
-- ส่วนกลางจึงไล่ไม่ได้ว่ายังค้างอยู่เท่าไหร่
--
-- ว่างแปลว่าส่งเต็มจำนวนที่ขอ ไม่ได้แปลว่าไม่รู้
-- แถวเก่าที่ส่งไปก่อนมีช่องนี้จึงยังอ่านถูกโดยไม่ต้องไปไล่เติมย้อนหลัง
-- =====================================================================

alter table sack_orders add column if not exists sent_qty integer;

alter table sack_orders drop constraint if exists sack_orders_sent_qty_chk;
alter table sack_orders add constraint sack_orders_sent_qty_chk
  check (sent_qty is null or sent_qty > 0);


-- ---------------------------------------------------------------------
-- กดส่ง — รับจำนวนที่ส่งจริงเพิ่มมาอีกช่อง
--
-- ของเดิมมีสี่ช่อง ต้อง drop ก่อนเพราะเปลี่ยนลายเซ็น
-- ตัวใหม่ตั้งค่าเริ่มต้นให้ช่องที่ห้า แอปรุ่นเก่าที่ยังเรียกแบบสี่ช่องจึงยังทำงานได้
-- ซึ่งจำเป็น เพราะ service worker ทำให้บางเครื่องยังใช้โค้ดเก่าอีกหลายชั่วโมง
-- ---------------------------------------------------------------------
drop function if exists mark_sack_sent(uuid, text, text, jsonb);

create or replace function mark_sack_sent(
  p_id       uuid,
  p_mode     text,
  p_relay    text default null,
  p_photos   jsonb default '[]'::jsonb,
  p_sent_qty integer default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row  sack_orders%rowtype;
  v_sent integer;
begin
  if p_mode not in ('direct', 'relay') then
    raise exception 'ต้องเลือกว่าส่งตรงหรือฝากส่ง';
  end if;
  if p_mode = 'relay' and coalesce(btrim(p_relay), '') = '' then
    raise exception 'ฝากส่งต้องใส่ชื่อสาขาที่ฝากด้วย';
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
                              'qty', v_row.qty);
  end if;

  -- ไม่กรอกมา = ส่งเต็มจำนวนที่ขอ ซึ่งเป็นเคสปกติที่สุด
  v_sent := coalesce(p_sent_qty, v_row.qty);

  if v_sent <= 0 then
    raise exception 'จำนวนที่ส่งต้องมากกว่าศูนย์';
  end if;

  -- ส่งเกินที่ขอได้ ของจริงเกิดขึ้นตอนสาขาโทรมาขอเพิ่มทีหลัง
  -- แต่เกินแบบผิดปกติมักเป็นการพิมพ์ตกหลัก จึงกันไว้ที่สิบเท่า
  if v_sent > v_row.qty * 10 then
    raise exception 'จำนวนที่ส่ง % มากกว่าที่ขอ % หลายเท่า กรอกผิดหรือเปล่า', v_sent, v_row.qty;
  end if;

  update sack_orders
     set status    = p_mode,
         relay_via = case when p_mode = 'relay' then btrim(p_relay) else null end,
         sent_qty  = v_sent,
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
                            'sent_qty', v_sent, 'qty', v_row.qty);
end $$;

grant execute on function mark_sack_sent(uuid, text, text, jsonb, integer) to authenticated;


-- ---------------------------------------------------------------------
-- วิวหลัก — เพิ่มจำนวนที่ส่งจริง
--
-- sent_qty ดิบยังส่งออกไปด้วย เพราะ null มีความหมายว่า "ส่งเต็ม"
-- ถ้าเหลือแต่ค่าที่ coalesce แล้ว หน้าจอจะแยกไม่ออกว่าเป็นของเก่าหรือกรอกมาเท่ากันพอดี
-- ---------------------------------------------------------------------
drop view if exists sack_rows cascade;
create view sack_rows
with (security_invoker = true) as
select
  o.id, o.ref_no, o.hub_code, o.qty, o.unit, o.branch, o.note,
  o.status, o.relay_via, o.created_at, o.sent_at,
  o.updated_at,
  o.sent_qty,
  coalesce(o.sent_qty, o.qty) as qty_out,
  (o.sent_qty is not null and o.sent_qty <> o.qty) as qty_differs,
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
    where table_name = 'sack_orders' and column_name = 'sent_qty')      as มีช่องจำนวนที่ส่ง,
  (select count(*) from pg_proc
    where proname = 'mark_sack_sent' and pronargs = 5)                  as ฟังก์ชันรับห้าช่อง,
  (select count(*) from information_schema.columns
    where table_name = 'sack_rows' and column_name = 'qty_out')         as วิวมีจำนวนที่ส่ง,
  (select count(*) from sack_rows where qty_differs)                    as ที่ส่งไม่เท่าที่ขอ;
