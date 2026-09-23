-- =====================================================================
-- BPL SUPPLY — อัปเดต 026 ถึง 029
-- รันต่อจาก 025 · ปลอดภัยที่จะรันซ้ำ
--
--  026  โครงสร้างบาร์โค้ด BY + แจ้งเตือนทันทีเมื่อหน้างานส่งมา
--  027  บังคับรูปอย่างน้อย 1 ใบ
--  028  ตอนปิดรายการ BY เลือกวัสดุและจำนวนได้ + ตัดสต็อกให้ได้
--  029  ประวัติเบิก-คืนเครื่องพร้อมรูปทั้งสองฝั่ง + รูป Asset ในหน้าหลักฐาน
-- =====================================================================

-- =====================================================================
-- BPL SUPPLY — ส่งบาร์โค้ดจาก BY
-- รันต่อจาก 025 · ปลอดภัยที่จะรันซ้ำ
--
-- ของบางอย่างหน้างานไม่ได้กดเบิกในระบบนี้ แต่ส่งบาร์โค้ดมาให้แอดมินสแกน
-- แล้วแอดมินไปตัดสต็อกในระบบ BY เอง ที่นี่ทำหน้าที่เป็นกล่องรับเรื่อง
-- กับเป็นหลักฐานว่าใครขออะไรไปเมื่อไหร่
--
-- แยกตารางออกจากการเบิกปกติทั้งหมด เพราะเป็นคนละเรื่องกัน
-- ตัดสต็อกในระบบนี้ไม่ได้ ไม่มีรายการวัสดุ ไม่มีการอนุมัติ
-- =====================================================================

do $$ begin
  create type by_status as enum ('pending', 'done', 'rejected');
exception when duplicate_object then null; end $$;

create table if not exists by_barcodes (
  id          uuid primary key default gen_random_uuid(),
  ref_no      text unique not null,
  user_id     uuid not null references profiles(id),
  -- คัดลอกไว้ตอนส่ง เผื่อคนย้ายแผนกหรือเปลี่ยนกะทีหลัง ประวัติจะได้ไม่เพี้ยน
  dept_code   text,
  sub_dept    text,
  shift_start time,
  shift_end   time,
  reason      text not null,
  note        text,
  status      by_status not null default 'pending',
  handled_by  uuid references profiles(id),
  handled_at  timestamptz,
  handled_note text,
  created_at  timestamptz not null default now()
);

create index if not exists by_barcodes_open_idx on by_barcodes (created_at desc) where status = 'pending';
create index if not exists by_barcodes_user_idx on by_barcodes (user_id, created_at desc);

create table if not exists by_barcode_photos (
  id       bigserial primary key,
  by_id    uuid not null references by_barcodes(id) on delete cascade,
  file_id  text not null,
  web_link text,
  bytes    integer,
  sort_no  integer not null default 0
);

create index if not exists by_barcode_photos_idx on by_barcode_photos (by_id, sort_no);

-- ── เลขที่รายการ: BY-690923-0001 ──────────────────────────────────────
create sequence if not exists by_ref_seq;

create or replace function next_by_ref()
returns text language sql volatile as $$
  select 'BY-' || to_char((now() at time zone 'Asia/Bangkok'), 'YYMMDD')
      || '-' || lpad(nextval('by_ref_seq')::text, 4, '0');
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table by_barcodes       enable row level security;
alter table by_barcode_photos enable row level security;

-- หน้างานเห็นของตัวเอง แอดมินเห็นหมด
drop policy if exists read_by on by_barcodes;
create policy read_by on by_barcodes for select to authenticated
  using (user_id = auth.uid() or my_role() in ('supervisor', 'admin'));

drop policy if exists write_by on by_barcodes;
create policy write_by on by_barcodes for update to authenticated
  using (my_role() in ('supervisor', 'admin'))
  with check (my_role() in ('supervisor', 'admin'));

-- รูปบาร์โค้ดเปิดดูได้เฉพาะแอดมิน ตรงกับกติกาเดิมของรูปหลักฐาน
drop policy if exists read_by_photos on by_barcode_photos;
create policy read_by_photos on by_barcode_photos for select to authenticated
  using (my_role() in ('supervisor', 'admin'));

-- ---------------------------------------------------------------------
-- View: กล่องรับเรื่อง พร้อมรูปและคนส่ง
-- ---------------------------------------------------------------------
drop view if exists by_feed;
create view by_feed
with (security_invoker = true) as
select
  b.id,
  b.ref_no,
  b.created_at,
  b.reason,
  b.note,
  b.status,
  b.handled_at,
  b.handled_note,
  b.user_id,
  p.full_name                            as who,
  p.employee_code,
  b.dept_code,
  b.sub_dept,
  b.shift_start,
  b.shift_end,
  h.full_name                            as handled_by_name,
  coalesce((
    select count(*) from by_barcode_photos ph where ph.by_id = b.id
  ), 0)::int                             as photo_count,
  coalesce((
    select array_agg(ph.file_id order by ph.sort_no)
    from by_barcode_photos ph where ph.by_id = b.id
  ), '{}')                               as file_ids
from by_barcodes b
join profiles p on p.id = b.user_id
left join profiles h on h.id = b.handled_by;

grant select on by_feed to authenticated;

-- ---------------------------------------------------------------------
-- RPC: หน้างานส่งบาร์โค้ด
--   p_photos = [{file_id, web_link, bytes}] · ส่งได้ไม่จำกัดจำนวน
-- ---------------------------------------------------------------------
create or replace function create_by_barcode(
  p_reason text,
  p_note   text default null,
  p_photos jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me  profiles%rowtype;
  v_id  uuid;
  v_ref text;
  r     jsonb;
  i     int := 0;
begin
  select * into v_me from profiles where id = auth.uid();
  if v_me.id is null or not v_me.is_active then
    raise exception 'บัญชีนี้ใช้งานไม่ได้';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'ต้องใส่เหตุผลก่อน';
  end if;
  if coalesce(jsonb_array_length(p_photos), 0) = 0 then
    raise exception 'ต้องแนบรูปบาร์โค้ดอย่างน้อย 1 ใบ';
  end if;

  v_ref := next_by_ref();
  insert into by_barcodes (ref_no, user_id, dept_code, sub_dept,
                           shift_start, shift_end, reason, note)
  values (v_ref, v_me.id, v_me.dept_code, v_me.sub_dept,
          v_me.shift_start, v_me.shift_end, btrim(p_reason), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;

  for r in select * from jsonb_array_elements(p_photos) loop
    insert into by_barcode_photos (by_id, file_id, web_link, bytes, sort_no)
    values (v_id, r->>'file_id', r->>'web_link', (r->>'bytes')::int, i);
    i := i + 1;
  end loop;

  return jsonb_build_object('id', v_id, 'ref_no', v_ref, 'photos', i);
end $$;

grant execute on function create_by_barcode(text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- RPC: แอดมินกดว่าตัดสต็อกแล้ว หรือปัดตก
-- กดแล้วหายจากกล่องรับเรื่องทันที แต่ประวัติกับรูปยังอยู่ครบ
-- ---------------------------------------------------------------------
create or replace function set_by_status(p_id uuid, p_status by_status, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if my_role() not in ('supervisor', 'admin') then
    raise exception 'ไม่มีสิทธิ์จัดการรายการบาร์โค้ด BY';
  end if;

  update by_barcodes
     set status       = p_status,
         handled_by   = case when p_status = 'pending' then null else auth.uid() end,
         handled_at   = case when p_status = 'pending' then null else now() end,
         handled_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id;
end $$;

grant execute on function set_by_status(uuid, by_status, text) to authenticated;

-- ---------------------------------------------------------------------
-- สถิติรายเดือน ไว้ให้หน้าเว็บสรุป
-- ---------------------------------------------------------------------
drop view if exists by_stats_monthly;
create view by_stats_monthly
with (security_invoker = true) as
select
  to_char((b.created_at at time zone 'Asia/Bangkok'), 'YYYY-MM') as ym,
  b.dept_code,
  b.reason,
  count(*)::int                                                   as total,
  count(*) filter (where b.status = 'pending')::int               as pending,
  count(*) filter (where b.status = 'done')::int                  as done,
  count(*) filter (where b.status = 'rejected')::int              as rejected
from by_barcodes b
group by 1, 2, 3;

grant select on by_stats_monthly to authenticated;

-- ── ดัชนีการส่งออกชีต · แท็บแยกของตัวเอง ─────────────────────────────
create table if not exists by_sheet_exports (
  by_id       uuid primary key references by_barcodes(id) on delete cascade,
  tab         text not null,
  row_no      integer not null,
  exported_at timestamptz not null default now()
);

alter table by_sheet_exports enable row level security;
drop policy if exists read_by_sheet_exports on by_sheet_exports;
create policy read_by_sheet_exports on by_sheet_exports for select to authenticated
  using (my_role() in ('supervisor', 'admin'));

-- ---------------------------------------------------------------------
-- แจ้งเตือน: มีบาร์โค้ด BY ส่งเข้ามา → เด้งหาแอดมินและเจ้าของระบบทันที
-- ต่อท้ายงานเดิมใน push_due_jobs ไม่ได้ จึงเขียนทับทั้งฟังก์ชัน
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
    select jsonb_agg(j) from (
      select jsonb_build_object(
        'kind',    'due_soon',
        'subject', h.txn_id::text,
        'user_id', h.user_id,
        'title',   'ใกล้เลิกกะแล้ว',
        'body',    'คุณยังถือ ' || count(*) || ' เครื่อง — ' ||
                   string_agg(h.asset_code, ', ' order by h.asset_code),
        'url',     '/returns'
      ) as j
      from asset_holdings h
      where h.due_at is not null
        and h.due_at between v_now and v_now + interval '10 minutes'
        and not exists (
          select 1 from notification_log n
          where n.kind = 'due_soon' and n.subject = h.txn_id::text and n.user_id = h.user_id
        )
      group by h.txn_id, h.user_id
    ) g
  ), '[]'::jsonb);

  -- ② เลยเวลาคืนมาแล้ว 10 นาที · เตือนเจ้าตัว
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(j) from (
      select jsonb_build_object(
        'kind',    'overdue',
        'subject', h.txn_id::text,
        'user_id', h.user_id,
        'title',   'เลยเวลาคืนแล้ว',
        'body',    'ยังไม่ได้คืน ' || count(*) || ' เครื่อง — ' ||
                   string_agg(h.asset_code, ', ' order by h.asset_code),
        'url',     '/returns'
      ) as j
      from asset_holdings h
      where h.due_at is not null
        and v_now >= h.due_at + interval '10 minutes'
        and not exists (
          select 1 from notification_log n
          where n.kind = 'overdue' and n.subject = h.txn_id::text and n.user_id = h.user_id
        )
      group by h.txn_id, h.user_id
    ) g
  ), '[]'::jsonb);

  -- ③ สรุปของค้างให้แอดมินและเจ้าของระบบ
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

  -- ⑤ บาร์โค้ด BY ส่งเข้ามาใหม่ · เตือนแอดมินและเจ้าของระบบทันที
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'by_new',
      'subject', b.id::text,
      'user_id', m.id,
      'title',   'มีการเบิกใน BY',
      'body',    p.full_name || ' · ' || b.reason || ' · ' ||
                 (select count(*) from by_barcode_photos ph where ph.by_id = b.id) || ' รูป',
      'url',     '/admin/by'
    ))
    from by_barcodes b
    join profiles p on p.id = b.user_id
    cross join (select id from profiles where role in ('supervisor', 'admin') and is_active) m
    where b.status = 'pending'
      and b.created_at > v_now - interval '1 day'
      and not exists (
        select 1 from notification_log n
        where n.kind = 'by_new' and n.subject = b.id::text and n.user_id = m.id
      )
  ), '[]'::jsonb);

  return v_jobs;
end $$;

grant execute on function push_due_jobs() to authenticated, service_role;


-- =====================================================================
-- BPL SUPPLY — บาร์โค้ด BY ต้องมีรูปอย่างน้อย 1 ใบ
-- รันต่อจาก 026 · ปลอดภัยที่จะรันซ้ำ
--
-- ไม่บังคับให้ถ่ายเยอะ แต่ต้องมีอย่างน้อย 1 ใบเสมอ
-- เพราะรูปบาร์โค้ดคือสิ่งที่แอดมินเอาไปสแกนตัดสต็อกจริง ๆ
-- ไม่มีรูปก็ไม่มีอะไรให้ทำต่อ
--
-- (ไฟล์นี้เคยปล่อยให้ส่งโดยไม่มีรูปได้ชั่วคราว ตอนนี้กลับมาบังคับ 1 ใบแล้ว
--  รันทับได้เลย ข้อมูลเดิมไม่กระทบ)
-- =====================================================================

create or replace function create_by_barcode(
  p_reason text,
  p_note   text default null,
  p_photos jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me  profiles%rowtype;
  v_id  uuid;
  v_ref text;
  r     jsonb;
  i     int := 0;
begin
  select * into v_me from profiles where id = auth.uid();
  if v_me.id is null or not v_me.is_active then
    raise exception 'บัญชีนี้ใช้งานไม่ได้';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'ต้องใส่เหตุผลก่อน';
  end if;
  if coalesce(jsonb_array_length(p_photos), 0) = 0 then
    raise exception 'ต้องแนบรูปบาร์โค้ดอย่างน้อย 1 ใบ';
  end if;

  v_ref := next_by_ref();
  insert into by_barcodes (ref_no, user_id, dept_code, sub_dept,
                           shift_start, shift_end, reason, note)
  values (v_ref, v_me.id, v_me.dept_code, v_me.sub_dept,
          v_me.shift_start, v_me.shift_end, btrim(p_reason),
          nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;

  for r in select * from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) loop
    insert into by_barcode_photos (by_id, file_id, web_link, bytes, sort_no)
    values (v_id, r->>'file_id', r->>'web_link', (r->>'bytes')::int, i);
    i := i + 1;
  end loop;

  return jsonb_build_object('id', v_id, 'ref_no', v_ref, 'photos', i);
end $$;

grant execute on function create_by_barcode(text, text, jsonb) to authenticated;


-- =====================================================================
-- BPL SUPPLY — ผูกรายการบาร์โค้ด BY เข้ากับวัสดุในระบบ
-- รันต่อจาก 027 · ปลอดภัยที่จะรันซ้ำ
--
-- ตอนแอดมินปิดรายการ ควรเลือกได้ว่าบาร์โค้ดนั้นคือวัสดุตัวไหนและกี่ชิ้น
-- ไม่งั้นสถิติบอกได้แค่ "เหตุผล" ซึ่งกว้างเกินกว่าจะเอาไปสั่งของ
--
-- การตัดสต็อกจริงยังเป็นเรื่องของระบบ BY เหมือนเดิม
-- ที่นี่แค่บันทึกว่าคืออะไร เว้นแต่แอดมินสั่งให้ตัดในระบบนี้ด้วย
-- =====================================================================

alter table by_barcodes
  add column if not exists item_id bigint references items(id),
  add column if not exists qty     integer;

comment on column by_barcodes.item_id is
  'วัสดุที่แอดมินระบุตอนปิดรายการ · ว่างได้ถ้าเป็นของที่ไม่มีในคลังนี้';

create index if not exists by_barcodes_item_idx on by_barcodes (item_id) where item_id is not null;

-- ── view เพิ่มชื่อวัสดุ ────────────────────────────────────────────────
drop view if exists by_feed;
create view by_feed
with (security_invoker = true) as
select
  b.id,
  b.ref_no,
  b.created_at,
  b.reason,
  b.note,
  b.status,
  b.handled_at,
  b.handled_note,
  b.user_id,
  p.full_name                            as who,
  p.employee_code,
  b.dept_code,
  b.sub_dept,
  b.shift_start,
  b.shift_end,
  h.full_name                            as handled_by_name,
  b.item_id,
  i.name                                 as item_name,
  i.sku                                  as item_sku,
  i.unit                                 as item_unit,
  b.qty,
  coalesce((
    select count(*) from by_barcode_photos ph where ph.by_id = b.id
  ), 0)::int                             as photo_count,
  coalesce((
    select array_agg(ph.file_id order by ph.sort_no)
    from by_barcode_photos ph where ph.by_id = b.id
  ), '{}')                               as file_ids
from by_barcodes b
join profiles p on p.id = b.user_id
left join profiles h on h.id = b.handled_by
left join items i   on i.id = b.item_id;

grant select on by_feed to authenticated;

-- ---------------------------------------------------------------------
-- ปิดรายการ พร้อมระบุว่าเป็นวัสดุตัวไหนกี่ชิ้น
--   p_cut_stock = true จะตัดสต็อกในระบบนี้ให้ด้วย
--   ใช้เมื่อของชิ้นนั้นมีอยู่ในคลังนี้จริง ไม่งั้นยอดจะเพี้ยน
-- ---------------------------------------------------------------------
create or replace function set_by_status(
  p_id        uuid,
  p_status    by_status,
  p_note      text default null,
  p_item_id   bigint default null,
  p_qty       integer default null,
  p_cut_stock boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_was by_status;
begin
  if my_role() not in ('supervisor', 'admin') then
    raise exception 'ไม่มีสิทธิ์จัดการรายการบาร์โค้ด BY';
  end if;

  select status into v_was from by_barcodes where id = p_id;
  if v_was is null then
    raise exception 'ไม่พบรายการนี้';
  end if;

  update by_barcodes
     set status       = p_status,
         item_id      = coalesce(p_item_id, item_id),
         qty          = coalesce(p_qty, qty),
         handled_by   = case when p_status = 'pending' then null else auth.uid() end,
         handled_at   = case when p_status = 'pending' then null else now() end,
         handled_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id;

  -- ตัดสต็อกให้เฉพาะตอนสั่ง และเฉพาะตอนเพิ่งเปลี่ยนเป็น done
  -- กันกดซ้ำแล้วตัดซ้ำ
  if p_cut_stock and p_status = 'done' and v_was <> 'done'
     and p_item_id is not null and coalesce(p_qty, 0) > 0 then
    perform adjust_stock(p_item_id, -p_qty, 'บาร์โค้ด BY');
  end if;
end $$;

grant execute on function set_by_status(uuid, by_status, text, bigint, integer, boolean) to authenticated;

-- ── สถิติเพิ่มมิติ "วัสดุ" เข้าไปด้วย ─────────────────────────────────
drop view if exists by_stats_monthly;
create view by_stats_monthly
with (security_invoker = true) as
select
  to_char((b.created_at at time zone 'Asia/Bangkok'), 'YYYY-MM') as ym,
  b.dept_code,
  b.reason,
  b.item_id,
  i.name                                                          as item_name,
  count(*)::int                                                   as total,
  count(*) filter (where b.status = 'pending')::int               as pending,
  count(*) filter (where b.status = 'done')::int                  as done,
  count(*) filter (where b.status = 'rejected')::int              as rejected,
  coalesce(sum(b.qty) filter (where b.status = 'done'), 0)::int    as qty_done
from by_barcodes b
left join items i on i.id = b.item_id
group by 1, 2, 3, 4, 5;

grant select on by_stats_monthly to authenticated;


-- =====================================================================
-- BPL SUPPLY — ประวัติ Asset และรูปหลักฐาน Asset ในหน้าเดียวกับสิ้นเปลือง
-- รันต่อจาก 028 · ปลอดภัยที่จะรันซ้ำ
--
-- สองเรื่อง
--   1. ประวัติการเบิก-คืนเครื่อง ต้องดูย้อนหลังได้ ถึงคืนไปแล้วก็ยังต้องอยู่
--      ของเดิมมีแต่ asset_holdings ซึ่งเก็บเฉพาะที่ยังไม่คืน
--   2. รูปตอนเบิก-คืนเครื่องไม่เคยโผล่ในหน้าหลักฐาน เพราะอยู่คนละตาราง
-- =====================================================================

-- ปุ่ม "ใช้แล้ว" ต้องใช้ได้กับรูปฝั่ง Asset ด้วย
alter table asset_txns add column if not exists evidence_archived boolean not null default false;

create index if not exists asset_txns_archived_idx
  on asset_txns (created_at desc) where not evidence_archived;

-- ---------------------------------------------------------------------
-- ประวัติการเบิก-คืนเครื่อง — หนึ่งแถวต่อหนึ่งเครื่องต่อหนึ่งครั้งที่เบิก
-- คืนแล้วแถวยังอยู่ แค่มีเวลาคืนเติมเข้ามา
-- ---------------------------------------------------------------------
drop view if exists asset_history;
create view asset_history
with (security_invoker = true) as
select
  ai.id                                   as out_item_id,
  ai.asset_code,
  a.type_code,
  ty.name                                 as type_name,
  a.dept_code                             as asset_dept,
  t.id                                    as txn_id,
  t.ref_no,
  t.user_id,
  p.full_name                             as who,
  p.employee_code,
  t.dept_code                             as holder_dept,
  p.sub_dept,
  t.shift_start,
  t.shift_end,
  t.due_at,
  t.created_at                            as taken_at,
  back.created_at                         as returned_at,
  back.ref_no                             as return_ref,
  backp.full_name                         as returned_by,
  (back.id is null)                       as still_out,
  -- รูปทั้งสองฝั่งติดมาในแถวเดียว จะได้เทียบสภาพก่อน-หลังได้ทันที
  coalesce((
    select array_agg(ph.file_id order by ph.seq)
    from asset_txn_photos ph where ph.txn_id = t.id
  ), '{}')                                 as out_file_ids,
  coalesce((
    select array_agg(ph.file_id order by ph.seq)
    from asset_txn_photos ph where ph.txn_id = back.id
  ), '{}')                                 as in_file_ids,
  case
    when back.created_at is not null
      then extract(epoch from (back.created_at - t.created_at)) / 3600
  end::numeric(10, 2)                     as held_hours
from asset_txn_items ai
join asset_txns t   on t.id = ai.txn_id and t.kind = 'out'
join assets a       on a.code = ai.asset_code
join asset_types ty on ty.code = a.type_code
join profiles p     on p.id = t.user_id
left join asset_txn_items back_item on back_item.out_item_id = ai.id
left join asset_txns back           on back.id = back_item.txn_id
left join profiles backp            on backp.id = back.user_id;

grant select on asset_history to authenticated;

-- ---------------------------------------------------------------------
-- หน้าหลักฐาน: รวมรูปฝั่ง Asset เข้ามาด้วย
--
-- เพิ่มสองชนิดใหม่ asset_out / asset_in และคอลัมน์ asset_type_code
-- ฝั่งสิ้นเปลืองค่าเป็น null ฝั่ง Asset ก็มี item_ids ว่าง
-- ดรอปดาวน์เลือกของจึงรวมได้ทั้งวัสดุรายชิ้นและประเภทเครื่อง
-- ---------------------------------------------------------------------
drop view if exists evidence_items;
drop view if exists evidence_feed;

create view evidence_feed
with (security_invoker = true) as
select
  'requisition'::text                       as kind,
  r.id::text                                as source_id,
  r.ref_no,
  r.created_at,
  r.hub_code,
  r.evidence_file_id                        as file_id,
  r.evidence_web_link                       as web_link,
  r.evidence_archived                       as archived,
  p.full_name                               as who,
  p.employee_code,
  p.dept_code,
  p.sub_dept,
  p.shift_start,
  p.shift_end,
  null::text                                as asset_type_code,
  coalesce((
    select bool_or(i.is_returnable)
    from requisition_items ri join items i on i.id = ri.item_id
    where ri.requisition_id = r.id
  ), false)                                 as has_returnable,
  coalesce((
    select string_agg(i.name || ' x' || ri.qty_requested, ', ' order by ri.id)
    from requisition_items ri join items i on i.id = ri.item_id
    where ri.requisition_id = r.id
  ), '')                                    as summary,
  coalesce((
    select array_agg(distinct ri.item_id)
    from requisition_items ri where ri.requisition_id = r.id
  ), '{}')                                  as item_ids,
  coalesce((
    select array_agg(ph.file_id order by ph.sort_no)
    from requisition_photos ph where ph.requisition_id = r.id
  ), array[r.evidence_file_id])             as file_ids
from requisitions r
join profiles p on p.id = r.requester_id
where r.evidence_file_id is not null

union all

select
  'return'::text,
  rt.id::text,
  rq.ref_no,
  rt.created_at,
  rq.hub_code,
  rt.evidence_file_id,
  rt.evidence_web_link,
  rt.evidence_archived,
  p.full_name,
  p.employee_code,
  p.dept_code,
  p.sub_dept,
  p.shift_start,
  p.shift_end,
  null::text,
  true,
  i.name || ' คืน ' || rt.qty || ' (' ||
    case rt.condition when 'ok' then 'ใช้ได้' when 'damaged' then 'ชำรุด' else 'สูญหาย' end || ')',
  array[i.id],
  coalesce((
    select array_agg(ph.file_id order by ph.sort_no)
    from return_photos ph where ph.return_id = rt.id
  ), array[rt.evidence_file_id])
from returns rt
join requisition_items ri on ri.id = rt.requisition_item_id
join requisitions rq      on rq.id = ri.requisition_id
join items i              on i.id = ri.item_id
join profiles p           on p.id = rt.returned_by
where rt.evidence_file_id is not null

union all

-- ฝั่ง Asset — หนึ่งแถวต่อหนึ่งครั้งที่เบิกหรือคืน รูปผูกกับครั้งนั้น
select
  case when t.kind = 'out' then 'asset_out' else 'asset_in' end,
  t.id::text,
  t.ref_no,
  t.created_at,
  'BPL',
  (select ph.file_id from asset_txn_photos ph where ph.txn_id = t.id order by ph.seq limit 1),
  null::text,
  t.evidence_archived,
  p.full_name,
  p.employee_code,
  t.dept_code,
  p.sub_dept,
  t.shift_start,
  t.shift_end,
  t.type_code,
  true,
  ty.name || (case when t.kind = 'out' then ' เบิก ' else ' คืน ' end) ||
    coalesce((
      select count(*)::text from asset_txn_items ai where ai.txn_id = t.id
    ), '0') || ' เครื่อง — ' ||
    coalesce((
      select string_agg(ai.asset_code, ', ' order by ai.asset_code)
      from asset_txn_items ai where ai.txn_id = t.id
    ), ''),
  '{}'::bigint[],
  coalesce((
    select array_agg(ph.file_id order by ph.seq)
    from asset_txn_photos ph where ph.txn_id = t.id
  ), '{}')
from asset_txns t
join asset_types ty on ty.code = t.type_code
join profiles p     on p.id = t.user_id
where exists (select 1 from asset_txn_photos ph where ph.txn_id = t.id);

grant select on evidence_feed to authenticated;

-- ── ตัวเลือกในดรอปดาวน์: วัสดุรายชิ้น + ประเภทเครื่อง ─────────────────
create view evidence_items
with (security_invoker = true) as
select
  'i:' || i.id::text                      as key,
  i.name                                  as name,
  i.sku                                   as sub,
  'supply'::text                          as kind,
  count(*)::int                           as photo_rows
from evidence_feed e
join items i on i.id = any(e.item_ids)
group by i.id, i.name, i.sku

union all

select
  't:' || ty.code,
  ty.name,
  'อุปกรณ์ Asset',
  'asset'::text,
  count(*)::int
from evidence_feed e
join asset_types ty on ty.code = e.asset_type_code
group by ty.code, ty.name;

grant select on evidence_items to authenticated;

-- ---------------------------------------------------------------------
-- ปุ่ม "ใช้แล้ว" รองรับรูปฝั่ง Asset
-- ---------------------------------------------------------------------
create or replace function set_evidence_archived(
  p_kind      text,
  p_source_id text,
  p_archived  boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if my_role() not in ('supervisor', 'admin') then
    raise exception 'ไม่มีสิทธิ์จัดการหลักฐาน';
  end if;

  if p_kind = 'requisition' then
    update requisitions set evidence_archived = p_archived where id = p_source_id::uuid;
  elsif p_kind = 'return' then
    update returns set evidence_archived = p_archived where id = p_source_id::bigint;
  elsif p_kind in ('asset_out', 'asset_in') then
    update asset_txns set evidence_archived = p_archived where id = p_source_id::uuid;
  else
    raise exception 'ประเภทหลักฐานไม่ถูกต้อง';
  end if;
end $$;

grant execute on function set_evidence_archived(text, text, boolean) to authenticated;


