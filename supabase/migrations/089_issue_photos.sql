-- =====================================================================
-- BPL SUPPLY — แจ้งซ่อมต้องมีรูปทั้งก่อนและหลัง
-- รันต่อจาก 088 · ปลอดภัยที่จะรันซ้ำ
--
-- ของเดิมใบแจ้งชำรุดมีช่องรูปเดียวและไม่บังคับ
-- ใบที่มาจากตอนคืนของแทบทั้งหมดจึงไม่มีรูปติดมาเลย ทั้งที่ตอนคืนถ่ายรูปไปแล้ว
-- เพราะรูปตอนคืนไปผูกกับใบคืน ไม่ได้ผูกกับใบแจ้งชำรุด
-- หน้าแจ้งเสียเลยเห็นแต่ตัวหนังสือ ตามของจริงไม่ได้
--
-- สามอย่างที่เพิ่ม
--   ① ตารางรูปของใบแจ้งชำรุด แยกเป็นรูปตอนแจ้ง กับรูปตอนซ่อมเสร็จ
--   ② ฟังก์ชันรวมหลักฐานทุกแหล่งของใบนั้นมาที่เดียว
--      รวมรูปตอนคืนของที่ผูกกับใบคืนด้วย ซึ่งมีอยู่แล้วแต่ไม่เคยถูกเอามาโชว์
--   ③ บังคับรูปทั้งตอนแจ้งและตอนกดเคลียร์
--
-- **ตัวเก่าที่ไม่บังคับรูปถูกลบทิ้ง** ไม่ได้เก็บไว้เป็นทางเลี่ยง
-- แอปรุ่นเก่าที่ค้างในเครื่องใครจะกดเคลียร์ไม่ผ่านและได้ข้อความให้รีเฟรช
-- ซึ่งตั้งใจ เพราะถ้าเหลือทางเลี่ยงไว้ กฎที่เจ้าของระบบสั่งก็ไม่มีผลจริง
-- =====================================================================


-- ---------------------------------------------------------------------
-- ① ต่อยอดตารางรูปของเดิมจาก 063 ไม่ได้สร้างใหม่
--
-- 063 ทำตารางนี้ไว้แล้วสำหรับรูปตอนแจ้ง แต่ไม่มีช่องบอกว่าเป็นรูปช่วงไหน
-- เติม phase เข้าไป ของเก่าทุกแถวคือรูปตอนแจ้ง จึงให้ค่าเริ่มต้นเป็น report
-- สิทธิ์การอ่านของเดิมคุมไว้ถูกแล้ว (ผู้ตรวจสอบขึ้นไป) ไม่ไปแตะ
-- ---------------------------------------------------------------------
alter table asset_issue_photos add column if not exists phase text not null default 'report';
alter table asset_issue_photos add column if not exists taken_by uuid references profiles (id);

alter table asset_issue_photos drop constraint if exists asset_issue_photos_phase_chk;
alter table asset_issue_photos add constraint asset_issue_photos_phase_chk
  check (phase in ('report', 'fix'));

create index if not exists asset_issue_photos_phase_idx on asset_issue_photos (issue_id, phase);

-- ย้ายรูปเดี่ยวของเดิมเข้ามาด้วย ใบเก่าจะได้มีหลักฐานโชว์เหมือนกัน
insert into asset_issue_photos (issue_id, phase, seq, file_id, web_link, taken_by, created_at)
select i.id, 'report', 1, i.file_id, i.web_link, i.reported_by, i.reported_at
  from asset_issues i
 where coalesce(i.file_id, '') <> ''
   and not exists (
     select 1 from asset_issue_photos p
      where p.issue_id = i.id and p.file_id = i.file_id
   );


-- ---------------------------------------------------------------------
-- ② หลักฐานทั้งหมดของใบหนึ่ง รวมทุกแหล่ง
--
-- source บอกว่ารูปมาจากไหน จะได้อธิบายได้ว่าทำไมใบเก่าถึงมีรูปทั้งที่ไม่เคยแนบ
--   issue  แนบกับใบแจ้งโดยตรง
--   txn    รูปตอนคืนของที่ใบนี้เกิดขึ้นมาด้วยกัน — มีอยู่แล้วแต่ไม่เคยถูกเอามาโชว์
-- ---------------------------------------------------------------------
create or replace function asset_issue_evidence(p_id bigint)
returns table (
  phase      text,
  source     text,
  file_id    text,
  web_link   text,
  created_at timestamptz,
  label      text
)
language sql stable security definer set search_path = public as $$
  select p.phase, 'issue'::text, p.file_id, p.web_link, p.created_at, null::text
    from asset_issue_photos p
   where my_can_audit() and p.issue_id = p_id

  union all

  select 'report'::text, 'txn'::text, tp.file_id, tp.web_link, t.created_at, tp.label
    from asset_issues i
    join asset_txns t       on t.id = i.txn_id
    join asset_txn_photos tp on tp.txn_id = t.id
   where my_can_audit() and i.id = p_id

  order by 5, 3;
$$;

grant execute on function asset_issue_evidence(bigint) to authenticated;


-- ---------------------------------------------------------------------
-- ③ แจ้งชำรุด — รูปบังคับ
--
-- เปิดให้คนที่ดูแลเครื่องได้เองด้วย ไม่ใช่เฉพาะผู้ตรวจสอบเหมือนเดิม
-- เพราะคนที่เจอของพังคือคนหน้างาน ไม่ใช่คนที่นั่งดูทะเบียน
-- ---------------------------------------------------------------------
drop function if exists asset_report_issue(text, text, text, text);

create or replace function asset_report_issue(
  p_code    text,
  p_symptom text,
  p_photos  jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sym   text := btrim(coalesce(p_symptom, ''));
  v_id    bigint;
  v_shots integer := 0;
  v_first jsonb;
begin
  if not (my_can_audit() or my_can_assets()) then
    raise exception 'ไม่มีสิทธิ์แจ้งเสีย';
  end if;
  if v_sym = '' then
    raise exception 'ต้องกรอกอาการที่เจอ';
  end if;
  if not exists (select 1 from assets where code = p_code) then
    raise exception 'ไม่พบเครื่องรหัส %', p_code;
  end if;

  select count(*) into v_shots
    from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) e
   where coalesce(e->>'file_id', '') <> '';
  if v_shots = 0 then
    raise exception 'ต้องถ่ายรูปอาการที่เจออย่างน้อยหนึ่งใบ';
  end if;

  -- อาการเดิมที่ยังไม่ได้เคลียร์และข้อความเหมือนกันเป๊ะ ถือว่ากดซ้ำ
  -- เน็ตในฮับไม่นิ่ง คนกดค้างแล้วกดซ้ำเป็นเรื่องปกติ
  select id into v_id
    from asset_issues
   where asset_code = p_code and resolved_at is null and btrim(symptom) = v_sym
   limit 1;

  if v_id is not null then
    return jsonb_build_object('id', v_id, 'duplicate', true, 'asset_code', p_code);
  end if;

  select e into v_first
    from jsonb_array_elements(p_photos) e
   where coalesce(e->>'file_id', '') <> ''
   limit 1;

  -- ยังเติม file_id ใบแรกไว้ที่เดิมด้วย เพราะมีของเก่าหลายที่อ่านช่องนี้อยู่
  insert into asset_issues (asset_code, txn_id, phase, symptom, reported_by, file_id, web_link)
  values (p_code, null, null, v_sym, auth.uid(), v_first->>'file_id', v_first->>'web_link')
  returning id into v_id;

  insert into asset_issue_photos (issue_id, phase, seq, file_id, web_link, bytes, taken_by)
  select v_id, 'report', (row_number() over ())::int, e->>'file_id', e->>'web_link', (e->>'bytes')::integer, auth.uid()
    from jsonb_array_elements(p_photos) e
   where coalesce(e->>'file_id', '') <> '';

  return jsonb_build_object('id', v_id, 'duplicate', false, 'asset_code', p_code);
end $$;

grant execute on function asset_report_issue(text, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- เคลียร์ใบแจ้งชำรุด — รูปตอนซ่อมเสร็จบังคับ
--
-- ตัวเก่าสองอาร์กิวเมนต์ถูกลบ ไม่เหลือทางเลี่ยง
-- ---------------------------------------------------------------------
drop function if exists resolve_asset_issue(bigint, text);

create or replace function resolve_asset_issue(
  p_id     bigint,
  p_note   text,
  p_photos jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_shots integer := 0;
  v_code  text;
begin
  if not my_can_audit() then
    raise exception 'ไม่มีสิทธิ์เคลียร์ใบแจ้งชำรุด';
  end if;

  select asset_code into v_code from asset_issues where id = p_id and resolved_at is null;
  if v_code is null then
    raise exception 'ไม่พบใบนี้ หรือเคลียร์ไปแล้ว';
  end if;

  select count(*) into v_shots
    from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) e
   where coalesce(e->>'file_id', '') <> '';
  if v_shots = 0 then
    raise exception 'ต้องถ่ายรูปตอนซ่อมเสร็จอย่างน้อยหนึ่งใบ';
  end if;

  insert into asset_issue_photos (issue_id, phase, seq, file_id, web_link, bytes, taken_by)
  select p_id, 'fix', (row_number() over ())::int, e->>'file_id', e->>'web_link', (e->>'bytes')::integer, auth.uid()
    from jsonb_array_elements(p_photos) e
   where coalesce(e->>'file_id', '') <> '';

  update asset_issues
     set resolved_at = now(), resolved_by = auth.uid(),
         resolve_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id;

  return jsonb_build_object('ok', true, 'id', p_id, 'asset_code', v_code);
end $$;

grant execute on function resolve_asset_issue(bigint, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- เคลียร์ทุกใบของเครื่องเดียว — รูปบังคับเหมือนกัน
--
-- ตัวนี้เป็นทางลัดที่เคยเลี่ยงกฎได้ ถ้าไม่บังคับด้วย คนก็จะกดปุ่มนี้แทนทุกครั้ง
-- แล้วกฎที่เจ้าของระบบสั่งก็ไม่มีผลจริง · รูปชุดเดียวติดให้ทุกใบที่ปิด
-- ---------------------------------------------------------------------
drop function if exists resolve_asset_issues_for(text, text);

create or replace function resolve_asset_issues_for(
  p_code   text,
  p_note   text,
  p_photos jsonb
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n     integer;
  v_shots integer := 0;
begin
  if my_role() not in ('supervisor', 'admin') then
    raise exception 'ไม่มีสิทธิ์เคลียร์อาการชำรุด';
  end if;

  select count(*) into v_shots
    from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) e
   where coalesce(e->>'file_id', '') <> '';
  if v_shots = 0 then
    raise exception 'ต้องถ่ายรูปตอนซ่อมเสร็จอย่างน้อยหนึ่งใบ';
  end if;

  insert into asset_issue_photos (issue_id, phase, seq, file_id, web_link, bytes, taken_by)
  select i.id, 'fix', (row_number() over (partition by i.id))::int, e->>'file_id', e->>'web_link', (e->>'bytes')::integer, auth.uid()
    from asset_issues i
    cross join jsonb_array_elements(p_photos) e
   where i.asset_code = p_code and i.resolved_at is null
     and coalesce(e->>'file_id', '') <> '';

  update asset_issues
     set resolved_at = now(), resolved_by = auth.uid(),
         resolve_note = nullif(btrim(coalesce(p_note, '')), '')
   where asset_code = p_code and resolved_at is null;

  get diagnostics v_n = row_count;
  return v_n;
end $$;

grant execute on function resolve_asset_issues_for(text, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- จำนวนรูปติดไปกับรายการ หน้าจอจะได้รู้ว่าใบไหนมีหลักฐานให้กางดู
-- ---------------------------------------------------------------------
drop view if exists asset_issue_rows;
create view asset_issue_rows
with (security_invoker = true) as
select
  i.id,
  i.asset_code,
  ty.name                                   as type_name,
  a.dept_code                               as asset_dept,
  i.symptom,
  i.phase,
  i.reported_at,
  coalesce(rp.full_name, i.reported_name)   as reported_by_name,
  rp.employee_code                          as reported_by_code,
  i.file_id,
  i.web_link,
  i.resolved_at,
  sp.full_name                              as resolved_by_name,
  i.resolve_note,
  (i.resolved_at is null)                   as is_open,
  (select count(*) from asset_issue_photos p
    where p.issue_id = i.id and p.phase = 'report')                    as report_shots,
  (select count(*) from asset_issue_photos p
    where p.issue_id = i.id and p.phase = 'fix')                       as fix_shots,
  (select count(*) from asset_txn_photos tp where tp.txn_id = i.txn_id) as txn_shots
from asset_issues i
join assets a         on a.code = i.asset_code
join asset_types ty   on ty.code = a.type_code
left join profiles rp on rp.id = i.reported_by
left join profiles sp on sp.id = i.resolved_by;

grant select on asset_issue_rows to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from asset_issue_photos)                              as รูปที่ย้ายเข้ามาแล้ว,
  (select count(*) from asset_issues where resolved_at is null)          as ใบที่ยังค้าง,
  (select count(*) from asset_issue_rows where is_open and txn_shots > 0) as ใบค้างที่มีรูปตอนคืนให้ดู,
  (select count(*) from pg_proc where proname = 'asset_issue_evidence')   as ฟังก์ชันรวมหลักฐาน;
