-- =====================================================================
-- BPL SUPPLY — ล้างข้อมูลเก่า และแก้การเตือนประชุม
-- รันต่อจาก 034 · ปลอดภัยที่จะรันซ้ำ
--
-- ที่ปริมาณจริงที่คุยกันไว้ (100 คน วันละ 5 ใบ = ~182,000 ใบต่อปี)
-- หนึ่งใบเบิกกินพื้นที่รวมลูกหลานราว 2.3 KB → ~420 MB/ปี
-- โควตาฟรี 500 MB จะเต็มในราว 14 เดือน ถ้าไม่ล้างอะไรเลย
--
--  ①  เอาการเตือนซ้ำก่อนประชุม 30 นาทีออก
--  ②  แก้ FK ของตารางคืน ให้ลบใบเบิกได้จริง
--  ③  ล้าง sync_log ที่เกิน 60 วัน — ตัวกินที่ใหญ่ที่สุด
--  ④  ล้างใบเบิกเก่าที่ส่งขึ้น Google Sheet ครบแล้ว
--  ⑤  ตั้งเวลาให้ทำเองทุกคืน
--  ⑥  ฟังก์ชันดูว่าตอนนี้ใช้พื้นที่ไปเท่าไหร่
-- =====================================================================


-- ---------------------------------------------------------------------
-- ① เตือนประชุมรอบเดียวตอนประกาศ ไม่ต้องย้ำอีก
-- ---------------------------------------------------------------------
create or replace function push_meeting_jobs()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_jobs jsonb := '[]'::jsonb;
  v_now  timestamptz := now();
begin
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'meeting_new',
      'subject', e.id::text,
      'user_id', m.id,
      'title',   'นัดประชุม · ' || e.title,
      'body',    to_char((e.meet_at at time zone 'Asia/Bangkok'), 'DD/MM HH24:MI') ||
                 coalesce(' · ' || e.place, '') ||
                 coalesce(' · ผู้เข้าร่วม: ' || e.audience, ''),
      'url',     '/'
    ))
    from meeting_events e
    cross join (select id from profiles where is_active) m
    where e.cancelled_at is null
      and e.created_at > v_now - interval '1 day'
      and e.meet_at > v_now
      and not exists (
        select 1 from notification_log n
        where n.kind = 'meeting_new' and n.subject = e.id::text and n.user_id = m.id
      )
  ), '[]'::jsonb);

  return v_jobs;
end $$;

grant execute on function push_meeting_jobs() to authenticated, service_role;


-- ---------------------------------------------------------------------
-- ② ลบใบเบิกให้ได้จริง
--
-- returns ชี้ไปที่ requisition_items โดยไม่มี on delete cascade
-- ทำให้ลบใบเบิกที่เคยมีการคืนไม่ได้เลย — ติด FK แล้วขึ้น error ดิบ ๆ
-- ถ้าลบใบเบิกทิ้ง แถวการคืนของใบนั้นก็ไม่มีความหมายอะไรอีกแล้ว ให้ตามไปด้วย
-- (return_photos ผูก cascade กับ returns อยู่แล้ว จึงหลุดตามกันไปเอง)
-- ---------------------------------------------------------------------
do $$
declare
  v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'returns'::regclass
     and confrelid = 'requisition_items'::regclass
     and contype = 'f'
   limit 1;

  if v_name is not null then
    execute format('alter table returns drop constraint %I', v_name);
  end if;

  alter table returns
    add constraint returns_requisition_item_id_fkey
    foreign key (requisition_item_id) references requisition_items(id) on delete cascade;
exception when others then
  raise notice 'ข้ามการแก้ FK ของ returns: %', sqlerrm;
end $$;


-- ---------------------------------------------------------------------
-- ③ ล้าง sync_log เก่า
--
-- แถบสถานะ IMG ✓ GDV ✓ SPB ✓ มีประโยชน์ตอนใบนั้นยังสด
-- ไว้ให้หน้างานแคปหน้าจอถามว่าค้างขั้นไหน พ้นไปสองเดือนไม่มีใครเปิดดูอีก
-- แต่มันคือ 5 แถวต่อใบ แต่ละแถวมีสอง index — กินเกือบครึ่งของพื้นที่ทั้งหมด
-- ---------------------------------------------------------------------
create or replace function prune_sync_log(p_days integer default 60)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  delete from sync_log where updated_at < now() - (p_days || ' days')::interval;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

grant execute on function prune_sync_log(integer) to service_role;


-- ---------------------------------------------------------------------
-- ④ ล้างใบเบิกเก่าที่ขึ้น Google Sheet ครบแล้ว
--
-- Google Sheet คือที่เก็บถาวรจริง ฐานข้อมูลเป็นแค่โต๊ะทำงาน
-- ลบเฉพาะใบที่ "ทุกบรรทัดถูกส่งขึ้นชีตแล้ว" เท่านั้น
-- ใบไหนยังไม่ได้ส่งจะไม่ถูกแตะ ต่อให้เก่าแค่ไหน — ไม่งั้นข้อมูลหายโดยไม่มีที่ไหนเก็บ
--
-- ค่าเริ่มต้น 400 วัน (ราว 13 เดือน) เผื่อให้ย้อนดูข้ามปีได้ก่อน
-- ---------------------------------------------------------------------
create or replace function prune_old_requisitions(p_days integer default 400)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  delete from requisitions r
   where r.created_at < now() - (p_days || ' days')::interval
     and exists (select 1 from requisition_items li where li.requisition_id = r.id)
     -- ทุกบรรทัดต้องมีร่องรอยว่าส่งขึ้นชีตแล้ว
     and not exists (
       select 1
       from requisition_items li
       left join sheet_exports se on se.requisition_item_id = li.id
       where li.requisition_id = r.id
         and li.status <> 'rejected'
         and se.requisition_item_id is null
     );
  get diagnostics v_n = row_count;
  return v_n;
end $$;

grant execute on function prune_old_requisitions(integer) to service_role;


/** ล้างทุกอย่างในรอบเดียว — ตัวที่นาฬิกาเรียก */
create or replace function nightly_cleanup()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sync integer;
  v_req  integer;
begin
  v_sync := prune_sync_log(60);
  v_req  := prune_old_requisitions(400);
  return jsonb_build_object('sync_log', v_sync, 'requisitions', v_req);
end $$;

grant execute on function nightly_cleanup() to service_role;


-- ---------------------------------------------------------------------
-- ⑤ ตั้งเวลาให้ทำเองทุกคืนตีสาม (เวลาไทย = 20:00 UTC)
--
-- ห่อไว้ในตัวจับ error เพราะบางโปรเจกต์เปิด pg_cron ไม่ได้
-- ถ้าตั้งไม่สำเร็จ ไฟล์นี้ต้องไม่ล้มทั้งไฟล์ — เรียก nightly_cleanup() เองก็ได้
-- ---------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('bpl-nightly-cleanup');
exception when others then null;
end $$;

do $$
begin
  perform cron.schedule('bpl-nightly-cleanup', '0 20 * * *', 'select nightly_cleanup()');
  raise notice 'ตั้งเวลาล้างข้อมูลทุกคืนเรียบร้อย';
exception when others then
  raise notice 'ตั้ง pg_cron ไม่ได้ (%) — เรียก select nightly_cleanup(); เองได้', sqlerrm;
end $$;


-- ---------------------------------------------------------------------
-- ⑥ ดูว่าตอนนี้กินพื้นที่ไปเท่าไหร่
--
-- เรียก select * from db_usage(); เพื่อดูตารางที่ใหญ่ที่สุด
-- โควตาฟรีของ Supabase คือ 500 MB
-- ---------------------------------------------------------------------
create or replace function db_usage()
returns table (
  table_name text,
  rows_est   bigint,
  size_mb    numeric
)
language sql stable security definer set search_path = public as $$
  select
    c.relname::text,
    c.reltuples::bigint,
    round((pg_total_relation_size(c.oid) / 1024.0 / 1024.0)::numeric, 2)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and my_role() = 'admin'
  order by pg_total_relation_size(c.oid) desc
  limit 25;
$$;

grant execute on function db_usage() to authenticated;


-- ---------------------------------------------------------------------
-- ⑦ กันกดเบิกซ้ำ
--
-- เช็คอินประชุมกันไว้แล้ว เบิก Asset กันตัวเองอยู่แล้ว (เครื่องถูกยึดไปแล้ว)
-- แต่เบิกสิ้นเปลืองไม่มีอะไรกัน — กดซ้ำได้ใบสองใบและตัดสต็อกสองรอบ
-- ตอนคนน้อยยังไม่เจอ พอหลายสิบคนบนเน็ตที่ไม่นิ่งจะเริ่มเจอ
--
-- ตัวฟังก์ชันยกมาจาก 007 ทั้งดุ้น เติมแค่ด่านตรวจตอนต้น
-- ---------------------------------------------------------------------
create or replace function create_requisition(
  p_lines            jsonb,
  p_purpose          text default null,
  p_note             text default null,
  p_evidence_file_id text default null,
  p_evidence_link    text default null,
  p_evidence_bytes   integer default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile    profiles%rowtype;
  v_req_id     uuid;
  v_ref        text;
  v_line       jsonb;
  v_item       items%rowtype;
  v_qty        integer;
  v_auto       boolean;
  v_all_auto   boolean := true;
  v_status     req_status;
begin
  select * into v_profile from profiles where id = auth.uid();
  if not found or not v_profile.is_active then
    raise exception 'ไม่พบผู้ใช้หรือบัญชีถูกระงับ';
  end if;

  if jsonb_array_length(p_lines) = 0 then
    raise exception 'ตะกร้าว่าง';
  end if;

  -- กันกดซ้ำ · เน็ตฮับหลุดกลางคันบ่อย คนกดยืนยันแล้วจอค้างมักกดซ้ำ
  -- ทั้งที่รอบแรกเข้าไปแล้วและตัดสต็อกไปแล้ว รอบสองจะตัดซ้ำอีกชุด
  -- ถ้าคนเดิมส่งรายการชุดเดิมเป๊ะ ๆ ภายในสองนาที ถือว่าเป็นใบเดิม
  -- ไม่ใช่ error เพราะสิ่งที่ผู้ใช้ต้องการคือ 'เบิกแล้ว' ซึ่งเป็นจริง
  select r.id, r.ref_no, r.status into v_req_id, v_ref, v_status
    from requisitions r
   where r.requester_id = v_profile.id
     and r.created_at > now() - interval '2 minutes'
     and (
       select coalesce(jsonb_agg(jsonb_build_object('item_id', li.item_id, 'qty', li.qty_requested)
                                 order by li.item_id), '[]'::jsonb)
       from requisition_items li where li.requisition_id = r.id
     ) = (
       select coalesce(jsonb_agg(jsonb_build_object('item_id', (x->>'item_id')::bigint,
                                                    'qty', (x->>'qty')::int)
                                 order by (x->>'item_id')::bigint), '[]'::jsonb)
       from jsonb_array_elements(p_lines) x
     )
   order by r.created_at desc
   limit 1;

  if v_req_id is not null then
    return jsonb_build_object('ref_no', v_ref, 'id', v_req_id,
                              'status', v_status, 'duplicate', true);
  end if;

  select (value)::boolean into v_auto from app_settings where key = 'auto_approve_consumables';
  v_auto := coalesce(v_auto, false);

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_line->>'qty')::int;
    if v_qty is null or v_qty <= 0 then
      raise exception 'จำนวนไม่ถูกต้อง';
    end if;

    select * into v_item from items
      where id = (v_line->>'item_id')::bigint and is_active
      for update;

    if not found then
      raise exception 'ไม่พบวัสดุรหัส %', v_line->>'item_id';
    end if;
    if v_item.qty_on_hand < v_qty then
      raise exception 'สต็อกไม่พอ: % เหลือ % ขอ %', v_item.name, v_item.qty_on_hand, v_qty;
    end if;

    -- ติ๊กไว้รายตัว = รออนุมัติเสมอ ชนะทุกกฎ
    if v_item.requires_approval then
      v_all_auto := false;
    elsif not exists (
      select 1 from categories c
      where c.id = v_item.category_id
        and c.auto_approvable
        and (v_item.qty_on_hand - v_qty) >= v_item.min_qty
    ) then
      v_all_auto := false;
    end if;
  end loop;

  v_status := case when v_auto and v_all_auto then 'approved'::req_status
                   else 'pending'::req_status end;
  v_ref := next_ref_no();

  insert into requisitions (ref_no, requester_id, hub_code, purpose, note, status,
                            evidence_file_id, evidence_web_link, evidence_bytes,
                            decided_at, decided_by)
  values (v_ref, v_profile.id, v_profile.hub_code, p_purpose, p_note, v_status,
          p_evidence_file_id, p_evidence_link, p_evidence_bytes,
          case when v_status = 'approved' then now() end,
          case when v_status = 'approved' then v_profile.id end)
  returning id into v_req_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_line->>'qty')::int;
    select * into v_item from items where id = (v_line->>'item_id')::bigint;

    insert into requisition_items (requisition_id, item_id, qty_requested,
                                   qty_approved, status, qty_before, qty_after)
    values (v_req_id, v_item.id, v_qty,
            case when v_status = 'approved' then v_qty end,
            case when v_status = 'approved' then 'approved'::line_status
                 else 'pending'::line_status end,
            v_item.qty_on_hand,
            case when v_status = 'approved' then v_item.qty_on_hand - v_qty end);

    if v_status = 'approved' then
      update items set qty_on_hand = qty_on_hand - v_qty, updated_at = now()
        where id = v_item.id;
      insert into stock_movements (item_id, delta, qty_after, reason, ref_type, ref_id, actor_id)
        values (v_item.id, -v_qty, v_item.qty_on_hand - v_qty, 'requisition',
                'requisition', v_req_id::text, v_profile.id);
    end if;
  end loop;

  insert into sync_log (requisition_id, channel, state) values
    (v_req_id, 'SPB'::sync_channel, 'done'::sync_state),
    (v_req_id, 'GDV'::sync_channel,
      case when p_evidence_file_id is null then 'pending'::sync_state else 'done'::sync_state end),
    (v_req_id, 'GSH'::sync_channel, 'pending'::sync_state)
  on conflict do nothing;

  return jsonb_build_object('ref_no', v_ref, 'id', v_req_id, 'status', v_status);
end $$;

grant execute on function create_requisition(jsonb, text, text, text, text, integer) to authenticated;
