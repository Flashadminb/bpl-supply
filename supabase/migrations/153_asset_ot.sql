-- ---------------------------------------------------------------------
-- 153 · ขอ OT ต่อเวลาคืนเครื่อง
--
-- เจ้าของระบบสั่งว่า พอเลยเวลาแล้วให้หน้างานกดขอต่อได้ 1 2 3 หรือ 4 ชั่วโมง
-- เฉพาะคนที่เบิกเท่านั้น และเด้งถามแต่ปิดได้ ไม่บังคับ
--
-- กำหนดเดิมไม่ถูกแก้ · due_at ยังเป็นเวลาเดิมเสมอ
-- ที่เพิ่มคือ ot_until ซึ่งบอกว่าขอต่อถึงกี่โมง
--
-- เหตุผลที่ไม่เลื่อน due_at ทิ้ง
--   due_at คือหลักฐานว่าตกลงกันไว้ว่าคืนกี่โมง ถ้าเลื่อนทุกครั้งที่มีคนขอต่อ
--   สิ้นเดือนจะไม่มีใครรู้ว่าจริง ๆ แล้วใบนี้เลยเวลามาตั้งแต่กี่โมง
--   และสถิติทั้งเดือนจะสวยเกินจริงโดยไม่มีใครตั้งใจโกง
--
-- การเตือนหยุดชั่วคราวระหว่างอยู่ในช่วง OT แล้วกลับมาเตือนใหม่เมื่อเลย ot_until
-- ฝั่งหน้าจอเป็นคนตัดสินจากสองค่านี้ ฐานข้อมูลแค่เก็บความจริงไว้ทั้งคู่
-- ---------------------------------------------------------------------

alter table asset_txns add column if not exists ot_until timestamptz;
alter table asset_txns add column if not exists ot_hours integer;
alter table asset_txns add column if not exists ot_at    timestamptz;

comment on column asset_txns.ot_until is
  'ขอต่อเวลาถึงเมื่อไหร่ · due_at ยังเป็นกำหนดเดิมเสมอ ไม่ถูกเลื่อนตาม';


/**
 * ขอต่อเวลา · เฉพาะคนที่เบิกเอง และต่อได้ครั้งเดียวต่อใบ
 *
 * ที่ให้ต่อได้ครั้งเดียว เพราะถ้ากดได้เรื่อย ๆ จะกลายเป็นใบที่ไม่มีกำหนดคืน
 * ซึ่งแย่กว่าไม่มีระบบ OT เลย · อยากต่ออีกต้องให้หัวหน้าจัดการให้
 */
create or replace function asset_ot_extend(p_txn_id uuid, p_hours integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_due  timestamptz;
  v_owner uuid;
  v_ot   timestamptz;
begin
  if p_hours is null or p_hours not in (1, 2, 3, 4) then
    raise exception 'ต่อได้ครั้งละ 1 2 3 หรือ 4 ชั่วโมงเท่านั้น';
  end if;

  select t.due_at, t.user_id, t.ot_until into v_due, v_owner, v_ot
    from asset_txns t where t.id = p_txn_id and t.kind = 'out';

  if v_owner is null then
    raise exception 'ไม่พบใบเบิกนี้';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'ต่อเวลาได้เฉพาะคนที่เบิกเองเท่านั้น';
  end if;
  if v_due is null then
    raise exception 'ใบนี้ไม่มีกำหนดคืน จึงไม่ต้องต่อเวลา';
  end if;
  if v_ot is not null then
    raise exception 'ใบนี้ต่อเวลาไปแล้ว ถ้าต้องต่ออีกให้แจ้งหัวหน้า';
  end if;

  update asset_txns
     set ot_until = v_due + make_interval(hours => p_hours),
         ot_hours = p_hours,
         ot_at = now()
   where id = p_txn_id;

  return jsonb_build_object('ok', true, 'ot_until', v_due + make_interval(hours => p_hours));
end $$;

grant execute on function asset_ot_extend(uuid, integer) to authenticated;


/**
 * ใบที่ยังไม่คืนและขอ OT ไว้
 *
 * แยกเป็นฟังก์ชันของตัวเอง ไม่ได้ไปเพิ่มคอลัมน์ใน view asset_holdings
 * เพราะ create or replace view เพิ่มคอลัมน์กลางรายการไม่ได้
 * ต้องเขียน view ใหม่ทั้งก้อน ซึ่งเสี่ยงกับของที่หน้างานใช้อยู่ทุกวัน
 * ฝั่งหน้าจอเอาสองชุดมาต่อกันเองถูกกว่าเสี่ยงพัง
 */
create or replace function asset_ot_open()
returns table (txn_id uuid, ot_until timestamptz, ot_hours integer, due_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.ot_until, t.ot_hours, t.due_at
    from asset_txns t
   where t.kind = 'out'
     and t.ot_until is not null
     and exists (
       /* ยังถืออยู่จริง · ดูจาก assets.held_item_id เหมือนที่ view asset_holdings ใช้
          ไม่ได้ดูจากตารางรายการคืน เพราะของที่ยังไม่คืนคือของที่ยังผูกกับ held_item_id อยู่ */
       select 1 from assets a
         join asset_txn_items ai on ai.id = a.held_item_id
        where ai.txn_id = t.id
     );
$$;

grant execute on function asset_ot_open() to authenticated;

select
  (select count(*) from information_schema.columns
    where table_name = 'asset_txns' and column_name = 'ot_until')   as col,
  (select count(*) from pg_proc where proname like 'asset_ot%')     as fns;
