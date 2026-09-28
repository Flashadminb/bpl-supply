-- =====================================================================
-- BPL SUPPLY — แก้ชื่อและลบเครื่องในทะเบียน
-- รันต่อจาก 050 · ปลอดภัยที่จะรันซ้ำ
--
-- สองอย่างที่ทำไม่ได้มาตลอด
--   1. แก้รหัสเครื่อง — รหัสเป็นกุญแจที่ตารางอื่นชี้มา พอแก้แล้วตัวชี้ค้าง
--   2. ลบเครื่องที่เคยถูกเบิก — ประวัติชี้มาที่เครื่องนั้นอยู่
--
-- ข้อ 1 แก้ด้วย on update cascade · เปลี่ยนรหัสแล้วทุกที่ที่อ้างถึงเปลี่ยนตาม
--        ประวัติไม่ขาด เพราะมันตามไปเอง
--
-- ข้อ 2 เจ้าของระบบเลือกให้ลบได้หมด รวมประวัติ โดยยืนยันสองชั้น
--        จึงทำเป็น RPC ที่ไล่ลบลูกให้ครบก่อน ไม่ใช่เปิด cascade ทิ้งไว้
--        เพราะ cascade จะทำให้ลบพลาดทีเดียวหายทั้งประวัติโดยไม่มีอะไรทัดทาน
--
-- กันไว้ข้อเดียว: เครื่องที่มีคนถืออยู่ตอนนี้ลบไม่ได้
-- ไม่งั้นรายการค้างของเขาจะหายไปเฉย ๆ โดยไม่มีใครรู้ว่าเครื่องอยู่ไหน
-- ให้กดคืนหรือปิดรายการก่อน แล้วค่อยลบ
-- =====================================================================

-- ── แก้รหัสเครื่องแล้วให้ทุกที่ตามไปด้วย ──────────────────────────────
alter table asset_txn_items drop constraint if exists asset_txn_items_asset_code_fkey;
alter table asset_txn_items
  add constraint asset_txn_items_asset_code_fkey
  foreign key (asset_code) references assets(code) on update cascade;

alter table asset_transfers drop constraint if exists asset_transfers_asset_code_fkey;
alter table asset_transfers
  add constraint asset_transfers_asset_code_fkey
  foreign key (asset_code) references assets(code) on update cascade;

alter table asset_issues drop constraint if exists asset_issues_asset_code_fkey;
alter table asset_issues
  add constraint asset_issues_asset_code_fkey
  foreign key (asset_code) references assets(code) on update cascade on delete cascade;


-- ---------------------------------------------------------------------
-- RPC: ลบเครื่องออกจากทะเบียน พร้อมประวัติทั้งหมด
--
-- คืนค่าจำนวนที่ลบไป เพื่อให้หน้าจอบอกได้ว่าหายไปเท่าไหร่จริง ๆ
-- ---------------------------------------------------------------------
create or replace function delete_asset(p_code text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_holder text;
  v_txn    int := 0;
  v_iss    int := 0;
  v_trf    int := 0;
begin
  if my_role() not in ('supervisor', 'admin') then
    raise exception 'เฉพาะแอดมินและเจ้าของระบบเท่านั้นที่ลบเครื่องได้';
  end if;

  if not exists (select 1 from assets where code = p_code) then
    raise exception 'ไม่พบเครื่อง %', p_code;
  end if;

  -- เครื่องที่ยังอยู่ในมือใครลบไม่ได้ · รายการค้างจะหายเงียบ ๆ
  select h.holder_name into v_holder
    from asset_holdings h where h.asset_code = p_code;
  if v_holder is not null then
    raise exception 'เครื่อง % ยังอยู่กับ % · กดคืนหรือปิดรายการก่อนจึงจะลบได้', p_code, v_holder;
  end if;

  select count(*) into v_txn from asset_txn_items where asset_code = p_code;
  select count(*) into v_iss from asset_issues   where asset_code = p_code;
  select count(*) into v_trf from asset_transfers where asset_code = p_code;

  -- ตัดสายที่ชี้หากันเองก่อน ไม่งั้นลบไม่ได้เพราะติดกันเป็นลูกโซ่
  update asset_txn_items set out_item_id = null
   where out_item_id in (select id from asset_txn_items where asset_code = p_code);

  update assets set held_item_id = null, loan_user = null, loan_dept = null
   where code = p_code;

  delete from asset_transfers where asset_code = p_code;
  delete from asset_txn_items  where asset_code = p_code;
  delete from asset_issues     where asset_code = p_code;

  -- ใบไหนไม่เหลือเครื่องแล้วก็ลบทิ้ง จะได้ไม่มีใบเปล่าค้างในรายงาน
  delete from asset_txns t
   where not exists (select 1 from asset_txn_items i where i.txn_id = t.id);

  delete from assets where code = p_code;

  return jsonb_build_object(
    'code', p_code,
    'txn_items', v_txn,
    'issues', v_iss,
    'transfers', v_trf
  );
end $$;

grant execute on function delete_asset(text) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select 'ฟังก์ชันลบเครื่อง' as สิ่งที่ตรวจ, count(*)::text as ผล
  from pg_proc where proname = 'delete_asset'
union all
select tc.table_name || ' แก้รหัสตามได้', rc.update_rule
  from information_schema.table_constraints tc
  join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
  join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name
 where tc.constraint_type = 'FOREIGN KEY'
   and ccu.table_name = 'assets' and ccu.column_name = 'code'
 order by 1;
