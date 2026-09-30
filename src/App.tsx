import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Suspense, lazy, useEffect, type ReactNode } from 'react'
import { useAuth } from './lib/auth'
import type { UserRole } from './lib/types'
import { MANAGER_ROLES } from './lib/roles'
import { Loading } from './components/ui'

import Login from './pages/staff/Login'
import Home from './pages/staff/Home'
import Items from './pages/staff/Items'
import ItemDetail from './pages/staff/ItemDetail'
import Cart from './pages/staff/Cart'
import Evidence from './pages/staff/Evidence'
import Success from './pages/staff/Success'
import History from './pages/staff/History'
import Account from './pages/staff/Account'
import FirstPassword from './pages/staff/FirstPassword'
import { Privacy, Terms } from './pages/Legal'

// หน้าที่ลากไลบรารีหนัก (zxing) หรือใช้เฉพาะแอดมิน — โหลดเมื่อเปิดจริงเท่านั้น
// เน็ตในฮับไม่นิ่ง หน้าแรกต้องเบาที่สุด
const Scan = lazy(() => import('./pages/staff/Scan'))
const Returns = lazy(() => import('./pages/staff/Returns'))
const AssetPick = lazy(() => import('./pages/staff/AssetPick'))
// หน้าเลือกประเภทเดิมถูกแทนด้วยตะกร้า ซึ่งเลือกข้ามประเภทได้ในรอบเดียว
// เส้นทางเดิม /assets/:typeCode ยังอยู่ เผื่อมีลิงก์เก่าค้างในแจ้งเตือนหรือที่คนบุ๊กมาร์กไว้
const AssetBasket = lazy(() => import('./pages/staff/AssetBasket'))
const AssetDone = lazy(() => import('./pages/staff/AssetDone'))
const BySend = lazy(() => import('./pages/staff/BySend'))
// กระสอบรอส่ง — เปิดเมื่อมีงานเข้าคิวเท่านั้น ไม่ควรถ่วงหน้าแรก
const Ship = lazy(() => import('./pages/staff/Ship'))
// หน้าสแกนของ รปภ — ลากกล้องมาด้วย จึงไม่ควรอยู่ในก้อนหน้าแรก
const GuardScan = lazy(() => import('./pages/staff/GuardScan'))
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'))
const Dashboard = lazy(() => import('./pages/admin/Dashboard'))
const Stock = lazy(() => import('./pages/admin/Stock'))
const Approvals = lazy(() => import('./pages/admin/Approvals'))
const Users = lazy(() => import('./pages/admin/Users'))
const ExportSheet = lazy(() => import('./pages/admin/ExportSheet'))
const AdminEvidence = lazy(() => import('./pages/admin/Evidence'))
const ReturnStatus = lazy(() => import('./pages/admin/ReturnStatus'))
const WorkLinksAdmin = lazy(() => import('./pages/admin/WorkLinksAdmin'))
const SystemHealth = lazy(() => import('./pages/admin/SystemHealth'))
const Notices = lazy(() => import('./pages/admin/Notices'))
const QrLabels = lazy(() => import('./pages/admin/QrLabels'))
const Outstanding = lazy(() => import('./pages/admin/Outstanding'))
const AssetRegistry = lazy(() => import('./pages/admin/AssetRegistry'))
const AssetOutstanding = lazy(() => import('./pages/admin/AssetOutstanding'))
const ByInbox = lazy(() => import('./pages/admin/ByInbox'))
const SupplyReport = lazy(() => import('./pages/admin/SupplyReport'))
const AssetReport = lazy(() => import('./pages/admin/AssetReport'))
const Meetings = lazy(() => import('./pages/admin/Meetings'))
const SupplyHistory = lazy(() => import('./pages/admin/SupplyHistory'))
const MeetingEvidence = lazy(() => import('./pages/admin/MeetingEvidence'))
const MeetingReport = lazy(() => import('./pages/admin/MeetingReport'))
const SackOrders = lazy(() => import('./pages/admin/SackOrders'))
const OsPeople = lazy(() => import('./pages/admin/OsPeople'))
const OsCards = lazy(() => import('./pages/admin/OsCards'))
const OsScans = lazy(() => import('./pages/admin/OsScans'))

function Guard({
  children,
  roles,
  allowDispatch,
  allowGuard,
}: {
  children: ReactNode
  roles?: UserRole[]
  /** ผู้ตรวจสอบเข้าได้ด้วย แม้ role จริงจะเป็น staff */
  allowDispatch?: boolean
  /** รปภ เข้าได้ด้วย — ใช้กับหน้าสแกนบัตร OS หน้าเดียวเท่านั้น */
  allowGuard?: boolean
}) {
  const { session, profile, loading } = useAuth()
  const loc = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas">
        <Loading label="กำลังเตรียมระบบ…" />
      </div>
    )
  }
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  if (!profile) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas p-4 text-center">
        <p className="text-base text-ink-500">
          บัญชีนี้ยังไม่มีโปรไฟล์พนักงานในระบบ ติดต่อแอดมินให้เพิ่มแถวใน <code>profiles</code>
        </p>
      </div>
    )
  }
  if (!profile.is_active) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas p-4 text-center">
        <p className="text-base text-ink-500">บัญชีนี้ถูกระงับการใช้งาน ติดต่อแอดมิน</p>
      </div>
    )
  }
  // รหัสที่แอดมินตั้งให้เป็นของชั่วคราว ต้องตั้งเองก่อนถึงเข้าหน้าอื่นได้ กดข้ามไม่ได้
  if (profile.must_change_password) return <FirstPassword />
  const roleOk =
    !roles ||
    roles.includes(profile.role) ||
    (allowDispatch && profile.can_dispatch) ||
    (allowGuard && profile.can_guard)
  if (!roleOk) return <Navigate to="/" replace />
  return <>{children}</>
}

/**
 * หน้าแรกของฝั่งแอดมิน
 *
 * แดชบอร์ดเป็นของแอดมินขึ้นไป ผู้ตรวจสอบเปิดไม่ได้
 * ถ้าปล่อยให้ตกมาที่นี่ เขาจะโดนเด้งกลับหน้าแอปทันทีที่กดเข้ามา
 * ซึ่งดูเหมือน เข้าเว็บไม่ได้ ทั้งที่จริงแค่ไม่มีหน้าแรกให้ยืน
 * จึงพาไปที่เมนูแรกที่เขาเปิดได้แทน
 */
function AdminHome() {
  const { profile, can } = useAuth()
  if (can(...MANAGER_ROLES)) return <Dashboard />
  if (profile?.can_dispatch) return <Navigate to="/admin/meetings" replace />
  return <Navigate to="/" replace />
}

function Fallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas">
      <Loading label="กำลังเปิดหน้า…" />
    </div>
  )
}

/**
 * เด้งขึ้นบนสุดทุกครั้งที่เปลี่ยนหน้า
 *
 * เบราว์เซอร์จำตำแหน่งสกรอลล์ของหน้าเดิมไว้ พอหน้าใหม่สั้นกว่า
 * หัวข้อจะจมอยู่ใต้แถบสถานะของมือถือ หน้างานเห็นแต่ครึ่งบรรทัด
 * เห็นชัดที่สุดตอนกดส่งจากท้ายหน้าเบิกแล้วเด้งไปใบสรุป
 *
 * ไม่ใช้ ScrollRestoration ของ react-router เพราะมันคืนตำแหน่งเก่า
 * ตอนกดย้อนกลับด้วย ซึ่งเจอปัญหาเดียวกันอีก
 */
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    // ปิดการคืนตำแหน่งอัตโนมัติของเบราว์เซอร์ ไม่งั้นมันจะเลื่อนกลับทับเรา
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

export default function App() {
  return (
    <Suspense fallback={<Fallback />}>
    <ScrollToTop />
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* เปิดได้โดยไม่ต้องล็อกอิน — Google ต้องตามมาเช็คได้ */}
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />

      {/* ฝั่งพนักงาน */}
      <Route path="/" element={<Guard><Home /></Guard>} />
      <Route path="/scan" element={<Guard><Scan /></Guard>} />
      <Route path="/items" element={<Guard><Items /></Guard>} />
      <Route path="/items/:id" element={<Guard><ItemDetail /></Guard>} />
      <Route path="/cart" element={<Guard><Cart /></Guard>} />
      <Route path="/evidence" element={<Guard><Evidence /></Guard>} />
      <Route path="/success/:refNo" element={<Guard><Success /></Guard>} />
      <Route path="/returns" element={<Guard><Returns /></Guard>} />
      <Route path="/by" element={<Guard><BySend /></Guard>} />
      <Route path="/ship" element={<Guard><Ship /></Guard>} />
      {/*
        หน้าเดียวที่ รปภ เข้าได้ และคนที่จัดการรายชื่อ OS ก็เข้าได้
        ฐานข้อมูลกันซ้ำอีกชั้นใน os_scan() ไม่ได้กันแค่เส้นทาง
      */}
      <Route
        path="/guard"
        element={
          <Guard roles={MANAGER_ROLES} allowGuard allowDispatch>
            <GuardScan />
          </Guard>
        }
      />
      <Route path="/assets" element={<Guard><AssetBasket /></Guard>} />
      <Route path="/assets/done/:refNo" element={<Guard><AssetDone /></Guard>} />
      <Route path="/assets/:typeCode" element={<Guard><AssetPick /></Guard>} />
      <Route path="/history" element={<Guard><History /></Guard>} />
      <Route path="/account" element={<Guard><Account /></Guard>} />

      {/* ฝั่งแอดมิน — "แอดมิน" (supervisor) ทำได้ทุกหน้า ยกเว้นจัดการผู้ใช้ */}
      <Route
        path="/admin"
        element={
          <Guard roles={MANAGER_ROLES} allowDispatch>
            <AdminLayout />
          </Guard>
        }
      >
        <Route index element={<AdminHome />} />
        <Route path="approvals" element={<Guard roles={MANAGER_ROLES}><Approvals /></Guard>} />
        <Route path="stock" element={<Guard roles={MANAGER_ROLES}><Stock /></Guard>} />
        <Route path="outstanding" element={<Guard roles={MANAGER_ROLES} allowDispatch><Outstanding /></Guard>} />
        {/*
          ผู้ตรวจสอบเข้าทะเบียนได้ แต่ทำได้อย่างเดียวคือกดโอน
          ปุ่มเพิ่ม แก้ ลบ และจัดการแผนก ผูกกับ MANAGER_ROLES อยู่แล้วในหน้านั้น
          และฐานข้อมูลก็กันซ้ำอีกชั้น (write_assets กับ delete_asset เปิดให้แค่แอดมินขึ้นไป)
          เปิดสิทธิ์ตรงนี้จึงไม่ได้เพิ่มอำนาจอะไรให้เขานอกจากได้เห็นและได้โอน
        */}
        <Route
          path="assets"
          element={
            <Guard roles={MANAGER_ROLES} allowDispatch>
              <AssetRegistry />
            </Guard>
          }
        />
        <Route path="assets-out" element={<Guard roles={MANAGER_ROLES} allowDispatch><AssetOutstanding /></Guard>} />
        <Route path="by" element={<Guard roles={MANAGER_ROLES}><ByInbox /></Guard>} />
        {/*
          ผู้ตรวจสอบเห็นหน้านี้ แต่ปุ่มตั้งรายการซ่อนไว้ในหน้านั้นเอง
          และ create_sack_order ในฐานข้อมูลก็ปฏิเสธเขาอยู่แล้วอีกชั้น
        */}
        {/* กระสอบเป็นงานของเจ้าของระบบกับแอดมิน ผู้ตรวจสอบไม่เกี่ยว */}
        <Route path="sacks" element={<Guard roles={MANAGER_ROLES}><SackOrders /></Guard>} />
        {/* บัตร OS — ผู้ตรวจสอบจัดการได้เต็ม ตรงกับ my_can_os_admin() ในฐานข้อมูล */}
        <Route path="os" element={<Guard roles={MANAGER_ROLES} allowDispatch><OsPeople /></Guard>} />
        <Route path="os/print" element={<Guard roles={MANAGER_ROLES} allowDispatch><OsCards /></Guard>} />
        <Route path="os/scans" element={<Guard roles={MANAGER_ROLES} allowDispatch><OsScans /></Guard>} />
        <Route path="report/supply" element={<Guard roles={MANAGER_ROLES}><SupplyReport /></Guard>} />
        <Route path="report/asset" element={<Guard roles={MANAGER_ROLES}><AssetReport /></Guard>} />
        <Route path="export" element={<Guard roles={MANAGER_ROLES}><ExportSheet /></Guard>} />
        <Route path="evidence" element={<Guard roles={MANAGER_ROLES}><AdminEvidence /></Guard>} />
        <Route
          path="return-status"
          element={<Guard roles={MANAGER_ROLES} allowDispatch><ReturnStatus /></Guard>}
        />
        <Route path="qr" element={<Guard roles={MANAGER_ROLES}><QrLabels /></Guard>} />
        {/* สองหน้านี้ผู้ตรวจสอบเข้าได้ด้วย นอกนั้นเป็นของแอดมินล้วน */}
        <Route path="meetings" element={<Guard roles={MANAGER_ROLES} allowDispatch><Meetings /></Guard>} />
        <Route
          path="meeting-evidence"
          element={<Guard roles={MANAGER_ROLES} allowDispatch><MeetingEvidence /></Guard>}
        />
        <Route
          path="report/meeting"
          element={<Guard roles={MANAGER_ROLES} allowDispatch><MeetingReport /></Guard>}
        />
        <Route
          path="supply-history"
          element={<Guard roles={MANAGER_ROLES} allowDispatch><SupplyHistory /></Guard>}
        />
        {/* เพิ่มบัญชี / รีเซ็ตรหัสผ่านคนอื่น เป็นของผู้ดูแลระบบคนเดียว */}
        <Route path="users" element={<Guard roles={MANAGER_ROLES}><Users /></Guard>} />
        <Route path="links" element={<Guard roles={MANAGER_ROLES}><WorkLinksAdmin /></Guard>} />
        {/* ป้ายประกาศเปิดให้แอดมินด้วย ส่วนแท็บนัดประชุมกับกฎเวลาซ่อนในหน้านั้นเอง */}
        <Route
          path="notices"
          element={
            <Guard roles={MANAGER_ROLES} allowDispatch>
              <Notices />
            </Guard>
          }
        />
        <Route
          path="health"
          element={
            <Guard roles={['admin', 'supervisor']} allowDispatch>
              <SystemHealth />
            </Guard>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  )
}
