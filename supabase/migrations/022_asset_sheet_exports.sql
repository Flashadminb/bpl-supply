-- =====================================================================
-- BPL SUPPLY — ส่งออก Asset และใบแจ้งชำรุดเข้า Google Sheet
-- รันต่อจาก 021 · ปลอดภัยที่จะรันซ้ำ
--
-- ใช้วิธีเดียวกับของสิ้นเปลือง: จำไว้ว่าแถวไหนไปอยู่แท็บไหนแถวที่เท่าไหร่
-- ส่งซ้ำจึงเขียนทับแถวเดิม ไม่เกิดแถวซ้ำ และไม่ต้องอ่านทั้งชีตมาเทียบ
-- =====================================================================

create table if not exists asset_sheet_exports (
  asset_txn_item_id bigint primary key references asset_txn_items(id) on delete cascade,
  tab               text not null,
  row_no            integer not null,
  exported_at       timestamptz not null default now()
);

create index if not exists asset_sheet_exports_tab_idx on asset_sheet_exports (tab, row_no);

create table if not exists asset_issue_exports (
  issue_id    bigint primary key references asset_issues(id) on delete cascade,
  tab         text not null,
  row_no      integer not null,
  exported_at timestamptz not null default now()
);

create index if not exists asset_issue_exports_tab_idx on asset_issue_exports (tab, row_no);

alter table asset_sheet_exports enable row level security;
alter table asset_issue_exports enable row level security;

-- อ่านได้เฉพาะแอดมินขึ้นไป · เขียนผ่าน Edge Function (service role) เท่านั้น
drop policy if exists read_asset_sheet_exports on asset_sheet_exports;
create policy read_asset_sheet_exports on asset_sheet_exports for select to authenticated
  using (my_role() in ('supervisor', 'admin'));

drop policy if exists read_asset_issue_exports on asset_issue_exports;
create policy read_asset_issue_exports on asset_issue_exports for select to authenticated
  using (my_role() in ('supervisor', 'admin'));

-- ── สถานะการส่งออกฝั่ง Asset ให้หน้าเว็บนับได้ ─────────────────────────
drop view if exists asset_export_rows;
create view asset_export_rows
with (security_invoker = true) as
select
  ai.id                                   as line_id,
  t.ref_no,
  t.kind,
  t.created_at,
  ty.name                                 as type_name,
  ai.asset_code,
  p.full_name                             as who,
  p.employee_code,
  t.dept_code,
  se.tab,
  se.row_no,
  (se.asset_txn_item_id is not null)      as is_exported
from asset_txn_items ai
join asset_txns t   on t.id = ai.txn_id
join assets a       on a.code = ai.asset_code
join asset_types ty on ty.code = a.type_code
join profiles p     on p.id = t.user_id
left join asset_sheet_exports se on se.asset_txn_item_id = ai.id;

grant select on asset_export_rows to authenticated;
