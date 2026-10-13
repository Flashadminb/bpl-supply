import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Suspense, lazy, useEffect, type ReactNode } from 'react'
import { useFallbackTitle } from './lib/pageTitle'
import { useAuth } from './lib/auth'
import type { UserRole } from './lib/types'
import { MANAGER_ROLES, canSeeSacks, canBreakIssue, canBreakGuard } from './lib/roles'
import { useDeptNames } from './lib/deptNames'
import { PushNag } from './components/PushNag'
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
const OutBox = lazy(() => import('./pages/admin/OutBox'))
const Parcel24 = lazy(() => import('./pages/admin/Parcel24'))
const Pair = lazy(() => import('./pages/admin/Pair'))
const OutZones = lazy(() => import('./pages/admin/OutZones'))
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
const AssetMoves = lazy(() => import('./pages/admin/AssetMoves'))
const Access = lazy(() => import('./pages/admin/Access'))
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
const BreakCards = lazy(() => import('./pages/admin/BreakCards'))
const BreakHistory = lazy(() => import('./pages/admin/BreakHistory'))
const BreakAudit = lazy(() => import('./pages/admin/BreakAudit'))
const BreakIssue = lazy(() => import('./pages/staff/BreakIssue'))
const BreakGuard = lazy(() => import('./pages/staff/BreakGuard'))
const BreakMine = lazy(() => import('./pages/staff/BreakMine'))
const TruckBoard = lazy(() => import('./pages/trucks/TruckBoard'))
const TruckTv = lazy(() => import('./pages/trucks/TruckTv'))
const TruckStats = lazy(() => import('./pages/trucks/TruckStats'))
const TruckLog = lazy(() => import('./pages/trucks/TruckLog'))
// รถรอลงงาน — คนละงานกับปล่อยรถ ใช้ร่วมกันแค่นาฬิกากับเสียงเตือน
const WaitBoard = lazy(() => import('./pages/wait/WaitBoard'))
const WaitTv = lazy(() => import('./pages/wait/WaitTv'))
const WaitLog = lazy(() => import('./pages/wait/WaitLog'))
const WaitStats = lazy(() => import('./pages/wait/WaitStats'))
const TruckAdmin = lazy(() => import('./pages/admin/TruckAdmin'))
const WaitAdmin = lazy(() => import('./pages/admin/WaitAdmin'))
const AssetBoard = lazy(() => import('./pages/admin/AssetBoard'))

function Guard({
  children,
  roles,
  allowDispatch,
  allowGuard,
  needsSack,
  needsBreak,
}: {
  children: ReactNode
  roles?: UserRole[]
  /** ผู้ตรวจสอบเข้าได้ด้วย แม้ role จริงจะเป็น staff */
  allowDispatch?: boolean
  /** รปภ เข้าได้ด้วย — ใช้กับหน้าสแกนบัตร OS หน้าเดียวเท่านั้น */
  allowGuard?: boolean
  /** ต้องมีสิทธิ์เห็นงานกระสอบ — ซ่อนไทล์อย่างเดียวไม่พอ คนรู้ URL ยังเข้าได้ */
  needsSack?: boolean
  /**
   * ต้องมีสิทธิ์เรื่องบัตรเบรค
   *   issue  ปล่อยบัตรได้ · guard สแกนได้ · any อย่างใดอย่างหนึ่งก็เข้าได้
   * ฐานข้อมูลปฏิเสธซ้ำอีกชั้นในทุก RPC ตรงนี้แค่ไม่ให้กดเข้ามาเจอหน้าว่าง
   */
  needsBreak?: 'issue' | 'guard' | 'any'
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
  if (needsSack && !canSeeSacks(profile)) return <Navigate to="/" replace />
  if (needsBreak) {
    const ok =
      needsBreak === 'issue'
        ? canBreakIssue(profile)
        : needsBreak === 'guard'
          ? canBreakGuard(profile)
          : canBreakIssue(profile) || canBreakGuard(profile)
    if (!ok) return <Navigate to="/" replace />
  }
  return <>{children}</>
}

/**
 * /break พาไปหน้าที่ถูกกับคนที่เปิด
 *
 * แจ้งเตือนทุกชนิดชี้มาที่ /break เส้นเดียว เพราะตอนยิงเตือนยังไม่รู้ว่า
 * คนรับเป็นหัวหน้างานหรือ รปภ · หัวหน้าได้หน้าปล่อยบัตร ที่เหลือได้กระดาน
 */
function BreakEntry() {
  const { profile } = useAuth()
  return canBreakIssue(profile) ? <BreakIssue /> : <BreakGuard />
}

/**
 * กระดานของใครของมัน
 *
 * รปภ ได้กระดานที่มีปุ่มสแกน เพราะเขายืนอยู่ที่ประตูและเป็นคนกดรับกลับ
 * หัวหน้างานได้บัตรของตัวเอง เพราะเขาไม่ได้ยืนที่ประตู ไม่มีอะไรให้สแกน
 * ของเดิมสองคนนี้เห็นหน้าเดียวกัน หัวหน้าจึงมีปุ่มสแกนที่กดได้จริง
 * ทั้งที่การกดรับกลับเป็นหน้าที่ของ รปภ คนเดียว
 */
function BreakBoardEntry() {
  const { profile } = useAuth()
  return canBreakGuard(profile) ? <BreakGuard /> : <BreakMine />
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

/** เรียก hook ชื่อแท็บสำรอง · ต้องอยู่ในคอมโพเนนต์ จึงห่อเป็นตัวเปล่า */
function TitleFromPath() {
  useFallbackTitle()
  return null
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
  /* พจนานุกรมชื่อแผนก · โหลดครั้งเดียวที่ราก แล้วทุกหน้าเรียก deptName ได้เลย */
  useDeptNames()

  return (
    <Suspense fallback={<Fallback />}>
    <ScrollToTop />
    {/* ชื่อแท็บสำรองจาก path · ไว้ให้หน้าเต็มจอที่ไม่มีแถบหัว
        อย่างกระดานปล่อยรถ รถรอลงงาน ของค้างส่งออก จอทีวี
        หน้าที่รู้ชื่อตัวเองอยู่แล้วไม่ถูกทับ */}
    <TitleFromPath />
    {/* เด้งขอเปิดแจ้งเตือนถ้าบัญชีนี้ยังไม่มีเครื่องไหนเปิดไว้ · เงียบเองถ้าเปิดแล้ว */}
    <PushNag />
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
      <Route path="/ship" element={<Guard needsSack><Ship /></Guard>} />
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
      {/* บัตรเบรค OS — หัวหน้างานปล่อย รปภ สแกน · คนอื่นไม่เห็นเมนูและเข้าไม่ได้ */}
      <Route path="/break" element={<Guard needsBreak="any"><BreakEntry /></Guard>} />
      <Route path="/break/board" element={<Guard needsBreak="any"><BreakBoardEntry /></Guard>} />
      {/* ตารางปล่อยรถ — หน้าเต็มจอของตัวเอง ไม่ใช้กรอบของแอพเบิกของ
          รอบแรกเปิดให้เจ้าของระบบคนเดียวตามที่สั่ง ยังไม่เปิดให้หน้างาน
          ด่านจริงอยู่ที่ RLS ใน my_can_truck() เส้นทางนี้แค่ไม่ให้กดเข้ามาเจอหน้าว่าง */}
{/*
        ตารางปล่อยรถ · เปิดให้หน้างานทุกคน ตามที่สั่งไว้ตั้งแต่วันแรกว่าทุกคนพิมพ์ได้
        งานหลังบ้านที่ /admin/trucks ยังเป็นของผู้ดูแลระบบคนเดียวเหมือนเดิม
      */}
      <Route path="/trucks" element={<Guard><TruckBoard /></Guard>} />
      <Route path="/trucks/tv" element={<Guard><TruckTv /></Guard>} />
      <Route path="/trucks/stats" element={<Guard><TruckStats /></Guard>} />
      <Route path="/trucks/history" element={<Guard><TruckLog /></Guard>} />
      {/*
        รถรอลงงาน · เปิดให้หน้างานทุกคนแล้ว รอบทดสอบผ่านแล้วตามที่เจ้าของระบบสั่ง
        ด่านจริงอยู่ที่ my_can_wait_truck() ใน RLS ซึ่งเปิดให้ทุกบัญชีที่ยังใช้งานอยู่
        ที่ยังไม่เปิดให้ทุกคนคือการแก้เกณฑ์เวลา อยู่ที่ /admin/wait และคุมด้วย policy แยกของ wait_truck_kpi
      */}
      {/* ของค้างส่งออก · หน้าเต็มจอของตัวเอง ไม่ใช้กรอบหลังบ้าน
          แบบเดียวกับกระดานปล่อยรถและรถรอลงงาน เพราะเป็นจอที่เปิดค้างไว้ดู
          ไม่ใช่หน้าตั้งค่าที่เข้าไปทำแล้วออก
          เจ้าของระบบกับผู้ดูแลระบบ ซึ่งใช้ role = admin ร่วมกัน
          ด่านจริงอยู่ที่ RLS ของ hub_out_* ซึ่งตรวจ my_can_outbox() ทุกตารางและทุก RPC */}
      {/* หน้างานดูได้ · อัปไฟล์ ถอนรอบ และตั้งโซน ยังเป็นของผู้ดูแลระบบ
          กันที่ปุ่มในหน้านั้นและที่ฐานข้อมูลอีกชั้น ไม่ได้กันที่เส้นทางนี้ */}
      <Route path="/outbox" element={<Guard><OutBox /></Guard>} />

      {/* พัสดุค้างเกิน 24 ชม · จอเต็มของตัวเองเหมือนของค้างส่งออก
          เจ้าของระบบกับผู้ดูแลระบบ ด่านจริงอยู่ที่ RLS ของ parcel24_* ที่ตรวจ my_can_outbox() */}
      {/* หน้างานดูได้ · อัปไฟล์ยังเป็นของผู้ดูแลระบบ กันที่ปุ่มและที่ฐานข้อมูลอีกชั้น */}
      <Route path="/parcel24" element={<Guard><Parcel24 /></Guard>} />

      {/* จับคู่ · จอเต็มของตัวเอง ฟิลเดียวกับพัสดุค้างเกิน 24 ชม
          เจ้าของระบบกับผู้ดูแลระบบเท่านั้น หน้างานยังไม่เปิด ต่างจากงาน 24
          ด่านจริงอยู่ที่ RLS ของ p48_* ซึ่งตรวจ my_can_outbox() ทุกตารางและทุก RPC
          ชื่อตารางฝั่งฐานข้อมูลยังเป็น p48_ เพราะเป็นชื่อที่ไม่มีใครเห็น
          เปลี่ยนแปลว่าต้องเขียน 12 ฟังก์ชันใหม่ทั้งชุด โดยไม่ได้อะไรกลับมา */}
      <Route path="/pair" element={<Guard roles={['admin']}><Pair /></Guard>} />
      {/* เส้นทางเดิมสมัยที่ยังเข้าใจผิดว่าหน้านี้เกี่ยวกับกรอบ 48 ชั่วโมง
          เก็บไว้ให้ลิงก์ที่ใครเผลอบันทึกไว้ยังเข้าได้ ไม่ตายเงียบ */}
      <Route path="/parcel48" element={<Navigate to="/pair" replace />} />
      <Route path="/wait" element={<Guard><WaitBoard /></Guard>} />
      {/* เส้นทางเดิมของหน้าอัปไฟล์ · ตอนนี้เป็นป็อปอัพบนกระดานแล้ว พาไปที่กระดานพร้อมเปิดช่องเลือกไฟล์ */}
      <Route path="/wait/upload" element={<Navigate to="/wait?upload=1" replace />} />
      <Route path="/wait/tv" element={<Guard><WaitTv /></Guard>} />
      <Route path="/wait/history" element={<Guard><WaitLog /></Guard>} />
      <Route path="/wait/stats" element={<Guard><WaitStats /></Guard>} />
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
          ทะเบียนเครื่องเป็นของแอดมินขึ้นไป · ผู้ตรวจสอบไม่เห็นตามที่เจ้าของระบบสั่ง
          เขายังโอนเครื่องได้จากหน้า "Asset ที่ยังไม่คืน" ซึ่งเป็นหน้าที่เห็นเครื่องที่ถูกยืมอยู่
          จึงไม่ได้ตัดงานโอนทิ้ง แค่ย้ายให้เหลือทางเดียวที่ตรงกับงานเขา
        */}
        <Route
          path="assets"
          element={
            <Guard roles={MANAGER_ROLES}>
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
        {/* บัตรเบรค · สามชั้น คุมที่ฐานข้อมูลใน migration 138 แล้วหน้าจอซ่อนแท็บตามให้ตรงกัน
              บัตร แผนกบัตร และพิมพ์   ผู้ดูแลระบบ · แอดมิน · ผู้ตรวจสอบ   break_card_guard()
              คนรับแจ้งเตือนเรื่องเบรค  ผู้ดูแลระบบ · แอดมิน               break_alert_guard()
              ห้ามเบรค และนาทีของเหตุผล ผู้ดูแลระบบเท่านั้น                break_admin_guard()
            ห้ามเบรคยังแคบสุด เพราะเป็นเครื่องมือคุมหัวหน้างานโดยตรง */}
        <Route
          path="break/cards"
          element={<Guard roles={MANAGER_ROLES} allowDispatch><BreakCards /></Guard>}
        />
        {/* ประวัติเป็นหน้าอ่านอย่างเดียว ผู้ตรวจสอบเข้าได้ด้วย
            RLS ของ break_passes เปิดให้เขาเห็นทุกใบอยู่แล้ว */}
        <Route
          path="break/history"
          element={<Guard roles={MANAGER_ROLES} allowDispatch><BreakHistory /></Guard>}
        />
        {/* ประวัติการแก้ไข · อ่านอย่างเดียว ลบไม่ได้ · ผู้ตรวจสอบเข้าได้เหมือนประวัติเบรค */}
        <Route
          path="break/audit"
          element={<Guard roles={MANAGER_ROLES} allowDispatch><BreakAudit /></Guard>}
        />
        <Route path="report/supply" element={<Guard roles={MANAGER_ROLES}><SupplyReport /></Guard>} />
        {/* รายงาน Asset · ผู้ตรวจสอบดูได้ เป็นรายงานล้วน ไม่มีปุ่มคืนแทนหรือปุ่มสั่งการ */}
        <Route
          path="report/asset"
          element={<Guard roles={MANAGER_ROLES} allowDispatch><AssetReport /></Guard>}
        />
        <Route path="export" element={<Guard roles={MANAGER_ROLES}><ExportSheet /></Guard>} />
        <Route path="evidence" element={<Guard roles={MANAGER_ROLES}><AdminEvidence /></Guard>} />
        <Route
          path="return-status"
          element={<Guard roles={MANAGER_ROLES} allowDispatch><ReturnStatus /></Guard>}
        />
        {/* โอน-แจ้งเสีย เป็นหน้าอ่านอย่างเดียว ผู้ตรวจสอบเข้าได้ด้วย
            เพราะเป็นงานตามของ ไม่ใช่งานสั่งการ */}
        <Route
          path="asset-moves"
          element={<Guard roles={MANAGER_ROLES} allowDispatch><AssetMoves /></Guard>}
        />
        {/* สิทธิ์เข้าถึง · เจ้าของระบบเปิดให้แอดมินด้วยแล้ว เพื่อให้ทำงานแทนได้จริง
            บัญชีเจ้าของระบบยังแก้ไม่ได้ ซึ่งบังคับที่ trigger guard_owner_row ในฐานข้อมูล */}
        <Route path="access" element={<Guard roles={MANAGER_ROLES}><Access /></Guard>} />
        <Route path="qr" element={<Guard roles={MANAGER_ROLES}><QrLabels /></Guard>} />
        {/* สองหน้านี้ผู้ตรวจสอบเข้าได้ด้วย นอกนั้นเป็นของแอดมินล้วน */}
        <Route path="meetings" element={<Guard roles={MANAGER_ROLES} allowDispatch><Meetings /></Guard>} />
        <Route
          path="meeting-evidence"
          element={<Guard roles={MANAGER_ROLES} allowDispatch><MeetingEvidence /></Guard>}
        />
        {/* แดชบอร์ดประชุมเป็นของแอดมินขึ้นไป · ผู้ตรวจสอบดูใบเช็คอินกับหลักฐานได้ แต่ไม่ดูสรุปรวม */}
        <Route path="report/meeting" element={<Guard roles={MANAGER_ROLES}><MeetingReport /></Guard>} />
        <Route
          path="supply-history"
          element={<Guard roles={MANAGER_ROLES} allowDispatch><SupplyHistory /></Guard>}
        />
        {/* เพิ่มบัญชี / รีเซ็ตรหัสผ่านคนอื่น เป็นของผู้ดูแลระบบคนเดียว */}
        <Route path="users" element={<Guard roles={MANAGER_ROLES}><Users /></Guard>} />
        <Route path="links" element={<Guard roles={MANAGER_ROLES}><WorkLinksAdmin /></Guard>} />
        {/* กระดานเครื่อง Asset · เจ้าของระบบกับแอดมิน · ด่านจริงอยู่ที่ asset_board() ใน RLS */}
        <Route path="asset-board" element={<Guard roles={MANAGER_ROLES}><AssetBoard /></Guard>} />
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
            <Guard roles={['admin', 'supervisor']}>
              <SystemHealth />
            </Guard>
          }
        />
        {/* การปล่อยรถ — งานตั้งค่าและเก็บประวัติ แยกจากกระดานที่หน้างานเปิดค้างไว้ทั้งกะ
            ด่านจริงอยู่ที่ RLS เส้นทางนี้แค่ไม่ให้กดเข้ามาเจอหน้าว่าง */}
        {/* ผู้ตรวจสอบเข้าได้ แต่เห็นแค่แท็บรายชื่อสาขาและเป็นหน้าอ่าน · แท็บคุมในหน้านั้นเอง
            ส่วนแอดมิน (supervisor) ยังไม่เห็นหน้านี้เหมือนเดิม */}
        <Route
          path="trucks"
          element={<Guard roles={['admin']} allowDispatch><TruckAdmin /></Guard>}
        />
        {/* โซน D0x ของสาขาปลายทาง · งานตั้งค่าของหน้าของค้างส่งออก
            อยู่หลังบ้านเพราะทำครั้งเดียวแล้วนาน ๆ แก้ที ไม่ควรอยู่บนจอที่เปิดค้างทั้งกะ
            ตารางแยกจากรายชื่อสาขาของงานปล่อยรถ แก้ฝั่งโน้นไม่กระทบฝั่งนี้ */}
        <Route path="outbox-zones" element={<Guard roles={['admin']}><OutZones /></Guard>} />
        {/* ตั้งเกณฑ์เวลารถรอลงงาน · ของผู้ดูแลระบบคนเดียว
            ผู้ตรวจสอบดูกระดาน แดชบอร์ด และประวัติได้ แต่ไม่ตั้งเกณฑ์
            ด่านจริงอยู่ที่ policy ของ wait_truck_kpi เส้นทางนี้แค่ไม่ให้กดเข้ามาเจอ error */}
        <Route path="wait" element={<Guard roles={['admin']}><WaitAdmin /></Guard>} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  )
}
