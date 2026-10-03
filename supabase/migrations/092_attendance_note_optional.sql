-- =====================================================================
-- BPL SUPPLY — แก้สถานะเข้าประชุมโดยไม่ต้องใส่เหตุผลก็ได้
-- รันต่อจาก 091 · ปลอดภัยที่จะรันซ้ำ
--
-- ของเดิมบังคับใส่เหตุผลทุกครั้ง ด้วยเหตุผลว่าจะได้ตรวจย้อนหลังได้
-- เจ้าของระบบขอให้เป็นช่องโน้ตที่ไม่บังคับแทน เพราะงานจริงส่วนใหญ่คือ
-- "เห็นแล้ว ยอมรับว่ามาสาย" ซึ่งไม่มีอะไรต้องอธิบาย การบังคับพิมพ์
-- ทำให้คนพิมพ์มั่ว ๆ ลงไปให้ผ่าน ซึ่งแย่กว่าปล่อยว่าง
--
-- สิ่งที่ยังตรวจย้อนหลังได้เหมือนเดิม — ใครแก้ แก้เมื่อไหร่ แก้จากสถานะอะไรเป็นอะไร
-- เพราะ raw_state ที่ระบบคำนวณยังถูกเก็บไว้แยกจากสถานะที่คนแก้เสมอ
-- หายไปอย่างเดียวคือคำอธิบายซึ่งไม่เคยเชื่อถือได้อยู่แล้วเมื่อถูกบังคับ
-- =====================================================================

create or replace function set_meeting_attendance(
  p_event  uuid,
  p_user   uuid,
  p_state  text,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not my_can_audit() then
    raise exception 'เฉพาะผู้ตรวจสอบและแอดมินเท่านั้นที่แก้สถานะได้';
  end if;
  if p_state not in ('ontime', 'late', 'excused', 'absent') then
    raise exception 'สถานะไม่ถูกต้อง';
  end if;

  insert into meeting_overrides (event_id, user_id, state, reason, by_user, at)
  values (p_event, p_user, p_state,
          nullif(btrim(coalesce(p_reason, '')), ''), auth.uid(), now())
  on conflict (event_id, user_id) do update
    set state = excluded.state, reason = excluded.reason,
        by_user = excluded.by_user, at = excluded.at;

  return jsonb_build_object('ok', true);
end $$;

grant execute on function set_meeting_attendance(uuid, uuid, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname = 'set_meeting_attendance') as ฟังก์ชันแก้สถานะ,
  (select count(*) from meeting_overrides)                                as การแก้ที่มีอยู่,
  (select count(*) from meeting_events where cancelled_at is null)        as นัดทั้งหมด;
