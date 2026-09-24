import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Suspense, lazy, type ReactNode } from 'react'
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
const AssetTypes = lazy(() =>
  import('./pages/staff/AssetPick').then((m) => ({ default: m.AssetTypes })),
)
const AssetDone = lazy(() => import('./pages/staff/AssetDone'))
const BySend = lazy(() => import('./pages/staff/BySend'))
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'))
const Dashboard = lazy(() => import('./pages/admin/Dashboard'))
const Stock = lazy(() => import('./pages/admin/Stock'))
const Approvals = lazy(() => import('./pages/admin/Approvals'))
const Users = lazy(() => import('./pages/admin/Users'))
const ExportSheet = lazy(() => import('./pages/admin/ExportSheet'))
const AdminEvidence = lazy(() => import('./pages/admin/Evidence'))
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

function Guard({
  children,
  roles,
  allowDispatch,
}: {
  children: ReactNode
  roles?: UserRole[]
  /** ผู้ตรวจสอบเข้าได้ด้วย แม้ role จริงจะเป็น staff */
  allowDispatch?: boolean
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
  const roleOk = !roles || roles.includes(profile.role) || (allowDispatch && profile.can_dispatch)
  if (!roleOk) return <Navigate to="/" replace />
  return <>{children}</>
}

function Fallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas">
      <Loading label="กำลังเปิดหน้า…" />
    </div>
  )
}

export default function App() {
  return (
    <Suspense fallback={<Fallback />}>
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
      <Route path="/assets" element={<Guard><AssetTypes /></Guard>} />
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
        <Route index element={<Guard roles={MANAGER_ROLES}><Dashboard /></Guard>} />
        <Route path="approvals" element={<Guard roles={MANAGER_ROLES}><Approvals /></Guard>} />
        <Route path="stock" element={<Guard roles={MANAGER_ROLES}><Stock /></Guard>} />
        <Route path="outstanding" element={<Guard roles={MANAGER_ROLES}><Outstanding /></Guard>} />
        <Route path="assets" element={<Guard roles={MANAGER_ROLES}><AssetRegistry /></Guard>} />
        <Route path="assets-out" element={<Guard roles={MANAGER_ROLES}><AssetOutstanding /></Guard>} />
        <Route path="by" element={<Guard roles={MANAGER_ROLES}><ByInbox /></Guard>} />
        <Route path="report/supply" element={<Guard roles={MANAGER_ROLES}><SupplyReport /></Guard>} />
        <Route path="report/asset" element={<Guard roles={MANAGER_ROLES}><AssetReport /></Guard>} />
        <Route path="export" element={<Guard roles={MANAGER_ROLES}><ExportSheet /></Guard>} />
        <Route path="evidence" element={<Guard roles={MANAGER_ROLES}><AdminEvidence /></Guard>} />
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
        <Route path="users" element={<Guard roles={['admin']}><Users /></Guard>} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  )
}
