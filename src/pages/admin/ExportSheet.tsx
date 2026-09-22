import { useMemo, useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import { exportToSheet, listHubs, listRequisitionsBetween } from '../../lib/api'
import { ErrorBox, Loading, Spinner } from '../../components/ui'
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

export default function ExportSheet() {
  const hubs = useAsync(() => listHubs(), [])
  const [from, setFrom] = useState(isoDay(-7))
  const [to, setTo] = useState(isoDay(0))
  const [hub, setHub] = useState('')
  const [busy, setBusy] = useState(false)
  const [runs, setRuns] = useState<RunLog[]>([])

  const fromISO = useMemo(() => new Date(`${from}T00:00:00`).toISOString(), [from])
  const toISO = useMemo(() => new Date(`${to}T23:59:59`).toISOString(), [to])

  const preview = useAsync(
    () => listRequisitionsBetween(fromISO, toISO, hub || undefined),
    [fromISO, toISO, hub],
  )

  const rows = useMemo(() => {
    const out: { ref: string; at: string; who: string; item: string; qty: string; link: string | null }[] = []
    for (const r of preview.data ?? []) {
      for (const l of r.requisition_items ?? []) {
        out.push({
          ref: r.ref_no,
          at: fmtDateTime(r.created_at),
          who: `${r.profiles?.full_name ?? '—'} (${r.hub_code})`,
          item: l.items?.name ?? `#${l.item_id}`,
          qty: `${l.qty_approved ?? l.qty_requested} ${l.items?.unit ?? ''}`,
          link: r.evidence_web_link,
        })
      }
    }
    return out
  }, [preview.data])

  async function send() {
    setBusy(true)
    try {
      const res = await exportToSheet({ from: fromISO, to: toISO, hub: hub || undefined })
      setRuns((r) => [
        { at: new Date().toISOString(), ok: true, message: `เพิ่มใหม่ ${res.appended} แถว · อัปเดต ${res.updated} แถว` },
        ...r,
      ])
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
        <span className="badge-mute">
          service account อ่านค่าจาก Edge Function secrets — ไม่มีคีย์อยู่ในหน้าเว็บ
        </span>
      </div>

      <section className="panel p-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <label className="label">ตั้งแต่วันที่</label>
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">ถึงวันที่</label>
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className="label">ฮับ</label>
            <select className="input" value={hub} onChange={(e) => setHub(e.target.value)}>
              <option value="">ทุกฮับ</option>
              {(hubs.data ?? []).map((h) => (
                <option key={h.code} value={h.code}>
                  {h.code} — {h.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => void send()}>
              {busy ? <Spinner /> : null}
              {busy ? 'กำลังส่ง…' : `ส่ง ${rows.length} แถว`}
            </button>
          </div>
        </div>

        <p className="mt-3 rounded-btn bg-surface-2 px-3 py-2 font-mono text-xs text-ink-500">
          คอลัมน์ F ใช้สูตร =HYPERLINK("https://drive.google.com/file/d/&lt;FILE_ID&gt;/view"; "ดูรูป") ·
          กุญแจกันแถวซ้ำคือ (เลขที่คำขอ, SKU) — ส่งซ้ำได้ไม่เกิดแถวซ้ำ
        </p>
      </section>

      <section className="panel mt-4 p-4">
        <h2 className="mb-3 font-display text-md">ตัวอย่างข้อมูลก่อนส่ง</h2>
        {preview.loading && <Loading />}
        {preview.error && <ErrorBox message={preview.error} onRetry={preview.reload} />}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-ink-500">
              <tr className="border-b border-line">
                <th className="p-2 font-medium">A · เลขที่</th>
                <th className="p-2 font-medium">B · วันเวลา</th>
                <th className="p-2 font-medium">C · ผู้เบิก (ฮับ)</th>
                <th className="p-2 font-medium">D · วัสดุ</th>
                <th className="p-2 font-medium">E · จำนวน</th>
                <th className="p-2 font-medium">F · หลักฐาน</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 25).map((r, i) => (
                <tr key={`${r.ref}-${i}`} className="border-b border-line last:border-0">
                  <td className="p-2 font-mono text-xs">{r.ref}</td>
                  <td className="p-2 text-ink-500">{r.at}</td>
                  <td className="p-2">{r.who}</td>
                  <td className="p-2">{r.item}</td>
                  <td className="p-2">{r.qty}</td>
                  <td className="p-2">
                    {r.link ? (
                      <a href={r.link} target="_blank" rel="noreferrer" className="underline">
                        ดูรูป
                      </a>
                    ) : (
                      <span className="text-ink-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {!preview.loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-ink-400">
                    ไม่มีข้อมูลในช่วงที่เลือก
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {rows.length > 25 && (
          <p className="mt-2 text-xs text-ink-400">แสดง 25 แถวแรกจากทั้งหมด {rows.length} แถว</p>
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
