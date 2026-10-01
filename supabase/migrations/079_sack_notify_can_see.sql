-- =====================================================================
-- BPL SUPPLY — คนที่ได้แจ้งเตือนกระสอบ ต้องเปิดดูงานกระสอบได้ด้วย
-- รันต่อจาก 078 · ปลอดภัยที่จะรันซ้ำ
--
-- 076 เปิดธง can_sack ให้เฉพาะ "คนที่เคยแตะงานกระสอบ" กับแอดมิน
-- ซึ่งพลาดทีมซัพพอร์ตที่ตั้งไว้ด้วยแผนกย่อย เพราะเขาเพิ่งถูกตั้งขึ้นมา
-- และยังไม่เคยกดอะไรเลยสักครั้ง
--
-- ผลคือได้แจ้งเตือนว่ามีงานเข้า แต่กดเข้าไปแล้วไม่มีเมนู
-- ซึ่งแย่กว่าไม่ได้แจ้งเตือนเลย เพราะเขารู้ว่ามีงานแต่ทำอะไรไม่ได้
--
-- แก้ที่ต้นเหตุ ไม่ได้ไล่เปิดทีละคน
-- ใครก็ตามที่อยู่ในแผนกย่อยที่ตั้งไว้ใน sack_notify_sub_dept ต้องเห็นงาน
-- ตั้งคนใหม่เข้าทีมซัพพอร์ตแล้วรันไฟล์นี้ซ้ำได้ ไม่ต้องมานั่งจำ
-- =====================================================================

update profiles p
   set can_sack = true
 where p.can_sack = false
   and p.is_active
   -- ผู้ตรวจสอบไม่เห็นงานกระสอบ ตามที่สั่งไว้ว่าเอาออกทั้งหมด
   and not coalesce(p.can_dispatch, false)
   and upper(btrim(coalesce(p.sub_dept, ''))) = upper(
         coalesce(
           nullif(btrim((select value #>> '{}' from app_settings
                          where key = 'sack_notify_sub_dept')), ''),
           'SPADMIN'
         )
       );


-- ---------------------------------------------------------------------
-- ตรวจผล — ต้องไม่มีใครที่ได้แจ้งเตือนแต่เปิดดูไม่ได้
-- ---------------------------------------------------------------------
with tag as (
  select upper(coalesce(
           nullif(btrim((select value #>> '{}' from app_settings
                          where key = 'sack_notify_sub_dept')), ''),
           'SPADMIN')) as t
)
select
  (select t from tag)                                                as แผนกย่อยที่ตั้งไว้,
  (select count(*) from profiles p, tag
    where p.is_active
      and upper(btrim(coalesce(p.sub_dept, ''))) = tag.t)            as คนในทีมซัพพอร์ต,
  (select count(*) from profiles p, tag
    where p.is_active
      and upper(btrim(coalesce(p.sub_dept, ''))) = tag.t
      and not p.can_sack)                                            as ที่ยังเปิดดูไม่ได้,
  (select count(*) from profiles where can_sack)                     as คนที่เห็นกระสอบทั้งหมด;
