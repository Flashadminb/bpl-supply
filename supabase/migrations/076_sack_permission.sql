-- =====================================================================
-- BPL SUPPLY — สิทธิ์เห็นงานกระสอบ ตั้งเป็นรายคนได้
-- รันต่อจาก 075 · ปลอดภัยที่จะรันซ้ำ
--
-- ของเดิมหน้างาน "ทุกคน" เห็นกระสอบรอส่ง ยกเว้นผู้ตรวจสอบ
-- ซึ่งแปลว่าคนที่ไม่เกี่ยวกับงานนี้ก็เห็นคิวงานคนอื่นเต็มหน้าแรก
-- และเจ้าของระบบเลือกไม่ได้ว่าใครควรเห็น ต้องมาแก้โค้ดทุกครั้ง
--
-- ธงรายคนเหมือน can_assets ที่มีอยู่แล้ว เปิดปิดได้จากหน้าผู้ใช้และสิทธิ์
--
-- ค่าเริ่มต้นของ "บัญชีใหม่" คือปิด เพราะงานกระสอบเป็นงานเฉพาะกลุ่ม
-- แต่ **ของเดิมที่ใช้งานอยู่ต้องไม่หลุด** จึงเปิดให้คนที่เคยแตะงานนี้จริง
-- และเปิดให้แอดมินกับเจ้าของระบบ ซึ่งต้องเห็นอยู่แล้วโดยหน้าที่
-- ที่เหลือปิดหมด แล้วเจ้าของระบบค่อยกดเปิดเพิ่มเอง ซึ่งเป็นสิ่งที่ขอมา
-- =====================================================================

alter table profiles add column if not exists can_sack boolean not null default false;


-- เปิดให้คนที่เคยตั้งหรือเคยกดส่งกระสอบ — เขาใช้งานอยู่จริง ห้ามตัดกลางคัน
update profiles p
   set can_sack = true
 where p.can_sack = false
   and exists (
     select 1 from sack_orders o
      where o.created_by = p.id or o.sent_by = p.id
   );

-- แอดมินกับเจ้าของระบบเห็นอยู่แล้วโดยหน้าที่ ไม่ควรต้องมากดเปิดเอง
update profiles
   set can_sack = true
 where can_sack = false
   and role in ('admin', 'supervisor');


-- ---------------------------------------------------------------------
-- บังคับที่ฐานข้อมูลด้วย ไม่ใช่แค่ซ่อนปุ่ม
--
-- ของเดิม policy อ่าน sack_orders เป็น using (true) คือใครล็อกอินก็อ่านได้หมด
-- ซ่อนแค่หน้าจอแปลว่าคนที่รู้ URL ยังดึงคิวงานทั้งฮับออกไปได้อยู่
-- ---------------------------------------------------------------------
create or replace function my_can_sack() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.can_sack and not coalesce(p.can_dispatch, false)
       from profiles p where p.id = auth.uid()),
    false)
    or my_role() in ('supervisor', 'admin');
$$;

grant execute on function my_can_sack() to authenticated;

drop policy if exists read_sack_orders on sack_orders;
create policy read_sack_orders on sack_orders for select to authenticated
  using (my_can_sack());

drop policy if exists read_sack_photos on sack_order_photos;
create policy read_sack_photos on sack_order_photos for select to authenticated
  using (my_can_sack());


-- กดส่งเป็น security definer จึงข้าม policy ข้างบนไปได้ ต้องเช็คในตัวมันเอง
-- ถึง uuid จะเดาไม่ได้ แต่สิทธิ์ต้องบังคับที่ฐานข้อมูล ไม่ใช่อาศัยว่าเดายาก
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
  if not my_can_sack() then
    raise exception 'ไม่มีสิทธิ์กดส่งกระสอบ';
  end if;
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

  if v_row.status <> 'pending' then
    return jsonb_build_object('ref_no', v_row.ref_no, 'duplicate', true,
                              'status', v_row.status, 'relay_via', v_row.relay_via,
                              'sent_qty', coalesce(v_row.sent_qty, v_row.qty),
                              'sent_unit', coalesce(v_row.sent_unit, v_row.unit),
                              'qty', v_row.qty, 'unit', v_row.unit);
  end if;

  v_sent := coalesce(p_sent_qty, v_row.qty);
  v_unit := coalesce(p_sent_unit, v_row.unit);

  if v_sent <= 0 then
    raise exception 'จำนวนที่ส่งต้องมากกว่าศูนย์';
  end if;

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
-- ตรวจผล — ดูว่าใครได้สิทธิ์ไปบ้าง ก่อนจะไปนั่งกดเปิดเพิ่ม
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'profiles' and column_name = 'can_sack')  as มีช่องสิทธิ์,
  (select count(*) from profiles where can_sack)                 as คนที่เห็นกระสอบ,
  (select count(*) from profiles where not can_sack)             as คนที่ไม่เห็น,
  (select count(*) from profiles)                                as ทั้งหมด;
