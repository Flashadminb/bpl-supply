-- =====================================================================
-- BPL SUPPLY — เพดานบัตรเบรคนับเป็น "คน" ไม่ใช่ "ใบ"
-- รันต่อจาก 119 · ปลอดภัยที่จะรันซ้ำ
--
-- สิ่งที่หน้างานเจอ แผนก DO7 ปล่อยไป 3 ใบ รวม 5 คน แล้วปล่อยเพิ่มไม่ได้
-- ทั้งที่คนออกไปแค่ 5 คน · ตัวที่บล็อกคือ max_open ซึ่งนับ "ใบ" ไม่ได้นับ "คน"
-- ตั้งไว้ 3 ตั้งแต่ 080 แปลว่าใบที่สี่โดนปฏิเสธไม่ว่าใบก่อนหน้าจะมีคนละกี่คน
--
-- ใบละ 1 คนสามใบ กับใบละ 5 คนสามใบ ต่างกัน 12 คน แต่ชนเพดานพร้อมกัน
-- ซึ่งไม่ตรงกับสิ่งที่เพดานนี้ควรคุม คือ "ตอนนี้มีคนหายไปจากไลน์กี่คน"
--
-- ของใหม่ เพดานจริงคือจำนวนคน เจ้าของระบบเคาะไว้ที่ 15 คนต่อแผนก
-- max_open ยังอยู่เป็นคันโยกสำรองเผื่อวันหลังอยากจำกัดจำนวนใบด้วย
-- แต่ตั้งเป็น 0 ให้ทุกแผนกแล้ว แปลว่าไม่จำกัดใบ ดูที่หัวคนอย่างเดียว
-- =====================================================================

-- ---------------------------------------------------------------------
-- ① ช่องเพดานคน
-- ---------------------------------------------------------------------
alter table break_groups
  add column if not exists max_people integer not null default 15;

alter table break_groups drop constraint if exists break_groups_max_people_chk;
alter table break_groups add constraint break_groups_max_people_chk
  check (max_people >= 0);

comment on column break_groups.max_people is
  'เพดานจำนวนคนที่ออกพร้อมกันได้ของแผนกนี้ (0 = ไม่จำกัด) · นับหัวคน ไม่ใช่นับใบ';

comment on column break_groups.max_open is
  'เพดานจำนวนใบที่ปล่อยพร้อมกันได้ (0 = ไม่จำกัด) · คันโยกสำรอง ปกติปล่อยเป็น 0 แล้วคุมที่ max_people';

-- ตั้งค่าตามที่เจ้าของระบบสั่ง ทุกแผนก 15 คน และเลิกจำกัดจำนวนใบ
update break_groups set max_people = 15, max_open = 0;


-- ---------------------------------------------------------------------
-- ② ปล่อยบัตร — เช็คหัวคน
--
-- เขียนทับทั้งฟังก์ชันเพราะ plpgsql แก้ทีละท่อนไม่ได้
-- ที่เปลี่ยนจริงมีแค่ก้อนเพดาน ที่เหลือยกมาจาก 081 ทั้งดุ้น
-- ---------------------------------------------------------------------
create or replace function break_issue(
  p_card_code  text,
  p_people     integer,
  p_reason     text,
  p_minutes    integer default null,
  p_photos     jsonb   default '[]'::jsonb,
  p_nickname   text    default null,
  p_ban_reason text    default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_card   break_cards%rowtype;
  v_group  break_groups%rowtype;
  v_reason break_reasons%rowtype;
  v_ban    break_bans%rowtype;
  v_now    timestamptz := now();
  v_min    integer;
  v_shots  integer;
  v_open   integer;
  v_heads  integer;
  v_ref    text;
  v_id     bigint;
begin
  if not my_can_break_issue() then
    raise exception 'ไม่มีสิทธิ์ปล่อยบัตรเบรค';
  end if;

  select * into v_card from break_cards where code = p_card_code and active;
  if not found then
    raise exception 'ไม่พบบัตร % หรือบัตรถูกปิดใช้งานแล้ว', p_card_code;
  end if;

  select * into v_group from break_groups where code = v_card.group_code and active;
  if not found then
    raise exception 'แผนกของบัตรนี้ถูกปิดใช้งานแล้ว';
  end if;

  if my_role() <> 'admin'
     and not exists (select 1 from break_group_users u
                      where u.group_code = v_card.group_code and u.user_id = auth.uid()) then
    raise exception 'คุณไม่ได้ดูแลบัตรของแผนก %', v_card.group_code;
  end if;

  if p_people is null or p_people < 1 or p_people > 5 then
    raise exception 'จำนวนคนต้องอยู่ระหว่าง 1 ถึง 5';
  end if;

  select * into v_reason from break_reasons where code = p_reason and active;
  if not found then
    raise exception 'ไม่พบเหตุผล %', p_reason;
  end if;

  v_min := coalesce(p_minutes, v_reason.default_minutes);
  if v_min < 1 or v_min > 120 then
    raise exception 'จำนวนนาทีต้องอยู่ระหว่าง 1 ถึง 120';
  end if;

  -- รูปบังคับ · นับก่อนเขียนอะไรลงฐาน จะได้ไม่ต้อง rollback
  select count(*) into v_shots
    from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) e
   where coalesce(e->>'file_id', '') <> '' and coalesce(e->>'web_link', '') <> '';
  if v_shots = 0 then
    raise exception 'ต้องแนบรูปอย่างน้อยหนึ่งใบก่อนปล่อยบัตร';
  end if;

  -- ใบนี้ยังไม่ปิด = ยังอยู่ข้างนอก ปล่อยซ้ำไม่ได้
  if exists (select 1 from break_passes where card_code = p_card_code and closed_at is null) then
    raise exception 'บัตร % ยังไม่ได้รับกลับ ปล่อยซ้ำไม่ได้', p_card_code;
  end if;

  -- ── เพดานหัวคนของแผนก · 0 แปลว่าไม่จำกัด ──
  --
  -- นับจากใบที่ยังไม่ปิด ไม่ใช่จากที่ รปภ สแกนออกไปแล้ว
  -- เพราะใบที่ยื่นแล้วยังไม่ถึงประตู ก็คือคนที่ไม่อยู่ไลน์แล้วเหมือนกัน
  if v_group.max_people > 0 then
    select coalesce(sum(people), 0) into v_heads
      from break_passes where group_code = v_card.group_code and closed_at is null;
    if v_heads + p_people > v_group.max_people then
      raise exception 'แผนก % ออกพร้อมกันได้สูงสุด % คน ตอนนี้ออกไปแล้ว % คน ใบนี้อีก % คนจะเกิน',
                      v_card.group_code, v_group.max_people, v_heads, p_people;
    end if;
  end if;

  -- ── เพดานจำนวนใบ · คันโยกสำรอง ปกติเป็น 0 ──
  if v_group.max_open > 0 then
    select count(*) into v_open
      from break_passes where group_code = v_card.group_code and closed_at is null;
    if v_open >= v_group.max_open then
      raise exception 'แผนก % ปล่อยพร้อมกันได้สูงสุด % ใบ ตอนนี้ออกไปแล้ว % ใบ',
                      v_card.group_code, v_group.max_open, v_open;
    end if;
  end if;

  -- ช่วงห้าม — ไม่ปิดตาย แต่ต้องมีเหตุผล
  --
  -- break_ban_now() ประกาศว่าคืน break_bans ไม่ใช่ setof
  -- ไม่เจอช่วงห้ามมันจึงคืนแถวที่ทุกคอลัมน์เป็น null ไม่ใช่ศูนย์แถว
  -- found จะเป็นจริงเสมอ ห้ามใช้ตัดสิน ต้องดูที่ id แทน
  select * into v_ban from break_ban_now();
  if v_ban.id is not null and coalesce(btrim(p_ban_reason), '') = '' then
    raise exception 'ตอนนี้อยู่ในช่วงห้ามเบรค (%) ถ้าจำเป็นต้องปล่อย ให้กรอกเหตุผลฉุกเฉิน',
                    coalesce(v_ban.note, 'ไม่ได้ระบุเหตุผล');
  end if;

  v_ref := 'BRK-' || (extract(year from v_now)::int + 543)::text
           || '-' || lpad(nextval('break_pass_seq')::text, 5, '0');

  insert into break_passes (
    ref_no, card_code, group_code,
    reason_code, reason_label, people, minutes, nickname,
    issued_by, issued_at, due_at,
    in_ban, ban_reason
  ) values (
    v_ref, v_card.code, v_card.group_code,
    v_reason.code, v_reason.label, p_people, v_min, nullif(btrim(coalesce(p_nickname, '')), ''),
    auth.uid(), v_now, v_now + (v_min || ' minutes')::interval,
    (v_ban.id is not null), nullif(btrim(coalesce(p_ban_reason, '')), '')
  ) returning id into v_id;

  insert into break_photos (pass_id, phase, file_id, web_link, bytes, taken_by)
  select v_id, 'issue', e->>'file_id', e->>'web_link', (e->>'bytes')::integer, auth.uid()
    from jsonb_array_elements(p_photos) e
   where coalesce(e->>'file_id', '') <> '' and coalesce(e->>'web_link', '') <> '';

  -- ปล่อยในช่วงห้าม = เรื่องที่ต้องรู้เดี๋ยวนี้ ไม่ใช่รู้ตอนนาฬิกาเดินรอบหน้า
  if v_ban.id is not null then
    perform break_alert_fire();
  end if;

  return jsonb_build_object(
    'id', v_id, 'ref_no', v_ref, 'card_code', v_card.code,
    'people', p_people, 'minutes', v_min,
    'issued_at', v_now, 'due_at', v_now + (v_min || ' minutes')::interval,
    'in_ban', (v_ban.id is not null), 'ban_note', v_ban.note
  );
end $$;

grant execute on function
  break_issue(text, integer, text, integer, jsonb, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- ③ หน้าปล่อยบัตรต้องเห็นหัวคน ไม่ใช่เห็นแต่จำนวนใบ
--
-- open_people คือตัวเลขที่ชนเพดานจริง หน้าจอจึงต้องโชว์ตัวนี้
-- ถ้าโชว์แต่จำนวนใบ หน้างานจะงงเหมือนเดิมว่าทำไมปล่อยไม่ได้
-- ---------------------------------------------------------------------
create or replace function break_my_cards() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_admin boolean := my_role() = 'admin';
begin
  if not my_can_break_issue() then
    raise exception 'ไม่มีสิทธิ์ปล่อยบัตรเบรค';
  end if;

  return coalesce((
    select jsonb_agg(x order by x->>'group_code', x->>'code')
    from (
      select jsonb_build_object(
               'code',       c.code,
               'group_code', c.group_code,
               'group_name', g.name,
               'max_open',   g.max_open,
               'max_people', g.max_people,
               'open_now',   (select count(*) from break_passes p
                               where p.group_code = c.group_code and p.closed_at is null),
               'open_people', (select coalesce(sum(p.people), 0) from break_passes p
                                where p.group_code = c.group_code and p.closed_at is null),
               'busy',       (o.id is not null),
               'busy_people', o.people,
               'busy_since',  o.issued_at
             ) as x
      from break_cards c
      join break_groups g on g.code = c.group_code
      left join break_passes o on o.card_code = c.code and o.closed_at is null
      where c.active and g.active
        and (v_admin or exists (
              select 1 from break_group_users u
               where u.group_code = c.group_code and u.user_id = auth.uid()))
    ) s
  ), '[]'::jsonb);
end $$;

grant execute on function break_my_cards() to authenticated;


-- ---------------------------------------------------------------------
-- ④ ตั้งค่าแผนก — รับเพดานคนเข้ามาด้วย
--
-- ต้อง drop ก่อน เพราะ create or replace เพิ่มพารามิเตอร์ไม่ได้
-- ---------------------------------------------------------------------
drop function if exists break_group_save(text, text, integer, boolean);

create or replace function break_group_save(
  p_code       text,
  p_name       text    default null,
  p_max_open   integer default 0,
  p_active     boolean default true,
  p_max_people integer default 15
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_code text := break_norm_code(p_code);
begin
  perform break_admin_guard();
  if p_max_open is null or p_max_open < 0 or p_max_open > 200 then
    raise exception 'เพดานจำนวนใบต้องอยู่ระหว่าง 0 ถึง 200 (0 = ไม่จำกัด)';
  end if;
  if p_max_people is null or p_max_people < 0 or p_max_people > 500 then
    raise exception 'เพดานจำนวนคนต้องอยู่ระหว่าง 0 ถึง 500 (0 = ไม่จำกัด)';
  end if;

  insert into break_groups (code, name, max_open, active, max_people)
  values (v_code, nullif(btrim(coalesce(p_name, '')), ''), p_max_open, p_active, p_max_people)
  on conflict (code) do update
     set name = excluded.name, max_open = excluded.max_open,
         active = excluded.active, max_people = excluded.max_people;

  return jsonb_build_object('ok', true, 'code', v_code);
end $$;

grant execute on function break_group_save(text, text, integer, boolean, integer) to authenticated;


-- ---------------------------------------------------------------------
-- ⑤ หน้าตั้งค่าหลังบ้าน — ส่งเพดานคนและหัวคนที่ออกอยู่ออกไปด้วย
-- ---------------------------------------------------------------------
create or replace function break_settings() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform break_admin_guard();

  return jsonb_build_object(
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', g.code, 'name', g.name, 'max_open', g.max_open, 'active', g.active,
               'max_people', g.max_people,
               'open_people', (select coalesce(sum(p.people), 0) from break_passes p
                                where p.group_code = g.code and p.closed_at is null),
               'cards', (select count(*) from break_cards c where c.group_code = g.code),
               'users', coalesce((select jsonb_agg(u.user_id) from break_group_users u
                                   where u.group_code = g.code), '[]'::jsonb)
             ) order by g.code)
        from break_groups g), '[]'::jsonb),

    'cards', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', c.code, 'group_code', c.group_code, 'active', c.active, 'note', c.note,
               'busy', exists (select 1 from break_passes p
                                where p.card_code = c.code and p.closed_at is null),
               'used', exists (select 1 from break_passes p where p.card_code = c.code)
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
        from break_bans b where b.kind = 'daily'), '[]'::jsonb),

    'alert_subs', coalesce((
      select jsonb_agg(s.user_id) from break_alert_subs s), '[]'::jsonb),

    'ban_users', coalesce((
      select jsonb_agg(p.id) from profiles p where p.is_active and p.can_break_ban), '[]'::jsonb)
  );
end $$;

grant execute on function break_settings() to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  g.code                                                               as แผนก,
  g.max_people                                                         as เพดานคน,
  g.max_open                                                           as เพดานใบ,
  (select count(*) from break_cards c where c.group_code = g.code)     as บัตรที่มี,
  (select coalesce(sum(p.people), 0) from break_passes p
    where p.group_code = g.code and p.closed_at is null)               as ออกอยู่ตอนนี้กี่คน,
  (select count(*) from break_passes p
    where p.group_code = g.code and p.closed_at is null)               as ออกอยู่ตอนนี้กี่ใบ
from break_groups g
order by g.code;
