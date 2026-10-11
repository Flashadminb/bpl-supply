-- =====================================================================
-- BPL SUPPLY — กลุ่มรายชื่อที่บันทึกไว้
-- รันต่อจาก 131 · ปลอดภัยที่จะรันซ้ำ
--
-- นัดประชุมบางวงเป็นวงเดิมทุกรอบ เช่นหัวหน้ากะทั้งฮับ หรือทีม OUT ทั้งกอง
-- ของเดิมต้องไล่ติ๊กใหม่ทุกครั้ง ยี่สิบกว่าชื่อจากรายชื่อเก้าสิบคน
-- ซึ่งไม่ได้แค่เสียเวลา แต่พลาดคนสองคนทุกครั้งโดยไม่มีใครรู้
-- จนวันประชุมแล้วมีคนไม่รู้เรื่อง และระบบก็นับเขาว่าไม่ต้องเข้า
--
-- เก็บเป็น array ไม่ใช่ตารางลูก เพราะกลุ่มหนึ่งคืออ่านทีเดียวใช้ทีเดียว
-- ไม่มีใครถามว่า "คนนี้อยู่กลุ่มไหนบ้าง" ตารางลูกจึงจ่ายค่า join ฟรี ๆ
-- ผลข้างเคียงคือไม่มี FK ตามลบให้ · คนที่ถูกปิดบัญชีจะยังค้างใน array
-- ฝั่งหน้าจอกรองเฉพาะคนที่ยังใช้งานอยู่ตอนกดใช้กลุ่ม จึงไม่โผล่เข้ารายชื่อจริง
--
-- ชื่อกลุ่มห้ามซ้ำ เทียบแบบไม่สนตัวพิมพ์และช่องว่างหัวท้าย
-- บันทึกชื่อเดิมอีกครั้ง = ทับกลุ่มเดิม ไม่ใช่ได้กลุ่มชื่อซ้ำสองกลุ่ม
-- เพราะสองกลุ่มชื่อเหมือนกันแต่คนละรายชื่อ คือกับดักที่รอวันกดผิด
-- =====================================================================

create table if not exists audience_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  dept_codes text[] not null default '{}',
  user_ids   uuid[] not null default '{}',
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz
);

comment on table audience_groups is
  'กลุ่มรายชื่อที่บันทึกไว้ใช้ซ้ำ · ใช้ได้ทั้งนัดประชุมและป้ายประกาศ';
comment on column audience_groups.dept_codes is
  'แผนกที่กลุ่มนี้เลือกไว้ · ตอนกดใช้จะรวมกับที่เลือกอยู่แบบ "หรือ" เหมือนตอนติ๊กมือ';
comment on column audience_groups.user_ids is
  'รายคนที่กลุ่มนี้เลือกไว้ · ไม่มี FK ตามลบ หน้าจอกรองคนที่ปิดบัญชีออกตอนกดใช้';

create unique index if not exists audience_groups_name_idx
  on audience_groups (lower(btrim(name)));


-- ---------------------------------------------------------------------
-- สิทธิ์
--
-- อ่านได้ทุกคนที่เข้าหน้าหลังบ้านได้ รวมผู้ตรวจสอบ เพราะเขาก็นัดประชุมได้
-- สร้างกับแก้ได้ตั้งแต่หัวหน้างานขึ้นไป
--
-- ลบได้เฉพาะเจ้าของระบบ หรือคนที่สร้างกลุ่มนั้นเอง
-- ตามกติกาเดิมว่าหัวหน้างานลบของคนอื่นไม่ได้
-- แต่คนที่เพิ่งพิมพ์ชื่อผิดเมื่อกี้ต้องลบของตัวเองได้ ไม่งั้นรายการจะรกขึ้นเรื่อย ๆ
-- ---------------------------------------------------------------------
alter table audience_groups enable row level security;

drop policy if exists read_audience_groups on audience_groups;
create policy read_audience_groups on audience_groups for select to authenticated
  using (my_role() in ('supervisor', 'admin') or my_can_dispatch());

drop policy if exists add_audience_groups on audience_groups;
create policy add_audience_groups on audience_groups for insert to authenticated
  with check (my_role() in ('supervisor', 'admin'));

drop policy if exists edit_audience_groups on audience_groups;
create policy edit_audience_groups on audience_groups for update to authenticated
  using (my_role() in ('supervisor', 'admin'))
  with check (my_role() in ('supervisor', 'admin'));

drop policy if exists drop_audience_groups on audience_groups;
create policy drop_audience_groups on audience_groups for delete to authenticated
  using (my_role() = 'admin' or created_by = auth.uid());

grant select, insert, update, delete on audience_groups to authenticated;


-- ---------------------------------------------------------------------
-- บันทึกกลุ่ม
--
-- เขียนเป็น RPC ตัวเดียวแทนที่จะให้ฝั่งหน้าจอ upsert เอง
-- เพราะต้องตัดสินใจสองอย่างที่ฝั่งหน้าจอทำพลาดได้ง่าย
--   ① ชื่อซ้ำ (ไม่สนตัวพิมพ์) ให้ทับกลุ่มเดิม
--   ② จำว่าใครสร้างและใครแก้ล่าสุด โดยไม่ให้ฝั่งหน้าจอส่ง uuid ของคนอื่นมาได้
-- ---------------------------------------------------------------------
create or replace function audience_group_save(
  p_name  text,
  p_depts text[],
  p_users uuid[],
  p_id    uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_id   uuid;
begin
  if my_role() not in ('supervisor', 'admin') then
    raise exception 'ไม่มีสิทธิ์บันทึกกลุ่มรายชื่อ';
  end if;
  if v_name = '' then
    raise exception 'ยังไม่ได้ตั้งชื่อกลุ่ม';
  end if;
  if coalesce(array_length(p_depts, 1), 0) = 0
     and coalesce(array_length(p_users, 1), 0) = 0 then
    raise exception 'กลุ่มว่างเปล่า ยังไม่ได้เลือกแผนกหรือรายชื่อเลย';
  end if;

  -- แก้กลุ่มที่เล็งไว้ · ส่ง id มาแปลว่าเปลี่ยนชื่อได้ด้วย
  if p_id is not null then
    update audience_groups
       set name       = v_name,
           dept_codes = coalesce(p_depts, '{}'),
           user_ids   = coalesce(p_users, '{}'),
           updated_by = auth.uid(),
           updated_at = now()
     where id = p_id
     returning id into v_id;
    if v_id is null then
      raise exception 'ไม่พบกลุ่มที่จะแก้';
    end if;
    return v_id;
  end if;

  -- ไม่ได้ส่ง id มา · ชื่อซ้ำให้ทับ ชื่อใหม่ให้สร้าง
  select id into v_id from audience_groups
   where lower(btrim(name)) = lower(v_name);

  if v_id is null then
    insert into audience_groups (name, dept_codes, user_ids, created_by)
    values (v_name, coalesce(p_depts, '{}'), coalesce(p_users, '{}'), auth.uid())
    returning id into v_id;
  else
    update audience_groups
       set dept_codes = coalesce(p_depts, '{}'),
           user_ids   = coalesce(p_users, '{}'),
           updated_by = auth.uid(),
           updated_at = now()
     where id = v_id;
  end if;

  return v_id;
end;
$$;

comment on function audience_group_save(text, text[], uuid[], uuid) is
  'บันทึกกลุ่มรายชื่อ · ไม่ส่ง id มาแล้วชื่อซ้ำ = ทับกลุ่มเดิม';

grant execute on function audience_group_save(text, text[], uuid[], uuid) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_name = 'audience_groups')                   as "ตารางกลุ่ม",
  (select count(*) from pg_indexes
    where indexname = 'audience_groups_name_idx')           as "กันชื่อซ้ำ",
  (select count(*) from pg_policies
    where tablename = 'audience_groups')                    as "จำนวน policy",
  (select count(*) from pg_proc
    where proname = 'audience_group_save')                  as "ฟังก์ชันบันทึก",
  (select count(*) from audience_groups)                    as "กลุ่มที่มีอยู่";
