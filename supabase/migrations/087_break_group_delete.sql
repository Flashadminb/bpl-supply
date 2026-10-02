-- =====================================================================
-- BPL SUPPLY — ลบแผนกบัตรเบรคที่สร้างผิดทิ้งได้
-- รันต่อจาก 086 · ปลอดภัยที่จะรันซ้ำ
--
-- อาการ
--   เจ้าของระบบพิมพ์รหัสบัตร (OUT4-01) ลงช่องรหัสแผนกโดยไม่ตั้งใจ
--   ได้แผนกชื่อ OUT4-01 ที่ไม่มีความหมาย แล้วเอาออกไม่ได้เลย
--   มีแต่ปิดใช้งาน ซึ่งยังค้างอยู่ในลิสต์ให้สับสนต่อไปตลอด
--
-- กฎการลบเหมือนบัตร — **แผนกที่บัตรเคยถูกปล่อยแล้วลบไม่ได้**
-- เพราะประวัติอ้างถึงรหัสบัตรของแผนกนั้นอยู่
--
-- ไม่ปล่อยให้ FK cascade พังเอง เพราะข้อความที่ Postgres คืนมาคนอ่านไม่รู้เรื่อง
-- เช็คเองก่อนแล้วบอกเป็นภาษาคนว่าติดเพราะอะไรและต้องทำอะไรแทน
-- =====================================================================

create or replace function break_group_delete(p_code text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_code  text := break_norm_code(p_code);
  v_cards integer;
  v_used  integer;
begin
  perform break_admin_guard();

  if not exists (select 1 from break_groups where code = v_code) then
    raise exception 'ไม่พบแผนก %', v_code;
  end if;

  select count(*) into v_cards from break_cards where group_code = v_code;

  select count(*) into v_used
    from break_cards c
   where c.group_code = v_code
     and exists (select 1 from break_passes p where p.card_code = c.code);

  if v_used > 0 then
    raise exception
      'แผนก % มีบัตรที่เคยใช้งานแล้ว % ใบ ลบไม่ได้เพราะประวัติอ้างถึงอยู่ — ปิดใช้งานแทนได้',
      v_code, v_used;
  end if;

  -- บัตรหายตามเองผ่าน on delete cascade · คนที่ดูแลแผนกก็หายตามเช่นกัน
  delete from break_groups where code = v_code;

  return jsonb_build_object('ok', true, 'code', v_code, 'cards_removed', v_cards);
end $$;

grant execute on function break_group_delete(text) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname = 'break_group_delete') as ฟังก์ชันลบแผนก,
  (select count(*) from break_groups)                                 as แผนกทั้งหมด,
  (select string_agg(code, ' · ' order by code) from break_groups)     as รายชื่อแผนกตอนนี้;
