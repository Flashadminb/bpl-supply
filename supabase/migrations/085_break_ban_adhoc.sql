-- =====================================================================
-- BPL SUPPLY — ห้ามเบรคแบบกดเดี๋ยวนี้ และสิทธิ์คนกด
-- รันต่อจาก 084 · ปลอดภัยที่จะรันซ้ำ
--
-- ของเดิมมีแต่ช่วงห้ามแบบประจำวัน เช่น ทุกวัน 04:00–04:30
-- ซึ่งไม่ตรงกับงานจริง เจ้าของระบบบอกว่าใช้เป็นครั้งคราว
-- บางวันไม่ใช้ บางวันเปลี่ยนเวลา ต้องมานั่งแก้ตั้งค่าทุกครั้งซึ่งไม่มีใครทำทัน
--
-- เพิ่มสองอย่าง
--   ① ห้ามแบบครั้งเดียว มีเวลาเริ่มจบจริง ไม่ใช่นาทีของทุกวัน
--      กดจากมือถือได้เลย "ห้ามเบรค 30 นาทีจากนี้" แล้วมันหมดอายุเอง
--      ไม่ต้องกลับมาปิด ซึ่งเป็นจุดที่ของเดิมพังที่สุด — คนลืมปิดแล้วห้ามยาวทั้งวัน
--   ② ธงสิทธิ์ว่าใครกดได้ แยกจากคนที่ปล่อยบัตรและคนที่สแกน
--      เป็นอำนาจคนละชั้น คนกดห้ามไม่จำเป็นต้องแตะบัตรเลยสักใบ
--
-- ของเดิมไม่ถูกแตะ ช่วงห้ามประจำวันที่ตั้งไว้แล้วยังทำงานเหมือนเดิมทุกประการ
-- =====================================================================


-- ---------------------------------------------------------------------
-- สิทธิ์กดห้ามเบรค
-- ---------------------------------------------------------------------
alter table profiles add column if not exists can_break_ban boolean not null default false;

comment on column profiles.can_break_ban is 'กดห้ามเบรคเดี๋ยวนี้ และยกเลิกได้ จากในแอป';

create or replace function my_can_break_ban() returns boolean
language sql stable security definer set search_path = public as $$
  select my_role() = 'admin'
      or coalesce((select p.can_break_ban from profiles p where p.id = auth.uid()), false);
$$;

grant execute on function my_can_break_ban() to authenticated;


-- ---------------------------------------------------------------------
-- ช่วงห้ามครั้งเดียว
--
-- daily ใช้ start_min/end_min เหมือนเดิม · once ใช้ starts_at/ends_at
-- ไม่ยุบเป็นรูปแบบเดียวกันเพราะสองอย่างนี้ต่างกันจริง
-- ประจำวันต้องวนทุกวันและต้องรองรับช่วงคร่อมเที่ยงคืน
-- ส่วนครั้งเดียวต้องหมดอายุเองและต้องยกเลิกกลางคันได้
-- ---------------------------------------------------------------------
alter table break_bans add column if not exists kind text not null default 'daily';
alter table break_bans add column if not exists starts_at timestamptz;
alter table break_bans add column if not exists ends_at   timestamptz;

alter table break_bans drop constraint if exists break_bans_kind_chk;
alter table break_bans add constraint break_bans_kind_chk check (kind in ('daily', 'once'));

-- ห้ามครั้งเดียวไม่มีนาทีของวัน ต้องยอมให้ว่างได้
alter table break_bans alter column start_min drop not null;
alter table break_bans alter column end_min   drop not null;

-- หาเฉพาะช่วงที่ยังไม่หมดอายุ · ตารางนี้ถูกอ่านทุกครั้งที่หัวหน้าเปิดหน้าปล่อยบัตร
create index if not exists break_bans_once_idx on break_bans (ends_at) where kind = 'once';


-- ---------------------------------------------------------------------
-- ช่วงห้ามที่ครอบเวลาตอนนี้อยู่ · เขียนทับของเดิมให้รู้จักทั้งสองแบบ
--
-- ครั้งเดียวมาก่อนประจำวัน เพราะถ้ามีทั้งคู่ ข้อความที่ควรโชว์คือของที่เพิ่งกด
-- ไม่ใช่ของที่ตั้งค้างไว้เมื่อเดือนที่แล้ว
-- ---------------------------------------------------------------------
create or replace function break_ban_now() returns break_bans
language sql stable security definer set search_path = public as $$
  -- เลือก id ก่อนแล้วค่อยดึงทั้งแถว
  -- ถ้า union แถวเต็มพร้อมคอลัมน์จัดอันดับ คอลัมน์นั้นจะติดไปกับผลลัพธ์ด้วย
  -- แล้วรูปร่างจะไม่ตรงกับ break_bans ที่ประกาศว่าจะคืน
  select b.* from break_bans b
   where b.id = (
     select x.id from (
       select b2.id, 0 as pri
         from break_bans b2
        where b2.active and b2.kind = 'once'
          and b2.starts_at <= now() and b2.ends_at > now()

       union all

       select b2.id, 1 as pri
         from break_bans b2,
              lateral (
                select (extract(hour from (now() at time zone 'Asia/Bangkok')) * 60
                      + extract(minute from (now() at time zone 'Asia/Bangkok')))::int as m
              ) t
        where b2.active and b2.kind = 'daily'
          and b2.start_min is not null and b2.end_min is not null
          and case
                when b2.start_min <= b2.end_min then t.m >= b2.start_min and t.m < b2.end_min
                -- ช่วงที่ข้ามเที่ยงคืน
                else t.m >= b2.start_min or t.m < b2.end_min
              end
     ) x
     order by x.pri, x.id
     limit 1
   );
$$;

grant execute on function break_ban_now() to authenticated;


-- ---------------------------------------------------------------------
-- กดห้ามเดี๋ยวนี้
--
-- มีช่วงห้ามครั้งเดียวที่ยังไม่หมดอายุได้ทีละอันเท่านั้น
-- กดซ้ำ = เลื่อนเวลาจบของอันเดิม ไม่ใช่สร้างอันใหม่ซ้อน
-- ถ้าสร้างซ้อนได้ พอกดยกเลิกจะเหลือตัวที่ซ่อนอยู่ข้างหลังแล้วยังห้ามต่อ
-- ซึ่งคนกดจะงงมากว่ายกเลิกแล้วทำไมยังห้าม
-- ---------------------------------------------------------------------
create or replace function break_ban_quick(
  p_minutes integer,
  p_note    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id   bigint;
  v_end  timestamptz := now() + (p_minutes || ' minutes')::interval;
begin
  if not my_can_break_ban() then
    raise exception 'ไม่มีสิทธิ์สั่งห้ามเบรค';
  end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 720 then
    raise exception 'ห้ามได้ครั้งละ 1 ถึง 720 นาที';
  end if;

  select id into v_id
    from break_bans
   where kind = 'once' and active and ends_at > now()
   order by ends_at desc
   limit 1;

  if v_id is null then
    insert into break_bans (kind, starts_at, ends_at, note, active, created_by)
    values ('once', now(), v_end, nullif(btrim(coalesce(p_note, '')), ''), true, auth.uid())
    returning id into v_id;
  else
    update break_bans
       set ends_at = v_end,
           note    = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note),
           created_by = auth.uid()
     where id = v_id;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'until', v_end);
end $$;


-- ---------------------------------------------------------------------
-- ยกเลิกเดี๋ยวนี้
--
-- ตั้งเวลาจบเป็นตอนนี้ ไม่ได้ลบทิ้ง
-- ประวัติจะยังอ่านได้ว่าเคยห้ามตั้งแต่กี่โมงถึงกี่โมง ใครสั่ง
-- ลบทิ้งแล้วใบที่ติดป้าย "ปล่อยในช่วงห้าม" จะอธิบายไม่ได้ว่าห้ามเพราะอะไร
-- ---------------------------------------------------------------------
create or replace function break_ban_stop() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if not my_can_break_ban() then
    raise exception 'ไม่มีสิทธิ์ยกเลิกช่วงห้ามเบรค';
  end if;

  update break_bans
     set ends_at = now()
   where kind = 'once' and active and ends_at > now();

  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'stopped', v_n);
end $$;


-- ---------------------------------------------------------------------
-- ช่วงห้ามประจำวัน — แก้เวลาได้ ไม่ต้องลบแล้วสร้างใหม่
-- เขียนทับของเดิมเพื่อใส่ kind ให้ชัด ของเดิมทุกแถวเป็น daily อยู่แล้ว
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
    insert into break_bans (kind, start_min, end_min, note, active, created_by)
    values ('daily', p_start_min, p_end_min,
            nullif(btrim(coalesce(p_note, '')), ''), p_active, auth.uid())
    returning id into v_id;
  else
    update break_bans
       set start_min = p_start_min, end_min = p_end_min,
           note = nullif(btrim(coalesce(p_note, '')), ''), active = p_active
     where id = p_id and kind = 'daily'
    returning id into v_id;
    if v_id is null then raise exception 'ไม่พบช่วงห้ามประจำวันนี้'; end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;


-- ---------------------------------------------------------------------
-- ของตั้งค่าทั้งหมด — เติมช่องใหม่ของช่วงห้าม และคนที่กดห้ามได้
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

    -- ประจำวันเท่านั้น · ของครั้งเดียวดูจาก ban_now ในหน้าแอป ไม่ต้องมาคาหน้าตั้งค่า
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


grant execute on function break_ban_quick(integer, text) to authenticated;
grant execute on function break_ban_stop()                to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'profiles' and column_name = 'can_break_ban')      as ธงสิทธิ์กดห้าม,
  (select count(*) from information_schema.columns
    where table_name = 'break_bans' and column_name in
      ('kind', 'starts_at', 'ends_at'))                                   as ช่องใหม่ของช่วงห้าม,
  (select count(*) from break_bans where kind = 'daily')                  as ช่วงห้ามประจำวัน,
  (select count(*) from break_bans where kind = 'once' and ends_at > now()) as ห้ามอยู่ตอนนี้,
  (select count(*) from pg_proc
    where proname in ('break_ban_quick', 'break_ban_stop', 'my_can_break_ban')) as ฟังก์ชันใหม่;
