-- ---------------------------------------------------------------------
-- 152 · สถานะเบรคเดี๋ยวนี้ สำหรับหน้าแรกหลังบ้าน
--
-- หน้าแรกต้องตอบสามคำถามในแถบเดียว
--   ตอนนี้ใครเบรคเกินเวลาบ้าง
--   แผนกไหนกำลังเบรคอยู่ ใบไหน กี่คน
--   แต่ละแผนกเหลือสิทธิอีกเท่าไหร่
--
-- ไม่ใช้ break_settings ที่มีอยู่แล้ว เพราะอันนั้นกันด้วย break_admin_guard()
-- ซึ่งแคบกว่าคนที่เปิดหน้าแรกหลังบ้านได้ · ถ้าเรียกตัวนั้น แอดมินจะเจอ error
-- ทั้งหน้าเพียงเพราะอยากรู้ว่าตอนนี้ใครเบรคอยู่ ซึ่งเป็นข้อมูลที่เขาควรเห็นอยู่แล้ว
--
-- คืนมาทั้งก้อนเดียว ไม่ต้องให้หน้าจอยิงสามคำถาม
-- หน้านี้เปิดค้างทั้งกะและรีเฟรชบ่อย ทุกคำถามที่ตัดได้คือโควตาที่ประหยัดได้จริง
-- ---------------------------------------------------------------------

create or replace function break_now() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not (my_can_audit() or my_can_break_issue() or my_can_break_guard()) then
    return jsonb_build_object('groups', '[]'::jsonb, 'over', '[]'::jsonb);
  end if;

  select jsonb_build_object(
    'groups', coalesce((
      select jsonb_agg(x order by x->>'code')
        from (
          select jsonb_build_object(
                   'code', g.code,
                   'name', coalesce(g.name, g.code),
                   'max_open', g.max_open,
                   'max_people', g.max_people,
                   'open_cards', (select count(*) from break_passes p
                                   where p.group_code = g.code and p.closed_at is null),
                   'open_people', (select coalesce(sum(p.people), 0) from break_passes p
                                    where p.group_code = g.code and p.closed_at is null),
                   'over_cards', (select count(*) from break_passes p
                                   where p.group_code = g.code and p.closed_at is null
                                     and now() > p.due_at)
                 ) as x
            from break_groups g
           where g.active
        ) q
       where (x->>'open_cards')::int > 0
    ), '[]'::jsonb),

    /* ใบที่เลยเวลาแล้วและยังไม่ได้รับกลับ · เรียงจากเกินนานสุด เพราะต้องตามคนนั้นก่อน */
    'over', coalesce((
      select jsonb_agg(jsonb_build_object(
               'card', p.card_code,
               'grp', p.group_code,
               'people', p.people,
               'nickname', p.nickname,
               'issued_by', i.full_name,
               'due_at', p.due_at,
               'over_min', greatest(0, floor(extract(epoch from (now() - p.due_at)) / 60))::int
             ) order by p.due_at)
        from break_passes p
        left join profiles i on i.id = p.issued_by
       where p.closed_at is null and now() > p.due_at
    ), '[]'::jsonb)
  ) into v;

  return v;
end $$;

grant execute on function break_now() to authenticated;

select (select count(*) from pg_proc where proname = 'break_now') as f;
