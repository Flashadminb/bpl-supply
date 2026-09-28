-- =====================================================================
-- BPL SUPPLY — เก็บสถิติขนาดฐานข้อมูลรายวัน
-- รันต่อจาก 055 · ปลอดภัยที่จะรันซ้ำ
--
-- 055 คำนวณอัตราการโตด้วยวิธีที่ผิด คือเอาขนาดฐานข้อมูลทั้งก้อน
-- หารด้วยอายุของข้อมูลที่เก่าที่สุด
--
-- ปัญหาคือขนาดฐานข้อมูลส่วนใหญ่เป็นของที่มีมาตั้งแต่วันแรก
-- ทั้ง Postgres เอง ส่วนขยาย และระบบ auth ของ Supabase ซึ่งไม่โตตามการใช้งาน
-- พอเพิ่งล้างข้อมูลเทสไป อายุข้อมูลเหลือ 1 วัน สูตรเลยอ่านว่า
-- "โตวันละ 15.6 MB จะเต็มใน 31 วัน" ทั้งที่ความจริงโตวันละไม่กี่สิบ KB
--
-- ตัวเลขที่ผิดแบบน่าตกใจแย่กว่าไม่มีตัวเลข เพราะทำให้คนเลิกเชื่อทั้งหน้า
--
-- วิธีที่ถูกคือวัดของจริง จดขนาดไว้วันละครั้ง แล้วเทียบระหว่างวัน
-- ส่วนต่างที่ได้คือการโตจริง ไม่ปนกับฐานที่มีมาแต่แรก
-- ระหว่างที่ยังจดไม่ครบสัปดาห์ ให้บอกตรง ๆ ว่ายังบอกไม่ได้
-- =====================================================================

create table if not exists db_size_log (
  day   date   primary key,
  bytes bigint not null
);

alter table db_size_log enable row level security;

drop policy if exists read_db_size_log on db_size_log;
create policy read_db_size_log on db_size_log for select to authenticated
  using (my_can_proxy());


create or replace function system_health() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_db        bigint;
  v_photo_n   bigint;
  v_photo_b   bigint;
  v_push      bigint;
  v_mau       bigint;
  v_first     date;
  v_first_b   bigint;
  v_span      integer;
  v_per_day   bigint := null;
  v_days_left integer := null;
begin
  if not my_can_proxy() then
    raise exception 'ดูสถานะระบบได้เฉพาะแอดมินและผู้ตรวจสอบ';
  end if;

  v_db := pg_database_size(current_database());

  -- จดขนาดของวันนี้ไว้ เรียกกี่ครั้งก็ได้ เก็บแค่ค่าล่าสุดของวัน
  insert into db_size_log (day, bytes) values (current_date, v_db)
  on conflict (day) do update set bytes = excluded.bytes;

  -- เทียบกับวันที่เก่าที่สุดที่จดไว้ ต้องมีอย่างน้อย 7 วันถึงจะเชื่อได้
  select day, bytes into v_first, v_first_b
    from db_size_log order by day limit 1;

  v_span := current_date - v_first;

  if v_span >= 7 and v_db > v_first_b then
    v_per_day := (v_db - v_first_b) / v_span;
    if v_per_day > 0 then
      v_days_left := greatest((500 * 1024 * 1024 - v_db) / v_per_day, 0);
    end if;
  end if;

  select count(*), coalesce(sum(bytes), 0) into v_photo_n, v_photo_b
    from (
      select p.bytes
        from asset_txn_photos p
        join asset_txns t on t.id = p.txn_id
       where t.created_at > now() - interval '30 days'
      union all
      select bytes from requisition_photos where created_at > now() - interval '30 days'
      union all
      select bytes from return_photos      where created_at > now() - interval '30 days'
    ) x;

  select count(*) into v_push
    from notification_log where sent_at > now() - interval '30 days';

  select count(*) into v_mau
    from auth.users where last_sign_in_at > now() - interval '30 days';

  return jsonb_build_object(
    'measured_at', now(),

    'db', jsonb_build_object(
      'bytes', v_db,
      'limit_bytes', 500 * 1024 * 1024,
      -- null = ยังจดสถิติไม่ครบ 7 วัน หน้าจอต้องเขียนว่ายังบอกไม่ได้ ห้ามเดา
      'per_day_bytes', v_per_day,
      'days_left', v_days_left,
      'tracked_days', v_span
    ),

    'tables', (
      select jsonb_agg(jsonb_build_object('name', t, 'bytes', b, 'rows', r) order by b desc)
        from (
          select c.relname as t,
                 pg_total_relation_size(c.oid) as b,
                 coalesce(s.n_live_tup, 0) as r
            from pg_class c
            join pg_namespace ns on ns.oid = c.relnamespace
            left join pg_stat_user_tables s on s.relid = c.oid
           where ns.nspname = 'public' and c.relkind = 'r'
           order by pg_total_relation_size(c.oid) desc
           limit 6
        ) y
    ),

    -- คูณสอง เพราะรูปหนึ่งใบวิ่งผ่าน Edge Function สองรอบ
    -- ขามาตอนอัปขึ้น Drive และขากลับตอนแอดมินเปิดดู
    'egress', jsonb_build_object(
      'est_bytes', v_photo_b * 2,
      'limit_bytes', 5::bigint * 1024 * 1024 * 1024,
      'photo_count', v_photo_n,
      'photo_bytes', v_photo_b
    ),

    'edge', jsonb_build_object(
      'est_calls', v_photo_n * 2 + v_push,
      'limit_calls', 500000,
      'uploads', v_photo_n,
      'pushes', v_push
    ),

    'mau', jsonb_build_object(
      'used', v_mau,
      'limit', 50000,
      'active_profiles', (select count(*) from profiles where is_active)
    )
  );
end $$;

grant execute on function system_health() to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select jsonb_pretty(system_health() -> 'db') as ผลตรวจ_ส่วนฐานข้อมูล;
