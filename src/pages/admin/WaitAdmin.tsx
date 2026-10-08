import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/useAsync'
import { readableError } from '../../lib/supabase'
import {
  listWaitTruckKpi,
  saveWaitTruckKpi,
  waitTruckCompare,
  waitTruckStats,
  type WaitStats,
  type WaitTruckKpi,
} from '../../lib/waitTrucks'
import { DateRangePicker } from '../../components/DateRangePicker'
import { BarsH, Columns, DataTable, Kpi, PanelHead } from '../../components/charts'
import { ErrorBox, Loading, Toggle } from '../../components/ui'

/**
 * หลังบ้านรถรอลงงาน
 *
 * สามเรื่องในหน้าเดียว — สรุปช่วงเดียว เทียบสองช่วง และเกณฑ์เวลา
 * อยู่ด้วยกันเพราะคนที่มาดูตัวเลขคือคนเดียวกับที่จะอยากแก้เกณฑ์
 * แยกสามหน้าคือทำให้เขาดูตัวเลขที่นี่แล้วไปหาที่แก้ไม่เจอ
 *
 * เกณฑ์เวลาแก้ได้เฉพาะเจ้าของระบบ ซึ่งบังคับที่ RLS ของ wait_truck_kpi
 * ไม่ใช่แค่ซ่อนปุ่ม · ผู้ตรวจสอบเปิดหน้านี้ได้แต่เซฟไม่ผ่าน
 *
 * เกณฑ์ที่แก้มีผลกับรถที่นำเข้าหลังจากนี้เท่านั้น
 * คันที่อยู่บนกระดานแล้วถือเกณฑ์เดิมติดตัวไว้ตั้งแต่ตอนนำเข้า
 * ไม่งั้นลดเกณฑ์จาก 120 เป็น 90 แล้วรถเมื่อเดือนก่อนกลายเป็นสายย้อนหลังทั้งแถบ
 */

const p2 = (n: number) => String(n).padStart(2, '0')

const todayKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${p2(dt.getMonth() + 1)}-${p2(dt.getDate())}`
}

const dayShort = (iso: string) => {
  const [, m, d] = iso.split('-')
  return `${Number(d)}/${Number(m)}`
}

const nf = (n: number) => n.toLocaleString('th-TH')

export default function WaitAdmin() {
  const { profile } = useAuth()
  const canEditKpi = profile?.role === 'admin'

  const [tab, setTab] = useState<'one' | 'two'>('one')
  const kpi = useAsync(listWaitTruckKpi, [])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-xl">รถรอลงงาน</h1>
          <p className="text-sm text-ink-500">
            นับเฉพาะคันที่กดลงงานเสร็จแล้ว · คันที่ยังค้างยังไม่มีผลแพ้ชนะ
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/wait" className="flex h-tap items-center rounded-btn bg-ink px-4 text-sm text-white">
            เปิดกระดาน
          </Link>
          <Link to="/wait/history" className="flex h-tap items-center rounded-btn border px-4 text-sm">
            ประวัติใครทำอะไร
          </Link>
          <Link to="/wait/tv" className="flex h-tap items-center rounded-btn border px-4 text-sm">
            จอทีวี
          </Link>
        </div>
      </div>

      <div className="flex gap-2">
        <TabBtn on={tab === 'one'} onClick={() => setTab('one')}>สรุปช่วงเดียว</TabBtn>
        <TabBtn on={tab === 'two'} onClick={() => setTab('two')}>เทียบสองช่วง</TabBtn>
      </div>

      {tab === 'one' ? <OneRange /> : <TwoRanges />}

      <section className="rounded-panel bg-surface p-4 shadow-card">
        <PanelHead
          title="เกณฑ์เวลารอลงงาน"
          hint="มีผลกับรถที่นำเข้าหลังจากนี้ · คันที่อยู่บนกระดานแล้วถือเกณฑ์เดิมติดตัวไว้"
          hue={2}
        />
        {kpi.loading && <Loading />}
        {kpi.error && <ErrorBox message={kpi.error} onRetry={kpi.reload} />}
        {kpi.data && <KpiTable rows={kpi.data} canEdit={canEditKpi} onSaved={kpi.reload} />}
        {!canEditKpi && (
          <p className="mt-3 text-sm text-ink-400">
            แก้เกณฑ์ได้เฉพาะเจ้าของระบบ · หน้านี้ดูได้อย่างเดียว
          </p>
        )}
      </section>
    </div>
  )
}

function TabBtn({
  on,
  onClick,
  children,
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`h-tap rounded-btn px-4 text-sm font-bold ${
        on ? 'bg-ink text-white' : 'border bg-surface text-ink-600'
      }`}
    >
      {children}
    </button>
  )
}

/* ------------------------------------------------------------ ช่วงเดียว */

function OneRange() {
  const [from, setFrom] = useState(() => addDays(todayKey(), -6))
  const [to, setTo] = useState(todayKey)
  const stats = useAsync(() => waitTruckStats(from, to), [from, to])
  const s = stats.data

  return (
    <section className="rounded-panel bg-surface p-4 shadow-card">
      <PanelHead
        title="ผลงานตามช่วงวัน"
        hint="แบ่งวันตามเวลาไทย กะดึกจึงไม่ถูกนับไปเป็นของวันถัดไป"
        right={
          <DateRangePicker
            from={from}
            to={to}
            onChange={(a, b) => {
              setFrom(a)
              setTo(b)
            }}
          />
        }
      />

      {stats.loading && <Loading />}
      {stats.error && <ErrorBox message={stats.error} onRetry={stats.reload} />}
      {!stats.loading && !stats.error && !s && (
        <p className="py-8 text-center text-sm text-ink-400">บัญชีนี้ยังไม่มีสิทธิ์ดูรถรอลงงาน</p>
      )}

      {s && (
        <>
          <Cards s={s} />

          <div className="mt-5">
            <h3 className="mb-2 text-sm font-semibold">รถเข้าแต่ละวัน</h3>
            <Columns
              data={s.by_day.map((d) => ({ label: dayShort(d.day), value: d.total }))}
              unit="คัน"
              emptyText="ช่วงนี้ยังไม่มีรถที่ลงงานเสร็จ"
            />
          </div>

          <div className="mt-5">
            <h3 className="mb-2 text-sm font-semibold">พัสดุแต่ละวัน · งาน DO เทียบกับที่ไม่ใช่ DO</h3>
            <StackedDays rows={s.by_day} />
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold">ลงงานทันเวลา แยกตามประเภทรถ</h3>
              <BarsH
                data={s.by_type.map((t) => ({
                  label: `${t.vehicle_type} · ${t.on_time}/${t.total} คัน`,
                  value: t.total > 0 ? Math.round((t.on_time / t.total) * 100) : 0,
                }))}
                unit="%"
                max={100}
                emptyText="ยังไม่มีข้อมูล"
              />
              <DataTable
                head={['ประเภทรถ', 'พัสดุงาน DO']}
                rows={s.by_type.map((t) => ({ label: t.vehicle_type, value: t.parcels_do }))}
                unit="ชิ้น"
              />
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold">สถานีต้นทางที่ส่งมามากที่สุด</h3>
              <BarsH
                data={s.by_station.slice(0, 10).map((x) => ({
                  label: x.from_station,
                  value: x.total,
                }))}
                unit="คัน"
                emptyText="ยังไม่มีข้อมูล"
              />
              <DataTable
                head={['สถานีต้นทาง', 'รอเฉลี่ย (นาที)']}
                rows={s.by_station.map((x) => ({ label: x.from_station, value: x.avg_wait }))}
                unit="นาที"
              />
            </div>
          </div>
        </>
      )}
    </section>
  )
}

function Cards({ s }: { s: WaitStats }) {
  const okPct = s.total > 0 ? Math.round((s.on_time / s.total) * 100) : null
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
      <Kpi icon="🚚" label="รถที่ลงงานเสร็จ" value={s.total} hue={0} />
      <Kpi
        icon="✅"
        label="ลงงานทันเวลา"
        value={okPct == null ? '—' : okPct + '%'}
        sub={`${s.on_time} จาก ${s.total} คัน`}
        tone={okPct == null ? 'plain' : okPct >= 90 ? 'ok' : okPct >= 70 ? 'warn' : 'danger'}
        hue={1}
      />
      <Kpi
        icon="⏱"
        label="รอเฉลี่ยต่อคัน"
        value={s.avg_wait + ' นาที'}
        sub={`นานสุดเกินเกณฑ์ ${s.worst} นาที`}
        hue={2}
      />
      <Kpi
        icon="📦"
        label="พัสดุงาน DO"
        value={nf(s.parcels_do)}
        sub={`จากทั้งหมด ${nf(s.parcels)} ชิ้น`}
        hue={3}
      />
      <Kpi
        icon="🧱"
        label="พัสดุที่ไม่ใช่ DO"
        value={nf(s.parcels_nondo)}
        sub={s.cancelled > 0 ? `ยกเลิก ${s.cancelled} คัน` : undefined}
        hue={0}
      />
    </div>
  )
}

/**
 * แท่งซ้อนรายวัน · DO กับไม่ใช่ DO
 *
 * ใช้แท่งซ้อนไม่ใช่สองแท่งคู่ เพราะคำถามคือ "วันนั้นสัดส่วน DO เป็นเท่าไหร่"
 * ไม่ใช่ "วันไหน DO เยอะกว่ากัน" · แท่งซ้อนตอบคำถามแรกได้โดยไม่ต้องคิดเลข
 */
function StackedDays({
  rows,
}: {
  rows: { day: string; parcels: number; parcels_do: number; parcels_nondo: number }[]
}) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-400">ยังไม่มีข้อมูล</p>
  }
  const top = Math.max(...rows.map((r) => r.parcels), 1)

  return (
    <>
      <div className="flex items-end gap-2 overflow-x-auto pb-1" style={{ height: 180 }}>
        {rows.map((r) => {
          const h = Math.round((r.parcels / top) * 150)
          const doH = r.parcels > 0 ? Math.round((r.parcels_do / r.parcels) * h) : 0
          return (
            <div key={r.day} className="flex min-w-[42px] flex-1 flex-col items-center justify-end">
              <span className="mb-1 text-[11px] font-bold text-ink-500">{nf(r.parcels)}</span>
              <div
                className="flex w-full max-w-[46px] flex-col-reverse overflow-hidden rounded-t-md"
                style={{ height: Math.max(h, 2) }}
                title={`DO ${nf(r.parcels_do)} · ไม่ใช่ DO ${nf(r.parcels_nondo)}`}
              >
                <div style={{ height: doH, background: '#2BA7D8' }} />
                <div style={{ height: h - doH, background: '#8B5CF6' }} />
              </div>
              <span className="mt-1 text-[11px] text-ink-400">{dayShort(r.day)}</span>
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex gap-4 text-xs font-bold">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: '#2BA7D8' }} />
          งาน DO
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: '#8B5CF6' }} />
          ไม่ใช่งาน DO
        </span>
      </div>
    </>
  )
}

/* ------------------------------------------------------------ สองช่วง */

/**
 * เทียบสองช่วงวัน
 *
 * เลือกช่วงไหนก็ได้ทั้งคู่ · วันเดียวเทียบวันเดียว หรือสัปดาห์เทียบสัปดาห์
 * ฐานข้อมูลเรียกตัวนับเดียวกันสองครั้ง จึงไม่มีทางที่สองฝั่งจะใช้นิยามคนละแบบ
 */
function TwoRanges() {
  const [aFrom, setAFrom] = useState(() => addDays(todayKey(), -6))
  const [aTo, setATo] = useState(todayKey)
  const [bFrom, setBFrom] = useState(() => addDays(todayKey(), -13))
  const [bTo, setBTo] = useState(() => addDays(todayKey(), -7))

  const cmp = useAsync(
    () => waitTruckCompare([aFrom, aTo], [bFrom, bTo]),
    [aFrom, aTo, bFrom, bTo],
  )

  return (
    <section className="rounded-panel bg-surface p-4 shadow-card">
      <PanelHead
        title="เทียบสองช่วงเวลา"
        hint="เลือกจากปฏิทินทั้งสองฝั่ง · ตัวเลขทั้งสองช่วงมาจากตัวนับเดียวกัน"
        hue={1}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border p-3">
          <p className="mb-2 text-sm font-bold" style={{ color: '#1F5FA8' }}>ช่วง ก</p>
          <DateRangePicker
            from={aFrom}
            to={aTo}
            onChange={(x, y) => {
              setAFrom(x)
              setATo(y)
            }}
          />
        </div>
        <div className="rounded-xl border p-3">
          <p className="mb-2 text-sm font-bold" style={{ color: '#6B21A8' }}>ช่วง ข</p>
          <DateRangePicker
            from={bFrom}
            to={bTo}
            onChange={(x, y) => {
              setBFrom(x)
              setBTo(y)
            }}
          />
        </div>
      </div>

      {cmp.loading && <Loading />}
      {cmp.error && <ErrorBox message={cmp.error} onRetry={cmp.reload} />}

      {cmp.data && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b text-left text-ink-500">
                <th className="py-2">ตัวเลข</th>
                <th className="py-2 text-right" style={{ color: '#1F5FA8' }}>ช่วง ก</th>
                <th className="py-2 text-right" style={{ color: '#6B21A8' }}>ช่วง ข</th>
                <th className="py-2 text-right">ต่างกัน</th>
              </tr>
            </thead>
            <tbody>
              <Row k="รถที่ลงงานเสร็จ" a={cmp.data.a.total} b={cmp.data.b.total} unit="คัน" />
              <Row
                k="ลงงานทันเวลา"
                a={pctNum(cmp.data.a.on_time, cmp.data.a.total)}
                b={pctNum(cmp.data.b.on_time, cmp.data.b.total)}
                unit="%"
              />
              <Row k="รอเฉลี่ยต่อคัน" a={cmp.data.a.avg_wait} b={cmp.data.b.avg_wait} unit="นาที" lowerIsBetter />
              <Row k="นานสุดเกินเกณฑ์" a={cmp.data.a.worst} b={cmp.data.b.worst} unit="นาที" lowerIsBetter />
              <Row k="พัสดุทั้งหมด" a={cmp.data.a.parcels} b={cmp.data.b.parcels} unit="ชิ้น" />
              <Row k="พัสดุงาน DO" a={cmp.data.a.parcels_do} b={cmp.data.b.parcels_do} unit="ชิ้น" />
              <Row
                k="พัสดุที่ไม่ใช่ DO"
                a={cmp.data.a.parcels_nondo}
                b={cmp.data.b.parcels_nondo}
                unit="ชิ้น"
              />
              <Row k="ยกเลิก" a={cmp.data.a.cancelled} b={cmp.data.b.cancelled} unit="คัน" lowerIsBetter />
            </tbody>
          </table>

          <p className="mt-3 text-xs text-ink-400">
            ช่อง “ต่างกัน” คือช่วง ก ลบช่วง ข · สีเขียวคือดีขึ้น แดงคือแย่ลง
            ซึ่งแปลกลับทิศให้เองในแถวที่ยิ่งน้อยยิ่งดี
          </p>
        </div>
      )}
    </section>
  )
}

const pctNum = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0)

function Row({
  k,
  a,
  b,
  unit,
  lowerIsBetter,
}: {
  k: string
  a: number
  b: number
  unit: string
  lowerIsBetter?: boolean
}) {
  const diff = a - b
  const better = lowerIsBetter ? diff < 0 : diff > 0
  const color = diff === 0 ? '#6B7280' : better ? '#167C45' : '#C32F34'
  return (
    <tr className="border-b last:border-b-0">
      <td className="py-2">{k}</td>
      <td className="py-2 text-right font-bold">{nf(a)} {unit}</td>
      <td className="py-2 text-right font-bold">{nf(b)} {unit}</td>
      <td className="py-2 text-right font-extrabold" style={{ color }}>
        {diff > 0 ? '+' : ''}{nf(diff)} {unit}
      </td>
    </tr>
  )
}

/* ------------------------------------------------------------ เกณฑ์เวลา */

function KpiTable({
  rows,
  canEdit,
  onSaved,
}: {
  rows: WaitTruckKpi[]
  canEdit: boolean
  onSaved: () => void
}) {
  const [draft, setDraft] = useState<Record<string, WaitTruckKpi>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const val = (r: WaitTruckKpi) => draft[r.vehicle_type] ?? r
  const dirty = (r: WaitTruckKpi) => {
    const d = draft[r.vehicle_type]
    return (
      !!d &&
      (d.wait_minutes !== r.wait_minutes ||
        d.unload_minutes !== r.unload_minutes ||
        d.is_active !== r.is_active)
    )
  }

  function edit(r: WaitTruckKpi, patch: Partial<WaitTruckKpi>) {
    setDraft((p) => ({ ...p, [r.vehicle_type]: { ...val(r), ...patch } }))
  }

  async function save(r: WaitTruckKpi) {
    setBusy(r.vehicle_type)
    setErr(null)
    try {
      await saveWaitTruckKpi(val(r))
      setDraft((p) => {
        const next = { ...p }
        delete next[r.vehicle_type]
        return next
      })
      onSaved()
    } catch (e) {
      setErr(readableError(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      {err && <ErrorBox message={err} />}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b text-left text-ink-500">
              <th className="py-2">ประเภทรถ</th>
              <th className="py-2">รอลงงานได้ (นาที)</th>
              <th className="py-2">ลงงานให้เสร็จใน (นาที)</th>
              <th className="py-2">ใช้งาน</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const v = val(r)
              return (
                <tr key={r.vehicle_type} className="border-b last:border-b-0">
                  <td className="py-2 font-mono font-bold">{r.vehicle_type}</td>
                  <td className="py-2">
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      disabled={!canEdit}
                      value={v.wait_minutes}
                      onChange={(e) => edit(r, { wait_minutes: Number(e.target.value) })}
                      className="h-tap w-24 rounded-btn border px-2 text-center font-bold disabled:bg-canvas"
                    />
                  </td>
                  <td className="py-2">
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      disabled={!canEdit}
                      value={v.unload_minutes}
                      onChange={(e) => edit(r, { unload_minutes: Number(e.target.value) })}
                      className="h-tap w-24 rounded-btn border px-2 text-center disabled:bg-canvas"
                    />
                  </td>
                  <td className="py-2">
                    {/* Toggle ไม่มีสถานะปิดใช้งาน จึงกันที่ตัว handler แทน
                        ด่านจริงอยู่ที่ RLS อยู่แล้ว ตรงนี้แค่ไม่ให้กดแล้วหลอกตา */}
                    <Toggle
                      checked={v.is_active}
                      onChange={(x) => canEdit && edit(r, { is_active: x })}
                      label=""
                    />
                  </td>
                  <td className="py-2 text-right">
                    {canEdit && dirty(r) && (
                      <button
                        disabled={busy === r.vehicle_type}
                        onClick={() => void save(r)}
                        className="h-tap rounded-btn bg-ink px-4 text-sm font-bold text-white disabled:opacity-50"
                      >
                        {busy === r.vehicle_type ? 'กำลังบันทึก…' : 'บันทึก'}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-ink-400">
        ช่อง “ลงงานให้เสร็จใน” ยังไม่ถูกใช้ตัดสินอะไร เก็บไว้เพราะไฟล์ของหน้างานมีเกณฑ์นี้อยู่แล้ว
      </p>
    </>
  )
}
