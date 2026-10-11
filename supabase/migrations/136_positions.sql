-- =====================================================================
-- BPL SUPPLY — ตำแหน่งงาน
-- รันต่อจาก 135 · ปลอดภัยที่จะรันซ้ำ
--
-- ของเดิมระบบรู้จักคนแค่สองแกน คือ "แผนก" กับ "สิทธิ์ในระบบ"
-- ซึ่งไม่พอสำหรับการเรียกประชุม เพราะวงที่เรียกซ้ำทุกรอบคือวงตามตำแหน่ง
-- เช่นหัวหน้ากะทั้งฮับ ซึ่งกระจายอยู่หลายแผนกและไม่ใช่สิทธิ์ในระบบ
--
-- แยกขาดจาก role เด็ดขาด และจะแยกตลอดไป
--   role          = แอพยอมให้เขากดอะไร
--   position_code = องค์กรเรียกเขาว่าอะไร
-- วันที่เลื่อนใครเป็นหัวหน้ากะแต่ยังไม่อยากให้เขาแก้สต็อกได้ ต้องทำได้ทันที
-- ถ้าผูกสองอย่างนี้เข้าด้วยกัน วันนั้นจะต้องเลือกระหว่างไม่เลื่อนตำแหน่ง
-- กับให้สิทธิ์เกิน ซึ่งทั้งสองทางผิดทั้งคู่
--
-- รหัสตั้งเป็นตัวอักษรอ่านออกตั้งแต่แรก ไม่ปล่อยให้ระบบสุ่มให้
-- เพราะตอนทำแผนกปล่อยให้สุ่ม แล้ววันหนึ่งหน้าจอก็พ่น D267C7A ใส่หน้าคนหน้างาน
-- ถึงจะแก้ด้วยพจนานุกรมชื่อไปแล้ว แต่เริ่มต้นให้ถูกย่อมดีกว่า
--
-- รายการที่ใส่ไว้เป็นร่างตั้งต้น แก้ชื่อ เพิ่ม หรือปิดใช้งานได้หมดจากหลังบ้าน
-- =====================================================================

create table if not exists positions (
  code      text primary key,
  name      text not null,
  sort_no   integer not null default 0,
  is_active boolean not null default true
);

comment on table positions is
  'ตำแหน่งงานตามที่องค์กรเรียก · คนละเรื่องกับ role ซึ่งเป็นสิทธิ์ในระบบ';

-- ไม่ใส่รายการตั้งต้น · เจ้าของระบบพิมพ์ชื่อตำแหน่งเองจากดรอปดาวน์ในหน้าผู้ใช้
-- ชื่อตำแหน่งเป็นคำขององค์กร เดาให้ก่อนมีแต่จะต้องตามลบทีหลัง

alter table positions enable row level security;

drop policy if exists read_positions on positions;
create policy read_positions on positions for select to authenticated using (true);

drop policy if exists write_positions on positions;
create policy write_positions on positions for all to authenticated
  using (my_role() in ('supervisor', 'admin'))
  with check (my_role() in ('supervisor', 'admin'));

grant select, insert, update, delete on positions to authenticated;


-- ---------------------------------------------------------------------
-- คนนี้ตำแหน่งอะไร
--
-- ว่างได้ · 92 คนไม่มีทางกรอกครบในวันเดียว และ "ยังไม่ได้กรอก"
-- ต้องแยกออกจาก "ไม่มีตำแหน่ง" ให้ได้ ไม่งั้นจะไม่รู้ว่าตามครบหรือยัง
-- ---------------------------------------------------------------------
alter table profiles
  add column if not exists position_code text references positions (code);

comment on column profiles.position_code is
  'ตำแหน่งงาน · ว่าง = ยังไม่ได้ตั้ง ไม่ใช่ไม่มีตำแหน่ง';

create index if not exists profiles_position_idx on profiles (position_code) where is_active;

create unique index if not exists positions_name_idx on positions (lower(btrim(name)));


-- ---------------------------------------------------------------------
-- เพิ่มตำแหน่งใหม่ · ออกรหัสให้เองแต่ยังอ่านออก
--
-- ชื่อตำแหน่งเป็นภาษาไทย แปลงเป็นรหัสอังกฤษอัตโนมัติไม่ได้
-- จึงใช้ POS ตามด้วยเลขเรียง ซึ่งอ่านออกพอที่จะรู้ว่าคืออะไรเวลาเห็นในฐานข้อมูล
-- และหน้าจอทุกที่แปลเป็นชื่อให้อยู่แล้ว
-- ---------------------------------------------------------------------
create or replace function create_position(p_name text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_code text;
  v_n    integer;
begin
  if my_role() not in ('supervisor', 'admin') then
    raise exception 'ไม่มีสิทธิ์เพิ่มตำแหน่ง';
  end if;
  if v_name = '' then
    raise exception 'ยังไม่ได้ตั้งชื่อตำแหน่ง';
  end if;
  select code into v_code from positions where lower(btrim(name)) = lower(v_name);
  if v_code is not null then
    return v_code;
  end if;

  select coalesce(max(sort_no), 0) + 1 into v_n from positions;
  v_code := 'POS' || lpad(v_n::text, 2, '0');
  while exists (select 1 from positions where code = v_code) loop
    v_n := v_n + 1;
    v_code := 'POS' || lpad(v_n::text, 2, '0');
  end loop;

  insert into positions (code, name, sort_no) values (v_code, v_name, v_n);
  return v_code;
end $$;

grant execute on function create_position(text) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from positions)                                     as "ตำแหน่งที่มี",
  (select count(*) from information_schema.columns
    where table_name = 'profiles' and column_name = 'position_code')   as "ช่องในโปรไฟล์",
  (select count(*) from pg_proc where proname = 'create_position')     as "ฟังก์ชันเพิ่มตำแหน่ง",
  (select count(*) from profiles where is_active and position_code is null)
                                                                       as "ยังไม่ได้ตั้งตำแหน่ง";
