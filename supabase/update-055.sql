-- =====================================================================
-- BPL SUPPLY — สถานะระบบ ดูว่าใกล้เต็มแผนฟรีหรือยัง
-- รันต่อจาก 054 · ปลอดภัยที่จะรันซ้ำ
--
-- เจ้าของระบบต้องรู้ได้เองว่าเหลือที่เท่าไหร่ ไม่ต้องรอให้ระบบล่มก่อน
-- แล้วค่อยมาถาม
--
-- ตัวเลขแบ่งเป็นสองชั้น ต้องแยกให้ชัดว่าอันไหนเป็นอันไหน
--   วัดจริง    ขนาดฐานข้อมูล จำนวนแถว จำนวนคนที่ล็อกอิน — ถามจาก Postgres ตรง ๆ
--   ประมาณการ  egress กับจำนวนครั้งที่เรียก Edge Function
--
-- ทำไม egress ถึงได้แค่ประมาณ
--   Supabase นับ egress ที่ชั้นเครือข่าย ไม่ได้เก็บไว้ในฐานข้อมูลของเรา
--   เราจึงคำนวณย้อนจากขนาดรูปที่บันทึกไว้ในคอลัมน์ bytes
--   ซึ่งครอบคลุมส่วนที่กินเยอะสุดจริง แต่ไม่รวมพวก JSON ปลีกย่อย
--   ตัวเลขทางการยังต้องดูที่หน้า Usage ของ Supabase หน้าจอจึงลิงก์ไปให้ด้วย
-- =====================================================================

create or replace function system_health() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_db        bigint;
  v_photo_n   bigint;
  v_photo_b   bigint;
  v_push      bigint;
  v_mau       bigint;
  v_first     timestamptz;
  v_days      numeric;
begin
  if not my_can_proxy() then
    raise exception 'ดูสถานะระบบได้เฉพาะแอดมินและผู้ตรวจสอบ';
  end if;

  v_db := pg_database_size(current_database());

  -- รูปในรอบ 30 วัน — รวมทั้งสามทาง เบิก คืน และ asset
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

  -- คนที่ล็อกอินหรือต่ออายุโทเคนใน 30 วัน = นิยาม MAU ของ Supabase
  select count(*) into v_mau
    from auth.users where last_sign_in_at > now() - interval '30 days';

  -- อัตราการโตของฐานข้อมูล คิดจากอายุข้อมูลจริงที่มีอยู่
  select min(created_at) into v_first from requisitions;
  v_first := least(v_first, (select min(created_at) from asset_txns));
  v_days  := greatest(extract(epoch from (now() - coalesce(v_first, now() - interval '1 day'))) / 86400, 1);

  return jsonb_build_object(
    'measured_at', now(),

    'db', jsonb_build_object(
      'bytes', v_db,
      'limit_bytes', 500 * 1024 * 1024,
      'per_day_bytes', round(v_db / v_days),
      'days_of_data', round(v_days)
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
    ),

    'storage', jsonb_build_object(
      'note', 'รูปเก็บที่ Google Drive ไม่กินโควตา Supabase'
    )
  );
end $$;

grant execute on function system_health() to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select jsonb_pretty(system_health()) as ผลตรวจ;
