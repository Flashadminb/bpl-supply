-- =====================================================================
-- BPL SUPPLY — ยกเลิกการโอน โดยที่ประวัติยังอยู่
-- รันต่อจาก 117 · ปลอดภัยที่จะรันซ้ำ
--
-- ของเดิมใน 041 ยกเลิกแล้ว delete แถวทิ้ง การโอนผิดจึงหายไปเงียบ ๆ
-- เหมือนไม่เคยเกิดขึ้น ซึ่งผิดกับที่เจ้าของระบบต้องการ
-- "ยกเลิกและใส่เหตุผล แต่ไม่ลบออกจากประวัติ"
--
-- ที่ต้องเก็บไว้เพราะการโอนผิดไม่ใช่เรื่องไร้ผล
-- ตอนโอนระบบตัดรายการค้างของคนเดิมไปแล้ว ถ้าลบแถวทิ้ง
-- จะเหลือแค่ใบคืนลอย ๆ ที่ไม่มีอะไรอธิบายว่าทำไมของหลุดจากมือเขา
--
-- เหตุผลบังคับใส่ เหมือนกับยกเลิกรถใน 113 ด้วยเหตุผลเดียวกัน
-- ยกเลิกโดยไม่บอกเหตุผล อ่านย้อนหลังแล้วตอบไม่ได้ว่าควรโอนใหม่ไหม
-- =====================================================================

-- ---------------------------------------------------------------------
-- ① ช่องเก็บการยกเลิก
-- ---------------------------------------------------------------------
alter table asset_transfers
  add column if not exists cancelled_at  timestamptz,
  add column if not exists cancelled_by  uuid references profiles(id),
  add column if not exists cancel_reason text;

comment on column asset_transfers.cancel_reason is
  'เหตุผลที่ยกเลิกการโอน · บังคับใส่ · แถวยังอยู่ในประวัติเสมอ';

-- ที่ยังรอปลายทางกดรับจริง ๆ ต้องไม่นับใบที่ยกเลิกไปแล้ว
drop index if exists asset_transfers_touser_idx;
create index if not exists asset_transfers_touser_idx
  on asset_transfers (to_user_id) where claimed_at is null and cancelled_at is null;


-- ---------------------------------------------------------------------
-- ② ยกเลิก
--
-- ทิ้งตัวเก่าที่รับแค่ id ก่อน ไม่งั้นจะมีสองตัวชื่อเดียวกัน
-- แล้ว PostgREST จะเลือกไม่ถูกว่าจะเรียกตัวไหน
--
-- ยกเลิกได้เฉพาะใบที่ปลายทางยังไม่กดรับ
-- ถ้ารับไปแล้วเครื่องอยู่ในมือเขาจริง ทางกลับคือกดคืนตามขั้นตอน
-- ไม่ใช่ลบร่องรอยว่าเคยอยู่กับเขา
-- ---------------------------------------------------------------------
drop function if exists asset_transfer_cancel(bigint);

create or replace function asset_transfer_cancel(p_id bigint, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tr     asset_transfers%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not my_can_proxy() then
    raise exception 'บัญชีนี้ยกเลิกการโอนไม่ได้';
  end if;
  if v_reason is null then
    raise exception 'ต้องใส่เหตุผลที่ยกเลิก';
  end if;

  select * into v_tr from asset_transfers where id = p_id for update;
  if v_tr.id is null then
    raise exception 'ไม่พบรายการโอนนี้';
  end if;
  if v_tr.cancelled_at is not null then
    raise exception 'รายการนี้ถูกยกเลิกไปแล้ว';
  end if;
  if v_tr.claimed_at is not null then
    raise exception 'ปลายทางกดรับเครื่อง % ไปแล้ว ยกเลิกไม่ได้ ให้กดคืนตามขั้นตอนแทน',
      v_tr.asset_code;
  end if;

  -- ตัดการถือครองชั่วคราวออก เครื่องกลับไปเป็นของแผนกเจ้าของตามเดิม
  update assets set loan_user = null, loan_dept = null
   where code = v_tr.asset_code and loan_user = v_tr.to_user_id;

  update asset_transfers set
    cancelled_at  = now(),
    cancelled_by  = auth.uid(),
    cancel_reason = v_reason,
    -- ต้นทางไม่ต้องตามเรื่องนี้ต่อแล้ว แถบเตือนฝั่ง out จึงต้องดับไปด้วย
    ack_at        = coalesce(ack_at, now())
  where id = p_id;

  return jsonb_build_object('ok', true, 'id', p_id, 'asset_code', v_tr.asset_code);
end $$;

grant execute on function asset_transfer_cancel(bigint, text) to authenticated;


-- ---------------------------------------------------------------------
-- ③ แถบเตือนหน้างาน — ใบที่ยกเลิกแล้วต้องหายไปจากทั้งสองฝั่ง
--
-- แก้ของเดิมอีกจุดไปพร้อมกัน ฝั่ง out ไม่เคยส่ง to_dept ออกมาเลยตั้งแต่ 041
-- ที่เปลี่ยนจากโอนให้แผนกเป็นโอนให้คน หน้าจอจึงขึ้นว่า
-- "ถูกโอนไปให้แผนก " แล้วจบประโยคเฉย ๆ · ใส่ชื่อคนรับกลับเข้าไป
-- ---------------------------------------------------------------------
drop view if exists asset_transfer_notices;
create view asset_transfer_notices
with (security_invoker = true) as
select
  tr.id,
  'in'::text            as side,
  tr.asset_code,
  ty.name               as type_name,
  tp.full_name          as to_name,
  tr.to_dept,
  tr.from_dept,
  fp.full_name          as from_name,
  bp.full_name          as by_name,
  tr.reason,
  tr.created_at
from asset_transfers tr
join assets a       on a.code = tr.asset_code
join asset_types ty on ty.code = a.type_code
left join profiles fp on fp.id = tr.from_user_id
left join profiles tp on tp.id = tr.to_user_id
join profiles bp      on bp.id = tr.by_user_id
where tr.claimed_at is null
  and tr.cancelled_at is null
  and tr.to_user_id = auth.uid()

union all

select
  tr.id,
  'out'::text,
  tr.asset_code,
  ty.name,
  tp.full_name,
  tr.to_dept,
  tr.from_dept,
  fp.full_name,
  bp.full_name,
  tr.reason,
  tr.created_at
from asset_transfers tr
join assets a       on a.code = tr.asset_code
join asset_types ty on ty.code = a.type_code
left join profiles fp on fp.id = tr.from_user_id
left join profiles tp on tp.id = tr.to_user_id
join profiles bp      on bp.id = tr.by_user_id
where tr.ack_at is null
  and tr.cancelled_at is null
  and tr.from_user_id = auth.uid();

grant select on asset_transfer_notices to authenticated;


-- ---------------------------------------------------------------------
-- ④ ประวัติการโอน — เพิ่มสถานะยกเลิกและคนที่กดยกเลิก
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
  tr.cancelled_at,
  xp.full_name          as cancelled_by_name,
  tr.cancel_reason,
  case
    when tr.cancelled_at is not null then 'cancelled'
    when tr.claimed_at   is not null then 'claimed'
    else 'waiting'
  end                   as state
from asset_transfers tr
join assets a         on a.code = tr.asset_code
join asset_types ty   on ty.code = a.type_code
left join profiles fp on fp.id = tr.from_user_id
left join profiles tp on tp.id = tr.to_user_id
left join profiles bp on bp.id = tr.by_user_id
left join profiles cp on cp.id = tr.claimed_by
left join profiles xp on xp.id = tr.cancelled_by;

grant select on asset_transfer_rows to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'asset_transfers'
      and column_name in ('cancelled_at','cancelled_by','cancel_reason'))   as ช่องยกเลิกที่เพิ่ม,
  (select count(*) from pg_proc where proname = 'asset_transfer_cancel'
     and pronargs = 2)                                                      as ฟังก์ชันยกเลิกแบบใส่เหตุผล,
  (select count(*) from pg_proc where proname = 'asset_transfer_cancel'
     and prosrc like '%delete from asset_transfers%')                       as ยังลบแถวทิ้งอยู่ไหม,
  (select count(*) from information_schema.columns
    where table_name = 'asset_transfer_notices' and column_name = 'to_name') as แถบเตือนมีชื่อคนรับ,
  (select count(*) from asset_transfers)                                     as ประวัติการโอนทั้งหมด;
