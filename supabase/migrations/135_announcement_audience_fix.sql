-- =====================================================================
-- BPL SUPPLY — ป้ายประกาศเลือกแผนกแล้ว แต่ รปภ เห็นทุกใบ
-- รันต่อจาก 134 · ปลอดภัยที่จะรันซ้ำ
--
-- อาการ
--   ประกาศเลือกไว้แค่ MINI CS, QC, IE แต่บัญชี รปภ เห็นป้ายทุกใบในแอพ
--
-- สาเหตุ · เป็นไวลด์การ์ดสองทางที่เขียนไว้ตั้งแต่ 061
--   my_sees_announcement() มีเงื่อนไข  'ALL' = any(my_depts())
--   แปลว่า "คนที่สังกัดแผนก ALL เห็นประกาศของทุกแผนก"
--   ซึ่งไม่ได้ตั้งใจ · ALL คือแผนกจริงชื่อ "ทุกแผนก" ที่มีสมาชิก 19 คน
--   ส่วนใหญ่เป็นบัญชีกลางอย่าง รปภ ที่ไม่ได้สังกัดสายงานไหน
--   คนกลุ่มนี้จึงเห็นประกาศของทั้งฮับมาตลอดโดยไม่มีใครรู้
--
--   อีกทางคือ d.dept_code = 'ALL' แปลว่า "ติ๊กแผนก ALL = ส่งหาทุกคน"
--   ซึ่งขัดกับหน้าจอ · ปุ่มนั้นเขียนว่า "ไม่สังกัดแผนก" และโชว์ว่ามี 19 คน
--   คนกดย่อมคิดว่าได้ 19 คนนั้น ไม่ใช่ทั้งฮับ
--   ถ้าอยากได้ทั้งฮับมีปุ่ม "ทุกคนในระบบ" อยู่แล้ว ซึ่งคือ audience_mode = 'all'
--
--   และ extra_depts ก็ถูกเอามาปนอีก · ซึ่งแปลว่า "คนนี้มองเห็นของแผนกอื่นได้"
--   ไม่ใช่ "สังกัดแผนกอื่น" · ฝั่งนัดประชุมแก้ไปแล้วตั้งแต่ 119 แต่ฝั่งป้ายประกาศตกหล่น
--
-- หลังแก้ ALL เป็นแผนกธรรมดาแผนกหนึ่ง ไม่มีความหมายพิเศษทั้งสองทาง
-- ตัวเลขที่หน้าจอนับให้ก่อนกด จะตรงกับคนที่ได้รับจริงเป็นครั้งแรก
-- =====================================================================

create or replace function my_sees_announcement(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from announcement_users u
     where u.ann_id = p_id and u.user_id = auth.uid()
  ) or exists (
    select 1 from announcement_depts d
      join profiles me on me.id = auth.uid()
     where d.ann_id = p_id
       and d.dept_code = me.dept_code
  );
$$;

comment on function my_sees_announcement(uuid) is
  'เห็นป้ายใบนี้ไหม · เทียบแผนกที่สังกัดจริงเท่านั้น ไม่เอา extra_depts มาปน และ ALL ไม่ใช่ไวลด์การ์ด';

grant execute on function my_sees_announcement(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- ฝั่งแจ้งเตือนเข้ามือถือ · ต้องใช้กติกาเดียวกันเป๊ะ
--
-- ของเดิมสองฝั่งคิดไม่เหมือนกัน คนจึงได้รับแจ้งเตือนป้ายที่ตัวเองเปิดดูไม่ได้
-- และเห็นป้ายที่ไม่เคยได้รับแจ้งเตือน ซึ่งไล่ปัญหาทีหลังแทบไม่ได้เลย
-- ---------------------------------------------------------------------
create or replace function push_announcement_jobs()
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'announce_new',
      'subject', a.id::text,
      'user_id', p.id,
      'title',   case a.level when 'urgent' then 'ด่วน · ' when 'warn' then 'แจ้งเตือน · '
                              else 'ประกาศ · ' end || a.title,
      'body',    coalesce(a.body, 'เปิดแอพเพื่อดูรายละเอียด'),
      'url',     '/'
    ))
    from announcements a
    cross join (select id, dept_code from profiles where is_active) p
    where a.cancelled_at is null
      and a.notify
      and a.expires_at > now()
      and a.created_at > now() - interval '1 day'
      and (
        a.audience_mode = 'all'
        or exists (select 1 from announcement_users u where u.ann_id = a.id and u.user_id = p.id)
        or exists (select 1 from announcement_depts d
                    where d.ann_id = a.id and d.dept_code = p.dept_code)
      )
      and not exists (
        select 1 from notification_log n
        where n.kind = 'announce_new' and n.subject = a.id::text and n.user_id = p.id
      )
  ), '[]'::jsonb);
end $$;

comment on function push_announcement_jobs() is
  'ใครต้องได้รับแจ้งเตือนป้ายประกาศ · กติกาเดียวกับ my_sees_announcement()';

grant execute on function push_announcement_jobs() to authenticated, service_role;


-- ---------------------------------------------------------------------
-- ตรวจผล
--
-- สองบรรทัดแรกต้องเป็น 0 ทั้งคู่ · ถ้าไม่ใช่แปลว่ายังมีไวลด์การ์ดค้างอยู่
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname = 'my_sees_announcement'
     and prosrc like '%my_depts%')                               as "ยังใช้ไวลด์การ์ดอยู่ไหม",
  (select count(*) from pg_proc where proname = 'push_announcement_jobs'
     and prosrc like '%extra_depts%')                            as "ยังเอา extra_depts มาปนไหม",
  (select count(*) from profiles where is_active and dept_code = 'ALL')
                                                                 as "คนที่สังกัดแผนก ทุกแผนก",
  (select count(*) from announcement_depts where dept_code = 'ALL')
                                                                 as "ป้ายที่เคยติ๊กแผนกนั้นไว้";
