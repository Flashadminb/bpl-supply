-- =====================================================================
-- BPL SUPPLY — ยุบเหลือผู้ดูแล 2 ระดับ ไม่มี "หัวหน้างาน"
-- รันต่อจาก 003_first_login.sql · ปลอดภัยที่จะรันซ้ำ
--
-- ค่าใน enum ยังเป็น staff / supervisor / admin เหมือนเดิม
-- เปลี่ยนแค่ว่า supervisor ทำอะไรได้บ้าง และหน้าจอเรียกเขาว่า "แอดมิน"
--
--   supervisor = "แอดมิน"       อนุมัติคำขอ · แก้สต็อก · รับของเข้า · ส่งออก Sheet
--   admin      = "ผู้ดูแลระบบ"   ทุกอย่างข้างบน + เพิ่มบัญชี/รีเซ็ตรหัสผ่านคนอื่น
-- =====================================================================

-- ---- แก้สต็อก / เพิ่มวัสดุ: เดิม admin เท่านั้น -> เปิดให้ supervisor ด้วย ----
drop policy if exists write_items on items;
create policy write_items on items for all to authenticated
  using (my_role() in ('supervisor', 'admin'))
  with check (my_role() in ('supervisor', 'admin'));

-- ---- สวิตช์อนุมัติอัตโนมัติ: เดิม admin เท่านั้น -> เปิดให้ supervisor ด้วย ----
drop policy if exists write_settings on app_settings;
create policy write_settings on app_settings for all to authenticated
  using (my_role() in ('supervisor', 'admin'))
  with check (my_role() in ('supervisor', 'admin'));

-- ---- จัดการผู้ใช้: ยังเป็นของ admin คนเดียวเหมือนเดิม (ไม่แตะ write_profiles) ----

-- ---- รับของเข้า / ปรับยอด: เดิม admin เท่านั้น -> เปิดให้ supervisor ด้วย ----
create or replace function adjust_stock(
  p_item_id bigint,
  p_delta   integer,
  p_reason  text default 'adjust'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor profiles%rowtype;
  v_item  items%rowtype;
  v_after integer;
begin
  select * into v_actor from profiles where id = auth.uid();
  if not found or not v_actor.is_active or v_actor.role = 'staff' then
    raise exception 'ไม่มีสิทธิ์ปรับสต็อก';
  end if;
  if p_delta = 0 then
    raise exception 'จำนวนที่เปลี่ยนต้องไม่เป็นศูนย์';
  end if;

  select * into v_item from items where id = p_item_id for update;
  if not found then
    raise exception 'ไม่พบวัสดุ';
  end if;

  v_after := v_item.qty_on_hand + p_delta;
  if v_after < 0 then
    raise exception 'ยอดคงเหลือติดลบไม่ได้ (ปัจจุบัน %)', v_item.qty_on_hand;
  end if;

  update items set qty_on_hand = v_after, updated_at = now() where id = p_item_id;
  insert into stock_movements (item_id, delta, qty_after, reason, ref_type, ref_id, actor_id)
    values (p_item_id, p_delta, v_after, p_reason, 'adjust', null, v_actor.id);

  return jsonb_build_object('qty_after', v_after);
end $$;

grant execute on function adjust_stock(bigint, integer, text) to authenticated;
