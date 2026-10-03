-- =====================================================================
-- BPL SUPPLY — ใบเช็คอินรวมร่างเป็นหน้าเดียว
-- รันต่อจาก 092 · ปลอดภัยที่จะรันซ้ำ
--
-- ของเดิมมีสองหน้าที่พูดเรื่องเดียวกัน
--   "ใบเช็คอิน"  รายการใบเรียงยาว ๆ ปนทุกนัด มีรูป มีโน้ตที่คนเขียนมา กดยืนยัน/ตีตก/ลบได้
--   "ตามนัด"     แยกเป็นเซตตามนัด เห็นคนที่ขาดด้วย แก้สถานะมา/สาย/ลา/ขาดได้
-- คนใช้งานต้องสลับไปมาเพราะของที่ต้องใช้พร้อมกันอยู่คนละหน้า
--
-- ตัวนี้ยกของที่มีแต่ในหน้าใบเช็คอิน — รูป โน้ตของเจ้าตัว สถานะใบ และรหัสใบเพื่อลบ
-- เข้ามาใน meeting_roster ให้หมด แล้วหน้าใบเรียงยาวก็ไม่ต้องมีอีก
-- =====================================================================

-- เพิ่มคอลัมน์ออกจึงต้อง drop ก่อน · create or replace เปลี่ยน return type ไม่ได้
drop function if exists meeting_roster(uuid);

create function meeting_roster(p_event uuid)
returns table (
  user_id       uuid,
  full_name     text,
  employee_code text,
  dept_code     text,
  checked_at    timestamptz,
  ref_no        text,
  raw_state     text,
  state         text,
  late_min      integer,
  reason        text,
  by_name       text,
  changed_at    timestamptz,
  -- ของที่เพิ่มเข้ามารอบนี้ ยกมาจากหน้าใบเช็คอินเดิมทั้งก้อน
  checkin_id    uuid,
  file_id       text,
  note          text,
  status        text,
  decided_by_name text,
  decide_note   text
)
language sql stable security definer set search_path = public as $$
  with e as (select * from meeting_events where id = p_event),
  base as (
    select p.id, p.full_name, p.employee_code, p.dept_code,
           c.id as checkin_id, c.created_at as checked_at, c.ref_no,
           c.is_late, c.late_min, c.file_id, c.note,
           c.status::text as status, c.decided_by, c.decide_note
      from meeting_expected(p_event) x
      join profiles p on p.id = x.user_id
      left join meeting_checkins c on c.event_id = p_event and c.user_id = p.id
  )
  select
    b.id, b.full_name, b.employee_code, b.dept_code,
    b.checked_at, b.ref_no,
    -- สถานะที่ระบบคำนวณ เก็บไว้ให้เห็นแม้จะถูกแก้แล้ว
    case
      when b.checked_at is not null and b.is_late then 'late'
      when b.checked_at is not null                then 'ontime'
      when now() > (select meet_at + (late_after_min || ' minutes')::interval from e)
                                                   then 'absent'
      else 'waiting'
    end,
    -- สถานะที่ใช้จริง — ของผู้ตรวจสอบชนะเสมอ
    coalesce(o.state, case
      when b.checked_at is not null and b.is_late then 'late'
      when b.checked_at is not null                then 'ontime'
      when now() > (select meet_at + (late_after_min || ' minutes')::interval from e)
                                                   then 'absent'
      else 'waiting'
    end),
    b.late_min,
    o.reason,
    bp.full_name,
    o.at,
    b.checkin_id,
    b.file_id,
    b.note,
    b.status,
    dp.full_name,
    b.decide_note
  from base b
  left join meeting_overrides o on o.event_id = p_event and o.user_id = b.id
  left join profiles bp on bp.id = o.by_user
  left join profiles dp on dp.id = b.decided_by
  order by
    case coalesce(o.state, case
      when b.checked_at is not null and b.is_late then 'late'
      when b.checked_at is not null                then 'ontime'
      else 'absent' end)
      when 'absent' then 0 when 'late' then 1 when 'excused' then 2 else 3 end,
    b.full_name;
$$;

grant execute on function meeting_roster(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- เช็คทั้งหมดในนัดเดียวด้วยการกดครั้งเดียว
--
-- งานจริงของนัดที่ทุกคนมาครบคือกดรับทั้งแผ่น ไม่ใช่ไล่กดสี่สิบคน
-- แต่การกดรับทั้งแผ่นแบบไม่ดูอะไรเลยคือวิธีทำให้คนขาดกลายเป็นคนมา
-- จึงมี p_only_checked ให้เลือกว่าจะแตะแค่คนที่ส่งใบมาจริงหรือทุกคน
-- และหน้าจอบังคับให้อ่านรายชื่อคนสาย/คนขาดก่อนถึงจะกดได้
--
-- เขียน override เฉพาะแถวที่สถานะจะเปลี่ยนจริง
-- คนที่ระบบคำนวณว่า "มาตรงเวลา" อยู่แล้วจึงไม่ถูกแปะว่า "แก้โดย..." ให้รกเปล่า ๆ
-- raw_state ที่ระบบคำนวณยังอยู่ครบ ย้อนดูได้เสมอว่าเดิมใครสายใครขาด
-- ---------------------------------------------------------------------
create or replace function meeting_attend_bulk(
  p_event        uuid,
  p_state        text default 'ontime',
  p_only_checked boolean default true,
  p_reason       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if not my_can_audit() then
    raise exception 'เฉพาะผู้ตรวจสอบและแอดมินเท่านั้นที่เช็คชื่อได้';
  end if;
  if p_state not in ('ontime', 'late', 'excused', 'absent') then
    raise exception 'สถานะไม่ถูกต้อง';
  end if;

  insert into meeting_overrides (event_id, user_id, state, reason, by_user, at)
  select p_event, r.user_id, p_state,
         nullif(btrim(coalesce(p_reason, '')), ''), auth.uid(), now()
    from meeting_roster(p_event) r
   where r.state <> p_state
     and (not p_only_checked or r.checked_at is not null)
  on conflict (event_id, user_id) do update
    set state = excluded.state, reason = excluded.reason,
        by_user = excluded.by_user, at = excluded.at;

  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'changed', v_n);
end $$;

grant execute on function meeting_attend_bulk(uuid, text, boolean, text) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.routines
    where routine_name = 'meeting_attend_bulk')                      as ฟังก์ชันเช็คทั้งหมด,
  (select count(*) from information_schema.parameters p
     join information_schema.routines r using (specific_name)
    where r.routine_name = 'meeting_roster'
      and p.parameter_mode = 'OUT')                                  as ช่องที่รายชื่อส่งกลับ,
  (select count(*) from meeting_events where cancelled_at is null)   as นัดทั้งหมด;
