-- =====================================================================
-- BPL SUPPLY — หน้า รปภ เหลือเฉพาะใบที่ตัวเองปล่อยออกและยังไม่กลับ
-- รันต่อจาก 121 · ปลอดภัยที่จะรันซ้ำ
--
-- วัดของจริงแล้วเจอว่าตัวที่กินโควต้าไม่ใช่รูป แต่เป็นหน้าจอ รปภ เอง
--
--   หน้านี้ยิงสี่คำขอทุก 15 วินาที ตลอดเวลาที่เปิดค้างไว้
--   หนึ่งในนั้นคือประวัติ 24 ชั่วโมงของทั้งฮับ สูงสุด 80 แถว แถวละ 804 ไบต์
--   เท่ากับ 64 KB ทุก 15 วินาที = 15 MB ต่อชั่วโมงต่อเครื่อง
--   รปภ สองเครื่องเปิดค้างครบ 24 ชั่วโมง = ราว 740 MB ต่อวัน
--   ซึ่งทะลุโควต้าฟรี 5 GB ทั้งก้อนภายในสัปดาห์เดียว
--
-- เจ้าของระบบสั่งว่า รปภ ไม่ต้องเห็นอะไรเลยนอกจากใบที่ตัวเองกดปล่อยออก
-- และใบนั้นยังไม่กลับมา ซึ่งตรงกับทางที่ประหยัดที่สุดพอดี
--
-- ไฟล์นี้ทำสองอย่าง
--   ① ใส่ gate_out_by ลงในวิวกระดาน ฝั่งหน้าจอจะได้กรองว่าใบไหนของตัวเอง
--   ② ตัดสิทธิ์อ่านย้อนหลัง 24 ชั่วโมงของ รปภ ออก เพราะไม่มีหน้าไหนใช้แล้ว
--
-- รปภ ทุกคนใช้บัญชีเดียวกัน การกรองด้วย gate_out_by จึงเท่ากับ
-- "ทุกใบที่ รปภ ปล่อยออก" ไม่ว่าจะเป็นกะไหน เปลี่ยนกะแล้วคนใหม่ยังเห็นของเดิมครบ
--
-- การสแกนบัตรไม่กระทบเลย เพราะ break_scan เป็น security definer
-- รปภ ยังสแกนบัตรใบไหนก็ได้ และยังเห็นว่าใบที่เพิ่งปิดไปสองชั่วโมงเป็นของใคร
-- =====================================================================

-- ---------------------------------------------------------------------
-- ① กระดาน · บอกด้วยว่าใครเป็นคนกดปล่อยออก
-- ---------------------------------------------------------------------
drop view if exists break_board_rows;
create view break_board_rows
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
       (p.gate_out_at is null) as waiting_gate
  from break_passes p
  join profiles i on i.id = p.issued_by
 where p.closed_at is null;

grant select on break_board_rows to authenticated;


-- ---------------------------------------------------------------------
-- ② สิทธิ์อ่าน · รปภ เหลือเฉพาะใบที่ยังไม่ปิด
--
-- ตัดท่อน "ย้อนหลัง 24 ชั่วโมง" ที่ใส่ไว้ใน 097 ออก
-- ตอนนั้นใส่เพราะหน้า รปภ มีรายการประวัติวันนี้อยู่ ตอนนี้ไม่มีแล้ว
-- สิทธิ์ที่เปิดไว้แต่ไม่มีใครใช้ คือสิทธิ์ที่รอวันหลุดเฉย ๆ
--
-- คำถามที่ประตูว่า "ใบนี้เพิ่งกลับไปแล้วใช่ไหม" ยังตอบได้เหมือนเดิม
-- เพราะ break_scan คืนสถานะ closed พร้อมเวลาและชื่อคนรับ ให้สองชั่วโมงหลังปิด
-- ---------------------------------------------------------------------
drop policy if exists read_break_passes on break_passes;
create policy read_break_passes on break_passes for select to authenticated using (
  my_can_audit()
  or (
    issued_by = auth.uid()
    and (closed_at is null or issued_at > now() - interval '14 hours')
  )
  -- รปภ · เฉพาะใบที่ยังไม่ปิด ไม่มีย้อนหลังแล้ว
  or (my_can_break_guard() and closed_at is null)
  or (
    closed_at is null
    and my_can_break_issue()
    and exists (
      select 1 from break_group_users g
       where g.group_code = break_passes.group_code and g.user_id = auth.uid()
    )
  )
);


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'break_board_rows' and column_name = 'gate_out_by')  as กระดานบอกคนปล่อยออก,
  (select count(*) from pg_policies where tablename = 'break_passes'
     and policyname = 'read_break_passes' and qual like '%24:00:00%')       as รปภยังอ่านย้อนหลังไหม,
  (select count(*) from pg_policies where tablename = 'break_passes'
     and policyname = 'read_break_passes' and qual like '%14:00:00%')       as หัวหน้ายังเหลือ14ชม,
  (select count(*) from break_passes where closed_at is null)               as ใบที่ยังไม่กลับตอนนี้,
  (select count(*) from break_passes)                                       as ใบทั้งหมดที่ยังเก็บครบ;
