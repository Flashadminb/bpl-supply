import { useState, type ReactNode } from 'react'
import { Modal, Spinner } from './ui'

/**
 * แถบ "เลือกไว้ N รายการ" พร้อมปุ่มลบและกล่องยืนยัน
 *
 * เขียนรวมที่เดียวเพราะสามหน้าที่ลบได้ต้องเตือนเหมือนกันทุกหน้า
 * แยกเขียนสามที่คือสักหน้าจะลืมถามเหตุผล หรือลืมบอกว่าลบแล้วเกิดอะไรขึ้น
 * ซึ่งเป็นหน้าที่คนจะกดผิดพอดี
 */
export function BulkDeleteBar({
  n,
  noun,
  warning,
  confirmLabel,
  onDelete,
  onClear,
  extra,
}: {
  n: number
  /** หน่วยของสิ่งที่เลือก เช่น 'ใบ' 'การ์ด' 'บรรทัด' */
  noun: string
  /** บอกให้ชัดว่ากดแล้วเกิดอะไรขึ้นกับของจริง ไม่ใช่แค่ว่า "ลบไม่ได้" */
  warning: ReactNode
  confirmLabel: string
  onDelete: (why: string) => Promise<unknown>
  onClear: () => void
  /** ปุ่มอื่นของหน้านั้น ๆ เช่น ไม่ส่งลงชีต */
  extra?: ReactNode
}) {
  const [asking, setAsking] = useState(false)
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (n === 0) return null

  return (
    <>
      <div className="sticky top-0 z-20 mb-2 flex flex-wrap items-center gap-2 rounded-card border border-ink bg-ink px-3 py-2 text-white">
        <span className="font-display">
          เลือกไว้ {n} {noun}
        </span>
        <span className="flex-1" />
        {extra}
        <button
          type="button"
          className="h-tap rounded-btn bg-danger px-3 text-sm text-white"
          onClick={() => {
            setErr(null)
            setAsking(true)
          }}
        >
          ลบ {n} {noun}
        </button>
        <button type="button" className="min-h-tap px-2 text-sm underline" onClick={onClear}>
          ล้าง
        </button>
      </div>

      <Modal open={asking} onClose={() => setAsking(false)} title={`ลบ ${n} ${noun}`}>
        <div className="rounded-btn bg-danger-bg px-3 py-3 text-sm text-danger-txt">{warning}</div>

        <p className="mt-2 text-sm text-ink-500">
          ก่อนลบ ระบบจะย่อรายการเป็นข้อความเก็บไว้ในประวัติให้อัตโนมัติ พร้อมลิงก์รูปในไดร์ฟ
          <br />
          รูปในไดร์ฟไม่ถูกลบ ตามไปดูได้เสมอ
        </p>

        <label className="label mt-3" htmlFor="bulk-why">
          เหตุผลที่ลบ (ไม่บังคับ)
        </label>
        <input
          id="bulk-why"
          className="input"
          placeholder="เช่น แถวที่กดทดสอบระบบ"
          value={why}
          onChange={(e) => setWhy(e.target.value)}
        />

        {err && (
          <p className="mt-3 rounded-btn bg-danger-bg px-3 py-2 text-sm text-danger-txt">{err}</p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => setAsking(false)}>
            ยกเลิก
          </button>
          <button
            type="button"
            className="h-tap rounded-btn bg-danger px-4 text-white"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setErr(null)
              void onDelete(why)
                .then(() => {
                  setAsking(false)
                  setWhy('')
                })
                .catch((e) => setErr((e as Error).message))
                .finally(() => setBusy(false))
            }}
          >
            {busy ? <Spinner /> : null} {confirmLabel}
          </button>
        </div>
      </Modal>
    </>
  )
}

/** ช่องติ๊กขนาดนิ้วโป้ง · หน้างานใส่ถุงมือ ช่องเล็กกว่านี้กดไม่โดน */
export function PickBox({
  on,
  onToggle,
  label,
}: {
  on: boolean
  onToggle: () => void
  label: string
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      className="h-5 w-5 shrink-0"
      checked={on}
      onChange={onToggle}
    />
  )
}
