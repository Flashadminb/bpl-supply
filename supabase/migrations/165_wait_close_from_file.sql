-- =====================================================================
-- BPL SUPPLY — รถรอลงงาน · ปิดงานจากไฟล์ ไม่ต้องรอให้มีคนกดทัน
-- รันต่อจาก 164 · ปลอดภัยที่จะรันซ้ำ
--
-- ── ปัญหาที่วัดได้จริง (21 วันก่อนวันที่ 13 ต.ค. 2569) ──
--   ปิดแบบทัน        20 คัน
--   ปิดแบบไม่ทัน    443 คัน
--   กดช้ากว่ากำหนด ค่ากลาง 356 นาที · สิบเปอร์เซ็นต์ที่แย่สุด 860 นาที
--   กระดานตอนนั้น ค้าง 59 คัน เลยเวลาไปแล้ว 45 คัน
--
-- ทันแค่ 4% ไม่ได้แปลว่าฮับทำงานแย่ขนาดนั้น แต่แปลว่าปุ่มไม่ถูกกด
-- ซึ่งคือปัญหาเดียวกับไฟล์ Excel ตัวเก่าที่ต้องติ๊กมือ และเป็นเหตุผลทั้งหมด
-- ที่ย้ายมาทำเป็นเว็บตั้งแต่แรก
--
-- ── ทำไมเชื่อไฟล์ได้ ──
-- ไฟล์ต้นทางชื่อ 未卸车明细 แปลว่า "รายการรถที่ยังไม่ได้ลงงาน"
-- รถหายจากไฟล์ = ระบบบริษัทบอกเองว่าลงเสร็จแล้ว
-- เป็นแหล่งข้อมูลที่ตรงกว่าคนกดปุ่ม เพราะไม่มีใครต้องจำอะไร
--
-- ── แต่ไฟล์ไม่ได้บอกว่าเสร็จกี่โมง ──
-- ไฟล์บอกได้แค่ว่า "ตอนอัปรอบนี้มันไม่อยู่แล้ว"
-- ความจริงอยู่ที่ไหนสักแห่งระหว่างอัปรอบก่อนกับอัปรอบนี้
-- จึงเก็บเป็นช่วงเวลา ไม่ใช่จุดเวลา แล้วตัดสินเท่าที่รู้จริง
--
--   ครบกำหนดหลังเวลาอัปรอบนี้          ทันแน่นอน      done_ontime
--   ครบกำหนดก่อนเวลาอัปรอบก่อน         ไม่ทันแน่นอน    done_late
--   ครบกำหนดอยู่ระหว่างสองรอบอัป        ไม่ชัด          done_unsure
--
-- ยิ่งอัปถี่ ช่องไม่ชัดยิ่งแคบ · ค่ากลางของระยะห่างการอัปตอนนี้คือ 67 นาที
-- ถ้าอัปทุกครึ่งชั่วโมง ช่องไม่ชัดจะเหลือครึ่งชั่วโมงและตัวเลขจะใช้อ้างอิงได้จริง
--
-- ไม่เอา done_unsure ไปรวมกับทันหรือไม่ทัน เพราะจุดทั้งหมดของกระดานนี้
-- คือตัวเลขที่เชื่อได้ · เดาแล้วใส่ลงช่องใดช่องหนึ่งคือกลับไปเป็นไฟล์ Excel อีกรอบ
--
-- ── ปิดผิดแล้วแก้เอง ──
-- เจ้าของระบบสังเกตเองว่า ถ้าปิดผิดแล้วรถยังจอดอยู่จริง
-- ไฟล์รอบหน้าก็ยังมีรถคันนั้น แล้วมันจะกลับขึ้นกระดานเอง · ถูกต้อง
-- ไฟล์นี้ทำให้มันกลับมาแบบ "แถวเดิม" ไม่ใช่แถวใหม่ซ้ำกัน
-- เพื่อไม่ให้เหลือประวัติปิดปลอมค้างอยู่ในสถิติ
-- =====================================================================

-- ---------------------------------------------------------------------
-- ① ช่องใหม่สามช่อง
--
-- done_src   null = คนกดเอง · 'file' = หายจากไฟล์
--            คนกดเองยังชนะเสมอ เพราะเวลานั้นแม่นกว่าเวลาอัปไฟล์
-- done_from  ขอบล่างของช่วงที่เสร็จ คือเวลาอัปรอบก่อนหน้า
--            ว่างแปลว่าไม่มีรอบก่อน จึงบอกขอบล่างไม่ได้
-- done_batch รอบอัปที่ปิดให้ · ไว้ถอนคืนตอนอัปผิดไฟล์
-- ---------------------------------------------------------------------
alter table wait_trucks add column if not exists done_src   text;
alter table wait_trucks add column if not exists done_from  timestamptz;
alter table wait_trucks add column if not exists done_batch uuid;

comment on column wait_trucks.done_src is
  'ใครปิด · ว่าง = คนกดเอง, file = หายจากไฟล์ที่อัปเข้ามา';
comment on column wait_trucks.done_from is
  'ขอบล่างของช่วงเวลาที่ลงงานเสร็จ · เวลาอัปรอบก่อนหน้า ใช้เฉพาะตอน done_src = file';

create index if not exists wait_trucks_code_idx on wait_trucks (truck_barcode, arrived_at);


-- ---------------------------------------------------------------------
-- ② วิว · เพิ่มสองช่องและสถานะที่สาม
--
-- ยกของเดิมมาครบทุกบรรทัด ที่เพิ่มคือ done_src, done_from และกิ่ง done_unsure
--
-- ทิ้งแล้วสร้างใหม่เหมือนไฟล์ 128 ไม่ใช่ create or replace
-- เพราะ replace แทรกคอลัมน์กลางวิวไม่ได้ · และ security_invoker ต้องติดมาด้วย
-- ถ้าลืม วิวจะรันในสิทธิ์เจ้าของแล้วข้าม RLS ทั้งตารางโดยดูเหมือนทำงานปกติ
-- ---------------------------------------------------------------------
drop view if exists wait_truck_rows;
create view wait_truck_rows
with (security_invoker = true) as
select
  t.id,
  t.truck_barcode,
  t.arrived_at,
  t.from_station,
  t.plate,
  t.vehicle_type,
  t.route_name,
  t.carrier,
  t.driver_name,
  t.driver_phone,
  t.parcels,
  coalesce(t.parcels_total, t.parcels)                                    as parcels_all,
  t.parcels_do,
  case when t.parcels_do is null then null
       else greatest(0, coalesce(t.parcels_total, t.parcels, 0) - t.parcels_do) end as parcels_nondo,
  t.kpi_minutes,
  t.due_at,
  t.done_at,
  dp.full_name                                                            as done_by_name,
  t.cancelled_at,
  cp.full_name                                                            as cancelled_by_name,
  t.cancel_reason,
  t.imported_at,
  ip.full_name                                                            as imported_by_name,
  round(extract(epoch from (t.due_at - coalesce(t.done_at, now()))))::bigint   as left_sec,
  round(extract(epoch from (coalesce(t.done_at, now()) - t.arrived_at)))::bigint as waited_sec,
  case
    when t.cancelled_at is not null then 'cancelled'
    /* ปิดจากไฟล์ · ตัดสินจากช่วงเวลา ไม่ใช่จุดเวลา */
    when t.done_at is not null and t.done_src = 'file' then
      case
        when t.due_at >= t.done_at                                    then 'done_ontime'
        when t.done_from is not null and t.due_at < t.done_from       then 'done_late'
        else 'done_unsure'
      end
    /* คนกดเอง · เวลาตอนกดคือเวลาจริง ตัดสินตรง ๆ ได้ */
    when t.done_at is not null and t.done_at <= t.due_at then 'done_ontime'
    when t.done_at is not null then 'done_late'
    when now() > t.due_at then 'overdue'
    when now() > t.due_at - interval '20 minutes' then 'warn'
    else 'waiting'
  end                                                                     as state,
  /* ต่อท้ายสุด ของเดิมอยู่ตำแหน่งเดิมทุกช่อง · อะไรที่อ่านด้วยเลขคอลัมน์จึงไม่เพี้ยน */
  t.done_src,
  t.done_from
from wait_trucks t
left join profiles dp on dp.id = t.done_by
left join profiles cp on cp.id = t.cancelled_by
left join profiles ip on ip.id = t.imported_by;

grant select on wait_truck_rows to authenticated;


-- ---------------------------------------------------------------------
-- ③ นำเข้า · เขียนทับทั้งตัว ของเดิมยกมาครบ
--
-- เพิ่มสามเรื่อง
--   ก. เจอบาร์โค้ดเดิมที่ยังเปิดอยู่ → อัปเดตช่องที่เปลี่ยนได้ ไม่ข้ามทิ้งแบบเดิม
--      ของเดิมเป็น on conflict do nothing แปลว่าถ้าไฟล์รอบใหม่แก้จำนวนพัสดุ
--      แก้ทะเบียน แก้ชื่อคนขับ กระดานจะไม่มีวันรู้
--      แต่ไม่แตะ arrived_at due_at kpi_minutes เพราะย้ายเส้นชัยย้อนหลัง
--      คือทำให้สถิติเชื่อไม่ได้อีกทางหนึ่ง
--   ข. เจอบาร์โค้ดที่เคยถูกปิดจากไฟล์ และเวลารถถึงตรงกันเป๊ะ → คืนขึ้นกระดาน
--      แปลว่าเราปิดผิด รถยังจอดอยู่ · คืนแถวเดิม ไม่สร้างแถวใหม่
--      เทียบเวลารถถึงด้วย เพราะบาร์โค้ดเดิมที่มากับเวลาใหม่คือเที่ยวใหม่จริง ๆ
--   ค. คันที่เปิดอยู่แต่ไม่มีในไฟล์ → ปิดให้ โดยติดป้ายว่าปิดจากไฟล์
--
-- กันพลาดสี่ชั้น
--   ไฟล์ที่อ่านไม่ได้สักแถว จะไม่ปิดอะไรเลย · ไฟล์เสียต้องไม่ล้างกระดาน
--   ปิดเฉพาะคันที่รถถึงก่อนคันที่ใหม่ที่สุดในไฟล์ · อัปไฟล์เก่าย้อนหลัง
--     จะไม่ไปปิดรถที่เพิ่งเข้ามาหลังไฟล์นั้นถูกสร้าง
--   ไม่แตะคันที่คนกดปิดเองหรือยกเลิกไปแล้ว
--   ถอนคืนได้ทั้งรอบด้วย wait_truck_undo_import
-- ---------------------------------------------------------------------
/* ลายเซ็นเดิมสองพารามิเตอร์ต้องทิ้งก่อน · ไม่งั้นได้ฟังก์ชันสองตัวซ้อนกัน
   แล้วการเรียกแบบสองอาร์กิวเมนต์จะกำกวมจนฐานข้อมูลปฏิเสธทั้งคู่ */
drop function if exists wait_truck_import(jsonb, uuid);

create or replace function wait_truck_import(
  p_rows          jsonb,
  p_batch         uuid    default null,
  p_close_missing boolean default true
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_batch   uuid := coalesce(p_batch, gen_random_uuid());
  v_row     jsonb;
  v_code    text;
  v_type    text;
  v_when    timestamptz;
  v_kpi     integer;
  v_id      bigint;
  v_added   integer := 0;
  v_upd     integer := 0;
  v_back    integer := 0;
  v_bad     jsonb := '[]'::jsonb;
  v_codes   text[] := array[]::text[];
  v_newest  timestamptz;
  v_prev    timestamptz;
  v_closed  jsonb := '[]'::jsonb;
  v_now     timestamptz := now();
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

  /* เวลาอัปรอบก่อนหน้า · ขอบล่างของช่วงที่รถที่หายไปน่าจะลงเสร็จ
     ต้องอ่านก่อนเขียนอะไรลงไป ไม่งั้นจะได้เวลาของรอบตัวเองกลับมา */
  select max(imported_at) into v_prev from wait_trucks;

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

    v_code   := left(v_code, 60);
    v_codes  := v_codes || v_code;
    v_newest := greatest(coalesce(v_newest, v_when), v_when);

    /* ก. ยังเปิดอยู่ → อัปเดตเฉพาะช่องที่เปลี่ยนได้ */
    update wait_trucks set
      from_station  = coalesce(nullif(btrim(coalesce(v_row->>'from_station', '')), ''), from_station),
      plate         = coalesce(nullif(btrim(coalesce(v_row->>'plate',        '')), ''), plate),
      route_name    = coalesce(nullif(btrim(coalesce(v_row->>'route_name',   '')), ''), route_name),
      carrier       = coalesce(nullif(btrim(coalesce(v_row->>'carrier',      '')), ''), carrier),
      driver_name   = coalesce(nullif(btrim(coalesce(v_row->>'driver_name',  '')), ''), driver_name),
      driver_phone  = coalesce(nullif(btrim(coalesce(v_row->>'driver_phone', '')), ''), driver_phone),
      parcels       = coalesce(nullif(regexp_replace(coalesce(v_row->>'parcels',       ''), '[^0-9]', '', 'g'), '')::integer, parcels),
      parcels_total = coalesce(nullif(regexp_replace(coalesce(v_row->>'parcels_total', ''), '[^0-9]', '', 'g'), '')::integer, parcels_total),
      parcels_do    = coalesce(nullif(regexp_replace(coalesce(v_row->>'parcels_do',    ''), '[^0-9]', '', 'g'), '')::integer, parcels_do)
     where truck_barcode = v_code
       and done_at is null
       and cancelled_at is null
    returning id into v_id;

    if v_id is not null then
      v_upd := v_upd + 1;
      continue;
    end if;

    /* ข. เคยถูกปิดจากไฟล์ แต่ยังโผล่ในไฟล์รอบนี้ แปลว่าปิดผิด → คืนขึ้นกระดาน
       เทียบเวลารถถึงด้วย บาร์โค้ดเดิมกับเวลาใหม่คือเที่ยวใหม่ ต้องเป็นแถวใหม่ */
    update wait_trucks set
      done_at    = null,
      done_by    = null,
      done_src   = null,
      done_from  = null,
      done_batch = null
     where truck_barcode = v_code
       and arrived_at = v_when
       and cancelled_at is null
       and done_src = 'file'
    returning id into v_id;

    if v_id is not null then
      v_back := v_back + 1;
      continue;
    end if;

    /* ค. ของใหม่จริง */
    insert into wait_trucks (
      truck_barcode, arrived_at, from_station, plate, vehicle_type,
      route_name, carrier, driver_name, driver_phone,
      parcels, parcels_total, parcels_do,
      kpi_minutes, due_at, imported_by, import_batch)
    values (
      v_code,
      v_when,
      nullif(btrim(coalesce(v_row->>'from_station',  '')), ''),
      nullif(btrim(coalesce(v_row->>'plate',         '')), ''),
      v_type,
      nullif(btrim(coalesce(v_row->>'route_name',    '')), ''),
      nullif(btrim(coalesce(v_row->>'carrier',       '')), ''),
      nullif(btrim(coalesce(v_row->>'driver_name',   '')), ''),
      nullif(btrim(coalesce(v_row->>'driver_phone',  '')), ''),
      nullif(regexp_replace(coalesce(v_row->>'parcels',       ''), '[^0-9]', '', 'g'), '')::integer,
      nullif(regexp_replace(coalesce(v_row->>'parcels_total', ''), '[^0-9]', '', 'g'), '')::integer,
      nullif(regexp_replace(coalesce(v_row->>'parcels_do',    ''), '[^0-9]', '', 'g'), '')::integer,
      v_kpi,
      v_when + make_interval(mins => v_kpi),
      auth.uid(),
      v_batch)
    on conflict do nothing
    returning id into v_id;

    if v_id is null then
      /* ชนกับแถวที่เพิ่งใส่ไปในไฟล์เดียวกัน · บรรทัดซ้ำในไฟล์ ไม่ใช่ของใหม่ */
      null;
    else
      v_added := v_added + 1;
    end if;
  end loop;

  /* ---------------------------------------------------------------
     ง. ปิดคันที่ไม่มีในไฟล์
     ไฟล์ที่อ่านไม่ได้สักแถว ไม่ปิดอะไรเลย · ไฟล์เสียต้องไม่ล้างกระดาน
     --------------------------------------------------------------- */
  if p_close_missing and array_length(v_codes, 1) > 0 then
    with gone as (
      update wait_trucks t set
        done_at    = v_now,
        done_by    = null,
        done_src   = 'file',
        done_from  = v_prev,
        done_batch = v_batch
       where t.done_at is null
         and t.cancelled_at is null
         and not (t.truck_barcode = any (v_codes))
         /* รถที่ถึงหลังไฟล์ถูกสร้าง ย่อมไม่มีในไฟล์ ไม่ใช่เพราะลงเสร็จ */
         and t.arrived_at <= v_newest
      returning t.id, t.truck_barcode, t.plate, t.vehicle_type, t.arrived_at, t.due_at
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', id, 'barcode', truck_barcode, 'plate', plate,
             'vehicle_type', vehicle_type, 'arrived_at', arrived_at,
             'late_min', greatest(0, round(extract(epoch from (v_now - due_at)) / 60))::int,
             'sure', case when due_at >= v_now then 'ontime'
                          when v_prev is not null and due_at < v_prev then 'late'
                          else 'unsure' end
           ) order by arrived_at), '[]'::jsonb)
      into v_closed
      from gone;
  end if;

  return jsonb_build_object(
    'ok', true, 'batch', v_batch,
    'added', v_added,
    'updated', v_upd,
    'reopened', v_back,
    /* ชื่อเดิมของช่องนี้คือ skipped · หน้าเว็บรุ่นเก่ายังอ่านช่องนี้อยู่
       ตอนนี้ของที่ "ข้าม" คือของที่ถูกอัปเดตแทน จึงส่งเลขเดียวกันไปทั้งสองชื่อ */
    'skipped', v_upd,
    'closed', v_closed,
    'closed_n', jsonb_array_length(v_closed),
    'prev_import', v_prev,
    'rejected', v_bad, 'rejected_n', jsonb_array_length(v_bad));
end $$;

comment on function wait_truck_import(jsonb, uuid, boolean) is
  'นำเข้าไฟล์รถรอลงงาน · อัปเดตของเดิม คืนคันที่ปิดผิด และปิดคันที่หายจากไฟล์';

grant execute on function wait_truck_import(jsonb, uuid, boolean) to authenticated;


-- ---------------------------------------------------------------------
-- ④ ถอนไฟล์ · ต้องคืนคันที่รอบนั้นปิดให้ด้วย
--
-- ของเดิมลบเฉพาะแถวที่รอบนั้นสร้าง · ตอนนี้รอบหนึ่งทำสามอย่าง
-- ถ้าถอนแค่แถวที่สร้าง คันที่ถูกปิดไปจะค้างปิดอยู่อย่างนั้นโดยไม่มีใครรู้
-- ซึ่งแย่กว่าไม่มีปุ่มถอนเลย เพราะคนกดถอนจะเชื่อว่าทุกอย่างกลับแล้ว
-- ---------------------------------------------------------------------
create or replace function wait_truck_undo_import(p_batch uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_n    integer;
  v_back integer;
begin
  if not my_can_wait_truck() then
    raise exception 'บัญชีนี้ยังใช้กระดานรถรอลงงานไม่ได้';
  end if;
  if p_batch is null then
    raise exception 'ไม่รู้ว่าจะถอนไฟล์ไหน';
  end if;

  /* คืนคันที่รอบนี้ปิดให้ · เฉพาะที่ยังไม่มีใครมากดอะไรทับ */
  update wait_trucks set
    done_at = null, done_by = null, done_src = null, done_from = null, done_batch = null
   where done_batch = p_batch
     and done_src = 'file'
     and cancelled_at is null
     and done_at > now() - interval '2 hours';
  get diagnostics v_back = row_count;

  delete from wait_trucks
   where import_batch = p_batch
     and done_at is null
     and cancelled_at is null
     and imported_at > now() - interval '2 hours';
  get diagnostics v_n = row_count;

  return jsonb_build_object('ok', true, 'removed', v_n, 'reopened', v_back);
end $$;

comment on function wait_truck_undo_import(uuid) is
  'ถอนไฟล์ที่เพิ่งอัป · ลบคันที่รอบนั้นสร้าง และคืนคันที่รอบนั้นปิดให้';

grant execute on function wait_truck_undo_import(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- ⑤ ตัวเลขหัวจอ · เพิ่มช่อง "ไม่ชัด" ไม่ไปรวมกับทันหรือไม่ทัน
-- ---------------------------------------------------------------------
create or replace function wait_truck_counts()
returns jsonb
language sql stable security definer set search_path = public as $$
  with c as (select truck_cycle_start() as since),
  open_now as (
    select * from wait_truck_rows where done_at is null and cancelled_at is null
  ),
  fin as (
    select r.* from wait_truck_rows r, c
     where r.cancelled_at is null and r.done_at >= c.since
  )
  select jsonb_build_object(
    'waiting',      (select count(*) from open_now),
    'overdue',      (select count(*) from open_now where state = 'overdue'),
    'warn',         (select count(*) from open_now where state = 'warn'),
    'carried',      (select count(*) from open_now, c where arrived_at < c.since),
    'wait_parcels', (select coalesce(sum(parcels_all), 0) from open_now),
    'wait_do',      (select sum(parcels_do)                from open_now),
    'wait_nondo',   (select sum(parcels_nondo)             from open_now),

    'done',         (select count(*) from fin),
    'done_late',    (select count(*) from fin where state = 'done_late'),
    'on_time',      (select count(*) from fin where state = 'done_ontime'),
    'unsure',       (select count(*) from fin where state = 'done_unsure'),
    'by_file',      (select count(*) from fin where done_src = 'file'),
    'done_parcels', (select coalesce(sum(parcels_all), 0) from fin),
    'done_do',      (select sum(parcels_do)                from fin),
    'done_nondo',   (select sum(parcels_nondo)             from fin),

    'all_trucks',   (select count(*) from open_now) + (select count(*) from fin),
    'last_import',  (select max(imported_at) from wait_trucks),
    'cycle_start',  (select since from c)
  )
  from c
  where my_can_wait_truck();
$$;

grant execute on function wait_truck_counts() to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'wait_trucks'
      and column_name in ('done_src', 'done_from', 'done_batch'))      as ช่องใหม่,
  (select count(*) from information_schema.columns
    where table_name = 'wait_truck_rows'
      and column_name in ('done_src', 'done_from'))                    as ช่องในวิว,
  (select count(*) from pg_proc
    where proname = 'wait_truck_import')                               as ตัวนำเข้า,
  (select count(*) from wait_trucks
    where done_at is null and cancelled_at is null)                    as ค้างอยู่ตอนนี้;
