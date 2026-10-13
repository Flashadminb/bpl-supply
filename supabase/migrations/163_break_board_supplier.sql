-- ---------------------------------------------------------------------
-- 163 · หน้าใบที่ค้างอยู่ต้องเห็นชื่อซัพด้วย
--
-- break_board_rows ทำไว้ตั้งแต่ก่อนมีช่องซัพ จึงยังไม่มีคอลัมน์นี้
-- หน้า "ใบที่ค้างอยู่" อ่านจากวิวนี้ ไม่ได้อ่านจาก break_rows
-- เพิ่ม supplier ต่อท้าย ไม่ได้สลับลำดับคอลัมน์เดิม
-- ของเดิมที่อ่านวิวนี้อยู่ (กระดาน รปภ) จึงไม่กระทบเลย
--
-- ชื่อเล่นมีอยู่แล้วในวิว แค่ฝั่งหน้าจอไม่ได้ขอมา
-- ---------------------------------------------------------------------

create or replace view break_board_rows
with (security_invoker = true) as
select p.id,
       p.ref_no,
       p.card_code,
       p.group_code,
       p.reason_label,
       p.people,
       p.minutes,
       p.nickname,
       p.issued_at,
       p.due_at,
       p.gate_out_at,
       p.gate_out_people,
       p.gate_out_by,
       p.in_ban,
       i.full_name as issued_by_name,
       i.employee_code as issued_by_code,
       (p.gate_out_at is null) as waiting_gate,
       p.supplier
  from break_passes p
  join profiles i on i.id = p.issued_by
 where p.closed_at is null;

grant select on break_board_rows to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล · ต้องไม่มีคอลัมน์ไหนที่หน้าจอขอแล้ววิวไม่มี
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'break_board_rows' and column_name = 'supplier')  as มีsupplier,
  (select count(*) from information_schema.columns
    where table_name = 'break_board_rows')                               as คอลัมน์ทั้งหมด,
  (select count(*) from unnest(array[
     'id','ref_no','card_code','reason_label','people','minutes',
     'gate_out_people','gate_out_by','issued_by_name','issued_by_code',
     'issued_at','gate_out_at','due_at','waiting_gate','nickname','supplier'
   ]) w
    where w not in (select column_name from information_schema.columns
                     where table_name = 'break_board_rows'))             as ที่ขอแต่ไม่มี;
