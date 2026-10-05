-- =====================================================================
-- BPL SUPPLY — ลบใบเบรคได้ โดยประวัติไม่หาย
-- รันต่อจาก 098 · ปลอดภัยที่จะรันซ้ำ
--
-- กติกาเดียวกับที่ใช้กับแจ้งเสียและเบิกคืนใน 094
-- ลบได้ แต่ต้องไม่ลืม · ย่อใบเป็นข้อความเก็บไว้ก่อนเสมอ พร้อมลิงก์รูปในไดร์ฟ
--
-- ใบที่ยังไม่ปิดลบไม่ได้
-- เพราะบัตรใบนั้นจะค้างสถานะ "ถูกใช้อยู่" ตลอดกาล เอาไปปล่อยซ้ำไม่ได้อีกเลย
-- ต้องไปกดปิดที่แท็บ "ใบที่ค้างอยู่" ก่อน ซึ่งเป็นทางที่ถูกและมีอยู่แล้ว
-- =====================================================================

create or replace function break_passes_delete(p_ids bigint[], p_why text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n    integer;
  v_open text;
  r      record;
begin
  if not my_can_audit() then
    raise exception 'ไม่มีสิทธิ์ลบประวัติเบรค';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  select string_agg(card_code, ', ') into v_open
    from break_passes where id = any(p_ids) and closed_at is null;
  if v_open is not null then
    raise exception 'บัตร % ยังไม่ปิด ต้องกดปิดที่แท็บใบที่ค้างอยู่ก่อน', v_open;
  end if;

  for r in
    select p.*,
           i.full_name as issuer,
           i.employee_code as issuer_code,
           c.full_name as closer,
           (select count(*) from break_photos ph where ph.pass_id = p.id)::int as n_shots,
           (select string_agg(coalesce(ph.web_link, ph.file_id), E'\n' order by ph.id)
              from break_photos ph where ph.pass_id = p.id)                    as shot_links
      from break_passes p
      join profiles i on i.id = p.issued_by
      left join profiles c on c.id = p.closed_by
     where p.id = any(p_ids)
  loop
    perform history_note_add(
      'break', r.ref_no, r.card_code, r.issuer, r.issued_at,
      concat_ws(E'\n',
        'บัตรเบรค ' || r.card_code || ' · ' || r.reason_label,
        'ปล่อย ' || r.people || ' คน · ขอไว้ ' || r.minutes || ' นาที' ||
          coalesce(' · ' || r.nickname, ''),
        'ปล่อยโดย ' || coalesce(r.issuer, '—') || coalesce(' (' || r.issuer_code || ')', '') ||
          ' เมื่อ ' || to_char(r.issued_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI'),
        case when r.gate_out_at is null then 'ไม่ได้สแกนขาออก'
             else 'ผ่านประตู ' ||
                  to_char(r.gate_out_at at time zone 'Asia/Bangkok', 'HH24:MI') ||
                  ' · ออกไป ' || coalesce(r.gate_out_people, r.people) || ' คน' end,
        'ปิด ' || to_char(r.closed_at at time zone 'Asia/Bangkok', 'HH24:MI') ||
          coalesce(' โดย ' || r.closer, '') || coalesce(' · ' || r.close_kind::text, ''),
        case when r.closed_at > r.due_at
             then 'เกินเวลา ' ||
                  floor(extract(epoch from (r.closed_at - r.due_at)) / 60)::int || ' นาที'
             else 'กลับตรงเวลา' end,
        case when coalesce(r.returned_people, r.people) < r.people
             then 'เข้าไม่ครบ ขาด ' || (r.people - coalesce(r.returned_people, 0)) || ' คน'
             else null end,
        case when r.problem_note is null then null else 'ปัญหา: ' || r.problem_note end,
        case when r.in_ban then 'ปล่อยในช่วงห้าม' || coalesce(' · ' || r.ban_reason, '') else null end),
      r.shot_links, r.n_shots, p_why);
  end loop;

  -- break_photos ผูก on delete cascade ไว้แล้ว ไม่ต้องลบเอง
  delete from break_passes where id = any(p_ids);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

grant execute on function break_passes_delete(bigint[], text) to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname = 'break_passes_delete') as ฟังก์ชันลบ,
  (select count(*) from break_passes)                                  as ใบที่มีอยู่,
  (select count(*) from break_passes where closed_at is null)          as ใบที่ลบไม่ได้เพราะยังไม่ปิด,
  (select count(*) from history_notes where kind = 'break')            as ประวัติเบรคที่เคยลบ;
