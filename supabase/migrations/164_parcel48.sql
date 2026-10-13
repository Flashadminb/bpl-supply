-- ---------------------------------------------------------------------
-- 164 · งาน 48 ชั่วโมง
--
-- จับคู่สองไฟล์ที่ระบบต้นทางออกมาคนละใบ
--   ไฟล์รายละเอียด  23 ช่อง หัวตารางไทย แต่ไม่มีชื่อสินค้า   78,476 แถว
--   ไฟล์สินค้า      2 ช่อง ไม่มีหัวตาราง เลขพัสดุ + ชื่อสินค้า 60,146 แถว
--
-- ─────────────────────────────────────────────────────────────────
-- ทำไมแยกสองตาราง ไม่ยัดรวมเป็นตารางเดียวตอนนำเข้า
--
-- เจ้าของระบบสั่งว่า "อัพแล้วจับคู่ใหม่แก้ไฟล์ได้ทันที"
-- ถ้าจับคู่ตั้งแต่ตอนนำเข้า การแก้ชื่อสินค้าจะต้องอัปไฟล์ใหญ่ 10 MB ใหม่ทั้งก้อน
-- แยกเก็บแล้ว join ตอนค้นหา ทำให้อัปไฟล์สินค้าใบเดียวแล้วทุกแถวเปลี่ยนตาม
-- และย้อนกลับได้ทีละไฟล์ ไม่ต้องย้อนพร้อมกันทั้งคู่
-- ─────────────────────────────────────────────────────────────────
--
-- ─────────────────────────────────────────────────────────────────
-- ทำไมไม่ส่งทั้งกระดานออกไปแบบ parcel24_board()
--
-- งาน 24 มี 1,322 แถว ส่งทั้งก้อนได้สบาย · หน้านี้มี 54,834 แถวหลังกรองฮับแล้ว
-- ส่งทั้งก้อนคือ ~25 MB ต่อการเปิดหน้าหนึ่งครั้ง ทั้งเปลืองเน็ตในฮับที่ไม่นิ่ง
-- และเบราว์เซอร์มือถือจะค้าง จึงกรองที่ฐานข้อมูลแล้วส่งมาทีละหน้า
-- ─────────────────────────────────────────────────────────────────
--
-- สิทธิ์ · เจ้าของระบบกับผู้ดูแลระบบเท่านั้น ตรงกับ my_can_outbox()
-- หน้างานยังไม่เปิด ต่างจากงาน 24 ที่เปิดให้ดูแล้วในไฟล์ 160
-- ---------------------------------------------------------------------

/* รอบการอัป · แยกตามชนิดไฟล์ รอบใหม่สุดของแต่ละชนิดคือรอบที่ใช้งานอยู่ */
create table if not exists p48_runs (
  id            bigserial primary key,
  kind          text not null check (kind in ('parcel', 'product')),
  uploaded_at   timestamptz not null default now(),
  uploaded_by   uuid references profiles (id),
  file_name     text,
  /** แถวที่เก็บจริงหลังกรองฮับและตัดเลขซ้ำแล้ว */
  row_count     integer not null default 0,
  /** แถวทั้งหมดในไฟล์ก่อนกรอง · ไว้บอกว่าตัดของฮับอื่นออกไปเท่าไหร่ */
  file_rows     integer not null default 0,
  /** อัปเสร็จแล้วหรือยัง · รอบที่ค้างกลางทางจะไม่ถูกหยิบมาใช้ */
  done          boolean not null default false
);

create index if not exists p48_runs_live on p48_runs (kind, done, id desc);

create table if not exists p48_parcels (
  run_id       bigint not null references p48_runs (id) on delete cascade,
  tracking     text not null,
  status       text,
  cod          text,
  weight       text,
  eta_out_at   timestamptz,
  arrived_at   timestamptz,
  scan_out_at  timestamptz,
  bag_no       text,
  hold_reason  text,
  last_action  text,
  last_at      timestamptz,
  actor_phone  text,
  mgr_phone    text,
  next_branch  text,
  recv_branch  text,
  picked_at    timestamptz,
  hub          text,
  dest_branch  text,
  province     text,
  district     text,
  postcode     text,
  cust_type    text,
  customer     text,
  primary key (run_id, tracking)
);

create index if not exists p48_parcels_dest   on p48_parcels (run_id, dest_branch);
create index if not exists p48_parcels_cust   on p48_parcels (run_id, cust_type);
create index if not exists p48_parcels_action on p48_parcels (run_id, last_action);
create index if not exists p48_parcels_prov   on p48_parcels (run_id, province);
create index if not exists p48_parcels_picked on p48_parcels (run_id, picked_at);
create index if not exists p48_parcels_bag    on p48_parcels (run_id, bag_no);

create table if not exists p48_products (
  run_id   bigint not null references p48_runs (id) on delete cascade,
  tracking text not null,
  detail   text not null default '',
  primary key (run_id, tracking)
);

alter table p48_runs     enable row level security;
alter table p48_parcels  enable row level security;
alter table p48_products enable row level security;

drop policy if exists own_p48_runs on p48_runs;
create policy own_p48_runs on p48_runs for all to authenticated
  using (my_can_outbox()) with check (my_can_outbox());

drop policy if exists own_p48_parcels on p48_parcels;
create policy own_p48_parcels on p48_parcels for all to authenticated
  using (my_can_outbox()) with check (my_can_outbox());

drop policy if exists own_p48_products on p48_products;
create policy own_p48_products on p48_products for all to authenticated
  using (my_can_outbox()) with check (my_can_outbox());


/* --------------------------------------------------------------- ตัวช่วย */

/**
 * รอบที่ใช้งานอยู่ของชนิดไฟล์หนึ่ง · รอบใหม่สุดที่อัปเสร็จแล้ว
 *
 * แยกเป็นฟังก์ชันเพราะทุก RPC ด้านล่างต้องถามคำถามเดียวกันนี้
 * ถ้าเขียนซ้ำในแต่ละตัว วันที่กติกาเปลี่ยนจะแก้ไม่ครบแล้วสองหน้าจะไม่ตรงกัน
 */
create or replace function p48_live(p_kind text) returns bigint
language sql stable security definer set search_path = public as $$
  select id from p48_runs
   where kind = p_kind and done
   order by id desc limit 1;
$$;

grant execute on function p48_live(text) to authenticated;


/* --------------------------------------------------------------- นำเข้า */

/**
 * เปิดรอบใหม่ · คืน run_id ให้หน้าเว็บเอาไปใส่ทุกก้อนที่ส่งตามมา
 *
 * ต้องแบ่งส่งเป็นก้อนเพราะไฟล์เดียวมี 54,834 แถว ยัดเป็น jsonb ก้อนเดียว
 * คือ ~25 MB ซึ่งเกินที่ฝั่งเน็ตเวิร์กจะส่งจบในครั้งเดียวอย่างปลอดภัย
 * และถ้าหลุดกลางทางจะไม่มีทางรู้ว่าเข้าไปแล้วกี่แถว
 *
 * รอบที่เปิดแล้วยังไม่ปิด done = false จึงไม่มีใครเห็น ของเดิมยังอยู่ครบ
 * เน็ตหลุดกลางคันจึงไม่ทำให้จอว่าง แค่มีรอบค้างที่ไม่มีใครหยิบไปใช้
 */
create or replace function p48_begin(p_kind text, p_file text, p_file_rows integer)
returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not my_can_outbox() then
    raise exception 'บัญชีนี้อัปไฟล์นี้ไม่ได้';
  end if;
  if p_kind not in ('parcel', 'product') then
    raise exception 'ชนิดไฟล์ไม่ถูกต้อง';
  end if;

  /* เก็บกวาดรอบที่เปิดค้างไว้เกินหนึ่งชั่วโมง · อัปไม่จบแล้วปิดหน้าไปเฉย ๆ */
  delete from p48_runs
   where kind = p_kind and not done and uploaded_at < now() - interval '1 hour';

  insert into p48_runs (kind, uploaded_by, file_name, file_rows)
  values (p_kind, auth.uid(), p_file, coalesce(p_file_rows, 0))
  returning id into v_id;

  return v_id;
end $$;

grant execute on function p48_begin(text, text, integer) to authenticated;


/** ก้อนข้อมูลของไฟล์รายละเอียด · เรียกซ้ำได้จนกว่าจะหมดไฟล์ */
create or replace function p48_put_parcels(p_run bigint, p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not my_can_outbox() then
    raise exception 'บัญชีนี้อัปไฟล์นี้ไม่ได้';
  end if;
  if not exists (select 1 from p48_runs where id = p_run and kind = 'parcel' and not done) then
    raise exception 'รอบนี้ปิดไปแล้วหรือไม่มีอยู่';
  end if;

  insert into p48_parcels (
    run_id, tracking, status, cod, weight, eta_out_at, arrived_at, scan_out_at,
    bag_no, hold_reason, last_action, last_at, actor_phone, mgr_phone,
    next_branch, recv_branch, picked_at, hub, dest_branch, province, district,
    postcode, cust_type, customer
  )
  select p_run,
         x->>'tracking',
         nullif(x->>'status', ''),
         nullif(x->>'cod', ''),
         nullif(x->>'weight', ''),
         nullif(x->>'eta_out_at', '')::timestamptz,
         nullif(x->>'arrived_at', '')::timestamptz,
         nullif(x->>'scan_out_at', '')::timestamptz,
         nullif(x->>'bag_no', ''),
         nullif(x->>'hold_reason', ''),
         nullif(x->>'last_action', ''),
         nullif(x->>'last_at', '')::timestamptz,
         nullif(x->>'actor_phone', ''),
         nullif(x->>'mgr_phone', ''),
         nullif(x->>'next_branch', ''),
         nullif(x->>'recv_branch', ''),
         nullif(x->>'picked_at', '')::timestamptz,
         nullif(x->>'hub', ''),
         nullif(x->>'dest_branch', ''),
         nullif(x->>'province', ''),
         nullif(x->>'district', ''),
         nullif(x->>'postcode', ''),
         nullif(x->>'cust_type', ''),
         nullif(x->>'customer', '')
    from jsonb_array_elements(p_rows) x
   where coalesce(btrim(x->>'tracking'), '') <> ''
  on conflict (run_id, tracking) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end $$;

grant execute on function p48_put_parcels(bigint, jsonb) to authenticated;


/** ก้อนข้อมูลของไฟล์สินค้า */
create or replace function p48_put_products(p_run bigint, p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not my_can_outbox() then
    raise exception 'บัญชีนี้อัปไฟล์นี้ไม่ได้';
  end if;
  if not exists (select 1 from p48_runs where id = p_run and kind = 'product' and not done) then
    raise exception 'รอบนี้ปิดไปแล้วหรือไม่มีอยู่';
  end if;

  insert into p48_products (run_id, tracking, detail)
  select p_run, x->>'t', coalesce(x->>'d', '')
    from jsonb_array_elements(p_rows) x
   where coalesce(btrim(x->>'t'), '') <> ''
  on conflict (run_id, tracking) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end $$;

grant execute on function p48_put_products(bigint, jsonb) to authenticated;


/**
 * ปิดรอบ · ตั้งแต่บรรทัดนี้รอบใหม่คือรอบที่ทุกคนเห็น
 *
 * เก็บย้อนหลังชนิดละ 2 รอบ · รอบปัจจุบันกับรอบก่อนหน้าไว้กดย้อนกลับ
 * มากกว่านี้ไม่เก็บ เพราะรอบละ ~25 MB และ free tier มี 500 MB ทั้งระบบ
 */
create or replace function p48_end(p_run bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_kind text;
  v_n    integer;
begin
  if not my_can_outbox() then
    raise exception 'บัญชีนี้อัปไฟล์นี้ไม่ได้';
  end if;

  select kind into v_kind from p48_runs where id = p_run and not done;
  if v_kind is null then
    raise exception 'รอบนี้ปิดไปแล้วหรือไม่มีอยู่';
  end if;

  if v_kind = 'parcel' then
    select count(*) into v_n from p48_parcels where run_id = p_run;
  else
    select count(*) into v_n from p48_products where run_id = p_run;
  end if;

  if v_n = 0 then
    delete from p48_runs where id = p_run;
    raise exception 'ไฟล์นี้ไม่มีแถวไหนเข้าเลย จึงไม่ได้บันทึกรอบใหม่ ของเดิมยังอยู่ครบ';
  end if;

  update p48_runs set row_count = v_n, done = true where id = p_run;

  /* นับเฉพาะรอบที่อัปเสร็จแล้ว · รอบของคนอื่นที่กำลังอัปค้างอยู่ต้องไม่โดนลบทิ้ง
     ถ้านับรวมรอบที่ยังไม่เสร็จ สองรอบที่เก็บไว้อาจกลายเป็นรอบเปล่ากับรอบปัจจุบัน
     แล้วรอบก่อนหน้าที่ไว้กดย้อนกลับจะหายไปเงียบ ๆ */
  delete from p48_runs r
   where r.kind = v_kind
     and r.done
     and r.id not in (select id from p48_runs where kind = v_kind and done order by id desc limit 2);

  return jsonb_build_object('id', p_run, 'kind', v_kind, 'rows', v_n);
end $$;

grant execute on function p48_end(bigint) to authenticated;


/**
 * ย้อนกลับทีละชนิดไฟล์ · ลบรอบปัจจุบัน รอบก่อนหน้ากลับมาเป็นรอบที่ใช้
 *
 * ถ้าไม่มีรอบก่อนหน้า จะไม่ลบให้ เพราะลบแล้วจอจะว่างเปล่า
 * ซึ่งแทบไม่เคยเป็นสิ่งที่คนกดตั้งใจ · อยากล้างจริงต้องลบจากหน้ารายการรอบ
 */
create or replace function p48_undo(p_kind text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cur  bigint;
  v_prev bigint;
begin
  if not my_can_outbox() then
    raise exception 'บัญชีนี้ย้อนกลับไม่ได้';
  end if;

  select id into v_cur from p48_runs where kind = p_kind and done order by id desc limit 1;
  if v_cur is null then
    raise exception 'ยังไม่เคยอัปไฟล์ชนิดนี้ จึงไม่มีอะไรให้ย้อน';
  end if;

  select id into v_prev
    from p48_runs where kind = p_kind and done and id < v_cur order by id desc limit 1;
  if v_prev is null then
    raise exception 'มีอยู่รอบเดียว ย้อนกลับแล้วจะไม่เหลือข้อมูลเลย · ถ้าตั้งใจจะล้างให้ลบจากรายการรอบ';
  end if;

  delete from p48_runs where id = v_cur;
  return jsonb_build_object('ok', true, 'back_to', v_prev);
end $$;

grant execute on function p48_undo(text) to authenticated;


/** ลบรอบที่ระบุทิ้ง · ไว้ล้างของจริงเมื่อคนตั้งใจ */
create or replace function p48_drop_run(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not my_can_outbox() then
    raise exception 'บัญชีนี้ลบรอบไม่ได้';
  end if;
  delete from p48_runs where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function p48_drop_run(bigint) to authenticated;


/* --------------------------------------------------------------- อ่าน */

/**
 * การ์ดด้านบน · อัปเดตล่าสุดเมื่อไหร่ โดยใคร กี่ชิ้น และจับคู่ได้เท่าไหร่
 *
 * นับการจับคู่จริงทุกครั้งที่เปิดหน้า ไม่ได้เก็บเป็นตัวเลขตายตัวตอนนำเข้า
 * เพราะอัปไฟล์สินค้าใบใหม่แล้วตัวเลขต้องขยับเองทันที ซึ่งเป็นทั้งหมดที่
 * เจ้าของระบบขอไว้ว่า "อัพแล้วจับคู่ใหม่แก้ไฟล์ได้ทันที"
 */
create or replace function p48_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_a       p48_runs%rowtype;
  v_b       p48_runs%rowtype;
  v_matched integer := 0;
  v_card    jsonb;
begin
  if not my_can_outbox() then
    raise exception 'บัญชีนี้ดูหน้านี้ไม่ได้';
  end if;

  select * into v_a from p48_runs where id = p48_live('parcel');
  select * into v_b from p48_runs where id = p48_live('product');

  if v_a.id is not null and v_b.id is not null then
    select count(*) into v_matched
      from p48_parcels p
      join p48_products q on q.run_id = v_b.id and q.tracking = p.tracking
     where p.run_id = v_a.id;
  end if;

  v_card := jsonb_build_object(
    'matched', v_matched,
    'can_undo_parcel',  (select count(*) > 1 from p48_runs where kind = 'parcel'  and done),
    'can_undo_product', (select count(*) > 1 from p48_runs where kind = 'product' and done)
  );

  if v_a.id is not null then
    v_card := v_card || jsonb_build_object('parcel', jsonb_build_object(
      'id', v_a.id, 'at', v_a.uploaded_at, 'file', v_a.file_name,
      'rows', v_a.row_count, 'file_rows', v_a.file_rows,
      'by', (select coalesce(full_name, '') from profiles where id = v_a.uploaded_by),
      'code', (select coalesce(employee_code, '') from profiles where id = v_a.uploaded_by)
    ));
  end if;

  if v_b.id is not null then
    v_card := v_card || jsonb_build_object('product', jsonb_build_object(
      'id', v_b.id, 'at', v_b.uploaded_at, 'file', v_b.file_name,
      'rows', v_b.row_count, 'file_rows', v_b.file_rows,
      'by', (select coalesce(full_name, '') from profiles where id = v_b.uploaded_by),
      'code', (select coalesce(employee_code, '') from profiles where id = v_b.uploaded_by)
    ));
  end if;

  return v_card;
end $$;

grant execute on function p48_stats() to authenticated;


/**
 * ค่าที่มีจริงในรอบนี้ ไว้เติมดรอปดาวน์ตัวกรอง
 *
 * ไม่ได้ hardcode รายชื่อสาขาหรือหัวข้อการดำเนินการไว้ในโค้ด
 * เพราะรายการพวกนี้เปลี่ยนตามไฟล์ทุกรอบ · ถ้า hardcode ไว้
 * วันที่ต้นทางเพิ่มหัวข้อใหม่ ตัวกรองจะกรองของชิ้นนั้นออกโดยไม่มีใครรู้
 */
create or replace function p48_facets() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_run bigint;
begin
  if not my_can_outbox() then
    raise exception 'บัญชีนี้ดูหน้านี้ไม่ได้';
  end if;

  v_run := p48_live('parcel');
  if v_run is null then
    return jsonb_build_object('dest', '[]'::jsonb, 'action', '[]'::jsonb,
                              'prov', '[]'::jsonb, 'cust', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'dest',   (select coalesce(jsonb_agg(jsonb_build_object('v', v, 'n', n) order by n desc), '[]'::jsonb)
                 from (select dest_branch v, count(*) n from p48_parcels
                        where run_id = v_run and dest_branch is not null
                        group by 1 order by 2 desc limit 400) z),
    'action', (select coalesce(jsonb_agg(jsonb_build_object('v', v, 'n', n) order by n desc), '[]'::jsonb)
                 from (select last_action v, count(*) n from p48_parcels
                        where run_id = v_run and last_action is not null
                        group by 1 order by 2 desc limit 100) z),
    'prov',   (select coalesce(jsonb_agg(jsonb_build_object('v', v, 'n', n) order by n desc), '[]'::jsonb)
                 from (select province v, count(*) n from p48_parcels
                        where run_id = v_run and province is not null
                        group by 1 order by 2 desc limit 200) z),
    'cust',   (select coalesce(jsonb_agg(jsonb_build_object('v', v, 'n', n) order by n desc), '[]'::jsonb)
                 from (select cust_type v, count(*) n from p48_parcels
                        where run_id = v_run and cust_type is not null
                        group by 1 order by 2 desc limit 50) z)
  );
end $$;

grant execute on function p48_facets() to authenticated;


/**
 * ค้นหา · กรองที่ฐานข้อมูลแล้วส่งมาทีละหน้า
 *
 * คืนทั้งจำนวนที่ตรงทั้งหมดกับแถวของหน้านี้ เพราะหน้าจอต้องบอกได้ว่า
 * "เจอ 1,976 จาก 54,834" ทั้งที่กางอยู่แค่ 300 แถวแรก
 *
 * อายุของที่ค้างนับจาก picked_at เวลาเข้ารับสินค้า เพราะเป็นช่องเดียว
 * ที่มีค่าครบทุกแถว · arrived_at เวลาถึงตามจริง ว่างไป 21,071 แถว
 * ซึ่งคือของที่ยังไม่ถึงคลัง ถ้าใช้ช่องนั้นของกลุ่มนี้จะหายไปจากทุกตัวกรอง
 */
create or replace function p48_search(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_run   bigint;
  v_prod  bigint;
  v_q     text    := nullif(btrim(coalesce(p->>'q', '')), '');
  v_cust  text    := nullif(p->>'cust', '');
  v_dest  text    := nullif(p->>'dest', '');
  v_act   text    := nullif(p->>'action', '');
  v_prov  text    := nullif(p->>'prov', '');
  v_age   integer := coalesce((p->>'age')::integer, 0);
  v_bag   boolean := coalesce((p->>'bag')::boolean, false);
  v_nop   boolean := coalesce((p->>'nop')::boolean, false);
  v_cn    boolean := coalesce((p->>'cn')::boolean, false);
  v_lim   integer := least(greatest(coalesce((p->>'limit')::integer, 300), 1), 1000);
  v_off   integer := greatest(coalesce((p->>'offset')::integer, 0), 0);
  v_total integer;
  v_rows  jsonb;
begin
  if not my_can_outbox() then
    raise exception 'บัญชีนี้ดูหน้านี้ไม่ได้';
  end if;

  v_run  := p48_live('parcel');
  v_prod := p48_live('product');
  if v_run is null then
    return jsonb_build_object('total', 0, 'rows', '[]'::jsonb, 'all', 0);
  end if;

  /* % กับ _ ในคำค้นต้องเป็นตัวอักษรธรรมดา ไม่ใช่ไวลด์การ์ด
     เลขพัสดุไม่มีสองตัวนี้อยู่แล้ว แต่ชื่อสินค้ามี เช่น "ลด 50% " */
  if v_q is not null then
    v_q := replace(replace(v_q, '%', '\%'), '_', '\_');
  end if;

  /*
     นับทั้งหมดกับหยิบหน้าปัจจุบันจากชุดเดียวกันในคำสั่งเดียว
     ถ้าแยกสองคำสั่งจะกรองซ้ำสองรอบ ซึ่งบนห้าหมื่นแถวคือช้าขึ้นเท่าตัวฟรี ๆ

     ตัวจีนเทียบด้วยช่วงตัวอักษรจริง [一-鿿] ไม่ใช่ \u escape
     เพราะรูปแบบ escape ขึ้นกับว่า string นั้นเป็น E'' หรือเปล่า
     ซึ่งพลาดง่ายเวลาโค้ดถูกคัดลอกไปวางที่อื่น
  */
  with hit as (
    select p1.tracking,
           q.detail,
           p1.cust_type,
           p1.dest_branch,
           p1.weight,
           p1.picked_at,
           p1.last_action,
           p1.bag_no
      from p48_parcels p1
      left join p48_products q
        on v_prod is not null and q.run_id = v_prod and q.tracking = p1.tracking
     where p1.run_id = v_run
       and (v_cust is null or p1.cust_type   = v_cust)
       and (v_dest is null or p1.dest_branch = v_dest)
       and (v_act  is null or p1.last_action = v_act)
       and (v_prov is null or p1.province    = v_prov)
       and (v_age  <= 0    or p1.picked_at <= now() - make_interval(hours => v_age))
       and (not v_bag      or (p1.bag_no is not null and p1.bag_no not in ('--', '-')))
       and (not v_nop      or q.detail is null)
       and (not v_cn       or q.detail ~ '[一-鿿]')
       and (v_q is null
            or p1.tracking ilike '%' || v_q || '%'
            or p1.bag_no   ilike '%' || v_q || '%'
            or q.detail    ilike '%' || v_q || '%')
  )
  select (select count(*) from hit),
         (select coalesce(jsonb_agg(to_jsonb(z) order by z.picked_at asc nulls last, z.tracking), '[]'::jsonb)
            from (select * from hit order by picked_at asc nulls last, tracking
                   limit v_lim offset v_off) z)
    into v_total, v_rows;

  return jsonb_build_object(
    'total', v_total,
    'all',   (select row_count from p48_runs where id = v_run),
    'rows',  v_rows
  );
end $$;

grant execute on function p48_search(jsonb) to authenticated;


/** ทุกช่องของพัสดุชิ้นเดียว · เรียกตอนกดเปิดแผงขวา ไม่ได้ส่งมากับตาราง */
create or replace function p48_one(p_tracking text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_run  bigint;
  v_prod bigint;
  v_out  jsonb;
begin
  if not my_can_outbox() then
    raise exception 'บัญชีนี้ดูหน้านี้ไม่ได้';
  end if;

  v_run  := p48_live('parcel');
  v_prod := p48_live('product');
  if v_run is null then return null; end if;

  select to_jsonb(p1) - 'run_id' || jsonb_build_object('detail', q.detail)
    into v_out
    from p48_parcels p1
    left join p48_products q on v_prod is not null and q.run_id = v_prod and q.tracking = p1.tracking
   where p1.run_id = v_run and p1.tracking = p_tracking;

  return v_out;
end $$;

grant execute on function p48_one(text) to authenticated;


/** รายการรอบที่อัปไว้ · ไว้ให้ลบรอบที่ผิด */
create or replace function p48_run_list()
returns table (id bigint, kind text, uploaded_at timestamptz, file_name text,
               row_count integer, file_rows integer, done boolean, by_name text)
language sql stable security definer set search_path = public as $$
  select r.id, r.kind, r.uploaded_at, r.file_name, r.row_count, r.file_rows, r.done,
         coalesce(i.full_name, '')
    from p48_runs r
    left join profiles i on i.id = r.uploaded_by
   where my_can_outbox()
   order by r.id desc;
$$;

grant execute on function p48_run_list() to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล · ต้องได้ตาราง 3 ฟังก์ชัน 12 และยังไม่มีข้อมูลสักแถว
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_tables where tablename like 'p48%')  as ตาราง,
  (select count(*) from pg_proc   where proname  like 'p48%')   as ฟังก์ชัน,
  (select count(*) from p48_runs)                               as รอบที่อัปแล้ว;
