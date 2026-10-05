-- =====================================================================
-- BPL SUPPLY — สแกนอันเดียวแยกบัตรเบรคกับบัตร OS เอง + ออกบัตร OS ใหม่ยกชุด
-- รันต่อจาก 099 · ปลอดภัยที่จะรันซ้ำ
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. โค้ดนี้คือบัตรอะไร
--
-- ไม่แยกด้วยหน้าตาของโค้ด แยกด้วยการถามว่ามีอยู่จริงไหม
--   โทเคนบัตร OS รุ่นใหม่ยาว 16 ตัว ชุดอักษร Crockford ไม่มีขีด
--   รหัสบัตรเบรคเป็นรหัสที่เจ้าของระบบตั้งเอง สั้น ๆ มีขีด เช่น OUT4-01
-- วันไหนตั้งชื่อบัตรเบรคยาว 16 ตัวไม่มีขีด กฎที่ดูจากหน้าตาจะเดาผิดทันที
-- โดยไม่มีใครรู้ตัว ส่วนการถามตารางไม่มีวันเดาผิด และเร็วพอ ๆ กัน
--
-- ถามบัตรเบรคก่อนเสมอ เพราะ break_scan อ่านอย่างเดียวไม่บันทึกอะไร
-- ส่วน os_scan บันทึกประวัติทุกครั้งที่เรียก ยิงมั่วไม่ได้
-- ฟังก์ชันนี้จึงไม่เรียก os_scan เอง แค่บอกว่าเป็นบัตร OS
-- แล้วให้หน้าจอไปเรียก os_scan เองตอนที่ตั้งใจจะสแกนจริง
--
-- ไม่ได้เพิ่มด่านสิทธิ์ใหม่ เพราะสิ่งที่ตอบกลับคือ "โค้ดนี้รู้จักไหม"
-- ซึ่งน้อยกว่าที่ break_scan กับ os_scan เปิดให้อยู่แล้วทั้งคู่
-- ---------------------------------------------------------------------
create or replace function guard_scan(p_code text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_raw  text := btrim(coalesce(p_code, ''));
  v_code text := upper(v_raw);
begin
  if v_raw = '' then
    return jsonb_build_object('kind', 'unknown', 'code', '');
  end if;

  if exists (select 1 from break_cards where code = v_code) then
    return jsonb_build_object('kind', 'break', 'code', v_code, 'scan', break_scan(v_code));
  end if;

  -- โทเคนเทียบตรง ๆ ไม่แปลงตัวพิมพ์ เพราะบัตรรุ่นเก่าเป็น base64 ที่พิมพ์เล็กใหญ่ปนกัน
  if exists (select 1 from os_cards where token = v_raw) then
    return jsonb_build_object('kind', 'os', 'code', v_raw);
  end if;

  return jsonb_build_object('kind', 'unknown', 'code', v_code);
end $$;

grant execute on function guard_scan(text) to authenticated;


-- ---------------------------------------------------------------------
-- 2. กันไม่ให้ตั้งรหัสบัตรเบรคที่หน้าตาเหมือนโทเคนบัตร OS
--
-- ถึงจะแยกด้วยการถามตารางแล้ว แต่ถ้าวันหนึ่งมีรหัสซ้ำกันจริงทั้งสองฝั่ง
-- บัตรเบรคจะชนะเสมอ แล้วบัตร OS ใบนั้นจะสแกนไม่ติดโดยไม่มีใครเดาออกว่าทำไม
-- ปิดทางตั้งแต่ตอนสร้างจึงถูกกว่าไล่หาทีหลัง
--
-- กันเฉพาะรูปแบบของโทเคนรุ่นใหม่ · 16 ตัว ชุดอักษร Crockford ไม่มีขีดไม่มีขีดล่าง
-- รหัสอย่าง OUT4-01 หรือ BREAK01 ยังตั้งได้ตามปกติ
-- ---------------------------------------------------------------------
create or replace function break_norm_code(p_code text) returns text
language plpgsql immutable as $$
declare
  v text := upper(btrim(coalesce(p_code, '')));
begin
  if v = '' then
    raise exception 'รหัสบัตรว่างไม่ได้';
  end if;
  if length(v) > 24 then
    raise exception 'รหัสบัตร % ยาวเกิน 24 ตัว', v;
  end if;
  if v !~ '^[A-Z0-9][A-Z0-9_-]*$' then
    raise exception 'รหัสบัตร % ใช้ได้เฉพาะ A-Z 0-9 - _ และต้องขึ้นต้นด้วยตัวอักษรหรือตัวเลข', v;
  end if;
  if v ~ '^[0-9A-HJKMNP-TV-Z]{16}$' then
    raise exception 'รหัสบัตร % หน้าตาเหมือนโค้ดบัตร OS ใส่ขีดคั่นหรือเปลี่ยนความยาวหน่อย', v;
  end if;
  return v;
end $$;


-- ---------------------------------------------------------------------
-- 3. ออกบัตร OS ใหม่ให้ทุกคนที่ยังใช้โค้ดรุ่นเก่า
--
-- โค้ดรุ่นเก่ายาว 32 ตัว พิมพ์เล็กใหญ่ปนกัน QR จึงต้องเข้ารหัสแบบไบต์
-- ได้ตาราง 29x29 ช่อง ยัดลงบัตรกว้าง 54 มม. แล้วเหลือช่องละ 0.47 มม.
-- ซึ่งเล็กเกินกว่ากล้องจะจับไว · รุ่นใหม่ 16 ตัวพิมพ์ใหญ่ล้วนได้ตาราง 21x21
-- ขนาดเท่าเดิมแต่ช่องโตขึ้นเกือบเท่าตัว
--
-- os_issue_card ยกเลิกใบเก่าให้เองก่อนออกใบใหม่ และเดินเลข rev ให้ด้วย
-- บัตรที่ปริ้นไปแล้วจะใช้ไม่ได้ทันที จึงต้องกดตอนที่พร้อมปริ้นใหม่เท่านั้น
-- ---------------------------------------------------------------------
create or replace function os_reissue_old_tokens()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_n integer := 0;
  r   record;
begin
  if not my_can_os_admin() then
    raise exception 'บัญชีนี้ออกบัตรไม่ได้';
  end if;

  for r in
    select distinct c.person_id
      from os_cards c
      join os_people p on p.id = c.person_id
     where c.revoked_at is null and length(c.token) > 20 and p.is_active
  loop
    perform os_issue_card(r.person_id);
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'reissued', v_n);
end $$;

grant execute on function os_reissue_old_tokens() to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc
    where proname in ('guard_scan', 'os_reissue_old_tokens'))           as ฟังก์ชันที่เพิ่ม,
  (select count(*) from os_cards
    where revoked_at is null and length(token) > 20)                    as บัตรOSที่ยังเป็นโค้ดเก่า,
  (select count(*) from break_cards)                                    as บัตรเบรคทั้งหมด,
  guard_scan('ไม่มีรหัสนี้')->>'kind'                                    as ลองสแกนรหัสมั่ว;
