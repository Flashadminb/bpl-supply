import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { WorkLinks } from '../../components/WorkLinks'
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

interface Group {
  title: string | null
  links?: Link[]
  /**
   * กลุ่มที่พับเก็บไว้ กดหัวข้อถึงจะกาง
   *
   * งาน STANDARD เป็นงานประจำสัปดาห์ ไม่ใช่งานประจำวัน แต่มีหน้าอยู่หกหน้า
   * กางค้างไว้ตลอดแปลว่าเมนูที่เปิดทุกวันถูกดันลงไปจนต้องเลื่อนหา
   * ของที่ใช้บ่อยในกลุ่มนี้คือสองหน้าประวัติ ซึ่งก็อปไปไว้ในกลุ่มตรวจสอบแล้ว
   */
  collapsible?: boolean
  subs?: { title: string; links: Link[] }[]
}

const GROUPS: Group[] = [
  {
    title: null,
    links: [
      { to: '/admin', label: 'หน้าแรก', icon: 'home', end: true },
      { to: '/admin/evidence', label: 'หลักฐานการเบิก-คืน', icon: 'photo' },
      { to: '/admin/return-status', label: 'สถานะเบิก-คืน', icon: 'clipboard', audit: true },
      { to: '/admin/asset-moves', label: 'สถานะโอน-แจ้งเสีย', icon: 'history', audit: true },
    ],
  },
  {
    title: 'ตรวจสอบ',
    links: [
      { to: '/admin/meetings', label: 'รายชื่อประชุม', icon: 'clipboard', audit: true, badge: 'meetings' },
      { to: '/admin/meeting-evidence', label: 'หลักฐานการเข้าประชุม', icon: 'photo', audit: true },
      { to: '/admin/report/meeting', label: 'แดชบอร์ดประชุม', icon: 'pie', audit: true },
      { to: '/admin/supply-history', label: 'ประวัติเบิกสิ้นเปลือง', icon: 'history', audit: true },
      // สองอันนี้อยู่ในงาน STANDARD ด้วย ตั้งใจให้ซ้ำ
      // เพราะเปิดบ่อยพอ ๆ กับประวัติเบิก แต่ไปจมอยู่ในกลุ่มที่พับเก็บไว้
      { to: '/admin/break/history', label: 'ประวัติเบรค', icon: 'history', audit: true },
      { to: '/admin/os/scans', label: 'ประวัติการสแกน', icon: 'history', audit: true },
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
      { to: '/admin/sacks', label: 'กระจายกระสอบ', icon: 'box' },
    ],
  },
  {
    title: 'Asset',
    links: [{ to: '/admin/assets', label: 'ทะเบียนเครื่อง', icon: 'device', audit: true }],
  },
  {
    title: 'รายงาน',
    links: [
      { to: '/admin/report/supply', label: 'รายงานสิ้นเปลือง', icon: 'chart' },
      { to: '/admin/report/asset', label: 'รายงาน Asset', icon: 'pie' },
    ],
  },
  {
    title: 'งาน STANDARD',
    collapsible: true,
    subs: [
      {
        title: 'บัตร OS',
        links: [
          { to: '/guard', label: 'สแกนบัตร (หน้างาน)', icon: 'qr', audit: true },
          { to: '/admin/os', label: 'รายชื่อและบัตร', icon: 'users', audit: true, end: true },
          { to: '/admin/os/scans', label: 'ประวัติการสแกน', icon: 'history', audit: true },
          { to: '/admin/os/print', label: 'พิมพ์บัตร', icon: 'qr', audit: true },
        ],
      },
      {
        title: 'บัตรเบรค',
        links: [
          { to: '/admin/break/history', label: 'ประวัติเบรค', icon: 'history', audit: true },
          { to: '/admin/break/cards', label: 'จัดการบัตรเบรค', icon: 'qr', adminOnly: true },
        ],
      },
    ],
  },
  {
    title: 'การปล่อยรถ',
    links: [
      { to: '/trucks', label: 'กระดานปล่อยรถ', icon: 'clipboard', adminOnly: true },
      { to: '/admin/trucks', label: 'ส่งชีต สาขา แจ้งเตือน', icon: 'sheet', adminOnly: true },
      { to: '/wait', label: 'กระดานรถรอลงงาน', icon: 'clock', audit: true },
      { to: '/admin/wait', label: 'สถิติและเกณฑ์รถรอลงงาน', icon: 'chart', audit: true },
      { to: '/wait/history', label: 'ประวัติรถรอลงงาน', icon: 'history', audit: true },
    ],
  },
  {
    title: 'ทั่วไป',
    links: [
      { to: '/admin/qr', label: 'พิมพ์ QR', icon: 'qr' },
      { to: '/admin/export', label: 'ส่งออก Google Sheet', icon: 'sheet', badge: 'exports' },
      { to: '/admin/users', label: 'ผู้ใช้และสิทธิ์', icon: 'users' },
      { to: '/admin/access', label: 'สิทธิ์เข้าถึง', icon: 'lock', adminOnly: true },
      { to: '/admin/links', label: 'ลิงก์งาน', icon: 'sheet' },
      { to: '/admin/notices', label: 'ประกาศและแจ้งเตือน', icon: 'clipboard', audit: true },
      { to: '/admin/health', label: 'สถานะระบบ', icon: 'chart', audit: true },
    ],
  },
]

export default function AdminLayout() {
  const { profile, signOut, can } = useAuth()
  const isManager = can(...MANAGER_ROLES)
  const [menu, setMenu] = useState(false)
  // null = ยังไม่เคยกด ให้ตัดสินจากหน้าที่ยืนอยู่ · true/false = คนกดเลือกเอง
  const [openStd, setOpenStd] = useState<boolean | null>(null)
  const here = useLocation().pathname
  const pending = usePendingApprovals()
  const exports = usePendingExports()
  const meetings = usePendingMeetings()
  const badgeOf = { approvals: pending.count, exports: exports.count, meetings: meetings.count }

  const visible = (links: Link[]) =>
    links
      .filter((l) => !l.adminOnly || can('admin'))
      // ผู้ตรวจสอบเข้าได้แค่สองหน้า ที่เหลือไม่ต้องขึ้นให้เห็นด้วยซ้ำ
      .filter((l) => isManager || l.audit)

  const item = (l: Link) => (
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
  )

  const nav = (
    <nav className="flex flex-col gap-1">
      {GROUPS.map((g) => {
        if (g.collapsible) {
          const subs = (g.subs ?? [])
            .map((s) => ({ ...s, links: visible(s.links) }))
            .filter((s) => s.links.length > 0)
          if (subs.length === 0) return null
          const inside = subs.some((s) => s.links.some((l) => here.startsWith(l.to)))
          // ยืนอยู่ในหน้าของกลุ่มนี้แล้วยังพับไว้ คนจะหาไม่เจอว่าตัวเองอยู่ตรงไหน
          const on = openStd ?? inside
          return (
            <div key={g.title} className="mt-3">
              <button
                type="button"
                className="flex min-h-tap w-full items-center gap-2 rounded-btn px-3 text-left font-mono text-xs uppercase tracking-widest text-dark-muted hover:bg-dark-2"
                onClick={() => setOpenStd(!on)}
                aria-expanded={on}
              >
                <span className="flex-1">{g.title}</span>
                <span aria-hidden>{on ? '▾' : '▸'}</span>
              </button>
              {on &&
                subs.map((s) => (
                  <div key={s.title} className="mt-1">
                    <p className="mb-1 px-3 pl-5 font-mono text-[11px] uppercase tracking-widest text-dark-muted">
                      {s.title}
                    </p>
                    {s.links.map(item)}
                  </div>
                ))}
            </div>
          )
        }

        const links = visible(g.links ?? [])
        if (links.length === 0) return null
        return (
          <div key={g.title ?? 'top'} className={g.title ? 'mt-3' : ''}>
            {g.title && (
              <p className="mb-1 px-3 font-mono text-xs uppercase tracking-widest text-dark-muted">
                {g.title}
              </p>
            )}
            {links.map(item)}
          </div>
        )
      })}
    </nav>
  )

  return (
    <div className="min-h-dvh bg-canvas lg:flex">
      {/* แถบข้างเดสก์ท็อป 244px */}
      <aside className="hidden w-[244px] shrink-0 flex-col bg-dark lg:sticky lg:top-0 lg:flex lg:h-dvh">
        <div className="shrink-0 px-4 pb-3 pt-4">
          <p className="font-mono text-xs tracking-widest text-dark-muted">FLASH EXPRESS</p>
          <p className="font-display text-lg text-white">BPL SUPPLY</p>
        </div>

        {/* min-h-0 จำเป็น ไม่งั้น flex ไม่ยอมให้ลูกหดแล้วการเลื่อนจะไม่ทำงาน */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4">{nav}</div>

        <div className="shrink-0 border-t border-dark-3 px-4 pb-4 pt-3 text-sm text-dark-muted">
          {/* ลิงก์งาน — เดิมมีแต่ในแอพ เปิดหน้าเว็บบนคอมแล้วหาไม่เจอ */}
          <div className="mb-3 flex items-center gap-2">
            <WorkLinks tone="onDark" />
            <span className="text-dark-text">ลิงก์งาน</span>
          </div>
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
        <WorkLinks tone="onDark" />
        <Link to="/" className="min-h-tap px-2 py-2 text-sm underline">
          หน้าพนักงาน
        </Link>
      </header>
      {menu && (
        <div className="sticky top-[52px] z-30 max-h-[70dvh] overflow-y-auto border-b border-dark-3 bg-dark p-3 lg:hidden">
          {nav}
        </div>
      )}

      <main className="min-w-0 flex-1 p-4 lg:p-6">
        <Outlet context={{ reloadPending: pending.reload }} />
      </main>
    </div>
  )
}
