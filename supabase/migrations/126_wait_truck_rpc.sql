-- =====================================================================
-- BPL SUPPLY — รถรอลงงาน · คำสั่งที่หน้าจอเรียกใช้
-- รันต่อจาก 125 · ปลอดภัยที่จะรันซ้ำ
--
-- ตารางใน 125 ไม่มี policy insert/update/delete โดยตั้งใจ
-- ทุกการเขียนจึงต้องผ่านฟังก์ชันในไฟล์นี้ ซึ่งตรวจสิทธิ์เองทุกตัว
-- ถือ token ของคนมีสิทธิ์แล้วยิงตรงเข้าตาราง ก็ยังเขียนไม่ได้
-- =====================================================================


-- ---------------------------------------------------------------------
-- ① แปลงเวลาจากไฟล์ให้เป็นเวลาจริง
--
-- ไฟล์ของบริษัทเขียนเวลาไว้เปล่า ๆ แบบ 2026-10-08 09:15:00 ไม่มีโซนเวลา
-- ซึ่งเป็นเวลาไทย แต่ Postgres อ่านสตริงเปล่าเป็นเวลาของเซิร์ฟเวอร์ (UTC)
-- อ่านผิดทีเดียวนาฬิกาทั้งกระดานเพี้ยนไปเจ็ดชั่วโมง โดยที่หน้าจอยังดูปกติ
-- และไม่มีอะไรฟ้อง เพราะทุกคันเพี้ยนเท่ากันหมด
--
-- ฝั่งเว็บควรส่งมาพร้อมโซนเวลาอยู่แล้ว ตัวนี้เป็นตาข่ายรับไว้อีกชั้น
-- อ่านไม่ออกคืน null ไปให้ตัวนำเข้าตีตกเป็นแถวเสีย ดีกว่าเดาแล้วผิดเงียบ ๆ
-- ---------------------------------------------------------------------
create or replace function wait_truck_time(p_text text) returns timestamptz
language plpgsql stable set search_path = public as $$
declare v text := btrim(coalesce(p_text, ''));
begin
  if v = '' then
    return null;
  end if;

  -- มีโซนเวลาต่อท้ายแล้ว เชื่อตามนั้น
  if v ~ '(Z|z|[+-]\d{2}:?\d{2})$' then
    return v::timestamptz;
  end if;

  -- ไม่มีโซนเวลา = เวลาไทยเปล่า ๆ ตามไฟล์ต้นทาง
  return (replace(v, 'T', ' '))::timestamp at time zone 'Asia/Bangkok';
exception when others then
  return null;
end $$;

comment on function wait_truck_time(text) is
  'อ่านเวลาจากไฟล์นำเข้า · ไม่มีโซนเวลาถือเป็นเวลาไทย · อ่านไม่ออกคืน null';

grant execute on function wait_truck_time(text) to authenticated;


-- ---------------------------------------------------------------------
-- ② นำเข้าไฟล์ประจำชั่วโมง
--
-- หน้างานโหลดไฟล์เดิมซ้ำทุกชั่วโมง รถคันที่ยังไม่ได้ลงงานจึงติดมาทุกรอบ
-- ตัวกันซ้ำคือดัชนีใน 125 ที่ยอมให้บาร์โค้ดหนึ่งมีใบที่ยังไม่จบได้ใบเดียว
-- รอบที่สองของวันเดียวกันจึงเพิ่มเฉพาะคันใหม่ ไม่รีเซ็ตนาฬิกาของคันเดิม
-- ซึ่งเป็นหัวใจทั้งหมด — นาฬิกาที่ถูกรีเซ็ตทุกชั่วโมงคือนาฬิกาที่ไม่มีใครเกิน
--
-- แถวที่แยกประเภทรถไม่ออกไม่ถูกเดาให้ แต่ถูกส่งกลับไปให้คนเลือกเอง
-- เพราะเกณฑ์เวลามาจากประเภทรถ เดาประเภทผิด = ตัดสินทัน-ไม่ทันผิดทั้งคัน
--
-- ทั้งไฟล์ถูกนำเข้าในธุรกรรมเดียว ล้มกลางทางคือไม่เข้าเลยสักแถว
-- ไม่มีสภาพครึ่ง ๆ ที่ต้องมานั่งไล่ว่าเข้าไปถึงแถวไหนแล้ว
-- ---------------------------------------------------------------------
create or replace function wait_truck_import(p_rows jsonb, p_batch uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_batch uuid := coalesce(p_batch, gen_random_uuid());
  v_row   jsonb;
  v_code  text;
  v_type  text;
  v_when  timestamptz;
  v_kpi   integer;
  v_id    bigint;
  v_added integer := 0;
  v_skip  integer := 0;
  v_bad   jsonb := '[]'::jsonb;
begin
  if not my_can_wait_truck() then
    raise exception 'บัญชีนี้ยังใช้กระดานรถรอลงงานไม่ได้';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'ต้องส่งมาเป็นรายการแถว';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'ไฟล์เดียวเกิน 2000 แถว ตัดแบ่งก่อน';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_id   := null;
    v_kpi  := null;
    v_code := btrim(coalesce(v_row->>'barcode', ''));
    v_type := upper(btrim(coalesce(v_row->>'vehicle_type', '')));
    v_when := wait_truck_time(v_row->>'arrived_at');

    if v_code = '' then
      v_bad := v_bad || jsonb_build_object('barcode', '(ไม่มี)', 'why', 'ไม่มีบาร์โค้ดรถ');
      continue;
    end if;

    if v_when is null then
      v_bad := v_bad || jsonb_build_object('barcode', v_code, 'why', 'อ่านเวลารถถึงไม่ได้');
      continue;
    end if;

    select wait_minutes into v_kpi
      from wait_truck_kpi where vehicle_type = v_type and is_active;

    if v_kpi is null then
      v_bad := v_bad || jsonb_build_object('barcode', v_code, 'why',
        case when v_type = '' then 'ยังไม่ได้เลือกประเภทรถ'
             else 'ไม่มีเกณฑ์ของประเภท ' || v_type end);
      continue;
    end if;

    insert into wait_trucks (
      truck_barcode, arrived_at, from_station, plate, vehicle_type,
      route_name, carrier, driver_name, driver_phone, parcels,
      kpi_minutes, due_at, imported_by, import_batch)
    values (
      left(v_code, 60),
      v_when,
      nullif(btrim(coalesce(v_row->>'from_station',  '')), ''),
      nullif(btrim(coalesce(v_row->>'plate',         '')), ''),
      v_type,
      nullif(btrim(coalesce(v_row->>'route_name',    '')), ''),
      nullif(btrim(coalesce(v_row->>'carrier',       '')), ''),
      nullif(btrim(coalesce(v_row->>'driver_name',   '')), ''),
      nullif(btrim(coalesce(v_row->>'driver_phone',  '')), ''),
      nullif(regexp_replace(coalesce(v_row->>'parcels', ''), '[^0-9]', '', 'g'), '')::integer,
      v_kpi,
      v_when + make_interval(mins => v_kpi),
      auth.uid(),
      v_batch)
    on conflict do nothing
    returning id into v_id;

    if v_id is null then
      v_skip := v_skip + 1;     -- คันนี้รออยู่บนกระดานแล้ว นาฬิกาเดิมเดินต่อ
    else
      v_added := v_added + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true, 'batch', v_batch,
    'added', v_added, 'skipped', v_skip,
    'rejected', v_bad, 'rejected_n', jsonb_array_length(v_bad));
end $$;

comment on function wait_truck_import(jsonb, uuid) is
  'นำเข้าไฟล์รถรอลงงาน · คันที่ยังรออยู่แล้วข้าม ไม่รีเซ็ตนาฬิกา';

grant execute on function wait_truck_import(jsonb, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- ③ ถอนไฟล์ที่เพิ่งอัปผิด
--
-- ตรงนี้ลบจริง ต่างจากการยกเลิกรถใน 113 ที่เก็บแถวไว้ตลอด เพราะคนละเรื่อง
-- ยกเลิก = ตัดสินใจเรื่องรถคันจริง ต้องมีหลักฐานว่าใครตัดสินใจและเพราะอะไร
-- ถอนไฟล์ = อัปไฟล์ผิดไฟล์เมื่อครู่ รถพวกนี้ไม่เคยมีอยู่จริงบนกระดาน
-- เก็บไว้มีแต่จะทำให้สถิติมีรถผีปน
--
-- กันไว้สองชั้น ลบได้เฉพาะคันที่ยังไม่มีใครแตะ และเฉพาะภายในสองชั่วโมง
-- พ้นจากนั้นถือว่ากระดานนี้มีคนใช้งานจริงแล้ว ต้องยกเลิกทีละคันพร้อมเหตุผล
-- ---------------------------------------------------------------------
create or replace function wait_truck_undo_import(p_batch uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not my_can_wait_truck() then
    raise exception 'บัญชีนี้ยังใช้กระดานรถรอลงงานไม่ได้';
  end if;
  if p_batch is null then
    raise exception 'ไม่รู้ว่าจะถอนไฟล์ไหน';
  end if;

  delete from wait_trucks
   where import_batch = p_batch
     and done_at is null
     and cancelled_at is null
     and imported_at > now() - interval '2 hours';
  get diagnostics v_n = row_count;

  return jsonb_build_object('ok', true, 'removed', v_n);
end $$;

comment on function wait_truck_undo_import(uuid) is
  'ถอนไฟล์ที่เพิ่งอัป · เฉพาะคันที่ยังไม่มีใครแตะ และภายใน 2 ชั่วโมง';

grant execute on function wait_truck_undo_import(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- ④ ลงงานเสร็จ
--
-- ปุ่มเดียวจบ ไม่มีขั้นกำลังลงงาน เพราะเจ้าของระบบเคาะว่าปุ่มที่ต้องกดสองครั้ง
-- คือปุ่มที่หน้างานจะลืมกดครั้งแรก แล้วตัวเลขทั้งกระดานก็เชื่อไม่ได้
--
-- ทัน-ไม่ทัน ตัดสินจากนาฬิกาตอนกด ไม่ใช่ช่องให้ติ๊กเอง
-- ซึ่งคือเหตุผลทั้งหมดที่ย้ายออกจากไฟล์ Excel
-- ---------------------------------------------------------------------
create or replace function wait_truck_done(p_id bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_ok   boolean;
  v_late integer;
begin
  if not my_can_wait_truck() then
    raise exception 'บัญชีนี้ยังใช้กระดานรถรอลงงานไม่ได้';
  end if;

  update wait_trucks
     set done_at = now(), done_by = auth.uid()
   where id = p_id and done_at is null and cancelled_at is null
  returning truck_barcode,
            now() <= due_at,
            greatest(0, round(extract(epoch from (now() - due_at)) / 60))::int
    into v_code, v_ok, v_late;

  if v_code is null then
    raise exception 'ไม่พบรถคันนี้ หรือกดลงงานเสร็จไปแล้ว';
  end if;

  return jsonb_build_object('ok', true, 'barcode', v_code,
                            'on_time', v_ok, 'late_min', v_late);
end $$;

grant execute on function wait_truck_done(bigint) to authenticated;


-- ---------------------------------------------------------------------
-- ⑤ กดเสร็จผิดคัน · เอากลับขึ้นกระดาน
--
-- ไม่จำกัดเวลา เพราะกดผิดคันแล้วรู้ตัวตอนไหนก็ควรแก้ได้
-- แต่ถ้าบาร์โค้ดเดิมถูกอัปเข้ามาใหม่แล้ว จะมีรถสองคันรหัสเดียวกันบนกระดาน
-- ดัชนีกันซ้ำจะขวางไว้เอง ตรงนี้แค่แปลคำว่า duplicate key ให้เป็นภาษาคน
-- ---------------------------------------------------------------------
create or replace function wait_truck_undone(p_id bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not my_can_wait_truck() then
    raise exception 'บัญชีนี้ยังใช้กระดานรถรอลงงานไม่ได้';
  end if;

  update wait_trucks
     set done_at = null, done_by = null
   where id = p_id and done_at is not null and cancelled_at is null
  returning truck_barcode into v_code;

  if v_code is null then
    raise exception 'ไม่พบรถคันนี้ หรือยังไม่ได้กดลงงานเสร็จ';
  end if;

  return jsonb_build_object('ok', true, 'barcode', v_code);
exception when unique_violation then
  raise exception 'เอากลับขึ้นกระดานไม่ได้ เพราะบาร์โค้ดนี้ถูกอัปเข้ามาใหม่แล้ว';
end $$;

grant execute on function wait_truck_undone(bigint) to authenticated;


-- ---------------------------------------------------------------------
-- ⑥ ยกเลิก · ไม่ใช่ลบ
--
-- ของเดิมในไฟล์ Excel คือกดลบแถวทิ้ง แล้ววันที่มีคนถามว่าคันนั้นหายไปไหน
-- ก็ไม่มีอะไรให้ตอบ · บังคับใส่เหตุผลเหมือน truck_cancel ใน 113
-- เพราะปุ่มที่กดแล้วของหายโดยไม่ต้องอธิบาย คือปุ่มที่วันหนึ่งจะถูกใช้
-- ลบสิ่งที่ไม่อยากให้ใครเห็น
-- ---------------------------------------------------------------------
create or replace function wait_truck_cancel(p_id bigint, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_code   text;
begin
  if not my_can_wait_truck() then
    raise exception 'บัญชีนี้ยังใช้กระดานรถรอลงงานไม่ได้';
  end if;
  if v_reason = '' then
    raise exception 'ต้องใส่เหตุผลที่ยกเลิก';
  end if;

  update wait_trucks
     set cancelled_at  = now(),
         cancelled_by  = auth.uid(),
         cancel_reason = left(v_reason, 300)
   where id = p_id and cancelled_at is null
  returning truck_barcode into v_code;

  if v_code is null then
    raise exception 'ไม่พบรถคันนี้ หรือถูกยกเลิกไปแล้ว';
  end if;

  return jsonb_build_object('ok', true, 'barcode', v_code);
end $$;

grant execute on function wait_truck_cancel(bigint, text) to authenticated;


-- ---------------------------------------------------------------------
-- ⑦ ตัวเลขหัวกระดานกับจอทีวี
--
-- ใช้ truck_cycle_start() ตัวเดิมจาก 111 ไม่ได้ทำรอบใหม่ของตัวเอง
-- สองกระดานในฮับเดียวกันต้องตัดรอบพร้อมกันตอนตีสาม ไม่งั้นเช้าวันหนึ่ง
-- จะมีสองจอรายงานยอดคนละชุด แล้วไม่มีใครรู้ว่าควรเชื่ออันไหน
--
-- เฝ้าระวังใช้ 20 นาทีเท่ากับวิวใน 125 และเท่ากับเสียงเตือนขั้นแรกบนจอ
-- ตัวเลขเดียวกันบนสองจอ ต้องมาจากนิยามเดียวกันเสมอ
-- ---------------------------------------------------------------------
create or replace function wait_truck_counts()
returns jsonb
language sql stable security definer set search_path = public as $$
  with c as (select truck_cycle_start() as since),
  open_now as (
    select * from wait_trucks where done_at is null and cancelled_at is null
  )
  select jsonb_build_object(
    'waiting',     (select count(*) from open_now),
    'overdue',     (select count(*) from open_now where now() > due_at),
    'warn',        (select count(*) from open_now
                     where now() <= due_at and now() > due_at - interval '20 minutes'),
    'parcels',     (select coalesce(sum(parcels), 0) from open_now),
    'carried',     (select count(*) from open_now, c where arrived_at < c.since),
    'done',        (select count(*) from wait_trucks t, c
                     where t.cancelled_at is null and t.done_at >= c.since),
    'on_time',     (select count(*) from wait_trucks t, c
                     where t.cancelled_at is null and t.done_at >= c.since
                       and t.done_at <= t.due_at),
    'cycle_start', (select since from c)
  )
  from c
  where my_can_wait_truck();
$$;

grant execute on function wait_truck_counts() to authenticated;


-- ---------------------------------------------------------------------
-- ⑧ สถิติหลังบ้าน
--
-- นับเฉพาะคันที่จบแล้วและไม่ได้ยกเลิก · คันที่ยังค้างอยู่ยังไม่มีผลแพ้ชนะ
-- เอาไปรวมตอนนี้คือตัดสินก่อนเวลา แล้วตัวเลขจะขยับเองทีหลังโดยไม่มีใครแตะ
--
-- แบ่งวันตามเวลาไทย ไม่ใช่ตาม UTC ไม่งั้นกะดึกจะถูกนับเป็นของวันถัดไป
-- ---------------------------------------------------------------------
create or replace function wait_truck_stats(p_days integer default 7)
returns jsonb
language sql stable security definer set search_path = public as $$
  with win as (
    select greatest(1, least(coalesce(p_days, 7), 180)) as d
  ),
  base as (
    select
      t.vehicle_type,
      t.from_station,
      t.parcels,
      (t.arrived_at at time zone 'Asia/Bangkok')::date                        as day_th,
      (t.done_at <= t.due_at)                                                 as on_time,
      round(extract(epoch from (t.done_at - t.arrived_at)) / 60)::int         as wait_min,
      greatest(0, round(extract(epoch from (t.done_at - t.due_at)) / 60))::int as over_min
    from wait_trucks t, win
    where t.done_at is not null
      and t.cancelled_at is null
      and t.arrived_at >= truck_cycle_start() - make_interval(days => win.d - 1)
  )
  select jsonb_build_object(
    'days_back', (select d from win),
    'total',     (select count(*) from base),
    'on_time',   (select count(*) from base where on_time),
    'parcels',   (select coalesce(sum(parcels), 0) from base),
    'avg_wait',  (select coalesce(round(avg(wait_min)), 0)::int from base),
    'worst',     (select coalesce(max(over_min), 0) from base),

    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day',      day_th,
               'total',    n,
               'on_time',  ok,
               'avg_wait', avg_w) order by day_th)
        from (select day_th, count(*) as n, count(*) filter (where on_time) as ok,
                     coalesce(round(avg(wait_min)), 0)::int as avg_w
                from base group by day_th) q), '[]'::jsonb),

    'by_type', coalesce((
      select jsonb_agg(jsonb_build_object(
               'vehicle_type', vehicle_type,
               'total',        n,
               'on_time',      ok,
               'avg_wait',     avg_w,
               'worst',        worst_m) order by n desc)
        from (select vehicle_type, count(*) as n, count(*) filter (where on_time) as ok,
                     coalesce(round(avg(wait_min)), 0)::int as avg_w,
                     coalesce(max(over_min), 0) as worst_m
                from base group by vehicle_type) q), '[]'::jsonb),

    'by_station', coalesce((
      select jsonb_agg(jsonb_build_object(
               'from_station', from_station,
               'total',        n,
               'on_time',      ok,
               'avg_wait',     avg_w) order by n desc)
        from (select from_station, count(*) as n, count(*) filter (where on_time) as ok,
                     coalesce(round(avg(wait_min)), 0)::int as avg_w
                from base where from_station is not null
               group by from_station order by count(*) desc limit 20) q), '[]'::jsonb)
  )
  where my_can_wait_truck();
$$;

comment on function wait_truck_stats(integer) is
  'สถิติรถรอลงงานย้อนหลัง N วัน · นับเฉพาะคันที่จบแล้วและไม่ได้ยกเลิก';

grant execute on function wait_truck_stats(integer) to authenticated;


-- ---------------------------------------------------------------------
-- ⑨ ล้างของเก่า · ต่อเข้างานกวาดกลางคืนที่มีอยู่แล้ว
--
-- 400 วันเท่ากับใบเบิก เพื่อให้เทียบปีต่อปีได้เต็มปีก่อนของจะหายไป
-- เขียน nightly_cleanup ทับทั้งตัวเพราะ plpgsql แก้ทีละบรรทัดไม่ได้
-- สามบรรทัดเดิมยกมาครบ ที่เพิ่มคือบรรทัดเดียว
-- ---------------------------------------------------------------------
create or replace function prune_wait_trucks(p_days integer default 400)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  delete from wait_trucks
   where arrived_at < now() - make_interval(days => p_days)
     and (done_at is not null or cancelled_at is not null);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

comment on function prune_wait_trucks(integer) is
  'ลบรถรอลงงานที่จบแล้วและเก่ากว่า N วัน · คันที่ยังค้างไม่ถูกแตะ';

revoke all on function prune_wait_trucks(integer) from public;
grant execute on function prune_wait_trucks(integer) to service_role;


create or replace function nightly_cleanup()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sync integer;
  v_req  integer;
  v_note integer;
  v_wait integer;
begin
  v_sync := prune_sync_log(60);
  v_req  := prune_old_requisitions(400);
  v_note := prune_notification_log(90);
  v_wait := prune_wait_trucks(400);
  return jsonb_build_object('sync_log', v_sync, 'requisitions', v_req,
                            'notification_log', v_note, 'wait_trucks', v_wait);
end $$;

grant execute on function nightly_cleanup() to service_role;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname in (
     'wait_truck_time', 'wait_truck_import', 'wait_truck_undo_import',
     'wait_truck_done', 'wait_truck_undone', 'wait_truck_cancel',
     'wait_truck_counts', 'wait_truck_stats', 'prune_wait_trucks'))        as ฟังก์ชันครบเก้าตัว,
  (select count(*) from pg_proc where proname = 'nightly_cleanup'
     and prosrc like '%prune_wait_trucks%')                                as ต่อเข้างานกวาดแล้ว,
  to_char(wait_truck_time('2026-10-08 09:15:00') at time zone 'Asia/Bangkok',
          'DD/MM HH24:MI')                                                 as อ่านเวลาเปล่าเป็นเวลาไทย,
  (wait_truck_time('ขยะ') is null)                                         as อ่านขยะแล้วคืนว่าง,
  wait_truck_counts()                                                      as ตัวเลขตอนนี้;
