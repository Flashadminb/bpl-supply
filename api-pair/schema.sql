-- =====================================================================
-- โครงตารางของหน้าจับคู่ บนฐานข้อมูล Neon
--
-- ยกมาจาก Supabase ไฟล์ 164 166 170 171 172 รวมกัน
-- สิ่งที่ตัดออกคือของที่เป็นของ Supabase โดยเฉพาะ
--
--   auth.uid() กับ my_can_outbox()  → ไม่มีในที่นี่
--   RLS กับ policy                  → ไม่มี
--
-- ─────────────────────────────────────────────────────────────────
-- แล้วใครกันคนตรวจสิทธิ์
--
-- ตัวกลาง Worker ตรวจ token ของ Supabase ก่อนทุกครั้ง แล้วค่อยคุยกับที่นี่
-- ฐานข้อมูลนี้ไม่เปิดออกสู่อินเทอร์เน็ตให้ใครต่อตรง ๆ
-- มีแต่ Worker ที่ถือสายเชื่อมต่อ ซึ่งเก็บเป็น secret ไม่อยู่ในไฟล์ไหน
--
-- ต่างจากฝั่ง Supabase ที่ RLS เป็นด่านสุดท้ายในตัวฐานข้อมูลเอง
-- ที่นี่ด่านสุดท้ายคือ "ไม่มีใครต่อถึงได้นอกจาก Worker"
-- จึงห้ามเปิดสายเชื่อมนี้ให้อะไรอื่นเด็ดขาด
-- ─────────────────────────────────────────────────────────────────
--
-- ชื่อคนอัปเก็บเป็นข้อความตรงนี้เลย ไม่ได้ join จากตารางพนักงาน
-- เพราะตารางนั้นอยู่คนละฐานข้อมูลแล้ว
-- และจริง ๆ ดีกว่าเดิมด้วย ประวัติเก่าจะไม่เปลี่ยนถ้าใครเปลี่ยนชื่อทีหลัง
-- =====================================================================

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------
-- ตาราง
-- ---------------------------------------------------------------------
create table if not exists p48_runs (
  id          bigserial primary key,
  kind        text not null check (kind in ('parcel', 'product')),
  uploaded_at timestamptz not null default now(),
  /** รหัสผู้ใช้จาก token ของ Supabase · เก็บไว้อ้างอิง ไม่ได้ใช้ join */
  uploaded_by uuid,
  /** ชื่อกับรหัสพนักงาน ณ ตอนอัป · หยุดนิ่งตลอดไป ไม่เปลี่ยนตามการแก้ชื่อ */
  by_name     text,
  by_code     text,
  file_name   text,
  row_count   integer not null default 0,
  file_rows   integer not null default 0,
  done        boolean not null default false
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

/* ดัชนีที่ทำให้การค้นหาเลิกไล่อ่านทั้งตาราง · บทเรียนจากคืนที่ CPU ตัน */
create index if not exists p48_products_detail_trgm
  on p48_products using gin (detail gin_trgm_ops);
create index if not exists p48_parcels_tracking_trgm
  on p48_parcels using gin (tracking gin_trgm_ops);
create index if not exists p48_parcels_bag_trgm
  on p48_parcels using gin (bag_no gin_trgm_ops);

create table if not exists p48_sla (
  cust_type  text primary key,
  days       integer not null check (days between 0 and 365),
  sort_no    integer not null default 0,
  is_active  boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  by_name    text
);


-- ---------------------------------------------------------------------
-- รอบที่ใช้งานอยู่
-- ---------------------------------------------------------------------
create or replace function p48_live(p_kind text) returns bigint
language sql stable as $$
  select id from p48_runs where kind = p_kind and done order by id desc limit 1;
$$;


-- ---------------------------------------------------------------------
-- เก็บกวาดรอบเก่า · เหมือนฝั่ง Supabase ทุกอย่าง
-- p_limit = 0 คือไม่จำกัด
-- ---------------------------------------------------------------------
create or replace function p48_sweep(p_limit integer default 20000) returns integer
language plpgsql as $$
declare
  v_dead  bigint[];
  v_left  integer := case when coalesce(p_limit, 0) <= 0 then 2147483647 else p_limit end;
  v_step  integer;
  v_gone  integer := 0;
  v_batch integer;
begin
  select coalesce(array_agg(id), array[]::bigint[]) into v_dead
    from p48_runs r
   where (not r.done and r.uploaded_at < now() - interval '1 hour')
      or (r.done and r.id not in (
            select id from p48_runs x where x.kind = r.kind and x.done
             order by id desc limit 2));

  if array_length(v_dead, 1) is null then return 0; end if;

  while v_left > 0 loop
    v_batch := least(v_left, 20000);

    with x as (select ctid from p48_parcels where run_id = any (v_dead) limit v_batch)
    delete from p48_parcels p using x where p.ctid = x.ctid;
    get diagnostics v_step = row_count;

    if v_step < v_batch then
      with x as (select ctid from p48_products where run_id = any (v_dead) limit v_batch - v_step)
      delete from p48_products q using x where q.ctid = x.ctid;
      get diagnostics v_batch = row_count;
      v_step := v_step + v_batch;
    end if;

    exit when v_step = 0;
    v_gone := v_gone + v_step;
    v_left := v_left - v_step;
  end loop;

  delete from p48_runs r
   where r.id = any (v_dead)
     and not exists (select 1 from p48_parcels  where run_id = r.id)
     and not exists (select 1 from p48_products where run_id = r.id);

  return v_gone;
end $$;


-- ---------------------------------------------------------------------
-- นำเข้า
-- ---------------------------------------------------------------------
create or replace function p48_begin(
  p_kind text, p_file text, p_file_rows integer,
  p_uid uuid, p_name text, p_code text
) returns bigint
language plpgsql as $$
declare v_id bigint;
begin
  if p_kind not in ('parcel', 'product') then
    raise exception 'ชนิดไฟล์ไม่ถูกต้อง';
  end if;
  insert into p48_runs (kind, uploaded_by, by_name, by_code, file_name, file_rows)
  values (p_kind, p_uid, p_name, p_code, p_file, coalesce(p_file_rows, 0))
  returning id into v_id;
  return v_id;
end $$;


create or replace function p48_put_parcels(p_run bigint, p_rows jsonb) returns integer
language plpgsql as $$
declare v_n integer;
begin
  if not exists (select 1 from p48_runs where id = p_run and kind = 'parcel' and not done) then
    raise exception 'รอบนี้ปิดไปแล้วหรือไม่มีอยู่';
  end if;

  insert into p48_parcels (
    run_id, tracking, status, cod, weight, eta_out_at, arrived_at, scan_out_at,
    bag_no, hold_reason, last_action, last_at, actor_phone, mgr_phone,
    next_branch, recv_branch, picked_at, hub, dest_branch, province, district,
    postcode, cust_type, customer)
  select p_run, x->>'tracking',
         nullif(x->>'status',''), nullif(x->>'cod',''), nullif(x->>'weight',''),
         nullif(x->>'eta_out_at','')::timestamptz,
         nullif(x->>'arrived_at','')::timestamptz,
         nullif(x->>'scan_out_at','')::timestamptz,
         nullif(x->>'bag_no',''), nullif(x->>'hold_reason',''),
         nullif(x->>'last_action',''), nullif(x->>'last_at','')::timestamptz,
         nullif(x->>'actor_phone',''), nullif(x->>'mgr_phone',''),
         nullif(x->>'next_branch',''), nullif(x->>'recv_branch',''),
         nullif(x->>'picked_at','')::timestamptz,
         nullif(x->>'hub',''), nullif(x->>'dest_branch',''), nullif(x->>'province',''),
         nullif(x->>'district',''), nullif(x->>'postcode',''),
         nullif(x->>'cust_type',''), nullif(x->>'customer','')
    from jsonb_array_elements(p_rows) x
   where coalesce(btrim(x->>'tracking'), '') <> ''
  on conflict (run_id, tracking) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end $$;


create or replace function p48_put_products(p_run bigint, p_rows jsonb) returns integer
language plpgsql as $$
declare v_n integer;
begin
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


create or replace function p48_end(p_run bigint) returns jsonb
language plpgsql as $$
declare v_kind text; v_n integer; v_gone integer := 0;
begin
  select kind into v_kind from p48_runs where id = p_run and not done;
  if v_kind is null then raise exception 'รอบนี้ปิดไปแล้วหรือไม่มีอยู่'; end if;

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

  begin
    v_gone := p48_sweep(20000);
  exception when others then
    v_gone := -1;
  end;

  return jsonb_build_object('id', p_run, 'kind', v_kind, 'rows', v_n, 'swept', v_gone);
end $$;


create or replace function p48_undo(p_kind text) returns jsonb
language plpgsql as $$
declare v_cur bigint; v_prev bigint;
begin
  select id into v_cur from p48_runs where kind = p_kind and done order by id desc limit 1;
  if v_cur is null then raise exception 'ยังไม่เคยอัปไฟล์ชนิดนี้ จึงไม่มีอะไรให้ย้อน'; end if;

  select id into v_prev
    from p48_runs where kind = p_kind and done and id < v_cur order by id desc limit 1;
  if v_prev is null then
    raise exception 'มีอยู่รอบเดียว ย้อนกลับแล้วจะไม่เหลือข้อมูลเลย';
  end if;

  update p48_runs set done = false, uploaded_at = now() - interval '1 day' where id = v_cur;
  return jsonb_build_object('ok', true, 'back_to', v_prev);
end $$;


-- ---------------------------------------------------------------------
-- อ่าน
-- ---------------------------------------------------------------------
create or replace function p48_stats() returns jsonb
language plpgsql stable as $$
declare v_a p48_runs%rowtype; v_b p48_runs%rowtype; v_matched integer := 0; v_card jsonb;
begin
  select * into v_a from p48_runs where id = p48_live('parcel');
  select * into v_b from p48_runs where id = p48_live('product');

  if v_a.id is not null and v_b.id is not null then
    select count(*) into v_matched
      from p48_parcels p join p48_products q on q.run_id = v_b.id and q.tracking = p.tracking
     where p.run_id = v_a.id;
  end if;

  v_card := jsonb_build_object(
    'matched', v_matched,
    'can_undo_parcel',  (select count(*) > 1 from p48_runs where kind = 'parcel'  and done),
    'can_undo_product', (select count(*) > 1 from p48_runs where kind = 'product' and done));

  if v_a.id is not null then
    v_card := v_card || jsonb_build_object('parcel', jsonb_build_object(
      'id', v_a.id, 'at', v_a.uploaded_at, 'file', v_a.file_name,
      'rows', v_a.row_count, 'file_rows', v_a.file_rows,
      'by', coalesce(v_a.by_name, ''), 'code', coalesce(v_a.by_code, '')));
  end if;
  if v_b.id is not null then
    v_card := v_card || jsonb_build_object('product', jsonb_build_object(
      'id', v_b.id, 'at', v_b.uploaded_at, 'file', v_b.file_name,
      'rows', v_b.row_count, 'file_rows', v_b.file_rows,
      'by', coalesce(v_b.by_name, ''), 'code', coalesce(v_b.by_code, '')));
  end if;

  return v_card;
end $$;


create or replace function p48_facets() returns jsonb
language plpgsql stable as $$
declare v_run bigint;
begin
  v_run := p48_live('parcel');
  if v_run is null then
    return jsonb_build_object('dest','[]'::jsonb,'action','[]'::jsonb,'prov','[]'::jsonb,'cust','[]'::jsonb);
  end if;

  return jsonb_build_object(
    'dest',   (select coalesce(jsonb_agg(jsonb_build_object('v',v,'n',n) order by n desc),'[]'::jsonb)
                 from (select dest_branch v, count(*) n from p48_parcels
                        where run_id = v_run and dest_branch is not null
                        group by 1 order by 2 desc limit 400) z),
    'action', (select coalesce(jsonb_agg(jsonb_build_object('v',v,'n',n) order by n desc),'[]'::jsonb)
                 from (select last_action v, count(*) n from p48_parcels
                        where run_id = v_run and last_action is not null
                        group by 1 order by 2 desc limit 100) z),
    'prov',   (select coalesce(jsonb_agg(jsonb_build_object('v',v,'n',n) order by n desc),'[]'::jsonb)
                 from (select province v, count(*) n from p48_parcels
                        where run_id = v_run and province is not null
                        group by 1 order by 2 desc limit 200) z),
    'cust',   (select coalesce(jsonb_agg(jsonb_build_object('v',v,'n',n) order by n desc),'[]'::jsonb)
                 from (select cust_type v, count(*) n from p48_parcels
                        where run_id = v_run and cust_type is not null
                        group by 1 order by 2 desc limit 50) z));
end $$;


create or replace function p48_search(p jsonb) returns jsonb
language plpgsql stable as $$
declare
  v_run bigint; v_prod bigint;
  v_q    text    := nullif(btrim(coalesce(p->>'q','')), '');
  v_cust text    := nullif(p->>'cust','');
  v_dest text    := nullif(p->>'dest','');
  v_act  text    := nullif(p->>'action','');
  v_prov text    := nullif(p->>'prov','');
  v_sla  text    := nullif(p->>'sla','');
  v_bag  boolean := coalesce((p->>'bag')::boolean, false);
  v_nop  boolean := coalesce((p->>'nop')::boolean, false);
  v_cn   boolean := coalesce((p->>'cn')::boolean, false);
  v_lim  integer := least(greatest(coalesce((p->>'limit')::integer, 300), 1), 1000);
  v_off  integer := greatest(coalesce((p->>'offset')::integer, 0), 0);
  v_total integer; v_rows jsonb;
begin
  v_run  := p48_live('parcel');
  v_prod := p48_live('product');
  if v_run is null then
    return jsonb_build_object('total', 0, 'rows', '[]'::jsonb, 'all', 0);
  end if;

  if v_q is not null then
    v_q := replace(replace(v_q, '%', '\%'), '_', '\_');
  end if;

  with base as (
    select p1.tracking, q.detail, p1.cust_type, p1.dest_branch, p1.weight,
           p1.picked_at, p1.last_action, p1.bag_no,
           s.days as sla_days,
           case when p1.picked_at is null or s.days is null then null
                else ((p1.picked_at at time zone 'Asia/Bangkok')::date + s.days)
                     - (now() at time zone 'Asia/Bangkok')::date end as sla_left
      from p48_parcels p1
      left join p48_products q
        on v_prod is not null and q.run_id = v_prod and q.tracking = p1.tracking
      left join p48_sla s on s.cust_type = p1.cust_type and s.is_active
     where p1.run_id = v_run
       and (v_cust is null or p1.cust_type   = v_cust)
       and (v_dest is null or p1.dest_branch = v_dest)
       and (v_act  is null or p1.last_action = v_act)
       and (v_prov is null or p1.province    = v_prov)
       and (not v_bag or (p1.bag_no is not null and p1.bag_no not in ('--','-')))
       and (not v_nop or q.detail is null)
       and (not v_cn  or q.detail ~ '[一-鿿]')
       and (v_q is null
            or p1.tracking ilike '%' || v_q || '%'
            or p1.bag_no   ilike '%' || v_q || '%'
            or q.detail    ilike '%' || v_q || '%')
  ),
  hit as (
    select * from base
     where v_sla is null
        or (v_sla = 'over'  and sla_left < 0)
        or (v_sla = 'today' and sla_left = 0)
        or (v_sla = 'none'  and sla_left is null)
        or (v_sla ~ '^[0-9]+$' and sla_left is not null and sla_left <= v_sla::int)
  )
  select (select count(*) from hit),
         (select coalesce(jsonb_agg(to_jsonb(z) order by z.sla_left asc nulls last, z.tracking),'[]'::jsonb)
            from (select * from hit order by sla_left asc nulls last, tracking
                   limit v_lim offset v_off) z)
    into v_total, v_rows;

  return jsonb_build_object('total', v_total,
    'all', (select row_count from p48_runs where id = v_run), 'rows', v_rows);
end $$;


create or replace function p48_one(p_tracking text) returns jsonb
language plpgsql stable as $$
declare v_run bigint; v_prod bigint; v_out jsonb;
begin
  v_run  := p48_live('parcel');
  v_prod := p48_live('product');
  if v_run is null then return null; end if;

  select to_jsonb(p1) - 'run_id'
         || jsonb_build_object(
              'detail', q.detail,
              'sla_days', s.days,
              'sla_due', case when p1.picked_at is null or s.days is null then null
                              else ((p1.picked_at at time zone 'Asia/Bangkok')::date + s.days) end,
              'sla_left', case when p1.picked_at is null or s.days is null then null
                               else ((p1.picked_at at time zone 'Asia/Bangkok')::date + s.days)
                                    - (now() at time zone 'Asia/Bangkok')::date end)
    into v_out
    from p48_parcels p1
    left join p48_products q on v_prod is not null and q.run_id = v_prod and q.tracking = p1.tracking
    left join p48_sla s on s.cust_type = p1.cust_type and s.is_active
   where p1.run_id = v_run and p1.tracking = p_tracking;

  return v_out;
end $$;


create or replace function p48_run_list()
returns table (id bigint, kind text, uploaded_at timestamptz, file_name text,
               row_count integer, file_rows integer, done boolean, by_name text)
language sql stable as $$
  select r.id, r.kind, r.uploaded_at, r.file_name, r.row_count, r.file_rows, r.done,
         coalesce(r.by_name, '')
    from p48_runs r order by r.id desc;
$$;


create or replace function p48_sla_list()
returns table (cust_type text, days integer, sort_no integer, is_active boolean,
               updated_at timestamptz, by_name text, used bigint)
language sql stable as $$
  select s.cust_type, s.days, s.sort_no, s.is_active, s.updated_at,
         coalesce(s.by_name, ''),
         (select count(*) from p48_parcels p
           where p.run_id = p48_live('parcel') and p.cust_type = s.cust_type)
    from p48_sla s order by s.sort_no, s.cust_type;
$$;


create or replace function p48_sla_set(p_type text, p_days integer, p_uid uuid, p_name text)
returns jsonb language plpgsql as $$
declare v_t text := btrim(coalesce(p_type, ''));
begin
  if v_t = '' then raise exception 'ต้องใส่ชื่อประเภทลูกค้า'; end if;
  if p_days is null or p_days < 0 or p_days > 365 then
    raise exception 'จำนวนวันต้องอยู่ระหว่าง 0 ถึง 365';
  end if;

  insert into p48_sla (cust_type, days, updated_by, by_name, updated_at)
  values (left(v_t, 60), p_days, p_uid, p_name, now())
  on conflict (cust_type) do update
    set days = excluded.days, updated_by = excluded.updated_by,
        by_name = excluded.by_name, updated_at = excluded.updated_at, is_active = true;

  return jsonb_build_object('ok', true);
end $$;


create or replace function p48_sla_delete(p_type text) returns jsonb
language plpgsql as $$
begin
  delete from p48_sla where cust_type = p_type;
  return jsonb_build_object('ok', true);
end $$;


-- =====================================================================
-- ตรวจผล
-- =====================================================================
select
  (select count(*) from pg_tables where tablename like 'p48%')  as ตาราง,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'p48%')       as ฟังก์ชัน,
  (select count(*) from pg_indexes where indexname like '%trgm%') as ดัชนีค้นหา,
  (select count(*) from p48_runs)                               as รอบ,
  (select count(*) from p48_parcels)                            as แถวรายละเอียด,
  (select count(*) from p48_products)                           as แถวสินค้า;
