-- =====================================================================
-- BPL SUPPLY — แบ่งว่าใครควรได้แจ้งเตือนเรื่องไหน
-- รันต่อจาก 029 · ปลอดภัยที่จะรันซ้ำ
--
-- แอดมิน (supervisor) ได้เฉพาะเรื่องที่ต้องลงมือเอง
--   คำขออนุมัติ · บาร์โค้ด BY · แจ้งชำรุดใหม่ · ของใกล้หมด
-- เจ้าของระบบ (admin) ได้ทุกเรื่อง รวมของค้างเกินกะด้วย
--
-- ส่วนพนักงานยังได้แค่เรื่องของตัวเอง — ใกล้เลิกกะ และเลยเวลาคืน
-- =====================================================================

create or replace function push_due_jobs()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_jobs jsonb := '[]'::jsonb;
  v_now  timestamptz := now();
  v_day  text := to_char((now() at time zone 'Asia/Bangkok'), 'YYYY-MM-DD');
begin
  -- ① ใกล้เลิกกะ 10 นาที · เตือนคนที่ถือเครื่อง
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(j) from (
      select jsonb_build_object(
        'kind',    'due_soon',
        'subject', h.txn_id::text,
        'user_id', h.user_id,
        'title',   'ใกล้เลิกกะแล้ว',
        'body',    'คุณยังถือ ' || count(*) || ' เครื่อง — ' ||
                   string_agg(h.asset_code, ', ' order by h.asset_code),
        'url',     '/returns'
      ) as j
      from asset_holdings h
      where h.due_at is not null
        and h.due_at between v_now and v_now + interval '10 minutes'
        and not exists (
          select 1 from notification_log n
          where n.kind = 'due_soon' and n.subject = h.txn_id::text and n.user_id = h.user_id
        )
      group by h.txn_id, h.user_id
    ) g
  ), '[]'::jsonb);

  -- ② เลยเวลาคืนมาแล้ว 10 นาที · เตือนเจ้าตัว
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(j) from (
      select jsonb_build_object(
        'kind',    'overdue',
        'subject', h.txn_id::text,
        'user_id', h.user_id,
        'title',   'เลยเวลาคืนแล้ว',
        'body',    'ยังไม่ได้คืน ' || count(*) || ' เครื่อง — ' ||
                   string_agg(h.asset_code, ', ' order by h.asset_code),
        'url',     '/returns'
      ) as j
      from asset_holdings h
      where h.due_at is not null
        and v_now >= h.due_at + interval '10 minutes'
        and not exists (
          select 1 from notification_log n
          where n.kind = 'overdue' and n.subject = h.txn_id::text and n.user_id = h.user_id
        )
      group by h.txn_id, h.user_id
    ) g
  ), '[]'::jsonb);

  -- ③ ของค้างเกินกะ · เฉพาะเจ้าของระบบ ไม่กวนแอดมิน
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'overdue_admin',
      'subject', x.txn_id::text,
      'user_id', m.id,
      'title',   'มีเครื่องค้างเกินกะ',
      'body',    x.holder || ' ยังไม่คืน ' || x.n || ' เครื่อง — ' || x.codes,
      'url',     '/admin/assets-out'
    ))
    from (
      select h.txn_id,
             max(h.holder_name) as holder,
             count(*)           as n,
             string_agg(h.asset_code, ', ' order by h.asset_code) as codes
      from asset_holdings h
      where h.due_at is not null and v_now >= h.due_at + interval '10 minutes'
      group by h.txn_id
    ) x
    cross join (select id from profiles where role = 'admin' and is_active) m
    where not exists (
      select 1 from notification_log n
      where n.kind = 'overdue_admin' and n.subject = x.txn_id::text and n.user_id = m.id
    )
  ), '[]'::jsonb);

  -- ④ แจ้งชำรุดใหม่ · แอดมินและเจ้าของระบบ
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'issue',
      'subject', i.id::text,
      'user_id', m.id,
      'title',   'แจ้งชำรุด ' || i.asset_code,
      'body',    i.symptom || ' · แจ้งโดย ' || coalesce(p.full_name, i.reported_name, 'ไม่ทราบชื่อ'),
      'url',     '/admin/assets'
    ))
    from asset_issues i
    left join profiles p on p.id = i.reported_by
    cross join (select id from profiles where role in ('supervisor', 'admin') and is_active) m
    where i.resolved_at is null
      and i.reported_at > v_now - interval '1 day'
      and not exists (
        select 1 from notification_log n
        where n.kind = 'issue' and n.subject = i.id::text and n.user_id = m.id
      )
  ), '[]'::jsonb);

  -- ⑤ บาร์โค้ด BY ส่งเข้ามาใหม่ · แอดมินและเจ้าของระบบ
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'by_new',
      'subject', b.id::text,
      'user_id', m.id,
      'title',   'มีการเบิกใน BY',
      'body',    p.full_name || ' · ' || b.reason || ' · ' ||
                 (select count(*) from by_barcode_photos ph where ph.by_id = b.id) || ' รูป',
      'url',     '/admin/by'
    ))
    from by_barcodes b
    join profiles p on p.id = b.user_id
    cross join (select id from profiles where role in ('supervisor', 'admin') and is_active) m
    where b.status = 'pending'
      and b.created_at > v_now - interval '1 day'
      and not exists (
        select 1 from notification_log n
        where n.kind = 'by_new' and n.subject = b.id::text and n.user_id = m.id
      )
  ), '[]'::jsonb);

  -- ⑥ คำขอรออนุมัติ · แอดมินและเจ้าของระบบ
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'approval',
      'subject', r.id::text,
      'user_id', m.id,
      'title',   'มีคำขอรออนุมัติ',
      'body',    p.full_name || ' · ' ||
                 (select count(*) from requisition_items ri where ri.requisition_id = r.id) ||
                 ' รายการ · ' || r.ref_no,
      'url',     '/admin/approvals'
    ))
    from requisitions r
    join profiles p on p.id = r.requester_id
    cross join (select id from profiles where role in ('supervisor', 'admin') and is_active) m
    where r.status = 'pending'
      and r.created_at > v_now - interval '2 days'
      and not exists (
        select 1 from notification_log n
        where n.kind = 'approval' and n.subject = r.id::text and n.user_id = m.id
      )
  ), '[]'::jsonb);

  -- ⑦ ของใกล้หมด · แอดมินและเจ้าของระบบ · เตือนได้วันละครั้งต่อรายการ
  v_jobs := v_jobs || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind',    'low_stock',
      'subject', i.id::text || ':' || v_day,
      'user_id', m.id,
      'title',   case when i.qty_on_hand = 0 then 'ของหมดสต็อก' else 'ของใกล้หมด' end,
      'body',    i.name || ' เหลือ ' || i.qty_on_hand || ' ' || i.unit ||
                 ' (ขั้นต่ำ ' || i.min_qty || ')',
      'url',     '/admin/stock'
    ))
    from items i
    cross join (select id from profiles where role in ('supervisor', 'admin') and is_active) m
    where i.is_active
      and i.qty_on_hand <= i.min_qty
      and not exists (
        select 1 from notification_log n
        where n.kind = 'low_stock'
          and n.subject = i.id::text || ':' || v_day
          and n.user_id = m.id
      )
  ), '[]'::jsonb);

  return v_jobs;
end $$;

grant execute on function push_due_jobs() to authenticated, service_role;
