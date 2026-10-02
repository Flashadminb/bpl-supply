-- =====================================================================
-- BPL SUPPLY — บัตรเบรค OS · ตั้งค่าสำหรับเจ้าของระบบ
-- รันต่อจาก 081 · ปลอดภัยที่จะรันซ้ำ
--
-- ทุกตัวในไฟล์นี้เจ้าของระบบเท่านั้น ไม่เปิดให้ผู้ตรวจสอบด้วยซ้ำ
-- เพราะเป็นของที่เปลี่ยนแล้วกระทบทั้งระบบ เช่น เพดานปล่อยพร้อมกัน
-- และช่วงห้ามเบรค ซึ่งเป็นเครื่องมือคุมหัวหน้างานโดยตรง
-- =====================================================================


-- ---------------------------------------------------------------------
-- ด่านเดียวใช้ร่วมกันทุกตัว
-- ---------------------------------------------------------------------
create or replace function break_admin_guard() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if my_role() <> 'admin' then
    raise exception 'เฉพาะเจ้าของระบบเท่านั้น';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- รหัสบัตร — ตรวจและทำให้เป็นรูปแบบเดียวกันเสมอ
--
-- บีบเป็นตัวใหญ่ให้หมด เพราะ รปภ อาจต้องพิมพ์เองตอน QR เปื้อน
-- และจำกัดไว้แค่ A-Z 0-9 ขีดกลาง ขีดล่าง ด้วยเหตุผลเดียวกัน
-- ภาษาไทยพิมพ์บนมือถือตอนรีบไม่ไหว และทำให้ QR ใหญ่ขึ้นโดยไม่ได้อะไร
-- ---------------------------------------------------------------------
create or replace function break_norm_code(p_code text) returns text
language plpgsql immutable as $$
declare
  v text := upper(btrim(coalesce(p_code, '')));
begin
  if v = '' then
    raise exception 'รหัสบัตรว่างไม่ได้';
  end if;
  if length(v) > 24 then
    raise exception 'รหัสบัตร % ยาวเกิน 24 ตัว', v;
  end if;
  if v !~ '^[A-Z0-9][A-Z0-9_-]*$' then
    raise exception 'รหัสบัตร % ใช้ได้เฉพาะ A-Z 0-9 - _ และต้องขึ้นต้นด้วยตัวอักษรหรือตัวเลข', v;
  end if;
  return v;
end $$;


-- ---------------------------------------------------------------------
-- แผนกบัตร — เพิ่มหรือแก้ ใช้ตัวเดียวกัน
--
-- ไม่มีปุ่มลบโดยตั้งใจ ปิดใช้งานได้อย่างเดียว
-- ลบแผนกแล้วบัตรหายตาม แต่ประวัติที่อ้างบัตรนั้นจะชี้ไปหาของที่ไม่มีแล้ว
-- ---------------------------------------------------------------------
create or replace function break_group_save(
  p_code     text,
  p_name     text    default null,
  p_max_open integer default 3,
  p_active   boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_code text := break_norm_code(p_code);
begin
  perform break_admin_guard();
  if p_max_open is null or p_max_open < 0 or p_max_open > 50 then
    raise exception 'เพดานต้องอยู่ระหว่าง 0 ถึง 50 (0 = ไม่จำกัด)';
  end if;

  insert into break_groups (code, name, max_open, active)
  values (v_code, nullif(btrim(coalesce(p_name, '')), ''), p_max_open, p_active)
  on conflict (code) do update
     set name = excluded.name, max_open = excluded.max_open, active = excluded.active;

  return jsonb_build_object('ok', true, 'code', v_code);
end $$;


-- ---------------------------------------------------------------------
-- เพิ่มบัตรทีละหลายใบ
--
-- ส่งมาเป็นรายการรหัส เช่น {OUT4-01,OUT4-02,OUT4-03}
-- ใบที่มีอยู่แล้วข้ามไป ไม่ error ทั้งก้อน เพราะเจ้าของมักพิมพ์ซ้ำของเดิมมาด้วย
-- คืนมาว่าเพิ่มได้จริงกี่ใบ จะได้บอกเขาตรง ๆ
-- ---------------------------------------------------------------------
create or replace function break_cards_add(
  p_group text,
  p_codes text[]
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_group text := break_norm_code(p_group);
  v_added integer := 0;
  v_skip  integer := 0;
  c       text;
begin
  perform break_admin_guard();

  if not exists (select 1 from break_groups where code = v_group) then
    raise exception 'ยังไม่มีแผนก % — สร้างแผนกก่อน', v_group;
  end if;
  if p_codes is null or array_length(p_codes, 1) is null then
    raise exception 'ยังไม่ได้ใส่รหัสบัตร';
  end if;
  if array_length(p_codes, 1) > 200 then
    raise exception 'เพิ่มได้ครั้งละไม่เกิน 200 ใบ';
  end if;

  foreach c in array p_codes loop
    if btrim(coalesce(c, '')) <> '' then
      insert into break_cards (code, group_code) values (break_norm_code(c), v_group)
      on conflict (code) do nothing;
      if found then v_added := v_added + 1; else v_skip := v_skip + 1; end if;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'added', v_added, 'skipped', v_skip);
end $$;


-- ---------------------------------------------------------------------
-- ปิด/เปิดบัตรรายใบ · ย้ายแผนกได้ด้วย
--
-- ปิดบัตรที่ยังไม่ได้รับกลับไม่ได้ ไม่งั้นใบนั้นจะค้างบนกระดานตลอดกาล
-- โดยที่ไม่มีใครปิดได้เพราะบัตรถูกปิดใช้งานไปแล้ว
-- ---------------------------------------------------------------------
create or replace function break_card_save(
  p_code   text,
  p_active boolean default null,
  p_group  text    default null,
  p_note   text    default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_code  text := break_norm_code(p_code);
  v_group text := case when p_group is null then null else break_norm_code(p_group) end;
begin
  perform break_admin_guard();

  if p_active = false and exists (
       select 1 from break_passes where card_code = v_code and closed_at is null) then
    raise exception 'บัตร % ยังไม่ได้รับกลับ ปิดใช้งานตอนนี้ไม่ได้', v_code;
  end if;
  if v_group is not null and not exists (select 1 from break_groups where code = v_group) then
    raise exception 'ยังไม่มีแผนก %', v_group;
  end if;

  update break_cards
     set active     = coalesce(p_active, active),
         group_code = coalesce(v_group, group_code),
         note       = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note)
   where code = v_code;

  if not found then raise exception 'ไม่พบบัตร %', v_code; end if;
  return jsonb_build_object('ok', true, 'code', v_code);
end $$;


-- ---------------------------------------------------------------------
-- ใครดูแลบัตรแผนกไหน
-- ---------------------------------------------------------------------
create or replace function break_group_user_set(
  p_group text,
  p_user  uuid,
  p_on    boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_group text := break_norm_code(p_group);
begin
  perform break_admin_guard();

  if p_on then
    insert into break_group_users (group_code, user_id, added_by)
    values (v_group, p_user, auth.uid())
    on conflict (group_code, user_id) do nothing;
  else
    delete from break_group_users where group_code = v_group and user_id = p_user;
  end if;

  return jsonb_build_object('ok', true);
end $$;


-- ---------------------------------------------------------------------
-- ช่วงห้ามเบรค
--
-- รับมาเป็นนาทีนับจากเที่ยงคืนเวลาไทย · ฝั่งเว็บแปลงจาก HH:MM ให้
-- เริ่ม = จบ ไม่ได้ เพราะนั่นคือห้ามศูนย์นาที ซึ่งไม่มีความหมาย
-- แต่เริ่ม > จบ ได้ หมายถึงช่วงที่ข้ามเที่ยงคืน กะดึกต้องใช้
-- ---------------------------------------------------------------------
create or replace function break_ban_save(
  p_id        bigint  default null,
  p_start_min integer default 0,
  p_end_min   integer default 0,
  p_note      text    default null,
  p_active    boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
begin
  perform break_admin_guard();

  if p_start_min is null or p_end_min is null
     or p_start_min not between 0 and 1439 or p_end_min not between 0 and 1439 then
    raise exception 'เวลาไม่ถูกต้อง';
  end if;
  if p_start_min = p_end_min then
    raise exception 'เวลาเริ่มกับเวลาจบต้องไม่เท่ากัน';
  end if;

  if p_id is null then
    insert into break_bans (start_min, end_min, note, active, created_by)
    values (p_start_min, p_end_min, nullif(btrim(coalesce(p_note, '')), ''), p_active, auth.uid())
    returning id into v_id;
  else
    update break_bans
       set start_min = p_start_min, end_min = p_end_min,
           note = nullif(btrim(coalesce(p_note, '')), ''), active = p_active
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'ไม่พบช่วงห้ามนี้'; end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;


create or replace function break_ban_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform break_admin_guard();
  delete from break_bans where id = p_id;
  return jsonb_build_object('ok', true);
end $$;


-- ---------------------------------------------------------------------
-- เหตุผลและนาทีเริ่มต้น
-- ---------------------------------------------------------------------
create or replace function break_reason_save(
  p_code    text,
  p_label   text,
  p_minutes integer,
  p_sort    integer default 0,
  p_active  boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_code text := lower(btrim(coalesce(p_code, '')));
begin
  perform break_admin_guard();

  if v_code = '' or v_code !~ '^[a-z0-9_]+$' then
    raise exception 'รหัสเหตุผลใช้ได้เฉพาะ a-z 0-9 _';
  end if;
  if coalesce(btrim(p_label), '') = '' then
    raise exception 'ต้องมีชื่อเหตุผล';
  end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 120 then
    raise exception 'นาทีเริ่มต้นต้องอยู่ระหว่าง 1 ถึง 120';
  end if;

  insert into break_reasons (code, label, default_minutes, sort, active)
  values (v_code, btrim(p_label), p_minutes, coalesce(p_sort, 0), p_active)
  on conflict (code) do update
     set label = excluded.label, default_minutes = excluded.default_minutes,
         sort = excluded.sort, active = excluded.active;

  return jsonb_build_object('ok', true, 'code', v_code);
end $$;


-- ---------------------------------------------------------------------
-- ใครได้แจ้งเตือนเรื่องเบรค
-- ---------------------------------------------------------------------
create or replace function break_alert_sub_set(p_user uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform break_admin_guard();
  if p_on then
    insert into break_alert_subs (user_id, added_by) values (p_user, auth.uid())
    on conflict (user_id) do nothing;
  else
    delete from break_alert_subs where user_id = p_user;
  end if;
  return jsonb_build_object('ok', true);
end $$;


-- ---------------------------------------------------------------------
-- อ่านของตั้งค่าทั้งหมดในครั้งเดียว
--
-- หน้าตั้งค่ามีหกส่วนแต่ขอรอบเดียว ไม่ยิงหกครั้ง
-- open_now ติดมากับบัตรด้วย จะได้รู้ว่าใบไหนปิดใช้งานไม่ได้ตอนนี้
-- ---------------------------------------------------------------------
create or replace function break_settings() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform break_admin_guard();

  return jsonb_build_object(
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', g.code, 'name', g.name, 'max_open', g.max_open, 'active', g.active,
               'cards', (select count(*) from break_cards c where c.group_code = g.code),
               'users', coalesce((select jsonb_agg(u.user_id) from break_group_users u
                                   where u.group_code = g.code), '[]'::jsonb)
             ) order by g.code)
        from break_groups g), '[]'::jsonb),

    'cards', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', c.code, 'group_code', c.group_code, 'active', c.active, 'note', c.note,
               'busy', exists (select 1 from break_passes p
                                where p.card_code = c.code and p.closed_at is null)
             ) order by c.group_code, c.code)
        from break_cards c), '[]'::jsonb),

    'reasons', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', r.code, 'label', r.label,
               'default_minutes', r.default_minutes, 'sort', r.sort, 'active', r.active
             ) order by r.sort, r.code)
        from break_reasons r), '[]'::jsonb),

    'bans', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'start_min', b.start_min, 'end_min', b.end_min,
               'note', b.note, 'active', b.active
             ) order by b.start_min)
        from break_bans b), '[]'::jsonb),

    'alert_subs', coalesce((
      select jsonb_agg(s.user_id) from break_alert_subs s), '[]'::jsonb)
  );
end $$;


-- ---------------------------------------------------------------------
-- สิทธิ์เรียก · ตัวฟังก์ชันตรวจซ้ำเองอีกชั้นว่าเป็นเจ้าของระบบจริง
-- ---------------------------------------------------------------------
grant execute on function break_group_save(text, text, integer, boolean)        to authenticated;
grant execute on function break_cards_add(text, text[])                         to authenticated;
grant execute on function break_card_save(text, boolean, text, text)            to authenticated;
grant execute on function break_group_user_set(text, uuid, boolean)             to authenticated;
grant execute on function break_ban_save(bigint, integer, integer, text, boolean) to authenticated;
grant execute on function break_ban_delete(bigint)                              to authenticated;
grant execute on function break_reason_save(text, text, integer, integer, boolean) to authenticated;
grant execute on function break_alert_sub_set(uuid, boolean)                    to authenticated;
grant execute on function break_settings()                                      to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc
    where proname in ('break_group_save','break_cards_add','break_card_save',
                      'break_group_user_set','break_ban_save','break_ban_delete',
                      'break_reason_save','break_alert_sub_set','break_settings',
                      'break_norm_code','break_admin_guard')) as ฟังก์ชันตั้งค่า,
  break_norm_code(' out4-01 ')                                as ตัวอย่างรหัสที่ทำให้เป็นมาตรฐาน;
