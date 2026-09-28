-- =====================================================================
-- BPL SUPPLY — การ์ดชุดเบิก-คืน หนึ่งใบเบิกคือหนึ่งการ์ด
-- รันต่อจาก 044 · ปลอดภัยที่จะรันซ้ำ
--
-- 044 แยกเป็นรายบรรทัด ซึ่งซอยย่อยเกินไป
-- คนเดียวกดเบิกทีเดียวได้ 3 เครื่อง ต้องเป็นการ์ดเดียว ไม่ใช่ 3 แถว
-- วิวนี้จึงจับกลุ่มที่ "ใบเบิก" แทน แล้วยัดรายการกับการคืนเข้าไปเป็น JSON
--
-- ⚠️ ไม่แตะการส่งออก Google Sheet
-- ตัวส่งออกอ่าน asset_txn_items / requisitions โดยตรง ไม่ได้ผ่านวิวนี้
-- รูปแบบคอลัมน์ในชีตจึงเหมือนเดิมทุกประการ
--
-- รวมสองฝั่งไว้ในวิวเดียว (kind = supply / asset) เพราะหน้าจอวาดการ์ดแบบเดียวกัน
-- ถ้าแยกสองวิวจะต้องเขียนโค้ดวาดสองชุดแล้วมันจะเพี้ยนจากกันภายหลัง
-- =====================================================================

drop view if exists return_cards;
create view return_cards
with (security_invoker = true) as

-- ── ฝั่งวัสดุสิ้นเปลือง · การ์ด = ใบเบิกหนึ่งใบ ───────────────────────
select
  'supply'::text                          as kind,
  r.id::text                              as card_id,
  r.ref_no,
  r.created_at                            as taken_at,
  r.requester_id                          as user_id,
  p.full_name                             as who,
  p.employee_code,
  p.dept_code,
  p.sub_dept,
  p.shift_start,
  p.shift_end,

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

  -- รายการในใบ
  coalesce((
    select jsonb_agg(jsonb_build_object(
             'label',    i.name,
             'sub',      i.sku,
             'unit',     i.unit,
             'need',     case when i.is_returnable then coalesce(ri.qty_approved, 0) else 0 end,
             'taken',    coalesce(ri.qty_approved, 0),
             'returned', coalesce(rs.n, 0),
             'state',    case
                           when not i.is_returnable                     then 'consumed'
                           when coalesce(rs.n, 0) = 0                   then 'open'
                           when coalesce(rs.n, 0) >= coalesce(ri.qty_approved, 0) then 'returned'
                           else 'partial'
                         end,
             'note',     null
           ) order by i.name)
    from requisition_items ri
    join items i on i.id = ri.item_id
    left join lateral (
      select sum(qty)::int as n from returns where requisition_item_id = ri.id
    ) rs on true
    where ri.requisition_id = r.id and ri.status = 'approved'
  ), '[]'::jsonb)                         as items,

  -- การคืนแต่ละครั้ง · รวมบรรทัดที่คืนพร้อมกันเป็นครั้งเดียว
  -- จับกลุ่มด้วยเวลาที่ตรงกันเป๊ะ + คนคืนคนเดียวกัน
  -- ของที่คืนผ่าน create_return_many จะมีเวลาเดียวกันทั้งชุดเพราะอยู่ใน transaction เดียว
  coalesce((
    select jsonb_agg(ev order by (ev->>'at'))
    from (
      select jsonb_build_object(
               'at',       rr.created_at,
               'by',       max(bp.full_name),
               'detail',   string_agg(i2.name || ' ' || rr.qty || ' ' || i2.unit, ' · '
                             order by i2.name),
               'cond',     max(rr.condition::text),
               'file_ids', coalesce(max(ph.ids), '{}')
             ) as ev
      from returns rr
      join requisition_items ri2 on ri2.id = rr.requisition_item_id
      join items i2              on i2.id = ri2.item_id
      left join profiles bp      on bp.id = rr.returned_by
      left join lateral (
        select array_agg(rp.file_id order by rp.sort_no) as ids
        from return_photos rp where rp.return_id = rr.id
      ) ph on true
      where ri2.requisition_id = r.id
      group by rr.created_at, rr.returned_by, rr.qty
    ) g
  ), '[]'::jsonb)                         as events

from requisitions r
join profiles p on p.id = r.requester_id

union all

-- ── ฝั่งอุปกรณ์ Asset · การ์ด = ใบเบิกหนึ่งใบ ─────────────────────────
select
  'asset'::text,
  t.id::text,
  t.ref_no,
  t.created_at,
  t.user_id,
  p.full_name,
  p.employee_code,
  t.dept_code,
  p.sub_dept,
  t.shift_start,
  t.shift_end,

  coalesce((
    select array_agg(ph.file_id order by ph.seq)
    from asset_txn_photos ph where ph.txn_id = t.id
  ), '{}'),

  -- เครื่องในใบ · สถานะแยกว่าคืนแล้ว โดนโอน หรือยังค้าง
  coalesce((
    select jsonb_agg(jsonb_build_object(
             'label',    ai.asset_code,
             'sub',      ty.name,
             'unit',     'เครื่อง',
             'need',     case when coalesce(back.is_transfer, false) then 0 else 1 end,
             'taken',    1,
             'returned', case when back.id is not null and not coalesce(back.is_transfer, false)
                              then 1 else 0 end,
             'state',    case
                           when back.id is null                          then 'open'
                           when coalesce(back.is_transfer, false)        then 'transferred'
                           when coalesce(back.is_forced, false)          then 'forced'
                           else 'returned'
                         end,
             'note',     case
                           when coalesce(back.is_transfer, false) then back.note
                           when coalesce(back.is_forced, false)   then back.note
                           else null
                         end
           ) order by ai.asset_code)
    from asset_txn_items ai
    join assets a       on a.code = ai.asset_code
    join asset_types ty on ty.code = a.type_code
    left join asset_txn_items bi on bi.out_item_id = ai.id
    left join asset_txns back    on back.id = bi.txn_id
    where ai.txn_id = t.id
  ), '[]'::jsonb),

  -- ใบคืนที่มาปิดเครื่องของใบนี้ · หนึ่งใบคืนคือหนึ่งครั้ง
  coalesce((
    select jsonb_agg(ev order by (ev->>'at'))
    from (
      select jsonb_build_object(
               'at',       back.created_at,
               'by',       coalesce(ba.full_name, bp.full_name),
               'detail',   string_agg(bi.asset_code, ' · ' order by bi.asset_code),
               'cond',     case
                             when coalesce(back.is_transfer, false) then 'transfer'
                             when coalesce(back.is_forced, false)   then 'forced'
                             else 'ok'
                           end,
               'file_ids', coalesce((
                             select array_agg(ph.file_id order by ph.seq)
                             from asset_txn_photos ph where ph.txn_id = back.id
                           ), '{}')
             ) as ev
      from asset_txn_items ai2
      join asset_txn_items bi   on bi.out_item_id = ai2.id
      join asset_txns back      on back.id = bi.txn_id
      left join profiles bp     on bp.id = back.user_id
      left join profiles ba     on ba.id = back.acted_by
      where ai2.txn_id = t.id
      group by back.id, back.created_at, back.is_transfer, back.is_forced,
               ba.full_name, bp.full_name
    ) g
  ), '[]'::jsonb)

from asset_txns t
join profiles p on p.id = t.user_id
where t.kind = 'out';

grant select on return_cards to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select case when count(*) >= 0 then 'วิว return_cards ใช้งานได้ · มี ' || count(*) || ' ใบ'
       end as ผลตรวจ
  from return_cards;
