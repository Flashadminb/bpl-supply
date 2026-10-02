-- =====================================================================
-- BPL SUPPLY — บัตรเบรค OS · โครงฐานข้อมูลและสิทธิ์
-- รันต่อจาก 079 · ปลอดภัยที่จะรันซ้ำ
--
-- ปัญหาหน้างาน
--   หัวหน้างานคุมเวลาพักย่อยและเข้าห้องน้ำของ OS ด้วยใบเซ็นมือ
--   นับเวลาไม่ได้ ตามไม่ได้ว่าใครปล่อยใคร และปลอมใบง่าย
--
-- หลักคิดของระบบนี้ มีอยู่ข้อเดียว
--   **อำนาจอยู่ที่ระบบ ไม่ได้อยู่ที่บัตร**
--   บัตรเป็นแค่ของที่ถือไว้ให้ รปภ จับคู่กับแถวบนจอ
--   ใบไหนไม่มีแถวเปิดอยู่ = ไม่ได้รับอนุญาต ไม่ว่าบัตรจะสวยแค่ไหน
--   QR บนบัตรจึงเก็บรหัสบัตรตรง ๆ ไม่ใช่ความลับ ปลอมมาก็ไปจบที่ด่านเดียวกัน
--
-- สิ่งที่ระบบนี้ **ไม่** เก็บ
--   ไม่มีทะเบียน OS ไม่มีชื่อ ไม่มีรูปประจำตัว ไม่มีรหัสพนักงานของ OS
--   บัตรผูกกับ "แผนก" ไม่ได้ผูกกับคน · ชื่อเล่นเป็นข้อความอิสระ ไม่บังคับ
--   เป็นข้อตกลงกับเจ้าของระบบ อย่าเพิ่มคอลัมน์ที่ทำให้กลายเป็นทะเบียนคน
--
-- ไฟล์นี้ทำเฉพาะโครงกับสิทธิ์ · ตัวสั่งงานอยู่ใน 081
-- =====================================================================


-- ---------------------------------------------------------------------
-- สิทธิ์ — ธงรายคน เปิดปิดได้ในหน้า "สิทธิ์เข้าถึง"
--
-- ตั้งใจไม่ backfill ให้ใครเลย ต่างจาก 078
-- เพราะนี่เป็นของใหม่ ยังไม่มีใครเคยมีสิทธิ์อยู่เดิมให้ต้องรักษาไว้
-- เจ้าของระบบขอเองว่าจะเปิดให้ทีละคน
--
-- เจ้าของระบบไม่ต้องพึ่งธง กันล็อกตัวเองออกจากของที่ตัวเองต้องตั้งค่า
-- ---------------------------------------------------------------------
alter table profiles add column if not exists can_break_issue boolean not null default false;
alter table profiles add column if not exists can_break_guard boolean not null default false;

comment on column profiles.can_break_issue is 'หัวหน้างาน — ปล่อยบัตรเบรคให้ OS ได้';
comment on column profiles.can_break_guard is 'รปภ — สแกนบัตรขาออก/ขากลับได้';

create or replace function my_can_break_issue() returns boolean
language sql stable security definer set search_path = public as $$
  select my_role() = 'admin'
      or coalesce((select p.can_break_issue from profiles p where p.id = auth.uid()), false);
$$;

create or replace function my_can_break_guard() returns boolean
language sql stable security definer set search_path = public as $$
  select my_role() = 'admin'
      or coalesce((select p.can_break_guard from profiles p where p.id = auth.uid()), false);
$$;

grant execute on function my_can_break_issue() to authenticated;
grant execute on function my_can_break_guard() to authenticated;


-- ---------------------------------------------------------------------
-- กลุ่มบัตร = แผนก
--
-- max_open คือเพดานจำนวนใบที่กลุ่มนี้ปล่อยพร้อมกันได้
-- เจ้าของระบบขอไว้เป็นเบรกมือ เพราะจิ้มปล่อยทีละหลายใบมันง่ายเกินไป
-- ตั้ง 0 = ไม่จำกัด
-- ---------------------------------------------------------------------
create table if not exists break_groups (
  code       text primary key,
  name       text,
  max_open   integer not null default 3 check (max_open >= 0),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table break_groups is 'แผนกที่ถือบัตรเบรค · max_open = เพดานใบที่ปล่อยพร้อมกันได้ (0 = ไม่จำกัด)';


-- ---------------------------------------------------------------------
-- ตัวบัตร
--
-- code เป็นรหัสที่เจ้าของพิมพ์เอง ตัวอักษรหรือตัวเลขก็ได้ เช่น OUT4-01
-- เป็นทั้งคีย์ เป็นทั้งสิ่งที่พิมพ์ลงบัตร และเป็นทั้งเนื้อใน QR
-- ไม่มี token ลับ และไม่มีรอบเปลี่ยน QR เพราะความลับของบัตรไม่ได้ช่วยอะไร
-- ---------------------------------------------------------------------
create table if not exists break_cards (
  code       text primary key,
  group_code text not null references break_groups (code) on delete cascade,
  active     boolean not null default true,
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists break_cards_group_idx on break_cards (group_code);


-- ---------------------------------------------------------------------
-- ใครปล่อยบัตรของกลุ่มไหนได้
--
-- แยกจากธง can_break_issue คนละชั้น
--   ธง   = มีสิทธิ์ปล่อยบัตรไหม
--   ตาราง = ปล่อยของแผนกไหนได้บ้าง
-- ไม่มีแถวในนี้เลย = ไม่เห็นบัตรสักใบ ถึงจะเปิดธงไว้ก็ตาม
-- ---------------------------------------------------------------------
create table if not exists break_group_users (
  group_code text not null references break_groups (code) on delete cascade,
  user_id    uuid not null references profiles (id) on delete cascade,
  added_by   uuid references profiles (id),
  created_at timestamptz not null default now(),
  primary key (group_code, user_id)
);

create index if not exists break_group_users_user_idx on break_group_users (user_id);


-- ---------------------------------------------------------------------
-- เหตุผล + นาทีเริ่มต้น
--
-- นาทีในนี้คือ **เวลาไปกลับรวม** ไม่ใช่เวลาเบรคสุทธิ
-- เพราะเวลาเริ่มเดินตั้งแต่หัวหน้ากดยื่นบัตร ไม่ใช่ตอนถึง รปภ
-- หัวหน้าจึงต้องเผื่อเวลาเดินไว้ในตัวเลขนี้ — ป้ายในแอปเขียนไว้ชัดแล้ว
-- ---------------------------------------------------------------------
create table if not exists break_reasons (
  code            text primary key,
  label           text not null,
  default_minutes integer not null check (default_minutes between 1 and 120),
  sort            integer not null default 0,
  active          boolean not null default true
);

insert into break_reasons (code, label, default_minutes, sort) values
  ('toilet',    'เข้าห้องน้ำ',  6, 1),
  ('short',     'เบรคย่อย',    10, 2),
  ('emergency', 'ฉุกเฉิน',     15, 3)
on conflict (code) do nothing;


-- ---------------------------------------------------------------------
-- ช่วงห้ามเบรค
--
-- เก็บเป็นนาทีนับจากเที่ยงคืน **เวลาไทย** ไม่ใช่ UTC
-- ช่วงที่ข้ามเที่ยงคืน (เช่น 23:40–00:20) เก็บ start > end แล้วเช็คแบบ or
-- กะดึกของฮับนี้คร่อมเที่ยงคืนอยู่แล้ว ถ้าไม่รองรับจะตั้งช่วงรถเข้าไม่ได้เลย
--
-- ห้ามแบบไม่ปิดตาย — ปล่อยได้ถ้าฉุกเฉิน แต่ต้องพิมพ์เหตุผล
-- แล้วคนที่เจ้าของระบบเลือกไว้จะได้แจ้งเตือนทันที
-- ---------------------------------------------------------------------
create table if not exists break_bans (
  id         bigserial primary key,
  start_min  integer not null check (start_min between 0 and 1439),
  end_min    integer not null check (end_min   between 0 and 1439),
  note       text,
  active     boolean not null default true,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

-- คืนช่วงห้ามที่ครอบเวลาตอนนี้อยู่ · ไม่มีก็คืน null
create or replace function break_ban_now() returns break_bans
language sql stable security definer set search_path = public as $$
  select b.*
    from break_bans b,
         lateral (
           select (extract(hour from (now() at time zone 'Asia/Bangkok')) * 60
                 + extract(minute from (now() at time zone 'Asia/Bangkok')))::int as m
         ) t
   where b.active
     and case
           when b.start_min <= b.end_min then t.m >= b.start_min and t.m < b.end_min
           -- ช่วงที่ข้ามเที่ยงคืน
           else t.m >= b.start_min or t.m < b.end_min
         end
   order by b.id
   limit 1;
$$;

grant execute on function break_ban_now() to authenticated;


-- ---------------------------------------------------------------------
-- ใครได้แจ้งเตือนเรื่องเบรค
--
-- ใช้กับสองเรื่อง — ปล่อยในช่วงห้าม และ รปภ แจ้งคนเข้าไม่ครบ
-- ผู้ตรวจสอบได้รับเสมอโดยไม่ต้องอยู่ในตารางนี้ (ดู 081)
-- ตารางนี้ไว้เพิ่มคนนอกเหนือจากนั้น
-- ---------------------------------------------------------------------
create table if not exists break_alert_subs (
  user_id    uuid primary key references profiles (id) on delete cascade,
  added_by   uuid references profiles (id),
  created_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- ใบที่ปล่อยจริง
--
-- เวลาสามจุดที่ต้องแยกกันให้ได้
--   issued_at   หัวหน้ากดยื่นบัตร  ← นาฬิกาเริ่มเดินตรงนี้
--   gate_out_at รปภ สแกนขาออก
--   closed_at   รปภ สแกนรับกลับ
-- เวลาเดิน = gate_out_at - issued_at   ต่างกันตามระยะทางของแต่ละแผนก
-- เวลาข้างนอก = closed_at - gate_out_at ← อันนี้เทียบข้ามแผนกได้
-- ถ้าเก็บแค่สองจุด เวลาเดินจะปนอยู่ในเวลาอู้ แล้วเทียบกันไม่ได้เลย
--
-- people  จำนวนคนที่ใช้ใบนี้ สูงสุด 5 — เจ้าของระบบเคาะเอง
-- **ไม่มีรับกลับทีละส่วน** ออกไป 3 ต้องกลับ 3 รปภ นับเอง
-- ถ้ากลับไม่ครบ รปภ กดรับพร้อมแจ้งปัญหา ซึ่งปิดใบและยิงแจ้งเตือนทันที
--
-- reason_label เก็บสำเนาไว้ ไม่ได้ join เอาตอนอ่าน
-- เพราะประวัติต้องอ่านได้เหมือนเดิมแม้เจ้าของจะแก้หรือลบเหตุผลทีหลัง
-- ---------------------------------------------------------------------
create sequence if not exists break_pass_seq;

create table if not exists break_passes (
  id              bigserial primary key,
  ref_no          text not null unique,

  card_code       text not null references break_cards (code) on delete restrict,
  group_code      text not null,

  reason_code     text not null,
  reason_label    text not null,
  people          integer not null check (people between 1 and 5),
  minutes         integer not null check (minutes between 1 and 120),
  nickname        text,

  issued_by       uuid not null references profiles (id),
  issued_at       timestamptz not null default now(),
  due_at          timestamptz not null,

  gate_out_at     timestamptz,
  gate_out_by     uuid references profiles (id),
  gate_out_people integer,

  closed_at       timestamptz,
  closed_by       uuid references profiles (id),
  close_kind      text check (close_kind in ('guard', 'problem', 'supervisor', 'admin')),
  returned_people integer,

  problem_code    text,
  problem_note    text,

  in_ban          boolean not null default false,
  ban_reason      text,

  -- ส่งเข้าชีตแล้วเมื่อไหร่ · ล้างของเก่าดูจากช่องนี้ (ดู 082)
  exported_at     timestamptz,
  export_tab      text
);

-- ใบเปิดได้ใบเดียวต่อบัตร — กันปล่อยซ้ำที่ชั้นฐานข้อมูล ไม่ใช่แค่ในแอป
create unique index if not exists break_passes_open_card
  on break_passes (card_code) where closed_at is null;

create index if not exists break_passes_open_idx  on break_passes (issued_at desc) where closed_at is null;
create index if not exists break_passes_group_idx on break_passes (group_code, issued_at desc);
create index if not exists break_passes_issuer_idx on break_passes (issued_by, issued_at desc);
-- ใช้ตอนหาแถวที่ยังไม่ได้ส่งชีต
create index if not exists break_passes_export_idx on break_passes (closed_at) where exported_at is null;


-- ---------------------------------------------------------------------
-- รูป
--
-- phase 'issue'  หัวหน้าถ่ายตอนปล่อย บังคับอย่างน้อย 1 ใบ กี่ใบก็ได้
-- phase 'return' รปภ ถ่ายตอนแจ้งปัญหา บังคับ 1 ใบ
-- หลังบ้านเอาสองฝั่งมาเรียงเทียบกัน เห็นเองว่าใครหายไปจากกลุ่ม
--
-- ตัวไฟล์อยู่บน Drive คนละโฟลเดอร์กับหลักฐานซัพพลาย ในนี้เก็บแค่ลิงก์
-- ลิงก์ต้องถูกส่งเข้าชีตก่อนจะล้างแถวทิ้ง ไม่งั้นรูปกำพร้าหาไม่เจออีกเลย
-- ---------------------------------------------------------------------
create table if not exists break_photos (
  id         bigserial primary key,
  pass_id    bigint not null references break_passes (id) on delete cascade,
  phase      text not null check (phase in ('issue', 'return')),
  file_id    text not null,
  web_link   text not null,
  bytes      integer,
  taken_by   uuid not null references profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists break_photos_pass_idx on break_photos (pass_id, phase);


-- =====================================================================
-- RLS — ปิดที่ฐานข้อมูล ไม่ใช่แค่ซ่อนปุ่ม
-- =====================================================================

alter table break_groups      enable row level security;
alter table break_cards       enable row level security;
alter table break_group_users enable row level security;
alter table break_reasons     enable row level security;
alter table break_bans        enable row level security;
alter table break_alert_subs  enable row level security;
alter table break_passes      enable row level security;
alter table break_photos      enable row level security;

-- ของตั้งค่าที่ไม่ใช่ความลับ — ใครที่เกี่ยวข้องกับเบรคอ่านได้
-- พนักงานทั่วไปไม่เห็นอะไรเลย แม้แต่ว่ามีบัตรกี่ใบ
drop policy if exists read_break_groups on break_groups;
create policy read_break_groups on break_groups for select to authenticated
  using (my_can_break_issue() or my_can_break_guard() or my_can_audit());

drop policy if exists read_break_cards on break_cards;
create policy read_break_cards on break_cards for select to authenticated
  using (my_can_break_issue() or my_can_break_guard() or my_can_audit());

drop policy if exists read_break_reasons on break_reasons;
create policy read_break_reasons on break_reasons for select to authenticated
  using (my_can_break_issue() or my_can_break_guard() or my_can_audit());

drop policy if exists read_break_bans on break_bans;
create policy read_break_bans on break_bans for select to authenticated
  using (my_can_break_issue() or my_can_audit());

-- เจ้าตัวต้องอ่านแถวตัวเองได้ ไม่งั้นหาบัตรของแผนกตัวเองไม่เจอ
drop policy if exists read_break_group_users on break_group_users;
create policy read_break_group_users on break_group_users for select to authenticated
  using (user_id = auth.uid() or my_can_audit());

drop policy if exists read_break_alert_subs on break_alert_subs;
create policy read_break_alert_subs on break_alert_subs for select to authenticated
  using (my_can_audit());

-- ---------------------------------------------------------------------
-- ใบที่ปล่อย
--
-- ผู้ตรวจสอบ   เห็นทุกใบทุกเวลา — เป็นคนดูประวัติ
-- คนที่ปล่อยเอง เห็นใบตัวเองย้อนหลังได้
-- รปภ          เห็นเฉพาะ **ใบที่ยังเปิดอยู่** ไม่เห็นประวัติ
-- หัวหน้าคนอื่น เห็นใบที่ยังเปิดอยู่ของแผนกที่ตัวเองดูแล (ส่งกะต่อกันได้)
-- พนักงานทั่วไป ไม่เห็นอะไรเลย
-- ---------------------------------------------------------------------
drop policy if exists read_break_passes on break_passes;
create policy read_break_passes on break_passes for select to authenticated using (
  my_can_audit()
  or issued_by = auth.uid()
  or (closed_at is null and my_can_break_guard())
  or (
    closed_at is null
    and my_can_break_issue()
    and exists (
      select 1 from break_group_users g
       where g.group_code = break_passes.group_code and g.user_id = auth.uid()
    )
  )
);

-- ---------------------------------------------------------------------
-- รูป — ผู้ตรวจสอบเท่านั้น
--
-- รปภ ไม่เห็นรูป เจ้าของระบบสั่งไว้ชัด
-- หัวหน้าที่เพิ่งถ่ายเองก็ไม่ต้องเห็นย้อนหลัง ไม่มีงานไหนต้องใช้
-- ตรงกับกฎเดิมของระบบที่หน้างานห้ามเห็นรูปหลักฐาน
-- ---------------------------------------------------------------------
drop policy if exists read_break_photos on break_photos;
create policy read_break_photos on break_photos for select to authenticated
  using (my_can_audit());

-- ตั้งใจไม่มี policy insert/update/delete สักตัวในไฟล์นี้
-- ทุกการเขียนผ่าน RPC security definer ใน 081 เท่านั้น
-- เขียนตรง ๆ จากฝั่งเว็บไม่ได้เลย แม้จะถือ token ของคนที่มีสิทธิ์


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from break_reasons)                                        as เหตุผลที่ตั้งไว้,
  (select count(*) from break_groups)                                         as แผนกบัตร,
  (select count(*) from break_cards)                                          as บัตรทั้งหมด,
  (select count(*) from profiles where can_break_issue)                       as คนที่ปล่อยบัตรได้,
  (select count(*) from profiles where can_break_guard)                       as รปภที่สแกนได้,
  (select count(*) from pg_policies where tablename like 'break\_%')           as จำนวนกฎRLS;
