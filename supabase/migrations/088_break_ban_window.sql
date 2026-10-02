-- =====================================================================
-- BPL SUPPLY — ห้ามเบรคแบบกำหนดเวลาเอง ตั้งแต่เมื่อไหร่ถึงเมื่อไหร่
-- รันต่อจาก 087 · ปลอดภัยที่จะรันซ้ำ
--
-- เจ้าของระบบเคาะชัดแล้ว
--   ไม่เอาช่วงห้ามประจำวันที่ต้องมาตั้งทุกวัน
--   ไม่กดห้าม = เบรคได้ตลอด
--   กดห้าม = เลือกเองว่าตั้งแต่กี่โมงถึงกี่โมง แล้วมันปลดเองเมื่อถึงเวลา
--
-- ของเดิม break_ban_quick รับมาเป็นจำนวนนาทีจากตอนนี้ ซึ่งพอใช้แต่ไม่พอจริง
-- เพราะคนคิดเป็น "ห้ามถึงบ่ายสอง" ไม่ได้คิดเป็น "ห้ามอีก 47 นาที"
-- และบางทีต้องตั้งล่วงหน้าก่อนรถเข้า ไม่ใช่กดตอนรถมาถึงแล้ว
--
-- ตัวเก่ายังอยู่ ปุ่มลัด 15/30/60 นาที ยังเรียกมันเหมือนเดิม
-- ส่วนช่วงห้ามประจำวันไม่ได้ลบทิ้งจากฐานข้อมูล แค่เอาออกจากหน้าจอ
-- ถ้าไม่มีแถว daily อยู่เลย มันก็ไม่เคยทำงาน ไม่ต้องไปยุ่งกับมัน
-- =====================================================================

create or replace function break_ban_set(
  p_start timestamptz,
  p_end   timestamptz,
  p_note  text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id    bigint;
  v_start timestamptz := coalesce(p_start, now());
begin
  if not my_can_break_ban() then
    raise exception 'ไม่มีสิทธิ์สั่งห้ามเบรค';
  end if;
  if p_end is null then
    raise exception 'ต้องบอกว่าห้ามถึงกี่โมง';
  end if;
  if p_end <= v_start then
    raise exception 'เวลาจบต้องอยู่หลังเวลาเริ่ม';
  end if;
  if p_end <= now() then
    raise exception 'เวลาจบผ่านไปแล้ว ตั้งใหม่อีกที';
  end if;
  -- กันพิมพ์ปีผิดแล้วห้ามยาวข้ามเดือนโดยไม่มีใครรู้
  if p_end > v_start + interval '24 hours' then
    raise exception 'ห้ามได้ครั้งละไม่เกิน 24 ชั่วโมง';
  end if;
  if v_start > now() + interval '7 days' then
    raise exception 'ตั้งล่วงหน้าได้ไม่เกิน 7 วัน';
  end if;

  -- มีช่วงที่ยังไม่จบได้ทีละอันเท่านั้น · กดซ้ำ = แก้ของเดิม ไม่สร้างซ้อน
  -- ถ้าซ้อนได้ พอกดยกเลิกจะเหลือตัวที่ซ่อนอยู่ข้างหลังแล้วยังห้ามต่อ
  select id into v_id
    from break_bans
   where kind = 'once' and active and ends_at > now()
   order by ends_at desc
   limit 1;

  if v_id is null then
    insert into break_bans (kind, starts_at, ends_at, note, active, created_by)
    values ('once', v_start, p_end, nullif(btrim(coalesce(p_note, '')), ''), true, auth.uid())
    returning id into v_id;
  else
    update break_bans
       set starts_at = v_start,
           ends_at   = p_end,
           note      = nullif(btrim(coalesce(p_note, '')), ''),
           created_by = auth.uid()
     where id = v_id;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'from', v_start, 'until', p_end);
end $$;

grant execute on function break_ban_set(timestamptz, timestamptz, text) to authenticated;


-- ---------------------------------------------------------------------
-- ช่วงห้ามที่ตั้งไว้แต่ยังไม่ถึงเวลา
--
-- break_ban_now() คืนเฉพาะอันที่ครอบเวลาตอนนี้ ซึ่งถูกสำหรับการตัดสินว่าห้ามไหม
-- แต่หน้าจอต้องบอกได้ด้วยว่า "ตั้งไว้แล้วนะ เริ่มบ่ายสอง"
-- ไม่งั้นคนตั้งจะกดซ้ำเพราะคิดว่ากดไม่ติด
-- ---------------------------------------------------------------------
create or replace function break_ban_next() returns break_bans
language sql stable security definer set search_path = public as $$
  select b.* from break_bans b
   where b.active and b.kind = 'once'
     and b.starts_at > now() and b.ends_at > now()
   order by b.starts_at
   limit 1;
$$;

grant execute on function break_ban_next() to authenticated;


-- ---------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc
    where proname in ('break_ban_set', 'break_ban_next'))                as ฟังก์ชันใหม่,
  (select count(*) from break_bans where kind = 'daily')                 as ช่วงห้ามประจำวันที่เหลืออยู่,
  (select count(*) from break_bans where kind = 'once' and ends_at > now()) as ช่วงห้ามที่ยังไม่จบ;
