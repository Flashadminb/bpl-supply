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
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'))
const Dashboard = lazy(() => import('./pages/admin/Dashboard'))
const Stock = lazy(() => import('./pages/admin/Stock'))
const Approvals = lazy(() => import('./pages/admin/Approvals'))
const Users = lazy(() => import('./pages/admin/Users'))
const ExportSheet = lazy(() => import('./pages/admin/ExportSheet'))
const AdminEvidence = lazy(() => import('./pages/admin/Evidence'))
const QrLabels = lazy(() => import('./pages/admin/QrLabels'))

function Guard({ children, roles }: { children: ReactNode; roles?: UserRole[] }) {
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
  if (roles && !roles.includes(profile.role)) return <Navigate to="/" replace />
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
      <Route path="/history" element={<Guard><History /></Guard>} />
      <Route path="/account" element={<Guard><Account /></Guard>} />

      {/* ฝั่งแอดมิน — "แอดมิน" (supervisor) ทำได้ทุกหน้า ยกเว้นจัดการผู้ใช้ */}
      <Route
        path="/admin"
        element={
          <Guard roles={MANAGER_ROLES}>
            <AdminLayout />
          </Guard>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="stock" element={<Stock />} />
        <Route path="export" element={<ExportSheet />} />
        <Route path="evidence" element={<AdminEvidence />} />
        <Route path="qr" element={<QrLabels />} />
        {/* เพิ่มบัญชี / รีเซ็ตรหัสผ่านคนอื่น เป็นของผู้ดูแลระบบคนเดียว */}
        <Route path="users" element={<Guard roles={['admin']}><Users /></Guard>} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  )
}
