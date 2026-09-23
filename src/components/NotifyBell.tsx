import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAsync } from '../lib/useAsync'
import { listAssetHoldings, listByRows, listOpenAssetIssues } from '../lib/api'
import { usePendingApprovals } from '../lib/usePendingApprovals'
import { Sheet } from './ui'
import { relativeAge } from '../lib/format'

/**
 * กระดิ่งบนหัวจอฝั่งแอพ — สำหรับแอดมินและเจ้าของระบบเท่านั้น
 *
 * รวมทุกเรื่องที่ต้องลงมือไว้ที่เดียว กดแล้วเห็นว่ามีอะไรค้างและไปต่อได้เลย
 * ไม่ต้องจำว่าเรื่องไหนอยู่เมนูไหนในหน้าแอดมิน
 */
export function NotifyBell() {
  const [open, setOpen] = useState(false)
  const approvals = usePendingApprovals()
  const byPending = useAsync(() => listByRows({ status: 'pending', limit: 200 }), [])
  const issues = useAsync(() => listOpenAssetIssues(50), [])
  const held = useAsync(() => listAssetHoldings(false), [])

  const byCount = (byPending.data ?? []).length
  const faults = issues.data ?? []
  const faultAssets = new Set(faults.map((i) => i.asset_code)).size
  const late = (held.data ?? []).filter((h) => h.due_at && Date.now() > Date.parse(h.due_at))

  const total = approvals.count + byCount + faultAssets + late.length

  const rows = [
    approvals.count > 0 && {
      key: 'approve',
      to: '/admin/approvals',
      tone: 'warn' as const,
      title: `รออนุมัติ ${approvals.count} คำขอ`,
      detail: approvals.oldestAt ? `เก่าสุดรอมาแล้ว ${relativeAge(approvals.oldestAt)}` : '',
    },
    byCount > 0 && {
      key: 'by',
      to: '/admin/by',
      tone: 'warn' as const,
      title: `บาร์โค้ด BY รอตัดสต็อก ${byCount} รายการ`,
      detail: 'หน้างานส่งรูปมาแล้ว',
    },
    late.length > 0 && {
      key: 'late',
      to: '/admin/assets-out',
      tone: 'danger' as const,
      title: `Asset เลยเวลาคืน ${late.length} เครื่อง`,
      detail: `${new Set(late.map((h) => h.holder_code)).size} คนที่ต้องตาม`,
    },
    faultAssets > 0 && {
      key: 'fault',
      to: '/admin/assets',
      tone: 'danger' as const,
      title: `เครื่องชำรุดยังไม่เคลียร์ ${faultAssets} เครื่อง`,
      detail: faults[0] ? `ล่าสุด ${faults[0].asset_code} · ${faults[0].symptom}` : '',
    },
  ].filter(Boolean) as { key: string; to: string; tone: 'warn' | 'danger'; title: string; detail: string }[]

  const tone = {
    warn: 'border-warn/30 bg-warn-bg text-warn-txt',
    danger: 'border-danger/25 bg-danger-bg text-danger-txt',
  }

  return (
    <>
      <button
        type="button"
        aria-label={total > 0 ? `มี ${total} เรื่องต้องจัดการ` : 'ไม่มีเรื่องค้าง'}
        className="relative flex h-tap w-tap items-center justify-center rounded-btn bg-ink/10 text-lg"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden>🔔</span>
        {total > 0 && (
          <span className="absolute -right-[2px] -top-[2px] min-w-[20px] rounded-pill bg-danger px-1 text-center font-display text-[11px] leading-[18px] text-white">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      <Sheet open={open} title="ต้องจัดการ" onClose={() => setOpen(false)}>
        {rows.length === 0 ? (
          <p className="rounded-card bg-success-bg px-3 py-3 text-center text-sm text-success-txt">
            ไม่มีอะไรค้าง ทุกอย่างเรียบร้อย
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.key}>
                <Link
                  to={r.to}
                  onClick={() => setOpen(false)}
                  className={`block rounded-card border px-3 py-3 ${tone[r.tone]}`}
                >
                  <p className="font-display text-base">{r.title}</p>
                  {r.detail && <p className="mt-[2px] truncate text-sm opacity-90">{r.detail}</p>}
                </Link>
              </li>
            ))}
          </ul>
        )}

        <Link
          to="/admin"
          onClick={() => setOpen(false)}
          className="btn-soft mt-3 block w-full py-3 text-center"
        >
          เปิดหน้าภาพรวมทั้งหมด
        </Link>
      </Sheet>
    </>
  )
}
