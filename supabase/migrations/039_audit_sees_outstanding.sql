-- =====================================================================
-- BPL SUPPLY — ผู้ตรวจสอบต้องเห็นของที่ยังไม่คืน
-- รันต่อจาก 038 · ปลอดภัยที่จะรันซ้ำ
--
-- อาการ: ผู้ตรวจสอบเปิดหน้า "Asset ที่ยังไม่คืน" แล้วว่างเปล่า
--        ทั้งที่มีคนเบิกออกไปจริง และปุ่มโอนเครื่องก็เลยกดไม่ได้
--
-- สาเหตุ: 032 เปิดให้ผู้ตรวจสอบเห็น "ตัวเครื่อง" (assets) แล้ว
--        แต่ลืมเปิด "รายการเบิก" (asset_txns / asset_txn_items)
--        วิว asset_holdings เป็น security_invoker และต้อง join สองตารางนั้น
--        พอ join ไม่ติดสักแถว วิวจึงคืนค่าว่างโดยไม่มี error ให้เห็น
--
-- ฝั่งวัสดุสิ้นเปลืองเป็นคนละอาการแต่รากเดียวกัน:
--        open_borrowings อ่าน returns ผ่าน lateral เพื่อหักยอดที่คืนแล้ว
--        ผู้ตรวจสอบอ่าน returns ไม่ได้ ผลรวมจึงเป็น 0 เสมอ
--        แถวที่คืนครบแล้วจะยังโผล่ว่าค้างอยู่ — ผิดแบบเงียบ ๆ อันตรายกว่าว่างเปล่า
-- =====================================================================

-- ── Asset ─────────────────────────────────────────────────────────────
-- อ่านได้อย่างเดียว การเขียนยังเป็นของ supervisor/admin เหมือนเดิม
drop policy if exists read_asset_txns on asset_txns;
create policy read_asset_txns on asset_txns for select to authenticated
  using (user_id = auth.uid() or my_can_proxy());

drop policy if exists read_asset_txn_items on asset_txn_items;
create policy read_asset_txn_items on asset_txn_items for select to authenticated using (
  my_can_proxy()
  or exists (select 1 from asset_txns t where t.id = txn_id and t.user_id = auth.uid())
);

-- รูปสภาพเครื่อง — ผู้ตรวจสอบต้องเปิดดูได้ เพราะหน้าที่คือตรวจ
-- หน้างานยังเปิดไม่ได้ ตามกติกาข้อ 4 ของโปรเจกต์
drop policy if exists read_asset_photos on asset_txn_photos;
create policy read_asset_photos on asset_txn_photos for select to authenticated
  using (my_role() in ('supervisor', 'admin') or my_can_dispatch());

-- ── วัสดุสิ้นเปลือง ───────────────────────────────────────────────────
-- เพิ่มสิทธิ์อ่านอย่างเดียวซ้อนเข้าไป ไม่แตะ rw_returns เดิม
-- เพราะ rw_returns เป็น for all การแก้ using จะพลอยเปิดสิทธิ์ลบให้ด้วย
drop policy if exists read_returns_audit on returns;
create policy read_returns_audit on returns for select to authenticated
  using (my_can_dispatch());

-- ใบแจ้งชำรุดของ Asset ผูกกับรายการเบิก ต้องตามดูได้ด้วย
drop policy if exists read_asset_issues_audit on asset_issues;
create policy read_asset_issues_audit on asset_issues for select to authenticated
  using (true);


-- ---------------------------------------------------------------------
-- ตรวจผล — รันด้วยบัญชีผู้ตรวจสอบแล้วต้องได้เลขเท่ากับที่แอดมินเห็น
-- ---------------------------------------------------------------------
select 'เครื่องที่ยังไม่คืน' as รายการ, count(*) as จำนวน from asset_holdings
union all select 'วัสดุยืม-คืนที่ค้าง', count(*) from open_borrowings;
