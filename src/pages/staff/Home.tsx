import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useCart } from '../../lib/cart'
import { useAsync } from '../../lib/useAsync'
import { listAssetHoldings, listMyRequisitions, listOpenBorrowings } from '../../lib/api'
import { StaffPage } from '../../components/Shell'
import { EmptyState, ErrorBox, Loading } from '../../components/ui'
import { STATUS_TH, fmtDateTime, statusClass } from '../../lib/format'
import { MANAGER_ROLES, roleLabel } from '../../lib/roles'
import { usePendingApprovals } from '../../lib/usePendingApprovals'
import { NotifyBell } from '../../components/NotifyBell'
import { MeetingCheckIn } from '../../components/MeetingCheckIn'
import { relativeAge } from '../../lib/format'



export default function Home() {
  const { profile, hubName, can } = useAuth()
  const cart = useCart()
  const nav = useNavigate()

  const recent = useAsync(() => listMyRequisitions(3), [])
  const borrow = useAsync(() => listOpenBorrowings(true, profile?.id), [profile?.id])
  const heldAssets = useAsync(() => listAssetHoldings(true, profile?.id), [profile?.id])
  const openCount = (borrow.data ?? []).reduce((n, b) => n + b.qty_open, 0)
  const assetCount = (heldAssets.data ?? []).length
  const owing = openCount + assetCount
  const approvals = usePendingApprovals()

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="safe-t bg-brand-500 text-ink">
        <div className="mx-auto flex max-w-phone items-start gap-3 px-4 pb-5 pt-4">
          <div className="flex-1">
            <p className="text-sm">สวัสดี</p>
            <p className="font-display text-lg font-semibold">{profile?.full_name}</p>
            <p className="mt-[2px] font-mono text-xs">
              {profile?.employee_code} · {hubName} · {profile ? roleLabel(profile) : ''}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="flex items-center gap-2">
              {/* เช็คอินประชุมเห็นทุกคน ไม่ใช่ของแอดมิน */}
              <MeetingCheckIn />
              {can(...MANAGER_ROLES) && <NotifyBell />}
              {(can(...MANAGER_ROLES) || profile?.can_dispatch) && (
                <Link to="/admin" className="rounded-btn bg-ink px-3 py-2 text-sm text-white">
                  {can(...MANAGER_ROLES) ? 'หน้าแอดมิน' : 'หน้าตรวจสอบ'}
                </Link>
              )}
            </span>
            <Link to="/account" className="min-h-tap px-1 py-2 text-sm underline">
              บัญชีของฉัน
            </Link>
          </div>
        </div>
      </header>

      <StaffPage className="-mt-3">
        {/* คำขอรออนุมัติ — ขึ้นเฉพาะแอดมินกับเจ้าของระบบ อนุมัติจากมือถือได้เลย */}
        {approvals.count > 0 && (
          <Link
            to="/admin/approvals"
            className="mb-3 flex items-center gap-3 rounded-card border border-warn/30 bg-warn-bg p-3"
          >
            <span aria-hidden className="text-lg">
              🔔
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-base text-warn-txt">
                รออนุมัติ {approvals.count} คำขอ
              </p>
              <p className="text-sm text-warn-txt">
                {approvals.oldestAt
                  ? `เก่าสุดรอมาแล้ว ${relativeAge(approvals.oldestAt)}`
                  : 'กดเพื่อตรวจและอนุมัติ'}
              </p>
            </div>
            <span className="btn-dark shrink-0 px-3">ตรวจเลย</span>
          </Link>
        )}

        <button
          type="button"
          className="btn-dark w-full py-5 text-md"
          onClick={() => nav('/scan')}
        >
          สแกน QR เพื่อเบิก
        </button>

        {(profile?.can_assets || can(...MANAGER_ROLES)) && (
          <Link
            to="/assets"
            className="card mt-3 flex items-center gap-3 border-brand-300 p-4"
          >
            <span aria-hidden className="text-md">
              ⚙
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-md">เบิกอุปกรณ์ Asset</span>
              <span className="block text-sm text-ink-400">
                ไอดาต้า · Power Pallet · วิทยุ · เลเซอร์ลบ
              </span>
            </span>
            <span aria-hidden className="text-ink-400">
              ›
            </span>
          </Link>
        )}

        <Link to="/by" className="card mt-3 flex items-center gap-3 p-4">
          <span aria-hidden className="text-md">
            ▤
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-md">ส่งบาร์โค้ดจาก BY</span>
            <span className="block text-sm text-ink-400">
              ของที่ไม่ได้กดเบิกในระบบนี้ · ถ่ายบาร์โค้ดส่งให้แอดมินตัดสต็อก
            </span>
          </span>
          <span aria-hidden className="text-ink-400">
            ›
          </span>
        </Link>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Link to="/items" className="card flex min-h-[92px] flex-col justify-between p-3">
            <span className="text-md" aria-hidden>
              ☰
            </span>
            <span className="font-display text-md">เบิกวัสดุ</span>
            <span className="text-sm text-ink-400">เลือกจากรายการ</span>
          </Link>
          <Link to="/returns" className="card flex min-h-[92px] flex-col justify-between p-3">
            <span className="text-md" aria-hidden>
              ↩
            </span>
            <span className="font-display text-md">คืนของ</span>
            <span className={`text-sm ${owing > 0 ? 'text-warn-txt' : 'text-ink-400'}`}>
              {borrow.loading || heldAssets.loading
                ? 'กำลังตรวจ…'
                : owing > 0
                  ? [
                      assetCount > 0 ? `อุปกรณ์ ${assetCount} เครื่อง` : null,
                      openCount > 0 ? `วัสดุ ${openCount} ชิ้น` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : 'ไม่มีของค้าง'}
            </span>
          </Link>
        </div>

        {cart.count > 0 && (
          <Link to="/cart" className="card mt-3 flex items-center gap-3 border-brand-300 bg-brand-50 p-3">
            <div className="flex-1">
              <p className="font-display text-base">ตะกร้าค้างอยู่</p>
              <p className="text-sm text-ink-500">
                {cart.count} รายการ · {cart.units} ชิ้น — ยังไม่ได้ยืนยัน
              </p>
            </div>
            <span className="btn-primary">ไปต่อ</span>
          </Link>
        )}

        <section className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-md">รายการล่าสุด</h2>
            <Link to="/history" className="min-h-tap px-1 py-2 text-sm text-ink-500 underline">
              ดูทั้งหมด
            </Link>
          </div>

          {recent.loading && <Loading />}
          {recent.error && <ErrorBox message={recent.error} onRetry={recent.reload} />}
          {!recent.loading && !recent.error && (recent.data ?? []).length === 0 && (
            <EmptyState title="ยังไม่มีประวัติการเบิก" hint="กดสแกน QR หรือเลือกจากรายการวัสดุเพื่อเริ่ม" />
          )}

          <ul className="space-y-2">
            {(recent.data ?? []).map((r) => (
              <li key={r.id} className="card p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm">{r.ref_no}</span>
                  <span className={statusClass(r.status)}>{STATUS_TH[r.status]}</span>
                </div>
                <p className="mt-1 text-sm text-ink-500">
                  {fmtDateTime(r.created_at)} · {r.requisition_items?.length ?? 0} รายการ
                </p>
              </li>
            ))}
          </ul>
        </section>
      </StaffPage>
    </div>
  )
}
