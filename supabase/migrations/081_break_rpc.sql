-- =====================================================================
-- BPL SUPPLY — บัตรเบรค OS · ตัวสั่งงานและมุมมอง
-- รันต่อจาก 080 · ปลอดภัยที่จะรันซ้ำ
--
-- ทุกการเขียนอยู่ในไฟล์นี้ทั้งหมด ตาราง break_* ไม่มี policy เขียนสักตัว
-- ฝั่งเว็บจึงแก้ข้อมูลตรง ๆ ไม่ได้เลย ต้องผ่านฟังก์ชันพวกนี้ซึ่งตรวจสิทธิ์เอง
--
-- จังหวะของทั้งระบบ
--   หัวหน้า  break_issue      ← นาฬิกาเริ่มเดินตรงนี้
--   รปภ      break_scan       ดูอย่างเดียว ไม่เปลี่ยนอะไร
--   รปภ      break_gate_out   ปล่อยออก
--   รปภ      break_return     รับกลับครบ
--      หรือ  break_problem    รับแต่คนไม่ครบ + รูป + เตือนทันที
--   หลังบ้าน break_close      ปิดใบที่ไม่มีใครมารับกลับ
-- =====================================================================


-- ---------------------------------------------------------------------
-- ยิงแจ้งเตือนเดี๋ยวนี้ ไม่รอรอบนาฬิกา
--
-- งานที่ต้องเตือนคำนวณจากข้อมูลเสมอ (push_break_jobs ข้างล่าง)
-- ตัวนี้แค่ไปสะกิดให้นาฬิกาตื่นเร็วกว่ากำหนด
-- ถ้าสะกิดไม่สำเร็จก็ไม่เป็นไร รอบปกติจะเก็บให้เองในนาทีถัดไป
-- จึงห่อ exception ไว้ — แจ้งเตือนพลาดต้องไม่ทำให้ปล่อยบัตรไม่ได้
-- ---------------------------------------------------------------------
create or replace function break_alert_fire() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform push_tick();
exception when others then
  raise notice 'break_alert_fire: สะกิดนาฬิกาไม่สำเร็จ (%) รอรอบปกติ', sqlerrm;
end $$;


-- ---------------------------------------------------------------------
-- บัตรของแผนกที่ฉันดูแล พร้อมสถานะตอนนี้
--
-- security definer เพราะต้องอ่านใบที่คนอื่นปล่อยไว้เพื่อบอกว่าใบไหนไม่ว่าง
-- จึงตรวจสิทธิ์เองในฟังก์ชัน ไม่ได้พึ่ง RLS
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
               'open_now',   (select count(*) from break_passes p
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


-- ---------------------------------------------------------------------
-- ปล่อยบัตร — นาฬิกาเริ่มเดินที่บรรทัด now() ข้างล่างนี้
--
-- p_photos รูปแบบ '[{"file_id":"...","web_link":"...","bytes":123}]'
-- บังคับอย่างน้อยหนึ่งใบ และฝั่งแอปต้องอัปขึ้น Drive ให้เสร็จก่อนเรียกตัวนี้
-- เหมือนการเบิก Asset เจ้าของระบบขอให้เหมือนกันทั้งระบบ
--
-- ช่วงห้ามเบรคไม่ได้ปิดตาย ปล่อยได้ถ้ากรอกเหตุผลฉุกเฉินมา
-- แต่ใบนั้นจะติดป้าย in_ban ถาวร และเตือนคนที่เกี่ยวข้องทันที
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
  v_card    break_cards%rowtype;
  v_group   break_groups%rowtype;
  v_reason  break_reasons%rowtype;
  v_ban     break_bans%rowtype;
  v_min     integer;
  v_open    integer;
  v_ref     text;
  v_id      bigint;
  v_now     timestamptz := now();
  v_shots   integer := 0;
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

  -- เพดานของแผนก · 0 แปลว่าไม่จำกัด
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


-- ---------------------------------------------------------------------
-- รปภ สแกน — **ไม่เปลี่ยนอะไรเลย** แค่บอกว่าเห็นอะไร
--
-- แยกการอ่านออกจากการกระทำโดยตั้งใจ
-- เพราะสแกนครั้งเดียวกันอาจเป็นคนกำลังจะออก หรือคนเพิ่งกลับ ก็ได้
-- ระบบแยกไม่ออก แต่ รปภ เห็นอยู่กับตาว่าคนเดินไปทางไหน
-- จึงให้ระบบบอกสถานะ แล้ว รปภ เป็นคนกดปุ่มที่ถูกต้อง
--
-- state ที่เป็นไปได้
--   ready     เขียว  ปล่อยแล้ว ยังไม่ออก → ปล่อยออกได้
--   out       เหลือง ออกไปแล้ว → รับกลับ · หรือถ้าคนกำลังจะออกคือบัตรซ้ำ
--   closed    แดง    ปิดไปแล้ว
--   free      แดง    บัตรมีอยู่จริงแต่ไม่มีใครยื่น
--   unknown   แดง    ไม่รู้จักรหัสนี้เลย — บัตรปลอม
-- ---------------------------------------------------------------------
create or replace function break_scan(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_card break_cards%rowtype;
  v_p    break_passes%rowtype;
  v_last break_passes%rowtype;
begin
  if not my_can_break_guard() then
    raise exception 'ไม่มีสิทธิ์สแกนบัตรเบรค';
  end if;

  select * into v_card from break_cards where upper(code) = v_code;
  if not found then
    return jsonb_build_object('state', 'unknown', 'code', v_code);
  end if;

  select * into v_p from break_passes
   where card_code = v_card.code and closed_at is null
   order by issued_at desc limit 1;

  if not found then
    select * into v_last from break_passes
     where card_code = v_card.code
     order by closed_at desc nulls last limit 1;

    -- เพิ่งปิดไปหมาด ๆ มีประโยชน์กว่าบอกแค่ว่า "ไม่ได้ถูกปล่อย"
    if found and v_last.closed_at > now() - interval '2 hours' then
      return jsonb_build_object(
        'state', 'closed', 'code', v_card.code,
        'closed_at', v_last.closed_at,
        'closed_by', (select full_name from profiles where id = v_last.closed_by),
        'close_kind', v_last.close_kind
      );
    end if;
    return jsonb_build_object('state', 'free', 'code', v_card.code);
  end if;

  return jsonb_build_object(
    'state',        case when v_p.gate_out_at is null then 'ready' else 'out' end,
    'code',         v_card.code,
    'pass_id',      v_p.id,
    'people',       v_p.people,
    'reason',       v_p.reason_label,
    'minutes',      v_p.minutes,
    'nickname',     v_p.nickname,
    'issued_at',    v_p.issued_at,
    'issued_by',    (select full_name from profiles where id = v_p.issued_by),
    'due_at',       v_p.due_at,
    'gate_out_at',  v_p.gate_out_at,
    'gate_out_people', v_p.gate_out_people,
    'in_ban',       v_p.in_ban
  );
end $$;


-- ---------------------------------------------------------------------
-- ปล่อยออก — จดเวลาผ่านประตู
--
-- p_people ให้ลดได้ถ้ามาไม่ครบตามที่หัวหน้ายื่นมา แต่เพิ่มไม่ได้
-- เพิ่มไม่ได้เพราะนั่นแปลว่ามีคนเกินจากที่ได้รับอนุญาต ซึ่งต้องไม่ปล่อย
-- ---------------------------------------------------------------------
create or replace function break_gate_out(
  p_pass_id bigint,
  p_people  integer default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_p break_passes%rowtype;
  v_n integer;
begin
  if not my_can_break_guard() then
    raise exception 'ไม่มีสิทธิ์สแกนบัตรเบรค';
  end if;

  select * into v_p from break_passes where id = p_pass_id for update;
  if not found then raise exception 'ไม่พบใบนี้'; end if;
  if v_p.closed_at is not null then raise exception 'ใบนี้ปิดไปแล้ว'; end if;
  if v_p.gate_out_at is not null then
    raise exception 'ใบนี้ออกไปแล้วตั้งแต่ % — เป็นบัตรซ้ำ ไม่ต้องปล่อย',
                    to_char(v_p.gate_out_at at time zone 'Asia/Bangkok', 'HH24:MI');
  end if;

  v_n := coalesce(p_people, v_p.people);
  if v_n < 1 or v_n > v_p.people then
    raise exception 'จำนวนคนที่ออกต้องอยู่ระหว่าง 1 ถึง % ตามที่หัวหน้ายื่นมา', v_p.people;
  end if;

  update break_passes
     set gate_out_at = now(), gate_out_by = auth.uid(), gate_out_people = v_n
   where id = p_pass_id;

  return jsonb_build_object('ok', true, 'pass_id', p_pass_id, 'people', v_n);
end $$;


-- ---------------------------------------------------------------------
-- รับกลับครบ — กรณีปกติ กดปุ่มเดียวจบ
--
-- ใบที่ไม่เคยถูกสแกนขาออกก็รับกลับได้ ไม่บล็อก
-- เพราะถ้าบล็อก คนที่ รปภ พลาดไม่ได้สแกนตอนออกจะเข้าไม่ได้เลย
-- ประวัติจะเห็นเองว่า gate_out_at ว่าง = ไม่ได้สแกนขาออก
-- ---------------------------------------------------------------------
create or replace function break_return(p_pass_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_p break_passes%rowtype;
begin
  if not my_can_break_guard() then
    raise exception 'ไม่มีสิทธิ์สแกนบัตรเบรค';
  end if;

  select * into v_p from break_passes where id = p_pass_id for update;
  if not found then raise exception 'ไม่พบใบนี้'; end if;
  if v_p.closed_at is not null then
    raise exception 'ใบนี้ปิดไปแล้วเมื่อ %',
                    to_char(v_p.closed_at at time zone 'Asia/Bangkok', 'HH24:MI');
  end if;

  update break_passes
     set closed_at = now(), closed_by = auth.uid(), close_kind = 'guard',
         returned_people = coalesce(v_p.gate_out_people, v_p.people)
   where id = p_pass_id;

  return jsonb_build_object('ok', true, 'pass_id', p_pass_id,
                            'people', coalesce(v_p.gate_out_people, v_p.people));
end $$;


-- ---------------------------------------------------------------------
-- รับแต่คนไม่ครบ — ปิดใบ + แนบรูป + เตือนทันที
--
-- ใบปิดเลย ไม่ค้างไว้ เพราะคนที่หายไม่ได้ถือบัตรกลับมาอยู่แล้ว
-- ปล่อยค้างไว้จะทำให้บัตรใบนั้นใช้ต่อไม่ได้ทั้งกะโดยไม่มีประโยชน์
--
-- รูปบังคับหนึ่งใบ เอาไว้เทียบกับรูปตอนหัวหน้าปล่อย ว่าใครหายไปจากกลุ่ม
-- ---------------------------------------------------------------------
create or replace function break_problem(
  p_pass_id   bigint,
  p_problem   text,
  p_returned  integer,
  p_photo     jsonb default '[]'::jsonb,
  p_note      text  default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_p     break_passes%rowtype;
  v_shots integer := 0;
begin
  if not my_can_break_guard() then
    raise exception 'ไม่มีสิทธิ์สแกนบัตรเบรค';
  end if;

  select * into v_p from break_passes where id = p_pass_id for update;
  if not found then raise exception 'ไม่พบใบนี้'; end if;
  if v_p.closed_at is not null then raise exception 'ใบนี้ปิดไปแล้ว'; end if;

  if coalesce(btrim(p_problem), '') = '' then
    raise exception 'ต้องเลือกว่าเกิดอะไรขึ้น';
  end if;
  if p_returned is null or p_returned < 0 or p_returned > v_p.people then
    raise exception 'จำนวนคนที่กลับต้องอยู่ระหว่าง 0 ถึง %', v_p.people;
  end if;

  select count(*) into v_shots
    from jsonb_array_elements(coalesce(p_photo, '[]'::jsonb)) e
   where coalesce(e->>'file_id', '') <> '' and coalesce(e->>'web_link', '') <> '';
  if v_shots = 0 then
    raise exception 'ต้องแนบรูปอย่างน้อยหนึ่งใบตอนแจ้งปัญหา';
  end if;

  update break_passes
     set closed_at = now(), closed_by = auth.uid(), close_kind = 'problem',
         returned_people = p_returned,
         problem_code = btrim(p_problem),
         problem_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_pass_id;

  insert into break_photos (pass_id, phase, file_id, web_link, bytes, taken_by)
  select p_pass_id, 'return', e->>'file_id', e->>'web_link', (e->>'bytes')::integer, auth.uid()
    from jsonb_array_elements(p_photo) e
   where coalesce(e->>'file_id', '') <> '' and coalesce(e->>'web_link', '') <> '';

  perform break_alert_fire();

  return jsonb_build_object('ok', true, 'pass_id', p_pass_id,
                            'returned', p_returned, 'missing', v_p.people - p_returned);
end $$;


-- ---------------------------------------------------------------------
-- ปิดใบที่ไม่มีใครมารับกลับ — หลังบ้านหรือหัวหน้าที่ปล่อยเอง
--
-- เจ้าของระบบไม่เอาปิดอัตโนมัติ ให้คนกดเอง
-- เวลาที่ค้างจึงต้องไม่ถูกนับเป็นเวลาอู้ของใคร — close_kind แยกไว้ให้แล้ว
-- ---------------------------------------------------------------------
create or replace function break_close(
  p_pass_ids bigint[],
  p_note     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_kind text := case when my_can_audit() then 'admin' else 'supervisor' end;
  v_n    integer;
begin
  if not (my_can_audit() or my_can_break_issue()) then
    raise exception 'ไม่มีสิทธิ์ปิดใบเบรค';
  end if;

  with target as (
    select p.id
      from break_passes p
     where p.id = any(p_pass_ids)
       and p.closed_at is null
       and (
         my_can_audit()
         or p.issued_by = auth.uid()
         or exists (select 1 from break_group_users u
                     where u.group_code = p.group_code and u.user_id = auth.uid())
       )
  )
  update break_passes p
     set closed_at = now(), closed_by = auth.uid(), close_kind = v_kind,
         problem_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), p.problem_note)
    from target t
   where p.id = t.id;

  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'closed', v_n);
end $$;


-- =====================================================================
-- มุมมอง
-- =====================================================================

-- ---------------------------------------------------------------------
-- จอ "เบรค OS" — ใบที่ยังเปิดอยู่ · ใช้ร่วมกันสามที่
-- หัวหน้าเห็นแผนกตัวเอง · รปภ เห็นทุกใบ · หลังบ้านเห็นทุกใบ
-- ขอบเขตมาจาก RLS ของ break_passes เอง จึงใช้ view เดียวได้ทั้งสามคน
-- ---------------------------------------------------------------------
drop view if exists break_board_rows;
create view break_board_rows
with (security_invoker = true) as
select p.id,
       p.ref_no,
       p.card_code,
       p.group_code,
       p.reason_label,
       p.people,
       p.minutes,
       p.nickname,
       p.issued_at,
       p.due_at,
       p.gate_out_at,
       p.gate_out_people,
       p.in_ban,
       i.full_name as issued_by_name,
       i.employee_code as issued_by_code,
       (p.gate_out_at is null) as waiting_gate
  from break_passes p
  join profiles i on i.id = p.issued_by
 where p.closed_at is null;

grant select on break_board_rows to authenticated;


-- ---------------------------------------------------------------------
-- ประวัติ — ผู้ตรวจสอบเท่านั้น (RLS ของ break_passes คุมอยู่)
--
-- walk_sec  เวลาเดิน ยื่น → ผ่านประตู   ต่างกันตามระยะทางของแผนก
-- out_sec   เวลาอยู่ข้างนอก ผ่านประตู → กลับ   ← อันนี้เทียบข้ามแผนกได้
-- over_sec  เกินเวลาไปกี่วินาที นับจาก due_at ซึ่งอิง issued_at
--
-- ใบที่หลังบ้านปิดเองไม่คิด over_sec ให้
-- เพราะเวลาที่ค้างเกิดจากลืมกดรับกลับ ไม่ใช่คนนั้นอู้
-- ---------------------------------------------------------------------
drop view if exists break_rows;
create view break_rows
with (security_invoker = true) as
select p.id,
       p.ref_no,
       p.card_code,
       p.group_code,
       p.reason_code,
       p.reason_label,
       p.people,
       p.minutes,
       p.nickname,
       p.issued_at,
       p.due_at,
       p.gate_out_at,
       p.gate_out_people,
       p.closed_at,
       p.close_kind,
       p.returned_people,
       p.problem_code,
       p.problem_note,
       p.in_ban,
       p.ban_reason,
       p.exported_at,
       i.full_name     as issued_by_name,
       i.employee_code as issued_by_code,
       c.full_name     as closed_by_name,
       extract(epoch from (p.gate_out_at - p.issued_at))::int as walk_sec,
       extract(epoch from (p.closed_at - p.gate_out_at))::int as out_sec,
       case
         when p.close_kind in ('admin', 'supervisor') then null
         when p.closed_at is null then null
         when p.closed_at > p.due_at then extract(epoch from (p.closed_at - p.due_at))::int
         else 0
       end as over_sec,
       (p.people - coalesce(p.returned_people, p.people)) as missing_people,
       (select count(*) from break_photos ph where ph.pass_id = p.id and ph.phase = 'issue')  as issue_shots,
       (select count(*) from break_photos ph where ph.pass_id = p.id and ph.phase = 'return') as return_shots
  from break_passes p
  join profiles i on i.id = p.issued_by
  left join profiles c on c.id = p.closed_by;

grant select on break_rows to authenticated;


-- =====================================================================
-- แจ้งเตือน — ต่อท้ายของเดิม ไม่แตะงานอื่น
-- =====================================================================

-- ---------------------------------------------------------------------
-- สามเรื่องที่ต้องเตือน
--   break_ban      ปล่อยในช่วงห้าม       → ผู้ตรวจสอบ + คนที่เจ้าของเลือก
--   break_problem  คนเข้าไม่ครบ           → ผู้ตรวจสอบ + คนที่เจ้าของเลือก + หัวหน้าที่ปล่อย
--   break_over     เกินเวลา               → หัวหน้าที่ปล่อยใบนั้น
--
-- สองเรื่องแรกยิงทันทีผ่าน break_alert_fire() แต่ยังคำนวณจากข้อมูลเหมือนเดิม
-- ถ้าการยิงทันทีพลาด นาฬิการอบปกติจะเก็บให้เอง ไม่หายไปไหน
--
-- เรื่องเกินเวลาเตือนทุก 10 นาที และหยุดที่ 60 นาที
-- เลยจากนั้นใบไปโผล่ในหน้า "ใบที่ค้างอยู่" ของหลังบ้านแล้ว เตือนต่อก็ไม่มีประโยชน์
-- ---------------------------------------------------------------------
create or replace function push_break_jobs() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_jobs jsonb := '[]'::jsonb;
begin
  -- คนที่ต้องรู้เรื่องใหญ่ ๆ · ผู้ตรวจสอบเสมอ บวกคนที่เจ้าของระบบติ๊กไว้
  with watchers as (
    select id from profiles
     where is_active and (role in ('supervisor', 'admin') or coalesce(can_dispatch, false))
    union
    select s.user_id from break_alert_subs s
      join profiles p on p.id = s.user_id and p.is_active
  )

  -- ① ปล่อยในช่วงห้าม
  select coalesce(jsonb_agg(j), '[]'::jsonb) into v_jobs from (
    select jsonb_build_object(
      'kind',    'break_ban',
      'subject', p.id::text,
      'user_id', w.id,
      'title',   '🔴 ปล่อยเบรคในช่วงห้าม',
      'body',    p.card_code || ' · ' || p.people || ' คน · ' || p.reason_label ||
                 chr(10) || 'ปล่อยโดย ' || i.full_name ||
                 ' เมื่อ ' || to_char(p.issued_at at time zone 'Asia/Bangkok', 'HH24:MI') ||
                 coalesce(chr(10) || 'เหตุผล: ' || p.ban_reason, ''),
      'url',     '/break'
    ) as j
    from break_passes p
    join profiles i on i.id = p.issued_by
    cross join watchers w
    where p.in_ban
      and p.issued_at > now() - interval '12 hours'
      and not exists (select 1 from notification_log n
                       where n.kind = 'break_ban' and n.subject = p.id::text and n.user_id = w.id)
  ) g;

  -- ② คนเข้าไม่ครบ · หัวหน้าที่ปล่อยได้รับด้วย เป็นลูกน้องเขา
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(j) from (
      select jsonb_build_object(
        'kind',    'break_problem',
        'subject', p.id::text,
        'user_id', u.id,
        'title',   '🔴 เบรค OS เข้าไม่ครบ',
        'body',    p.card_code || ' · ปล่อย ' || p.people ||
                   ' คน กลับ ' || coalesce(p.returned_people, 0) || ' คน' ||
                   chr(10) || 'ปล่อยโดย ' || i.full_name ||
                   ' เมื่อ ' || to_char(p.issued_at at time zone 'Asia/Bangkok', 'HH24:MI') ||
                   chr(10) || 'แจ้งโดย ' || coalesce(c.full_name, 'รปภ') ||
                   ' เมื่อ ' || to_char(p.closed_at at time zone 'Asia/Bangkok', 'HH24:MI'),
        'url',     '/break'
      ) as j
      from break_passes p
      join profiles i on i.id = p.issued_by
      left join profiles c on c.id = p.closed_by
      cross join lateral (
        select id from profiles
         where is_active and (role in ('supervisor', 'admin') or coalesce(can_dispatch, false))
        union
        select s.user_id from break_alert_subs s
          join profiles sp on sp.id = s.user_id and sp.is_active
        union
        select p.issued_by
      ) u
      where p.close_kind = 'problem'
        and p.closed_at > now() - interval '12 hours'
        and not exists (select 1 from notification_log n
                         where n.kind = 'break_problem' and n.subject = p.id::text and n.user_id = u.id)
    ) g2
  ), '[]'::jsonb);

  -- ③ เกินเวลา · เตือนหัวหน้าที่ปล่อย ทุก 10 นาที ไม่เกินหนึ่งชั่วโมง
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(j) from (
      select jsonb_build_object(
        'kind',    'break_over',
        'subject', p.id::text || ':' || slot::text,
        'user_id', p.issued_by,
        'title',   '⏰ เบรคเกินเวลา · ' || p.card_code,
        'body',    p.people || ' คน · ' || p.reason_label ||
                   ' · ขอไว้ ' || p.minutes || ' นาที' ||
                   chr(10) || 'เกินมาแล้ว ' ||
                   floor(extract(epoch from (now() - p.due_at)) / 60)::int || ' นาที',
        'url',     '/break'
      ) as j
      from break_passes p
      cross join lateral (
        select floor(extract(epoch from (now() - p.due_at)) / 600)::int as slot
      ) s
      where p.closed_at is null
        and now() > p.due_at
        and now() < p.due_at + interval '60 minutes'
        and not exists (select 1 from notification_log n
                         where n.kind = 'break_over'
                           and n.subject = p.id::text || ':' || s.slot::text
                           and n.user_id = p.issued_by)
    ) g3
  ), '[]'::jsonb);

  return v_jobs;
end $$;

grant execute on function push_break_jobs() to authenticated, service_role;


create or replace function push_due_jobs() returns jsonb
language sql security definer set search_path = public as $$
  select push_core_jobs()
      || push_meeting_jobs()
      || push_meeting_open_jobs()
      || push_announcement_jobs()
      || push_break_jobs();
$$;

grant execute on function push_due_jobs() to authenticated, service_role;


-- ---------------------------------------------------------------------
-- สิทธิ์เรียก
-- ---------------------------------------------------------------------
grant execute on function break_my_cards()                                        to authenticated;
grant execute on function break_issue(text, integer, text, integer, jsonb, text, text) to authenticated;
grant execute on function break_scan(text)                                        to authenticated;
grant execute on function break_gate_out(bigint, integer)                         to authenticated;
grant execute on function break_return(bigint)                                    to authenticated;
grant execute on function break_problem(bigint, text, integer, jsonb, text)       to authenticated;
grant execute on function break_close(bigint[], text)                             to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname like 'break\_%')      as ฟังก์ชันเบรค,
  (select count(*) from pg_views where viewname like 'break\_%')    as มุมมองเบรค,
  jsonb_array_length(push_break_jobs())                             as งานเตือนเบรครอส่ง,
  jsonb_array_length(push_due_jobs())                               as งานเตือนรวมทุกชนิด;
