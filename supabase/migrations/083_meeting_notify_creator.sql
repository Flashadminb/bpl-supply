-- =====================================================================
-- BPL SUPPLY — คนประกาศประชุมต้องได้รับแจ้งเตือนด้วย
-- รันต่อจาก 082 · ปลอดภัยที่จะรันซ้ำ
--
-- อาการ
--   ผู้ตรวจสอบประกาศนัดแบบเลือกเจาะจงแผนก คนในแผนกที่เลือกได้แจ้งเตือนครบ
--   แต่ตัวคนประกาศเองไม่ได้ จึงไม่มีอะไรยืนยันว่าประกาศออกไปจริงหรือเปล่า
--
-- สาเหตุ
--   รายชื่อผู้รับมาจาก meeting_expected() ซึ่งแปลว่า "คนที่ต้องเข้าประชุม"
--   ผู้ตรวจสอบมักอยู่คนละแผนกกับที่เลือก จึงไม่อยู่ในรายชื่อนั้น
--   โหมด all กับ free ไม่เจอปัญหานี้เพราะส่งหาทุกคนอยู่แล้ว
--
-- วิธีแก้
--   เติมคนประกาศเข้าไปในรายชื่อผู้รับ **เฉพาะตอนส่งแจ้งเตือน**
--   ไม่ไปแตะ meeting_expected() เพราะนั่นคือรายชื่อที่ต้องเช็คชื่อ
--   ถ้าแก้ตรงนั้น ผู้ตรวจสอบจะโผล่ในตารางรายชื่อและถูกนับว่าขาดประชุม
--   ทั้งที่เขาเป็นคนนัดเอง ไม่ได้ถูกเรียกเข้าประชุม
-- =====================================================================

create or replace function push_meeting_jobs()
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'meeting_new',
      'subject', e.id::text,
      'user_id', m.user_id,
      'title',   'นัดประชุม · ' || e.title,
      'body',    to_char((e.meet_at at time zone 'Asia/Bangkok'), 'DD/MM HH24:MI') ||
                 coalesce(' · ' || e.place, '') ||
                 coalesce(' · ผู้เข้าร่วม: ' || e.audience, ''),
      'url',     '/'
    ))
    from meeting_events e
    cross join lateral (
      -- โหมด free ไม่มีรายชื่อ จึงส่งหาทุกคนเหมือนเดิม
      select case when e.audience_mode = 'free' then p.id else x.user_id end as user_id
        from profiles p
        left join lateral (select * from meeting_expected(e.id)) x on x.user_id = p.id
       where p.is_active
         and (e.audience_mode = 'free' or x.user_id is not null)

      union

      -- คนที่กดประกาศ ได้รับเสมอ ไม่ว่าจะเลือกแผนกไหน
      -- union ไม่ใช่ union all จึงไม่ซ้ำถ้าเขาอยู่ในรายชื่อที่ต้องเข้าอยู่แล้ว
      -- เช็คกับ profiles ก่อน กันกรณีคนประกาศถูกลบหรือถูกระงับไปแล้ว
      -- ปล่อยผ่านจะได้ผู้รับเป็น null ซึ่งทำให้ตัวส่งพังทั้งรอบ
      select e.created_by
       where exists (select 1 from profiles c where c.id = e.created_by and c.is_active)
    ) m
    where e.cancelled_at is null
      and e.created_at > now() - interval '1 day'
      and e.meet_at > now()
      and not exists (
        select 1 from notification_log n
        where n.kind = 'meeting_new' and n.subject = e.id::text and n.user_id = m.user_id
      )
  ), '[]'::jsonb);
end $$;

grant execute on function push_meeting_jobs() to authenticated, service_role;


-- ---------------------------------------------------------------------
-- ตรวจผล
--
-- นัดที่ยังไม่ได้ส่งให้คนประกาศ = งานที่เพิ่งโผล่มาจากการแก้ครั้งนี้
-- ถ้ามีเลขขึ้นมา แปลว่ามีนัดที่ประกาศไว้ภายใน 24 ชม. แล้วเจ้าตัวยังไม่เคยได้รับ
-- นาฬิการอบถัดไปจะส่งให้เอง ไม่ต้องทำอะไรเพิ่ม
-- ---------------------------------------------------------------------
select
  jsonb_array_length(push_meeting_jobs())                            as งานประกาศรอส่ง,
  (select count(*)
     from meeting_events e
    where e.cancelled_at is null
      and e.created_at > now() - interval '1 day'
      and e.meet_at > now()
      and e.created_by is not null
      and not exists (select 1 from notification_log n
                       where n.kind = 'meeting_new'
                         and n.subject = e.id::text
                         and n.user_id = e.created_by))             as นัดที่คนประกาศยังไม่ได้รับ;
