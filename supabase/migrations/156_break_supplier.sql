-- ---------------------------------------------------------------------
-- 156 · ชื่อซัพของคนที่ออกไปเบรค
--
-- เจ้าของระบบให้มาเจ็ดราย · PW AK SVT FN 22 AIT SKN PPS
-- เก็บเป็นตาราง ไม่ใช่ช่องพิมพ์อิสระ เพราะถ้าพิมพ์เอง วันหนึ่งจะมี
-- PW · pw · P.W. · PW(ใหม่) อยู่ในฐานเดียวกัน แล้วสรุปรายซัพไม่ได้อีกเลย
-- และที่หน้างานตอนรีบ การกดชิปเร็วกว่าพิมพ์เสมอ
--
-- รายชื่อซัพเปลี่ยนได้ตลอด ซัพเข้า-ออกเป็นเรื่องปกติ
-- จึงทำเป็นตารางที่แก้จากหลังบ้านได้ ไม่ได้ฝังเป็นรายการตายในโค้ด
--
-- ─────────────────────────────────────────────────────────────────────
-- ไฟล์นี้ยัง "ไม่บังคับ" ที่ฝั่งฐานข้อมูล · ตั้งใจให้เป็นแบบนั้น
--
-- ตอนนี้หน้างานใช้แอพอยู่ และ PWA ตัวเก่ายังค้างในเครื่องคนได้อีกหลายชั่วโมง
-- ถ้าบังคับที่ฐานข้อมูลตั้งแต่ตอนนี้ หัวหน้าที่ยังไม่ได้อัปเดตแอพ
-- จะปล่อยบัตรไม่ได้เลยทั้งกะ ทั้งที่เขาไม่ได้ทำอะไรผิด
--
-- และกฎนี้ยัง "ไม่เริ่มใช้" ด้วย · ซัพทั้งเจ็ดถูกใส่ไว้แบบปิดอยู่
-- ไม่มีซัพเปิดอยู่เลย = หน้าปล่อยบัตรไม่มีช่องซัพ เหมือนก่อนมีฟีเจอร์นี้ทุกอย่าง
-- สวิตช์อยู่ที่หลังบ้าน แท็บซัพ · เปิดรายแรกเมื่อไหร่ กฎก็เริ่มเมื่อนั้น
--
-- ส่วนการบังคับที่ฐานข้อมูลอยู่ในไฟล์ 158 ให้รันหลังแอพตัวใหม่ขึ้นครบแล้ว
-- ---------------------------------------------------------------------

create table if not exists break_suppliers (
  code       text primary key,
  name       text not null,
  active     boolean not null default true,
  sort       integer not null default 100,
  created_at timestamptz not null default now()
);

-- ใส่ไว้แบบ "ปิดอยู่" ทั้งเจ็ดราย · เจ้าของระบบจะเปิดเองเมื่อพร้อม
-- ปิดหมด = หน้าปล่อยบัตรไม่มีช่องซัพเลย เหมือนก่อนมีฟีเจอร์นี้ทุกอย่าง
-- เปลี่ยนขั้นตอนของคนหน้างานกลางกะคือเรื่องใหญ่ ต้องบอกเขาก่อน
-- ไม่ใช่จู่ ๆ ปุ่มที่เคยกดได้ก็กดไม่ได้เพราะมีช่องใหม่โผล่มา
insert into break_suppliers (code, name, sort, active) values
  ('PW',   'PW',    10, false),
  ('AK',   'AK',    20, false),
  ('SVT',  'SVT',   30, false),
  ('FN22', 'FN 22', 40, false),
  ('AIT',  'AIT',   50, false),
  ('SKN',  'SKN',   60, false),
  ('PPS',  'PPS',   70, false)
on conflict (code) do nothing;

alter table break_suppliers enable row level security;

-- อ่านได้เท่ากับคนที่อ่านบัตรได้ · แก้ได้เท่ากับคนที่จัดการบัตรได้
drop policy if exists read_break_suppliers on break_suppliers;
create policy read_break_suppliers on break_suppliers for select to authenticated
  using (my_can_break_issue() or my_can_break_guard() or my_can_audit());


-- เก็บเป็นสำเนาในใบ ไม่ได้ join ตอนอ่าน
-- เหตุผลเดียวกับ reason_label · ประวัติต้องอ่านได้เหมือนเดิมแม้ซัพจะถูกลบทีหลัง
alter table break_passes add column if not exists supplier text;

comment on column break_passes.supplier is
  'ชื่อซัพของคนที่ออกไปเบรค · สำเนาไว้ในใบ ไม่ได้ join ตอนอ่าน';

create index if not exists break_passes_supplier_idx
  on break_passes (supplier, issued_at desc);


-- ---------------------------------------------------------------------
-- รายชื่อซัพให้หน้าปล่อยบัตร
-- ---------------------------------------------------------------------
create or replace function break_suppliers_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'active', s.active)
              order by s.sort, s.code)
       from break_suppliers s
      where s.active
        and (my_can_break_issue() or my_can_break_guard() or my_can_audit())),
    '[]'::jsonb
  );
$$;

grant execute on function break_suppliers_list() to authenticated;


-- ---------------------------------------------------------------------
-- เพิ่ม แก้ ปิด ซัพ · สิทธิ์เดียวกับคนที่จัดการบัตร
--
-- ไม่มีลบออกจากตาราง มีแต่ปิดการใช้งาน
-- เพราะใบเก่าเก็บชื่อซัพไว้เป็นข้อความอยู่แล้ว ลบแถวทิ้งจึงไม่ได้ทำให้ประวัติหาย
-- แต่ถ้าลบแล้วมีคนเพิ่มรหัสเดิมกลับมาทีหลังโดยหมายถึงคนละเจ้า
-- ประวัติสองช่วงจะถูกนับรวมกันโดยไม่มีใครรู้
-- ---------------------------------------------------------------------
create or replace function break_supplier_set(
  p_code   text,
  p_name   text default null,
  p_active boolean default true,
  p_sort   integer default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_name, ''));
begin
  perform break_card_guard();

  if v_code = '' then
    raise exception 'ต้องใส่รหัสซัพ';
  end if;
  if v_code !~ '^[A-Z0-9]{1,12}$' then
    raise exception 'รหัสซัพใช้ได้แค่ A-Z กับ 0-9 ยาวไม่เกิน 12 ตัว ไม่มีเว้นวรรค';
  end if;

  insert into break_suppliers (code, name, active, sort)
  values (v_code, coalesce(nullif(v_name, ''), v_code), coalesce(p_active, true),
          coalesce(p_sort, 100))
  on conflict (code) do update
    set name   = coalesce(nullif(v_name, ''), break_suppliers.name),
        active = coalesce(p_active, break_suppliers.active),
        sort   = coalesce(p_sort, break_suppliers.sort);

  return jsonb_build_object('ok', true, 'code', v_code);
end $$;

grant execute on function break_supplier_set(text, text, boolean, integer) to authenticated;


-- ---------------------------------------------------------------------
-- break_issue รับชื่อซัพ
--
-- ต้องทิ้งลายเซ็นเดิมก่อน ไม่งั้นจะได้ฟังก์ชันสองตัวชื่อเดียวกัน
-- แล้วคำขอจากแอพตัวเก่าจะไปลงตัวเก่าที่ไม่รู้จักช่องซัพ โดยไม่มีอะไรฟ้อง
--
-- p_supplier มีค่าปริยายเป็น null คำขอจากแอพตัวเก่าซึ่งส่งมาเจ็ดช่อง
-- จึงยังเข้าตัวใหม่นี้ได้ตามปกติ (PostgREST จับคู่ด้วยชื่อช่อง ไม่ใช่จำนวน)
-- รอบนี้จึงไม่มีใครปล่อยบัตรไม่ได้เพราะยังไม่ได้อัปเดตแอพ
-- ---------------------------------------------------------------------
drop function if exists break_issue(text, integer, text, integer, jsonb, text, text);

create or replace function break_issue(
  p_card_code  text,
  p_people     integer,
  p_reason     text,
  p_minutes    integer default null,
  p_photos     jsonb   default '[]'::jsonb,
  p_nickname   text    default null,
  p_ban_reason text    default null,
  p_supplier   text    default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_card   break_cards%rowtype;
  v_group  break_groups%rowtype;
  v_reason break_reasons%rowtype;
  v_ban    break_bans%rowtype;
  v_sup    break_suppliers%rowtype;
  v_supc   text := upper(btrim(coalesce(p_supplier, '')));
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

  -- ชื่อซัพ · ส่งมาแล้วต้องมีอยู่จริงและยังเปิดใช้งาน
  -- ไม่ส่งมาเลยยังผ่านได้ในไฟล์นี้ ดูเหตุผลที่หัวไฟล์ · ไฟล์ 157 จะปิดช่องนี้
  if v_supc <> '' then
    select * into v_sup from break_suppliers where code = v_supc and active;
    if not found then
      raise exception 'ไม่พบซัพ % หรือซัพนี้ถูกปิดใช้งานแล้ว', v_supc;
    end if;
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
  select * into v_ban from break_ban_now();
  if v_ban.id is not null and coalesce(btrim(p_ban_reason), '') = '' then
    raise exception 'ตอนนี้อยู่ในช่วงห้ามเบรค (%) ถ้าจำเป็นต้องปล่อย ให้กรอกเหตุผลฉุกเฉิน',
                    coalesce(v_ban.note, 'ไม่ได้ระบุเหตุผล');
  end if;

  v_ref := 'BRK-' || (extract(year from v_now)::int + 543)::text
           || '-' || lpad(nextval('break_pass_seq')::text, 5, '0');

  insert into break_passes (
    ref_no, card_code, group_code,
    reason_code, reason_label, people, minutes, nickname, supplier,
    issued_by, issued_at, due_at,
    in_ban, ban_reason
  ) values (
    v_ref, v_card.code, v_card.group_code,
    v_reason.code, v_reason.label, p_people, v_min,
    nullif(btrim(coalesce(p_nickname, '')), ''),
    nullif(v_supc, ''),
    auth.uid(), v_now, v_now + (v_min || ' minutes')::interval,
    (v_ban.id is not null), nullif(btrim(coalesce(p_ban_reason, '')), '')
  ) returning id into v_id;

  insert into break_photos (pass_id, phase, file_id, web_link, bytes, taken_by)
  select v_id, 'issue', e->>'file_id', e->>'web_link', (e->>'bytes')::integer, auth.uid()
    from jsonb_array_elements(p_photos) e
   where coalesce(e->>'file_id', '') <> '' and coalesce(e->>'web_link', '') <> '';

  if v_ban.id is not null then
    perform break_alert_fire();
  end if;

  return jsonb_build_object(
    'id', v_id, 'ref_no', v_ref, 'card_code', v_card.code,
    'people', p_people, 'minutes', v_min, 'supplier', nullif(v_supc, ''),
    'issued_at', v_now, 'due_at', v_now + (v_min || ' minutes')::interval,
    'in_ban', (v_ban.id is not null), 'ban_note', v_ban.note
  );
end $$;

grant execute on function
  break_issue(text, integer, text, integer, jsonb, text, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- รปภ ต้องเห็นชื่อซัพตอนสแกนด้วย
--
-- ที่ประตูคนต่อแถว สิ่งที่ รปภ ต้องตอบให้ได้คือ "กลุ่มนี้ใช่คนของใบนี้ไหม"
-- รูปบอกหน้า ชื่อซัพบอกว่าเป็นคนของเจ้าไหน สองอย่างรวมกันแม่นกว่าอย่างเดียว
-- ---------------------------------------------------------------------
do $mig$
declare v_src text;
begin
  select pg_get_functiondef(oid) into v_src from pg_proc where proname = 'break_scan';
  if v_src is null then
    raise exception 'ยังไม่มีฟังก์ชัน break_scan';
  end if;
  if position('supplier' in v_src) > 0 then
    raise notice 'break_scan มี supplier อยู่แล้ว';
  else
    if (length(v_src) - length(replace(v_src, '''nickname'',     v_p.nickname,', ''))) = 0 then
      raise exception 'หาช่องชื่อเล่นใน break_scan ไม่เจอ';
    end if;
    v_src := replace(
      v_src,
      '''nickname'',     v_p.nickname,',
      '''nickname'',     v_p.nickname,' || chr(10) ||
      '    ''supplier'',     v_p.supplier,'
    );
    execute v_src;
  end if;
end $mig$;


-- ---------------------------------------------------------------------
-- ประวัติและสถิติต้องเห็นชื่อซัพ · เพิ่มท้ายวิว ไม่ได้สลับลำดับของเดิม
-- ---------------------------------------------------------------------
create or replace view break_rows
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
       p.issued_by,
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
       (select count(*) from break_photos ph where ph.pass_id = p.id and ph.phase = 'return') as return_shots,
       p.supplier
  from break_passes p
  join profiles i on i.id = p.issued_by
  left join profiles c on c.id = p.closed_by;

grant select on break_rows to authenticated;


-- ---------------------------------------------------------------------
-- หน้าหลังบ้านต้องเห็นรายชื่อซัพเพื่อจัดการ
-- ---------------------------------------------------------------------
do $mig$
declare v_src text;
begin
  select pg_get_functiondef(oid) into v_src from pg_proc where proname = 'break_settings';
  if position('suppliers' in v_src) > 0 then
    raise notice 'break_settings มี suppliers อยู่แล้ว';
  else
    if (length(v_src) - length(replace(v_src, '''alert_subs'', coalesce((', ''))) = 0 then
      raise exception 'หาจุดต่อใน break_settings ไม่เจอ';
    end if;
    v_src := replace(
      v_src,
      '''alert_subs'', coalesce((',
      '''suppliers'', coalesce((' || chr(10) ||
      '      select jsonb_agg(jsonb_build_object(' || chr(10) ||
      '               ''code'', s.code, ''name'', s.name,' || chr(10) ||
      '               ''active'', s.active, ''sort'', s.sort' || chr(10) ||
      '             ) order by s.sort, s.code)' || chr(10) ||
      '        from break_suppliers s), ''[]''::jsonb),' || chr(10) || chr(10) ||
      '    ''alert_subs'', coalesce(('
    );
    execute v_src;
  end if;
end $mig$;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from break_suppliers)                                   as ซัพในระบบ,
  (select count(*) from information_schema.columns
    where table_name = 'break_passes' and column_name = 'supplier')        as คอลัมน์ในใบ,
  (select count(*) from information_schema.columns
    where table_name = 'break_rows' and column_name = 'supplier')          as วิวส่งแล้ว,
  (select count(*) from pg_proc where proname = 'break_issue')             as break_issueมีกี่ตัว,
  (select count(*) from pg_proc p where p.proname = 'break_scan'
     and pg_get_functiondef(p.oid) like '%supplier%')                      as รปภเห็นแล้ว,
  (select count(*) from pg_proc p where p.proname = 'break_settings'
     and pg_get_functiondef(p.oid) like '%suppliers%')                     as หลังบ้านเห็นแล้ว;
