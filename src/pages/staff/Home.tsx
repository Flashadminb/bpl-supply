import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useCart } from '../../lib/cart'
import { useAsync } from '../../lib/useAsync'
import {
  countAssetHoldings,
  listAssetHoldings,
  listMyHistory,
  listOpenBorrowings,
  countPendingSacks,
} from '../../lib/api'
import { StaffPage } from '../../components/Shell'
import { EmptyState, ErrorBox, Loading } from '../../components/ui'
import { STATUS_TH, fmtDateTime, statusClass } from '../../lib/format'
import {
  MANAGER_ROLES,
  canBreakGuard,
  canBreakIssue,
  canProxy,
  canSeeSacks,
  roleLabel,
  showsOsScanTile,
} from '../../lib/roles'
import { usePendingApprovals } from '../../lib/usePendingApprovals'
import { NotifyBell } from '../../components/NotifyBell'
import { WorkLinks } from '../../components/WorkLinks'
import { NoticeBoard } from '../../components/NoticeBoard'
import { MeetingCheckIn } from '../../components/MeetingCheckIn'
import { relativeAge } from '../../lib/format'



export default function Home() {
  const { profile, hubName, can } = useAuth()
  const cart = useCart()
  const nav = useNavigate()

  const recent = useAsync(() => listMyHistory(3), [])
  const borrow = useAsync(() => listOpenBorrowings(true, profile?.id), [profile?.id])
  const heldAssets = useAsync(() => listAssetHoldings(true, profile?.id), [profile?.id])
  const openCount = (borrow.data ?? []).reduce((n, b) => n + b.qty_open, 0)
  const assetCount = (heldAssets.data ?? []).length
  const owing = openCount + assetCount

  // เครื่องที่คนอื่นถืออยู่ — เฉพาะคนที่คืนแทนได้
  // เดิมการ์ดนี้นับแต่ของตัวเอง แอดมินเลยเห็น "ไม่มีของค้าง" ทั้งที่ของออกไปอยู่ข้างนอก
  // ขอมาแค่ตัวเลข ไม่ดึงแถวมาทั้งกอง จะได้ไม่เปลืองโควต้าตอนเปลี่ยนกะ
  const mayProxy = canProxy(profile)
  const hubHeld = useAsync(
    () => (mayProxy ? countAssetHoldings() : Promise.resolve(0)),
    [mayProxy],
  )
  const hubOthers = Math.max((hubHeld.data ?? 0) - assetCount, 0)
  const approvals = usePendingApprovals()
  /**
   * กระสอบรอส่ง — หน้างานทุกคนกดได้ ใครว่างก็หยิบไปส่งได้
   *
   * ยกเว้นผู้ตรวจสอบ งานเขาคือตามว่าของถึงหรือยัง ไม่ใช่ขนของเอง
   * ไม่ถามฐานข้อมูลด้วยซ้ำถ้าเขาไม่ได้จะเห็น จะได้ไม่เปลืองโควต้าฟรี ๆ
   */
  const seesSacks = canSeeSacks(profile)
  const sacks = useAsync(
    () => (seesSacks ? countPendingSacks() : Promise.resolve(0)),
    [seesSacks],
  )
  const sackCount = sacks.data ?? 0

  // สแกนบัตร OS — เจ้าของระบบกับผู้ตรวจสอบ ไว้สุ่มเช็คเองที่หน้างาน
  const mayScan = showsOsScanTile(profile)
  // ไทล์เดียวใช้ได้ทั้งหัวหน้างานและ รปภ · /break พาไปหน้าที่ถูกกับคนที่กดเอง
  const mayIssueBreak = canBreakIssue(profile)
  const maysSeeBreak = mayIssueBreak || canBreakGuard(profile)

  /**
   * รปภ ได้หน้าแรกคนละหน้า ไม่ใช่หน้าเดิมที่ซ่อนเมนูไปครึ่งหนึ่ง
   *
   * ซ่อนทีละอันแปลว่าทุกครั้งที่เพิ่มเมนูใหม่ ต้องจำไปซ่อนให้เขาด้วย
   * วันไหนลืมสักอัน รปภ จะเห็นเมนูเบิกของโดยไม่มีใครตั้งใจ
   * แยกหน้าไปเลยแปลว่าเขาเห็นเฉพาะสิ่งที่เขียนไว้ให้เขาเห็นเท่านั้น
   *
   * คนที่เป็นทั้ง รปภ และอย่างอื่นจะได้หน้าปกติ เพราะเขามีงานอื่นต้องทำด้วย
   */
  const guardOnly =
    profile?.can_guard === true && profile.role === 'staff' && !profile.can_dispatch

  if (guardOnly) {
    return (
      <div className="bg-canvas">
        <header className="safe-t bg-brand-500 text-ink">
          <div className="mx-auto flex max-w-phone items-start gap-3 px-4 pb-5 pt-4">
            <div className="flex-1">
              <p className="text-sm">สวัสดี</p>
              <p className="font-display text-lg font-semibold">{profile.full_name}</p>
              <p className="mt-[2px] font-mono text-xs">
                {profile.employee_code} · {hubName} · {roleLabel(profile)}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="flex items-center gap-2">
                <MeetingCheckIn />
                <WorkLinks />
              </span>
              <Link to="/account" className="min-h-tap px-1 py-2 text-sm underline">
                บัญชีของฉัน
              </Link>
            </div>
          </div>
        </header>

        <StaffPage className="-mt-3" nav={false}>
          <NoticeBoard />

          <button
            type="button"
            className="mt-3 w-full rounded-panel bg-ink px-4 py-9 text-center text-white"
            onClick={() => nav('/guard')}
          >
            <span aria-hidden className="block text-[44px] leading-none">
              ▣
            </span>
            <span className="mt-2 block font-display text-xl">สแกนบัตร OS</span>
            <span className="mt-1 block text-sm text-dark-text">
              ตรวจมือถือที่นำเข้าพื้นที่
            </span>
          </button>

          <p className="mt-4 text-center text-xs text-ink-400">
            เทียบหน้ากับรูปในระบบ และเทียบเครื่องกับ IMEI ก่อนปล่อยเข้า
            <br />
            ถ้าไม่ตรง กดปุ่มแจ้งในหน้าสแกน ผู้ตรวจสอบจะรู้ทันที
          </p>
        </StaffPage>
      </div>
    )
  }

  return (
    <div className="bg-canvas">
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
              {/* ลิงก์งาน — เห็นเฉพาะแอดมิน เจ้าของระบบ และผู้ตรวจสอบ */}
              <WorkLinks />
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
        {/* ป้ายประกาศ — ต้องอยู่บนสุด ถ้าอยู่ล่างจะไม่มีใครเลื่อนลงไปอ่าน */}
        <NoticeBoard />

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

        {mayScan && (
          <Link to="/guard" className="card mt-3 flex items-center gap-3 p-4">
            <span aria-hidden className="text-md">
              ▣
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-md">สแกนบัตร OS</span>
              <span className="block text-sm text-ink-400">
                เช็คมือถือที่ OS นำเข้าพื้นที่ · หน้าจอเดียวกับที่ รปภ ใช้
              </span>
            </span>
            <span aria-hidden className="text-ink-400">
              ›
            </span>
          </Link>
        )}

        {maysSeeBreak && (
          <Link to="/break" className="card mt-3 flex items-center gap-3 p-4">
            <span aria-hidden className="text-md">
              ⏱
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-md">เบรค OS</span>
              <span className="block text-sm text-ink-400">
                {mayIssueBreak
                  ? 'ปล่อยบัตรเบรค · ดูใบที่ยังไม่ได้รับกลับ'
                  : 'สแกนบัตรเบรค · ดูว่าตอนนี้ใครออกไปอยู่'}
              </span>
            </span>
            <span aria-hidden className="text-ink-400">
              ›
            </span>
          </Link>
        )}

        {seesSacks && (
        <Link
          to="/ship"
          className={`card mt-3 flex items-center gap-3 p-4 ${
            sackCount > 0 ? 'border-brand-300 bg-brand-50' : ''
          }`}
        >
          <span aria-hidden className="text-md">
            ▦
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-md">กระสอบรอส่ง</span>
            <span className="block text-sm text-ink-400">
              {sackCount > 0
                ? `มี ${sackCount} รายการรอส่ง · กดส่งแล้วได้ฟอร์มไปแปะในแชท`
                : 'ตอนนี้ไม่มีรายการรอส่ง'}
            </span>
          </span>
          {sackCount > 0 && (
            <span className="rounded-pill bg-brand-500 px-2 font-display text-xs text-ink">
              {sackCount > 99 ? '99+' : sackCount}
            </span>
          )}
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
            {mayProxy && hubOthers > 0 && (
              <span className="text-xs text-ink-400">คนอื่นถืออยู่ {hubOthers} เครื่อง</span>
            )}
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
