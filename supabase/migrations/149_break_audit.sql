-- ---------------------------------------------------------------------
-- 149 · ประวัติการแก้ไขบัตรเบรค และการแก้สถานะ/เวลาพร้อมเหตุผล
--
-- เจ้าของระบบสั่งสามอย่าง
--   แก้สถานะได้ พร้อมใส่เหตุผล
--   แก้เวลาได้ พร้อมใส่เหตุผล
--   มีเมนูประวัติการแก้ไข ให้รู้ว่าใครแก้ ใครยกเลิก ใครลบ
--
-- ทำด้วย trigger ไม่ใช่เขียน log ในแต่ละ RPC
--
-- เหตุผล · ถ้าให้แต่ละ RPC เขียน log เอง วันหนึ่งจะมีทางแก้ข้อมูลทางใหม่
-- ที่คนเขียนลืมใส่ log แล้วประวัติจะมีรูโดยไม่มีใครรู้ว่ามีรู
-- trigger อยู่ที่ตัวตาราง ทุกทางที่แก้ผ่านฐานข้อมูลจึงถูกบันทึกหมด
-- รวมถึงการแก้มือจาก SQL Editor ของเจ้าของระบบเองด้วย
--
-- เหตุผลที่คนพิมพ์ส่งเข้ามาทาง set_config ของ transaction นั้น
-- เพราะ trigger ไม่มีทางรู้ว่าคนกดคิดอะไร และ parameter ส่งเข้า trigger ไม่ได้
-- ---------------------------------------------------------------------

create table if not exists break_audit (
  id         bigserial primary key,
  /** ไม่ผูก foreign key เพราะใบอาจถูกลบไปแล้ว แต่ประวัติการลบต้องยังอยู่ */
  pass_id    bigint,
  ref_no     text,
  card_code  text,
  /** edit แก้ไข · close ปิดใบ · reopen เปิดใบกลับ · delete ลบทิ้ง */
  action     text not null,
  /** ช่องที่ถูกแก้ · ว่างได้ในกรณีลบทั้งใบ */
  field      text,
  before_val text,
  after_val  text,
  reason     text,
  by_id      uuid references profiles (id),
  at         timestamptz not null default now()
);

create index if not exists break_audit_at on break_audit (at desc);
create index if not exists break_audit_pass on break_audit (pass_id);

alter table break_audit enable row level security;

drop policy if exists read_break_audit on break_audit;
create policy read_break_audit on break_audit for select to authenticated
  using (my_can_audit());


/**
 * บันทึกทุกการเปลี่ยนแปลงของบัตรเบรค
 *
 * ดูเฉพาะช่องที่มีความหมายกับคนอ่าน ไม่ได้ไล่ทุกคอลัมน์
 * เช่น exported_at เปลี่ยนตอนส่งชีตซึ่งไม่ใช่การแก้ไขของคน ไม่ต้องรก
 */
create or replace function break_audit_tg() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_reason text := nullif(btrim(coalesce(current_setting('app.break_reason', true), '')), '');
  v_by     uuid := auth.uid();
begin
  if tg_op = 'DELETE' then
    insert into break_audit (pass_id, ref_no, card_code, action, field, before_val, after_val, reason, by_id)
    values (
      old.id, old.ref_no, old.card_code, 'delete', null,
      concat_ws(' · ',
        old.reason_label,
        old.people || ' คน ' || old.minutes || ' นาที',
        'ปล่อย ' || to_char(old.issued_at at time zone 'Asia/Bangkok', 'DD/MM HH24:MI'),
        case when old.closed_at is null then 'ยังไม่ปิด'
             else 'ปิด ' || to_char(old.closed_at at time zone 'Asia/Bangkok', 'DD/MM HH24:MI') end),
      null, v_reason, v_by);
    return old;
  end if;

  if old.closed_at is distinct from new.closed_at then
    insert into break_audit (pass_id, ref_no, card_code, action, field, before_val, after_val, reason, by_id)
    values (new.id, new.ref_no, new.card_code,
            case when new.closed_at is null then 'reopen' else 'close' end,
            'เวลาปิดใบ',
            to_char(old.closed_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI'),
            to_char(new.closed_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI'),
            v_reason, v_by);
  end if;

  if old.close_kind is distinct from new.close_kind then
    insert into break_audit (pass_id, ref_no, card_code, action, field, before_val, after_val, reason, by_id)
    values (new.id, new.ref_no, new.card_code, 'edit', 'สถานะการปิด',
            old.close_kind, new.close_kind, v_reason, v_by);
  end if;

  if old.gate_out_at is distinct from new.gate_out_at then
    insert into break_audit (pass_id, ref_no, card_code, action, field, before_val, after_val, reason, by_id)
    values (new.id, new.ref_no, new.card_code, 'edit', 'เวลาออกประตู',
            to_char(old.gate_out_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI'),
            to_char(new.gate_out_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI'),
            v_reason, v_by);
  end if;

  if old.issued_at is distinct from new.issued_at then
    insert into break_audit (pass_id, ref_no, card_code, action, field, before_val, after_val, reason, by_id)
    values (new.id, new.ref_no, new.card_code, 'edit', 'เวลาปล่อย',
            to_char(old.issued_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI'),
            to_char(new.issued_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI'),
            v_reason, v_by);
  end if;

  if old.due_at is distinct from new.due_at then
    insert into break_audit (pass_id, ref_no, card_code, action, field, before_val, after_val, reason, by_id)
    values (new.id, new.ref_no, new.card_code, 'edit', 'เวลาครบกำหนด',
            to_char(old.due_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI'),
            to_char(new.due_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI'),
            v_reason, v_by);
  end if;

  if old.problem_note is distinct from new.problem_note then
    insert into break_audit (pass_id, ref_no, card_code, action, field, before_val, after_val, reason, by_id)
    values (new.id, new.ref_no, new.card_code, 'edit', 'หมายเหตุ',
            old.problem_note, new.problem_note, v_reason, v_by);
  end if;

  return new;
end $$;

drop trigger if exists break_audit_upd on break_passes;
create trigger break_audit_upd after update on break_passes
  for each row execute function break_audit_tg();

drop trigger if exists break_audit_del on break_passes;
create trigger break_audit_del after delete on break_passes
  for each row execute function break_audit_tg();


/**
 * แก้สถานะหรือเวลาของใบเดียว · บังคับใส่เหตุผลเสมอ
 *
 * ที่บังคับ เพราะของพวกนี้แก้ทีหลังคือการเปลี่ยนหลักฐาน
 * ถ้าไม่มีเหตุผลติดไว้ เดือนหน้าจะไม่มีใครตอบได้ว่าทำไมเวลามันไม่ตรงกับที่ รปภ จำได้
 *
 * ส่ง null มาในช่องไหน แปลว่าไม่แตะช่องนั้น · ถ้าอยากล้างค่าให้ส่ง p_clear มาด้วย
 */
create or replace function break_pass_edit(
  p_id          bigint,
  p_reason      text,
  p_close_kind  text        default null,
  p_closed_at   timestamptz default null,
  p_gate_out_at timestamptz default null,
  p_issued_at   timestamptz default null,
  p_due_at      timestamptz default null,
  p_note        text        default null,
  p_clear       text[]      default '{}'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if not my_can_audit() then
    raise exception 'ไม่มีสิทธิ์แก้ประวัติเบรค';
  end if;
  if coalesce(btrim(coalesce(p_reason, '')), '') = '' then
    raise exception 'ต้องใส่เหตุผลที่แก้ก่อน';
  end if;
  if p_close_kind is not null and p_close_kind not in ('guard', 'problem', 'supervisor', 'admin') then
    raise exception 'สถานะไม่ถูกต้อง';
  end if;

  perform set_config('app.break_reason', p_reason, true);

  update break_passes p
     set close_kind   = case when 'close_kind' = any(p_clear) then null
                             else coalesce(p_close_kind, p.close_kind) end,
         closed_at    = case when 'closed_at' = any(p_clear) then null
                             else coalesce(p_closed_at, p.closed_at) end,
         closed_by    = case when 'closed_at' = any(p_clear) then null
                             when p_closed_at is not null then auth.uid()
                             else p.closed_by end,
         gate_out_at  = case when 'gate_out_at' = any(p_clear) then null
                             else coalesce(p_gate_out_at, p.gate_out_at) end,
         issued_at    = coalesce(p_issued_at, p.issued_at),
         due_at       = coalesce(p_due_at, p.due_at),
         problem_note = case when 'note' = any(p_clear) then null
                             else coalesce(nullif(btrim(coalesce(p_note, '')), ''), p.problem_note) end
   where p.id = p_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'ไม่พบใบนี้';
  end if;

  return jsonb_build_object('ok', true);
end $$;

grant execute on function break_pass_edit(bigint, text, text, timestamptz, timestamptz, timestamptz, timestamptz, text, text[]) to authenticated;


/** ประวัติการแก้ไข · กรองตามช่วงวันและชนิดการกระทำ */
create or replace function break_audit_list(
  p_from   date default null,
  p_to     date default null,
  p_action text default null,
  p_q      text default null,
  p_limit  integer default 300
)
returns table (
  id bigint,
  pass_id bigint,
  ref_no text,
  card_code text,
  action text,
  field text,
  before_val text,
  after_val text,
  reason text,
  at timestamptz,
  by_name text,
  by_code text
)
language sql stable security definer set search_path = public as $$
  select a.id, a.pass_id, a.ref_no, a.card_code, a.action, a.field,
         a.before_val, a.after_val, a.reason, a.at,
         coalesce(pr.full_name, '—'), pr.employee_code
    from break_audit a
    left join profiles pr on pr.id = a.by_id
   where my_can_audit()
     and (p_from is null or (a.at at time zone 'Asia/Bangkok')::date >= p_from)
     and (p_to   is null or (a.at at time zone 'Asia/Bangkok')::date <= p_to)
     and (coalesce(btrim(coalesce(p_action, '')), '') = '' or a.action = p_action)
     and (
       coalesce(btrim(coalesce(p_q, '')), '') = ''
       or a.card_code ilike '%' || btrim(p_q) || '%'
       or a.ref_no    ilike '%' || btrim(p_q) || '%'
       or coalesce(a.reason, '') ilike '%' || btrim(p_q) || '%'
       or coalesce(pr.full_name, '') ilike '%' || btrim(p_q) || '%'
     )
   order by a.at desc
   limit greatest(1, least(coalesce(p_limit, 300), 2000));
$$;

grant execute on function break_audit_list(date, date, text, text, integer) to authenticated;

select
  (select count(*) from pg_tables where tablename = 'break_audit')            as tbl,
  (select count(*) from pg_trigger where tgname like 'break_audit%')          as triggers,
  (select count(*) from pg_proc where proname = 'break_pass_edit')            as f_edit,
  (select count(*) from pg_proc where proname = 'break_audit_list')           as f_list;
