-- =====================================================================
-- BPL SUPPLY — ลบบัตรเบรคที่พิมพ์ผิดทิ้งได้
-- รันต่อจาก 085 · ปลอดภัยที่จะรันซ้ำ
--
-- ของเดิมปิดใช้งานได้อย่างเดียว ซึ่งถูกสำหรับบัตรที่เคยใช้งานจริง
-- แต่ไม่ถูกเลยสำหรับบัตรที่เพิ่งพิมพ์ผิดเมื่อสิบวินาทีก่อน
-- เพิ่มบัตรทีละยี่สิบใบแล้วพิมพ์ prefix ผิด จะเหลือขยะค้างในรายการตลอดไป
--
-- กฎการลบมีข้อเดียว **บัตรที่เคยถูกปล่อยแล้วลบไม่ได้**
-- เพราะประวัติอ้างถึงรหัสบัตรนั้นอยู่ ลบแล้วประวัติจะชี้ไปหาของที่ไม่มี
-- บัตรพวกนั้นใช้ปิดใช้งานแทน ซึ่งซ่อนจากทุกหน้าโดยไม่ทำลายอะไร
--
-- ฟังก์ชันไม่ล้มทั้งก้อนเมื่อมีใบลบไม่ได้ปนมา
-- ลบเท่าที่ลบได้แล้วบอกกลับว่าเหลือใบไหนและเพราะอะไร
-- เจ้าของระบบติ๊กมาสิบใบแล้วติดใบเดียว ไม่ควรต้องมานั่งไล่ติ๊กใหม่
-- =====================================================================

create or replace function break_card_delete(p_codes text[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_norm  text[];
  v_gone  integer := 0;
  v_kept  jsonb   := '[]'::jsonb;
  c       text;
begin
  perform break_admin_guard();

  if p_codes is null or array_length(p_codes, 1) is null then
    raise exception 'ยังไม่ได้เลือกบัตรที่จะลบ';
  end if;
  if array_length(p_codes, 1) > 200 then
    raise exception 'ลบได้ครั้งละไม่เกิน 200 ใบ';
  end if;

  select array_agg(break_norm_code(x)) into v_norm from unnest(p_codes) as x;

  -- บอกเหตุผลเป็นรายใบก่อน แล้วค่อยลบ
  -- รวบเป็น "ลบไม่ได้ 3 ใบ" เฉย ๆ จะทำให้เขาไม่รู้ว่าต้องไปทำอะไรกับใบไหน
  select coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'why', w.why)), '[]'::jsonb)
    into v_kept
    from break_cards c
    join lateral (
      select case
               when exists (select 1 from break_passes p
                             where p.card_code = c.code and p.closed_at is null)
                 then 'ยังไม่ได้รับกลับ'
               when exists (select 1 from break_passes p where p.card_code = c.code)
                 then 'เคยใช้งานแล้ว · ปิดใช้งานแทนได้'
               else null
             end as why
    ) w on w.why is not null
   where c.code = any(v_norm);

  delete from break_cards c
   where c.code = any(v_norm)
     and not exists (select 1 from break_passes p where p.card_code = c.code);

  get diagnostics v_gone = row_count;
  return jsonb_build_object('ok', true, 'deleted', v_gone, 'kept', v_kept);
end $$;

grant execute on function break_card_delete(text[]) to authenticated;


-- ---------------------------------------------------------------------
-- ของตั้งค่า — บอกด้วยว่าบัตรใบไหนเคยใช้แล้ว หน้าจอจะได้ซ่อนปุ่มลบให้ถูก
-- ---------------------------------------------------------------------
create or replace function break_settings() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform break_admin_guard();

  return jsonb_build_object(
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', g.code, 'name', g.name, 'max_open', g.max_open, 'active', g.active,
               'cards', (select count(*) from break_cards c where c.group_code = g.code),
               'users', coalesce((select jsonb_agg(u.user_id) from break_group_users u
                                   where u.group_code = g.code), '[]'::jsonb)
             ) order by g.code)
        from break_groups g), '[]'::jsonb),

    'cards', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', c.code, 'group_code', c.group_code, 'active', c.active, 'note', c.note,
               'busy', exists (select 1 from break_passes p
                                where p.card_code = c.code and p.closed_at is null),
               -- เคยถูกปล่อยแล้วหรือยัง · ใช้ตัดสินว่าลบได้ไหม
               'used', exists (select 1 from break_passes p where p.card_code = c.code)
             ) order by c.group_code, c.code)
        from break_cards c), '[]'::jsonb),

    'reasons', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', r.code, 'label', r.label,
               'default_minutes', r.default_minutes, 'sort', r.sort, 'active', r.active
             ) order by r.sort, r.code)
        from break_reasons r), '[]'::jsonb),

    'bans', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'start_min', b.start_min, 'end_min', b.end_min,
               'note', b.note, 'active', b.active
             ) order by b.start_min)
        from break_bans b where b.kind = 'daily'), '[]'::jsonb),

    'alert_subs', coalesce((
      select jsonb_agg(s.user_id) from break_alert_subs s), '[]'::jsonb),

    'ban_users', coalesce((
      select jsonb_agg(p.id) from profiles p where p.is_active and p.can_break_ban), '[]'::jsonb)
  );
end $$;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname = 'break_card_delete') as ฟังก์ชันลบบัตร,
  (select count(*) from break_cards)                                 as บัตรทั้งหมด,
  (select count(*) from break_cards c
    where not exists (select 1 from break_passes p where p.card_code = c.code)) as บัตรที่ลบได้ตอนนี้;
