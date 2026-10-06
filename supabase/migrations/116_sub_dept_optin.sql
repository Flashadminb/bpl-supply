-- =====================================================================
-- BPL SUPPLY — แก้แผนกย่อยให้ปลอดภัยกับข้อมูลที่มีอยู่ก่อน
-- รันต่อจาก 115 · ปลอดภัยที่จะรันซ้ำ
--
-- profiles.sub_dept มีมาตั้งแต่ migration 017 ในฐานะ "ป้ายกำกับเฉย ๆ"
-- และมีคนกรอกไว้แล้วจริง ทั้งที่เป็นแผนกย่อยจริง เช่น OUT4W กับ DO1 DO2 DO3
-- และที่เป็นป้ายตำแหน่ง เช่น ALL กับ STD QC Admin
--
-- 115 เอาคอลัมน์นี้ไปใช้ตัดสินสิทธิ์ทันที ทำให้
--   คนในแผนก ALL ที่มีป้าย กลายเป็นสิทธิ์ ALL/STD ซึ่งไม่เท่ากับ ALL
--   แล้วเสียสิทธิ์เห็นเครื่องทุกแผนกไปเงียบ ๆ
--
-- แก้สองชั้น
--   1 แผนก ALL ไม่เอาย่อยมาต่อท้ายเด็ดขาด ALL แปลว่าทั้งหมดเสมอ
--   2 ป้ายจะมีผลกับสิทธิ์ก็ต่อเมื่อถูกลงทะเบียนใน sub_depts แล้วเท่านั้น
--     ป้ายที่ยังไม่ได้ลงทะเบียน ถือว่าไม่มี เห็นทั้งแผนกเหมือนเดิม
--
-- ผลคือของเดิมไม่ขยับสักคน จนกว่าเจ้าของระบบจะลงทะเบียนแผนกย่อยเอง
-- การเปลี่ยนสิทธิ์ที่เกิดขึ้นเองโดยไม่มีใครสั่ง คือสิ่งที่ต้องกันให้ได้ก่อนเสมอ
-- =====================================================================

create or replace function my_asset_grants() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(
    array[
      case
        when p.dept_code is null or p.dept_code = 'ALL' then p.dept_code
        when nullif(btrim(coalesce(p.sub_dept, '')), '') is null then p.dept_code
        -- ป้ายที่ยังไม่ได้ลงทะเบียนเป็นแผนกย่อย ไม่มีผลกับสิทธิ์
        when not exists (
          select 1 from sub_depts s
           where s.dept_code = p.dept_code
             and s.code = btrim(p.sub_dept)
             and s.is_active
        ) then p.dept_code
        else p.dept_code || '/' || btrim(p.sub_dept)
      end
    ] || p.extra_depts,
    '{}'
  )
  from profiles p where p.id = auth.uid();
$$;

grant execute on function my_asset_grants() to authenticated;


-- ---------------------------------------------------------------------
-- เครื่องก็เหมือนกัน · ย่อยที่ยังไม่ได้ลงทะเบียน ถือเป็นของกลางของแผนก
-- ---------------------------------------------------------------------
create or replace function asset_dept_keys(p_dept text, p_sub text, p_shares text[])
returns text[]
language sql stable set search_path = public as $$
  select
    case
      when p_dept is null then '{}'::text[]
      when nullif(btrim(coalesce(p_sub, '')), '') is null then array[p_dept]
      when not exists (
        select 1 from sub_depts s
         where s.dept_code = p_dept and s.code = btrim(p_sub) and s.is_active
      ) then array[p_dept]
      else array[p_dept || '/' || btrim(p_sub)]
    end
    || coalesce(p_shares, '{}');
$$;

grant execute on function asset_dept_keys(text, text, text[]) to authenticated;


-- ---------------------------------------------------------------------
-- รายงานป้ายที่ยังไม่ได้ลงทะเบียน · เอาไว้โชว์ให้เจ้าของระบบเห็นว่ามีอะไรค้าง
-- ---------------------------------------------------------------------
create or replace function sub_dept_unknown()
returns table (dept_code text, label text, people int)
language sql stable security definer set search_path = public as $$
  select p.dept_code, btrim(p.sub_dept), count(*)::int
  from profiles p
  where my_role() = 'admin'
    and p.is_active
    and p.dept_code is not null
    and p.dept_code <> 'ALL'
    and nullif(btrim(coalesce(p.sub_dept, '')), '') is not null
    and not exists (
      select 1 from sub_depts s
       where s.dept_code = p.dept_code and s.code = btrim(p.sub_dept) and s.is_active
    )
  group by 1, 2
  order by 3 desc;
$$;

grant execute on function sub_dept_unknown() to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล · ไม่ควรมีใครเสียสิทธิ์เลยตอนนี้ เพราะยังไม่มีแผนกย่อยสักอัน
-- ---------------------------------------------------------------------
select
  (select count(*) from sub_depts)                                  as แผนกย่อยที่ลงทะเบียนแล้ว,
  (select count(*) from profiles
    where is_active and dept_code = 'ALL'
      and nullif(btrim(coalesce(sub_dept,'')),'') is not null)      as คนแผนกALLที่มีป้าย,
  (select count(*) from profiles
    where is_active and dept_code is not null and dept_code <> 'ALL'
      and nullif(btrim(coalesce(sub_dept,'')),'') is not null)      as คนแผนกอื่นที่มีป้าย,
  (select count(*) from assets
    where nullif(btrim(coalesce(sub_dept,'')),'') is not null)      as เครื่องที่ใส่ย่อยแล้ว;
