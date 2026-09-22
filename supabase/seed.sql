-- =====================================================================
-- BPL SUPPLY — ข้อมูลตัวอย่างสำหรับทดสอบ (รันหลัง 001 และ 002)
-- ลบทิ้งได้ทั้งหมดก่อนขึ้นใช้งานจริง
-- =====================================================================

insert into items (sku, name, category_id, hub_code, unit, shelf_code, qty_on_hand, min_qty, is_returnable, qr_payload)
values
  ('SKU-CL-0091', 'น้ำยาล้างห้องน้ำ 900 มล.',  (select id from categories where name = 'ทำความสะอาด'), 'BPL', 'ขวด', 'A-03', 24, 6,  false, 'SKU-CL-0091'),
  ('SKU-CL-0092', 'ผงซักฟอก 1 กก.',            (select id from categories where name = 'ทำความสะอาด'), 'BPL', 'ถุง', 'A-04', 12, 4,  false, 'SKU-CL-0092'),
  ('SKU-CL-0093', 'ไม้กวาดดอกหญ้า',             (select id from categories where name = 'ทำความสะอาด'), 'BPL', 'ด้าม', 'A-07', 5,  5,  false, 'SKU-CL-0093'),
  ('SKU-CL-0094', 'ถุงขยะดำ 30x40 นิ้ว',        (select id from categories where name = 'ทำความสะอาด'), 'BPL', 'แพ็ก', 'A-08', 0,  3,  false, 'SKU-CL-0094'),
  ('SKU-PP-0201', 'ถุงมือผ้าเคลือบยาง',          (select id from categories where name = 'PPE'),         'BPL', 'คู่',  'B-01', 60, 20, false, 'SKU-PP-0201'),
  ('SKU-PP-0202', 'หน้ากากอนามัย (กล่อง 50)',    (select id from categories where name = 'PPE'),         'BPL', 'กล่อง','B-02', 18, 5,  false, 'SKU-PP-0202'),
  ('SKU-OF-0301', 'กระดาษ A4 80 แกรม',          (select id from categories where name = 'สำนักงาน'),    'BPL', 'รีม',  'C-01', 30, 10, false, 'SKU-OF-0301'),
  ('SKU-OF-0302', 'ปากกาลูกลื่นน้ำเงิน',          (select id from categories where name = 'สำนักงาน'),    'BPL', 'ด้าม', 'C-02', 100,25, false, 'SKU-OF-0302'),
  ('SKU-RT-0401', 'เครื่องสแกนบาร์โค้ดมือถือ',     (select id from categories where name = 'อุปกรณ์ยืม-คืน'), 'BPL', 'เครื่อง','D-01', 8, 2, true,  'SKU-RT-0401'),
  ('SKU-RT-0402', 'รถเข็นลากพาเลท',              (select id from categories where name = 'อุปกรณ์ยืม-คืน'), 'BPL', 'คัน',  'D-02', 4, 1, true,  'SKU-RT-0402')
on conflict (sku) do nothing;
