-- ---------------------------------------------------------------------
-- 139 · ลิงก์งานที่เป็นของเจ้าของระบบคนเดียว
--
-- เจ้าของระบบสั่งว่า "ในลิงก์งาน ผู้ดูแลระบบจะเห็นหมด ยกเว้นอันที่เจ้าของระบบ
-- เลือกเองว่าจะเห็นเฉพาะเจ้าของระบบ"
--
-- ทำไมของเดิมใช้ไม่ได้
--   นโยบายอ่านเขียนว่า my_role() = 'admin' เห็นทุกอัน
--   ซึ่งตอนที่เขียนไว้ถูก เพราะ role = admin มีคนเดียวคือเจ้าของระบบ
--   แต่ตอนนี้ "ผู้ดูแลระบบ" ใช้ role เดียวกัน จึงเห็นลิงก์ส่วนตัวของเจ้าของไปด้วย
--
-- ทางแก้ · เพิ่มคีย์ผู้ชมตัวใหม่ 'owner' แล้วกันทุกประตูที่แตะลิงก์แบบนั้นได้
--   นโยบายอ่าน      ไม่เห็น
--   นโยบายเขียน     แก้และลบไม่ได้ (กันเดาเลข id)
--   ตารางผู้ชมสามตัว แตะแถวของลิงก์นั้นไม่ได้ และตั้งคีย์ owner เองไม่ได้
--   save_work_link  ปฏิเสธทั้งตอนตั้งคีย์ใหม่ และตอนแก้ลิงก์ที่ติดคีย์อยู่แล้ว
--
-- แก้บั๊กไวลด์การ์ดสองทางในที่นี้ด้วย
--   'ALL' = any(my_depts()) ทำให้คนที่อยู่แผนก ALL เห็นลิงก์ที่จำกัดแผนกทุกอัน
--   เป็นบั๊กตัวเดียวกับที่เจอในป้ายประกาศและในเครื่อง Asset แล้วแก้ไปแล้วทั้งสองที่
--   ความหมายที่ถูกคือ ลิงก์ที่ตั้งแผนก ALL เห็นได้ทุกคน · ไม่ใช่ทางกลับกัน
-- ---------------------------------------------------------------------

/** เจ้าของระบบตัวจริงไหม — ธง is_owner ไม่ใช่ role เพราะผู้ดูแลระบบใช้ role เดียวกัน */
create or replace function my_is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_owner from profiles p where p.id = auth.uid()), false);
$$;

grant execute on function my_is_owner() to authenticated;

/** ลิงก์นี้ถูกตั้งว่าเฉพาะเจ้าของระบบไหม */
create or replace function work_link_owner_only(p_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from work_link_roles r where r.link_id = p_id and r.role_key = 'owner'
  );
$$;

grant execute on function work_link_owner_only(bigint) to authenticated;

alter table work_link_roles drop constraint if exists work_link_roles_key_chk;
alter table work_link_roles add constraint work_link_roles_key_chk
  check (role_key in ('owner', 'staff', 'supervisor', 'admin', 'dispatch'));


-- ---------------------------------------------------------------------
-- ใครเห็นลิงก์ในโหมดเลือกเอง
-- ---------------------------------------------------------------------
create or replace function my_sees_work_link(p_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from work_link_roles r
     where r.link_id = p_id
       and (
            (r.role_key = 'owner' and my_is_owner())
         or (r.role_key = my_role()::text and r.role_key <> 'owner')
         or (r.role_key = 'dispatch' and my_can_dispatch())
       )
  )
  or exists (
    select 1
      from work_link_depts d
     where d.link_id = p_id
       and (d.dept_code = 'ALL' or d.dept_code = any(my_depts()))
  )
  or exists (
    select 1 from work_link_users u
     where u.link_id = p_id and u.user_id = auth.uid()
  );
$$;


-- ---------------------------------------------------------------------
-- นโยบายอ่าน · เจ้าของเห็นทุกอัน คนอื่นไม่เห็นอันที่ติดคีย์ owner เลย
-- ---------------------------------------------------------------------
drop policy if exists read_work_links on work_links;
create policy read_work_links on work_links for select to authenticated
  using (
    my_is_owner()
    or (
      not work_link_owner_only(id)
      and (
        my_role() = 'admin'
        or (
          is_active
          and (
               audience = 'all'
            or (audience = 'managers' and my_can_proxy())
            or (audience = 'custom' and my_sees_work_link(id))
          )
        )
      )
    )
  );

drop policy if exists write_work_links on work_links;
create policy write_work_links on work_links for all to authenticated
  using (
    my_is_owner()
    or (
      not work_link_owner_only(id)
      and (
        my_role() = 'admin'
        or (my_role() = 'supervisor' and (audience = 'all' or my_sees_work_link(id)))
      )
    )
  )
  with check (my_is_owner() or my_role() in ('admin', 'supervisor'));


-- ---------------------------------------------------------------------
-- ตารางผู้ชมสามตัว
--
-- ตัว exists ข้างในวิ่งผ่าน RLS ของ work_links อีกชั้น ซึ่งตอนนี้ซ่อน
-- ลิงก์ของเจ้าของไปแล้ว จึงกันการแตะแถวของลิงก์นั้นให้เองโดยอัตโนมัติ
-- เหลือที่ต้องเขียนเองคือห้ามคนอื่นตั้งคีย์ owner ขึ้นมาใหม่
-- ---------------------------------------------------------------------
drop policy if exists manage_work_link_roles on work_link_roles;
create policy manage_work_link_roles on work_link_roles for all to authenticated
  using (
    my_is_owner()
    or (
      role_key <> 'owner'
      and exists (select 1 from work_links l where l.id = link_id)
      and my_role() in ('admin', 'supervisor')
    )
  )
  with check (
    my_is_owner()
    or (
      role_key <> 'owner'
      and exists (select 1 from work_links l where l.id = link_id)
      and my_role() in ('admin', 'supervisor')
    )
  );

drop policy if exists manage_work_link_depts on work_link_depts;
create policy manage_work_link_depts on work_link_depts for all to authenticated
  using (
    my_is_owner()
    or (exists (select 1 from work_links l where l.id = link_id)
        and my_role() in ('admin', 'supervisor'))
  )
  with check (
    my_is_owner()
    or (exists (select 1 from work_links l where l.id = link_id)
        and my_role() in ('admin', 'supervisor'))
  );

drop policy if exists manage_work_link_users on work_link_users;
create policy manage_work_link_users on work_link_users for all to authenticated
  using (
    my_is_owner()
    or (exists (select 1 from work_links l where l.id = link_id)
        and my_role() in ('admin', 'supervisor'))
  )
  with check (
    my_is_owner()
    or (exists (select 1 from work_links l where l.id = link_id)
        and my_role() in ('admin', 'supervisor'))
  );


-- ---------------------------------------------------------------------
-- บันทึกลิงก์ — เป็น security definer จึงข้าม RLS ทั้งก้อน ต้องกันเองในตัว
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
    raise exception 'เฉพาะผู้ดูแลระบบและแอดมินเท่านั้นที่แก้ลิงก์งานได้';
  end if;

  -- คีย์ owner ตั้งได้คนเดียว · กันคนอื่นสร้างลิงก์ลับในชื่อเจ้าของ
  if not my_is_owner() and 'owner' = any(coalesce(p_roles, '{}')) then
    raise exception 'ตั้งลิงก์ให้เห็นเฉพาะเจ้าของระบบได้เฉพาะเจ้าของระบบเท่านั้น';
  end if;

  -- และห้ามแตะลิงก์ที่ติดคีย์อยู่แล้ว ไม่ว่าจะแก้หรือจะถอดคีย์ออก
  if p_id is not null and not my_is_owner() and work_link_owner_only(p_id) then
    raise exception 'ลิงก์นี้เป็นของเจ้าของระบบ แก้ไม่ได้';
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
     where r in ('owner', 'staff', 'supervisor', 'admin', 'dispatch')
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


select
  (select count(*) from pg_proc where proname = 'my_is_owner')            as f_owner,
  (select count(*) from pg_proc where proname = 'work_link_owner_only')  as f_only,
  (select count(*) from pg_policies
    where tablename = 'work_links' and policyname = 'read_work_links')   as pol_read,
  (select count(*) from work_link_roles where role_key = 'owner')        as owner_links;
