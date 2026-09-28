-- =====================================================================
-- BPL SUPPLY — ลิงก์งาน เลือกได้ว่าใครเห็น
-- รันต่อจาก 052 · ปลอดภัยที่จะรันซ้ำ
--
-- เดิมลิงก์งานเห็นได้เฉพาะแอดมินกับผู้ตรวจสอบ ปุ่มสายฟ้าจึงซ่อนจากหน้างาน
-- ตอนนี้เปิดปุ่มให้ทุกคนเห็น แต่ "เห็นลิงก์ไหน" ต้องคุมเป็นรายลิงก์
-- ไม่งั้นเอกสารภายในจะหลุดไปถึงหน้างานทันทีที่เปิดปุ่ม
--
-- สามโหมดต่อหนึ่งลิงก์
--   all      ทุกคนในระบบเห็น
--   managers แอดมิน เจ้าของระบบ ผู้ตรวจสอบ (เหมือนเดิม — เป็นค่าตั้งต้น)
--   custom   เลือกเองว่าแผนกไหนบ้าง และ/หรือ ใครบ้างเป็นรายคน
--
-- ทำไมใช้ตารางเชื่อมแทน array ของรหัสแผนก
--   เจ้าของระบบเปลี่ยนชื่อแผนกได้อิสระ ถ้าเก็บเป็น array รหัสจะค้างเป็นของเก่า
--   แล้วสิทธิ์จะเพี้ยนเงียบ ๆ โดยไม่มีอะไรฟ้อง
--   ตารางเชื่อมมี foreign key + on update cascade รหัสจึงตามไปเอง
-- =====================================================================

-- ── โหมดผู้ชมของแต่ละลิงก์ ───────────────────────────────────────────
alter table work_links
  add column if not exists audience text not null default 'managers';

-- ของเดิมทั้งหมดเป็น managers อยู่แล้วจากค่าตั้งต้น พฤติกรรมเก่าจึงไม่เปลี่ยน
alter table work_links drop constraint if exists work_links_audience_chk;
alter table work_links add constraint work_links_audience_chk
  check (audience in ('all', 'managers', 'custom'));


-- ── แผนกที่เห็นลิงก์นี้ ──────────────────────────────────────────────
create table if not exists work_link_depts (
  link_id   bigint not null references work_links (id) on delete cascade,
  dept_code text   not null references departments (code) on update cascade on delete cascade,
  primary key (link_id, dept_code)
);

-- ── คนที่เห็นลิงก์นี้เป็นรายคน ───────────────────────────────────────
create table if not exists work_link_users (
  link_id bigint not null references work_links (id) on delete cascade,
  user_id uuid   not null references profiles (id) on delete cascade,
  primary key (link_id, user_id)
);

create index if not exists work_link_users_user_idx on work_link_users (user_id);


-- ---------------------------------------------------------------------
-- ตัวตัดสินว่าเห็นไหมในโหมด custom
--
-- ต้องเป็น security definer เพราะถูกเรียกจาก policy ของ work_links
-- ถ้าอ่านตารางเชื่อมตรง ๆ ใน policy มันจะไปติด RLS ของตารางเชื่อมอีกชั้น
-- แล้วหน้างานจะไม่เห็นอะไรเลยทั้งที่ตั้งสิทธิ์ให้แล้ว
-- ---------------------------------------------------------------------
create or replace function my_sees_work_link(p_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from work_link_depts d
     where d.link_id = p_id
       and (
            d.dept_code = 'ALL'          -- ตั้งไว้ว่าทุกแผนก
         or 'ALL' = any(my_depts())      -- คนที่สังกัด "ทุกแผนก"
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
-- สิทธิ์อ่าน
--
-- เจ้าของระบบเห็นทุกอันรวมที่ปิดอยู่ เพราะต้องจัดการในหน้าเว็บ
-- ที่เหลือเห็นเฉพาะที่เปิดใช้และตรงกับโหมดผู้ชม
-- ---------------------------------------------------------------------
drop policy if exists read_work_links on work_links;
create policy read_work_links on work_links for select to authenticated
  using (
    my_role() = 'admin'
    or (
      is_active
      and (
           audience = 'all'
        or (audience = 'managers' and my_can_proxy())
        or (audience = 'custom' and my_sees_work_link(id))
      )
    )
  );

-- ตารางเชื่อมเปิดให้เจ้าของระบบอย่างเดียว คนอื่นไม่ต้องอ่านเอง
-- เพราะการกรองเกิดที่ policy ของ work_links ไปแล้ว
alter table work_link_depts enable row level security;
alter table work_link_users enable row level security;

drop policy if exists manage_work_link_depts on work_link_depts;
create policy manage_work_link_depts on work_link_depts for all to authenticated
  using (my_role() = 'admin') with check (my_role() = 'admin');

drop policy if exists manage_work_link_users on work_link_users;
create policy manage_work_link_users on work_link_users for all to authenticated
  using (my_role() = 'admin') with check (my_role() = 'admin');


-- ---------------------------------------------------------------------
-- บันทึกลิงก์พร้อมผู้ชมในครั้งเดียว
--
-- ถ้าแยกเป็นหลายคำสั่งจากฝั่งหน้าเว็บ เน็ตหลุดกลางคันจะได้ลิงก์ที่
-- ตั้งโหมด custom ไว้แต่ไม่มีใครอยู่ในรายชื่อ = ไม่มีใครเห็นเลย
-- ---------------------------------------------------------------------
create or replace function save_work_link(
  p_id        bigint,
  p_title     text,
  p_url       text,
  p_note      text,
  p_sort_no   integer,
  p_is_active boolean,
  p_audience  text,
  p_depts     text[],
  p_users     uuid[]
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if my_role() <> 'admin' then
    raise exception 'เฉพาะเจ้าของระบบเท่านั้นที่แก้ลิงก์งานได้';
  end if;

  if coalesce(btrim(p_title), '') = '' or coalesce(btrim(p_url), '') = '' then
    raise exception 'ต้องใส่ทั้งชื่อและลิงก์';
  end if;

  if p_audience not in ('all', 'managers', 'custom') then
    raise exception 'โหมดผู้ชมไม่ถูกต้อง';
  end if;

  -- เลือกเองแต่ไม่ได้เลือกใครเลย = ลิงก์ที่ไม่มีใครเห็น ซึ่งไม่ใช่สิ่งที่ตั้งใจแน่ ๆ
  if p_audience = 'custom'
     and coalesce(array_length(p_depts, 1), 0) = 0
     and coalesce(array_length(p_users, 1), 0) = 0 then
    raise exception 'เลือกเองต้องเลือกอย่างน้อยหนึ่งแผนกหรือหนึ่งคน';
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

  -- เขียนทับรายชื่อทั้งชุด ง่ายกว่าไล่เทียบว่าอันไหนเพิ่มอันไหนลบ
  delete from work_link_depts where link_id = v_id;
  delete from work_link_users where link_id = v_id;

  if p_audience = 'custom' then
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

grant execute on function save_work_link(bigint, text, text, text, integer, boolean, text, text[], uuid[])
  to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select 'คอลัมน์ audience' as สิ่งที่ตรวจ,
       count(*)::text as ผล
  from information_schema.columns
 where table_name = 'work_links' and column_name = 'audience'
union all
select 'ตาราง work_link_depts', count(*)::text
  from information_schema.tables where table_name = 'work_link_depts'
union all
select 'ตาราง work_link_users', count(*)::text
  from information_schema.tables where table_name = 'work_link_users'
union all
select 'ฟังก์ชัน save_work_link', count(*)::text
  from pg_proc where proname = 'save_work_link'
union all
select 'ลิงก์ที่เป็นโหมด managers อยู่', count(*)::text
  from work_links where audience = 'managers';
