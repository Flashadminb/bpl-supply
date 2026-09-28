-- =====================================================================
-- BPL SUPPLY — ชุดเบิก-คืน หนึ่งบรรทัดเห็นครบทั้งวงจร
-- รันต่อจาก 043 · ปลอดภัยที่จะรันซ้ำ
--
-- ปัญหาของเดิม: หน้าหลักฐานเรียงตาม "เหตุการณ์"
-- ใบเบิกอยู่แถวหนึ่ง การคืนอยู่อีกแถวหนึ่ง คนละที่กัน
-- จะรู้ว่าของกลับมาครบไหมต้องนั่งจับคู่เอง ยิ่งคืนทีละนิดยิ่งไล่ไม่ไหว
--
-- วิวนี้เรียงตาม "บรรทัดที่เบิก" แทน หนึ่งแถวคือหนึ่งรายการที่เบิกออกไป
-- แล้วพ่วงการคืนทุกครั้งของบรรทัดนั้นมาไว้ในแถวเดียวกัน พร้อมรูปของแต่ละครั้ง
-- คืน 2 วันนี้ อีก 3 พรุ่งนี้ ก็ยังเป็นแถวเดิม ยอดสะสมเดินขึ้นจนครบ
--
-- return_state บอกสถานะในคำเดียว
--   consumed = ของใช้แล้วหมดไป ไม่ต้องคืน (ห้ามขึ้นว่าค้าง ไม่งั้นทั้งหน้าจะเป็นสีแดงถาวร)
--   none     = ยังไม่ได้คืนสักชิ้น
--   partial  = คืนมาบางส่วน ยังค้างอยู่
--   full     = ครบแล้ว
-- =====================================================================

drop view if exists borrow_sets;
create view borrow_sets
with (security_invoker = true) as
select
  ri.id                                   as line_id,
  r.id                                    as requisition_id,
  r.ref_no,
  r.created_at                            as taken_at,
  r.hub_code,
  r.requester_id,
  p.full_name                             as who,
  p.employee_code,
  p.dept_code,
  p.sub_dept,
  p.shift_start,
  p.shift_end,
  i.id                                    as item_id,
  i.sku,
  i.name                                  as item_name,
  i.unit,
  i.is_returnable,
  coalesce(ri.qty_approved, 0)            as qty_taken,
  coalesce(rt.qty_returned, 0)::int       as qty_returned,
  greatest(coalesce(ri.qty_approved, 0) - coalesce(rt.qty_returned, 0), 0)::int as qty_open,
  case
    when not i.is_returnable                                        then 'consumed'
    when coalesce(rt.qty_returned, 0) = 0                           then 'none'
    when coalesce(rt.qty_returned, 0) >= coalesce(ri.qty_approved, 0) then 'full'
    else 'partial'
  end                                     as return_state,

  -- รูปตอนเบิก · ใบหลักมาก่อนเสมอ แล้วค่อยใบที่เหลือ
  coalesce((
    select array_agg(f order by ord)
    from (
      select r.evidence_file_id as f, 0 as ord where r.evidence_file_id is not null
      union all
      select ph.file_id, ph.sort_no + 1
      from requisition_photos ph
      where ph.requisition_id = r.id and ph.file_id <> coalesce(r.evidence_file_id, '')
    ) q
  ), '{}')                                as out_file_ids,

  -- การคืนทุกครั้งของบรรทัดนี้ เรียงตามเวลา พร้อมรูปของครั้งนั้น ๆ
  coalesce((
    select jsonb_agg(jsonb_build_object(
             'id',          rr.id,
             'qty',         rr.qty,
             'condition',   rr.condition,
             'at',          rr.created_at,
             'by',          bp.full_name,
             'file_ids',    coalesce((
                              select array_agg(rp.file_id order by rp.sort_no)
                              from return_photos rp where rp.return_id = rr.id
                            ), case when rr.evidence_file_id is not null
                                    then array[rr.evidence_file_id] else '{}' end)
           ) order by rr.created_at)
    from returns rr
    left join profiles bp on bp.id = rr.returned_by
    where rr.requisition_item_id = ri.id
  ), '[]'::jsonb)                         as returns

from requisition_items ri
join requisitions r on r.id = ri.requisition_id
join items i        on i.id = ri.item_id
join profiles p     on p.id = r.requester_id
left join lateral (
  select sum(qty)::int as qty_returned from returns where requisition_item_id = ri.id
) rt on true
where ri.status = 'approved';

grant select on borrow_sets to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select 'บรรทัดเบิกทั้งหมด' as สิ่งที่ตรวจ, count(*)::text as ผล from borrow_sets
union all select 'ของยืม-คืนที่ยังไม่ครบ', count(*)::text
  from borrow_sets where return_state in ('none', 'partial')
union all select 'คืนครบแล้ว', count(*)::text from borrow_sets where return_state = 'full';
