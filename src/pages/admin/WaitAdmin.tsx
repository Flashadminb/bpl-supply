import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/useAsync'
import { readableError } from '../../lib/supabase'
import {
  listWaitTruckKpi,
  saveWaitTruckKpi,
  waitSheetPending,
  type WaitTruckKpi,
} from '../../lib/waitTrucks'
import { exportToSheet } from '../../lib/api'
import { PanelHead } from '../../components/charts'
import { ErrorBox, Loading, Toggle } from '../../components/ui'

/**
 * หลังบ้านรถรอลงงาน · เหลือแค่ที่ตั้งเกณฑ์เวลา
 *
 * ตัวเลขกับแดชบอร์ดย้ายไปอยู่ฝั่งหน้างานที่ /wait/stats แล้ว
 * เพราะคนที่ต้องตอบว่าสัปดาห์นี้ดีขึ้นหรือแย่ลง คือหัวหน้าที่ยืนอยู่ในคลัง
 * ถ้าต้องเดินกลับมาเปิดหน้าแอดมินก่อน เขาจะไม่เปิด แล้วก็จะเดาเอาแทน
 *
 * ที่เหลือไว้ตรงนี้คืองานที่ทำปีละไม่กี่ครั้งและต้องเป็นเจ้าของระบบเท่านั้น
 * ซึ่งบังคับที่ RLS ของ wait_truck_kpi ไม่ใช่แค่ซ่อนปุ่ม
 * ผู้ตรวจสอบเปิดหน้านี้ได้แต่เซฟไม่ผ่าน
 *
 * เกณฑ์ที่แก้มีผลกับรถที่นำเข้าหลังจากนี้เท่านั้น
 * คันที่อยู่บนกระดานแล้วถือเกณฑ์เดิมติดตัวไว้ตั้งแต่ตอนนำเข้า
 * ไม่งั้นลดเกณฑ์จาก 120 เป็น 90 แล้วรถเมื่อเดือนก่อนกลายเป็นสายย้อนหลังทั้งแถบ
 */

export default function WaitAdmin() {
  const { profile } = useAuth()
  const canEdit = profile?.role === 'admin'
  const kpi = useAsync(listWaitTruckKpi, [])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-xl">เกณฑ์เวลารถรอลงงาน</h1>
          <p className="text-sm text-ink-500">
            ตัวเลขและแดชบอร์ดย้ายไปอยู่ฝั่งหน้างานแล้ว
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/wait" className="flex h-tap items-center rounded-btn bg-ink px-4 text-sm text-white">
            เปิดกระดาน
          </Link>
          <Link to="/wait/stats" className="flex h-tap items-center rounded-btn border px-4 text-sm">
            แดชบอร์ด
          </Link>
          <Link to="/wait/history" className="flex h-tap items-center rounded-btn border px-4 text-sm">
            ประวัติใครทำอะไร
          </Link>
        </div>
      </div>

      <SheetBackup />

      <section className="rounded-panel bg-surface p-4 shadow-card">
        <PanelHead
          title="เกณฑ์เวลารอลงงาน"
          hint="มีผลกับรถที่นำเข้าหลังจากนี้ · คันที่อยู่บนกระดานแล้วถือเกณฑ์เดิมติดตัวไว้"
          hue={2}
        />
        {kpi.loading && <Loading />}
        {kpi.error && <ErrorBox message={kpi.error} onRetry={kpi.reload} />}
        {kpi.data && <KpiTable rows={kpi.data} canEdit={canEdit} onSaved={kpi.reload} />}
        {!canEdit && (
          <p className="mt-3 text-sm text-ink-400">
            แก้เกณฑ์ได้เฉพาะเจ้าของระบบ · หน้านี้ดูได้อย่างเดียว
          </p>
        )}
      </section>
    </div>
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

/**
 * สำรองประวัติลง Google Sheet
 *
 * กดเอง ไม่ได้ตั้งเวลา · เหตุผลเดียวกับการส่งออกชุดอื่นในระบบนี้
 * งานตั้งเวลาที่ไม่ทำงานคืนหนึ่ง จะเงียบไปเฉย ๆ แล้วไม่มีใครรู้จนกว่าจะต้องใช้ข้อมูล
 * ส่วนปุ่มที่กดเองนั้น คนกดเห็นผลทันทีว่าสำเร็จกี่แถว
 *
 * กดซ้ำกี่ครั้งก็ไม่เกิดแถวซ้ำ เพราะฐานข้อมูลจำตำแหน่งที่เคยเขียนไว้
 * แถวที่เคยส่งแล้วแต่ข้อมูลเปลี่ยน จะถูกเขียนทับที่เดิม
 *
 * ส่งเฉพาะคันที่จบแล้ว คันที่ยังรออยู่บนกระดานยังไม่ใช่ประวัติ
 */
function SheetBackup() {
  const state = useAsync(waitSheetPending, [])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const s = state.data

  async function send() {
    setBusy(true)
    setMsg(null)
    try {
      const res = await exportToSheet({ scope: 'wait' })
      setMsg({
        ok: true,
        text: `เพิ่มใหม่ ${res.appended} แถว · อัปเดตของเดิม ${res.updated} แถว · แท็บ ${res.sheet}`,
      })
      state.reload()
    } catch (e) {
      setMsg({ ok: false, text: readableError(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-panel bg-surface p-4 shadow-card">
      <PanelHead
        title="สำรองประวัติลง Google Sheet"
        hint="กดซ้ำได้ ไม่เกิดแถวซ้ำในชีต · ส่งเฉพาะคันที่ลงงานเสร็จหรือถูกยกเลิกแล้ว"
        hue={1}
        right={
          <a
            href="https://docs.google.com/spreadsheets/d/1KItBMEgie6I9EaWA93N2ISAwr5rn_w5iJtai6cfg2Dg/edit"
            target="_blank"
            rel="noreferrer"
            className="text-sm underline"
          >
            เปิดชีต
          </a>
        }
      />

      {state.loading && <Loading />}
      {state.error && <ErrorBox message={state.error} onRetry={state.reload} />}

      {s && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className={`rounded-card border p-3 ${s.pending > 0 ? 'border-brand-300 bg-brand-50' : ''}`}>
              <p className="text-sm text-ink-500">ยังไม่ส่ง</p>
              <p className="mt-1 font-display text-xl leading-none">{s.pending}</p>
              <p className="mt-1 text-xs text-ink-400">คัน</p>
            </div>
            <div className="rounded-card border p-3">
              <p className="text-sm text-ink-500">ส่งแล้ว</p>
              <p className="mt-1 font-display text-xl leading-none">{s.sent}</p>
              <p className="mt-1 text-xs text-ink-400">คัน</p>
            </div>
            <div className="rounded-card border p-3">
              <p className="text-sm text-ink-500">ส่งล่าสุด</p>
              <p className="mt-1 text-sm font-bold leading-tight">
                {s.last_at
                  ? new Date(s.last_at).toLocaleString('th-TH', {
                      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                    })
                  : 'ยังไม่เคยส่ง'}
              </p>
            </div>
          </div>

          <button
            disabled={busy}
            onClick={() => void send()}
            className="mt-3 h-tap w-full rounded-btn bg-ink text-sm font-extrabold text-white disabled:opacity-50"
          >
            {busy ? 'กำลังส่ง…' : s.pending > 0 ? `ส่งลงชีต · ค้างอยู่ ${s.pending} คัน` : 'ส่งลงชีตอีกครั้ง'}
          </button>

          {msg && (
            <p className={`mt-2 text-sm font-bold ${msg.ok ? 'text-success' : 'text-danger'}`}>
              {msg.text}
            </p>
          )}

          <p className="mt-3 text-xs text-ink-400">
            แท็บในชีตแยกรายเดือน เช่น “รถรอลงงาน 2569-10” · ฐานข้อมูลลบของเกิน 400 วันทิ้งเอง
            ชีตจึงเป็นที่เดียวที่เก็บยาวกว่านั้นได้โดยไม่กินพื้นที่
          </p>
        </>
      )}
    </section>
  )
}
