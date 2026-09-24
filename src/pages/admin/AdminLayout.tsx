import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { usePendingApprovals } from '../../lib/usePendingApprovals'
import { usePendingExports } from '../../lib/usePendingExports'
import { usePendingMeetings } from '../../lib/usePendingMeetings'
import { Icon, type IconName } from '../../components/icons'
import { MANAGER_ROLES } from '../../lib/roles'

// adminOnly = เห็นเฉพาะ "ผู้ดูแลระบบ" (role admin) ส่วน "แอดมิน" (supervisor) เห็นที่เหลือทั้งหมด
//
// ลำดับเมนูเรียงตามความถี่ที่เปิดจริง ไม่ได้เรียงตามโครงสร้างระบบ
//   หน้าแรกกับหลักฐาน เปิดแทบทุกวัน
//   ยังไม่คืน เป็นงานตามของ แยกออกมาเพราะถามบ่อยสุดและถามพร้อมกันทั้งสองฝั่ง
//   สิ้นเปลือง / Asset เป็นงานดูแลของประจำ
//   รายงาน เปิดตอนสรุป ไม่ใช่ทุกวัน จึงลงไปอยู่ท้าย ๆ
//   ทั่วไป เป็นงานตั้งค่า นาน ๆ ที
interface Link {
  to: string
  label: string
  icon: IconName
  end?: boolean
  adminOnly?: boolean
  /** เลขค้างท้ายเมนู ดึงจากตัวนับคนละตัวกัน */
  badge?: 'approvals' | 'exports' | 'meetings'
  /** ผู้ตรวจสอบเห็นเมนูนี้ด้วย — นอกนั้นเห็นเฉพาะแอดมินขึ้นไป */
  audit?: boolean
}

const GROUPS: { title: string | null; links: Link[] }[] = [
  {
    title: null,
    links: [
      { to: '/admin', label: 'หน้าแรก', icon: 'home', end: true },
      { to: '/admin/evidence', label: 'หลักฐานการเบิก-คืน', icon: 'photo' },
    ],
  },
  {
    title: 'ตรวจสอบ',
    links: [
      { to: '/admin/meetings', label: 'รายชื่อประชุม', icon: 'clipboard', audit: true, badge: 'meetings' },
      { to: '/admin/meeting-evidence', label: 'หลักฐานการเข้าประชุม', icon: 'photo', audit: true },
      { to: '/admin/report/meeting', label: 'แดชบอร์ดประชุม', icon: 'pie', audit: true },
      { to: '/admin/supply-history', label: 'ประวัติเบิกสิ้นเปลือง', icon: 'history', audit: true },
    ],
  },
  {
    title: 'ยังไม่คืน',
    links: [
      { to: '/admin/outstanding', label: 'ของค้างคืน', icon: 'clock', audit: true },
      { to: '/admin/assets-out', label: 'Asset ที่ยังไม่คืน', icon: 'device-clock', audit: true },
    ],
  },
  {
    title: 'สิ้นเปลือง',
    links: [
      { to: '/admin/stock', label: 'สต็อกวัสดุ', icon: 'box' },
      { to: '/admin/approvals', label: 'คำขอเบิก', icon: 'inbox', badge: 'approvals' },
      { to: '/admin/by', label: 'บาร์โค้ดจาก BY', icon: 'barcode' },
    ],
  },
  {
    title: 'Asset',
    links: [{ to: '/admin/assets', label: 'ทะเบียนเครื่อง', icon: 'device' }],
  },
  {
    title: 'รายงาน',
    links: [
      { to: '/admin/report/supply', label: 'รายงานสิ้นเปลือง', icon: 'chart' },
      { to: '/admin/report/asset', label: 'รายงาน Asset', icon: 'pie' },
    ],
  },
  {
    title: 'ทั่วไป',
    links: [
      { to: '/admin/qr', label: 'พิมพ์ QR', icon: 'qr' },
      { to: '/admin/export', label: 'ส่งออก Google Sheet', icon: 'sheet', badge: 'exports' },
      { to: '/admin/users', label: 'ผู้ใช้และสิทธิ์', icon: 'users', adminOnly: true },
    ],
  },
]

export default function AdminLayout() {
  const { profile, signOut, can } = useAuth()
  const isManager = can(...MANAGER_ROLES)
  const [menu, setMenu] = useState(false)
  const pending = usePendingApprovals()
  const exports = usePendingExports()
  const meetings = usePendingMeetings()
  const badgeOf = { approvals: pending.count, exports: exports.count, meetings: meetings.count }

  const nav = (
    <nav className="flex flex-col gap-1">
      {GROUPS.map((g) => {
        const links = g.links
          .filter((l) => !l.adminOnly || can('admin'))
          // ผู้ตรวจสอบเข้าได้แค่สองหน้า ที่เหลือไม่ต้องขึ้นให้เห็นด้วยซ้ำ
          .filter((l) => isManager || l.audit)
        if (links.length === 0) return null
        return (
          <div key={g.title ?? 'top'} className={g.title ? 'mt-3' : ''}>
            {g.title && (
              <p className="mb-1 px-3 font-mono text-xs uppercase tracking-widest text-dark-muted">
                {g.title}
              </p>
            )}
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                onClick={() => setMenu(false)}
                className={({ isActive }) =>
                  `flex min-h-tap items-center gap-[10px] rounded-btn px-3 text-base ${
                    isActive ? 'bg-dark-3 text-white' : 'text-dark-text hover:bg-dark-2'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon name={l.icon} className={isActive ? '' : 'text-dark-muted'} />
                    <span className="flex-1 truncate">{l.label}</span>
                    {l.badge && badgeOf[l.badge] > 0 && (
                      <span className="rounded-pill bg-brand-500 px-2 font-display text-xs text-ink">
                        {badgeOf[l.badge] > 99 ? '99+' : badgeOf[l.badge]}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        )
      })}
    </nav>
  )

  return (
    <div className="min-h-dvh bg-canvas lg:flex">
      {/* แถบข้างเดสก์ท็อป 244px */}
      <aside className="hidden w-[244px] shrink-0 flex-col justify-between bg-dark p-4 lg:sticky lg:top-0 lg:flex lg:h-dvh">
        <div>
          <p className="font-mono text-xs tracking-widest text-dark-muted">FLASH EXPRESS</p>
          <p className="mb-5 font-display text-lg text-white">BPL SUPPLY</p>
          {nav}
        </div>
        <div className="text-sm text-dark-muted">
          <p className="mb-2 text-[10px] tracking-wide text-dark-muted/60">
            Created by Thanawat Phuttarit
          </p>
          <p className="text-dark-text">{profile?.full_name}</p>
          <p className="font-mono text-xs">
            {profile?.employee_code} · {profile?.hub_code}
          </p>
          <Link to="/" className="mt-2 block min-h-tap py-2 underline">
            กลับหน้าพนักงาน
          </Link>
          <button type="button" className="min-h-tap py-2 underline" onClick={() => void signOut()}>
            ออกจากระบบ
          </button>
        </div>
      </aside>

      {/* หัวมือถือ */}
      <header className="safe-t sticky top-0 z-30 flex items-center gap-2 bg-dark px-3 py-2 text-white lg:hidden">
        <button type="button" className="h-tap w-tap text-lg" aria-label="เมนู" onClick={() => setMenu((m) => !m)}>
          ☰
        </button>
        <span className="flex-1 font-display text-md">BPL SUPPLY · แอดมิน</span>
        <Link to="/" className="min-h-tap px-2 py-2 text-sm underline">
          หน้าพนักงาน
        </Link>
      </header>
      {menu && (
        <div className="sticky top-[52px] z-30 border-b border-dark-3 bg-dark p-3 lg:hidden">{nav}</div>
      )}

      <main className="min-w-0 flex-1 p-4 lg:p-6">
        <Outlet context={{ reloadPending: pending.reload }} />
      </main>
    </div>
  )
}
