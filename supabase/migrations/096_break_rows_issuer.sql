-- =====================================================================
-- BPL SUPPLY — break_rows บอกด้วยว่าใครเป็นคนปล่อย
-- รันต่อจาก 095 · ปลอดภัยที่จะรันซ้ำ
--
-- หน้ากระดานของหัวหน้างานต้องโชว์ "บัตรที่ฉันปล่อยเอง" เท่านั้น
-- ของเดิมวิวส่งมาแต่ชื่อกับรหัสพนักงานของคนปล่อย ซึ่งเอามากรองไม่ได้จริง
-- ต้องเทียบชื่อหรือรหัสเป็นข้อความ ซึ่งพังทันทีที่มีคนชื่อซ้ำหรือรหัสว่าง
--
-- RLS ของ break_passes กันไว้อยู่แล้วว่าหัวหน้างานเห็นแต่ใบตัวเอง
-- แต่เจ้าของระบบกับผู้ตรวจสอบเห็นทุกใบ ถ้าพึ่ง RLS อย่างเดียว
-- หน้านี้จะกลายเป็นประวัติทั้งฮับเมื่อเจ้าของระบบเปิดดู ซึ่งไม่ใช่สิ่งที่ขอ
-- =====================================================================

drop view if exists break_rows;
create view break_rows
with (security_invoker = true) as
select p.id,
       p.ref_no,
       p.card_code,
       p.group_code,
       p.reason_code,
       p.reason_label,
       p.people,
       p.minutes,
       p.nickname,
       p.issued_at,
       p.due_at,
       p.gate_out_at,
       p.gate_out_people,
       p.closed_at,
       p.close_kind,
       p.returned_people,
       p.problem_code,
       p.problem_note,
       p.in_ban,
       p.ban_reason,
       p.exported_at,
       -- ของที่เพิ่มรอบนี้ · ไว้กรองว่าใบไหนเป็นของคนที่เปิดหน้าอยู่
       p.issued_by,
       i.full_name     as issued_by_name,
       i.employee_code as issued_by_code,
       c.full_name     as closed_by_name,
       extract(epoch from (p.gate_out_at - p.issued_at))::int as walk_sec,
       extract(epoch from (p.closed_at - p.gate_out_at))::int as out_sec,
       case
         when p.close_kind in ('admin', 'supervisor') then null
         when p.closed_at is null then null
         when p.closed_at > p.due_at then extract(epoch from (p.closed_at - p.due_at))::int
         else 0
       end as over_sec,
       (p.people - coalesce(p.returned_people, p.people)) as missing_people,
       (select count(*) from break_photos ph where ph.pass_id = p.id and ph.phase = 'issue')  as issue_shots,
       (select count(*) from break_photos ph where ph.pass_id = p.id and ph.phase = 'return') as return_shots
  from break_passes p
  join profiles i on i.id = p.issued_by
  left join profiles c on c.id = p.closed_by;

grant select on break_rows to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'break_rows' and column_name = 'issued_by') as มีช่องคนปล่อย,
  (select count(*) from break_rows)                                as แถวที่วิวส่งได้,
  (select count(distinct issued_by) from break_rows)               as คนที่เคยปล่อย;
