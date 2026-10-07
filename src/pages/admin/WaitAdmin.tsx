import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/useAsync'
import { readableError } from '../../lib/supabase'
import {
  listWaitTruckKpi,
  saveWaitTruckKpi,
  waitTruckStats,
  type WaitTruckKpi,
} from '../../lib/waitTrucks'
import { DateRangePicker } from '../../components/DateRangePicker'
import { BarsH, Columns, DataTable, Kpi, PanelHead } from '../../components/charts'
import { ErrorBox, Loading, Toggle } from '../../components/ui'

/**
 * หลังบ้านรถรอลงงาน
 *
 * สองเรื่องในหน้าเดียว เพราะคนที่มาดูสถิติคือคนเดียวกับที่จะอยากแก้เกณฑ์
 * ถ้าแยกสองหน้า คนจะดูตัวเลขที่นี่แล้วไปหาที่แก้ไม่เจอ
 *
 * เกณฑ์เวลาแก้ได้เฉพาะเจ้าของระบบ ซึ่งบังคับที่ RLS ของ wait_truck_kpi
 * ไม่ใช่แค่ซ่อนปุ่ม · ผู้ตรวจสอบเปิดหน้านี้ได้แต่เซฟไม่ผ่าน
 *
 * เกณฑ์ที่แก้มีผลกับรถที่นำเข้าหลังจากนี้เท่านั้น
 * คันที่อยู่บนกระดานแล้วถือเกณฑ์เดิมติดตัวไว้ใน kpi_minutes ตั้งแต่ตอนนำเข้า
 * ไม่งั้นลดเกณฑ์จาก 120 เป็น 90 แล้วรถเมื่อเดือนก่อนกลายเป็นสายย้อนหลังทั้งแถบ
 */

const todayKey = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}

export default function WaitAdmin() {
  const { profile } = useAuth()
  const canEditKpi = profile?.role === 'admin'

  const [from, setFrom] = useState(() => addDays(todayKey(), -6))
  const [to, setTo] = useState(todayKey)

  const kpi = useAsync(listWaitTruckKpi, [])
  const stats = useAsync(() => waitTruckStats(from, to), [from, to])
  const s = stats.data

  const okPct = s && s.total > 0 ? Math.round((s.on_time / s.total) * 100) : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-xl">รถรอลงงาน</h1>
          <p className="text-sm text-ink-500">
            นับเฉพาะคันที่กดลงงานเสร็จแล้ว · คันที่ยังค้างยังไม่มีผลแพ้ชนะ
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/wait"
            className="flex h-tap items-center rounded-btn bg-ink px-4 text-sm text-white"
          >
            เปิดกระดาน
          </Link>
          <Link
            to="/wait/upload"
            className="flex h-tap items-center rounded-btn border px-4 text-sm"
          >
            อัปไฟล์
          </Link>
        </div>
      </div>

      {/* ---------------------------------------------------------- แดชบอร์ด */}
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
          <p className="py-8 text-center text-sm text-ink-400">
            บัญชีนี้ยังไม่มีสิทธิ์ดูรถรอลงงาน
          </p>
        )}

        {s && (
          <>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
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
                label="พัสดุที่ลงไปแล้ว"
                value={s.parcels.toLocaleString('th-TH')}
                sub={s.cancelled > 0 ? `ยกเลิก ${s.cancelled} คัน` : undefined}
                hue={3}
              />
            </div>

            <div className="mt-5">
              <h3 className="mb-2 text-sm font-semibold">รถเข้าแต่ละวัน</h3>
              <Columns
                data={s.by_day.map((d) => ({ label: dayShort(d.day), value: d.total }))}
                unit="คัน"
                emptyText="ช่วงนี้ยังไม่มีรถที่ลงงานเสร็จ"
              />
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
                  head={['ประเภทรถ', 'รอเฉลี่ย (นาที)']}
                  rows={s.by_type.map((t) => ({ label: t.vehicle_type, value: t.avg_wait }))}
                  unit="นาที"
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

      {/* -------------------------------------------------------- เกณฑ์เวลา */}
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

function dayShort(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${Number(d)}/${Number(m)}`
}

/**
 * ตารางเกณฑ์
 *
 * เซฟทีละแถว ไม่ใช่ปุ่มเดียวเซฟทั้งตาราง
 * เพราะคนแก้ทีละประเภท และปุ่มเดียวที่เซฟทุกอย่างคือปุ่มที่กดแล้วไม่รู้ว่าเปลี่ยนอะไรไปบ้าง
 */
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
