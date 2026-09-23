import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { usePendingApprovals } from '../../lib/usePendingApprovals'

// adminOnly = เห็นเฉพาะ "ผู้ดูแลระบบ" (role admin) ส่วน "แอดมิน" (supervisor) เห็นที่เหลือทั้งหมด
//
// แบ่งเป็นหมวดเพราะของสิ้นเปลืองกับ Asset เป็นงานคนละก้อน
// ลูกน้องที่ดูแลสิ้นเปลืองจะได้ไม่ต้องกวาดตาผ่านเมนูเครื่องทุกครั้ง
interface Link {
  to: string
  label: string
  end?: boolean
  adminOnly?: boolean
  badge?: boolean
}

const GROUPS: { title: string | null; links: Link[] }[] = [
  {
    title: null,
    links: [{ to: '/admin', label: 'ภาพรวม', end: true }],
  },
  {
    title: 'สิ้นเปลือง',
    links: [
      { to: '/admin/stock', label: 'สต็อกวัสดุ' },
      { to: '/admin/approvals', label: 'คำขอเบิก', badge: true },
      { to: '/admin/outstanding', label: 'ของค้างคืน' },
      { to: '/admin/evidence', label: 'หลักฐานการเบิก-คืน' },
      { to: '/admin/by', label: 'บาร์โค้ดจาก BY' },
    ],
  },
  {
    title: 'Asset',
    links: [
      { to: '/admin/assets', label: 'ทะเบียนเครื่อง' },
      { to: '/admin/assets-out', label: 'Asset ที่ยังไม่คืน' },
    ],
  },
  {
    title: 'ทั่วไป',
    links: [
      { to: '/admin/qr', label: 'พิมพ์ QR' },
      { to: '/admin/export', label: 'ส่งออก Google Sheet' },
      { to: '/admin/users', label: 'ผู้ใช้และสิทธิ์', adminOnly: true },
    ],
  },
]

export default function AdminLayout() {
  const { profile, signOut, can } = useAuth()
  const [menu, setMenu] = useState(false)
  const pending = usePendingApprovals()
  const badge = pending.count

  const nav = (
    <nav className="flex flex-col gap-1">
      {GROUPS.map((g) => {
        const links = g.links.filter((l) => !l.adminOnly || can('admin'))
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
                  `flex min-h-tap items-center justify-between rounded-btn px-3 text-base ${
                    isActive ? 'bg-dark-3 text-white' : 'text-dark-text hover:bg-dark-2'
                  }`
                }
              >
                <span>{l.label}</span>
                {l.badge && badge > 0 && (
                  <span className="rounded-pill bg-brand-500 px-2 font-display text-xs text-ink">
                    {badge}
                  </span>
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
