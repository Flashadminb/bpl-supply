-- ---------------------------------------------------------------------
-- 137 · ผู้ตรวจสอบจัดการบัตรเบรคได้ แต่ไม่แตะห้ามเบรคกับแจ้งเตือน
--
-- เจ้าของระบบสั่งว่า "ผู้ตรวจสอบเห็นการจัดการบัตรเบรค บัตรและสิทธิ์ทำได้
-- พิมพ์ทำได้ แต่ไม่เห็นหน้าแจ้งเตือน ห้ามเบรค"
--
-- เดิมทุกฟังก์ชันในหน้านี้เรียก break_admin_guard() ตัวเดียวกันหมด
-- ซึ่งยอมแค่ role = admin · แปลว่าแยกสองกลุ่มนี้ที่ฐานข้อมูลไม่ได้เลย
--
-- จึงเพิ่มด่านที่สองขึ้นมา แล้วย้ายเฉพาะงานบัตรไปใช้ด่านใหม่
--   break_card_guard()   บัตร แผนกบัตร คนในแผนก และการพิมพ์ — แอดมินกับผู้ตรวจสอบ
--   break_admin_guard()  ห้ามเบรค นาทีของเหตุผล และคนรับแจ้งเตือน — เจ้าของระบบ/ผู้ดูแลระบบ
--
-- ไม่พิมพ์ตัวฟังก์ชันใหม่ด้วยมือ · ดึงนิยามจริงจาก pg_get_functiondef
-- แล้วสลับชื่อด่านในข้อความนั้น เพื่อไม่ให้ตัวงานข้างในเพี้ยนไปจากของเดิม
-- ---------------------------------------------------------------------

create or replace function break_card_guard() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if my_role() <> 'admin' and not my_can_dispatch() then
    raise exception 'เฉพาะผู้ดูแลระบบและผู้ตรวจสอบเท่านั้นที่จัดการบัตรเบรคได้';
  end if;
end $$;

grant execute on function break_card_guard() to authenticated;

do $outer$
declare
  r   record;
  src text;
  n   integer := 0;
begin
  for r in
    select p.oid, p.proname
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.proname in (
         'break_settings',
         'break_cards_add',
         'break_card_save',
         'break_card_delete',
         'break_group_save',
         'break_group_delete',
         'break_group_user_set'
       )
  loop
    src := pg_get_functiondef(r.oid);
    if position('break_admin_guard()' in src) = 0 then
      raise exception 'ไม่เจอด่านเดิมใน % · หยุดก่อน ไม่แก้อะไรทั้งนั้น', r.proname;
    end if;
    execute replace(src, 'break_admin_guard()', 'break_card_guard()');
    n := n + 1;
  end loop;

  if n < 7 then
    raise exception 'เจอแค่ % ฟังก์ชัน ควรได้ 7', n;
  end if;
  raise notice 'ย้ายไปด่านบัตรแล้ว % ฟังก์ชัน', n;
end $outer$;

-- ตรวจผล — ฝั่งบัตรต้องไม่เหลือด่านเก่า และฝั่งห้ามเบรคต้องยังเป็นด่านเก่า
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('break_settings','break_cards_add','break_card_save',
                        'break_card_delete','break_group_save','break_group_delete',
                        'break_group_user_set')
      and position('break_card_guard()' in pg_get_functiondef(p.oid)) > 0) as "บัตร_ด่านใหม่",
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('break_settings','break_cards_add','break_card_save',
                        'break_card_delete','break_group_save','break_group_delete',
                        'break_group_user_set')
      and position('break_admin_guard()' in pg_get_functiondef(p.oid)) > 0) as "บัตร_ด่านเก่าค้าง",
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('break_ban_save','break_ban_delete','break_alert_sub_set',
                        'break_reason_save')
      and position('break_admin_guard()' in pg_get_functiondef(p.oid)) > 0) as "ห้ามเบรค_ด่านเก่า";
