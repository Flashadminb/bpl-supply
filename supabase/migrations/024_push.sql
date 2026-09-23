-- =====================================================================
-- BPL SUPPLY — แจ้งเตือนเข้ามือถือ
-- รันต่อจาก 023 · ปลอดภัยที่จะรันซ้ำ
--
-- เก็บว่ามือถือเครื่องไหนอนุญาตแจ้งเตือนไว้แล้วบ้าง แล้วมีนาฬิกาฝั่ง
-- เซิร์ฟเวอร์เดินทุก 5 นาที คอยดูว่าใครใกล้เลิกกะ หรือเลยเวลาคืนแล้ว
--
-- เตือนเฉพาะ Asset ตามที่ตกลง ของสิ้นเปลืองไม่เตือน
--   ก่อนเลิกกะ 10 นาที  → คนที่ถือเครื่องอยู่
--   เลยเลิกกะ 10 นาที   → คนนั้น + แอดมิน + เจ้าของระบบ
--   แจ้งชำรุดใหม่        → แอดมิน + เจ้าของระบบ
-- =====================================================================

-- ── เครื่องที่รับแจ้งเตือนได้ ──────────────────────────────────────────
-- 1 คนมีได้หลายเครื่อง (มือถือ + คอม) จึงเก็บเป็นรายอุปกรณ์
create table if not exists push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references profiles(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  -- นับครั้งที่ส่งไม่ผ่าน ถ้าเบราว์เซอร์ตอบว่าเลิกใช้แล้วจะลบทิ้งเอง
  fail_count integer not null default 0
);

create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;

-- เจ้าตัวจัดการของตัวเองได้ เจ้าของระบบดูได้หมดเพื่อไล่ปัญหา
drop policy if exists own_push on push_subscriptions;
create policy own_push on push_subscriptions for all to authenticated
  using (user_id = auth.uid() or my_role() = 'admin')
  with check (user_id = auth.uid());

-- ── กันเตือนซ้ำ ───────────────────────────────────────────────────────
-- 1 แถวต่อ 1 เรื่องต่อ 1 คน นาฬิกาเดินทุก 5 นาที จึงต้องจำว่าเตือนไปแล้ว
create table if not exists notification_log (
  id        bigserial primary key,
  kind      text not null,
  subject   text not null,
  user_id   uuid references profiles(id) on delete cascade,
  sent_at   timestamptz not null default now()
);

create unique index if not exists notification_log_uniq
  on notification_log (kind, subject, user_id);

alter table notification_log enable row level security;
drop policy if exists read_notification_log on notification_log;
create policy read_notification_log on notification_log for select to authenticated
  using (my_role() = 'admin');

-- ---------------------------------------------------------------------
-- งานที่ต้องเตือนตอนนี้
--
-- คืนค่าเป็น jsonb ก้อนเดียวให้ Edge Function เอาไปยิงต่อ
-- ตัดสินใจทั้งหมดในฐานข้อมูล ฝั่ง Edge Function แค่ส่ง
-- ---------------------------------------------------------------------
create or replace function push_due_jobs()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_jobs jsonb := '[]'::jsonb;
  v_now  timestamptz := now();
begin
  -- ① ใกล้เลิกกะ 10 นาที · เตือนคนที่ถือเครื่อง
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'due_soon',
      'subject', h.txn_id::text,
      'user_id', h.user_id,
      'title',   'ใกล้เลิกกะแล้ว',
      'body',    'คุณยังถือ ' || count(*) || ' เครื่อง — ' ||
                 string_agg(h.asset_code, ', ' order by h.asset_code),
      'url',     '/returns'
    ))
    from asset_holdings h
    where h.due_at is not null
      and h.due_at between v_now and v_now + interval '10 minutes'
      and not exists (
        select 1 from notification_log n
        where n.kind = 'due_soon' and n.subject = h.txn_id::text and n.user_id = h.user_id
      )
    group by h.txn_id, h.user_id
  ), '[]'::jsonb);

  -- ② เลยเวลาคืนมาแล้ว 10 นาที · เตือนเจ้าตัว
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'overdue',
      'subject', h.txn_id::text,
      'user_id', h.user_id,
      'title',   'เลยเวลาคืนแล้ว',
      'body',    'ยังไม่ได้คืน ' || count(*) || ' เครื่อง — ' ||
                 string_agg(h.asset_code, ', ' order by h.asset_code),
      'url',     '/returns'
    ))
    from asset_holdings h
    where h.due_at is not null
      and v_now >= h.due_at + interval '10 minutes'
      and not exists (
        select 1 from notification_log n
        where n.kind = 'overdue' and n.subject = h.txn_id::text and n.user_id = h.user_id
      )
    group by h.txn_id, h.user_id
  ), '[]'::jsonb);

  -- ③ สรุปของค้างให้แอดมินและเจ้าของระบบ · 1 ครั้งต่อ 1 รายการที่ค้าง
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'overdue_admin',
      'subject', x.txn_id::text,
      'user_id', m.id,
      'title',   'มีเครื่องค้างเกินกะ',
      'body',    x.holder || ' ยังไม่คืน ' || x.n || ' เครื่อง — ' || x.codes,
      'url',     '/admin/assets-out'
    ))
    from (
      select h.txn_id,
             max(h.holder_name) as holder,
             count(*)           as n,
             string_agg(h.asset_code, ', ' order by h.asset_code) as codes
      from asset_holdings h
      where h.due_at is not null and v_now >= h.due_at + interval '10 minutes'
      group by h.txn_id
    ) x
    cross join (select id from profiles where role in ('supervisor', 'admin') and is_active) m
    where not exists (
      select 1 from notification_log n
      where n.kind = 'overdue_admin' and n.subject = x.txn_id::text and n.user_id = m.id
    )
  ), '[]'::jsonb);

  -- ④ แจ้งชำรุดใหม่ · เตือนแอดมินและเจ้าของระบบทันที
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'issue',
      'subject', i.id::text,
      'user_id', m.id,
      'title',   'แจ้งชำรุด ' || i.asset_code,
      'body',    i.symptom || ' · แจ้งโดย ' || coalesce(p.full_name, i.reported_name, 'ไม่ทราบชื่อ'),
      'url',     '/admin/assets'
    ))
    from asset_issues i
    left join profiles p on p.id = i.reported_by
    cross join (select id from profiles where role in ('supervisor', 'admin') and is_active) m
    where i.resolved_at is null
      and i.reported_at > v_now - interval '1 day'
      and not exists (
        select 1 from notification_log n
        where n.kind = 'issue' and n.subject = i.id::text and n.user_id = m.id
      )
  ), '[]'::jsonb);

  return v_jobs;
end $$;

grant execute on function push_due_jobs() to authenticated, service_role;

/** จดว่าเตือนเรื่องนี้กับคนนี้ไปแล้ว จะได้ไม่เตือนซ้ำทุก 5 นาที */
create or replace function push_mark_sent(p_kind text, p_subject text, p_user uuid)
returns void
language sql security definer set search_path = public as $$
  insert into notification_log (kind, subject, user_id)
  values (p_kind, p_subject, p_user)
  on conflict (kind, subject, user_id) do nothing;
$$;

grant execute on function push_mark_sent(text, text, uuid) to authenticated, service_role;

-- เก็บกวาดบันทึกเก่า ไม่ให้ตารางโตไปเรื่อย ๆ
create or replace function push_prune_log()
returns void
language sql security definer set search_path = public as $$
  delete from notification_log where sent_at < now() - interval '30 days';
$$;

grant execute on function push_prune_log() to service_role;
