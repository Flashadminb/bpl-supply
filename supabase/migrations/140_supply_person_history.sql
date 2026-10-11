-- ---------------------------------------------------------------------
-- 140 · ประวัติการเบิกรายบุคคล
--
-- หน้าประวัติเบิกสิ้นเปลืองของเดิมตอบได้แค่ "ใบนี้ใครเบิก"
-- คำถามที่ถามจริงบ่อยกว่าคือ "คนนี้เบิกอะไรไปบ้างในช่วงนี้"
-- ซึ่งของเดิมตอบไม่ได้ เพราะดึงมาแค่ 400 ใบล่าสุดแล้วกรองในเครื่อง
-- พอช่วงวันยาวขึ้น ยอดรวมของแต่ละคนจะขาดโดยไม่มีใครรู้ — ผิดแบบเงียบ
--
-- จึงรวมยอดที่ฐานข้อมูล ไม่ใช่ที่หน้าจอ · นับครบทุกใบในช่วงที่เลือกเสมอ
--
-- ค้างคืนเป็นยอด "ตอนนี้" ไม่ผูกกับช่วงวัน เพราะของที่ค้างคือของที่ยังไม่กลับมา
-- ไม่ว่าจะเบิกไปตั้งแต่เดือนไหน · หน้าจอต้องเขียนกำกับให้ชัดว่าคนละฐานกัน
-- ---------------------------------------------------------------------

create or replace function supply_person_history(
  p_from timestamptz,
  p_to   timestamptz
) returns table (
  user_id        uuid,
  full_name      text,
  employee_code  text,
  dept_code      text,
  sub_dept       text,
  position_code  text,
  slips          integer,
  units          integer,
  kinds          integer,
  pending_slips  integer,
  rejected_slips integer,
  open_units     integer,
  last_at        timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not my_can_audit() then
    raise exception 'บัญชีนี้ดูประวัติการเบิกของคนอื่นไม่ได้';
  end if;

  return query
  with mine as (
    select r.id, r.requester_id, r.status, r.created_at
      from requisitions r
     where r.created_at >= p_from
       and r.created_at <= p_to
  ),
  slip as (
    select m.requester_id as uid,
           count(*)::int                                         as slips,
           count(*) filter (where m.status = 'pending')::int      as pending_slips,
           count(*) filter (where m.status = 'rejected')::int     as rejected_slips,
           max(m.created_at)                                      as last_at
      from mine m
     group by 1
  ),
  -- ใบที่ไม่อนุมัติไม่นับเป็นของที่เบิกออกไป เพราะของไม่เคยออกจากคลัง
  line as (
    select m.requester_id as uid,
           coalesce(sum(coalesce(li.qty_approved, li.qty_requested)), 0)::int as units,
           count(distinct li.item_id)::int                                    as kinds
      from mine m
      join requisition_items li on li.requisition_id = m.id
     where m.status <> 'rejected'
     group by 1
  ),
  open_now as (
    select ob.requester_id as uid, coalesce(sum(ob.qty_open), 0)::int as open_units
      from open_borrowings ob
     where ob.qty_open > 0
     group by 1
  )
  select p.id,
         p.full_name,
         p.employee_code,
         p.dept_code,
         p.sub_dept,
         p.position_code,
         s.slips,
         coalesce(l.units, 0),
         coalesce(l.kinds, 0),
         s.pending_slips,
         s.rejected_slips,
         coalesce(o.open_units, 0),
         s.last_at
    from slip s
    join profiles p         on p.id = s.uid
    left join line l        on l.uid = s.uid
    left join open_now o    on o.uid = s.uid
   order by coalesce(l.units, 0) desc, s.slips desc, p.full_name;
end $$;

grant execute on function supply_person_history(timestamptz, timestamptz) to authenticated;

select 'MARK|fn=' || (select count(*) from pg_proc where proname = 'supply_person_history')
  || '|rows=' || (select count(*) from supply_person_history(now() - interval '30 days', now()))
  || '|END' as r;
