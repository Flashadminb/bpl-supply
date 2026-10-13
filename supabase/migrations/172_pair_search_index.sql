-- ---------------------------------------------------------------------
-- 172 · หน้าจับคู่ · ทำให้การค้นหาเลิกไล่อ่านทั้งตาราง
--
-- ─────────────────────────────────────────────────────────────────
-- ทำไมต้องรีบแก้ · หน้างานแจ้งว่าระบบหมุนโหลดนานคืนวันที่ 13 ต.ค. ราวสามทุ่ม
--
-- ไล่หลักฐานแล้วได้ว่า
--   ไม่มี ERROR ในฐานข้อมูลเลยช่วง 21:00 ถึง 23:30
--   Edge Function ปกติ ไม่มี 502
--   deploy ล่าสุดคือ 17:34 ห่างจากเวลาที่แจ้งสี่ชั่วโมงครึ่ง
--   แต่ CPU ของเครื่อง t4g.nano พุ่งชน 99% ในวันนั้น
--
-- ไม่มี error แต่คนบอกว่าล่ม คือลายเซ็นของ CPU ตัน
-- คำสั่งไม่ได้พัง มันแค่ต่อคิวจนคนรอไม่ไหว ฐานข้อมูลจึงไม่มีอะไรให้บันทึก
-- ─────────────────────────────────────────────────────────────────
--
-- ตัวที่กินหนักสุดคือการค้นชื่อสินค้า วัดได้ 1,662 มิลลิวินาทีต่อครั้ง
-- เพราะ ilike แบบมีคำอยู่กลางข้อความ ใช้ดัชนีปกติไม่ได้เลย
-- ต้องไล่อ่านทั้งห้าหมื่นแถวทุกครั้งที่มีคนพิมพ์
--
-- ดัชนีแบบ trigram แก้ตรงนี้ได้ · มันตัดข้อความเป็นชิ้นละสามตัวอักษร
-- แล้วทำดัชนีจากชิ้นพวกนั้น ทำให้ค้นคำที่อยู่กลางข้อความได้โดยไม่ต้องไล่อ่าน
--
-- ทำดัชนีทั้งสามช่องที่ช่องค้นหาเดียวกันค้นพร้อมกัน
-- ถ้าทำไม่ครบ Postgres จะเลือกไล่อ่านทั้งตารางอยู่ดี เพราะเงื่อนไขเป็น หรือ
-- ครบทั้งสามช่องมันถึงจะรวมผลจากสามดัชนีแทนการไล่อ่าน
--
-- แลกด้วยพื้นที่ราว 20-30 MB ซึ่งคุ้ม เพราะสิ่งที่ทำให้ระบบล่มคือ CPU ไม่ใช่พื้นที่
-- ---------------------------------------------------------------------

create extension if not exists pg_trgm;

/*
  ไม่ใช้ concurrently เพราะ SQL Editor ห่อทุกคำสั่งไว้ในทรานแซกชัน
  ล็อกการเขียนไม่กี่วินาที ซึ่งไม่กระทบใคร
  ตารางนี้ถูกเขียนเฉพาะตอนอัปไฟล์ ส่วนการอ่านไม่ถูกล็อก
*/
create index if not exists p48_products_detail_trgm
  on p48_products using gin (detail gin_trgm_ops);

create index if not exists p48_parcels_tracking_trgm
  on p48_parcels using gin (tracking gin_trgm_ops);

create index if not exists p48_parcels_bag_trgm
  on p48_parcels using gin (bag_no gin_trgm_ops);

analyze p48_products;
analyze p48_parcels;


-- ---------------------------------------------------------------------
-- วัดผลทันทีด้วยคำค้นจริง · ต้องเร็วขึ้นชัดเจน ไม่งั้นแปลว่าดัชนีไม่ถูกใช้
-- ---------------------------------------------------------------------
create or replace function _p48_bench() returns table(กรณี text, มิลลิวินาที numeric, เจอ bigint)
language plpgsql as $b$
declare t timestamptz; n bigint; pr bigint; pp bigint;
begin
  select id into pr from p48_runs where kind='parcel'  and done order by id desc limit 1;
  select id into pp from p48_runs where kind='product' and done order by id desc limit 1;

  t := clock_timestamp();
  select count(*) into n
    from p48_parcels p left join p48_products q on q.run_id=pp and q.tracking=p.tracking
   where p.run_id = pr and q.detail ilike '%ยางนอก%';
  return query select 'ค้นชื่อสินค้า', round((extract(epoch from clock_timestamp()-t)*1000)::numeric,0), n;

  t := clock_timestamp();
  select count(*) into n from p48_parcels p where p.run_id = pr and p.tracking ilike '%288898%';
  return query select 'ค้นเลขพัสดุบางส่วน', round((extract(epoch from clock_timestamp()-t)*1000)::numeric,0), n;

  t := clock_timestamp();
  select count(*) into n from p48_parcels p where p.run_id = pr and p.tracking = 'TH000288898';
  return query select 'ค้นเลขพัสดุเต็ม', round((extract(epoch from clock_timestamp()-t)*1000)::numeric,0), n;
end $b$;

select * from _p48_bench();
