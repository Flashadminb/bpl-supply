import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useCart } from '../../lib/cart'
import { useAsync } from '../../lib/useAsync'
import {
  countAssetHoldings,
  listPositions,
  listAssetHoldings,
  listMyHistory,
  listOpenBorrowings,
  countPendingSacks,
} from '../../lib/api'
import { StaffPage } from '../../components/Shell'
import { EmptyState, ErrorBox, Loading, Sheet } from '../../components/ui'
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

  /**
   * ชื่อตำแหน่งที่แอดมินตั้งไว้ · ตาราง positions เล็กมากและแทบไม่เปลี่ยน
   * ดึงทั้งก้อนครั้งเดียวแล้วจับคู่เอง ถูกกว่าถามทีละคน
   * ถ้าโหลดไม่สำเร็จก็ไม่โชว์อะไร ดีกว่าโชว์รหัสดิบที่คนอ่านไม่ออก
   */
  const positions = useAsync(() => (profile?.position_code ? listPositions() : Promise.resolve([])), [profile?.position_code])
  const posName = positions.data?.find((p) => p.code === profile?.position_code)?.name ?? ''
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
  /**
   * เรื่องที่ขึ้นแถบประกาศหมุน · เฉพาะของที่เกิดในแอพ
   *
   * กระดานปล่อยรถ รถรอลงงาน ของค้างส่งออก พัสดุ 24 ชม ไม่เอามาที่นี่
   * เพราะจอพวกนั้นเปิดค้างทั้งกะอยู่แล้ว คนที่ดูแลมันนั่งมองอยู่ตลอด
   * เอามาเตือนซ้ำคือเตือนคนที่เห็นอยู่แล้ว แล้วจะกลบเรื่องที่ยังไม่มีใครเห็นจริง ๆ
   *
   * ใช้ตัวเลขที่หน้านี้ขอมาอยู่แล้วทั้งหมด ไม่ได้ยิงถามเพิ่มแม้แต่ครั้งเดียว
   */
  const lateAssets = (heldAssets.data ?? []).filter(
    (h) => h.due_at && Date.now() > Date.parse(h.due_at),
  ).length
  const notices: NoticeItem[] = []
  if (lateAssets > 0)
    notices.push({
      to: '/returns',
      text: `เลยกำหนดคืนแล้ว ${lateAssets} เครื่อง`,
      sub: 'แตะเพื่อไปคืน',
      tone: 'bad',
    })
  if (owing > 0)
    notices.push({
      to: '/returns',
      text: `ต้องคืน ${owing} รายการ`,
      sub: 'ของที่ถืออยู่ในมือคุณ',
    })
  if (approvals.count > 0)
    notices.push({
      to: '/admin/approvals',
      text: `คำขอเบิกรออนุมัติ ${approvals.count} ใบ`,
      sub: 'แตะเพื่อไปอนุมัติ',
    })
  if (sackCount > 0)
    notices.push({ to: '/ship', text: `กระสอบรอส่ง ${sackCount} รายการ`, sub: 'ใครว่างหยิบไปส่งได้' })
  if (hubOthers > 0)
    notices.push({
      to: '/returns',
      text: `คนอื่นถือของอยู่ ${hubOthers} เครื่อง`,
      sub: 'คืนแทนได้จากหน้าคืนของ',
    })

  /** งานที่เกี่ยวกับ OS · รวมเป็นไทล์เดียวเมื่อมีมากกว่าหนึ่งอย่าง */
  const [osOpen, setOsOpen] = useState(false)
  const osRows = [
    ...(mayScan
      ? [
          {
            to: '/guard',
            icon: '▣',
            short: 'บัตร OS',
            title: 'สแกนบัตร OS',
            sub: 'เช็คมือถือที่ OS นำเข้าพื้นที่ · หน้าจอเดียวกับที่ รปภ ใช้',
            sub2: 'สแกนเช็คมือถือ',
          },
        ]
      : []),
    ...(maysSeeBreak
      ? [
          {
            to: '/break',
            icon: '⏱',
            short: 'เบรค OS',
            title: 'เบรค OS',
            sub: mayIssueBreak
              ? 'ปล่อยบัตรเบรค · ดูใบที่ยังไม่ได้รับกลับ'
              : 'สแกนบัตรเบรค · ดูว่าตอนนี้ใครออกไปอยู่',
            sub2: mayIssueBreak ? 'ปล่อยบัตรเบรค' : 'สแกนบัตรเบรค',
          },
        ]
      : []),
  ]

  const guardOnly =
    profile?.can_guard === true && profile.role === 'staff' && !profile.can_dispatch

  if (guardOnly) {
    return (
      <div className="bg-canvas">
        <header className="safe-t bg-brand-500 text-ink">
          {/*
          ชื่อกับไอคอนอยู่คนละบรรทัด
          ของเดิมวางเรียงกันในแถวเดียว พอไอคอนเพิ่มขึ้นเรื่อย ๆ ช่องของชื่อก็แคบลง
          จนชื่อยาวแตกเป็นบรรทัดละตัวอักษร · แถวไอคอนตกบรรทัดเองได้
          แปลว่าเพิ่มไอคอนอีกกี่อันชื่อก็ไม่โดนบีบอีก
        */}
        <div className="mx-auto max-w-phone px-4 pb-4 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm">สวัสดี</p>
              <p className="font-display text-lg font-semibold leading-tight">
                {profile?.full_name}
              </p>
              {/* ชื่อตำแหน่งต่อท้ายไปเลย ไม่มีคำว่าตำแหน่งนำหน้า
                  ใครยังไม่ได้ตั้งก็จบแค่บทบาท ไม่มีช่องว่างหรือขีดค้างไว้ให้ดูเหมือนข้อมูลหาย */}
              <p className="mt-[2px] font-mono text-xs">
                {profile?.employee_code} · {hubName} · {profile ? roleLabel(profile) : ''}
                {posName ? ' · ' + posName : ''}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <div className="flex items-center gap-1">
                {/* สแกน · วางไว้ข้างปุ่มหลังบ้านตามที่เจ้าของระบบสั่ง
                    ทุกคนเห็น เพราะหน้าสแกน QR ใช้ได้ทุกบทบาท
                    รปภ ไปหน้าสแกนบัตรของเขา ที่เหลือไปหน้าสแกน QR */}
                <Link
                  to={profile?.can_guard ? '/guard' : '/scan'}
                  aria-label="สแกน"
                  className="flex h-tap w-tap items-center justify-center rounded-btn bg-ink text-white"
                >
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M4 8.5V6a2 2 0 0 1 2-2h2.5" />
                      <path d="M15.5 4H18a2 2 0 0 1 2 2v2.5" />
                      <path d="M20 15.5V18a2 2 0 0 1-2 2h-2.5" />
                      <path d="M8.5 20H6a2 2 0 0 1-2-2v-2.5" />
                      <path d="M3.5 12h17" />
                    </svg>
                  </Link>
                {(can(...MANAGER_ROLES) || profile?.can_dispatch) && (
                  <Link to="/admin" className="rounded-btn bg-ink px-3 py-2 text-sm text-white">
                    หลังบ้าน
                  </Link>
                )}
              </div>
              <Link to="/account" className="min-h-tap px-1 py-2 text-sm underline">
                บัญชีของฉัน
              </Link>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* เช็คอินประชุมเห็นทุกคน ไม่ใช่ของแอดมิน */}
            <MeetingCheckIn />

            {/* ตารางปล่อยรถ · เห็นทุกคน ยกเว้น รปภ ซึ่งออกไปทางสาขาอื่นของหน้านี้แล้ว */}
            <Link
              to="/trucks"
              aria-label="ตารางปล่อยรถ"
              className="flex h-tap w-tap items-center justify-center rounded-btn border border-ink/15 bg-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,.7)]"
            >
              <svg
                viewBox="0 0 24 24"
                width="26"
                height="26"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M2 7h10v9H2z" />
                <path d="M12 10h4.5l3.5 3.5V16H12z" />
                <circle cx="7" cy="18" r="1.8" />
                <circle cx="17" cy="18" r="1.8" />
              </svg>
            </Link>

            {/*
              รถรอลงงาน · เปิดให้หน้างานทุกคนแล้ว ด่านจริงอยู่ที่ my_can_wait_truck() ใน RLS
              ไอคอนเป็นตู้รถที่มีลูกศรลงของกับนาฬิกา ให้แยกออกจากไอคอนปล่อยรถที่อยู่ข้าง ๆ
            */}
            <Link
              to="/wait"
              aria-label="รถรอลงงาน"
              className="flex h-tap w-tap items-center justify-center rounded-btn border border-ink/15 bg-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,.7)]"
            >
              <svg
                viewBox="0 0 24 24"
                width="26"
                height="26"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M3 5h11v10H3z" />
                <path d="M8.5 7.5v4" />
                <path d="M6.5 9.8l2 2 2-2" />
                <circle cx="17.3" cy="15.6" r="4.7" />
                <path d="M17.3 13.2v2.6l1.8 1" />
              </svg>
            </Link>

            {/*
              ของค้างส่งออก · เจ้าของระบบกับผู้ดูแลระบบ ซึ่งใช้ role เดียวกัน
              ไอคอนเป็นกล่องซ้อนกันมีลูกศรชี้ออก สื่อว่าของกองรอออก ไม่ใช่รถ
              ต้องไม่ซ้ำกับสองอันซ้ายมือ ซึ่งเป็นรูปตู้รถทั้งคู่
            */}
            {can('admin') && (
              <Link
                to="/outbox"
                aria-label="ของค้างส่งออก"
                className="flex h-tap w-tap items-center justify-center rounded-btn border border-ink/15 bg-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,.7)]"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="26"
                  height="26"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M3 14h8v6H3z" />
                  <path d="M3 8h8v5H3z" />
                  <path d="M5 5h8v2H5z" />
                  <path d="M14 10h7" />
                  <path d="M18 7l3 3-3 3" />
                </svg>
              </Link>
            )}

            {/*
              พัสดุค้างเกิน 24 ชม · เจ้าของระบบกับผู้ดูแลระบบ เหมือนของค้างส่งออก
              ไอคอนเป็นเลข 24 ในกรอบ ไม่ใช่รูปนาฬิกาหรือกล่อง เพราะเจ้าของระบบ
              เรียกหน้านี้ว่าไอคอนเลข 24 และเลขคือสิ่งที่คนจำได้ก่อนรูป
            */}
            {can('admin') && (
              <Link
                to="/parcel24"
                aria-label="พัสดุค้างเกิน 24 ชม"
                className="flex h-tap w-tap items-center justify-center rounded-btn border border-ink/15 bg-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,.7)]"
              >
                <svg viewBox="0 0 24 24" width="26" height="26" fill="none" aria-hidden>
                  <rect
                    x="2.6"
                    y="4.4"
                    width="18.8"
                    height="15.2"
                    rx="3.4"
                    stroke="currentColor"
                    strokeWidth="1.9"
                  />
                  <text
                    x="12"
                    y="16.3"
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="800"
                    fill="currentColor"
                    fontFamily="ui-monospace, monospace"
                  >
                    24
                  </text>
                </svg>
              </Link>
            )}

            {/* ลิงก์งาน — เห็นเฉพาะแอดมิน เจ้าของระบบ และผู้ตรวจสอบ */}
            <WorkLinks />
            {can(...MANAGER_ROLES) && <NotifyBell />}
          </div>

          <NoticeStrip items={notices} />
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

          {/*
            หน้านี้เป็นหน้าแรกของบัญชี รปภ ล้วน ซึ่งมีปุ่มเดียวมาตลอด
            พอมีงานบัตรเบรคเพิ่มเข้ามา ถ้าไม่ใส่ปุ่มตรงนี้ด้วย
            เปิดสิทธิ์ให้เขาแล้วก็ยังไม่มีทางกดเข้าไปได้ นอกจากพิมพ์ URL เอง
          */}
          {maysSeeBreak && (
            <button
              type="button"
              className="mt-3 w-full rounded-panel bg-brand-500 px-4 py-9 text-center text-ink"
              // ชี้ไปที่กระดานตรง ๆ ไม่ผ่าน /break ที่เดาหน้าให้
              // บัญชีนี้เป็น รปภ ล้วน หน้าที่ถูกคือกระดานเสมอ ไม่ต้องให้เดา
              onClick={() => nav('/break/board')}
            >
              <span aria-hidden className="block text-[44px] leading-none">
                ⏱
              </span>
              <span className="mt-2 block font-display text-xl">เบรค OS</span>
              <span className="mt-1 block text-sm">สแกนบัตรเบรค · ดูว่าใครออกไปอยู่</span>
            </button>
          )}

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
        {/*
          ชื่อกับไอคอนอยู่คนละบรรทัด
          ของเดิมวางเรียงกันในแถวเดียว พอไอคอนเพิ่มขึ้นเรื่อย ๆ ช่องของชื่อก็แคบลง
          จนชื่อยาวแตกเป็นบรรทัดละตัวอักษร · แถวไอคอนตกบรรทัดเองได้
          แปลว่าเพิ่มไอคอนอีกกี่อันชื่อก็ไม่โดนบีบอีก
        */}
        <div className="mx-auto max-w-phone px-4 pb-4 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm">สวัสดี</p>
              <p className="font-display text-lg font-semibold leading-tight">
                {profile?.full_name}
              </p>
              {/* ชื่อตำแหน่งต่อท้ายไปเลย ไม่มีคำว่าตำแหน่งนำหน้า
                  ใครยังไม่ได้ตั้งก็จบแค่บทบาท ไม่มีช่องว่างหรือขีดค้างไว้ให้ดูเหมือนข้อมูลหาย */}
              <p className="mt-[2px] font-mono text-xs">
                {profile?.employee_code} · {hubName} · {profile ? roleLabel(profile) : ''}
                {posName ? ' · ' + posName : ''}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <div className="flex items-center gap-1">
                {/* สแกน · วางไว้ข้างปุ่มหลังบ้านตามที่เจ้าของระบบสั่ง
                    ทุกคนเห็น เพราะหน้าสแกน QR ใช้ได้ทุกบทบาท
                    รปภ ไปหน้าสแกนบัตรของเขา ที่เหลือไปหน้าสแกน QR */}
                <Link
                  to={profile?.can_guard ? '/guard' : '/scan'}
                  aria-label="สแกน"
                  className="flex h-tap w-tap items-center justify-center rounded-btn bg-ink text-white"
                >
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M4 8.5V6a2 2 0 0 1 2-2h2.5" />
                      <path d="M15.5 4H18a2 2 0 0 1 2 2v2.5" />
                      <path d="M20 15.5V18a2 2 0 0 1-2 2h-2.5" />
                      <path d="M8.5 20H6a2 2 0 0 1-2-2v-2.5" />
                      <path d="M3.5 12h17" />
                    </svg>
                  </Link>
                {(can(...MANAGER_ROLES) || profile?.can_dispatch) && (
                  <Link to="/admin" className="rounded-btn bg-ink px-3 py-2 text-sm text-white">
                    หลังบ้าน
                  </Link>
                )}
              </div>
              <Link to="/account" className="min-h-tap px-1 py-2 text-sm underline">
                บัญชีของฉัน
              </Link>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* เช็คอินประชุมเห็นทุกคน ไม่ใช่ของแอดมิน */}
            <MeetingCheckIn />

            {/* ตารางปล่อยรถ · เห็นทุกคน ยกเว้น รปภ ซึ่งออกไปทางสาขาอื่นของหน้านี้แล้ว */}
            <Link
              to="/trucks"
              aria-label="ตารางปล่อยรถ"
              className="flex h-tap w-tap items-center justify-center rounded-btn border border-ink/15 bg-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,.7)]"
            >
              <svg
                viewBox="0 0 24 24"
                width="26"
                height="26"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M2 7h10v9H2z" />
                <path d="M12 10h4.5l3.5 3.5V16H12z" />
                <circle cx="7" cy="18" r="1.8" />
                <circle cx="17" cy="18" r="1.8" />
              </svg>
            </Link>

            {/*
              รถรอลงงาน · เปิดให้หน้างานทุกคนแล้ว ด่านจริงอยู่ที่ my_can_wait_truck() ใน RLS
              ไอคอนเป็นตู้รถที่มีลูกศรลงของกับนาฬิกา ให้แยกออกจากไอคอนปล่อยรถที่อยู่ข้าง ๆ
            */}
            <Link
              to="/wait"
              aria-label="รถรอลงงาน"
              className="flex h-tap w-tap items-center justify-center rounded-btn border border-ink/15 bg-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,.7)]"
            >
              <svg
                viewBox="0 0 24 24"
                width="26"
                height="26"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M3 5h11v10H3z" />
                <path d="M8.5 7.5v4" />
                <path d="M6.5 9.8l2 2 2-2" />
                <circle cx="17.3" cy="15.6" r="4.7" />
                <path d="M17.3 13.2v2.6l1.8 1" />
              </svg>
            </Link>

            {/*
              ของค้างส่งออก · เจ้าของระบบกับผู้ดูแลระบบ ซึ่งใช้ role เดียวกัน
              ไอคอนเป็นกล่องซ้อนกันมีลูกศรชี้ออก สื่อว่าของกองรอออก ไม่ใช่รถ
              ต้องไม่ซ้ำกับสองอันซ้ายมือ ซึ่งเป็นรูปตู้รถทั้งคู่
            */}
            {can('admin') && (
              <Link
                to="/outbox"
                aria-label="ของค้างส่งออก"
                className="flex h-tap w-tap items-center justify-center rounded-btn border border-ink/15 bg-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,.7)]"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="26"
                  height="26"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M3 14h8v6H3z" />
                  <path d="M3 8h8v5H3z" />
                  <path d="M5 5h8v2H5z" />
                  <path d="M14 10h7" />
                  <path d="M18 7l3 3-3 3" />
                </svg>
              </Link>
            )}

            {/*
              พัสดุค้างเกิน 24 ชม · เจ้าของระบบกับผู้ดูแลระบบ เหมือนของค้างส่งออก
              ไอคอนเป็นเลข 24 ในกรอบ ไม่ใช่รูปนาฬิกาหรือกล่อง เพราะเจ้าของระบบ
              เรียกหน้านี้ว่าไอคอนเลข 24 และเลขคือสิ่งที่คนจำได้ก่อนรูป
            */}
            {can('admin') && (
              <Link
                to="/parcel24"
                aria-label="พัสดุค้างเกิน 24 ชม"
                className="flex h-tap w-tap items-center justify-center rounded-btn border border-ink/15 bg-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,.7)]"
              >
                <svg viewBox="0 0 24 24" width="26" height="26" fill="none" aria-hidden>
                  <rect
                    x="2.6"
                    y="4.4"
                    width="18.8"
                    height="15.2"
                    rx="3.4"
                    stroke="currentColor"
                    strokeWidth="1.9"
                  />
                  <text
                    x="12"
                    y="16.3"
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="800"
                    fill="currentColor"
                    fontFamily="ui-monospace, monospace"
                  >
                    24
                  </text>
                </svg>
              </Link>
            )}

            {/* ลิงก์งาน — เห็นเฉพาะแอดมิน เจ้าของระบบ และผู้ตรวจสอบ */}
            <WorkLinks />
            {can(...MANAGER_ROLES) && <NotifyBell />}
          </div>

          <NoticeStrip items={notices} />
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

        {/*
          เมนูดำเนินการ · การ์ดสี่เหลี่ยมสามใบต่อแถว ไม่ใช่แถบยาวเรียงลงมา
          แถบยาวหนึ่งแถบกินความสูงเท่าการ์ดสามใบ พอมีหกเมนูก็ต้องเลื่อนทั้งหน้า
          ทั้งที่ของจริงมีไม่กี่อัน · ตารางทำให้เห็นทุกเมนูพร้อมกันโดยไม่ต้องเลื่อน
          ซึ่งสำคัญกับคนที่เปิดแอพกลางงานแล้วต้องกดให้ถูกตั้งแต่ครั้งแรก
        */}
        <p className="label mt-4">เมนูดำเนินการ</p>
        <div className="grid grid-cols-3 gap-2">
          {(profile?.can_assets || can(...MANAGER_ROLES)) && (
            <Tile to="/assets" icon="⚙" title="Asset" sub="เบิก · คืนเครื่อง" hot />
          )}

          {osRows.length === 1 && (
            <Tile to={osRows[0].to} icon={osRows[0].icon} title={osRows[0].short} sub={osRows[0].sub2} />
          )}
          {osRows.length > 1 && (
            <Tile onClick={() => setOsOpen(true)} icon="▣" title="งาน OS" sub="บัตร · เบรค" />
          )}

          <Tile to="/items" icon="☰" title="วัสดุ" sub="เบิกของใช้" />

          <Tile
            to="/returns"
            icon="↩"
            title="คืนของ"
            sub={
              borrow.loading || heldAssets.loading
                ? 'กำลังตรวจ…'
                : owing > 0
                  ? `ค้าง ${owing} รายการ`
                  : 'ไม่มีของค้าง'
            }
            badge={owing > 0 ? owing : 0}
            hot={owing > 0}
          />

          {seesSacks && (
            <Tile
              to="/ship"
              icon="▦"
              title="กระสอบ"
              sub={sackCount > 0 ? `รอส่ง ${sackCount}` : 'ไม่มีรอส่ง'}
              badge={sackCount}
              hot={sackCount > 0}
            />
          )}

          <Tile to="/by" icon="▤" title="บาร์โค้ด BY" sub="ของนอกระบบ" />
        </div>

        {mayProxy && hubOthers > 0 && (
          <p className="mt-2 text-center text-sm text-ink-400">
            คนอื่นถืออยู่ {hubOthers} เครื่อง · คืนแทนได้จากหน้าคืนของ
          </p>
        )}

        {/* เลือกงาน OS · ใช้แผ่นเลื่อนขึ้นแทนการพาไปอีกหน้า
            จะได้ไม่ต้องกดสามครั้งกว่าจะถึงของที่เมื่อวานกดสองครั้ง */}
        <Sheet open={osOpen} onClose={() => setOsOpen(false)} title="งาน OS">
          <div className="space-y-2">
            {osRows.map((r) => (
              <Link
                key={r.to}
                to={r.to}
                onClick={() => setOsOpen(false)}
                className="card flex items-center gap-3 p-4"
              >
                <span aria-hidden className="text-md">
                  {r.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-md">{r.title}</span>
                  <span className="block text-sm text-ink-400">{r.sub}</span>
                </span>
                <span aria-hidden className="text-ink-400">
                  ›
                </span>
              </Link>
            ))}
          </div>
        </Sheet>

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

interface NoticeItem {
  to: string
  text: string
  sub: string
  tone?: 'bad'
}

/**
 * แถบประกาศหมุน
 *
 * หมุนเองทุกหกวินาที · เลือกหมุนแทนการแบ่งช่อง เพราะแบ่งช่องแล้วแต่ละช่อง
 * เหลือที่ไม่ถึงครึ่งบรรทัด พอชื่อของยาวก็ตัดหายหมด
 * แถบเดียวเต็มความกว้างอ่านจบในสายตาเดียว และคนหน้างานถือมือถือมือเดียวอยู่แล้ว
 *
 * มีเรื่องเดียวก็ไม่ต้องหมุนและไม่ต้องมีจุด · ไม่มีเรื่องเลยก็ไม่ขึ้นทั้งแถบ
 * แถบว่างที่ขึ้นค้างไว้คือพื้นที่ที่เสียไปเปล่า ๆ ทุกวัน
 */
function NoticeStrip({ items }: { items: NoticeItem[] }) {
  const [i, setI] = useState(0)

  useEffect(() => {
    if (items.length < 2) return
    const t = setInterval(() => setI((n) => (n + 1) % items.length), 6000)
    return () => clearInterval(t)
  }, [items.length])

  if (items.length === 0) return null
  const cur = items[Math.min(i, items.length - 1)]

  return (
    <Link
      to={cur.to}
      className={`mt-3 flex items-center gap-2 rounded-card border-2 bg-surface px-3 py-2 ${
        cur.tone === 'bad' ? 'border-danger' : 'border-brand-500'
      }`}
    >
      <span
        aria-hidden
        className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-btn text-sm ${
          cur.tone === 'bad' ? 'bg-danger-bg text-danger-txt' : 'bg-brand-50 text-ink'
        }`}
      >
        {cur.tone === 'bad' ? '!' : '↩'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-base text-ink">{cur.text}</span>
        <span className="block truncate text-xs text-ink-500">{cur.sub}</span>
      </span>
      {items.length > 1 && (
        <span className="flex shrink-0 gap-[3px]" aria-hidden>
          {items.map((x, n) => (
            <i
              key={x.to + x.text}
              className={`block h-[5px] w-[5px] rounded-full ${n === i ? 'bg-ink' : 'bg-line'}`}
            />
          ))}
        </span>
      )}
    </Link>
  )
}

/**
 * ไทล์งาน OS · รวมของที่เกี่ยวกับ OS ไว้ที่เดียวตามที่เจ้าของระบบสั่ง
 *
 * รวมเฉพาะตอนที่คนนั้นเห็นทั้งสองอย่างจริง ถ้ามีสิทธิ์อย่างเดียว
 * ก็โชว์อันนั้นตรง ๆ เหมือนเดิม · กล่องห่อที่มีของอยู่ชิ้นเดียวคือ
 * การเพิ่มจำนวนครั้งที่ต้องกดโดยไม่ได้อะไรกลับมา
 *
 * กางในที่เดิม ไม่ได้พาไปหน้าใหม่ เพราะถ้าพาไปหน้ารวมอีกหน้า
 * คนจะต้องกดสามครั้งกว่าจะถึงของที่เมื่อวานกดสองครั้ง
 *
 * หน้าของ รปภ เป็นคนละหน้ากันอยู่แล้ว จึงไม่โดนรวมตามที่สั่งไว้
 */
/**
 * การ์ดเมนูทรงสี่เหลี่ยม
 *
 * สูงเท่ากันทุกใบด้วย min-h เพราะคำบรรยายยาวไม่เท่ากัน
 * ถ้าปล่อยให้สูงตามเนื้อหา แถวจะเป็นฟันปลาแล้วดูเหมือนจัดวางพลาด
 */
function Tile({
  to,
  onClick,
  icon,
  title,
  sub,
  badge = 0,
  hot = false,
}: {
  to?: string
  onClick?: () => void
  icon: string
  title: string
  sub: string
  badge?: number
  hot?: boolean
}) {
  const cls = `card relative flex min-h-[96px] flex-col justify-between p-3 text-left ${
    hot ? 'border-brand-300 bg-brand-50' : ''
  }`
  const inner = (
    <>
      <span aria-hidden className="text-md">
        {icon}
      </span>
      <span className="block font-display text-base leading-tight">{title}</span>
      <span className="block text-xs text-ink-400">{sub}</span>
      {badge > 0 && (
        <span className="absolute right-2 top-2 min-w-[20px] rounded-pill bg-brand-500 px-1 text-center font-display text-[11px] text-ink">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </>
  )
  if (to) return <Link to={to} className={cls}>{inner}</Link>
  return (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  )
}

