-- ---------------------------------------------------------------------
-- 141 · เปิดสิทธิ์เครื่องเฉพาะคน ทีละหลายเครื่องหลายคน
--
-- ของเดิมเปิดได้ทีละคู่ เครื่องหนึ่ง + คนหนึ่ง
-- เวลาจริงคือ "เครื่องกลุ่มนี้ ให้กะดึกห้าคนนี้เห็น" ซึ่งต้องกด 25 รอบ
-- ซึ่งแปลว่าไม่มีใครตั้ง แล้วก็ไปจบที่การย้ายแผนกเครื่องทั้งก้อนแทน
--
-- ยิงทีเดียวด้วย cross join แล้วให้ on conflict จัดการคู่ที่มีอยู่แล้ว
-- กดซ้ำได้เสมอ ไม่เด้ง error — เหมือนตัวเดิมที่เปิดทีละคู่
--
-- นับแยกว่าเพิ่มใหม่กี่คู่ ทับของเดิมกี่คู่ เพื่อให้หน้าจอบอกคนกดได้ว่าเกิดอะไรจริง
-- ไม่ใช่ขึ้นแค่ "สำเร็จ" ซึ่งอ่านแล้วไม่รู้ว่าทำอะไรไป
-- ---------------------------------------------------------------------

create or replace function asset_grant_add_many(
  p_codes text[],
  p_users uuid[],
  p_note  text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_codes    text[];
  v_users    uuid[];
  v_in_codes integer;
  v_in_users integer;
  v_pairs    integer;
  v_updated  integer;
begin
  if my_role() <> 'admin' then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ตั้งสิทธิ์นี้ได้';
  end if;

  select count(distinct c) into v_in_codes from unnest(coalesce(p_codes, '{}')) c;
  select count(distinct u) into v_in_users from unnest(coalesce(p_users, '{}')) u;

  -- เก็บเฉพาะรหัสเครื่องที่มีจริง และคนที่ยังใช้งานอยู่ · ตัดซ้ำออกก่อน
  select array_agg(distinct c) into v_codes
    from unnest(coalesce(p_codes, '{}')) c
   where exists (select 1 from assets a where a.code = c);

  select array_agg(distinct u) into v_users
    from unnest(coalesce(p_users, '{}')) u
   where exists (select 1 from profiles p where p.id = u and p.is_active);

  if v_codes is null or v_users is null then
    raise exception 'ต้องเลือกอย่างน้อยหนึ่งเครื่องและหนึ่งคนที่มีอยู่จริง';
  end if;

  v_pairs := array_length(v_codes, 1) * array_length(v_users, 1);

  -- เพดานกันกดพลาดแล้วเปิดสิทธิ์ทั้งคลังให้ทั้งฮับในคลิกเดียว
  if v_pairs > 2000 then
    raise exception 'เลือกมากเกินไป % คู่ · ครั้งละไม่เกิน 2000 คู่', v_pairs;
  end if;

  select count(*) into v_updated
    from asset_user_grants g
   where g.asset_code = any(v_codes)
     and g.user_id = any(v_users);

  insert into asset_user_grants (asset_code, user_id, note, granted_by)
  select c, u, nullif(btrim(coalesce(p_note, '')), ''), auth.uid()
    from unnest(v_codes) c
   cross join unnest(v_users) u
  on conflict (asset_code, user_id) do update
    set note = excluded.note, granted_by = excluded.granted_by;

  return jsonb_build_object(
    'assets',        array_length(v_codes, 1),
    'people',        array_length(v_users, 1),
    'pairs',         v_pairs,
    'added',         v_pairs - v_updated,
    'updated',       v_updated,
    'skipped_codes', v_in_codes - array_length(v_codes, 1),
    'skipped_users', v_in_users - array_length(v_users, 1)
  );
end $$;

grant execute on function asset_grant_add_many(text[], uuid[], text) to authenticated;


/** เอาออกทีละหลายคู่ · คู่ที่ไม่มีอยู่แล้วก็ข้ามไปเฉย ๆ ไม่ใช่ error */
create or replace function asset_grant_remove_many(
  p_codes text[],
  p_users uuid[]
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if my_role() <> 'admin' then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ตั้งสิทธิ์นี้ได้';
  end if;

  delete from asset_user_grants
   where asset_code = any(coalesce(p_codes, '{}'))
     and user_id = any(coalesce(p_users, '{}'));

  get diagnostics v_n = row_count;
  return jsonb_build_object('removed', v_n);
end $$;

grant execute on function asset_grant_remove_many(text[], uuid[]) to authenticated;

select 'MARK|add_many=' || (select count(*) from pg_proc where proname = 'asset_grant_add_many')
  || '|rm_many=' || (select count(*) from pg_proc where proname = 'asset_grant_remove_many')
  || '|grants=' || (select count(*) from asset_user_grants)
  || '|END' as r;
