-- =====================================================================
-- BPL SUPPLY — เปิดสิทธิ์แอดมินให้ทำงานแทนเจ้าของระบบได้
-- รันต่อจาก 057 · ปลอดภัยที่จะรันซ้ำ
--
-- เจ้าของระบบจะให้แอดมิน (role = supervisor) ทำงานแทนได้ทุกอย่าง
-- ที่เหลือไว้เฉพาะเจ้าของมีสองกลุ่มเท่านั้น
--
--   ① ลิงก์งานที่ตั้งให้เห็นเฉพาะเจ้าของ
--      แอดมินยังเห็นเฉพาะลิงก์ที่ตัวเองมีสิทธิ์เหมือนเดิม
--      และแก้ได้เฉพาะอันที่ตัวเองเห็น — อันที่มองไม่เห็นก็แตะไม่ได้ด้วย
--
--   ② การแต่งตั้งเจ้าของระบบ
--      แอดมินแก้บัญชีคนอื่นได้หมด แต่แตะบัญชีที่เป็นเจ้าของระบบไม่ได้
--      และตั้งใครเป็นเจ้าของระบบไม่ได้ รวมถึงตั้งตัวเองด้วย
--      ถ้าไม่กันข้อนี้ คำว่า "เท่ากัน" จะกลายเป็น "ใครก็ยึดระบบได้"
--      ซึ่งไม่ใช่สิ่งที่เจ้าของขอ
-- =====================================================================

-- ---------------------------------------------------------------------
-- ① จัดการผู้ใช้ — แอดมินทำได้ ยกเว้นแตะบัญชีเจ้าของระบบ
--
-- using      = แถวเดิมที่จะไปยุ่งด้วย ต้องไม่ใช่เจ้าของระบบ
-- with check = แถวหลังแก้ ต้องไม่กลายเป็นเจ้าของระบบ
-- สองอันคู่กันจึงกันได้ทั้ง "ไปลดขั้นเจ้าของ" และ "เลื่อนขั้นตัวเอง"
-- ---------------------------------------------------------------------
drop policy if exists write_profiles on profiles;
create policy write_profiles on profiles for all to authenticated
  using (
    my_role() = 'admin'
    or (my_role() = 'supervisor' and role <> 'admin')
  )
  with check (
    my_role() = 'admin'
    or (my_role() = 'supervisor' and role <> 'admin')
  );


-- ---------------------------------------------------------------------
-- ② ลิงก์งาน — แอดมินจัดการได้เฉพาะอันที่ตัวเองมองเห็น
--
-- นโยบายอ่านไม่แตะเลย แอดมินจึงยังเห็นเท่าเดิมเป๊ะ
-- ส่วนการเขียน ผูกกับ "มองเห็นไหม" เพื่อไม่ให้ลบหรือแก้อันที่ไม่เคยเห็น
-- ด้วยการเดาเลข id เอา
-- ---------------------------------------------------------------------
drop policy if exists write_work_links on work_links;
create policy write_work_links on work_links for all to authenticated
  using (
    my_role() = 'admin'
    or (my_role() = 'supervisor' and (audience = 'all' or my_sees_work_link(id)))
  )
  with check (
    my_role() = 'admin' or my_role() = 'supervisor'
  );

-- ตารางผู้ชม — เปิดให้แอดมินเฉพาะแถวของลิงก์ที่ตัวเองเห็น
-- ตัว exists ข้างในวิ่งผ่าน RLS ของ work_links อีกชั้น จึงกรองให้เองอัตโนมัติ
drop policy if exists manage_work_link_roles on work_link_roles;
create policy manage_work_link_roles on work_link_roles for all to authenticated
  using (
    my_role() = 'admin'
    or (my_role() = 'supervisor'
        and exists (select 1 from work_links l where l.id = link_id))
  )
  with check (my_role() in ('admin', 'supervisor'));

drop policy if exists manage_work_link_depts on work_link_depts;
create policy manage_work_link_depts on work_link_depts for all to authenticated
  using (
    my_role() = 'admin'
    or (my_role() = 'supervisor'
        and exists (select 1 from work_links l where l.id = link_id))
  )
  with check (my_role() in ('admin', 'supervisor'));

drop policy if exists manage_work_link_users on work_link_users;
create policy manage_work_link_users on work_link_users for all to authenticated
  using (
    my_role() = 'admin'
    or (my_role() = 'supervisor'
        and exists (select 1 from work_links l where l.id = link_id))
  )
  with check (my_role() in ('admin', 'supervisor'));


-- ---------------------------------------------------------------------
-- ฟังก์ชันบันทึกลิงก์ — เปิดให้แอดมิน แต่แก้ได้เฉพาะอันที่ตัวเองเห็น
--
-- ฟังก์ชันนี้เป็น security definer จึงข้าม RLS ไปเลย
-- ต้องเช็คเองในตัวฟังก์ชัน ไม่งั้นแอดมินจะยิงแก้ลิงก์ของเจ้าของได้ตรง ๆ
-- ---------------------------------------------------------------------
create or replace function save_work_link(
  p_id        bigint,
  p_title     text,
  p_url       text,
  p_note      text,
  p_sort_no   integer,
  p_is_active boolean,
  p_audience  text,
  p_roles     text[],
  p_depts     text[],
  p_users     uuid[]
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
  v_n  integer;
begin
  if my_role() not in ('admin', 'supervisor') then
    raise exception 'เฉพาะเจ้าของระบบและแอดมินเท่านั้นที่แก้ลิงก์งานได้';
  end if;

  -- แอดมินแก้ได้เฉพาะลิงก์ที่ตัวเองมองเห็น
  if p_id is not null and my_role() = 'supervisor' then
    if not exists (
      select 1 from work_links
       where id = p_id and (audience = 'all' or my_sees_work_link(id))
    ) then
      raise exception 'ลิงก์นี้ตั้งไว้ให้เห็นเฉพาะบางคน คุณจึงแก้ไม่ได้';
    end if;
  end if;

  if coalesce(btrim(p_title), '') = '' or coalesce(btrim(p_url), '') = '' then
    raise exception 'ต้องใส่ทั้งชื่อและลิงก์';
  end if;

  if p_audience not in ('all', 'custom') then
    raise exception 'โหมดผู้ชมไม่ถูกต้อง';
  end if;

  v_n := coalesce(array_length(p_roles, 1), 0)
       + coalesce(array_length(p_depts, 1), 0)
       + coalesce(array_length(p_users, 1), 0);

  if p_audience = 'custom' and v_n = 0 then
    raise exception 'เลือกเองต้องเลือกอย่างน้อยหนึ่งอย่าง — ตำแหน่ง แผนก หรือรายคน';
  end if;

  if p_id is null then
    insert into work_links (title, url, note, sort_no, is_active, audience)
    values (btrim(p_title), btrim(p_url), nullif(btrim(coalesce(p_note, '')), ''),
            coalesce(p_sort_no, 0), coalesce(p_is_active, true), p_audience)
    returning id into v_id;
  else
    update work_links
       set title     = btrim(p_title),
           url       = btrim(p_url),
           note      = nullif(btrim(coalesce(p_note, '')), ''),
           sort_no   = coalesce(p_sort_no, 0),
           is_active = coalesce(p_is_active, true),
           audience  = p_audience
     where id = p_id
    returning id into v_id;

    if v_id is null then
      raise exception 'ไม่พบลิงก์ที่จะแก้';
    end if;
  end if;

  delete from work_link_roles where link_id = v_id;
  delete from work_link_depts where link_id = v_id;
  delete from work_link_users where link_id = v_id;

  if p_audience = 'custom' then
    insert into work_link_roles (link_id, role_key)
    select v_id, r from unnest(coalesce(p_roles, '{}')) as r
     where r in ('staff', 'supervisor', 'admin', 'dispatch')
    on conflict do nothing;

    insert into work_link_depts (link_id, dept_code)
    select v_id, d from unnest(coalesce(p_depts, '{}')) as d
     where exists (select 1 from departments x where x.code = d)
    on conflict do nothing;

    insert into work_link_users (link_id, user_id)
    select v_id, u from unnest(coalesce(p_users, '{}')) as u
     where exists (select 1 from profiles x where x.id = u)
    on conflict do nothing;
  end if;

  return v_id;
end $$;

grant execute on function
  save_work_link(bigint, text, text, text, integer, boolean, text, text[], text[], uuid[])
  to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_policies
    where tablename = 'profiles' and policyname = 'write_profiles')      as นโยบายผู้ใช้,
  (select count(*) from pg_policies
    where tablename = 'work_links' and policyname = 'write_work_links')  as นโยบายลิงก์,
  (select count(*) from profiles where role = 'admin'  and is_active)    as เจ้าของระบบ,
  (select count(*) from profiles where role = 'supervisor' and is_active) as แอดมิน,
  (select count(*) from profiles where can_dispatch and is_active)       as ผู้ตรวจสอบ;
