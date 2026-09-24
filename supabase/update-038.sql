-- =====================================================================
-- BPL SUPPLY — ประกาศนัดประชุมแล้วแจ้งเตือนออกทันที
-- รันต่อจาก 037 · ปลอดภัยที่จะรันซ้ำ
--
-- เดิมทุกอย่างรอนาฬิกาที่เดินทุก 5 นาที ซึ่งพอดีกับงานที่รอได้
-- อย่างของใกล้หมดหรือของค้างคืน แต่ไม่พอดีกับการประกาศ
--
-- คนกดปุ่ม "ประกาศและแจ้งเตือนทุกคน" แล้วคาดว่าจะออกเดี๋ยวนั้น
-- พอเงียบไปสี่นาทีก็สรุปว่าพัง ทั้งที่แค่ยังไม่ถึงรอบ
-- (ของจริงที่เจอ: ประกาศตอน 11:55:47 นาฬิกาเพิ่งเดินไปตอน 11:55:00)
--
-- แก้โดยให้ตอนสร้างนัดเสร็จ เตะนาฬิกาหนึ่งทีเลยไม่ต้องรอ
-- งานอื่นยังเดินตามรอบเหมือนเดิม
-- =====================================================================

create or replace function create_meeting_event(
  p_title    text,
  p_meet_at  timestamptz,
  p_audience text default null,
  p_place    text default null,
  p_note     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_id uuid;
begin
  if not my_can_audit() then
    raise exception 'บัญชีนี้นัดประชุมไม่ได้';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'ต้องใส่เรื่องที่จะประชุม';
  end if;
  if p_meet_at is null then
    raise exception 'ต้องเลือกวันและเวลา';
  end if;

  insert into meeting_events (title, meet_at, audience, place, note, created_by)
  values (btrim(p_title), p_meet_at, nullif(btrim(p_audience), ''),
          nullif(btrim(p_place), ''), nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;

  -- เตะนาฬิกาทันที ไม่ต้องรอรอบถัดไป
  -- ถ้าเตะไม่สำเร็จก็ไม่ให้ล้มการสร้างนัด เดี๋ยวรอบปกติเก็บให้อยู่ดี
  begin
    perform push_tick();
  exception when others then
    raise notice 'ประกาศแล้วแต่เตะแจ้งเตือนไม่สำเร็จ (%) เดี๋ยวรอบถัดไปจะส่งให้เอง', sqlerrm;
  end;

  return jsonb_build_object('id', v_id);
end $fn$;

grant execute on function create_meeting_event(text, timestamptz, text, text, text) to authenticated;
