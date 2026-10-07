-- =====================================================================
-- BPL SUPPLY — เตือนเกินเวลาเบรคตอนเกิน 1 นาที ไม่ใช่ตอนเกิน 0 วินาที
-- รันต่อจาก 122 · ปลอดภัยที่จะรันซ้ำ
--
-- ของเดิมเงื่อนไขคือ now() > due_at เฉย ๆ แปลว่าวินาทีแรกที่เลยเส้นก็ยิงแล้ว
-- ข้อความที่ออกไปจึงเป็น "เกินมาแล้ว 0 นาที" ซึ่งอ่านแล้วงงและกวนเปล่า ๆ
-- เพราะ 0 ถึง 59 วินาทีคือระยะที่คนกำลังเดินเข้าประตูพอดี
--
-- ของใหม่รอให้เกินครบหนึ่งนาทีก่อน ข้อความแรกที่ออกจึงเป็น "เกินมาแล้ว 1 นาที"
-- เสมอ ไม่มีทางเป็น 0 อีก
--
-- รอบเตือนซ้ำทุก 10 นาที และหยุดที่หนึ่งชั่วโมง ยังเหมือนเดิมทุกอย่าง
-- สีแดงบนกระดาน รปภ ก็ยังขึ้นทันทีที่เลยเวลาเหมือนเดิม
-- เพราะคนยืนอยู่หน้าจอ ต่างจากการเด้งแจ้งเตือนเข้ามือถือคนที่ไม่ได้ดูอยู่
-- =====================================================================

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

  -- ③ เกินเวลา · เริ่มเตือนเมื่อเกินครบ 1 นาที แล้วซ้ำทุก 10 นาที ไม่เกินหนึ่งชั่วโมง
  --
  -- ที่เปลี่ยนจากของเดิมมีบรรทัดเดียว คือ now() > p.due_at กลายเป็น
  -- now() >= p.due_at + interval '1 minute'
  -- ช่วง 0 ถึง 59 วินาทีแรกจึงเงียบ ซึ่งคือจังหวะที่คนกำลังเดินเข้าประตูพอดี
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
        and now() >= p.due_at + interval '1 minute'
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


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname = 'push_break_jobs'
     and prosrc like '%due_at + interval ''1 minute''%')         as รอครบ1นาทีแล้ว,
  (select count(*) from pg_proc where proname = 'push_break_jobs'
     and prosrc like '%now() > p.due_at%')                       as ยังเตือนที่0วินาทีไหม,
  (select count(*) from notification_log
    where kind = 'break_over')                                   as เคยเตือนเกินเวลาไปแล้วกี่ครั้ง;
