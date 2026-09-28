-- =====================================================================
-- BPL SUPPLY — คืนวัสดุยืม-คืนหลายรายการในครั้งเดียว
-- รันต่อจาก 042 · ปลอดภัยที่จะรันซ้ำ
--
-- ตอนเลิกกะคนหนึ่งอาจค้างหลายรายการ ของเดิมต้องกดคืนทีละอัน
-- ถ่ายรูปใหม่ทุกอัน ทั้งที่ของกองอยู่ตรงหน้าชุดเดียวกัน
-- แถวยาว ๆ ตอนเปลี่ยนกะเกิดจากตรงนี้
--
-- ฟังก์ชันนี้วนเรียกตรรกะเดิมทีละบรรทัด ไม่ได้เขียนกฎใหม่
-- กฎเดิมทุกข้อจึงยังอยู่ครบ: คืนเกินไม่ได้ · ต้องมีรูป · ของสภาพดีเข้าสต็อกคืน
-- ถ้าบรรทัดไหนพัง ทั้งชุดย้อนกลับ ไม่เหลือคืนครึ่ง ๆ กลาง ๆ ให้ตามแก้
-- =====================================================================

create or replace function create_return_many(
  p_lines     jsonb,
  p_condition return_cond default 'ok',
  p_photos    jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r        jsonb;
  v_line   bigint;
  v_qty    integer;
  v_n      integer := 0;
  v_units  integer := 0;
  v_main   text := p_photos->0->>'file_id';
  v_link   text := p_photos->0->>'web_link';
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'ยังไม่ได้เลือกรายการที่จะคืน';
  end if;
  if v_main is null then
    raise exception 'ต้องถ่ายรูปสภาพตอนคืนอย่างน้อย 1 ใบ';
  end if;

  for r in select * from jsonb_array_elements(p_lines) loop
    v_line := (r->>'line_id')::bigint;
    v_qty  := (r->>'qty')::integer;

    if v_line is null or coalesce(v_qty, 0) <= 0 then
      raise exception 'บรรทัดรายการไม่ครบ ต้องมีทั้งรายการและจำนวนที่มากกว่า 0';
    end if;

    -- ใช้ตรรกะเดิมทั้งหมด รูปชุดเดียวกันติดไปทุกบรรทัด
    -- เพราะเป็นการส่งมอบครั้งเดียวกันจริง ๆ
    perform create_return(v_line, v_qty, p_condition, v_main, v_link, p_photos);

    v_n     := v_n + 1;
    v_units := v_units + v_qty;
  end loop;

  return jsonb_build_object('lines', v_n, 'units', v_units);
end $$;

grant execute on function create_return_many(jsonb, return_cond, jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select 'ฟังก์ชันคืนหลายรายการ' as สิ่งที่ตรวจ, count(*)::text as ผล
  from pg_proc where proname = 'create_return_many';
