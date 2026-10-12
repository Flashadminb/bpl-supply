-- ---------------------------------------------------------------------
-- 157 · ลบชื่อซัพออกจากระบบได้จากหลังบ้าน
--
-- ลบจริงได้เฉพาะซัพที่ยังไม่เคยถูกใช้ในใบไหนเลย
-- ซัพที่เคยถูกใช้แล้วลบไม่ได้ ให้ปิดการใช้งานแทน เพราะถ้าลบแถวทิ้ง
-- แล้ววันหนึ่งมีคนเพิ่มรหัสเดิมกลับมาโดยหมายถึงคนละเจ้า
-- ประวัติสองช่วงจะถูกนับรวมกันเป็นเจ้าเดียวโดยไม่มีใครรู้
--
-- ลบได้เฉพาะผู้ดูแลระบบขึ้นไป ตรงกับกติกาเดิมว่าแอดมินลบข้อมูลไม่ได้
-- ---------------------------------------------------------------------

create or replace function break_supplier_delete(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_used integer;
begin
  perform break_card_guard();
  if my_role() <> 'admin' then
    raise exception 'ลบชื่อซัพได้เฉพาะผู้ดูแลระบบ · ถ้าจะเลิกใช้ให้กดปิดการใช้งานแทน';
  end if;

  if not exists (select 1 from break_suppliers where code = v_code) then
    raise exception 'ไม่พบซัพ %', v_code;
  end if;

  select count(*) into v_used from break_passes where supplier = v_code;
  if v_used > 0 then
    raise exception 'ซัพ % ถูกใช้ไปแล้ว % ใบ ลบไม่ได้ · กดปิดการใช้งานแทน ประวัติจะได้ไม่เพี้ยน',
                    v_code, v_used;
  end if;

  delete from break_suppliers where code = v_code;
  return jsonb_build_object('ok', true, 'code', v_code);
end $fn$;

grant execute on function break_supplier_delete(text) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname = 'break_supplier_delete') as มีฟังก์ชันลบ,
  (select count(*) from break_suppliers)                                 as ซัพในระบบ;
