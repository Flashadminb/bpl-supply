-- =====================================================================
-- BPL SUPPLY — บาร์โค้ด BY หนึ่งใบ ตัดสต็อกได้หลายรายการ
-- รันต่อจาก 041 · ปลอดภัยที่จะรันซ้ำ
--
-- ของเดิมผูกได้วัสดุเดียวต่อหนึ่งบาร์โค้ด (by_barcodes.item_id + qty)
-- แต่หน้างานจริงบาร์โค้ดใบเดียวมีของหลายอย่าง คนจัดการจึงตัดได้แค่อย่างเดียว
-- ที่เหลือต้องไปตัดมือที่หน้าสต็อก ซึ่งไม่มีร่องรอยว่าตัดเพราะใบไหน
--
-- เพิ่มตารางบรรทัดแยก หนึ่งใบมีได้หลายบรรทัด
-- คอลัมน์ item_id/qty เดิมยังอยู่และยังถูกเติมด้วยบรรทัดแรกเสมอ
-- ของเก่าที่อ่านสองคอลัมน์นั้นอยู่จึงไม่พัง
-- =====================================================================

create table if not exists by_barcode_lines (
  id         bigserial primary key,
  by_id      uuid    not null references by_barcodes(id) on delete cascade,
  item_id    bigint  not null references items(id),
  qty        integer not null check (qty > 0),
  created_at timestamptz not null default now(),
  -- วัสดุเดิมซ้ำในใบเดียวไม่ได้ ให้รวมจำนวนเป็นบรรทัดเดียว
  unique (by_id, item_id)
);

create index if not exists by_lines_by_idx on by_barcode_lines (by_id);

-- ย้ายของเดิมเข้าตารางใหม่ จะได้ไม่มีใบไหนตกหล่น
insert into by_barcode_lines (by_id, item_id, qty)
select b.id, b.item_id, b.qty
  from by_barcodes b
 where b.item_id is not null and coalesce(b.qty, 0) > 0
on conflict (by_id, item_id) do nothing;

alter table by_barcode_lines enable row level security;

drop policy if exists read_by_lines on by_barcode_lines;
create policy read_by_lines on by_barcode_lines for select to authenticated using (
  my_role() in ('supervisor', 'admin')
  or exists (select 1 from by_barcodes b where b.id = by_id and b.user_id = auth.uid())
);

drop policy if exists write_by_lines on by_barcode_lines;
create policy write_by_lines on by_barcode_lines for all to authenticated
  using (my_role() in ('supervisor', 'admin'))
  with check (my_role() in ('supervisor', 'admin'));


-- ---------------------------------------------------------------------
-- RPC: ปิดงานบาร์โค้ด พร้อมตัดสต็อกหลายรายการในทีเดียว
--
-- ตัดสต็อกเฉพาะตอนที่ "เพิ่งเปลี่ยน" เป็น done เท่านั้น
-- กดซ้ำบนใบที่ done อยู่แล้วจะไม่ตัดซ้ำ แต่ยังแก้รายการได้
-- ---------------------------------------------------------------------
create or replace function set_by_status_lines(
  p_id        uuid,
  p_status    by_status,
  p_note      text    default null,
  p_lines     jsonb   default '[]'::jsonb,
  p_cut_stock boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_was    by_status;
  v_first  bigint := null;
  v_fqty   integer := null;
  v_cut    int := 0;
  r        jsonb;
  v_item   bigint;
  v_qty    integer;
begin
  if my_role() not in ('supervisor', 'admin') then
    raise exception 'ไม่มีสิทธิ์จัดการรายการบาร์โค้ด BY';
  end if;

  select status into v_was from by_barcodes where id = p_id;
  if v_was is null then
    raise exception 'ไม่พบรายการนี้';
  end if;

  -- เขียนบรรทัดใหม่ทับของเดิมทั้งชุด แก้ทีหลังได้โดยไม่ต้องไล่ลบเอง
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 0 then
    delete from by_barcode_lines where by_id = p_id;

    for r in select * from jsonb_array_elements(p_lines) loop
      v_item := (r->>'item_id')::bigint;
      v_qty  := (r->>'qty')::integer;

      if v_item is null or coalesce(v_qty, 0) <= 0 then
        raise exception 'บรรทัดรายการไม่ครบ ต้องมีทั้งวัสดุและจำนวนที่มากกว่า 0';
      end if;
      if not exists (select 1 from items where id = v_item) then
        raise exception 'ไม่พบวัสดุรหัส %', v_item;
      end if;

      insert into by_barcode_lines (by_id, item_id, qty)
      values (p_id, v_item, v_qty)
      on conflict (by_id, item_id) do update set qty = by_barcode_lines.qty + excluded.qty;

      if v_first is null then
        v_first := v_item;
        v_fqty  := v_qty;
      end if;
    end loop;
  end if;

  update by_barcodes
     set status       = p_status,
         item_id      = coalesce(v_first, item_id),
         qty          = coalesce(v_fqty, qty),
         handled_by   = case when p_status = 'pending' then null else auth.uid() end,
         handled_at   = case when p_status = 'pending' then null else now() end,
         handled_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id;

  -- ตัดสต็อกทีละบรรทัด · adjust_stock ล็อกแถววัสดุให้อยู่แล้ว
  if p_cut_stock and p_status = 'done' and v_was <> 'done' then
    for v_item, v_qty in
      select l.item_id, l.qty from by_barcode_lines l where l.by_id = p_id
    loop
      perform adjust_stock(v_item, -v_qty, 'บาร์โค้ด BY');
      v_cut := v_cut + 1;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'cut_lines', v_cut);
end $$;

grant execute on function set_by_status_lines(uuid, by_status, text, jsonb, boolean) to authenticated;


-- ---------------------------------------------------------------------
-- by_feed — พ่วงบรรทัดรายการมาให้ครบ หน้าเว็บจะได้ไม่ต้องยิงถามทีละใบ
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
  b.item_id,
  i.name                                 as item_name,
  i.sku                                  as item_sku,
  i.unit                                 as item_unit,
  b.qty,
  coalesce((
    select jsonb_agg(jsonb_build_object(
             'item_id', l.item_id,
             'qty',     l.qty,
             'name',    li.name,
             'sku',     li.sku,
             'unit',    li.unit
           ) order by li.name)
    from by_barcode_lines l
    join items li on li.id = l.item_id
    where l.by_id = b.id
  ), '[]'::jsonb)                        as lines,
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
-- สถิติรายเดือน — นับจากบรรทัด ไม่ใช่จากคอลัมน์เดียวในหัวใบ
--
-- ของเดิมนับได้แค่วัสดุตัวแรก ใบที่มีหลายรายการจะหายไปจากรายงานทั้งหมด
-- ---------------------------------------------------------------------
drop view if exists by_stats_monthly;
create view by_stats_monthly
with (security_invoker = true) as
select
  to_char((b.created_at at time zone 'Asia/Bangkok'), 'YYYY-MM')  as ym,
  b.dept_code,
  b.reason,
  l.item_id,
  i.name                                                          as item_name,
  count(distinct b.id)::int                                       as total,
  count(distinct b.id) filter (where b.status = 'pending')::int    as pending,
  count(distinct b.id) filter (where b.status = 'done')::int       as done,
  count(distinct b.id) filter (where b.status = 'rejected')::int   as rejected,
  coalesce(sum(l.qty) filter (where b.status = 'done'), 0)::int    as qty_done
from by_barcodes b
left join by_barcode_lines l on l.by_id = b.id
left join items i           on i.id = l.item_id
group by 1, 2, 3, 4, 5;

grant select on by_stats_monthly to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select 'ตารางบรรทัดรายการ'  as สิ่งที่ตรวจ, count(*)::text as ผล
  from information_schema.tables where table_name = 'by_barcode_lines'
union all select 'ฟังก์ชันตัดหลายรายการ', count(*)::text
  from pg_proc where proname = 'set_by_status_lines'
union all select 'บรรทัดที่ย้ายมาจากของเดิม', count(*)::text from by_barcode_lines
union all select 'บาร์โค้ด BY ทั้งหมด', count(*)::text from by_barcodes;
