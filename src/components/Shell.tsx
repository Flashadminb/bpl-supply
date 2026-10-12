import type { ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { MANAGER_ROLES } from '../lib/roles'
import { useCart } from '../lib/cart'
import { usePageTitle } from '../lib/pageTitle'

/** หัวหน้าจอฝั่งพนักงาน — พื้นเหลือง ตัวอักษรต้องเป็น ink เสมอ */
export function TopBar({
  title,
  back,
  right,
  tone = 'yellow',
}: {
  title: string
  back?: boolean | string
  right?: ReactNode
  tone?: 'yellow' | 'plain'
}) {
  const nav = useNavigate()
  /* แถบหัวรู้ชื่อหน้าอยู่แล้ว เอาไปตั้งชื่อแท็บด้วยเลย
     ไม่ต้องไล่แก้ทีละหน้า และไม่มีตารางชื่อหน้าอีกชุดให้ลืมอัป */
  usePageTitle(title)
  const bg = tone === 'yellow' ? 'bg-brand-500 text-ink' : 'bg-surface text-ink border-b border-line'
  return (
    <header className={`safe-t sticky top-0 z-30 ${bg}`}>
      <div className="mx-auto flex max-w-phone items-center gap-2 px-3 py-2">
        {back && (
          <button
            type="button"
            aria-label="ย้อนกลับ"
            className="-ml-1 h-tap w-tap rounded-btn text-lg"
            onClick={() => (typeof back === 'string' ? nav(back) : nav(-1))}
          >
            ←
          </button>
        )}
        <h1 className="flex-1 truncate font-display text-md font-medium">{title}</h1>
        {right}
      </div>
    </header>
  )
}

interface Tab {
  to: string
  label: string
  icon: string
  end: boolean
  /** ต้องมีสิทธิ์อะไรถึงเห็น · ว่าง = ทุกคนเห็น */
  need?: 'assets'
  /** ปุ่มวงกลมใหญ่กลางแถบ · ใช้กับปุ่มสแกนของ รปภ */
  big?: boolean
}

const TABS: Tab[] = [
  { to: '/', label: 'หน้าหลัก', icon: '⌂', end: true },
  { to: '/assets', label: 'Asset', icon: '▣', end: false, need: 'assets' },
  { to: '/items', label: 'วัสดุ', icon: '☰', end: false },
  { to: '/cart', label: 'ตะกร้า', icon: '▢', end: false },
  { to: '/returns', label: 'คืน', icon: '↩', end: false },
  { to: '/history', label: 'ประวัติ', icon: '↺', end: false },
  { to: '/account', label: 'บัญชี', icon: '◉', end: false },
]

/**
 * แถบล่างของ รปภ
 *
 * เหลือเท่าที่เขาเข้าได้จริง และมีปุ่มสแกนวงกลมอยู่กลาง
 * เพราะทั้งกะเขาทำอย่างเดียวคือสแกน ถ้าให้ปุ่มสแกนเป็นแท็บเล็ก ๆ เท่าอันอื่น
 * คือทำให้งานหลักของเขาหายไปในแถวของงานที่เขาไม่ได้ใช้
 */
const GUARD_TABS: Tab[] = [
  { to: '/', label: 'หน้าหลัก', icon: '⌂', end: true },
  { to: '/guard', label: 'สแกน', icon: '⌁', end: false, big: true },
  { to: '/history', label: 'ประวัติ', icon: '↺', end: false },
  { to: '/account', label: 'บัญชี', icon: '◉', end: false },
]

/**
 * แถบล่างเปลี่ยนตามบทบาท
 *
 * ไม่ได้โชว์ทุกแท็บให้ทุกคนแล้วค่อยเด้งกลับตอนกด เพราะปุ่มที่กดแล้วเด้งกลับ
 * คือปุ่มที่หลอกคนว่ามีของอยู่ตรงนั้น · คนหน้างานกดผิดหนึ่งครั้งก็เสียเวลาหนึ่งครั้ง
 */
export function BottomNav() {
  const { count } = useCart()
  const { profile, can } = useAuth()
  const isGuard = profile?.can_guard === true && profile.role === 'staff' && !profile.can_dispatch
  const tabs = isGuard
    ? GUARD_TABS
    : TABS.filter((t) => t.need !== 'assets' || profile?.can_assets || can(...MANAGER_ROLES))

  return (
    <nav className="safe-b fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface">
      <div
        className="mx-auto grid max-w-phone"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `relative flex min-h-tap flex-col items-center justify-center gap-[2px] py-2 text-[10.5px] ${
                isActive ? 'text-ink' : 'text-ink-400'
              }`
            }
          >
            {t.big ? (
              <span
                aria-hidden
                className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-ink text-lg leading-none text-white"
              >
                {t.icon}
              </span>
            ) : (
              <span aria-hidden className="text-md leading-none">
                {t.icon}
              </span>
            )}
            {t.label}
            {t.to === '/cart' && count > 0 && (
              <span className="absolute right-[18%] top-1 min-w-[18px] rounded-pill bg-brand-500 px-1 text-center font-display text-[10px] text-ink">
                {count}
              </span>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

/** โครงหน้าจอพนักงาน — เว้นที่ล่างให้แถบเมนูเสมอ */
export function StaffPage({
  children,
  nav = true,
  className = '',
}: {
  children: ReactNode
  nav?: boolean
  className?: string
}) {
  return (
    <div className="min-h-dvh bg-canvas">
      <main className={`mx-auto max-w-phone px-3 pt-3 ${nav ? 'pb-[92px]' : 'pb-6'} ${className}`}>
        {children}
      </main>
      {nav && <BottomNav />}
    </div>
  )
}
