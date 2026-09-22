-- =====================================================================
-- BPL SUPPLY — ทำให้ส่งออก Google Sheet เร็วคงที่ ไม่อืดเมื่อข้อมูลเยอะ
-- รันต่อจาก 007 · ปลอดภัยที่จะรันซ้ำ
--
-- ปัญหาเดิม: ทุกครั้งที่ส่งออก ต้องอ่านทั้งชีตมาเทียบว่าแถวไหนมีแล้ว
-- พอถึงหลายหมื่นแถวจะช้าลงเรื่อย ๆ จนอาจหมดเวลาทำงานของ Edge Function
--
-- วิธีใหม่: จำไว้ในฐานข้อมูลว่าบรรทัดไหนไปอยู่แท็บไหน แถวที่เท่าไหร่
-- แถวใหม่ต่อท้าย แถวเดิมเขียนทับเฉพาะตำแหน่งนั้น ไม่ต้องอ่านทั้งชีตอีก
-- แถมแยกแท็บรายเดือน แต่ละแท็บจึงเล็กและเปิดเร็วเสมอ
-- =====================================================================

create table if not exists sheet_exports (
  requisition_item_id bigint primary key references requisition_items(id) on delete cascade,
  tab                 text    not null,
  row_no              integer not null,
  exported_at         timestamptz not null default now()
);

create index if not exists sheet_exports_tab_idx on sheet_exports (tab, row_no);

alter table sheet_exports enable row level security;

-- อ่านได้เฉพาะแอดมินขึ้นไป · เขียนผ่าน Edge Function (service role) เท่านั้น
drop policy if exists read_sheet_exports on sheet_exports;
create policy read_sheet_exports on sheet_exports for select to authenticated
  using (my_role() in ('supervisor', 'admin'));

comment on table sheet_exports is
  'จำว่าบรรทัดรายการไหนถูกส่งไปอยู่แท็บไหน แถวที่เท่าไหร่ ใช้กันแถวซ้ำโดยไม่ต้องอ่านทั้งชีต';
