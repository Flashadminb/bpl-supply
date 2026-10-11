-- ---------------------------------------------------------------------
-- 138 · บัตรเบรคแยกเป็นสามชั้น
--
-- เจ้าของระบบสั่งเพิ่มจาก 137 ว่า
--   "แอดมิน จัดการบัตรเบรคเหมือนผู้ตรวจสอบเลย แต่เพิ่มปรับแจ้งเตือนได้มา"
--
-- จึงกลายเป็นสามชั้น ไม่ใช่สองชั้นอย่างใน 137
--   break_card_guard()   บัตร แผนกบัตร คนในแผนก และการพิมพ์
--                        ผู้ดูแลระบบ · แอดมิน · ผู้ตรวจสอบ
--   break_alert_guard()  คนที่รับแจ้งเตือนเรื่องเบรค
--                        ผู้ดูแลระบบ · แอดมิน
--   break_admin_guard()  ห้ามเบรค และนาทีเริ่มต้นของแต่ละเหตุผล
--                        ผู้ดูแลระบบเท่านั้น · ไม่แตะของเดิม
--
-- ห้ามเบรคยังแคบสุดเพราะเป็นเครื่องมือคุมหัวหน้างานโดยตรง
-- และนาทีของเหตุผลคือตัวเลขที่ตัดสินว่าใบไหน "เกินเวลา" ในสถิติทุกใบ
-- ---------------------------------------------------------------------

create or replace function break_card_guard() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if my_role() not in ('admin', 'supervisor') and not my_can_dispatch() then
    raise exception 'บัญชีนี้จัดการบัตรเบรคไม่ได้';
  end if;
end $$;

create or replace function break_alert_guard() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if my_role() not in ('admin', 'supervisor') then
    raise exception 'เฉพาะผู้ดูแลระบบและแอดมินเท่านั้นที่ตั้งคนรับแจ้งเตือนเบรคได้';
  end if;
end $$;

grant execute on function break_card_guard() to authenticated;
grant execute on function break_alert_guard() to authenticated;

-- ย้าย break_alert_sub_set ไปด่านกลาง · ดึงนิยามจริงมาสลับชื่อด่าน
-- ไม่พิมพ์ตัวงานข้างในใหม่ด้วยมือ เพื่อไม่ให้เพี้ยนจากของเดิม
do $outer$
declare
  r record; src text; n integer := 0;
begin
  for r in
    select p.oid, p.proname from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'break_alert_sub_set'
  loop
    src := pg_get_functiondef(r.oid);
    if position('break_admin_guard()' in src) = 0 then
      raise exception 'ไม่เจอด่านเดิมใน %', r.proname;
    end if;
    execute replace(src, 'break_admin_guard()', 'break_alert_guard()');
    n := n + 1;
  end loop;
  if n <> 1 then raise exception 'ควรแก้ 1 ฟังก์ชัน แต่ได้ %', n; end if;
end $outer$;

-- ผลตอนรันจริง: card_new=7 · card_old=0 · alert=1 · ban_strict=3
select 'card_new=' ||
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('break_settings','break_cards_add','break_card_save',
        'break_card_delete','break_group_save','break_group_delete','break_group_user_set')
      and position('break_card_guard()' in pg_get_functiondef(p.oid)) > 0)
  || ' alert=' ||
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'break_alert_sub_set'
      and position('break_alert_guard()' in pg_get_functiondef(p.oid)) > 0)
  || ' ban_strict=' ||
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('break_ban_save','break_ban_delete','break_reason_save')
      and position('break_admin_guard()' in pg_get_functiondef(p.oid)) > 0) as ok;
