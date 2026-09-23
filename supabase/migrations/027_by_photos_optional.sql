-- =====================================================================
-- BPL SUPPLY — บาร์โค้ด BY ไม่บังคับจำนวนรูป
-- รันต่อจาก 026 · ปลอดภัยที่จะรันซ้ำ
--
-- เดิมบังคับอย่างน้อย 1 ใบ ตอนนี้แนบกี่ใบก็ได้ รวมถึงไม่แนบเลย
-- เหตุผลยังบังคับอยู่ เพราะเป็นตัวเดียวที่บอกว่าเรื่องนี้คืออะไร
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
