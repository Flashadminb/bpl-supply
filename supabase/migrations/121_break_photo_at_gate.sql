-- =====================================================================
-- BPL SUPPLY — รปภ เห็นรูปตอนสแกน และหัวหน้าดูย้อนหลังได้ 14 ชั่วโมง
-- รันต่อจาก 120 · ปลอดภัยที่จะรันซ้ำ
--
-- เจ้าของระบบสั่งสามอย่าง
--   ① รปภ สแกน QR แล้วรูปต้องขึ้น ทั้งตอนปล่อยออกและตอนรับกลับ
--   ② หัวหน้าที่ปล่อยบัตร ดูย้อนหลังได้ 14 ชั่วโมงพอ เกินนั้นให้มาดูหลังบ้าน
--   ③ บังคับรูปอย่างน้อย 1 ใบเหมือนเดิม จะถ่ายหมู่หรือถ่ายเดี่ยวไม่สน
--
-- ข้อ ③ บังคับอยู่แล้วตั้งแต่ 081 ไฟล์นี้จึงไม่ต้องแตะ
--
-- เส้นที่ยังไม่ข้าม
--   รปภ เห็นได้เฉพาะ "รูปตอนยื่นบัตร" ของใบที่ยังไม่ปิดเท่านั้น
--   รูปตอนแจ้งปัญหา รูปตอนรับกลับ และรูปของใบที่ปิดไปนานแล้ว ยังปิดสนิท
--   รูปหลักฐานเบิก-คืนของซัพพลาย ไม่ได้ถูกแตะเลยสักบรรทัด ยังเป็นของแอดมินกับผู้ตรวจสอบ
-- =====================================================================

-- ---------------------------------------------------------------------
-- ① ใครอ่านใบเบรคได้ · หัวหน้าเหลือ 14 ชั่วโมง
--
-- ใบที่ยังไม่ปิดเห็นได้เสมอ ไม่ว่าจะยื่นไปนานแค่ไหน
-- เพราะใบที่ยังค้างคืองานที่ยังไม่จบ ซ่อนไปแล้วเจ้าตัวจะไม่รู้ว่าลูกน้องยังไม่กลับ
--
-- แอดมินและผู้ตรวจสอบยังเห็นทั้งหมดตลอดกาล ของพวกนี้ไม่ได้ถูกลบ แค่ไม่โชว์ฝั่งหน้างาน
-- ---------------------------------------------------------------------
drop policy if exists read_break_passes on break_passes;
create policy read_break_passes on break_passes for select to authenticated using (
  my_can_audit()
  -- คนที่ปล่อยเอง · ใบที่ยังค้างเห็นเสมอ ที่ปิดแล้วเห็นย้อนหลัง 14 ชั่วโมง
  or (
    issued_by = auth.uid()
    and (closed_at is null or issued_at > now() - interval '14 hours')
  )
  -- รปภ · ใบที่ยังค้างเห็นได้เสมอ บวกย้อนหลัง 24 ชั่วโมงไว้ตอบคำถามที่ประตู
  or (my_can_break_guard() and (closed_at is null or issued_at > now() - interval '24 hours'))
  or (
    closed_at is null
    and my_can_break_issue()
    and exists (
      select 1 from break_group_users g
       where g.group_code = break_passes.group_code and g.user_id = auth.uid()
    )
  )
);


-- ---------------------------------------------------------------------
-- ② สแกนแล้วส่งรูปมาด้วย
--
-- ส่งมาแค่ file_id ใบแรกของ phase issue ไม่ได้ส่ง web_link
-- เพราะ web_link คือลิงก์ Drive ตรง ๆ ซึ่งอยู่นอกระบบสิทธิ์ของแอพ
-- ส่งไปฝั่งหน้าจอเมื่อไหร่ก็ส่งต่อให้ใครก็ได้ทันที ตามกติกาข้อ 4 และ 6
--
-- รูปไหลผ่าน Edge Function evidence-image ซึ่งตรวจสิทธิ์ซ้ำอีกชั้นเสมอ
-- การที่ file_id โผล่มาตรงนี้ จึงยังไม่ได้แปลว่าเปิดดูได้
-- ---------------------------------------------------------------------
create or replace function break_scan(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_code  text := upper(btrim(coalesce(p_code, '')));
  v_card  break_cards%rowtype;
  v_p     break_passes%rowtype;
  v_last  break_passes%rowtype;
  v_photo text;
begin
  if not my_can_break_guard() then
    raise exception 'ไม่มีสิทธิ์สแกนบัตรเบรค';
  end if;

  select * into v_card from break_cards where upper(code) = v_code;
  if not found then
    return jsonb_build_object('state', 'unknown', 'code', v_code);
  end if;

  select * into v_p from break_passes
   where card_code = v_card.code and closed_at is null
   order by issued_at desc limit 1;

  if not found then
    select * into v_last from break_passes
     where card_code = v_card.code
     order by closed_at desc nulls last limit 1;

    -- เพิ่งปิดไปหมาด ๆ มีประโยชน์กว่าบอกแค่ว่า "ไม่ได้ถูกปล่อย"
    if found and v_last.closed_at > now() - interval '2 hours' then
      return jsonb_build_object(
        'state', 'closed', 'code', v_card.code,
        'closed_at', v_last.closed_at,
        'closed_by', (select full_name from profiles where id = v_last.closed_by),
        'close_kind', v_last.close_kind
      );
    end if;
    return jsonb_build_object('state', 'free', 'code', v_card.code);
  end if;

  select file_id into v_photo
    from break_photos
   where pass_id = v_p.id and phase = 'issue'
   order by id limit 1;

  return jsonb_build_object(
    'state',        case when v_p.gate_out_at is null then 'ready' else 'out' end,
    'code',         v_card.code,
    'pass_id',      v_p.id,
    'people',       v_p.people,
    'reason',       v_p.reason_label,
    'minutes',      v_p.minutes,
    'nickname',     v_p.nickname,
    'issued_at',    v_p.issued_at,
    'issued_by',    (select full_name from profiles where id = v_p.issued_by),
    'due_at',       v_p.due_at,
    'gate_out_at',  v_p.gate_out_at,
    'gate_out_people', v_p.gate_out_people,
    'in_ban',       v_p.in_ban,
    'photo_file_id', v_photo
  );
end $$;

grant execute on function break_scan(text) to authenticated;


-- ---------------------------------------------------------------------
-- ③ กติกาว่า รปภ เปิดรูปใบไหนได้ · Edge Function เรียกตัวนี้
--
-- เขียนเป็น SQL ไม่ใช่เขียนใน Deno เพราะกติกาของเบรคอยู่ในฐานข้อมูลทั้งหมด
-- แยกไปอีกภาษาหนึ่งเมื่อไหร่ วันหนึ่งสองที่จะไม่ตรงกันโดยไม่มีใครรู้
--
-- รับ p_user มาตรง ๆ เพราะฝั่ง Edge Function ถือ service key
-- auth.uid() ตรงนั้นจึงเป็นค่าว่างเสมอ ใช้ตัดสินไม่ได้
--
-- เงื่อนไขครบทุกข้อถึงจะผ่าน
--   คนขอต้องเป็น รปภ ที่ยังไม่ถูกระงับ
--   ไฟล์ต้องเป็นรูป phase issue จริง ๆ ไม่ใช่รูปแจ้งปัญหาหรือรูปตอนรับกลับ
--   ใบต้องยังไม่ปิด หรือเพิ่งปิดไปไม่เกินสองชั่วโมง เท่ากับหน้าต่างเดียวกับ break_scan
-- ---------------------------------------------------------------------
create or replace function break_photo_viewable(p_user uuid, p_file_id text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from break_photos ph
      join break_passes p on p.id = ph.pass_id
      join profiles me    on me.id = p_user
     where ph.file_id = p_file_id
       and ph.phase = 'issue'
       and me.is_active
       and me.can_break_guard
       and (p.closed_at is null or p.closed_at > now() - interval '2 hours')
  );
$$;

grant execute on function break_photo_viewable(uuid, text) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_policies where tablename = 'break_passes'
     and policyname = 'read_break_passes'
     and qual like '%14 hours%')                                   as หัวหน้าเหลือ14ชั่วโมง,
  (select count(*) from pg_proc where proname = 'break_scan'
     and prosrc like '%photo_file_id%')                            as สแกนแล้วส่งรูปมาด้วย,
  (select count(*) from pg_proc where proname = 'break_photo_viewable') as กติกาเปิดรูปของรปภ,
  (select count(*) from break_passes
    where closed_at is not null and issued_at <= now() - interval '14 hours') as ใบที่หัวหน้าจะไม่เห็นแล้ว,
  (select count(*) from break_passes)                              as ใบทั้งหมดที่ยังเก็บไว้ครบ,
  (select count(*) from break_photos where phase = 'issue')        as รูปตอนยื่นที่มีอยู่;
