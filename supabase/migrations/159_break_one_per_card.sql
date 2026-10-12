-- ---------------------------------------------------------------------
-- 159 · กฎใบละคน · ปล่อยหลายใบรวดเดียวแต่แยกคนชัดเจน
--
-- ⚠ ไฟล์นี้ยังไม่เปลี่ยนอะไรให้ใคร · ทุกแผนกตั้งต้นเป็นปิด
-- เจ้าของระบบกำลังทำบัตรเพิ่ม จะเปิดเองทีละแผนกเมื่อบัตรพร้อม
-- สวิตช์อยู่ที่หลังบ้าน แท็บบัตรและสิทธิ์ · ปิดอยู่ = หน้าปล่อยบัตรเหมือนเดิมทุกอย่าง
--
-- ทำไมต้องเป็นรายแผนก ไม่ใช่ทั้งฮับ
--   ใบละคนแปลว่าแผนกนั้นต้องมีบัตรเท่ากับเพดานหัวคน (15 ใบ)
--   ของจริงวันนี้ 14 จาก 22 แผนกยังมีแค่ 5 ใบ
--   ถ้าเปิดทั้งฮับทีเดียว แผนกที่บัตรไม่พอจะปล่อยได้แค่ 5 คนแล้วตัน
--   ทั้งที่สิทธิ์ยังเหลืออีกสิบคน และหน้างานจะไม่รู้ว่าทำไม
--
-- ─────────────────────────────────────────────────────────────────────
-- break_issue_many · ปล่อยหลายใบในทรานแซกชันเดียว
--
-- ทั้งหมดขึ้น หรือไม่ขึ้นเลยสักใบ · ไม่มีขึ้นครึ่งเดียว
-- ถ้าระหว่างนั้นมีหัวหน้าอีกคนคว้าบัตรไปใบหนึ่ง ต้องล้มทั้งชุดแล้วบอกว่าใบไหนชน
-- ถ้าปล่อยไป 3 ค้าง 2 หัวหน้าจะไม่รู้ว่าต้องแจกบัตรใบไหนบ้าง
-- และรูปที่อัปไปแล้วจะกลายเป็นรูปกำพร้าที่ไม่ผูกกับใบไหนเลย
--
-- เวลาเริ่มเดินพร้อมกันทุกใบที่ v_now ไม่ใช่ตอนถ่ายรูปแต่ละคน
-- ถ้าเริ่มนับตอนถ่าย คนแรกจะเสียเวลาที่รอหัวหน้าถ่ายคนที่เหลือไปฟรี ๆ
-- ---------------------------------------------------------------------

alter table break_groups add column if not exists one_per_card boolean not null default false;

comment on column break_groups.one_per_card is
  'แผนกนี้ใช้กฎใบละคนไหม · ปิดอยู่ = ปล่อยใบละหลายคนได้เหมือนเดิม';


create or replace function break_group_one_per_card(p_code text, p_on boolean)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare v_cards integer; v_cap integer;
begin
  perform break_card_guard();

  select g.max_people,
         (select count(*) from break_cards c where c.group_code = g.code and c.active)
    into v_cap, v_cards
    from break_groups g where g.code = p_code;

  if v_cap is null then
    raise exception 'ไม่พบแผนก %', p_code;
  end if;

  /* เตือนตอนเปิด แต่ไม่ห้าม · เจ้าของระบบอาจตั้งใจเปิดก่อนบัตรครบ
     ห้ามไปเลยจะกลายเป็นว่าเขาเปิดไม่ได้ทั้งที่รู้อยู่แล้วว่าบัตรยังไม่พอ */
  if p_on and v_cap > 0 and v_cards < v_cap then
    raise notice 'แผนก % มีบัตร % ใบ แต่เพดาน % คน · ปล่อยได้สูงสุด % คนจนกว่าจะปริ้นเพิ่ม',
                 p_code, v_cards, v_cap, v_cards;
  end if;

  update break_groups set one_per_card = coalesce(p_on, false) where code = p_code;

  return jsonb_build_object('ok', true, 'code', p_code,
                            'cards', v_cards, 'cap', v_cap);
end $fn$;

grant execute on function break_group_one_per_card(text, boolean) to authenticated;


-- ---------------------------------------------------------------------
-- ปล่อยหลายใบรวดเดียว
--
-- p_rows เป็น array ของ { card, supplier, minutes, reason, nickname, photos }
-- แต่ละแถวมีนาทีกับเหตุผลของตัวเองได้ · ไม่ส่งมาก็ใช้ค่ารวมที่ p_reason กับ p_minutes
-- ---------------------------------------------------------------------
create or replace function break_issue_many(
  p_rows       jsonb,
  p_reason     text,
  p_minutes    integer default null,
  p_ban_reason text    default null
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_ban    break_bans%rowtype;
  v_now    timestamptz := now();
  v_n      integer;
  v_heads  integer;
  v_open   integer;
  v_grp    text;
  v_group  break_groups%rowtype;
  r        jsonb;
  v_card   break_cards%rowtype;
  v_reason break_reasons%rowtype;
  v_min    integer;
  v_supc   text;
  v_ref    text;
  v_id     bigint;
  v_shots  integer;
  v_out    jsonb := '[]'::jsonb;
  v_seen   text[] := '{}';
begin
  if not my_can_break_issue() then
    raise exception 'ไม่มีสิทธิ์ปล่อยบัตรเบรค';
  end if;

  v_n := jsonb_array_length(coalesce(p_rows, '[]'::jsonb));
  if v_n = 0 then
    raise exception 'ยังไม่ได้ใส่คนสักคน';
  end if;
  if v_n > 20 then
    raise exception 'ปล่อยรวดเดียวได้สูงสุด 20 ใบ';
  end if;

  /* ── ตรวจทุกแถวให้ครบก่อน ยังไม่เขียนอะไรลงฐาน ──
     ตรวจทีละแถวแล้วเขียนไปด้วยคือทางที่ทำให้เกิดครึ่ง ๆ กลาง ๆ
     ถึงจะ rollback ได้ แต่เลขใบ (sequence) จะกระโดดไปแล้วและเอาคืนไม่ได้ */
  for r in select * from jsonb_array_elements(p_rows) loop
    select * into v_card from break_cards where code = r->>'card' and active;
    if not found then
      raise exception 'ไม่พบบัตร % หรือบัตรถูกปิดใช้งานแล้ว', coalesce(r->>'card', '(ว่าง)');
    end if;

    if v_card.code = any(v_seen) then
      raise exception 'บัตร % ใส่ซ้ำสองแถว', v_card.code;
    end if;
    v_seen := v_seen || v_card.code;

    if v_grp is null then
      v_grp := v_card.group_code;
    elsif v_grp <> v_card.group_code then
      raise exception 'ปล่อยรวดเดียวต้องเป็นแผนกเดียวกันทั้งชุด · เจอทั้ง % และ %',
                      v_grp, v_card.group_code;
    end if;

    if exists (select 1 from break_passes p
                where p.card_code = v_card.code and p.closed_at is null) then
      raise exception 'บัตร % ยังไม่ได้รับกลับ ปล่อยซ้ำไม่ได้', v_card.code;
    end if;

    v_min := coalesce(nullif(r->>'minutes', '')::int, p_minutes);
    if v_min is null or v_min < 2 or v_min > 30 then
      raise exception 'บัตร % · นาทีต้องอยู่ระหว่าง 2 ถึง 30', v_card.code;
    end if;

    select * into v_reason from break_reasons
     where code = coalesce(nullif(r->>'reason', ''), p_reason) and active;
    if not found then
      raise exception 'บัตร % · ไม่พบเหตุผลที่เลือก', v_card.code;
    end if;

    v_supc := upper(btrim(coalesce(r->>'supplier', '')));
    if v_supc <> '' and not exists (select 1 from break_suppliers where code = v_supc and active) then
      raise exception 'บัตร % · ไม่พบซัพ % หรือซัพนี้ถูกปิดใช้งานแล้ว', v_card.code, v_supc;
    end if;
    /* ซัพบังคับเมื่อหลังบ้านเปิดซัพไว้อย่างน้อยหนึ่งราย · กติกาเดียวกับหน้าจอ */
    if v_supc = '' and exists (select 1 from break_suppliers where active) then
      raise exception 'บัตร % · ยังไม่ได้เลือกซัพ', v_card.code;
    end if;

    select count(*) into v_shots
      from jsonb_array_elements(coalesce(r->'photos', '[]'::jsonb)) e
     where coalesce(e->>'file_id', '') <> '' and coalesce(e->>'web_link', '') <> '';
    if v_shots = 0 then
      raise exception 'บัตร % · ยังไม่มีรูป', v_card.code;
    end if;
  end loop;

  select * into v_group from break_groups where code = v_grp and active;
  if not found then
    raise exception 'แผนกของบัตรนี้ถูกปิดใช้งานแล้ว';
  end if;

  if my_role() <> 'admin'
     and not exists (select 1 from break_group_users u
                      where u.group_code = v_grp and u.user_id = auth.uid()) then
    raise exception 'คุณไม่ได้ดูแลบัตรของแผนก %', v_grp;
  end if;

  -- เพดานหัวคน · นับทั้งชุดทีเดียว ไม่ใช่ไล่ทีละใบแล้วตันกลางทาง
  if v_group.max_people > 0 then
    select coalesce(sum(people), 0) into v_heads
      from break_passes where group_code = v_grp and closed_at is null;
    if v_heads + v_n > v_group.max_people then
      raise exception 'แผนก % ออกพร้อมกันได้ % คน ตอนนี้ออกไปแล้ว % คน ชุดนี้อีก % คนจะเกิน',
                      v_grp, v_group.max_people, v_heads, v_n;
    end if;
  end if;

  if v_group.max_open > 0 then
    select count(*) into v_open
      from break_passes where group_code = v_grp and closed_at is null;
    if v_open + v_n > v_group.max_open then
      raise exception 'แผนก % ปล่อยพร้อมกันได้ % ใบ ตอนนี้ออกไปแล้ว % ใบ',
                      v_grp, v_group.max_open, v_open;
    end if;
  end if;

  select * into v_ban from break_ban_now();
  if v_ban.id is not null and coalesce(btrim(p_ban_reason), '') = '' then
    raise exception 'ตอนนี้อยู่ในช่วงห้ามเบรค (%) ถ้าจำเป็นต้องปล่อย ให้กรอกเหตุผลฉุกเฉิน',
                    coalesce(v_ban.note, 'ไม่ได้ระบุเหตุผล');
  end if;

  -- ── ผ่านหมดแล้วค่อยเขียน ──
  for r in select * from jsonb_array_elements(p_rows) loop
    select * into v_card from break_cards where code = r->>'card';
    v_min := coalesce(nullif(r->>'minutes', '')::int, p_minutes);
    select * into v_reason from break_reasons
     where code = coalesce(nullif(r->>'reason', ''), p_reason);
    v_supc := upper(btrim(coalesce(r->>'supplier', '')));

    v_ref := 'BRK-' || (extract(year from v_now)::int + 543)::text
             || '-' || lpad(nextval('break_pass_seq')::text, 5, '0');

    insert into break_passes (
      ref_no, card_code, group_code,
      reason_code, reason_label, people, minutes, nickname, supplier,
      issued_by, issued_at, due_at,
      in_ban, ban_reason
    ) values (
      v_ref, v_card.code, v_card.group_code,
      v_reason.code, v_reason.label, 1, v_min,
      nullif(btrim(coalesce(r->>'nickname', '')), ''),
      nullif(v_supc, ''),
      /* เวลาเริ่มเดินพร้อมกันทุกใบ ไม่ใช่ตอนถ่ายรูปแต่ละคน */
      auth.uid(), v_now, v_now + make_interval(mins => v_min),
      (v_ban.id is not null), nullif(btrim(coalesce(p_ban_reason, '')), '')
    ) returning id into v_id;

    insert into break_photos (pass_id, phase, file_id, web_link, bytes, taken_by)
    select v_id, 'issue', e->>'file_id', e->>'web_link', (e->>'bytes')::integer, auth.uid()
      from jsonb_array_elements(r->'photos') e
     where coalesce(e->>'file_id', '') <> '' and coalesce(e->>'web_link', '') <> '';

    v_out := v_out || jsonb_build_object(
      'id', v_id, 'ref_no', v_ref, 'card', v_card.code,
      'minutes', v_min, 'reason', v_reason.label,
      'supplier', nullif(v_supc, ''),
      'due_at', v_now + make_interval(mins => v_min)
    );
  end loop;

  if v_ban.id is not null then
    perform break_alert_fire();
  end if;

  return jsonb_build_object(
    'ok', true, 'n', v_n, 'issued_at', v_now,
    'in_ban', (v_ban.id is not null), 'ban_note', v_ban.note,
    'rows', v_out
  );
end $fn$;

grant execute on function break_issue_many(jsonb, text, integer, text) to authenticated;


-- ---------------------------------------------------------------------
-- หน้าจอต้องรู้ว่าแผนกนี้ใช้กฎใบละคนหรือยัง
-- ---------------------------------------------------------------------
do $mig$
declare v_src text;
begin
  -- หน้าปล่อยบัตร
  select pg_get_functiondef(oid) into v_src from pg_proc where proname = 'break_my_cards';
  if position('one_per_card' in v_src) > 0 then
    raise notice 'break_my_cards มี one_per_card อยู่แล้ว';
  else
    if (length(v_src) - length(replace(v_src, '''max_people'', g.max_people,', ''))) = 0 then
      raise exception 'หาจุดต่อใน break_my_cards ไม่เจอ';
    end if;
    v_src := replace(
      v_src,
      '''max_people'', g.max_people,',
      '''max_people'', g.max_people,' || chr(10) ||
      '               ''one_per_card'', g.one_per_card,'
    );
    execute v_src;
  end if;

  -- หลังบ้าน
  select pg_get_functiondef(oid) into v_src from pg_proc where proname = 'break_settings';
  if position('one_per_card' in v_src) > 0 then
    raise notice 'break_settings มี one_per_card อยู่แล้ว';
  else
    if (length(v_src) - length(replace(v_src, '''max_people'', g.max_people,', ''))) = 0 then
      raise exception 'หาจุดต่อใน break_settings ไม่เจอ';
    end if;
    v_src := replace(
      v_src,
      '''max_people'', g.max_people,',
      '''max_people'', g.max_people, ''one_per_card'', g.one_per_card,'
    );
    execute v_src;
  end if;
end $mig$;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'break_groups' and column_name = 'one_per_card')     as มีคอลัมน์,
  (select count(*) from break_groups where one_per_card)                    as แผนกที่เปิดกฎแล้ว,
  (select count(*) from pg_proc where proname = 'break_issue_many')         as มีฟังก์ชันปล่อยหลายใบ,
  (select count(*) from pg_proc p where p.proname = 'break_my_cards'
     and pg_get_functiondef(p.oid) like '%one_per_card%')                   as หน้าปล่อยรู้แล้ว,
  (select count(*) from pg_proc p where p.proname = 'break_settings'
     and pg_get_functiondef(p.oid) like '%one_per_card%')                   as หลังบ้านรู้แล้ว,
  (select count(*) from pg_proc where proname = 'break_issue')              as break_issueเดิมยังอยู่;
