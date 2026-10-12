-- ---------------------------------------------------------------------
-- 145 · กระดานของค้างส่งออก ส่งโซน D0x ออกมากับแต่ละสาขา
--
-- ต่อจาก 144 ที่ทำตาราง hub_out_zones ไว้ · อันนี้คือฝั่งอ่าน
-- left join ไม่ใช่ join เพราะสาขาที่ยังไม่ได้ตั้งโซนต้องยังขึ้นกระดานตามปกติ
-- แค่ไม่มีโซนเท่านั้น ไม่ใช่หายไปทั้งแถว
--
-- สายหลัก LH ไม่มีโซนโดยธรรมชาติ เพราะเป็นรถหลักที่ไม่ได้ขึ้นสายพานคัดแยก
-- ฝั่งหน้าจอเป็นคนเขียนว่า LH ให้เอง ไม่ได้ยัดคำว่า LH ลงฐานข้อมูล
-- เพราะมันเป็นวิธีแสดงผล ไม่ใช่ข้อมูล · ถ้าเก็บลงตาราง วันหนึ่งจะมีคนเผลอ
-- ตั้งโซนจริงให้สาขาสายหลัก แล้วแยกไม่ออกว่าอันไหนคือรถหลัก อันไหนคือโซนที่ตั้งผิด
--
-- ตัวฟังก์ชันที่เหลือเหมือน 143 ทุกอย่าง เขียนทั้งก้อนเพราะ create or replace
-- ต้องมีตัวเต็ม · ที่ต่างจาก 143 มีสองจุด คือ left join hub_out_zones และคีย์ zone
-- ---------------------------------------------------------------------

create or replace function hub_out_board()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_cur  hub_out_snapshots%rowtype;
  v_prev hub_out_snapshots%rowtype;
  v_rows jsonb;
begin
  if not my_can_outbox() then
    raise exception 'บัญชีนี้ดูหน้านี้ไม่ได้';
  end if;

  select * into v_cur from hub_out_snapshots order by snap_at desc limit 1;
  if v_cur.id is null then
    return jsonb_build_object('snapshot', null, 'rows', '[]'::jsonb);
  end if;

  select * into v_prev
    from hub_out_snapshots where snap_at < v_cur.snap_at order by snap_at desc limit 1;

  select coalesce(jsonb_agg(x order by x->>'station'), '[]'::jsonb) into v_rows
    from (
      select jsonb_build_object(
               'dir', c.dir,
               'station', c.station,
               'zone', nullif(btrim(coalesce(z.zone, '')), ''),
               'in_wh', c.in_wh,
               'on_truck', c.on_truck,
               'prev_in', p.in_wh,
               'prev_on', p.on_truck,
               'waiting', c.waiting,
               'in_transit', c.in_transit,
               'trucks', c.trucks,
               'main_trucks', c.main_trucks,
               'extra_trucks', c.extra_trucks,
               'approving', c.approving,
               'finding', c.finding,
               'no_print', c.no_print,
               'trucks_list', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'at', to_char(t.depart_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI'),
                          'v', t.vehicle,
                          'p', t.is_printed)
                        order by t.depart_at)
                   from hub_out_trucks t
                  where t.snapshot_id = c.snapshot_id and t.station = c.station and t.dir = c.dir
               ), '[]'::jsonb)
             ) as x
        from hub_out_rows c
        left join hub_out_rows p
          on p.snapshot_id = v_prev.id and p.dir = c.dir and p.station = c.station
        left join hub_out_zones z
          on z.station = c.station
       where c.snapshot_id = v_cur.id
    ) q;

  return jsonb_build_object(
    'snapshot', jsonb_build_object(
      'id', v_cur.id,
      'snap_at', v_cur.snap_at,
      'uploaded_at', v_cur.uploaded_at,
      'file_name', v_cur.file_name,
      'row_count', v_cur.row_count,
      'truck_count', v_cur.truck_count,
      'prev_at', v_prev.snap_at
    ),
    'rows', v_rows
  );
end $$;

grant execute on function hub_out_board() to authenticated;

-- นับว่ามีโซนกี่สาขาจากทั้งหมดกี่สาขา · ตอนรันจริงได้ zone=81 all=104
-- ที่ยังไม่มีคือสายหลัก 22 สาขาซึ่งไม่ต้องมี กับสายรองอีก 1 สาขาที่ต้องไปตั้งเอง
select
  (select count(*) from (
     select jsonb_array_elements((select hub_out_board())->'rows') e
   ) t where e->>'zone' is not null) as zone,
  (select jsonb_array_length((select hub_out_board())->'rows')) as all_rows;
