-- =====================================================================
-- BPL SUPPLY — ลิงก์งาน เลือกตามตำแหน่งได้ด้วย
-- รันต่อจาก 053 · ปลอดภัยที่จะรันซ้ำ
--
-- 053 เลือกได้แค่ "แผนกไหน" กับ "ใครบ้าง" ซึ่งยังไม่พอ
-- ของจริงคือบางลิงก์ให้เห็นแค่แอดมิน บางอันแค่ผู้ตรวจสอบ
-- บางอันแค่หน้างาน และบางอันแค่เจ้าของระบบคนเดียว
--
-- ผู้ตรวจสอบไม่ใช่ role ในฐานข้อมูล เป็นธงที่ปักบนคนที่ role เป็นอะไรก็ได้
-- จึงเก็บเป็น "คีย์ตำแหน่ง" 4 ค่าแทนที่จะอ้าง enum user_role ตรง ๆ
--   staff      หน้างาน
--   supervisor แอดมิน
--   admin      เจ้าของระบบ
--   dispatch   ผู้ตรวจสอบ (มาจากธง can_dispatch)
--
-- เจ้าของระบบยังเห็นทุกลิงก์เสมอไม่ว่าตั้งอะไรไว้ เพราะต้องเข้าไปแก้ได้
-- =====================================================================

create table if not exists work_link_roles (
  link_id  bigint not null references work_links (id) on delete cascade,
  role_key text   not null,
  primary key (link_id, role_key)
);

alter table work_link_roles drop constraint if exists work_link_roles_key_chk;
alter table work_link_roles add constraint work_link_roles_key_chk
  check (role_key in ('staff', 'supervisor', 'admin', 'dispatch'));

alter table work_link_roles enable row level security;

drop policy if exists manage_work_link_roles on work_link_roles;
create policy manage_work_link_roles on work_link_roles for all to authenticated
  using (my_role() = 'admin') with check (my_role() = 'admin');


-- ---------------------------------------------------------------------
-- ย้ายลิงก์โหมด managers เดิมมาเป็นการเลือกตำแหน่ง
--
-- ความหมายเท่าเดิมเป๊ะ (แอดมิน + เจ้าของระบบ + ผู้ตรวจสอบ)
-- แต่พอเป็นตำแหน่งแล้วเจ้าของระบบแก้ทีหลังได้ เช่นตัดผู้ตรวจสอบออก
-- ---------------------------------------------------------------------
insert into work_link_roles (link_id, role_key)
select l.id, r.k
  from work_links l
 cross join (values ('supervisor'), ('admin'), ('dispatch')) as r(k)
 where l.audience = 'managers'
on conflict do nothing;

update work_links set audience = 'custom' where audience = 'managers';


-- ---------------------------------------------------------------------
-- ตัวตัดสินว่าเห็นไหมในโหมด custom — เพิ่มเงื่อนไขตำแหน่ง
--
-- สามเงื่อนไขเป็น "หรือ" กัน ใครเข้าข้อใดข้อหนึ่งก็เห็น
-- ตั้งตำแหน่งกับแผนกพร้อมกันจึงหมายถึง "ตำแหน่งนี้ หรือ แผนกนี้"
-- ไม่ใช่ "ตำแหน่งนี้ที่อยู่แผนกนี้" — ถ้าอยากเจาะขนาดนั้นให้เลือกรายคนแทน
-- ---------------------------------------------------------------------
create or replace function my_sees_work_link(p_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from work_link_roles r
     where r.link_id = p_id
       and (
            r.role_key = my_role()::text
         or (r.role_key = 'dispatch' and my_can_dispatch())
       )
  )
  or exists (
    select 1
      from work_link_depts d
     where d.link_id = p_id
       and (
            d.dept_code = 'ALL'
         or 'ALL' = any(my_depts())
         or d.dept_code = any(my_depts())
       )
  )
  or exists (
    select 1 from work_link_users u
     where u.link_id = p_id and u.user_id = auth.uid()
  );
$$;

grant execute on function my_sees_work_link(bigint) to authenticated;


-- ---------------------------------------------------------------------
-- บันทึกลิงก์ — รับรายการตำแหน่งเพิ่มเข้ามา
--
-- ต้องทิ้งตัวเดิมก่อน ไม่งั้นจะมีฟังก์ชันชื่อซ้ำสองตัวคนละจำนวนพารามิเตอร์
-- แล้ว PostgREST จะเลือกไม่ถูกและตอบ 300 กลับมา
-- ---------------------------------------------------------------------
drop function if exists save_work_link(bigint, text, text, text, integer, boolean, text, text[], uuid[]);

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
  if my_role() <> 'admin' then
    raise exception 'เฉพาะเจ้าของระบบเท่านั้นที่แก้ลิงก์งานได้';
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

  -- เลือกเองแต่ไม่ได้เลือกใครเลย = ลิงก์ที่ไม่มีใครเห็น ซึ่งไม่ใช่สิ่งที่ตั้งใจแน่ ๆ
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

  -- เขียนทับทั้งชุด ง่ายกว่าไล่เทียบว่าอันไหนเพิ่มอันไหนลบ
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
  (select count(*) from information_schema.tables
    where table_name = 'work_link_roles')                            as ตาราง_roles,
  (select count(*) from pg_proc where proname = 'save_work_link')    as จำนวนฟังก์ชันบันทึก,
  (select count(*) from work_links where audience = 'managers')      as ลิงก์ที่ยังค้างโหมดเก่า,
  (select count(*) from work_links where audience = 'all')           as ลิงก์ทุกคนเห็น,
  (select count(*) from work_links where audience = 'custom')        as ลิงก์เลือกเอง,
  (select count(*) from work_link_roles)                             as แถวตำแหน่งทั้งหมด;
