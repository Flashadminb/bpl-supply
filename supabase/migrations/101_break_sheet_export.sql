-- =====================================================================
-- BPL SUPPLY — ส่งประวัติเบรคลง Google Sheet
-- รันต่อจาก 100 · ปลอดภัยที่จะรันซ้ำ
--
-- โครงเดียวกับ os_scan_exports ทุกอย่าง
-- จำว่าใบไหนไปอยู่แท็บไหนบรรทัดที่เท่าไหร่ แล้วครั้งต่อไปเขียนทับที่เดิม
-- ไม่ต้องอ่านทั้งชีตมาเทียบ เร็วคงที่ไม่ว่าชีตจะใหญ่แค่ไหน
--
-- ทำไมต้องส่งซ้ำได้
--   ใบหนึ่งใบเปลี่ยนเนื้อหาได้สองจังหวะ ตอน รปภ กดปล่อยออก และตอนกดรับกลับ
--   ถ้าส่งตอนยังไม่ปิดแล้วไม่ส่งซ้ำ ชีตจะค้างว่าใบนั้นยังไม่กลับตลอดไป
--   needs_push จึงเทียบเวลาที่ส่งกับเวลาที่ใบเปลี่ยนล่าสุด ไม่ได้ดูแค่ว่าเคยส่งหรือยัง
--
-- ชีตนี้จะกลายเป็นที่เก็บระยะยาวแทนฐานข้อมูล เพราะแผนคือลบใบที่เก่ากว่า 3 เดือนทิ้ง
-- จึงใส่ลิงก์รูปในไดร์ฟลงไปด้วย ลบจากฐานข้อมูลแล้วยังตามดูรูปจากชีตได้
-- และแปลว่า **ต้องกดส่งลงชีตก่อนลบเสมอ** ไม่งั้นรายละเอียดหายไปเลย
-- =====================================================================

create table if not exists break_sheet_exports (
  pass_id     bigint primary key references break_passes (id) on delete cascade,
  tab         text not null,
  row_no      integer not null,
  exported_at timestamptz not null default now()
);

alter table break_sheet_exports enable row level security;

-- ใครอ่านประวัติเบรคได้ ก็อ่านตารางตามรอยได้ ใช้เกณฑ์เดียวกับหน้าประวัติ
drop policy if exists read_break_sheet_exports on break_sheet_exports;
create policy read_break_sheet_exports on break_sheet_exports for select to authenticated
  using (my_can_audit());

grant select on break_sheet_exports to authenticated;


-- ---------------------------------------------------------------------
-- วิวที่ทั้งหน้าจอและ Edge Function ใช้ร่วมกัน
--
-- ส่งเฉพาะใบที่ปิดแล้ว ใบที่ยังค้างอยู่ยังไม่รู้ผล ส่งไปก็ต้องส่งซ้ำอยู่ดี
-- และการเห็นใบค้างอยู่ในชีตทำให้คนอ่านชีตเข้าใจผิดว่ามีคนไม่กลับ
-- ---------------------------------------------------------------------
drop view if exists break_export_rows;
create view break_export_rows
with (security_invoker = true) as
select
  p.id,
  p.ref_no,
  p.card_code,
  p.group_code,
  p.reason_label,
  p.people,
  p.minutes,
  p.nickname,
  p.issued_at,
  p.due_at,
  p.gate_out_at,
  p.gate_out_people,
  p.closed_at,
  p.close_kind,
  p.returned_people,
  p.problem_note,
  p.in_ban,
  p.ban_reason,
  i.full_name     as issued_by_name,
  i.employee_code as issued_by_code,
  c.full_name     as closed_by_name,
  extract(epoch from (p.gate_out_at - p.issued_at))::int as walk_sec,
  extract(epoch from (p.closed_at - p.gate_out_at))::int as out_sec,
  case
    when p.close_kind in ('admin', 'supervisor') then null
    when p.closed_at > p.due_at then extract(epoch from (p.closed_at - p.due_at))::int
    else 0
  end as over_sec,
  (p.people - coalesce(p.returned_people, p.people)) as missing_people,
  (select string_agg(coalesce(ph.web_link, ph.file_id), ' ' order by ph.id)
     from break_photos ph where ph.pass_id = p.id and ph.phase = 'issue')  as issue_links,
  (select string_agg(coalesce(ph.web_link, ph.file_id), ' ' order by ph.id)
     from break_photos ph where ph.pass_id = p.id and ph.phase = 'return') as return_links,
  e.tab,
  e.row_no,
  e.exported_at,
  (e.tab is not null)                                        as is_exported,
  (e.tab is null or e.exported_at < p.closed_at)             as needs_push
from break_passes p
join profiles i on i.id = p.issued_by
left join profiles c on c.id = p.closed_by
left join break_sheet_exports e on e.pass_id = p.id
where p.closed_at is not null;

grant select on break_export_rows to authenticated;

-- Edge Function อ่านผ่าน service_role · วิวใหม่ต้องให้สิทธิ์เอง ไม่ได้ตกทอดมา
grant select on break_export_rows to service_role;
grant all on break_sheet_exports to service_role;


-- ---------------------------------------------------------------------
-- ลบใบที่เก่ากว่าที่กำหนด โดยต้องส่งลงชีตไปแล้วเท่านั้น
--
-- ด่านนี้สำคัญกว่าตัวการลบ · เจตนาทั้งหมดของการลบคือย้ายที่เก็บไปไว้ที่ชีต
-- ลบใบที่ยังไม่ได้ส่งคือทำข้อมูลหายเฉย ๆ ไม่ใช่การย้ายที่เก็บ
-- ฟังก์ชันจึงนับให้ก่อนว่ามีใบที่ยังไม่ส่งปนอยู่กี่ใบ แล้วไม่ลบทั้งก้อน
--
-- ไม่เขียนประวัติตัวหนังสือซ้ำ เพราะชีตเก็บครบกว่าอยู่แล้วทั้งลิงก์รูปและทุกช่อง
-- ---------------------------------------------------------------------
create or replace function break_purge_exported(p_days integer default 90)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cut   timestamptz := now() - make_interval(days => greatest(p_days, 30));
  v_stuck integer;
  v_n     integer;
begin
  if my_role() <> 'admin' then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ลบประวัติเบรคยกชุดได้';
  end if;

  select count(*) into v_stuck
    from break_passes p
    left join break_sheet_exports e on e.pass_id = p.id
   where p.closed_at is not null and p.issued_at < v_cut and e.pass_id is null;

  if v_stuck > 0 then
    raise exception 'มี % ใบที่เก่าพอจะลบแต่ยังไม่ได้ส่งลงชีต กดส่งก่อน', v_stuck;
  end if;

  delete from break_passes p
   using break_sheet_exports e
   where e.pass_id = p.id and p.closed_at is not null and p.issued_at < v_cut;

  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'deleted', v_n, 'before', v_cut);
end $$;

grant execute on function break_purge_exported(integer) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from break_export_rows)                  as ใบที่ส่งได้,
  (select count(*) from break_export_rows where needs_push) as ใบที่ยังรอส่ง,
  (select count(*) from break_sheet_exports)                as ใบที่ส่งไปแล้ว,
  (select count(*) from pg_proc
    where proname = 'break_purge_exported')                 as ฟังก์ชันลบของเก่า;
