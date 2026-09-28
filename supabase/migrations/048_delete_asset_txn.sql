-- =====================================================================
-- BPL SUPPLY — ลบใบเบิก Asset ที่คืนไปแล้วได้
-- รันต่อจาก 047 · ปลอดภัยที่จะรันซ้ำ
--
-- อาการ: กดลบในหน้าหลักฐาน แล้วขึ้น
--   violates foreign key constraint "asset_txn_items_out_item_id_fkey"
--
-- สาเหตุ: แถวตอนคืนชี้กลับไปหาแถวตอนเบิก (out_item_id)
-- พอลบใบเบิก แถวของใบนั้นถูกลบตาม แต่แถวตอนคืนยังชี้อยู่ที่เดิม
-- ฐานข้อมูลจึงไม่ยอมลบ เพราะจะเหลือตัวชี้ที่ชี้ไปหาของที่ไม่มีแล้ว
--
-- ตัวกันของเดิมดูแค่ "ยังมีเครื่องไม่ได้คืนไหม" ซึ่งไม่ครอบเคสนี้
-- ใบที่คืนเรียบร้อยแล้วต่างหากที่มีตัวชี้ค้างอยู่ จึงลบไม่ได้มาตลอด
--
-- แก้โดยบอกฐานข้อมูลว่า ถ้าแถวตอนเบิกถูกลบ ให้ล้างตัวชี้เป็นว่าง
-- ไม่ใช่ลบแถวตอนคืนตามไปด้วย เพราะการคืนเกิดขึ้นจริง ลบทิ้งคือโกหกประวัติ
-- แถวคืนจะยังอยู่ แค่ไม่รู้แล้วว่าคู่กับการเบิกครั้งไหน — ซึ่งถูกต้อง
-- เพราะคนสั่งลบการเบิกครั้งนั้นทิ้งไปเอง
-- =====================================================================

alter table asset_txn_items
  drop constraint if exists asset_txn_items_out_item_id_fkey;

alter table asset_txn_items
  add constraint asset_txn_items_out_item_id_fkey
  foreign key (out_item_id) references asset_txn_items(id) on delete set null;


-- ---------------------------------------------------------------------
-- ตัวกันตอนลบ — อธิบายให้ตรงกับสิ่งที่เกิดขึ้นจริง
--
-- ของเดิมห้ามลบเฉพาะตอนยังมีเครื่องค้างอยู่ ซึ่งถูกแล้ว
-- เพิ่มคำอธิบายให้รู้ว่าลบใบเบิกแล้วประวัติการคืนที่คู่กันจะขาดคู่
-- ---------------------------------------------------------------------
create or replace function delete_evidence(p_kind text, p_id text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_txn uuid;
begin
  if my_role() <> 'admin' then
    raise exception 'เฉพาะเจ้าของระบบเท่านั้นที่ลบหลักฐานได้';
  end if;

  if p_kind = 'requisition' then
    delete from requisitions where id = p_id::uuid;

  elsif p_kind = 'return' then
    delete from returns where id = p_id::bigint;

  elsif p_kind in ('asset_out', 'asset_in') then
    v_txn := p_id::uuid;

    -- เครื่องที่ยังไม่ได้คืนห้ามลบ ไม่งั้นมันจะหลุดจากรายการค้างโดยไม่มีใครรู้ว่าอยู่ไหน
    if exists (
      select 1
      from asset_txn_items ai
      join assets a on a.held_item_id = ai.id
      where ai.txn_id = v_txn
    ) then
      raise exception 'ยังมีเครื่องในรายการนี้ที่ไม่ได้คืน กดคืนให้เรียบร้อยก่อนจึงจะลบได้';
    end if;

    delete from asset_txns where id = v_txn;

  else
    raise exception 'ไม่รู้จักประเภท %', p_kind;
  end if;
end $$;

grant execute on function delete_evidence(text, text) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล — ต้องขึ้น SET NULL
-- ---------------------------------------------------------------------
select tc.constraint_name                  as ชื่อเงื่อนไข,
       rc.delete_rule                      as เมื่อถูกลบให้ทำอะไร
  from information_schema.table_constraints tc
  join information_schema.referential_constraints rc
    on rc.constraint_name = tc.constraint_name
 where tc.table_name = 'asset_txn_items'
   and tc.constraint_name = 'asset_txn_items_out_item_id_fkey';
