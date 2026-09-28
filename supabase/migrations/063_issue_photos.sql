-- =====================================================================
-- BPL SUPPLY — รูปประกอบการแจ้งซ่อม
-- รันต่อจาก 062 · ปลอดภัยที่จะรันซ้ำ
--
-- เดิมใบแจ้งซ่อมแนบรูปได้ใบเดียว (คอลัมน์ file_id/web_link)
-- ซึ่งไม่พอกับของจริง — จอแตกต้องถ่ายทั้งจอและมุมที่ร้าว
-- แบตเสื่อมต้องถ่ายหน้าจอแสดงเปอร์เซ็นต์ด้วย
--
-- ทำเป็นตารางลูก แนบได้ไม่จำกัด คอลัมน์เดิมไม่แตะ
-- ของเก่าที่แนบไว้ใบเดียวจึงยังอ่านได้เหมือนเดิมทุกที่
--
-- ใครเห็นรูปได้ — แอดมิน เจ้าของระบบ ผู้ตรวจสอบ เท่านั้น
-- หน้างานห้ามเห็นลิงก์ Drive เด็ดขาด (CLAUDE.md ข้อ 4)
-- =====================================================================

create table if not exists asset_issue_photos (
  id         bigserial primary key,
  issue_id   bigint not null references asset_issues (id) on delete cascade,
  seq        integer not null default 1,
  file_id    text not null,
  web_link   text,
  bytes      integer,
  created_at timestamptz not null default now()
);

create index if not exists asset_issue_photos_issue_idx on asset_issue_photos (issue_id, seq);

alter table asset_issue_photos enable row level security;

drop policy if exists read_asset_issue_photos on asset_issue_photos;
create policy read_asset_issue_photos on asset_issue_photos for select to authenticated
  using (my_can_dispatch() or my_role() in ('supervisor', 'admin'));

-- เขียนผ่าน RPC ที่เป็น security definer เท่านั้น ฝั่ง client ไม่ต้องเขียนตรง
drop policy if exists write_asset_issue_photos on asset_issue_photos;
create policy write_asset_issue_photos on asset_issue_photos for all to authenticated
  using (my_role() in ('supervisor', 'admin'))
  with check (my_role() in ('supervisor', 'admin'));


-- ---------------------------------------------------------------------
-- ตัวช่วยแนบรูปเข้าใบแจ้งซ่อม
--
-- แยกเป็นฟังก์ชันเพราะทั้งขาเบิกและขาคืนเรียกเหมือนกัน
-- เขียนซ้ำสองที่แล้วแก้ไม่ครบทั้งคู่คือเรื่องที่เกิดขึ้นเสมอ
-- ---------------------------------------------------------------------
create or replace function attach_issue_photos(p_issue bigint, p_photos jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n integer := 0;
begin
  if p_photos is null or jsonb_typeof(p_photos) <> 'array' then
    return 0;
  end if;

  insert into asset_issue_photos (issue_id, seq, file_id, web_link, bytes)
  select p_issue,
         (row_number() over ())::int,
         ph->>'file_id',
         ph->>'web_link',
         nullif(ph->>'bytes', '')::int
    from jsonb_array_elements(p_photos) ph
   where coalesce(ph->>'file_id', '') <> '';

  get diagnostics v_n = row_count;

  -- ใบเดิมอ่าน file_id ตรงหัวใบอยู่ เติมใบแรกไว้ด้วยจะได้ไม่ต้องแก้ที่อื่น
  update asset_issues i
     set file_id  = coalesce(i.file_id, f.file_id),
         web_link = coalesce(i.web_link, f.web_link)
    from (
      select file_id, web_link from asset_issue_photos
       where issue_id = p_issue order by seq limit 1
    ) f
   where i.id = p_issue;

  return v_n;
end $$;

grant execute on function attach_issue_photos(bigint, jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- แนบรูปหลังแจ้งซ่อมเสร็จ โดยอ้างจากรหัสเครื่อง
--
-- ทำไมไม่ไปแก้ asset_checkout / asset_return ให้รับรูปเข้าไปเลย
--   สองตัวนั้นเป็นหัวใจของการเบิกและคืน ยาวหลักร้อยบรรทัด และมีการล็อกแถว
--   แก้ทับแล้วพลาดคือทั้งฮับเบิกไม่ได้ ส่วนการแนบรูปเป็นของประกอบ
--   ต่อให้แนบไม่สำเร็จ ใบแจ้งซ่อมก็ยังอยู่ครบ เรื่องสำคัญไม่พัง
--
-- หาใบล่าสุดของเครื่องนั้นที่ตัวเองเพิ่งแจ้งและยังไม่ถูกปิด
-- จำกัด 10 นาทีเพื่อไม่ให้ไปแปะทับใบเก่าของเดือนที่แล้ว
-- ---------------------------------------------------------------------
create or replace function attach_issue_photos_by_code(
  p_asset_code text,
  p_photos     jsonb
) returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  v_issue bigint;
begin
  select id into v_issue
    from asset_issues
   where asset_code = p_asset_code
     and reported_by = auth.uid()
     and resolved_at is null
     and reported_at > now() - interval '10 minutes'
   order by reported_at desc
   limit 1;

  if v_issue is null then
    return 0;
  end if;

  return attach_issue_photos(v_issue, p_photos);
end $fn$;

grant execute on function attach_issue_photos_by_code(text, jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- ใบแจ้งซ่อมพร้อมรูปทั้งหมด — ใช้ในหน้าเว็บ
-- ---------------------------------------------------------------------
create or replace view asset_issue_rows
with (security_invoker = true) as
select
  i.id,
  i.asset_code,
  i.txn_id,
  i.phase,
  i.symptom,
  i.reported_by,
  coalesce(p.full_name, i.reported_name) as reported_name,
  i.reported_at,
  i.file_id,
  i.web_link,
  i.resolved_at,
  i.resolved_by,
  r.full_name as resolved_by_name,
  i.resolve_note,
  a.type_code,
  t.name as type_name,
  coalesce(
    (select jsonb_agg(jsonb_build_object(
       'seq', ph.seq, 'file_id', ph.file_id, 'web_link', ph.web_link
     ) order by ph.seq)
       from asset_issue_photos ph where ph.issue_id = i.id),
    '[]'::jsonb
  ) as photos
from asset_issues i
left join profiles p on p.id = i.reported_by
left join profiles r on r.id = i.resolved_by
left join assets a   on a.code = i.asset_code
left join asset_types t on t.code = a.type_code;

grant select on asset_issue_rows to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_name = 'asset_issue_photos')                  as ตารางรูปแจ้งซ่อม,
  (select count(*) from pg_proc where proname = 'attach_issue_photos') as ฟังก์ชันแนบรูป,
  (select count(*) from information_schema.views
    where table_name = 'asset_issue_rows')                    as วิวใบแจ้งซ่อม,
  (select count(*) from asset_issues)                         as ใบแจ้งซ่อมที่มีอยู่,
  (select count(*) from asset_issue_photos)                   as รูปที่แนบแล้ว;
