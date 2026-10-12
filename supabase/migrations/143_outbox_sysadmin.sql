-- ---------------------------------------------------------------------
-- 143 · เปิดของค้างส่งออกให้ผู้ดูแลระบบด้วย
--
-- รอบแรกล็อกไว้ที่ my_is_owner() ตามที่สั่งว่า "ให้ผมเห็นพอ"
-- ตอนนี้เปิดเพิ่มให้ผู้ดูแลระบบ ซึ่งใช้ role = admin ร่วมกับเจ้าของระบบ
-- แอดมิน (supervisor) กับผู้ตรวจสอบยังไม่เห็นเหมือนเดิม
--
-- ไม่ไล่แก้ my_is_owner() ทีละจุดในสิบกว่าที่ แต่ตั้งด่านใหม่ชื่อตรงกับงาน
-- รอบหน้าถ้าจะขยับสิทธิ์อีก แก้ที่ฟังก์ชันเดียว ไม่ต้องไล่หาว่าลืมจุดไหน
-- ---------------------------------------------------------------------

create or replace function my_can_outbox() returns boolean
language sql stable security definer set search_path = public as $$
  select my_role() = 'admin';
$$;

grant execute on function my_can_outbox() to authenticated;

drop policy if exists own_hub_out_snapshots on hub_out_snapshots;
create policy own_hub_out_snapshots on hub_out_snapshots for all to authenticated
  using (my_can_outbox()) with check (my_can_outbox());

drop policy if exists own_hub_out_rows on hub_out_rows;
create policy own_hub_out_rows on hub_out_rows for all to authenticated
  using (my_can_outbox()) with check (my_can_outbox());

drop policy if exists own_hub_out_trucks on hub_out_trucks;
create policy own_hub_out_trucks on hub_out_trucks for all to authenticated
  using (my_can_outbox()) with check (my_can_outbox());

-- สลับด่านใน RPC ทั้งห้าตัว · ดึงนิยามจริงมาแทนชื่อด่าน ไม่พิมพ์ตัวงานใหม่
do $outer$
declare
  r record; src text; n integer := 0;
begin
  for r in
    select p.oid, p.proname
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.proname in ('hub_out_import', 'hub_out_board', 'hub_out_latest',
                         'hub_out_undo', 'hub_out_runs')
  loop
    src := pg_get_functiondef(r.oid);
    if position('my_is_owner()' in src) = 0 then
      raise exception 'ไม่เจอด่านเดิมใน % หยุดก่อน', r.proname;
    end if;
    execute replace(src, 'my_is_owner()', 'my_can_outbox()');
    n := n + 1;
  end loop;
  if n <> 5 then raise exception 'ควรแก้ 5 ฟังก์ชัน แต่ได้ %', n; end if;
end $outer$;

select
  (select count(*) from pg_policies where tablename like 'hub_out%'
     and qual like '%my_can_outbox%')                                as policies_new,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('hub_out_import','hub_out_board','hub_out_latest','hub_out_undo','hub_out_runs')
      and position('my_can_outbox()' in pg_get_functiondef(p.oid)) > 0) as rpcs_new,
  (select count(*) from profiles where role = 'admin')               as คนที่เห็นหน้านี้;
