-- =====================================================================
-- BPL SUPPLY — บาร์โค้ด BY ต้องมีรูปอย่างน้อย 1 ใบ
-- รันต่อจาก 026 · ปลอดภัยที่จะรันซ้ำ
--
-- ไม่บังคับให้ถ่ายเยอะ แต่ต้องมีอย่างน้อย 1 ใบเสมอ
-- เพราะรูปบาร์โค้ดคือสิ่งที่แอดมินเอาไปสแกนตัดสต็อกจริง ๆ
-- ไม่มีรูปก็ไม่มีอะไรให้ทำต่อ
--
-- (ไฟล์นี้เคยปล่อยให้ส่งโดยไม่มีรูปได้ชั่วคราว ตอนนี้กลับมาบังคับ 1 ใบแล้ว
--  รันทับได้เลย ข้อมูลเดิมไม่กระทบ)
-- =====================================================================

create or replace function create_by_barcode(
  p_reason text,
  p_note   text default null,
  p_photos jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me  profiles%rowtype;
  v_id  uuid;
  v_ref text;
  r     jsonb;
  i     int := 0;
begin
  select * into v_me from profiles where id = auth.uid();
  if v_me.id is null or not v_me.is_active then
    raise exception 'บัญชีนี้ใช้งานไม่ได้';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'ต้องใส่เหตุผลก่อน';
  end if;
  if coalesce(jsonb_array_length(p_photos), 0) = 0 then
    raise exception 'ต้องแนบรูปบาร์โค้ดอย่างน้อย 1 ใบ';
  end if;

  v_ref := next_by_ref();
  insert into by_barcodes (ref_no, user_id, dept_code, sub_dept,
                           shift_start, shift_end, reason, note)
  values (v_ref, v_me.id, v_me.dept_code, v_me.sub_dept,
          v_me.shift_start, v_me.shift_end, btrim(p_reason),
          nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;

  for r in select * from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) loop
    insert into by_barcode_photos (by_id, file_id, web_link, bytes, sort_no)
    values (v_id, r->>'file_id', r->>'web_link', (r->>'bytes')::int, i);
    i := i + 1;
  end loop;

  return jsonb_build_object('id', v_id, 'ref_no', v_ref, 'photos', i);
end $$;

grant execute on function create_by_barcode(text, text, jsonb) to authenticated;
