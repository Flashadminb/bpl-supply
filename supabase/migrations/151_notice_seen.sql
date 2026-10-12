-- ---------------------------------------------------------------------
-- 151 · จำว่าใครเห็นแจ้งเตือนอะไรไปแล้ว
--
-- ป็อปอัพต้องเด้งเฉพาะเรื่องที่ยังไม่เคยเห็น ตามที่เจ้าของระบบเลือกไว้
-- และต้องนับ "เคยเห็น" รายคน ไม่ใช่รายเครื่อง
--
-- ที่ไม่เก็บในเครื่อง เพราะพนักงานคนหนึ่งเปิดทั้งมือถือตัวเองและเครื่องส่วนกลาง
-- ถ้าเก็บในเครื่อง เรื่องเดิมจะเด้งใหม่ทุกครั้งที่เปลี่ยนเครื่อง
-- แล้วป็อปอัพจะกลายเป็นสิ่งที่ทุกคนกดปิดโดยไม่อ่าน ซึ่งแย่กว่าไม่มีป็อปอัพเลย
--
-- เก็บ 14 วันแล้วลบทิ้ง · ประเมินจากของจริงในฮับ
--   ของค้างคืนกับบัตรเบรคจบภายในกะ
--   ประกาศมีอายุของตัวเองอยู่แล้วและไม่เกินสัปดาห์
--   เกินสองสัปดาห์ไปไม่มีใครย้อนกลับไปอ่าน แต่แถวยังโตทุกวัน
-- ลบตอนอ่าน ไม่ต้องตั้ง cron เพราะทุกคนอ่านตารางนี้ทุกครั้งที่เปิดแอพอยู่แล้ว
-- ---------------------------------------------------------------------

create table if not exists notice_seen (
  user_id uuid not null references profiles (id) on delete cascade,
  /** กุญแจของเรื่องนั้น เช่น ann:12 หรือ late:PP-23 · ฝั่งแอพเป็นคนตั้ง */
  key     text not null,
  seen_at timestamptz not null default now(),
  primary key (user_id, key)
);

create index if not exists notice_seen_at on notice_seen (seen_at);

alter table notice_seen enable row level security;

drop policy if exists own_notice_seen on notice_seen;
create policy own_notice_seen on notice_seen for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());


/** เรื่องที่ฉันเคยเห็นแล้ว · ลบของเกิน 14 วันของตัวเองทิ้งไปด้วยในคราวเดียว */
create or replace function notice_seen_list() returns text[]
language plpgsql security definer set search_path = public as $$
declare v_keys text[];
begin
  if auth.uid() is null then
    return '{}';
  end if;

  delete from notice_seen
   where user_id = auth.uid() and seen_at < now() - interval '14 days';

  select coalesce(array_agg(key), '{}') into v_keys
    from notice_seen where user_id = auth.uid();

  return v_keys;
end $$;

grant execute on function notice_seen_list() to authenticated;


/** บันทึกว่าเห็นแล้ว · กดปิดป็อปอัพทีเดียวจบทุกเรื่องที่อยู่ในใบนั้น */
create or replace function notice_seen_mark(p_keys text[]) returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if auth.uid() is null then
    return 0;
  end if;

  insert into notice_seen (user_id, key)
  select auth.uid(), k
    from unnest(coalesce(p_keys, '{}')) k
   where coalesce(btrim(k), '') <> ''
  on conflict (user_id, key) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end $$;

grant execute on function notice_seen_mark(text[]) to authenticated;

select
  (select count(*) from pg_tables where tablename = 'notice_seen')      as tbl,
  (select count(*) from pg_proc where proname like 'notice_seen%')      as fns;
