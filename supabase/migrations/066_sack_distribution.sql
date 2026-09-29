-- =====================================================================
-- BPL SUPPLY — กระจายกระสอบไปสาขา
-- รันต่อจาก 065 · ปลอดภัยที่จะรันซ้ำ
--
-- สาขาใหญ่ส่งกระสอบมาที่ 21BPL แล้วเรากระจายต่อไปสาขาปลายทาง
-- เจ้าของระบบกับแอดมินเป็นคนตั้งรายการว่าสาขาไหนขออะไรเท่าไหร่
-- หน้างานเปิดลิงก์มากดว่าส่งแล้ว แล้วได้ฟอร์มไปส่งต่อในแชท
--
-- สองทางที่ส่งได้
--   direct  ส่งตรงสาขา — ใช้บ่อยสุด เพราะฮับนี้เป็นคนกระจายเอง
--   relay   ฝากสาขาอื่นส่งต่อ — ต้องระบุว่าฝากสาขาไหน
--
-- ทำไม relay ต้องบังคับใส่ชื่อสาขาที่ฝาก
--   ฟอร์มที่ส่งออกไปเขียนว่า "ฝาก ___ ส่งต่อสาขา ___"
--   ถ้าปล่อยว่างได้ ส่วนกลางจะได้ข้อความที่อ่านไม่รู้เรื่อง
--   และเราจะตามของไม่ได้ว่าไปค้างอยู่ที่ไหน
--
-- แยกขาดจากระบบเบิก-คืน ไม่แตะตารางเดิมสักตัว
-- =====================================================================

create sequence if not exists sack_ref_seq;

create or replace function next_sack_ref() returns text
language sql volatile as $$
  select 'SH-' || to_char((now() at time zone 'Asia/Bangkok'), 'YYMMDD')
      || '-' || lpad(nextval('sack_ref_seq')::text, 3, '0');
$$;

create table if not exists sack_orders (
  id          uuid primary key default gen_random_uuid(),
  ref_no      text unique not null,
  /** ฮับที่จัดส่ง — ของเราคือ 21BPL แต่เก็บไว้เผื่อวันหนึ่งมีมากกว่าหนึ่งฮับ */
  hub_code    text not null default '21BPL',
  qty         integer not null check (qty > 0),
  unit        text not null default 'ชิ้น',
  /** สาขาปลายทางที่ขอของ */
  branch      text not null,
  note        text,

  status      text not null default 'pending',
  /** relay เท่านั้นที่มีค่า — ชื่อสาขาที่เราฝากให้ส่งต่อ */
  relay_via   text,

  created_by  uuid not null references profiles (id),
  created_at  timestamptz not null default now(),
  sent_by     uuid references profiles (id),
  sent_at     timestamptz
);

alter table sack_orders drop constraint if exists sack_orders_unit_chk;
alter table sack_orders add constraint sack_orders_unit_chk
  check (unit in ('ชิ้น', 'กระสอบ'));

alter table sack_orders drop constraint if exists sack_orders_status_chk;
alter table sack_orders add constraint sack_orders_status_chk
  check (status in ('pending', 'direct', 'relay'));

-- ฝากส่งต้องมีชื่อสาขาที่ฝากเสมอ ทางอื่นต้องไม่มี
alter table sack_orders drop constraint if exists sack_orders_relay_chk;
alter table sack_orders add constraint sack_orders_relay_chk
  check (
    (status = 'relay' and coalesce(btrim(relay_via), '') <> '')
    or (status <> 'relay' and relay_via is null)
  );

create index if not exists sack_orders_pending_idx
  on sack_orders (created_at desc) where status = 'pending';
create index if not exists sack_orders_branch_idx on sack_orders (branch);


create table if not exists sack_order_photos (
  id         bigserial primary key,
  order_id   uuid not null references sack_orders (id) on delete cascade,
  seq        integer not null default 1,
  file_id    text not null,
  web_link   text,
  bytes      integer,
  created_at timestamptz not null default now()
);

create index if not exists sack_order_photos_order_idx on sack_order_photos (order_id, seq);


-- ---------------------------------------------------------------------
-- สิทธิ์
--
-- อ่าน   ทุกคนที่ล็อกอิน — หน้างานต้องเห็นว่ามีอะไรรอส่ง
-- ตั้ง   เจ้าของระบบกับแอดมินเท่านั้น
-- กดส่ง  ทุกคนที่ล็อกอิน ผ่าน RPC ที่คุมไว้ ไม่ได้เปิด update ตรง ๆ
--
-- รูปเปิดให้ทุกคนที่ล็อกอินอ่าน ต่างจากรูปหลักฐานเบิก-คืน
-- เพราะรูปกระสอบคือสิ่งที่หน้างานต้องเอาไปแปะในแชทเอง ไม่ใช่ของลับ
-- ---------------------------------------------------------------------
alter table sack_orders enable row level security;
alter table sack_order_photos enable row level security;

drop policy if exists read_sack_orders on sack_orders;
create policy read_sack_orders on sack_orders for select to authenticated using (true);

drop policy if exists write_sack_orders on sack_orders;
create policy write_sack_orders on sack_orders for all to authenticated
  using (my_role() in ('admin', 'supervisor'))
  with check (my_role() in ('admin', 'supervisor'));

drop policy if exists read_sack_photos on sack_order_photos;
create policy read_sack_photos on sack_order_photos for select to authenticated using (true);

drop policy if exists write_sack_photos on sack_order_photos;
create policy write_sack_photos on sack_order_photos for all to authenticated
  using (my_role() in ('admin', 'supervisor'))
  with check (my_role() in ('admin', 'supervisor'));


-- ---------------------------------------------------------------------
-- ตั้งรายการ — เจ้าของระบบกับแอดมิน
-- ---------------------------------------------------------------------
create or replace function create_sack_order(
  p_branch text,
  p_qty    integer,
  p_unit   text default 'ชิ้น',
  p_note   text default null,
  p_hub    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id  uuid;
  v_ref text;
begin
  if my_role() not in ('admin', 'supervisor') then
    raise exception 'เฉพาะเจ้าของระบบและแอดมินเท่านั้นที่ตั้งรายการได้';
  end if;
  if coalesce(btrim(p_branch), '') = '' then
    raise exception 'ต้องใส่ชื่อสาขาที่ขอ';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'จำนวนต้องมากกว่าศูนย์';
  end if;
  if p_unit not in ('ชิ้น', 'กระสอบ') then
    raise exception 'หน่วยต้องเป็นชิ้นหรือกระสอบ';
  end if;

  v_ref := next_sack_ref();

  insert into sack_orders (ref_no, hub_code, qty, unit, branch, note, created_by)
  values (v_ref,
          coalesce(nullif(btrim(p_hub), ''), '21BPL'),
          p_qty, p_unit, btrim(p_branch),
          nullif(btrim(coalesce(p_note, '')), ''),
          auth.uid())
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'ref_no', v_ref);
end $$;

grant execute on function create_sack_order(text, integer, text, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- กดว่าส่งแล้ว — ใครที่ล็อกอินก็กดได้ ระบบจำว่าใครกด
--
-- กันกดซ้ำด้วยการเช็คสถานะก่อน ไม่ใช่เช็คที่หน้าจอ
-- เน็ตในฮับไม่นิ่ง คนกดค้างแล้วกดซ้ำเป็นเรื่องปกติ
-- ---------------------------------------------------------------------
create or replace function mark_sack_sent(
  p_id     uuid,
  p_mode   text,
  p_relay  text default null,
  p_photos jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row sack_orders%rowtype;
begin
  if p_mode not in ('direct', 'relay') then
    raise exception 'ต้องเลือกว่าส่งตรงหรือฝากส่ง';
  end if;
  if p_mode = 'relay' and coalesce(btrim(p_relay), '') = '' then
    raise exception 'ฝากส่งต้องใส่ชื่อสาขาที่ฝากด้วย';
  end if;

  select * into v_row from sack_orders where id = p_id for update;
  if not found then
    raise exception 'ไม่พบรายการนี้';
  end if;

  -- กดซ้ำไม่ถือว่าผิด ผลลัพธ์ที่คนกดต้องการคือ "ส่งแล้ว" ซึ่งเป็นจริงอยู่
  if v_row.status <> 'pending' then
    return jsonb_build_object('ref_no', v_row.ref_no, 'duplicate', true,
                              'status', v_row.status, 'relay_via', v_row.relay_via);
  end if;

  update sack_orders
     set status    = p_mode,
         relay_via = case when p_mode = 'relay' then btrim(p_relay) else null end,
         sent_by   = auth.uid(),
         sent_at   = now()
   where id = p_id;

  insert into sack_order_photos (order_id, seq, file_id, web_link, bytes)
  select p_id, (row_number() over ())::int,
         ph->>'file_id', ph->>'web_link', nullif(ph->>'bytes', '')::int
    from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) ph
   where coalesce(ph->>'file_id', '') <> '';

  return jsonb_build_object('ref_no', v_row.ref_no, 'duplicate', false,
                            'status', p_mode, 'relay_via', nullif(btrim(p_relay), ''));
end $$;

grant execute on function mark_sack_sent(uuid, text, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- รายชื่อสาขาที่เคยใช้ — รายการจะโตเองจากการใช้งาน
--
-- เจ้าของระบบไม่ต้องรู้ล่วงหน้าว่ามีสาขาอะไรบ้าง
-- พิมพ์ครั้งแรกระบบจำไว้ ครั้งต่อไปเลือกจากรายการได้
-- ช่วยไม่ให้ได้ "6PPD_PDC-พระประแดง" บ้าง "พระประแดง" บ้าง จนนับยอดไม่ได้
-- ---------------------------------------------------------------------
create or replace function sack_branches()
returns table (branch text, used integer, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select branch, count(*)::int, max(created_at)
    from sack_orders
   group by branch
   order by max(created_at) desc
   limit 300;
$$;

grant execute on function sack_branches() to authenticated;

/** สาขาที่เคยใช้เป็นตัวกลางฝากส่ง — ช่องฝากส่งก็มีตัวช่วยเหมือนกัน */
create or replace function sack_relays()
returns table (via text, used integer)
language sql stable security definer set search_path = public as $$
  select relay_via, count(*)::int
    from sack_orders
   where relay_via is not null
   group by relay_via
   order by count(*) desc
   limit 100;
$$;

grant execute on function sack_relays() to authenticated;


-- ---------------------------------------------------------------------
-- วิวสำหรับหน้าจอ — พ่วงชื่อคนและรูปมาให้พร้อม
-- ---------------------------------------------------------------------
create or replace view sack_rows
with (security_invoker = true) as
select
  o.id, o.ref_no, o.hub_code, o.qty, o.unit, o.branch, o.note,
  o.status, o.relay_via, o.created_at, o.sent_at,
  cb.full_name as created_by_name,
  sb.full_name as sent_by_name,
  coalesce(
    (select jsonb_agg(jsonb_build_object('seq', p.seq, 'file_id', p.file_id, 'web_link', p.web_link)
            order by p.seq)
       from sack_order_photos p where p.order_id = o.id),
    '[]'::jsonb
  ) as photos,
  (select count(*) from sack_order_photos p where p.order_id = o.id)::int as photo_count
from sack_orders o
left join profiles cb on cb.id = o.created_by
left join profiles sb on sb.id = o.sent_by;

grant select on sack_rows to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.tables where table_name = 'sack_orders')        as ตารางรายการ,
  (select count(*) from information_schema.tables where table_name = 'sack_order_photos')  as ตารางรูป,
  (select count(*) from pg_proc where proname = 'create_sack_order')                       as ฟังก์ชันตั้งรายการ,
  (select count(*) from pg_proc where proname = 'mark_sack_sent')                          as ฟังก์ชันกดส่ง,
  (select count(*) from information_schema.views where table_name = 'sack_rows')           as วิวสำหรับหน้าจอ,
  (select count(*) from sack_orders)                                                       as รายการที่มีอยู่;
