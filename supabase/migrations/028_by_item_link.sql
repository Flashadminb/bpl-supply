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
