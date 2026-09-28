-- =====================================================================
-- BPL SUPPLY — ลิงก์งาน
-- รันต่อจาก 049 · ปลอดภัยที่จะรันซ้ำ
--
-- ปุ่มสายฟ้าบนหัวแอพ เก็บลิงก์งานที่ต้องเปิดบ่อย
-- เจ้าของระบบเป็นคนใส่และแก้จากหน้าเว็บ ที่เหลือแค่กดเปิด
--
-- เห็นปุ่ม: แอดมิน เจ้าของระบบ และผู้ตรวจสอบ
-- แก้ลิงก์: เจ้าของระบบคนเดียว
--
-- ทำไมต้องคุมสิทธิ์ที่ฐานข้อมูล ไม่ใช่แค่ซ่อนปุ่ม
-- เพราะลิงก์บางอันอาจเป็นเอกสารภายในที่หน้างานไม่ควรเห็น
-- ซ่อนปุ่มอย่างเดียวคือใครเปิดหน้าเว็บดูก็ยังอ่านได้
-- =====================================================================

create table if not exists work_links (
  id         bigserial primary key,
  title      text not null,
  url        text not null,
  note       text,
  sort_no    integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists work_links_order_idx on work_links (sort_no, id);

alter table work_links enable row level security;

-- อ่านได้: แอดมิน เจ้าของระบบ ผู้ตรวจสอบ
drop policy if exists read_work_links on work_links;
create policy read_work_links on work_links for select to authenticated
  using (my_can_proxy());

-- แก้ได้: เจ้าของระบบคนเดียว
drop policy if exists write_work_links on work_links;
create policy write_work_links on work_links for all to authenticated
  using (my_role() = 'admin')
  with check (my_role() = 'admin');


-- ---------------------------------------------------------------------
-- บันทึกเวลาแก้ล่าสุด ไว้ดูว่าลิงก์ไหนเก่าแล้ว
-- ---------------------------------------------------------------------
create or replace function touch_work_link() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists work_links_touch on work_links;
create trigger work_links_touch before update on work_links
  for each row execute function touch_work_link();


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select 'ตาราง work_links' as สิ่งที่ตรวจ, count(*)::text as ผล
  from information_schema.tables where table_name = 'work_links'
union all select 'จำนวนลิงก์ตอนนี้', count(*)::text from work_links;
