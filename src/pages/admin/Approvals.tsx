import { useEffect, useMemo, useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import {
  approveRequisition,
  getSetting,
  listPendingRequisitions,
  rejectRequisition,
  setSetting,
} from '../../lib/api'
import { readableError } from '../../lib/supabase'
import { EmptyState, ErrorBox, Loading, Modal, Spinner, Toggle } from '../../components/ui'
import { fmtDateTime, relativeAge } from '../../lib/format'
import type { Requisition } from '../../lib/types'

export default function Approvals() {
  const queue = useAsync(() => listPendingRequisitions(), [])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [auto, setAuto] = useState<boolean | null>(null)

  useEffect(() => {
    void getSetting<boolean>('auto_approve_consumables').then((v) => setAuto(Boolean(v)))
  }, [])

  const rows = queue.data ?? []
  const active: Requisition | null = useMemo(
    () => rows.find((r) => r.id === activeId) ?? rows[0] ?? null,
    [rows, activeId],
  )

  // เลือกทุกบรรทัดไว้ก่อนเป็นค่าเริ่มต้นเมื่อเปลี่ยนคำขอ
  useEffect(() => {
    setChecked(new Set((active?.requisition_items ?? []).map((l) => l.id)))
    setError(null)
  }, [active?.id])

  function toggle(id: number) {
    setChecked((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function doApprove() {
    if (!active) return
    setBusy(true)
    setError(null)
    try {
      await approveRequisition(active.id, [...checked])
      setActiveId(null)
      queue.reload()
    } catch (e) {
      setError(readableError(e))
    } finally {
      setBusy(false)
    }
  }

  async function doReject() {
    if (!active) return
    setBusy(true)
    setError(null)
    try {
      await rejectRequisition(active.id, reason)
      setRejectOpen(false)
      setReason('')
      setActiveId(null)
      queue.reload()
    } catch (e) {
      setError(readableError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-lg">อนุมัติคำขอเบิก</h1>
        {auto !== null && (
          <Toggle
            checked={auto}
            label="อนุมัติของสิ้นเปลืองอัตโนมัติ"
            onChange={(v) => {
              setAuto(v)
              void setSetting('auto_approve_consumables', v)
            }}
          />
        )}
      </div>

      {queue.loading && <Loading />}
      {queue.error && <ErrorBox message={queue.error} onRetry={queue.reload} />}
      {!queue.loading && rows.length === 0 && (
        <EmptyState title="ไม่มีคำขอรออนุมัติ" hint="คำขอใหม่จะขึ้นที่นี่ทันที" />
      )}

      {rows.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <section className="panel max-h-[70dvh] overflow-y-auto p-2">
            <ul className="space-y-1">
              {rows.map((r) => {
                const on = active?.id === r.id
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setActiveId(r.id)}
                      className={`w-full rounded-card border p-3 text-left ${
                        on ? 'border-ink bg-brand-50' : 'border-line bg-surface'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm">{r.ref_no}</span>
                        <span className="badge-warn">{relativeAge(r.created_at)}</span>
                      </div>
                      <p className="mt-1 text-sm text-ink-500">
                        {r.requisition_items?.length ?? 0} รายการ · {r.profiles?.full_name ?? '—'}
                      </p>
                      <p className="text-xs text-ink-400">{fmtDateTime(r.created_at)}</p>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>

          {active && (
            <section className="panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-md">{active.ref_no}</p>
                  <p className="text-sm text-ink-500">
                    {active.profiles?.full_name} ({active.profiles?.employee_code}) · {active.hub_code} ·{' '}
                    {fmtDateTime(active.created_at)}
                  </p>
                  {active.purpose && <p className="mt-1 text-sm">วัตถุประสงค์: {active.purpose}</p>}
                  {active.note && <p className="text-sm text-ink-500">หมายเหตุ: {active.note}</p>}
                </div>
                {active.evidence_web_link ? (
                  <a href={active.evidence_web_link} target="_blank" rel="noreferrer" className="btn-ghost">
                    เปิดรูปหลักฐานใน Drive
                  </a>
                ) : (
                  <span className="badge-dang">ไม่มีรูปหลักฐาน</span>
                )}
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[620px] text-left text-sm">
                  <thead className="text-ink-500">
                    <tr className="border-b border-line">
                      <th className="w-10 py-2"> </th>
                      <th className="py-2 font-medium">วัสดุ</th>
                      <th className="py-2 font-medium">ขอ</th>
                      <th className="py-2 font-medium">สต็อก ก่อน → หลัง</th>
                      <th className="py-2 font-medium">หมายเหตุ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(active.requisition_items ?? []).map((l) => {
                      const onHand = l.items?.qty_on_hand ?? 0
                      const min = l.items?.min_qty ?? 0
                      const after = onHand - l.qty_requested
                      const short = after < 0
                      const belowMin = !short && after < min
                      const sel = checked.has(l.id)
                      return (
                        <tr
                          key={l.id}
                          className={`border-b border-line last:border-0 ${short || belowMin ? 'bg-danger-bg/40' : ''}`}
                        >
                          <td className="py-2">
                            <input
                              type="checkbox"
                              aria-label={`เลือก ${l.items?.name}`}
                              className="h-5 w-5 accent-[var(--yellow-500)]"
                              checked={sel}
                              disabled={short}
                              onChange={() => toggle(l.id)}
                            />
                          </td>
                          <td className="py-2">
                            <p>{l.items?.name}</p>
                            <p className="font-mono text-xs text-ink-400">{l.items?.sku}</p>
                          </td>
                          <td className="py-2 font-display">
                            {l.qty_requested} {l.items?.unit}
                          </td>
                          <td className="py-2">
                            {onHand} → <b className={short || belowMin ? 'text-danger-txt' : ''}>{Math.max(after, 0)}</b>
                          </td>
                          <td className="py-2 text-xs">
                            {short ? (
                              <span className="text-danger-txt">สต็อกไม่พอ อนุมัติบรรทัดนี้ไม่ได้</span>
                            ) : belowMin ? (
                              <span className="text-danger-txt">ต่ำกว่าขั้นต่ำ {min}</span>
                            ) : (
                              <span className="text-ink-400">ปกติ</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {error && <div className="mt-3"><ErrorBox message={error} /></div>}

              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className="btn-danger" disabled={busy} onClick={() => setRejectOpen(true)}>
                  ปฏิเสธทั้งคำขอ
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() => setChecked(new Set((active.requisition_items ?? []).map((l) => l.id)))}
                >
                  เลือกทั้งหมด
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy || checked.size === 0}
                  onClick={() => void doApprove()}
                >
                  {busy ? <Spinner /> : null}
                  อนุมัติเฉพาะรายการที่เลือก ({checked.size}/{active.requisition_items?.length ?? 0})
                </button>
              </div>
              <p className="mt-2 text-xs text-ink-400">
                อนุมัติไม่ครบทุกบรรทัด สถานะคำขอจะกลายเป็น “อนุมัติบางส่วน” และตัดสต็อกเฉพาะบรรทัดที่เลือก
              </p>
            </section>
          )}
        </div>
      )}

      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title="ปฏิเสธคำขอ">
        <label className="label" htmlFor="reason">
          เหตุผล (พนักงานจะเห็นข้อความนี้)
        </label>
        <textarea
          id="reason"
          rows={3}
          className="input py-2"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="เช่น ของหมดสต็อก รอรอบสั่งซื้อถัดไป"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => setRejectOpen(false)}>
            ยกเลิก
          </button>
          <button type="button" className="btn-danger" disabled={busy} onClick={() => void doReject()}>
            ยืนยันปฏิเสธ
          </button>
        </div>
      </Modal>
    </div>
  )
}
