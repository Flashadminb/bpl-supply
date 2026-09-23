import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAsync } from '../lib/useAsync'
import { ackTransfer, listTransferNotices } from '../lib/api'
import { readableError } from '../lib/supabase'
import { fmtDateTime } from '../lib/format'
import { Spinner } from './ui'

/**
 * แถบเตือนเรื่องการโอนเครื่อง — ขึ้นสองแบบตามว่าเราอยู่ฝั่งไหน
 *
 *   in   เครื่องถูกโอนมาให้แผนกเรา แต่ยังไม่มีใครไปกดเบิก
 *        ตั้งใจให้ต้องกดเบิกเอง ไม่ยัดใส่มือ เพราะการเบิกคือจังหวะที่ถ่ายรูปสภาพ
 *        ถ้าโอนแล้วผูกให้เลย จะไม่มีรูปว่าตอนรับของมาสภาพเป็นยังไง
 *
 *   out  เครื่องที่เราถืออยู่ถูกโอนออกไป ไม่ต้องตามคืนแล้ว
 *        ต้องบอกให้ชัด ไม่งั้นเจ้าตัวจะตามหาเครื่องที่ไม่ได้อยู่กับตัวจนหมดกะ
 */
export function TransferNotices() {
  const notices = useAsync(() => listTransferNotices(), [])
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const rows = notices.data ?? []
  if (notices.loading && rows.length === 0) return null
  if (rows.length === 0) return null

  async function ack(id: number) {
    setBusyId(id)
    setError(null)
    try {
      await ackTransfer(id)
      notices.reload()
    } catch (e) {
      setError(readableError(e))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="mb-3 space-y-2">
      {error && (
        <p className="rounded-btn bg-danger-bg px-3 py-2 text-sm text-danger-txt">{error}</p>
      )}

      {rows.map((n) =>
        n.side === 'in' ? (
          <div key={`in-${n.id}`} className="rounded-card border border-brand-300 bg-brand-50 p-3">
            <p className="font-display text-ink">
              มีการโอน {n.type_name} {n.asset_code} มาให้แผนกคุณใช้ชั่วคราว
            </p>
            <p className="mt-[2px] text-sm text-ink-700">
              โดย {n.by_name}
              {n.from_dept ? ` · เดิมอยู่แผนก ${n.from_dept}` : ''}
              {n.reason ? ` · ${n.reason}` : ''}
            </p>
            <p className="mt-1 text-sm text-ink-700">
              กรุณากดเบิกตามขั้นตอนเพื่อให้มีรูปสภาพตอนรับของ
            </p>
            <Link to="/assets" className="btn-primary mt-2 block w-full py-3 text-center">
              ไปกดเบิก {n.asset_code}
            </Link>
            <p className="mt-1 text-xs text-ink-500">โอนเมื่อ {fmtDateTime(n.created_at)}</p>
          </div>
        ) : (
          <div key={`out-${n.id}`} className="rounded-card border border-warn/40 bg-warn-bg p-3">
            <p className="font-display text-warn-txt">
              {n.type_name} {n.asset_code} ถูกโอนไปให้แผนก {n.to_dept} แล้ว
            </p>
            <p className="mt-[2px] text-sm text-warn-txt">
              โดย {n.by_name} · <b>ไม่ต้องคืนเครื่องนี้แล้ว</b>
              {n.reason ? ` · ${n.reason}` : ''}
            </p>
            <p className="mt-1 text-xs text-warn-txt opacity-80">
              เครื่องอื่นที่เบิกไว้ในใบเดียวกันยังต้องคืนตามปกติ
            </p>
            <button
              type="button"
              className="btn-soft mt-2 w-full py-3"
              disabled={busyId === n.id}
              onClick={() => void ack(n.id)}
            >
              {busyId === n.id ? <Spinner /> : null} รับทราบ
            </button>
          </div>
        ),
      )}
    </section>
  )
}
