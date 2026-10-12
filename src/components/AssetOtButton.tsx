import { useState } from 'react'
import { OT_HOURS, assetOtExtend } from '../lib/assetOt'
import { readableError } from '../lib/supabase'
import { Spinner } from './ui'

/**
 * ปุ่มขอต่อเวลาคืนเครื่อง · ตัวเดียวใช้ทั้งป็อปอัพหน้าแรกและหน้าคืนของ
 *
 * เจ้าของระบบสั่งไว้ว่า "เด้งให้หน้างานกด แต่ก็มีให้กดปิด ไม่ได้บังคับ"
 * ปุ่มนี้จึงไม่เคยขวางทางอะไร ไม่กดก็คืนของได้ตามปกติ กดปิดก็หายไปเฉย ๆ
 * แค่กดแล้วได้เวลาเพิ่มเท่านั้น
 *
 * กำหนดเดิมไม่ถูกแก้ · ฐานข้อมูลเก็บ ot_until แยกจาก due_at
 * จึงเขียนบอกไว้ใต้ปุ่มด้วยว่ากำหนดเดิมยังอยู่ จะได้ไม่มีใครเข้าใจว่ากดแล้วลบประวัติ
 *
 * ต่อได้ครั้งเดียวต่อใบ ฐานข้อมูลเป็นคนกัน ไม่ใช่กันแค่ที่ปุ่ม
 * ถ้ากดได้เรื่อย ๆ จะกลายเป็นใบที่ไม่มีกำหนดคืน ซึ่งแย่กว่าไม่มีระบบ OT เลย
 */

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })

export function AssetOtButton({
  txnId,
  otUntil,
  otHours,
  onDone,
  tone = 'light',
}: {
  txnId: string
  /** ขอไว้แล้วถึงกี่โมง · ว่าง = ยังไม่เคยขอ */
  otUntil?: string | null
  otHours?: number | null
  /** ขอสำเร็จแล้ว · ให้หน้าแม่เอาไปอัปรายการของตัวเอง */
  onDone?: (hours: number, until: string) => void
  /** บนพื้นแดงอ่อนของป็อปอัพ ปุ่มต้องเข้มกว่าปกติถึงจะเห็น */
  tone?: 'light' | 'onDanger'
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [got, setGot] = useState<{ hours: number; until: string } | null>(null)

  const have = got ?? (otUntil ? { hours: otHours ?? 0, until: otUntil } : null)

  if (have) {
    return (
      <span className="mt-1 inline-block rounded-pill bg-success-bg px-2 py-[3px] text-xs font-bold text-success-txt">
        ต่อเวลาแล้ว +{have.hours} ชม · ถึง {hhmm(have.until)} น.
      </span>
    )
  }

  async function pick(h: number) {
    setBusy(h)
    setErr(null)
    try {
      const r = await assetOtExtend(txnId, h)
      setGot({ hours: h, until: r.ot_until })
      setOpen(false)
      onDone?.(h, r.ot_until)
    } catch (e) {
      setErr(readableError(e))
    } finally {
      setBusy(null)
    }
  }

  if (!open) {
    return (
      <span className="block">
        <button
          type="button"
          onClick={() => setOpen(true)}
          /* 44px ขึ้นไปเสมอ หน้างานใส่ถุงมือกด */
          className={`mt-1 h-tap rounded-btn px-3 text-sm font-semibold ${
            tone === 'onDanger' ? 'bg-danger text-white' : 'bg-warn-bg text-warn-txt'
          }`}
        >
          ⏱ ขอต่อเวลา
        </button>
        {err && <span className="mt-1 block text-xs text-danger-txt">{err}</span>}
      </span>
    )
  }

  return (
    <span className="mt-1 block rounded-card border border-line bg-surface p-2 text-left">
      <span className="mb-1 block text-xs text-ink-500">ขอต่อกี่ชั่วโมง · ต่อได้ครั้งเดียว</span>
      <span className="flex flex-wrap gap-1">
        {OT_HOURS.map((h) => (
          <button
            key={h}
            type="button"
            disabled={busy !== null}
            onClick={() => void pick(h)}
            className="h-tap min-w-[52px] rounded-btn bg-ink px-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy === h ? <Spinner /> : `${h} ชม`}
          </button>
        ))}
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            setOpen(false)
            setErr(null)
          }}
          className="h-tap rounded-btn px-3 text-sm text-ink-500 underline"
        >
          ไม่ต่อ
        </button>
      </span>
      <span className="mt-1 block text-[11px] text-ink-400">
        กำหนดเดิมยังอยู่ในประวัติเหมือนเดิม ไม่ได้ถูกลบ
      </span>
      {err && <span className="mt-1 block text-xs text-danger-txt">{err}</span>}
    </span>
  )
}
