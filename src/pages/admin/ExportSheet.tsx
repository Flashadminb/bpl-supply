import { useMemo, useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import {
  countSheetExportRows,
  exportToSheet,
  listDepartments,
  listSheetExportRows,
} from '../../lib/api'
import { EmptyState, ErrorBox, Loading, Spinner } from '../../components/ui'
import { DateRangePicker } from '../../components/DateRangePicker'
import { fmtDateTime } from '../../lib/format'

function isoDay(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 864e5)
  return d.toISOString().slice(0, 10)
}

interface RunLog {
  at: string
  ok: boolean
  message: string
}

type View = 'pending' | 'all'

export default function ExportSheet() {
  const depts = useAsync(() => listDepartments(), [])
  const [from, setFrom] = useState(isoDay(-7))
  const [to, setTo] = useState(isoDay(0))
  const [dept, setDept] = useState('')
  const [view, setView] = useState<View>('pending')
  const [busy, setBusy] = useState(false)
  const [runs, setRuns] = useState<RunLog[]>([])

  // คำนวณครั้งเดียวต่อการเปลี่ยนวัน ไม่งั้นค่าเปลี่ยนทุกครั้งที่ render แล้วโหลดวน
  const range = useMemo(
    () => ({
      fromISO: new Date(`${from}T00:00:00`).toISOString(),
      toISO: new Date(`${to}T23:59:59`).toISOString(),
    }),
    [from, to],
  )

  const tally = useAsync(
    () => countSheetExportRows({ ...range, dept: dept || undefined }),
    [range, dept],
  )
  const feed = useAsync(
    () =>
      listSheetExportRows({
        ...range,
        dept: dept || undefined,
        onlyPending: view === 'pending',
      }),
    [range, dept, view],
  )

  const rows = feed.data ?? []
  const pending = tally.data?.pending ?? 0
  const done = tally.data?.done ?? 0

  async function send() {
    setBusy(true)
    try {
      const res = await exportToSheet({ from: range.fromISO, to: range.toISO })
      setRuns((r) => [
        {
          at: new Date().toISOString(),
          ok: true,
          message: `เพิ่มใหม่ ${res.appended} แถว · อัปเดตของเดิม ${res.updated} แถว · แท็บ ${res.sheet}`,
        },
        ...r,
      ])
      // ดึงใหม่ให้แถวที่เพิ่งส่งเปลี่ยนสถานะทันที
      tally.reload()
      feed.reload()
    } catch (e) {
      setRuns((r) => [{ at: new Date().toISOString(), ok: false, message: (e as Error).message }, ...r])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-lg">ส่งออก Google Sheet</h1>
        <span className="badge-mute">ส่งซ้ำได้ ไม่เกิดแถวซ้ำในชีต</span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div
          className={`rounded-card border p-4 ${
            pending > 0 ? 'border-brand-300 bg-brand-50' : 'border-line bg-surface'
          }`}
        >
          <p className="text-sm text-ink-500">ยังไม่ส่ง</p>
          <p className="mt-1 font-display text-xl leading-none">{tally.loading ? '…' : pending}</p>
          <p className="mt-1 text-xs text-ink-400">บรรทัด</p>
        </div>
        <div className="rounded-card border border-line bg-surface p-4">
          <p className="text-sm text-ink-500">ส่งแล้ว</p>
          <p className="mt-1 font-display text-xl leading-none">{tally.loading ? '…' : done}</p>
          <p className="mt-1 text-xs text-ink-400">บรรทัด</p>
        </div>
        <div className="rounded-card border border-line bg-surface p-4 sm:col-span-2">
          <p className="text-sm text-ink-500">ในช่วงที่เลือกทั้งหมด</p>
          <p className="mt-1 font-display text-xl leading-none">{tally.loading ? '…' : pending + done}</p>
          <p className="mt-1 text-xs text-ink-400">
            ส่งแล้วจะไม่ถูกส่งซ้ำเป็นแถวใหม่ แต่ถ้าข้อมูลเปลี่ยนจะเขียนทับแถวเดิมให้
          </p>
        </div>
      </div>

      <section className="panel p-4">
        <div className="flex flex-wrap items-end gap-3">
          <DateRangePicker from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b) }} />

          <div>
            <label className="label mb-1" htmlFor="dept">
              แผนก
            </label>
            <select
              id="dept"
              className="input h-tap min-w-[150px]"
              value={dept}
              onChange={(e) => setDept(e.target.value)}
            >
              <option value="">ทุกแผนก</option>
              {(depts.data ?? []).map((d) => (
                <option key={d.code} value={d.code}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            className="btn-primary h-tap min-w-[190px]"
            disabled={busy || pending === 0}
            onClick={() => void send()}
          >
            {busy ? <Spinner /> : null}
            {busy ? 'กำลังส่ง…' : pending === 0 ? 'ส่งครบแล้ว' : `ส่ง ${pending} บรรทัดที่ยังไม่ส่ง`}
          </button>
        </div>

        <p className="mt-3 rounded-btn bg-surface-2 px-3 py-2 text-xs text-ink-500">
          ปุ่มส่งจะทำงานกับ<b>ทั้งช่วงวันที่ที่เลือก</b> ไม่ขึ้นกับตัวกรองแผนก ·
          แท็บแยกรายเดือน เช่น <span className="font-mono">เบิก-คืน 2569-09</span> ·
          กุญแจกันแถวซ้ำคือเลขที่คำขอคู่กับ SKU
        </p>
      </section>

      <section className="panel mt-4 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-md">รายการในช่วงที่เลือก</h2>
          <div className="flex gap-1">
            <button
              type="button"
              className={`chip ${view === 'pending' ? 'chip-on' : ''}`}
              onClick={() => setView('pending')}
            >
              ยังไม่ส่ง
            </button>
            <button
              type="button"
              className={`chip ${view === 'all' ? 'chip-on' : ''}`}
              onClick={() => setView('all')}
            >
              ทั้งหมด
            </button>
          </div>
        </div>

        {feed.loading && <Loading />}
        {feed.error && <ErrorBox message={feed.error} onRetry={feed.reload} />}

        {!feed.loading && rows.length === 0 && (
          <EmptyState
            title={view === 'pending' ? 'ส่งเข้าชีตครบแล้ว' : 'ไม่มีข้อมูลในช่วงที่เลือก'}
            hint={view === 'pending' ? 'ไม่มีบรรทัดไหนค้างส่งในช่วงนี้' : 'ลองขยายช่วงวันที่'}
          />
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead className="text-ink-500">
                <tr className="border-b border-line">
                  <th className="p-2 font-medium">สถานะ</th>
                  <th className="p-2 font-medium">เลขที่</th>
                  <th className="p-2 font-medium">วันเวลา</th>
                  <th className="p-2 font-medium">ผู้เบิก</th>
                  <th className="p-2 font-medium">วัสดุ</th>
                  <th className="p-2 font-medium">จำนวน</th>
                  <th className="p-2 font-medium">อยู่ในชีต</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.line_id} className="border-b border-line last:border-0">
                    <td className="p-2">
                      {r.is_exported ? (
                        <span className="badge-ok">ส่งแล้ว</span>
                      ) : (
                        <span className="badge-warn">ยังไม่ส่ง</span>
                      )}
                    </td>
                    <td className="p-2 font-mono text-xs">{r.ref_no}</td>
                    <td className="p-2 text-ink-500">{fmtDateTime(r.created_at)}</td>
                    <td className="p-2">
                      {r.requester_name}
                      <span className="ml-1 font-mono text-xs text-ink-400">{r.requester_code}</span>
                      {(r.requester_dept || r.requester_sub_dept) && (
                        <p className="text-xs text-ink-400">
                          {r.requester_dept}
                          {r.requester_sub_dept ? ` · ${r.requester_sub_dept}` : ''}
                        </p>
                      )}
                    </td>
                    <td className="p-2">
                      {r.item_name}
                      <span className="ml-1 font-mono text-xs text-ink-400">{r.sku}</span>
                    </td>
                    <td className="p-2">
                      {r.qty} {r.unit}
                    </td>
                    <td className="p-2 text-xs text-ink-500">
                      {r.tab ? (
                        <>
                          <span className="font-mono">{r.tab}</span>
                          <span className="ml-1 text-ink-400">แถว {r.row_no}</span>
                        </>
                      ) : (
                        <span className="text-ink-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rows.length >= 500 && (
          <p className="mt-2 text-xs text-ink-400">
            แสดง 500 บรรทัดแรก — ปุ่มส่งยังทำงานกับทั้งช่วงที่เลือกครบถ้วน
          </p>
        )}
      </section>

      <section className="panel mt-4 p-4">
        <h2 className="mb-3 font-display text-md">ประวัติการส่ง (เซสชันนี้)</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-ink-400">ยังไม่ได้ส่งในรอบนี้</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {runs.map((r) => (
              <li key={r.at} className="flex items-start gap-2">
                <span className={r.ok ? 'badge-ok' : 'badge-dang'}>{r.ok ? 'สำเร็จ' : 'ล้มเหลว'}</span>
                <span className="text-ink-500">{fmtDateTime(r.at)}</span>
                <span className="min-w-0 flex-1 break-words">{r.message}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
