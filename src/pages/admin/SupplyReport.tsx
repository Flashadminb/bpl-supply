import { useMemo, useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import {
  listAllItemsForAdmin,
  listBadReturns,
  listByRows,
  listCategories,
  listDepartments,
  listOpenBorrowings,
  listProfiles,
  listRequisitionsBetween,
} from '../../lib/api'
import { ErrorBox, Loading } from '../../components/ui'
import { DateRangePicker } from '../../components/DateRangePicker'
import { SearchSelect, type Option } from '../../components/SearchSelect'
import {
  BarsH,
  Columns,
  DataTable,
  Donut,
  Kpi,
  PanelHead,
  STATUS,
  type Datum,
} from '../../components/charts'
import { STATUS_TH, fmtDateTime } from '../../lib/format'

/**
 * รายงานฝั่งวัสดุสิ้นเปลือง
 *
 * ตั้งใจให้กรองได้อิสระแล้วอ่านออกทันที ไม่ต้องส่งออกไปนั่งทำต่อในชีต
 * ตัวกรองทุกตัวมีผลกับทั้งหน้า ทั้งตัวเลขบนสุด กราฟ และตารางล่าง
 */

function isoDay(offset: number): string {
  return new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10)
}

const dayKey = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(iso))
const dayShort = (k: string) => {
  const [, m, d] = k.split('-')
  return `${d}/${m}`
}
const hourOf = (iso: string) =>
  Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', hour12: false })
      .format(new Date(iso))
      .slice(0, 2),
  )

const COND_TH: Record<string, string> = { damaged: 'ชำรุด', lost: 'สูญหาย', ok: 'ใช้ได้' }

export default function SupplyReport() {
  const [from, setFrom] = useState(isoDay(-30))
  const [to, setTo] = useState(isoDay(0))
  const [dept, setDept] = useState('')
  const [cat, setCat] = useState('')
  const [person, setPerson] = useState('')
  const [item, setItem] = useState('')
  const [status, setStatus] = useState('')
  const [kind, setKind] = useState('') // '' | returnable | consumable

  const range = useMemo(
    () => ({
      fromISO: new Date(`${from}T00:00:00`).toISOString(),
      toISO: new Date(`${to}T23:59:59`).toISOString(),
    }),
    [from, to],
  )

  const reqs = useAsync(() => listRequisitionsBetween(range.fromISO, range.toISO), [range])
  const items = useAsync(() => listAllItemsForAdmin(), [])
  const cats = useAsync(() => listCategories(), [])
  const depts = useAsync(() => listDepartments(), [])
  const people = useAsync(() => listProfiles(), [])
  const borrow = useAsync(() => listOpenBorrowings(false), [])
  const bad = useAsync(() => listBadReturns(range.fromISO, range.toISO), [range])
  const byRows = useAsync(() => listByRows({ status: 'all', ...range, limit: 500 }), [range])

  const itemById = useMemo(
    () => new Map((items.data ?? []).map((i) => [i.id, i])),
    [items.data],
  )
  const catName = useMemo(() => new Map((cats.data ?? []).map((c) => [c.id, c.name])), [cats.data])

  const peopleOpts: Option[] = useMemo(
    () =>
      (people.data ?? [])
        .filter((p) => p.is_active)
        .map((p) => ({
          value: p.id,
          label: p.full_name,
          hint: `${p.employee_code}${p.dept_code ? ` · ${p.dept_code}` : ''}`,
        })),
    [people.data],
  )
  const itemOpts: Option[] = useMemo(
    () =>
      (items.data ?? [])
        .filter((i) => i.is_active)
        .map((i) => ({ value: String(i.id), label: i.name, hint: i.sku })),
    [items.data],
  )

  /** ใบเบิกที่ผ่านตัวกรองระดับ "ใบ" */
  const heads = useMemo(() => {
    let out = reqs.data ?? []
    if (dept) out = out.filter((r) => r.profiles?.dept_code === dept)
    if (person) out = out.filter((r) => r.requester_id === person)
    if (status) out = out.filter((r) => r.status === status)
    return out
  }, [reqs.data, dept, person, status])

  /** บรรทัดรายการที่ผ่านตัวกรองระดับ "ของ" — ตัวเลขส่วนใหญ่นับจากตรงนี้ */
  const lines = useMemo(() => {
    const out: {
      reqId: string
      ref: string
      at: string
      who: string
      deptCode: string | null
      itemId: number
      name: string
      unit: string
      qty: number
      catId: number | null
      returnable: boolean
    }[] = []

    for (const r of heads) {
      for (const l of r.requisition_items ?? []) {
        if (l.status === 'rejected') continue
        const meta = itemById.get(l.item_id)
        const catId = meta?.category_id ?? null
        const returnable = Boolean(meta?.is_returnable)
        if (cat && String(catId ?? '') !== cat) continue
        if (item && String(l.item_id) !== item) continue
        if (kind === 'returnable' && !returnable) continue
        if (kind === 'consumable' && returnable) continue
        out.push({
          reqId: r.id,
          ref: r.ref_no,
          at: r.created_at,
          who: r.profiles?.full_name ?? '—',
          deptCode: r.profiles?.dept_code ?? null,
          itemId: l.item_id,
          name: l.items?.name ?? meta?.name ?? `#${l.item_id}`,
          unit: l.items?.unit ?? meta?.unit ?? '',
          qty: l.qty_approved ?? l.qty_requested,
          catId,
          returnable,
        })
      }
    }
    return out
  }, [heads, itemById, cat, item, kind])

  const days = Math.max(1, Math.round((Date.parse(range.toISO) - Date.parse(range.fromISO)) / 864e5))
  const units = lines.reduce((n, l) => n + l.qty, 0)
  const reqCount = new Set(lines.map((l) => l.reqId)).size
  const peopleCount = new Set(lines.map((l) => l.who)).size
  const perDay = (units / days).toFixed(1)

  const low = (items.data ?? []).filter((i) => i.is_active && i.qty_on_hand <= i.min_qty)
  const openBorrow = (borrow.data ?? []).filter((b) => !dept || b.requester_dept === dept)

  /* ------------------------------------------------------------- กราฟ */
  const daily: Datum[] = useMemo(() => {
    const map = new Map<string, number>()
    for (let i = days - 1; i >= 0; i--) {
      map.set(dayKey(new Date(Date.parse(range.toISO) - i * 864e5).toISOString()), 0)
    }
    for (const l of lines) {
      const k = dayKey(l.at)
      if (map.has(k)) map.set(k, (map.get(k) ?? 0) + l.qty)
    }
    return [...map.entries()].map(([k, v]) => ({ label: k, value: v, sub: dayShort(k) }))
  }, [lines, days, range.toISO])

  const topItems: Datum[] = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of lines) m.set(l.name, (m.get(l.name) ?? 0) + l.qty)
    return [...m.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  }, [lines])

  const topPeople: Datum[] = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of lines) m.set(l.who, (m.get(l.who) ?? 0) + l.qty)
    return [...m.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  }, [lines])

  const byDept: Datum[] = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of lines) m.set(l.deptCode ?? 'ไม่ระบุ', (m.get(l.deptCode ?? 'ไม่ระบุ') ?? 0) + l.qty)
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
  }, [lines])

  const byCat: Datum[] = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of lines) {
      const name = l.catId ? (catName.get(l.catId) ?? 'ไม่ระบุหมวด') : 'ไม่ระบุหมวด'
      m.set(name, (m.get(name) ?? 0) + l.qty)
    }
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
  }, [lines, catName])

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
        value: heads.filter((r) => r.status === s).length,
        color: color[s],
      }))
      .filter((d) => d.value > 0)
  }, [heads])

  /** ช่วงเวลาที่คนมาเบิกกันมากที่สุด — ใช้จัดคนเฝ้าห้องของ */
  const byHour: Datum[] = useMemo(() => {
    const m = new Map<number, number>()
    for (let h = 0; h < 24; h++) m.set(h, 0)
    for (const l of lines) m.set(hourOf(l.at), (m.get(hourOf(l.at)) ?? 0) + 1)
    return [...m.entries()].map(([h, v]) => ({
      label: String(h).padStart(2, '0'),
      value: v,
      sub: `${String(h).padStart(2, '0')}น`,
    }))
  }, [lines])

  const loading = reqs.loading || items.loading

  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-lg">รายงานวัสดุสิ้นเปลือง</h1>
        <button type="button" className="btn-soft h-tap px-3 text-sm" onClick={reqs.reload}>
          รีเฟรช
        </button>
      </div>

      {/* ----------------------------------------------------- ตัวกรอง */}
      <section className="panel mb-4 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <DateRangePicker from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b) }} />

          <div>
            <label className="label mb-1" htmlFor="f-dept">แผนก</label>
            <select id="f-dept" className="input h-tap w-[150px]" value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">ทุกแผนก</option>
              {(depts.data ?? []).map((d) => (
                <option key={d.code} value={d.code}>{d.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label mb-1" htmlFor="f-cat">หมวด</label>
            <select id="f-cat" className="input h-tap w-[150px]" value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">ทุกหมวด</option>
              {(cats.data ?? []).map((c) => (
                <option key={c.id} value={String(c.id)}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label mb-1" htmlFor="f-kind">ประเภท</label>
            <select id="f-kind" className="input h-tap w-[150px]" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">ทุกประเภท</option>
              <option value="consumable">ใช้แล้วหมด</option>
              <option value="returnable">ยืม-คืน</option>
            </select>
          </div>

          <SearchSelect
            label="รายคน"
            value={person}
            options={peopleOpts}
            onChange={setPerson}
            allLabel="ทุกคน"
            placeholder="พิมพ์ชื่อหรือรหัสพนักงาน"
          />

          <SearchSelect
            label="รายการวัสดุ"
            value={item}
            options={itemOpts}
            onChange={setItem}
            allLabel="ทุกรายการ"
            placeholder="พิมพ์ชื่อหรือ SKU"
          />

          <div>
            <label className="label mb-1" htmlFor="f-status">สถานะใบเบิก</label>
            <select id="f-status" className="input h-tap w-[150px]" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">ทุกสถานะ</option>
              <option value="approved">อนุมัติแล้ว</option>
              <option value="partial">อนุมัติบางส่วน</option>
              <option value="pending">รออนุมัติ</option>
              <option value="rejected">ปฏิเสธ</option>
            </select>
          </div>

          {(dept || cat || person || item || status || kind) && (
            <button
              type="button"
              className="btn-ghost h-tap px-3 text-sm"
              onClick={() => {
                setDept(''); setCat(''); setPerson(''); setItem(''); setStatus(''); setKind('')
              }}
            >
              ล้างตัวกรอง
            </button>
          )}
        </div>
      </section>

      {loading && <Loading />}
      {reqs.error && <ErrorBox message={reqs.error} onRetry={reqs.reload} />}

      {/* ------------------------------------------------------ ตัวเลขหลัก */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi hue={0} icon="📦" label="จำนวนที่เบิก" value={units.toLocaleString('th-TH')} sub={`${perDay} ชิ้น/วัน`} />
        <Kpi hue={1} icon="🧾" label="ใบเบิก" value={reqCount} sub={`${lines.length} บรรทัดรายการ`} />
        <Kpi hue={2} icon="👥" label="คนที่เบิก" value={peopleCount} sub={`ใน ${days} วัน`} />
        <Kpi
          icon="⚠"
          label="ต่ำกว่าขั้นต่ำ"
          value={low.length}
          sub={`หมดแล้ว ${low.filter((i) => i.qty_on_hand === 0).length}`}
          tone={low.length > 0 ? 'danger' : 'ok'}
        />
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi hue={0} icon="↩" label="ยืม-คืนค้าง" value={openBorrow.reduce((n, b) => n + b.qty_open, 0)} sub={`${openBorrow.length} รายการ`} />
        <Kpi
          icon="🔧"
          label="คืนมาชำรุด/หาย"
          value={(bad.data ?? []).length}
          sub={`ใน ${days} วัน`}
          tone={(bad.data ?? []).length > 0 ? 'warn' : 'ok'}
        />
        <Kpi hue={2} icon="▤" label="บาร์โค้ด BY" value={(byRows.data ?? []).length} sub={`รอตัด ${(byRows.data ?? []).filter((b) => b.status === 'pending').length}`} />
        <Kpi
          icon="📷"
          label="ใบที่ไม่มีรูป"
          value={heads.filter((r) => !r.evidence_file_id).length}
          sub="อัปรูปไม่สำเร็จแล้วกดต่อ"
          tone={heads.filter((r) => !r.evidence_file_id).length > 0 ? 'warn' : 'ok'}
        />
      </div>

      {/* ---------------------------------------------------------- กราฟ */}
      <section className="panel mb-3 p-4">
        <PanelHead title="จำนวนชิ้นที่เบิกต่อวัน" hint="ชี้ที่แท่งเพื่อดูตัวเลขของวันนั้น" />
        <Columns data={daily} unit="ชิ้น" />
      </section>

      <div className="mb-3 grid gap-3 xl:grid-cols-2">
        <section className="panel p-4">
          <PanelHead title="สัดส่วนตามหมวด" hue={1} />
          <Donut data={byCat} unit="ชิ้น" />
        </section>
        <section className="panel p-4">
          <PanelHead title="สัดส่วนตามแผนก" hue={2} />
          <Donut data={byDept} unit="ชิ้น" />
        </section>
      </div>

      <div className="mb-3 grid gap-3 xl:grid-cols-2">
        <section className="panel p-4">
          <PanelHead title="วัสดุที่เบิกมากที่สุด" hint="10 อันดับแรกตามจำนวนชิ้น" />
          <BarsH data={topItems} unit="ชิ้น" />
          <DataTable rows={topItems} head={['วัสดุ', 'จำนวนชิ้น']} />
        </section>
        <section className="panel p-4">
          <PanelHead title="คนที่เบิกมากที่สุด" hint="10 อันดับแรกตามจำนวนชิ้น" hue={1} />
          <BarsH data={topPeople} unit="ชิ้น" />
          <DataTable rows={topPeople} head={['ผู้เบิก', 'จำนวนชิ้น']} />
        </section>
      </div>

      <div className="mb-3 grid gap-3 xl:grid-cols-2">
        <section className="panel p-4">
          <PanelHead title="ช่วงเวลาที่เบิกกันมากที่สุด" hint="นับเป็นจำนวนบรรทัดรายการ แยกตามชั่วโมง" hue={2} />
          <Columns data={byHour} unit="รายการ" />
        </section>
        <section className="panel p-4">
          <PanelHead title="สถานะใบเบิก" hue={3} />
          <Donut data={byStatus} unit="ใบ" />
        </section>
      </div>

      {/* ------------------------------------------------------ ตารางท้าย */}
      <div className="grid gap-3 xl:grid-cols-[1.4fr_1fr]">
        <section className="panel p-4">
          <PanelHead title="รายการตามตัวกรอง" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-ink-500">
                <tr className="border-b border-line">
                  <th className="py-2 font-medium">เลขที่</th>
                  <th className="py-2 font-medium">เวลา</th>
                  <th className="py-2 font-medium">ผู้เบิก</th>
                  <th className="py-2 font-medium">วัสดุ</th>
                  <th className="py-2 font-medium">จำนวน</th>
                </tr>
              </thead>
              <tbody>
                {lines.slice(0, 40).map((l, i) => (
                  <tr key={`${l.reqId}-${l.itemId}-${i}`} className="border-b border-line last:border-0">
                    <td className="py-2 font-mono text-xs">{l.ref}</td>
                    <td className="py-2 text-ink-500">{fmtDateTime(l.at)}</td>
                    <td className="py-2">{l.who}</td>
                    <td className="py-2">{l.name}</td>
                    <td className="py-2 font-display">
                      {l.qty} {l.unit}
                    </td>
                  </tr>
                ))}
                {!loading && lines.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-ink-400">
                      ไม่มีข้อมูลตามตัวกรอง
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {lines.length > 40 && (
            <p className="mt-2 text-sm text-ink-400">
              แสดง 40 บรรทัดแรกจาก {lines.length} — ตัวเลขและกราฟด้านบนนับครบทั้งหมด
            </p>
          )}
        </section>

        <section className="panel p-4">
          <PanelHead title="คืนมาชำรุด / สูญหาย" hue={3} />
          <ul className="space-y-2 text-sm">
            {(bad.data ?? []).slice(0, 12).map((b) => (
              <li key={b.id} className="border-b border-line pb-2 last:border-0">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <b>{b.requisition_items?.items?.name ?? '—'}</b> {b.qty}{' '}
                    {b.requisition_items?.items?.unit ?? ''}
                  </span>
                  <span className={b.condition === 'lost' ? 'badge-dang' : 'badge-warn'}>
                    {COND_TH[b.condition] ?? b.condition}
                  </span>
                </div>
                <p className="text-xs text-ink-400">
                  {b.profiles?.full_name ?? '—'} · {fmtDateTime(b.created_at)}
                </p>
              </li>
            ))}
            {(bad.data ?? []).length === 0 && (
              <li className="text-sm text-success-txt">ไม่มีของชำรุดหรือสูญหายในช่วงนี้</li>
            )}
          </ul>
        </section>
      </div>
    </div>
  )
}
