import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useCart } from '../../lib/cart'
import { useAsync } from '../../lib/useAsync'
import { listMyRequisitions, listOpenBorrowings } from '../../lib/api'
import { StaffPage } from '../../components/Shell'
import { EmptyState, ErrorBox, Loading } from '../../components/ui'
import { STATUS_TH, fmtDateTime, statusClass } from '../../lib/format'
import { MANAGER_ROLES, ROLE_TH } from '../../lib/roles'



export default function Home() {
  const { profile, hubName, can } = useAuth()
  const cart = useCart()
  const nav = useNavigate()

  const recent = useAsync(() => listMyRequisitions(3), [])
  const borrow = useAsync(() => listOpenBorrowings(true, profile?.id), [profile?.id])
  const openCount = (borrow.data ?? []).reduce((n, b) => n + b.qty_open, 0)

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="safe-t bg-brand-500 text-ink">
        <div className="mx-auto flex max-w-phone items-start gap-3 px-4 pb-5 pt-4">
          <div className="flex-1">
            <p className="text-sm">สวัสดี</p>
            <p className="font-display text-lg font-semibold">{profile?.full_name}</p>
            <p className="mt-[2px] font-mono text-xs">
              {profile?.employee_code} · {hubName} · {profile ? ROLE_TH[profile.role] : ''}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {can(...MANAGER_ROLES) && (
              <Link to="/admin" className="rounded-btn bg-ink px-3 py-2 text-sm text-white">
                หน้าแอดมิน
              </Link>
            )}
            <Link to="/account" className="min-h-tap px-1 py-2 text-sm underline">
              บัญชีของฉัน
            </Link>
          </div>
        </div>
      </header>

      <StaffPage className="-mt-3">
        <button
          type="button"
          className="btn-dark w-full py-5 text-md"
          onClick={() => nav('/scan')}
        >
          สแกน QR เพื่อเบิก
        </button>

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
            <span className="font-display text-md">คืนวัสดุ</span>
            <span className={`text-sm ${openCount > 0 ? 'text-warn-txt' : 'text-ink-400'}`}>
              {borrow.loading ? 'กำลังตรวจ…' : openCount > 0 ? `ค้างคืน ${openCount} ชิ้น` : 'ไม่มีของค้าง'}
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
