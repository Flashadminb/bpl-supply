import type { ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useCart } from '../lib/cart'

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

const TABS = [
  { to: '/', label: 'หน้าหลัก', icon: '⌂', end: true },
  { to: '/items', label: 'วัสดุ', icon: '☰', end: false },
  { to: '/cart', label: 'ตะกร้า', icon: '▢', end: false },
  { to: '/history', label: 'ประวัติ', icon: '↺', end: false },
]

export function BottomNav() {
  const { count } = useCart()
  return (
    <nav className="safe-b fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-phone grid-cols-4">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `relative flex min-h-tap flex-col items-center justify-center gap-[2px] py-2 text-xs ${
                isActive ? 'text-ink' : 'text-ink-400'
              }`
            }
          >
            <span aria-hidden className="text-md leading-none">
              {t.icon}
            </span>
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
