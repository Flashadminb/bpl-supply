-- =====================================================================
-- BPL SUPPLY — บัตรนำโทรศัพท์เข้าพื้นที่ของพนักงาน OS
-- รันต่อจาก 070 · ปลอดภัยที่จะรันซ้ำ
--
-- รปภ สแกน QR ที่บัตรคล้องคอของ OS แล้วระบบโชว์รูปหน้าและข้อมูลเครื่อง
-- ให้ รปภ เทียบกับคนตรงหน้าและเครื่องที่ถืออยู่ ก่อนปล่อยเข้าพื้นที่
--
-- ของที่ป้องกันการโกงมีสองชั้น และคนละชั้นกัน
--   ชั้นโค้ด  บัตรปลอมทำไม่ได้ เพราะโค้ดต้องมีอยู่จริงในตารางนี้
--   ชั้นคน    ยืมบัตรกันเข้าทำได้ ตัวกันคือ รปภ เทียบหน้ากับรูป
-- ระบบไม่พยายามแก้ชั้นที่สองด้วยโค้ด เพราะแก้ไม่ได้จริง
-- หน้าที่ของระบบคือเอารูปไปวางตรงหน้า รปภ ให้เร็วที่สุด
--
-- ไม่มีการเตือน "สแกนซ้ำ" โดยตั้งใจ
--   OS เดินออกไปห้องน้ำแล้วกลับเข้ามาเป็นเรื่องปกติ วันละหลายรอบ
--   ถ้าเด้งเตือนทุกรอบ รปภ จะกดผ่านโดยไม่อ่านภายในวันเดียว
--   แล้วคำเตือนจะไร้ค่าในวันที่มันสำคัญจริง
--   ยังบันทึกทุกครั้งไว้ดูย้อนหลังได้เหมือนเดิม แค่ไม่ขึ้นหน้า รปภ
-- =====================================================================

/* ------------------------------------------------- ① ตำแหน่ง รปภ */

-- ธงบนโปรไฟล์ ไม่ใช่ค่าใหม่ใน enum ของ role
--
-- Postgres ห้ามใช้ค่า enum ที่เพิ่งเพิ่มในธุรกรรมเดียวกัน
-- ตอนเพิ่ม "ผู้ตรวจสอบ" เคยทำ migration พังกลางทางด้วยเรื่องนี้มาแล้ว
-- และสิทธิ์ต้องผูกกับธง ไม่ใช่ชื่อแผนก เพราะแผนกเป็นข้อความที่คนพิมพ์มือ
alter table profiles
  add column if not exists can_guard boolean not null default false;

comment on column profiles.can_guard is
  'รปภ — เห็นเฉพาะหน้าสแกนบัตร OS ในแอพ ไม่เห็นเมนูเบิกของเลย';

create or replace function my_can_guard() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select can_guard from profiles where id = auth.uid()), false);
$$;

grant execute on function my_can_guard() to authenticated;

/** ใครจัดการรายชื่อ OS ได้ — เจ้าของระบบ แอดมิน ผู้ตรวจสอบ */
create or replace function my_can_os_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select my_role() in ('supervisor', 'admin') or my_can_dispatch();
$$;

grant execute on function my_can_os_admin() to authenticated;


/* --------------------------------------------------- ② รายชื่อ OS */

create table if not exists os_people (
  id           uuid primary key default gen_random_uuid(),
  /** รหัสพนักงาน OS — บางคนยังไม่มี จึงไม่บังคับ แต่ถ้ามีต้องไม่ซ้ำ */
  os_code      text,
  full_name    text not null,
  /** สังกัดผู้รับเหมา AK / PW / SVT / AIT / FN22 */
  affiliation  text,
  shift        text,
  phone_model  text,
  imei         text,
  nickname     text,
  /** รูปหน้า เก็บที่ Google Drive เหมือนรูปอื่นในระบบ ไม่ได้เก็บใน Supabase */
  photo_file_id text,
  photo_link    text,
  is_active    boolean not null default true,
  note         text,
  created_at   timestamptz not null default now(),
  created_by   uuid references profiles (id),
  updated_at   timestamptz,
  updated_by   uuid references profiles (id)
);

create unique index if not exists os_people_code_uniq
  on os_people (os_code) where os_code is not null and btrim(os_code) <> '';
create index if not exists os_people_name_idx on os_people (full_name);
create index if not exists os_people_active_idx on os_people (is_active) where is_active;


/* ---------------------------------------------------- ③ บัตรและโค้ด */

-- โค้ดเป็นค่าสุ่มล้วน ไม่ได้เข้ารหัสจากข้อมูลคน
--
-- ถ้าโค้ดคำนวณมาจากรหัสพนักงาน ใครจับทางได้จะทำบัตรเองได้ทั้งฮับ
-- สุ่มแล้วเก็บไว้เทียบ แปลว่าต่อให้เดาถูกหนึ่งใบก็ไม่ช่วยให้เดาใบต่อไปได้
--
-- ใน QR มีแค่โค้ดนี้ ไม่มีชื่อ ไม่มี IMEI ไม่มีอะไรอ่านได้
-- ใครถ่ายรูปบัตรคนอื่นไปก็ไม่ได้ข้อมูลใครติดไปด้วย
create table if not exists os_cards (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references os_people (id) on delete cascade,
  token      text not null unique,
  /** ใบที่เท่าไหร่ของคนนี้ · พิมพ์ไว้มุมล่างบัตรไว้ไล่ว่าใบไหนใหม่กว่า */
  rev        integer not null default 1,
  issued_at  timestamptz not null default now(),
  issued_by  uuid references profiles (id),
  revoked_at timestamptz,
  revoked_by uuid references profiles (id),
  revoke_reason text
);

-- คนละหนึ่งใบที่ใช้ได้เท่านั้น ออกใบใหม่ต้องยกเลิกใบเก่าก่อนเสมอ
create unique index if not exists os_cards_one_live
  on os_cards (person_id) where revoked_at is null;
create index if not exists os_cards_person_idx on os_cards (person_id, rev desc);


/* ------------------------------------------------ ④ ประวัติการสแกน */

-- ตารางนี้จะมีแถวเยอะที่สุดในระบบภายในเดือนแรก
--   55 คน สแกนวันละ 6-8 ครั้ง = ~13,000 แถวต่อเดือน
-- จึงเก็บให้ผอมที่สุด ไม่ซ้ำข้อความที่หาได้จากตารางอื่นอยู่แล้ว
-- และมีกติกายุบของเก่าไว้ตั้งแต่วันแรก ไม่ใช่รอให้เต็มก่อนค่อยคิด
create table if not exists os_scans (
  id         bigserial primary key,
  /** โค้ดที่สแกนได้จริง เก็บไว้แม้ไม่รู้จัก เพื่อดูว่ามีคนลองยิงอะไรเข้ามา */
  token      text not null,
  card_id    uuid references os_cards (id) on delete set null,
  person_id  uuid references os_people (id) on delete set null,
  guard_id   uuid references profiles (id),
  scanned_at timestamptz not null default now(),
  /** ok | revoked | unknown | inactive */
  result     text not null,
  /** รปภ กดแจ้งว่าไม่ตรงทีหลัง — ว่างแปลว่าไม่ได้แจ้ง */
  flag_reason text,
  flagged_at  timestamptz
);

create index if not exists os_scans_time_idx on os_scans (scanned_at desc);
create index if not exists os_scans_person_idx on os_scans (person_id, scanned_at desc);
create index if not exists os_scans_guard_idx on os_scans (guard_id, scanned_at desc);
create index if not exists os_scans_flag_idx on os_scans (flagged_at desc) where flagged_at is not null;

/** สรุปรายวัน — ของเก่ายุบมาลงตรงนี้ รายละเอียดรายครั้งทิ้งได้ */
create table if not exists os_scan_daily (
  day        date not null,
  person_id  uuid references os_people (id) on delete cascade,
  scans      integer not null default 0,
  ok_scans   integer not null default 0,
  flagged    integer not null default 0,
  primary key (day, person_id)
);


/* ------------------------------------------------------- ⑤ สิทธิ์ */

-- รปภ อ่านตาราง os_people ตรง ๆ ไม่ได้ ต้องผ่านการสแกนเท่านั้น
--
-- ถ้าให้อ่านได้ เขาจะเปิดดูรายชื่อทั้งฮับพร้อมรูปและ IMEI ได้ทั้งกอง
-- ซึ่งไม่ใช่สิ่งที่งานเขาต้องใช้ และเป็นข้อมูลที่หลุดแล้วเอากลับไม่ได้
-- ฟังก์ชัน os_scan() เป็น security definer จึงตอบเฉพาะคนที่บัตรชี้ถึงใบเดียว
alter table os_people enable row level security;
alter table os_cards enable row level security;
alter table os_scans enable row level security;
alter table os_scan_daily enable row level security;

drop policy if exists read_os_people on os_people;
create policy read_os_people on os_people for select to authenticated
  using (my_can_os_admin());

drop policy if exists write_os_people on os_people;
create policy write_os_people on os_people for all to authenticated
  using (my_can_os_admin()) with check (my_can_os_admin());

drop policy if exists read_os_cards on os_cards;
create policy read_os_cards on os_cards for select to authenticated
  using (my_can_os_admin());

drop policy if exists read_os_scans on os_scans;
create policy read_os_scans on os_scans for select to authenticated
  using (my_can_os_admin());

drop policy if exists read_os_daily on os_scan_daily;
create policy read_os_daily on os_scan_daily for select to authenticated
  using (my_can_os_admin());


/* ---------------------------------------------------- ⑥ ออก/ยกเลิกบัตร */

/**
 * โค้ดสุ่ม 22 ตัว จาก gen_random_bytes
 *
 * ยาวพอที่ต่อให้ยิงเดาทั้งวันทั้งคืนก็ไม่มีทางชน
 * ตัด + / = ของ base64 ทิ้ง เพราะบางตัวอ่านในบาร์โค้ดแล้วเพี้ยน
 * และตัด 0 O l I ออก กันคนอ่านผิดตอนพิมพ์มือในกรณีฉุกเฉิน
 */
create or replace function os_new_token() returns text
language sql volatile set search_path = public, extensions as $$
  select translate(
           encode(gen_random_bytes(24), 'base64'),
           '+/=0OlI', 'xyz9Qm1'
         )::text
$$;

create or replace function os_issue_card(p_person uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_rev   integer;
  v_token text;
  v_id    uuid;
  v_name  text;
begin
  if not my_can_os_admin() then
    raise exception 'บัญชีนี้ออกบัตรไม่ได้';
  end if;

  select full_name into v_name from os_people where id = p_person;
  if v_name is null then
    raise exception 'ไม่พบพนักงาน OS คนนี้';
  end if;

  -- ยกเลิกใบเก่าก่อนเสมอ ออกใบใหม่แปลว่าใบเก่าใช้ไม่ได้แล้ว
  -- ถ้าปล่อยให้ใช้ได้ทั้งสองใบ การออกบัตรใหม่ตอนบัตรหายจะไม่มีความหมาย
  update os_cards
     set revoked_at = now(), revoked_by = auth.uid(),
         revoke_reason = coalesce(revoke_reason, 'ออกบัตรใหม่แทน')
   where person_id = p_person and revoked_at is null;

  select coalesce(max(rev), 0) + 1 into v_rev from os_cards where person_id = p_person;
  v_token := os_new_token();

  insert into os_cards (person_id, token, rev, issued_by)
  values (p_person, v_token, v_rev, auth.uid())
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'token', v_token, 'rev', v_rev, 'full_name', v_name);
end $$;

grant execute on function os_issue_card(uuid) to authenticated;


create or replace function os_revoke_card(p_person uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not my_can_os_admin() then
    raise exception 'บัญชีนี้ยกเลิกบัตรไม่ได้';
  end if;

  update os_cards
     set revoked_at = now(), revoked_by = auth.uid(),
         revoke_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where person_id = p_person and revoked_at is null;

  if not found then
    raise exception 'คนนี้ไม่มีบัตรที่ใช้งานอยู่';
  end if;

  return jsonb_build_object('ok', true);
end $$;

grant execute on function os_revoke_card(uuid, text) to authenticated;


/* -------------------------------------------------------- ⑦ สแกน */

/**
 * สแกนบัตร — หัวใจของงานนี้
 *
 * ตอบทุกกรณีด้วยแถวเดียวเสมอ ไม่โยน error แม้โค้ดจะใช้ไม่ได้
 * เพราะหน้าจอ รปภ ต้องขึ้นคำตอบที่อ่านรู้เรื่องทุกครั้ง
 * ไม่ใช่ขึ้นกล่องแดงว่า "เกิดข้อผิดพลาด" ซึ่งไม่ได้บอกว่าต้องทำอะไรต่อ
 *
 * บันทึกทุกครั้ง รวมโค้ดที่ไม่รู้จัก เพื่อให้เห็นว่ามีคนลองยิงอะไรเข้ามาบ้าง
 */
create or replace function os_scan(p_token text)
returns table (
  scan_id     bigint,
  result      text,
  person_id   uuid,
  os_code     text,
  full_name   text,
  affiliation text,
  shift       text,
  phone_model text,
  imei        text,
  nickname    text,
  photo_file_id text,
  card_rev    integer,
  revoked_at  timestamptz,
  revoked_by_name text
)
language plpgsql security definer set search_path = public as $$
declare
  v_tok  text := btrim(coalesce(p_token, ''));
  v_card os_cards%rowtype;
  v_p    os_people%rowtype;
  v_res  text;
  v_id   bigint;
begin
  if not (my_can_guard() or my_can_os_admin()) then
    raise exception 'บัญชีนี้สแกนบัตร OS ไม่ได้';
  end if;
  if v_tok = '' then
    raise exception 'ไม่พบโค้ดในรูปที่สแกน';
  end if;

  select * into v_card from os_cards c where c.token = v_tok;
  if found then
    select * into v_p from os_people p where p.id = v_card.person_id;
  end if;

  v_res := case
             when v_card.id is null then 'unknown'
             when v_card.revoked_at is not null then 'revoked'
             when not coalesce(v_p.is_active, false) then 'inactive'
             else 'ok'
           end;

  insert into os_scans (token, card_id, person_id, guard_id, result)
  values (v_tok, v_card.id, v_card.person_id, auth.uid(), v_res)
  returning id into v_id;

  return query
  select
    v_id, v_res, v_p.id, v_p.os_code, v_p.full_name, v_p.affiliation, v_p.shift,
    v_p.phone_model, v_p.imei, v_p.nickname, v_p.photo_file_id, v_card.rev,
    v_card.revoked_at,
    (select pr.full_name from profiles pr where pr.id = v_card.revoked_by);
end $$;

grant execute on function os_scan(text) to authenticated;


/**
 * รปภ กดแจ้งว่าไม่ตรง
 *
 * แยกจากการสแกน เพราะ รปภ ต้องเห็นรูปก่อนแล้วค่อยตัดสิน
 * บังคับเลือกเหตุผล เพราะแจ้งเตือนที่บอกแค่ "มีปัญหา"
 * ทำให้คนรับต้องโทรถามอยู่ดี ซึ่งช้ากว่าไม่แจ้งเสียอีก
 */
create or replace function os_flag_scan(p_scan bigint, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row os_scans%rowtype;
begin
  if not (my_can_guard() or my_can_os_admin()) then
    raise exception 'บัญชีนี้แจ้งเตือนไม่ได้';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'ต้องเลือกเหตุผลก่อน';
  end if;

  update os_scans
     set flag_reason = btrim(p_reason), flagged_at = now()
   where id = p_scan
  returning * into v_row;

  if not found then
    raise exception 'ไม่พบรายการสแกนนี้';
  end if;

  -- เตะนาฬิกาแจ้งเตือนทันที คนที่ต้องรู้คือคนที่กำลังจะต้องเดินมาที่ประตู
  begin
    perform push_tick();
  exception when others then
    raise notice 'แจ้งแล้วแต่เตะแจ้งเตือนไม่สำเร็จ (%)', sqlerrm;
  end;

  return jsonb_build_object('ok', true);
end $$;

grant execute on function os_flag_scan(bigint, text) to authenticated;


/* ------------------------------------------------ ⑧ แจ้งเตือนคนที่ต้องรู้ */

-- ผูกกับแผนกย่อยเหมือนทีมซัพพอร์ตของงานกระสอบ
-- เปลี่ยนรหัสทีมได้ที่ค่าตั้งค่า ไม่ต้องแก้โค้ดและไม่ต้อง deploy
insert into app_settings (key, value) values
  ('os_flag_sub_dept', '"STD"'::jsonb)
on conflict (key) do nothing;

create or replace function push_os_flag_jobs()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tag text;
begin
  select value #>> '{}' into v_tag
    from app_settings where key = 'os_flag_sub_dept';
  v_tag := coalesce(nullif(btrim(v_tag), ''), 'STD');

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'os_flag',
      'subject', s.id::text,
      'user_id', p.id,
      'title',   'บัตร OS ไม่ตรง · ' || coalesce(op.full_name, 'ไม่ทราบชื่อ'),
      'body',    s.flag_reason ||
                 coalesce(' · แจ้งโดย ' || g.full_name, '') ||
                 coalesce(' · ' || op.affiliation, ''),
      'url',     '/admin/os/scans'
    ))
    from os_scans s
    left join os_people op on op.id = s.person_id
    left join profiles  g  on g.id  = s.guard_id
    cross join profiles p
    where s.flagged_at is not null
      and s.flagged_at > now() - interval '1 day'
      and p.is_active
      and (
        p.role in ('admin', 'supervisor')
        or p.can_dispatch
        or upper(btrim(coalesce(p.sub_dept, ''))) = upper(v_tag)
      )
      and not exists (
        select 1 from notification_log n
        where n.kind = 'os_flag' and n.subject = s.id::text and n.user_id = p.id
      )
  ), '[]'::jsonb);
end $$;

grant execute on function push_os_flag_jobs() to authenticated, service_role;

create or replace function push_due_jobs()
returns jsonb
language sql security definer set search_path = public as $$
  select push_core_jobs()
      || push_meeting_jobs()
      || push_meeting_open_jobs()
      || push_announcement_jobs()
      || push_sack_jobs()
      || push_os_flag_jobs();
$$;

grant execute on function push_due_jobs() to authenticated, service_role;

/** ใครจะได้รับตอนกดแจ้ง — ไว้ให้หน้าจอโชว์ก่อน จะได้รู้ว่าถึงมือใครจริง */
create or replace function os_flag_targets()
returns table (full_name text, employee_code text, reason text, has_push boolean)
language sql stable security definer set search_path = public as $$
  with cfg as (
    select coalesce(
      nullif(btrim((select value #>> '{}' from app_settings
                     where key = 'os_flag_sub_dept')), ''),
      'STD') as tag
  )
  select p.full_name, p.employee_code,
         case
           when p.role = 'admin' then 'เจ้าของระบบ'
           when p.role = 'supervisor' then 'แอดมิน'
           when p.can_dispatch then 'ผู้ตรวจสอบ'
           else 'ทีม STD (' || coalesce(p.sub_dept, '') || ')'
         end,
         exists (select 1 from push_subscriptions s where s.user_id = p.id)
    from profiles p, cfg
   where p.is_active
     and (p.role in ('admin', 'supervisor') or p.can_dispatch
          or upper(btrim(coalesce(p.sub_dept, ''))) = upper(cfg.tag))
   order by p.role desc, p.full_name;
$$;

grant execute on function os_flag_targets() to authenticated;


/* -------------------------------------------- ⑨ วิวสำหรับหน้าจอหลังบ้าน */

drop view if exists os_person_rows;
create view os_person_rows
with (security_invoker = true) as
select
  p.*,
  c.id         as card_id,
  c.token      as card_token,
  c.rev        as card_rev,
  c.issued_at  as card_issued_at,
  (c.id is not null) as has_card,
  (p.photo_file_id is not null) as has_photo,
  (select count(*) from os_scans s where s.person_id = p.id)::int as scan_count,
  (select max(s.scanned_at) from os_scans s where s.person_id = p.id) as last_scan_at
from os_people p
left join os_cards c on c.person_id = p.id and c.revoked_at is null;

grant select on os_person_rows to authenticated;

drop view if exists os_scan_rows;
create view os_scan_rows
with (security_invoker = true) as
select
  s.id, s.scanned_at, s.result, s.flag_reason, s.flagged_at, s.token,
  s.person_id,
  p.os_code, p.full_name, p.affiliation, p.phone_model, p.imei,
  g.full_name as guard_name, g.employee_code as guard_code
from os_scans s
left join os_people p on p.id = s.person_id
left join profiles  g on g.id = s.guard_id;

grant select on os_scan_rows to authenticated;


/* ------------------------------------------- ⑩ กติกาเก็บย้อนหลัง */

/**
 * ยุบของเก่าเป็นสรุปรายวัน
 *
 * 13,000 แถวต่อเดือนคือ ~30 MB ต่อปีบนโควต้า 500 MB
 * ปีแรกไม่รู้สึก ปีที่ห้ารู้สึกแน่ และถึงตอนนั้นจะแก้ยากกว่านี้มาก
 * ใส่กติกาไว้ตั้งแต่วันแรกดีกว่ารอให้เต็มแล้วค่อยมานั่งลบ
 *
 * เก็บรายครั้ง 90 วัน ซึ่งนานพอสำหรับการตามเรื่องย้อนหลังทุกกรณีที่เคยเจอ
 * แถวที่ รปภ กดแจ้งว่าไม่ตรงไม่ยุบทิ้ง เพราะเป็นเรื่องที่ต้องตามได้เสมอ
 */
create or replace function os_scans_rollup(p_days integer default 90)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cut timestamptz := now() - make_interval(days => greatest(p_days, 30));
  v_moved integer;
begin
  insert into os_scan_daily (day, person_id, scans, ok_scans, flagged)
  select (s.scanned_at at time zone 'Asia/Bangkok')::date,
         s.person_id,
         count(*),
         count(*) filter (where s.result = 'ok'),
         count(*) filter (where s.flagged_at is not null)
    from os_scans s
   where s.scanned_at < v_cut and s.person_id is not null
   group by 1, 2
  on conflict (day, person_id) do update
    set scans    = os_scan_daily.scans + excluded.scans,
        ok_scans = os_scan_daily.ok_scans + excluded.ok_scans,
        flagged  = os_scan_daily.flagged + excluded.flagged;

  delete from os_scans
   where scanned_at < v_cut and flagged_at is null;
  get diagnostics v_moved = row_count;

  return jsonb_build_object('deleted', v_moved, 'cut', v_cut);
end $$;

grant execute on function os_scans_rollup(integer) to service_role;


/* ---------------------------------------------------------- ตรวจผล */
select
  (select count(*) from information_schema.columns
    where table_name = 'profiles' and column_name = 'can_guard')     as ธงรปภ,
  (select count(*) from information_schema.tables
    where table_name in ('os_people','os_cards','os_scans','os_scan_daily')) as ตารางใหม่,
  (select count(*) from pg_proc
    where proname in ('os_scan','os_issue_card','os_revoke_card','os_flag_scan',
                      'my_can_guard','push_os_flag_jobs'))           as ฟังก์ชันใหม่,
  (select value #>> '{}' from app_settings where key = 'os_flag_sub_dept') as แผนกย่อยที่แจ้ง,
  (select count(*) from os_flag_targets())                           as คนที่จะได้รับแจ้ง,
  (select count(*) from os_people)                                   as รายชื่อOSตอนนี้;
