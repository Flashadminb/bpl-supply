-- ---------------------------------------------------------------------
-- 170 · หน้าจับคู่ · เลิกนับชั่วโมงที่ค้าง เปลี่ยนเป็น SLA คิดเป็นวัน
--
-- ของเดิมโชว์ว่าค้างมากี่ชั่วโมงนับจากเวลาเข้ารับสินค้า ซึ่งตอบได้แค่ว่า
-- "ของชิ้นนี้อยู่ในระบบมานานแค่ไหน" ไม่ได้ตอบว่า "ช้าหรือยัง"
-- เพราะลูกค้าแต่ละเจ้าให้เวลาส่งไม่เท่ากัน
--
-- ─────────────────────────────────────────────────────────────────
-- สูตร
--
--   ครบกำหนด = วันที่เข้ารับสินค้า + SLA ของลูกค้าเจ้านั้น
--   เหลือ     = ครบกำหนด − วันนี้
--
--   บวก = ยังมีเวลาอีกกี่วัน · ศูนย์ = ครบกำหนดวันนี้ · ลบ = เลยมาแล้วกี่วัน
--
-- นับเป็นวันตามปฏิทินไทย ไม่ได้นับเป็นช่วง 24 ชั่วโมง
-- ของที่เข้ารับตอนห้าทุ่มกับตีหนึ่งคืนเดียวกัน ถ้านับ 24 ชั่วโมงจะครบกำหนด
-- คนละวันทั้งที่คนมองว่าเป็นของล็อตเดียวกัน · และเส้นตายที่ขยับทุกชั่วโมง
-- คือเส้นตายที่เอาไปวางแผนงานกะไม่ได้
-- ─────────────────────────────────────────────────────────────────
--
-- ของที่ประเภทลูกค้ายังไม่ได้ตั้ง SLA จะได้ค่าว่าง ไม่ใช่ศูนย์
-- ว่างแปลว่ายังไม่รู้ · ศูนย์แปลว่าครบกำหนดวันนี้ คนละเรื่องกันคนละโลก
-- และของกลุ่มนั้นจะไม่ถูกนับเข้าตัวกรอง SLA ใด ๆ เพราะยังตัดสินไม่ได้
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- ① ตาราง SLA ต่อประเภทลูกค้า · เจ้าของระบบแก้เพิ่มลบเองได้
-- ---------------------------------------------------------------------
create table if not exists p48_sla (
  cust_type  text primary key,
  days       integer not null check (days between 0 and 365),
  sort_no    integer not null default 0,
  is_active  boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles (id)
);

comment on table p48_sla is
  'SLA เป็นวันต่อประเภทลูกค้า · ใช้คิดว่าพัสดุเหลือเวลาอีกกี่วันบนหน้าจับคู่';

alter table p48_sla enable row level security;

drop policy if exists own_p48_sla on p48_sla;
create policy own_p48_sla on p48_sla for all to authenticated
  using (my_can_outbox()) with check (my_can_outbox());

/*
  ตั้งค่าเริ่มต้นจากประเภทลูกค้าที่มีอยู่จริงในข้อมูล ไม่ได้พิมพ์รายชื่อเดาเอง
  ใส่ 3 วันไปก่อนทุกเจ้า ซึ่งเป็นตัวเลขที่ตั้งไว้ให้แก้ ไม่ใช่ตัวเลขที่ถูกต้อง
  เจ้าของระบบต้องเข้าไปตั้งของจริงเอง · หน้าจอจะเขียนบอกไว้ด้วย
*/
insert into p48_sla (cust_type, days, sort_no)
select cust_type, 3, row_number() over (order by count(*) desc)
  from p48_parcels
 where cust_type is not null
 group by cust_type
on conflict (cust_type) do nothing;


-- ---------------------------------------------------------------------
-- ② อ่านและแก้รายการ SLA
--
-- อ่านได้ทุกคนที่ล็อกอิน เพราะหน้าจับคู่ต้องใช้ตัวเลขนี้มาคิดและมาโชว์
-- แก้ได้เฉพาะผู้ดูแลระบบ · เกณฑ์ที่ใครก็แก้ได้ คือเกณฑ์ที่พอใครสอบตกก็แก้เกณฑ์
-- กติกาเดียวกับ wait_truck_kpi ของกระดานรถรอลงงาน
-- ---------------------------------------------------------------------
create or replace function p48_sla_list()
returns table (cust_type text, days integer, sort_no integer, is_active boolean,
               updated_at timestamptz, by_name text, used bigint)
language sql stable security definer set search_path = public as $$
  select s.cust_type, s.days, s.sort_no, s.is_active, s.updated_at,
         coalesce(i.full_name, ''),
         (select count(*) from p48_parcels p
           where p.run_id = p48_live('parcel') and p.cust_type = s.cust_type)
    from p48_sla s
    left join profiles i on i.id = s.updated_by
   where auth.uid() is not null
   order by s.sort_no, s.cust_type;
$$;

grant execute on function p48_sla_list() to authenticated;


create or replace function p48_sla_set(p_type text, p_days integer)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_t text := btrim(coalesce(p_type, ''));
begin
  if not my_can_outbox() then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ตั้ง SLA ได้';
  end if;
  if v_t = '' then
    raise exception 'ต้องใส่ชื่อประเภทลูกค้า';
  end if;
  if p_days is null or p_days < 0 or p_days > 365 then
    raise exception 'จำนวนวันต้องอยู่ระหว่าง 0 ถึง 365';
  end if;

  insert into p48_sla (cust_type, days, updated_by, updated_at)
  values (left(v_t, 60), p_days, auth.uid(), now())
  on conflict (cust_type) do update
    set days = excluded.days, updated_by = excluded.updated_by,
        updated_at = excluded.updated_at, is_active = true;

  return jsonb_build_object('ok', true);
end $$;

grant execute on function p48_sla_set(text, integer) to authenticated;


/**
 * ลบประเภทลูกค้าออกจากตาราง SLA
 *
 * ลบได้แม้ยังมีพัสดุของเจ้านั้นอยู่ · ผลคือพัสดุกลุ่มนั้นกลับไปเป็น "ยังไม่รู้"
 * ซึ่งเห็นชัดบนจอว่าเป็นขีดกลาง ไม่ได้หายไปไหนและไม่ได้ถูกนับว่าทันเวลา
 * จึงไม่ต้องกันเหมือนตอนลบชื่อซัพที่ลบแล้วประวัติเก่าจะอ่านไม่ออก
 */
create or replace function p48_sla_delete(p_type text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not my_can_outbox() then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ลบ SLA ได้';
  end if;
  delete from p48_sla where cust_type = p_type;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function p48_sla_delete(text) to authenticated;


-- ---------------------------------------------------------------------
-- ③ ค้นหา · เปลี่ยนตัวกรองชั่วโมงเป็นตัวกรอง SLA
--
-- เขียนทับทั้งตัวเพราะเปลี่ยนทั้งช่องที่คืนกลับไปและเงื่อนไขการกรอง
-- ของเดิมยกมาครบ ที่หายไปคือตัวกรอง age ซึ่งถูกแทนด้วย sla
--
-- ต่อตาราง SLA ด้วย left join ครั้งเดียว ไม่ได้เรียกฟังก์ชันคิดทีละแถว
-- ตาราง SLA มีห้าแถว การต่อแบบนี้แทบไม่มีราคา ส่วนการเรียกฟังก์ชัน
-- ห้าหมื่นครั้งต่อหนึ่งการค้นหามีราคาจริง
--
-- เรียงจากด่วนสุดขึ้นก่อน คือเหลือน้อยสุดอยู่บน · ของที่ยังไม่รู้ SLA ไปอยู่ท้าย
-- ---------------------------------------------------------------------
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
  v_sla   text    := nullif(p->>'sla', '');
  v_bag   boolean := coalesce((p->>'bag')::boolean, false);
  v_nop   boolean := coalesce((p->>'nop')::boolean, false);
  v_cn    boolean := coalesce((p->>'cn')::boolean, false);
  v_lim   integer := least(greatest(coalesce((p->>'limit')::integer, 300), 1), 1000);
  v_off   integer := greatest(coalesce((p->>'offset')::integer, 0), 0);
  v_total integer;
  v_rows  jsonb;
begin
  if auth.uid() is null then
    raise exception 'บัญชีนี้ดูหน้านี้ไม่ได้';
  end if;

  v_run  := p48_live('parcel');
  v_prod := p48_live('product');
  if v_run is null then
    return jsonb_build_object('total', 0, 'rows', '[]'::jsonb, 'all', 0);
  end if;

  if v_q is not null then
    v_q := replace(replace(v_q, '%', '\%'), '_', '\_');
  end if;

  with base as (
    select p1.tracking,
           q.detail,
           p1.cust_type,
           p1.dest_branch,
           p1.weight,
           p1.picked_at,
           p1.last_action,
           p1.bag_no,
           s.days as sla_days,
           case
             when p1.picked_at is null or s.days is null then null
             else ((p1.picked_at at time zone 'Asia/Bangkok')::date + s.days)
                  - (now() at time zone 'Asia/Bangkok')::date
           end as sla_left
      from p48_parcels p1
      left join p48_products q
        on v_prod is not null and q.run_id = v_prod and q.tracking = p1.tracking
      left join p48_sla s
        on s.cust_type = p1.cust_type and s.is_active
     where p1.run_id = v_run
       and (v_cust is null or p1.cust_type   = v_cust)
       and (v_dest is null or p1.dest_branch = v_dest)
       and (v_act  is null or p1.last_action = v_act)
       and (v_prov is null or p1.province    = v_prov)
       and (not v_bag      or (p1.bag_no is not null and p1.bag_no not in ('--', '-')))
       and (not v_nop      or q.detail is null)
       and (not v_cn       or q.detail ~ '[一-鿿]')
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
         (select coalesce(jsonb_agg(to_jsonb(z) order by z.sla_left asc nulls last, z.tracking), '[]'::jsonb)
            from (select * from hit order by sla_left asc nulls last, tracking
                   limit v_lim offset v_off) z)
    into v_total, v_rows;

  return jsonb_build_object(
    'total', v_total,
    'all',   (select row_count from p48_runs where id = v_run),
    'rows',  v_rows
  );
end $$;

grant execute on function p48_search(jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- ④ รายตัว · ต้องตอบ SLA ด้วย จะได้ไม่ต้องคิดซ้ำคนละที่กับตาราง
--
-- คิดที่ฐานข้อมูลที่เดียวทั้งตารางและแผงขวา · ถ้าให้หน้าจอคิดเอง
-- วันหนึ่งสองที่จะไม่ตรงกัน แล้วไม่มีใครรู้ว่าอันไหนถูก
-- ---------------------------------------------------------------------
create or replace function p48_one(p_tracking text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_run  bigint;
  v_prod bigint;
  v_out  jsonb;
begin
  if auth.uid() is null then
    raise exception 'บัญชีนี้ดูหน้านี้ไม่ได้';
  end if;

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

grant execute on function p48_one(text) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล · ดูของจริงเลยว่าคิดออกมาได้เท่าไหร่
-- ---------------------------------------------------------------------
select s.cust_type as ประเภทลูกค้า,
       s.days      as slaวัน,
       count(p.*)  as พัสดุ,
       count(*) filter (where ((p.picked_at at time zone 'Asia/Bangkok')::date + s.days)
                            - (now() at time zone 'Asia/Bangkok')::date < 0)  as เลยกำหนด,
       count(*) filter (where ((p.picked_at at time zone 'Asia/Bangkok')::date + s.days)
                            - (now() at time zone 'Asia/Bangkok')::date = 0)  as ครบวันนี้
  from p48_sla s
  left join p48_parcels p on p.cust_type = s.cust_type and p.run_id = p48_live('parcel')
 group by s.cust_type, s.days, s.sort_no
 order by s.sort_no;
