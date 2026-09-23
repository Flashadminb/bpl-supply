import { useMemo, useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import {
  listAssetHoldings,
  listAssetHistory,
  listAssetIssuesBetween,
  listAssetLinesBetween,
  listAssetTypes,
  listAssets,
  listDepartments,
  listProfiles,
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
import { fmtDateTime, relativeAge } from '../../lib/format'

/**
 * รายงานฝั่งอุปกรณ์ Asset
 *
 * คำถามที่หน้านี้ต้องตอบให้ได้: เครื่องไหนพังบ่อย พังเรื่องอะไร
 * แผนกไหนพังเยอะ ซ่อมนานแค่ไหน และตอนนี้ใครถืออะไรค้างอยู่
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

export default function AssetReport() {
  const [from, setFrom] = useState(isoDay(-30))
  const [to, setTo] = useState(isoDay(0))
  const [type, setType] = useState('')
  const [dept, setDept] = useState('')
  const [person, setPerson] = useState('')
  const [asset, setAsset] = useState('')
  const [issueView, setIssueView] = useState<'all' | 'open' | 'fixed'>('all')
  // รูปที่กดเปิดดูเต็มจอ — เก็บชุดรูปกับตำแหน่งที่กำลังดู

  const range = useMemo(
    () => ({
      fromISO: new Date(`${from}T00:00:00`).toISOString(),
      toISO: new Date(`${to}T23:59:59`).toISOString(),
    }),
    [from, to],
  )

  const types = useAsync(() => listAssetTypes(), [])
  const assets = useAsync(() => listAssets(), [])
  const depts = useAsync(() => listDepartments(), [])
  const people = useAsync(() => listProfiles(), [])
  const held = useAsync(() => listAssetHoldings(false), [])
  const lines = useAsync(() => listAssetLinesBetween(range.fromISO, range.toISO), [range])
  const issues = useAsync(() => listAssetIssuesBetween(range.fromISO, range.toISO), [range])
  const history = useAsync(() => listAssetHistory({ ...range, limit: 1000 }), [range])

  const assetBy = useMemo(() => new Map((assets.data ?? []).map((a) => [a.code, a])), [assets.data])
  const typeName = useMemo(
    () => new Map((types.data ?? []).map((t) => [t.code, t.name])),
    [types.data],
  )

  const assetOpts: Option[] = useMemo(
    () =>
      (assets.data ?? []).map((a) => ({
        value: a.code,
        label: a.code,
        hint: `${a.asset_types?.name ?? a.type_code}${a.dept_code ? ` · ${a.dept_code}` : ''}`,
      })),
    [assets.data],
  )
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

  /** เข้าเงื่อนไขตัวกรองไหม — ใช้ร่วมกันทั้งการเบิกและใบแจ้งชำรุด */
  function passes(code: string): boolean {
    const a = assetBy.get(code)
    if (!a) return false
    if (type && a.type_code !== type) return false
    if (dept && (a.dept_code ?? 'ALL') !== dept && !a.share_depts?.includes(dept)) return false
    if (asset && a.code !== asset) return false
    return true
  }

  /* ------------------------------------------------- ความเคลื่อนไหวการเบิก */
  const moves = useMemo(
    () =>
      (lines.data ?? []).filter((l) => l.asset_txns && passes(l.asset_code)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines.data, assetBy, type, dept, asset],
  )
  const outs = moves.filter((m) => m.asset_txns?.kind === 'out')

  /* ------------------------------------------------------- ใบแจ้งชำรุด */
  const faults = useMemo(() => {
    let out = (issues.data ?? []).filter((i) => passes(i.asset_code))
    if (person) out = out.filter((i) => i.reported_by === person)
    if (issueView === 'open') out = out.filter((i) => !i.resolved_at)
    if (issueView === 'fixed') out = out.filter((i) => Boolean(i.resolved_at))
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issues.data, assetBy, type, dept, asset, person, issueView])

  const openFaults = faults.filter((f) => !f.resolved_at)
  const fixedFaults = faults.filter((f) => f.resolved_at)

  /** เวลาเฉลี่ยตั้งแต่แจ้งจนเคลียร์ — ยิ่งสั้นยิ่งดี */
  const avgFixHours = useMemo(() => {
    if (fixedFaults.length === 0) return null
    const total = fixedFaults.reduce(
      (n, f) => n + (Date.parse(f.resolved_at as string) - Date.parse(f.reported_at)) / 3_600_000,
      0,
    )
    return total / fixedFaults.length
  }, [fixedFaults])

  const pool = (assets.data ?? []).filter((a) => passes(a.code))
  const takenSet = new Set((held.data ?? []).map((h) => h.asset_code))
  const holdings = (held.data ?? []).filter(
    (h) => passes(h.asset_code) && (!person || h.user_id === person),
  )
  const lateHold = holdings.filter((h) => h.due_at && Date.now() > Date.parse(h.due_at))

  const days = Math.max(1, Math.round((Date.parse(range.toISO) - Date.parse(range.fromISO)) / 864e5))

  /* ------------------------------------------------------------- กราฟ */
  const faultByType: Datum[] = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of faults) {
      const t = assetBy.get(f.asset_code)?.type_code ?? 'ไม่ทราบ'
      const name = typeName.get(t) ?? t
      m.set(name, (m.get(name) ?? 0) + 1)
    }
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
  }, [faults, assetBy, typeName])

  const faultByDept: Datum[] = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of faults) {
      const d = assetBy.get(f.asset_code)?.dept_code ?? 'ส่วนกลาง'
      m.set(d, (m.get(d) ?? 0) + 1)
    }
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
  }, [faults, assetBy])

  /** อาการที่เจอบ่อย — ตัดคำให้สั้นพอจัดกลุ่มได้ */
  const faultBySymptom: Datum[] = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of faults) {
      const key = f.symptom.split(/[·(]/)[0].trim().slice(0, 28) || 'ไม่ระบุ'
      m.set(key, (m.get(key) ?? 0) + 1)
    }
    return [...m.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  }, [faults])

  const faultWorst: Datum[] = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of faults) m.set(f.asset_code, (m.get(f.asset_code) ?? 0) + 1)
    return [...m.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  }, [faults])

  const faultPhase: Datum[] = useMemo(
    () => [
      { label: 'แจ้งตอนเบิก', value: faults.filter((f) => f.phase === 'out').length, color: STATUS.warn },
      { label: 'แจ้งตอนคืน', value: faults.filter((f) => f.phase === 'in').length, color: STATUS.danger },
      { label: 'ไม่ระบุ', value: faults.filter((f) => !f.phase).length, color: STATUS.mute },
    ],
    [faults],
  )

  const faultDaily: Datum[] = useMemo(() => {
    const m = new Map<string, number>()
    for (let i = days - 1; i >= 0; i--) {
      m.set(dayKey(new Date(Date.parse(range.toISO) - i * 864e5).toISOString()), 0)
    }
    for (const f of faults) {
      const k = dayKey(f.reported_at)
      if (m.has(k)) m.set(k, (m.get(k) ?? 0) + 1)
    }
    return [...m.entries()].map(([k, v]) => ({ label: k, value: v, sub: dayShort(k) }))
  }, [faults, days, range.toISO])

  const busiest: Datum[] = useMemo(() => {
    const m = new Map<string, number>()
    for (const o of outs) m.set(o.asset_code, (m.get(o.asset_code) ?? 0) + 1)
    return [...m.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  }, [outs])

  const statusMix: Datum[] = useMemo(
    () => [
      {
        label: 'ว่าง',
        value: pool.filter((a) => a.is_enabled && !takenSet.has(a.code)).length,
        color: STATUS.ok,
      },
      { label: 'ถูกยืม', value: pool.filter((a) => takenSet.has(a.code)).length, color: STATUS.warn },
      { label: 'ปิดซ่อม', value: pool.filter((a) => !a.is_enabled).length, color: STATUS.danger },
    ],
    [pool, takenSet],
  )

  /** ประวัติการเบิก-คืนตามตัวกรอง — คืนไปแล้วก็ยังอยู่ในนี้ */
  const histRows = useMemo(() => {
    let out = (history.data ?? []).filter((h) => passes(h.asset_code))
    if (person) out = out.filter((h) => h.user_id === person)
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.data, assetBy, type, dept, asset, person])

  /** ถือเฉลี่ยนานแค่ไหนต่อครั้ง นับเฉพาะที่คืนแล้ว */
  const avgHeld = useMemo(() => {
    const done = histRows.filter((h) => h.held_hours !== null)
    if (done.length === 0) return null
    return done.reduce((n, h) => n + (h.held_hours ?? 0), 0) / done.length
  }, [histRows])

  const loading = assets.loading || issues.loading || lines.loading

  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-lg">รายงานอุปกรณ์ Asset</h1>
        <button
          type="button"
          className="btn-soft h-tap px-3 text-sm"
          onClick={() => {
            issues.reload()
            lines.reload()
            held.reload()
          }}
        >
          รีเฟรช
        </button>
      </div>

      {/* ----------------------------------------------------- ตัวกรอง */}
      <section className="panel mb-4 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <DateRangePicker from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b) }} />

          <div>
            <label className="label mb-1" htmlFor="a-type">ประเภท</label>
            <select id="a-type" className="input h-tap w-[160px]" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">ทุกประเภท</option>
              {(types.data ?? []).map((t) => (
                <option key={t.code} value={t.code}>{t.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label mb-1" htmlFor="a-dept">แผนก</label>
            <select id="a-dept" className="input h-tap w-[150px]" value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">ทุกแผนก</option>
              {(depts.data ?? []).map((d) => (
                <option key={d.code} value={d.code}>{d.name}</option>
              ))}
            </select>
          </div>

          <SearchSelect
            label="รายเครื่อง"
            value={asset}
            options={assetOpts}
            onChange={setAsset}
            allLabel="ทุกเครื่อง"
            placeholder="พิมพ์รหัสเครื่อง"
            width="w-[200px]"
          />

          <SearchSelect
            label="รายคน"
            value={person}
            options={peopleOpts}
            onChange={setPerson}
            allLabel="ทุกคน"
            placeholder="พิมพ์ชื่อหรือรหัสพนักงาน"
          />

          <div>
            <label className="label mb-1" htmlFor="a-issue">ใบแจ้งชำรุด</label>
            <select
              id="a-issue"
              className="input h-tap w-[150px]"
              value={issueView}
              onChange={(e) => setIssueView(e.target.value as typeof issueView)}
            >
              <option value="all">ทั้งหมด</option>
              <option value="open">ยังไม่เคลียร์</option>
              <option value="fixed">เคลียร์แล้ว</option>
            </select>
          </div>

          {(type || dept || person || asset || issueView !== 'all') && (
            <button
              type="button"
              className="btn-ghost h-tap px-3 text-sm"
              onClick={() => {
                setType(''); setDept(''); setPerson(''); setAsset(''); setIssueView('all')
              }}
            >
              ล้างตัวกรอง
            </button>
          )}
        </div>
      </section>

      {loading && <Loading />}
      {issues.error && <ErrorBox message={issues.error} onRetry={issues.reload} />}

      {/* ------------------------------------------------------ ตัวเลขหลัก */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi hue={0} icon="🔧" label="ใบแจ้งชำรุด" value={faults.length} sub={`ใน ${days} วัน`} />
        <Kpi
          icon="⚠"
          label="ยังไม่เคลียร์"
          value={openFaults.length}
          sub={`เคลียร์แล้ว ${fixedFaults.length}`}
          tone={openFaults.length > 0 ? 'danger' : 'ok'}
        />
        <Kpi
          hue={2}
          icon="⏱"
          label="เวลาซ่อมเฉลี่ย"
          value={
            avgFixHours === null
              ? '—'
              : avgFixHours < 24
                ? `${avgFixHours.toFixed(1)} ชม.`
                : `${(avgFixHours / 24).toFixed(1)} วัน`
          }
          sub="ตั้งแต่แจ้งจนกดเคลียร์"
        />
        <Kpi
          hue={3}
          icon="📉"
          label="อัตราพัง"
          value={pool.length > 0 ? `${((faults.length / pool.length) * 100).toFixed(1)}%` : '—'}
          sub={`${faults.length} ใบ ต่อ ${pool.length} เครื่อง`}
          tone={pool.length > 0 && faults.length / pool.length > 0.2 ? 'warn' : 'plain'}
        />
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          hue={0}
          icon="📤"
          label="ครั้งที่เบิก"
          value={histRows.length}
          sub={
            avgHeld === null
              ? `คืนแล้ว ${histRows.filter((h) => !h.still_out).length}`
              : `ถือเฉลี่ย ${avgHeld < 24 ? `${avgHeld.toFixed(1)} ชม.` : `${(avgHeld / 24).toFixed(1)} วัน`}`
          }
        />
        <Kpi hue={1} icon="🔒" label="ถูกยืมอยู่" value={holdings.length} sub={`จาก ${pool.length} เครื่อง`} />
        <Kpi
          icon="⏰"
          label="เลยเวลาคืน"
          value={lateHold.length}
          sub="วัดจากกะของเจ้าตัว"
          tone={lateHold.length > 0 ? 'danger' : 'ok'}
        />
        <Kpi
          icon="🛠"
          label="ปิดซ่อมอยู่"
          value={pool.filter((a) => !a.is_enabled).length}
          sub="เบิกไม่ได้"
          tone={pool.filter((a) => !a.is_enabled).length > 0 ? 'warn' : 'ok'}
        />
      </div>

      {/* ---------------------------------------------------------- กราฟ */}
      <section className="panel mb-3 p-4">
        <PanelHead title="ใบแจ้งชำรุดต่อวัน" hint="ดูว่ามีช่วงไหนพังรัวผิดปกติไหม" hue={3} />
        <Columns data={faultDaily} unit="ใบ" />
      </section>

      <div className="mb-3 grid gap-3 xl:grid-cols-2">
        <section className="panel p-4">
          <PanelHead title="พังแยกตามประเภทเครื่อง" />
          <Donut data={faultByType} unit="ใบ" />
        </section>
        <section className="panel p-4">
          <PanelHead title="พังแยกตามแผนก" hue={1} />
          <Donut data={faultByDept} unit="ใบ" />
        </section>
      </div>

      <div className="mb-3 grid gap-3 xl:grid-cols-2">
        <section className="panel p-4">
          <PanelHead title="อาการที่เจอบ่อยที่สุด" hint="จัดกลุ่มจากข้อความที่หน้างานแจ้ง" hue={3} />
          <BarsH data={faultBySymptom} unit="ใบ" />
          <DataTable rows={faultBySymptom} head={['อาการ', 'จำนวนใบ']} />
        </section>
        <section className="panel p-4">
          <PanelHead title="เครื่องที่พังบ่อยที่สุด" hint="ตัวที่ติดอันดับนี้ควรพิจารณาเปลี่ยน" hue={3} />
          <BarsH data={faultWorst} unit="ใบ" />
          <DataTable rows={faultWorst} head={['เครื่อง', 'จำนวนใบ']} />
        </section>
      </div>

      <div className="mb-3 grid gap-3 xl:grid-cols-2">
        <section className="panel p-4">
          <PanelHead
            title="แจ้งตอนไหน"
            hint="แจ้งตอนเบิกคือเจอก่อนใช้ · แจ้งตอนคืนคือพังระหว่างใช้งาน"
            hue={2}
          />
          <Donut data={faultPhase} unit="ใบ" />
        </section>
        <section className="panel p-4">
          <PanelHead title="สถานะเครื่องตอนนี้" hue={1} />
          <Donut data={statusMix} unit="เครื่อง" />
        </section>
      </div>

      <section className="panel mb-3 p-4">
        <PanelHead title="เครื่องที่ถูกหยิบบ่อยที่สุด" hint="นับจำนวนครั้งที่ถูกเบิกในช่วงที่เลือก" />
        <BarsH data={busiest} unit="ครั้ง" />
        <DataTable rows={busiest} head={['เครื่อง', 'ครั้งที่เบิก']} />
      </section>

      {/* ------------------------------------------------------ ตารางท้าย */}
      <div className="grid gap-3 xl:grid-cols-[1.3fr_1fr]">
        <section className="panel p-4">
          <PanelHead title="ใบแจ้งชำรุดตามตัวกรอง" hue={3} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-ink-500">
                <tr className="border-b border-line">
                  <th className="py-2 font-medium">เครื่อง</th>
                  <th className="py-2 font-medium">อาการ</th>
                  <th className="py-2 font-medium">แจ้งเมื่อ</th>
                  <th className="py-2 font-medium">ผู้แจ้ง</th>
                  <th className="py-2 font-medium">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {faults.slice(0, 40).map((f) => (
                  <tr key={f.id} className="border-b border-line last:border-0">
                    <td className="py-2 font-display">{f.asset_code}</td>
                    <td className="py-2">{f.symptom}</td>
                    <td className="py-2 text-ink-500">{fmtDateTime(f.reported_at)}</td>
                    <td className="py-2">{f.reported_name ?? '—'}</td>
                    <td className="py-2">
                      {f.resolved_at ? (
                        <span className="badge-ok">เคลียร์แล้ว</span>
                      ) : (
                        <span className="badge-warn">ค้าง {relativeAge(f.reported_at)}</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!loading && faults.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-ink-400">
                      ไม่มีใบแจ้งชำรุดตามตัวกรอง
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {faults.length > 40 && (
            <p className="mt-2 text-sm text-ink-400">
              แสดง 40 ใบแรกจาก {faults.length} — ตัวเลขด้านบนนับครบทั้งหมด
            </p>
          )}
        </section>

        <section className="panel p-4">
          <PanelHead title="ถืออยู่ตอนนี้" hue={1} />
          <ul className="space-y-2 text-sm">
            {holdings.slice(0, 15).map((h) => {
              const late = h.due_at && Date.now() > Date.parse(h.due_at)
              return (
                <li key={h.out_item_id} className="border-b border-line pb-2 last:border-0">
                  <div className="flex items-start justify-between gap-2">
                    <b className="font-display">{h.asset_code}</b>
                    <span className={late ? 'badge-dang' : 'badge-mute'}>
                      {relativeAge(h.taken_at)}
                    </span>
                  </div>
                  <p className="text-xs text-ink-400">
                    {h.holder_name} {h.holder_code}
                    {h.holder_dept ? ` · ${h.holder_dept}` : ''}
                  </p>
                </li>
              )
            })}
            {holdings.length === 0 && (
              <li className="text-sm text-success-txt">ไม่มีเครื่องค้างตามตัวกรองนี้</li>
            )}
          </ul>
          {holdings.length > 15 && (
            <p className="mt-2 text-sm text-ink-400">และอีก {holdings.length - 15} เครื่อง</p>
          )}
        </section>
      </div>
    </div>
  )
}
