-- ---------------------------------------------------------------------
-- 150 · ตัวเลือกแผนกและบัตรของหน้าประวัติเบรค
--
-- หน้าประวัติยาวขึ้นเรื่อย ๆ จนต้องแบ่งหน้าและมีตัวกรอง
-- ตัวเลือกในดรอปดาวน์ต้องมาจากของที่มีอยู่จริงในประวัติ ไม่ใช่รายชื่อบัตรทั้งระบบ
-- เพราะบัตรที่ไม่เคยถูกปล่อยเลย ขึ้นมาเป็นตัวเลือกที่เลือกแล้วว่างเปล่า
--
-- ไม่ใช้ break_settings ที่มีอยู่แล้ว เพราะอันนั้นเป็นของหน้าตั้งค่า
-- ซึ่งเปิดให้เฉพาะคนตั้งค่า ส่วนหน้าประวัติผู้ตรวจสอบก็เข้าได้
-- ---------------------------------------------------------------------

create or replace function break_history_filters()
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not my_can_audit() then jsonb_build_object('groups', '[]'::jsonb, 'cards', '[]'::jsonb)
  else jsonb_build_object(
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('code', g.code, 'name', g.name, 'n', g.n) order by g.code)
        from (
          select p.group_code as code,
                 max(coalesce(bg.name, p.group_code)) as name,
                 count(*)::int as n
            from break_passes p
            left join break_groups bg on bg.code = p.group_code
           group by p.group_code
        ) g
    ), '[]'::jsonb),
    'cards', coalesce((
      select jsonb_agg(jsonb_build_object('code', c.code, 'group_code', c.group_code, 'n', c.n) order by c.code)
        from (
          select p.card_code as code, max(p.group_code) as group_code, count(*)::int as n
            from break_passes p
           group by p.card_code
        ) c
    ), '[]'::jsonb)
  ) end;
$$;

grant execute on function break_history_filters() to authenticated;

select (select count(*) from pg_proc where proname = 'break_history_filters') as f;
