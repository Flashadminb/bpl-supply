-- =====================================================================
-- BPL SUPPLY — แจ้งเสียจากหน้าทะเบียน + หน้ารวมประวัติโอนและแจ้งเสีย
-- รันต่อจาก 076 · ปลอดภัยที่จะรันซ้ำ
--
-- สองเรื่องที่เจ้าของระบบขอ
--
--   1) แจ้งเสียได้จากหน้าทะเบียน เผื่อหน้างานไม่แจ้งแล้วแอดมินไปเจอเอง
--      ของเดิมอาการพังบันทึกได้ตอนเบิกหรือตอนคืนเท่านั้น
--      เครื่องที่วางอยู่เฉย ๆ แล้วแอดมินเดินไปเจอว่าพัง ไม่มีทางบันทึก
--      นอกจากรอให้มีคนมาเบิกแล้วแจ้งตอนนั้น ซึ่งแปลว่าของพังถูกเบิกออกไปก่อน
--
--   2) วิวรวมประวัติการโอนกับการแจ้งเสีย ไว้ให้หน้าใหม่ดูย้อนหลังทั้งฮับ
--      ของเดิมดูได้ทีละเครื่องจากหน้าทะเบียน ซึ่งตอบไม่ได้ว่า
--      "อาทิตย์นี้ใครโอนอะไรไปให้ใครบ้าง"
--
-- ไม่แตะของเดิมเลย สถานะที่โชว์ในหน้าอื่นยังเหมือนเดิมทุกอย่าง
-- =====================================================================


-- ---------------------------------------------------------------------
-- แจ้งเสียเครื่องหนึ่งเครื่อง โดยไม่ต้องผูกกับใบเบิกหรือใบคืน
--
-- phase ปล่อยว่าง เพราะไม่ได้เกิดตอนเบิกหรือตอนคืน
-- ของเดิมอ่าน phase แบบเผื่อ null อยู่แล้ว (ข้อมูลที่ย้ายมาจากชีตก็ไม่มี phase)
-- ---------------------------------------------------------------------
create or replace function asset_report_issue(
  p_code     text,
  p_symptom  text,
  p_file_id  text default null,
  p_web_link text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sym text := btrim(coalesce(p_symptom, ''));
  v_id  bigint;
begin
  if not my_can_audit() then
    raise exception 'ไม่มีสิทธิ์แจ้งเสีย';
  end if;
  if v_sym = '' then
    raise exception 'ต้องกรอกอาการที่เจอ';
  end if;
  if not exists (select 1 from assets where code = p_code) then
    raise exception 'ไม่พบเครื่องรหัส %', p_code;
  end if;

  -- อาการเดิมที่ยังไม่ได้เคลียร์และข้อความเหมือนกันเป๊ะ ถือว่ากดซ้ำ
  -- เน็ตในฮับไม่นิ่ง คนกดค้างแล้วกดซ้ำเป็นเรื่องปกติ
  select id into v_id
    from asset_issues
   where asset_code = p_code
     and resolved_at is null
     and btrim(symptom) = v_sym
   limit 1;

  if v_id is not null then
    return jsonb_build_object('id', v_id, 'duplicate', true, 'asset_code', p_code);
  end if;

  insert into asset_issues (asset_code, txn_id, phase, symptom, reported_by, file_id, web_link)
  values (p_code, null, null, v_sym, auth.uid(), nullif(p_file_id, ''), nullif(p_web_link, ''))
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'duplicate', false, 'asset_code', p_code);
end $$;

grant execute on function asset_report_issue(text, text, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- ประวัติการโอนทั้งฮับ — ใครโอนอะไรไปให้ใคร
--
-- คนละตัวกับ asset_transfer_notices ซึ่งเป็นของ "ค้างอยู่ของฉัน" เท่านั้น
-- ตัวนี้เห็นทั้งหมดและเห็นของที่จบไปแล้วด้วย เพราะเป็นหน้าไว้ดูย้อนหลัง
--
-- security_invoker จึงยังยึด policy read_transfers เดิม
-- ซึ่งเปิดให้แอดมินกับผู้ตรวจสอบอยู่แล้ว ไม่ได้เปิดกว้างขึ้นกว่าเดิม
-- ---------------------------------------------------------------------
drop view if exists asset_transfer_rows;
create view asset_transfer_rows
with (security_invoker = true) as
select
  tr.id,
  tr.asset_code,
  ty.name               as type_name,
  a.dept_code           as asset_dept,
  tr.from_user_id,
  fp.full_name          as from_name,
  fp.employee_code      as from_code,
  tr.from_dept,
  tr.to_user_id,
  tp.full_name          as to_name,
  tp.employee_code      as to_code,
  tr.to_dept,
  tr.by_user_id,
  bp.full_name          as by_name,
  tr.reason,
  tr.created_at,
  tr.claimed_at,
  cp.full_name          as claimed_by_name,
  tr.ack_at,
  case
    when tr.claimed_at is not null then 'claimed'
    else 'waiting'
  end                   as state
from asset_transfers tr
join assets a         on a.code = tr.asset_code
join asset_types ty   on ty.code = a.type_code
left join profiles fp on fp.id = tr.from_user_id
left join profiles tp on tp.id = tr.to_user_id
left join profiles bp on bp.id = tr.by_user_id
left join profiles cp on cp.id = tr.claimed_by;

grant select on asset_transfer_rows to authenticated;


-- ---------------------------------------------------------------------
-- ประวัติการแจ้งเสียทั้งฮับ
--
-- ของเดิมดูได้ทีละเครื่องจากหน้าทะเบียน ตัวนี้ดูรวมและกรองตามวันที่ได้
-- ---------------------------------------------------------------------
drop view if exists asset_issue_rows;
create view asset_issue_rows
with (security_invoker = true) as
select
  i.id,
  i.asset_code,
  ty.name                                   as type_name,
  a.dept_code                               as asset_dept,
  i.symptom,
  i.phase,
  i.reported_at,
  coalesce(rp.full_name, i.reported_name)   as reported_by_name,
  rp.employee_code                          as reported_by_code,
  i.file_id,
  i.web_link,
  i.resolved_at,
  sp.full_name                              as resolved_by_name,
  i.resolve_note,
  (i.resolved_at is null)                   as is_open
from asset_issues i
join assets a         on a.code = i.asset_code
join asset_types ty   on ty.code = a.type_code
left join profiles rp on rp.id = i.reported_by
left join profiles sp on sp.id = i.resolved_by;

grant select on asset_issue_rows to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname = 'asset_report_issue')        as ฟังก์ชันแจ้งเสีย,
  (select count(*) from information_schema.views
    where table_name = 'asset_transfer_rows')                                as วิวประวัติโอน,
  (select count(*) from information_schema.views
    where table_name = 'asset_issue_rows')                                   as วิวประวัติแจ้งเสีย,
  (select count(*) from asset_transfer_rows)                                 as จำนวนการโอน,
  (select count(*) from asset_issue_rows)                                    as จำนวนใบแจ้งเสีย;
