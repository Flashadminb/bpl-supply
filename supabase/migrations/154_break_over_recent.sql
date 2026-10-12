-- ---------------------------------------------------------------------
-- 154 · ใครเบรคเกินเวลาบ้างในรอบ 24 ชั่วโมง
--
-- break_now() ตอบได้แค่ "ตอนนี้ใครยังไม่กลับ" ซึ่งหายทันทีที่ รปภ กดรับกลับ
-- แปลว่าคนที่เกินไปยี่สิบนาทีแล้วเดินกลับเข้ามา จะไม่เคยขึ้นหน้าแรกเลย
-- ถ้าแอดมินไม่ได้นั่งจ้องจออยู่พอดีตอนนั้น
--
-- ตัวนี้ตอบอีกคำถาม — กะนี้มีใครเกินเวลาไปแล้วบ้าง รวมคนที่กลับมาแล้วด้วย
--
-- กติกาสองข้อที่ตั้งใจให้ต่างกัน
--   ใบที่ยังไม่กลับและเลยเวลา   ขึ้นเสมอ ไม่มีกำหนดหาย เพราะยังเป็นเรื่องที่ค้างอยู่จริง
--   ใบที่กลับมาแล้วแต่เคยเกิน   ขึ้น 24 ชม นับจากเวลาที่รับกลับ แล้วหายไปเอง
-- เจ้าของระบบสั่งว่าโชว์ 24 ชั่วโมงพอ · ส่วนของที่ยังค้างไม่นับอยู่ในกติกานั้น
-- เพราะมันไม่ใช่ประวัติ มันคือคนที่ยังไม่กลับเข้ามา
--
-- ใบที่หลังบ้านปิดเอง (close_kind admin หรือ supervisor) ไม่นับว่าเกิน
-- ใช้กติกาเดียวกับ over_sec ใน view break_rows เป๊ะ ๆ
-- เพราะเวลาที่ค้างมาจากการลืมกดรับกลับ ไม่ใช่คนนั้นอยู่ข้างนอกจริง
-- ถ้านับด้วย หน้าแรกจะกล่าวหาคนที่ไม่ได้ทำผิด แล้วไม่มีใครเชื่อป้ายนี้อีกเลย
--
-- ด่านสิทธิ์ตัวเดียวกับ break_now() ไม่ใช่ break_admin_guard()
-- ซึ่งแคบกว่าคนที่เปิดหน้าแรกหลังบ้านได้ และจะทำให้แอดมินเจอ error ทั้งหน้า
--
-- คืนตัวเลขสองชั้น เพราะของจริงวัดแล้วพบว่าวันหนึ่งปิดใบ 492 ใบ
-- เกินเกินหนึ่งนาที 232 ใบ · เกินห้านาที 51 ใบ · เกินสิบห้านาที 3 ใบ
-- ซึ่งแปลว่า "เกินหนึ่งนาที" คือเรื่องปกติของการเดินกลับเข้าประตู ไม่ใช่การอู้
-- ถ้าขึ้นหน้าแรกว่าวันนี้เกินเวลา 232 ใบ ไม่มีใครอ่านป้ายนี้อีกเลยตั้งแต่วันแรก
-- จึงคืน over5 มาด้วย แล้วให้หน้าจอเรียงจากเกินนานสุดและตัดที่สิบห้าใบ
-- ---------------------------------------------------------------------

create or replace function break_over_recent(p_limit int default 60)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not (my_can_audit() or my_can_break_issue() or my_can_break_guard()) then
    return jsonb_build_object('rows', '[]'::jsonb, 'total', 0);
  end if;

  with src as (
    select p.id,
           p.ref_no,
           p.card_code,
           p.group_code,
           coalesce(g.name, p.group_code)                       as group_name,
           p.people,
           p.nickname,
           p.reason_label,
           p.minutes,
           i.full_name                                          as issued_by_name,
           p.issued_at,
           p.due_at,
           p.closed_at,
           p.close_kind,
           (p.people - coalesce(p.returned_people, p.people))   as missing_people,
           /* เกินไปกี่วินาที · ยังไม่กลับก็นับถึงเดี๋ยวนี้ */
           case
             when p.close_kind in ('admin', 'supervisor') then null
             when p.closed_at is null then extract(epoch from (now() - p.due_at))::int
             when p.closed_at > p.due_at then extract(epoch from (p.closed_at - p.due_at))::int
             else 0
           end                                                  as over_sec
      from break_passes p
      left join break_groups g on g.code = p.group_code
      left join profiles i     on i.id   = p.issued_by
     where p.close_kind is distinct from 'admin'
       and p.close_kind is distinct from 'supervisor'
       and (
             (p.closed_at is null and now() > p.due_at)
             or p.closed_at > now() - interval '24 hours'
           )
  ),
  hit as (
    /* เกินครบหนึ่งนาทีถึงนับ · กติกาเดียวกับการเด้งแจ้งเตือนใน 123
       ศูนย์ถึงห้าสิบเก้าวินาทีคือจังหวะที่คนกำลังเดินเข้าประตูพอดี
       ถ้านับด้วย ป้ายนี้จะเต็มไปด้วยคนที่ไม่ได้อู้ แล้วคนจะเลิกอ่าน */
    select * from src where coalesce(over_sec, 0) >= 60
  )
  select jsonb_build_object(
    'total', (select count(*) from hit),
    /* เกินห้านาทีขึ้นไป · เส้นที่แยก "เดินกลับช้า" ออกจาก "อยู่ข้างนอกนานเกิน" */
    'over5', (select count(*) from hit where over_sec >= 300),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',        h.id,
               'ref',       h.ref_no,
               'card',      h.card_code,
               'grp_code',  h.group_code,
               'grp',       h.group_name,
               'people',    h.people,
               'nickname',  h.nickname,
               'reason',    h.reason_label,
               'minutes',   h.minutes,
               'issued_by', h.issued_by_name,
               'issued_at', h.issued_at,
               'due_at',    h.due_at,
               'closed_at', h.closed_at,
               'missing',   greatest(0, h.missing_people),
               'over_min',  floor(h.over_sec / 60.0)::int,
               'back',      h.closed_at is not null
             )
             /* ยังไม่กลับขึ้นก่อนเสมอ เพราะเป็นเรื่องที่ยังต้องตามอยู่
                ที่เหลือเรียงจากเกินนานสุด ไม่ใช่เรียงตามเวลา
                คนเปิดหน้านี้อยากรู้ว่าใครหนักสุด ไม่ได้อยากรู้ว่าใครล่าสุด */
             order by (h.closed_at is not null), h.over_sec desc, h.due_at desc)
        from (select * from hit
               order by (closed_at is not null), over_sec desc, due_at desc
               limit greatest(1, least(coalesce(p_limit, 60), 200))) h
    ), '[]'::jsonb)
  ) into v;

  return v;
end $$;

grant execute on function break_over_recent(int) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname = 'break_over_recent')          as มีฟังก์ชันแล้ว,
  (select count(*) from break_passes
    where closed_at is null and now() > due_at)                               as ยังไม่กลับและเกิน,
  (select count(*) from break_passes
    where closed_at > now() - interval '24 hours'
      and closed_at > due_at
      and close_kind is distinct from 'admin'
      and close_kind is distinct from 'supervisor')                           as กลับแล้วแต่เคยเกินใน24ชม;
