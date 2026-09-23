import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAsync } from '../../lib/useAsync'
import {
  countSheetExportRows,
  listAllItemsForAdmin,
  listCategories,
  listDepartments,
  listOpenBorrowings,
  listRequisitionsBetween,
} from '../../lib/api'
import { ErrorBox, Loading } from '../../components/ui'
import { BarsH, Columns, DataTable, Stat, STATUS, type Datum } from '../../components/charts'
import { STATUS_TH, fmtDateTime, relativeAge, statusClass } from '../../lib/format'

const RANGES = [
  { days: 7, label: '7 วัน' },
  { days: 30, label: '30 วัน' },
  { days: 90, label: '90 วัน' },
]

const dayKey = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(iso))

const dayShort = (key: string) => {
  const [, m, d] = key.split('-')
  return `${d}/${m}`
}

export default function Dashboard() {
  const [days, setDays] = useState(30)
  const [dept, setDept] = useState('')

  const fromISO = useMemo(() => new Date(Date.now() - days * 864e5).toISOString(), [days])
  const toISO = useMemo(() => new Date().toISOString(), [days])

  const reqs = useAsync(() => listRequisitionsBetween(fromISO, toISO), [fromISO])
  const items = useAsync(() => listAllItemsForAdmin(), [])
  const cats = useAsync(() => listCategories(), [])
  const depts = useAsync(() => listDepartments(), [])
  const borrow = useAsync(() => listOpenBorrowings(false), [])
  const unsent = useAsync(() => countSheetExportRows({ fromISO, toISO }), [fromISO])

  // แผนกอยู่ที่ตัวคน ไม่ได้อยู่ที่ใบเบิก จึงกรองหลังดึงมาแล้ว
  const rows = useMemo(() => {
    const all = reqs.data ?? []
    return dept ? all.filter((r) => r.profiles?.dept_code === dept) : all
  }, [reqs.data, dept])
  const catName = useMemo(
    () => new Map((cats.data ?? []).map((c) => [c.id, c.name])),
    [cats.data],
  )

  const stats = useMemo(() => {
    const today = dayKey(new Date().toISOString())
    const todayRows = rows.filter((r) => dayKey(r.created_at) === today)
    const pending = rows.filter((r) => r.status === 'pending')
    const oldest = pending[pending.length - 1]

    // เวลาที่ใช้ตัดสินใจ นับเฉพาะใบที่แอดมินกดเอง ไม่นับที่อนุมัติอัตโนมัติ
    const decided = rows.filter(
      (r) => r.decided_at && r.status !== 'pending' && r.decided_by && r.decided_by !== r.requester_id,
    )
    const avgMins =
      decided.length > 0
        ? Math.round(
            decided.reduce(
              (sum, r) => sum + (Date.parse(r.decided_at as string) - Date.parse(r.created_at)) / 60000,
              0,
            ) / decided.length,
          )
        : null

    const unitsToday = todayRows.reduce(
      (n, r) => n + (r.requisition_items ?? []).reduce((m, l) => m + l.qty_requested, 0),
      0,
    )
    const noEvidence = rows.filter((r) => !r.evidence_file_id).length

    return { todayRows, pending, oldest, avgMins, unitsToday, noEvidence }
  }, [rows])

  const low = (items.data ?? []).filter((i) => i.is_active && i.qty_on_hand <= i.min_qty)
  const openBorrow = borrow.data ?? []
  const openUnits = openBorrow.reduce((n, b) => n + b.qty_open, 0)
  // ค้างเกิน 2 กะ ถือว่าผิดปกติ ตรงกับเกณฑ์ในหน้าของค้างคืน
  const lateBorrow = openBorrow.filter((b) => Date.now() - Date.parse(b.created_at) >= 18 * 3600_000)
  const pendingSheet = unsent.data?.pending ?? 0

  /** จำนวนคำขอรายวัน เติมวันที่ไม่มีการเบิกให้เป็นศูนย์ ไม่งั้นกราฟหลอกตา */
  const daily: Datum[] = useMemo(() => {
    const map = new Map<string, number>()
    for (let i = days - 1; i >= 0; i--) {
      map.set(dayKey(new Date(Date.now() - i * 864e5).toISOString()), 0)
    }
    for (const r of rows) {
      const k = dayKey(r.created_at)
      if (map.has(k)) map.set(k, (map.get(k) ?? 0) + 1)
    }
    return [...map.entries()].map(([k, v]) => ({ label: k, value: v, sub: dayShort(k) }))
  }, [rows, days])

  const topItems: Datum[] = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of rows) {
      for (const l of r.requisition_items ?? []) {
        if (l.status === 'rejected') continue
        const name = l.items?.name ?? `#${l.item_id}`
        map.set(name, (map.get(name) ?? 0) + (l.qty_approved ?? l.qty_requested))
      }
    }
    return [...map.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  }, [rows])

  const topPeople: Datum[] = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of rows) {
      const who = r.profiles?.full_name ?? '—'
      map.set(who, (map.get(who) ?? 0) + 1)
    }
    return [...map.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  }, [rows])

  const byCategory: Datum[] = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of rows) {
      for (const l of r.requisition_items ?? []) {
        if (l.status === 'rejected') continue
        const cid = (l.items as { category_id?: number | null } | null)?.category_id ?? null
        const name = cid ? (catName.get(cid) ?? 'ไม่ระบุหมวด') : 'ไม่ระบุหมวด'
        map.set(name, (map.get(name) ?? 0) + (l.qty_approved ?? l.qty_requested))
      }
    }
    return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
  }, [rows, catName])

  const byStatus: Datum[] = useMemo(() => {
    const order = ['approved', 'partial', 'pending', 'rejected'] as const
    const color = {
      approved: STATUS.ok,
      partial: STATUS.mute,
      pending: STATUS.warn,
      rejected: STATUS.danger,
    }
    return order
      .map((s) => ({
        label: STATUS_TH[s],
        value: rows.filter((r) => r.status === s).length,
        color: color[s],
      }))
      .filter((d) => d.value > 0)
  }, [rows])

  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-lg">ภาพรวม</h1>
        <Link to="/admin/export" className="btn-soft h-tap px-3 text-sm">
          ส่งออก Google Sheet
        </Link>
      </div>

      {/* แถบตัวกรองอยู่แถวเดียวเหนือทุกกราฟ กรองพร้อมกันทั้งหน้า */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <button
            key={r.days}
            type="button"
            className={`chip ${days === r.days ? 'chip-on' : ''}`}
            onClick={() => setDays(r.days)}
          >
            {r.label}
          </button>
        ))}
        <span className="mx-1 h-6 w-px bg-line-2" />
        <select
          className="input h-tap max-w-[200px]"
          value={dept}
          onChange={(e) => setDept(e.target.value)}
          aria-label="แผนก"
        >
          <option value="">ทุกแผนก</option>
          {(depts.data ?? []).map((d) => (
            <option key={d.code} value={d.code}>
              {d.name}
            </option>
          ))}
        </select>
        <button type="button" className="btn-soft h-tap px-3 text-sm" onClick={reqs.reload}>
          รีเฟรช
        </button>
      </div>

      {/* ---- แถบเตือนเรื่องที่ต้องรีบจัดการ ---- */}
      {(low.length > 0 || stats.pending.length > 0 || lateBorrow.length > 0 || pendingSheet > 0) && (
        <div className="mb-4 grid gap-2 sm:grid-cols-2">
          {low.length > 0 && (
            <Link
              to="/admin/stock"
              className="rounded-card border border-danger/25 bg-danger-bg px-4 py-3 text-sm text-danger-txt"
            >
              <b>ของต่ำกว่าขั้นต่ำ {low.length} รายการ</b> — {low.filter((i) => i.qty_on_hand === 0).length}{' '}
              รายการหมดสต็อกแล้ว · กดเพื่อดูและสั่งซื้อเพิ่ม
            </Link>
          )}
          {stats.pending.length > 0 && (
            <Link
              to="/admin/approvals"
              className="rounded-card border border-warn/30 bg-warn-bg px-4 py-3 text-sm text-warn-txt"
            >
              <b>รออนุมัติ {stats.pending.length} คำขอ</b>
              {stats.oldest ? ` — เก่าสุดรอมาแล้ว ${relativeAge(stats.oldest.created_at)}` : ''} · กดเพื่ออนุมัติ
            </Link>
          )}
          {lateBorrow.length > 0 && (
            <Link
              to="/admin/outstanding"
              className="rounded-card border border-danger/25 bg-danger-bg px-4 py-3 text-sm text-danger-txt"
            >
              <b>ค้างคืนเกิน 18 ชม. {lateBorrow.length} รายการ</b> — ประมาณ 2 กะ · กดเพื่อดูว่าอยู่กับใคร
            </Link>
          )}
          {pendingSheet > 0 && (
            <Link
              to="/admin/export"
              className="rounded-card border border-line bg-surface px-4 py-3 text-sm text-ink-700"
            >
              <b>ค้างส่งเข้า Google Sheet {pendingSheet} บรรทัด</b> — ใน {days} วันที่ผ่านมา · กดเพื่อส่ง
            </Link>
          )}
        </div>
      )}

      {reqs.loading && <Loading />}
      {reqs.error && <ErrorBox message={reqs.error} onRetry={reqs.reload} />}

      {/* ---- ตัวเลขสรุป ---- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="เบิกวันนี้" value={stats.todayRows.length} hint={`${stats.unitsToday} ชิ้น`} />
        <Stat label={`คำขอใน ${days} วัน`} value={rows.length} hint="ทุกสถานะ" />
        <Stat
          label="รออนุมัติ"
          value={stats.pending.length}
          hint={stats.oldest ? `เก่าสุด ${relativeAge(stats.oldest.created_at)}` : 'ไม่มีค้าง'}
          tone={stats.pending.length > 0 ? 'warn' : 'ok'}
        />
        <Stat
          label="ต่ำกว่าขั้นต่ำ"
          value={low.length}
          hint="ต้องสั่งซื้อเพิ่ม"
          tone={low.length > 0 ? 'danger' : 'ok'}
        />
        <Stat
          label="ค้างคืน"
          value={openUnits}
          hint={lateBorrow.length > 0 ? `เกิน 18 ชม. ${lateBorrow.length} รายการ` : 'ชิ้นที่ยังไม่คืน'}
          tone={lateBorrow.length > 0 ? 'danger' : undefined}
        />
        <Stat
          label="เวลาอนุมัติเฉลี่ย"
          value={stats.avgMins === null ? '—' : stats.avgMins < 60 ? `${stats.avgMins} นาที` : `${(stats.avgMins / 60).toFixed(1)} ชม.`}
          hint="เฉพาะใบที่กดอนุมัติเอง"
        />
      </div>

      {/* ---- แนวโน้มรายวัน ---- */}
      <section className="panel mt-4 p-4">
        <h2 className="mb-1 font-display text-md">จำนวนคำขอต่อวัน</h2>
        <p className="mb-3 text-sm text-ink-400">ชี้ที่แท่งเพื่อดูตัวเลขของวันนั้น</p>
        <Columns data={daily} unit="คำขอ" />
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <section className="panel p-4">
          <h2 className="mb-1 font-display text-md">วัสดุที่เบิกมากที่สุด</h2>
          <p className="mb-3 text-sm text-ink-400">นับเป็นจำนวนชิ้นใน {days} วันที่ผ่านมา</p>
          <BarsH data={topItems} unit="ชิ้น" />
          <DataTable rows={topItems} head={['วัสดุ', 'จำนวนชิ้น']} />
        </section>

        <section className="panel p-4">
          <h2 className="mb-1 font-display text-md">ผู้เบิกบ่อยที่สุด</h2>
          <p className="mb-3 text-sm text-ink-400">นับเป็นจำนวนคำขอใน {days} วันที่ผ่านมา</p>
          <BarsH data={topPeople} unit="คำขอ" />
          <DataTable rows={topPeople} head={['ผู้เบิก', 'จำนวนคำขอ']} />
        </section>

        <section className="panel p-4">
          <h2 className="mb-1 font-display text-md">แยกตามหมวดวัสดุ</h2>
          <p className="mb-3 text-sm text-ink-400">จำนวนชิ้นรวมในแต่ละหมวด</p>
          <BarsH data={byCategory} unit="ชิ้น" />
          <DataTable rows={byCategory} head={['หมวด', 'จำนวนชิ้น']} />
        </section>

        <section className="panel p-4">
          <h2 className="mb-1 font-display text-md">สถานะคำขอ</h2>
          <p className="mb-3 text-sm text-ink-400">
            แต่ละสถานะมีกี่ใบ · สีบอกความหมาย เขียวผ่าน เหลืองรอ แดงถูกปฏิเสธ
          </p>
          <BarsH data={byStatus} unit="ใบ" />
          {stats.noEvidence > 0 && (
            <p className="mt-2 rounded-btn bg-warn-bg px-3 py-2 text-sm text-warn-txt">
              มี {stats.noEvidence} คำขอที่ไม่มีรูปหลักฐาน — เกิดตอนอัปรูปไม่สำเร็จแล้วพนักงานกดบันทึกต่อ
            </p>
          )}
        </section>
      </div>

      {/* ---- ตารางรายละเอียด ---- */}
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <section className="panel p-4">
          <h2 className="mb-3 font-display text-md">รายการเบิกล่าสุด</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="text-ink-500">
                <tr className="border-b border-line">
                  <th className="py-2 font-medium">เลขที่</th>
                  <th className="py-2 font-medium">เวลา</th>
                  <th className="py-2 font-medium">ผู้เบิก</th>
                  <th className="py-2 font-medium">รายการ</th>
                  <th className="py-2 font-medium">สถานะ</th>
                  <th className="py-2 font-medium">หลักฐาน</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 15).map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="py-2 font-mono text-xs">{r.ref_no}</td>
                    <td className="py-2 text-ink-500">{fmtDateTime(r.created_at)}</td>
                    <td className="py-2">{r.profiles?.full_name ?? '—'}</td>
                    <td className="py-2 text-ink-500">{r.requisition_items?.length ?? 0} รายการ</td>
                    <td className="py-2">
                      <span className={statusClass(r.status)}>{STATUS_TH[r.status]}</span>
                    </td>
                    <td className="py-2">
                      {r.evidence_web_link ? (
                        <a href={r.evidence_web_link} target="_blank" rel="noreferrer" className="underline">
                          ดูรูป
                        </a>
                      ) : (
                        <span className="text-danger-txt">ไม่มี</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!reqs.loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-ink-400">
                      ยังไม่มีคำขอในช่วงที่เลือก
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-md">ต้องสั่งซื้อเพิ่ม</h2>
            <Link to="/admin/stock" className="text-sm underline">
              ดูสต็อก
            </Link>
          </div>
          {items.loading && <Loading />}
          <ul className="space-y-2">
            {low.slice(0, 12).map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{i.name}</span>
                <span className={i.qty_on_hand === 0 ? 'badge-dang' : 'badge-warn'}>
                  {i.qty_on_hand}/{i.min_qty}
                </span>
              </li>
            ))}
            {!items.loading && low.length === 0 && (
              <li className="text-sm text-success-txt">สต็อกครบทุกรายการ</li>
            )}
          </ul>
        </section>
      </div>
    </div>
  )
}
