-- =====================================================================
-- BPL SUPPLY — ลบรายการวัสดุออกจากสต็อกได้
-- รันต่อจาก 015 · ปลอดภัยที่จะรันซ้ำ
--
-- ของที่เคยมีคนเบิกไปแล้ว ลบทิ้งจริงไม่ได้ ไม่งั้นประวัติการเบิกจะพัง
-- จึงแยกเป็นสองทาง: ยังไม่เคยถูกเบิก = ลบทิ้งจริง
--                  เคยถูกเบิกแล้ว   = ปิดการใช้งาน หายจากทุกหน้า ประวัติยังอ่านได้
-- =====================================================================

create or replace function delete_item(p_id bigint)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_used boolean;
  v_name text;
begin
  if my_role() not in ('supervisor', 'admin') then
    raise exception 'ไม่มีสิทธิ์ลบรายการวัสดุ';
  end if;

  select name into v_name from items where id = p_id;
  if v_name is null then
    raise exception 'ไม่พบรายการนี้';
  end if;

  select exists (select 1 from requisition_items where item_id = p_id) into v_used;

  if v_used then
    update items set is_active = false, updated_at = now() where id = p_id;
    return 'archived';
  end if;

  -- ไม่เคยถูกเบิกเลย ลบทิ้งได้สนิท พร้อมประวัติปรับสต็อกที่ผูกอยู่
  delete from stock_movements where item_id = p_id;
  delete from items where id = p_id;
  return 'deleted';
end $$;

grant execute on function delete_item(bigint) to authenticated;

comment on function delete_item(bigint) is
  'ลบวัสดุ — ลบสนิทถ้ายังไม่เคยถูกเบิก ไม่งั้นปิดการใช้งานเพื่อรักษาประวัติ';

-- ── เอาของตัวอย่างสองชิ้นที่ใส่ไว้ตอนตั้งระบบออก ─────────────────────
-- ของจริงย้ายไปอยู่ในทะเบียนเครื่อง (assets) หมดแล้ว
do $$
declare v_id bigint;
begin
  for v_id in select id from items where sku in ('SKU-RT-0401', 'SKU-RT-0402') loop
    if exists (select 1 from requisition_items where item_id = v_id) then
      update items set is_active = false, updated_at = now() where id = v_id;
    else
      delete from stock_movements where item_id = v_id;
      delete from items where id = v_id;
    end if;
  end loop;
end $$;
