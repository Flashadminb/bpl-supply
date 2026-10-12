-- ---------------------------------------------------------------------
-- 146 · พัสดุค้างเกิน 24 ชม
--
-- ไฟล์ที่เจ้าของระบบส่งมาเป็นรายชิ้น ไม่ใช่รายสาขาแบบของค้างส่งออก
-- ของชิ้นที่ค้างน้อยสุดในไฟล์คือ 25.2 ชม ไม่มีชิ้นไหนต่ำกว่า 24 เลย
-- แปลว่าต้นทางกรองมาให้แล้วว่าเป็นรายการที่เลยกรอบ 24 ชม ชื่อจึงมาจากตรงนั้น
--
-- สิ่งที่เจ้าของระบบสั่งให้เน้นคือ "ยกเลิกการส่งต่อพัสดุ" ซึ่งเป็นค่าหนึ่ง
-- ในคอลัมน์การดำเนินการล่าสุด และต้องเห็นครบทุกเลขในหน้าเดียว ไม่ตัด
--
-- ตัดสินใจเรื่องโซน · ใช้ hub_out_zones ร่วมกับของค้างส่งออก ไม่ทำตารางใหม่
-- เพราะชื่อสาขาเป็นรูปแบบเดียวกัน ถ้าแยกตาราง คนต้องตั้งโซนสองที่
-- แล้ววันหนึ่งสองที่จะไม่ตรงกัน โดยไม่มีใครรู้ว่าอันไหนถูก
-- ---------------------------------------------------------------------

create table if not exists parcel24_snapshots (
  id          bigserial primary key,
  /** เวลาดำเนินการล่าสุดที่สุดในไฟล์ · ใช้เป็นตัวกันอัปซ้ำ ไฟล์เดิมอัปกี่รอบก็ได้ชุดเดียว */
  data_at     timestamptz not null unique,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid references profiles (id),
  file_name   text,
  row_count   integer not null default 0,
  cancel_count integer not null default 0
);

create table if not exists parcel24_rows (
  snapshot_id  bigint not null references parcel24_snapshots (id) on delete cascade,
  tracking     text not null,
  dest         text not null default '',
  last_action  text not null default '',
  last_at      timestamptz,
  in_wh_at     timestamptz,
  actor        text,
  province     text,
  primary key (snapshot_id, tracking)
);

create index if not exists parcel24_rows_dest on parcel24_rows (snapshot_id, dest);
create index if not exists parcel24_rows_action on parcel24_rows (snapshot_id, last_action);

alter table parcel24_snapshots enable row level security;
alter table parcel24_rows enable row level security;

drop policy if exists own_parcel24_snapshots on parcel24_snapshots;
create policy own_parcel24_snapshots on parcel24_snapshots for all to authenticated
  using (my_can_outbox()) with check (my_can_outbox());

drop policy if exists own_parcel24_rows on parcel24_rows;
create policy own_parcel24_rows on parcel24_rows for all to authenticated
  using (my_can_outbox()) with check (my_can_outbox());


/**
 * รับไฟล์ที่หน้าเว็บแกะแล้ว
 *
 * กันอัปซ้ำด้วย data_at เหมือนของค้างส่งออก · อัปไฟล์เดิมซ้ำจะได้ของเดิม ไม่เพิ่มรอบ
 * เก็บย้อนหลัง 12 รอบ ที่เกินลบทิ้ง เพราะไฟล์ละพันกว่าแถว ถ้าไม่ลบจะกินโควตา
 * ของ free tier ภายในไม่กี่เดือน และไม่มีใครย้อนดูเกินสองสามรอบอยู่แล้ว
 */
create or replace function parcel24_import(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_at   timestamptz;
  v_id   bigint;
  v_n    integer;
  v_c    integer;
  v_new  boolean := true;
begin
  if not my_can_outbox() then
    raise exception 'บัญชีนี้อัปไฟล์นี้ไม่ได้';
  end if;

  v_at := (p->>'data_at')::timestamptz;
  if v_at is null then
    raise exception 'ไฟล์นี้ไม่มีเวลาดำเนินการล่าสุด จึงบอกไม่ได้ว่าเป็นข้อมูลรอบไหน';
  end if;

  select id into v_id from parcel24_snapshots where data_at = v_at;
  if v_id is not null then
    v_new := false;
  else
    insert into parcel24_snapshots (data_at, uploaded_by, file_name)
    values (v_at, auth.uid(), p->>'file_name')
    returning id into v_id;

    insert into parcel24_rows (snapshot_id, tracking, dest, last_action, last_at, in_wh_at, actor, province)
    select v_id,
           x->>'tracking',
           coalesce(x->>'dest', ''),
           coalesce(x->>'action', ''),
           nullif(x->>'last_at', '')::timestamptz,
           nullif(x->>'in_wh_at', '')::timestamptz,
           nullif(x->>'actor', ''),
           nullif(x->>'province', '')
      from jsonb_array_elements(p->'rows') x
     where coalesce(btrim(x->>'tracking'), '') <> ''
    on conflict (snapshot_id, tracking) do nothing;

    select count(*), count(*) filter (where last_action = 'ยกเลิกการส่งต่อพัสดุ')
      into v_n, v_c
      from parcel24_rows where snapshot_id = v_id;

    update parcel24_snapshots set row_count = v_n, cancel_count = v_c where id = v_id;

    delete from parcel24_snapshots s
     where s.id not in (select id from parcel24_snapshots order by data_at desc limit 12);
  end if;

  select row_count, cancel_count into v_n, v_c from parcel24_snapshots where id = v_id;
  return jsonb_build_object('id', v_id, 'is_new', v_new, 'rows', v_n, 'cancel', v_c);
end $$;

grant execute on function parcel24_import(jsonb) to authenticated;


/**
 * ข้อมูลทั้งกระดาน
 *
 * ส่งรายชิ้นออกไปทั้งหมด เพราะหน้าเว็บต้องให้คัดลอกเลขพัสดุทีละเลขและยกชุด
 * ซึ่งทำได้ก็ต่อเมื่อมีเลขจริงอยู่ในมือ · พันกว่าแถวยังเล็กกว่ารูปหนึ่งใบ
 * โซนต่อจาก hub_out_zones ด้วย left join · ไม่มีโซนไม่ได้แปลว่าหายไปจากกระดาน
 */
create or replace function parcel24_board() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_cur  parcel24_snapshots%rowtype;
  v_prev parcel24_snapshots%rowtype;
  v_rows jsonb;
begin
  if not my_can_outbox() then
    raise exception 'บัญชีนี้ดูหน้านี้ไม่ได้';
  end if;

  select * into v_cur from parcel24_snapshots order by data_at desc limit 1;
  if v_cur.id is null then
    return jsonb_build_object('snapshot', null, 'rows', '[]'::jsonb);
  end if;

  select * into v_prev
    from parcel24_snapshots where data_at < v_cur.data_at order by data_at desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'tracking', r.tracking,
           'dest', r.dest,
           'zone', nullif(btrim(coalesce(z.zone, '')), ''),
           'action', r.last_action,
           'last_at', r.last_at,
           'in_wh_at', r.in_wh_at,
           'actor', r.actor,
           'province', r.province
         ) order by r.dest, r.tracking), '[]'::jsonb)
    into v_rows
    from parcel24_rows r
    left join hub_out_zones z on z.station = r.dest
   where r.snapshot_id = v_cur.id;

  return jsonb_build_object(
    'snapshot', jsonb_build_object(
      'id', v_cur.id,
      'data_at', v_cur.data_at,
      'uploaded_at', v_cur.uploaded_at,
      'file_name', v_cur.file_name,
      'row_count', v_cur.row_count,
      'cancel_count', v_cur.cancel_count,
      'prev_at', v_prev.data_at,
      'prev_rows', v_prev.row_count,
      'prev_cancel', v_prev.cancel_count
    ),
    'rows', v_rows
  );
end $$;

grant execute on function parcel24_board() to authenticated;


/** ถอนรอบที่เพิ่งอัป · ไว้ให้แก้ตอนอัปไฟล์ผิด */
create or replace function parcel24_undo(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not my_can_outbox() then
    raise exception 'บัญชีนี้ถอนรอบไม่ได้';
  end if;
  delete from parcel24_snapshots where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function parcel24_undo(bigint) to authenticated;


/** รายการรอบที่อัปไว้ · ไว้ให้หน้าหลังบ้านลบรอบที่ผิด */
create or replace function parcel24_runs()
returns table (
  id bigint,
  data_at timestamptz,
  uploaded_at timestamptz,
  file_name text,
  row_count integer,
  cancel_count integer
)
language sql stable security definer set search_path = public as $$
  select s.id, s.data_at, s.uploaded_at, s.file_name, s.row_count, s.cancel_count
    from parcel24_snapshots s
   where my_can_outbox()
   order by s.data_at desc;
$$;

grant execute on function parcel24_runs() to authenticated;

select
  (select count(*) from pg_tables where tablename like 'parcel24%') as tbl,
  (select count(*) from pg_proc where proname like 'parcel24%')     as fns;
