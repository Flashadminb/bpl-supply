-- =====================================================================
-- BPL SUPPLY — แนบรูปหลักฐานได้หลายใบต่อ 1 คำขอ (สูงสุด 5)
-- รันต่อจาก 008 · ปลอดภัยที่จะรันซ้ำ
--
-- คอลัมน์ evidence_file_id เดิมบน requisitions ยังอยู่และยังใช้ได้
-- มันคือ "รูปหลัก" = ใบแรก ของเดิมทุกอย่างจึงไม่พัง
-- รูปที่เหลือเก็บในตารางใหม่นี้
-- =====================================================================

create table if not exists requisition_photos (
  id             bigserial primary key,
  requisition_id uuid not null references requisitions(id) on delete cascade,
  file_id        text not null,
  web_link       text,
  bytes          integer,
  sort_no        integer not null default 0,
  created_at     timestamptz not null default now(),
  unique (requisition_id, file_id)
);

create index if not exists req_photos_req_idx on requisition_photos (requisition_id, sort_no);

alter table requisition_photos enable row level security;

-- เห็นได้เหมือนเงื่อนไขของคำขอต้นทาง (เจ้าของคำขอ / แอดมิน)
-- หมายเหตุ: หน้าฝั่งพนักงานยังห้ามโชว์ลิงก์รูปตามกติกาข้อ 4 — บังคับที่ UI
drop policy if exists read_req_photos on requisition_photos;
create policy read_req_photos on requisition_photos for select to authenticated using (
  exists (
    select 1 from requisitions r
    where r.id = requisition_id
      and (r.requester_id = auth.uid() or my_role() in ('supervisor', 'admin'))
  )
);

-- ไม่มี policy insert โดยตั้งใจ — ต้องผ่าน RPC ด้านล่างเท่านั้น

-- ---------------------------------------------------------------------
-- RPC: แนบรูปเข้าคำขอ
-- p_photos ตัวอย่าง: '[{"file_id":"abc","web_link":"https://...","bytes":16000}]'
-- ---------------------------------------------------------------------
create or replace function add_requisition_photos(
  p_requisition_id uuid,
  p_photos         jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req    requisitions%rowtype;
  v_role   user_role;
  v_photo  jsonb;
  v_next   integer;
  v_added  integer := 0;
  v_total  integer;
begin
  select * into v_req from requisitions where id = p_requisition_id;
  if not found then
    raise exception 'ไม่พบคำขอ';
  end if;

  select role into v_role from profiles where id = auth.uid();
  if v_req.requester_id <> auth.uid() and coalesce(v_role, 'staff') = 'staff' then
    raise exception 'แนบรูปได้เฉพาะคำขอของตัวเอง';
  end if;

  select coalesce(max(sort_no) + 1, 0) into v_next
    from requisition_photos where requisition_id = p_requisition_id;

  for v_photo in select * from jsonb_array_elements(p_photos) loop
    if (v_photo->>'file_id') is null or length(v_photo->>'file_id') = 0 then
      continue;
    end if;

    select count(*) into v_total from requisition_photos where requisition_id = p_requisition_id;
    if v_total >= 5 then
      raise exception 'แนบรูปได้สูงสุด 5 ใบต่อคำขอ';
    end if;

    insert into requisition_photos (requisition_id, file_id, web_link, bytes, sort_no)
    values (p_requisition_id, v_photo->>'file_id', v_photo->>'web_link',
            (v_photo->>'bytes')::int, v_next)
    on conflict (requisition_id, file_id) do nothing;

    if found then
      v_next  := v_next + 1;
      v_added := v_added + 1;
    end if;
  end loop;

  -- ใบแรกเป็นรูปหลัก เพื่อให้ทุกอย่างที่อ่าน evidence_file_id เดิมยังทำงานได้
  if v_req.evidence_file_id is null then
    update requisitions r
      set evidence_file_id  = p.file_id,
          evidence_web_link = p.web_link,
          evidence_bytes    = p.bytes
      from (
        select file_id, web_link, bytes from requisition_photos
        where requisition_id = p_requisition_id order by sort_no limit 1
      ) p
      where r.id = p_requisition_id;
  end if;

  select count(*) into v_total from requisition_photos where requisition_id = p_requisition_id;
  return jsonb_build_object('added', v_added, 'total', v_total);
end $$;

grant execute on function add_requisition_photos(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- View: เพิ่มจำนวนรูปและรายการ file_id ทั้งหมด
-- ---------------------------------------------------------------------
create or replace view evidence_feed
with (security_invoker = true) as
select
  'requisition'::text                       as kind,
  r.id::text                                as source_id,
  r.ref_no,
  r.created_at,
  r.hub_code,
  r.evidence_file_id                        as file_id,
  r.evidence_web_link                       as web_link,
  r.evidence_archived                       as archived,
  p.full_name                               as who,
  p.employee_code,
  coalesce((
    select bool_or(i.is_returnable)
    from requisition_items ri join items i on i.id = ri.item_id
    where ri.requisition_id = r.id
  ), false)                                 as has_returnable,
  coalesce((
    select string_agg(i.name || ' x' || ri.qty_requested, ', ' order by ri.id)
    from requisition_items ri join items i on i.id = ri.item_id
    where ri.requisition_id = r.id
  ), '')                                    as summary,
  coalesce((
    select array_agg(ph.file_id order by ph.sort_no)
    from requisition_photos ph where ph.requisition_id = r.id
  ), array[r.evidence_file_id])             as file_ids
from requisitions r
join profiles p on p.id = r.requester_id
where r.evidence_file_id is not null

union all

select
  'return'::text,
  rt.id::text,
  rq.ref_no,
  rt.created_at,
  rq.hub_code,
  rt.evidence_file_id,
  rt.evidence_web_link,
  rt.evidence_archived,
  p.full_name,
  p.employee_code,
  true,
  i.name || ' คืน ' || rt.qty || ' (' ||
    case rt.condition when 'ok' then 'ใช้ได้' when 'damaged' then 'ชำรุด' else 'สูญหาย' end || ')',
  array[rt.evidence_file_id]
from returns rt
join requisition_items ri on ri.id = rt.requisition_item_id
join requisitions rq      on rq.id = ri.requisition_id
join items i              on i.id = ri.item_id
join profiles p           on p.id = rt.returned_by
where rt.evidence_file_id is not null;

grant select on evidence_feed to authenticated;
