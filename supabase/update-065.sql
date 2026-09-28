-- =====================================================================
-- BPL SUPPLY — ด่านปิดกล้องเมื่อไม่มีประชุม
-- รันต่อจาก 064
--
-- แยกไฟล์ออกมาตั้งใจ เพราะนี่คือตัวเดียวในชุดนี้ที่เปลี่ยนพฤติกรรมหน้างานทันที
-- ที่รันไปแล้ว (064) เป็นการเพิ่มของใหม่ล้วน ๆ กล้องยังเปิดเหมือนเดิมทุกประการ
--
-- พอรันไฟล์นี้ ใครที่กดส่งเช็คอินตอนไม่มีนัดประชุมจะโดนปฏิเสธทันที
-- ซึ่งเป็นสิ่งที่ตั้งใจ แต่ควรรันตอนที่พร้อมและบอกทีมแล้ว ไม่ใช่กลางกะ
-- =====================================================================

-- ---------------------------------------------------------------------
-- เช็คอิน — ปฏิเสธเมื่อไม่มีนัดเปิดอยู่
--
-- หน้าจอซ่อนปุ่มให้แล้ว แต่ต้องกันที่นี่ด้วย
-- ไม่งั้นยิง API ตรงก็ยังสร้างใบเช็คอินลอย ๆ ได้อยู่ดี (CLAUDE.md ข้อ 5)
-- ---------------------------------------------------------------------
create or replace function meeting_checkin(
  p_file_id  text,
  p_web_link text default null,
  p_bytes    integer default null,
  p_note     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me    profiles%rowtype;
  v_dup   meeting_checkins%rowtype;
  v_ref   text;
  v_id    uuid;
  v_ev    meeting_events%rowtype;
  v_late  boolean := false;
  v_lmin  integer := null;
begin
  select * into v_me from profiles where id = auth.uid();
  if v_me.id is null or not v_me.is_active then
    raise exception 'บัญชีนี้ใช้งานไม่ได้';
  end if;

  if p_file_id is null or btrim(p_file_id) = '' then
    raise exception 'ต้องมีรูปเซลฟี่ก่อนถึงจะเช็คอินได้';
  end if;

  -- นัดที่เปิดให้เช็คชื่ออยู่ตอนนี้
  select * into v_ev
    from meeting_events
   where cancelled_at is null
     and closed_at is null
     and now() >= meet_at - (open_before_min || ' minutes')::interval
     and meet_at > now() - interval '2 days'
   order by meet_at
   limit 1;

  if v_ev.id is null then
    -- แยกข้อความให้รู้ว่าเพราะอะไร จะได้ไม่งงว่าทำไมกดไม่ได้
    if exists (
      select 1 from meeting_events
       where cancelled_at is null and closed_at is not null
         and closed_at > now() - interval '2 hours'
    ) then
      raise exception 'ปิดประชุมไปแล้ว เช็คชื่อไม่ได้ ติดต่อผู้ตรวจสอบ';
    elsif exists (
      select 1 from meeting_events
       where cancelled_at is null and closed_at is null
         and now() < meet_at - (open_before_min || ' minutes')::interval
         and meet_at < now() + interval '2 days'
    ) then
      raise exception 'ยังไม่ถึงเวลาเช็คชื่อ รอให้ถึงเวลาที่ประกาศไว้ก่อน';
    else
      raise exception 'ตอนนี้ไม่มีนัดประชุม เช็คชื่อไม่ได้';
    end if;
  end if;

  if now() > v_ev.meet_at + (v_ev.late_after_min || ' minutes')::interval then
    v_late := true;
    v_lmin := floor(extract(epoch from
      now() - (v_ev.meet_at + (v_ev.late_after_min || ' minutes')::interval)) / 60)::int;
  end if;

  select * into v_dup
    from meeting_checkins
   where user_id = v_me.id and event_id = v_ev.id
   order by created_at desc
   limit 1;

  if v_dup.id is not null then
    return jsonb_build_object(
      'id', v_dup.id, 'ref_no', v_dup.ref_no,
      'created_at', v_dup.created_at, 'duplicate', true,
      'is_late', v_dup.is_late, 'late_min', v_dup.late_min
    );
  end if;

  v_ref := next_meeting_ref();
  insert into meeting_checkins (ref_no, user_id, hub_code, dept_code, sub_dept,
                                shift_start, shift_end, note, file_id, web_link, bytes,
                                event_id, is_late, late_min)
  values (v_ref, v_me.id, coalesce(v_me.hub_code, 'BPL'), v_me.dept_code, v_me.sub_dept,
          v_me.shift_start, v_me.shift_end, nullif(btrim(p_note), ''),
          p_file_id, p_web_link, p_bytes,
          v_ev.id, v_late, v_lmin)
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id, 'ref_no', v_ref, 'created_at', now(), 'duplicate', false,
    'is_late', v_late, 'late_min', v_lmin
  );
end $$;

grant execute on function meeting_checkin(text, text, integer, text) to authenticated;



-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname = 'meeting_checkin') as ฟังก์ชันเช็คอิน,
  (select count(*) from meeting_events
    where cancelled_at is null and closed_at is null)              as นัดที่เปิดอยู่;
