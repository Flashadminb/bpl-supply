import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { WorkLinks } from '../../components/WorkLinks'
import { useAuth } from '../../lib/auth'
import { usePendingApprovals } from '../../lib/usePendingApprovals'
import { usePendingExports } from '../../lib/usePendingExports'
import { usePendingMeetings } from '../../lib/usePendingMeetings'
import { Icon, type IconName } from '../../components/icons'
import { MANAGER_ROLES, isOwner } from '../../lib/roles'

// adminOnly = เห็นเฉพาะ "ผู้ดูแลระบบ" (role admin) ส่วน "แอดมิน" (supervisor) เห็นที่เหลือทั้งหมด
// audit     = "ผู้ตรวจสอบ" เห็นเมนูนี้ · เป็นรายการขาว อ่านคู่กับ visible() ท้ายไฟล์
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
  /** ผู้ตรวจสอบเห็นเมนูนี้ · ธงนี้ไม่เกี่ยวกับ adminOnly ทั้งสองอันคุมคนละเส้น */
  audit?: boolean
  /** เจ้าของระบบคนเดียว · แคบกว่า adminOnly เพราะผู้ดูแลระบบก็ไม่เห็น */
  ownerOnly?: boolean
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

/**
 * ลำดับเมนู · เจ้าของระบบเรียงมาเองทั้งชุด
 *
 * ทุกคนเห็นลำดับเดียวกัน ต่างกันแค่ว่าใครเห็นรายการไหนบ้าง
 * ไม่ได้สลับลำดับตามบทบาท เพราะคนสองคนที่คุยกันทางโทรศัพท์
 * ต้องชี้ได้ว่า "อันที่สามจากบน" แล้วหมายถึงอันเดียวกัน
 *
 * บางรายการตั้งใจให้ซ้ำสองกลุ่ม เช่นหลักฐานการเบิก-คืนที่อยู่ทั้งกลุ่มบนและ ADMIN
 * เพราะคนละคนเข้าหามันคนละทาง · คนตรวจเข้าจากกลุ่มบน คนคุมของเข้าจาก ADMIN
 */
const GROUPS: Group[] = [
  {
    title: null,
    links: [
      { to: '/admin', label: 'หน้าแรก', icon: 'home', end: true, audit: true },
      { to: '/admin/notices', label: 'ประกาศและแจ้งเตือน', icon: 'bell', audit: true },
      { to: '/admin/evidence', label: 'หลักฐานการเบิก-คืน', icon: 'photo' },
      { to: '/admin/return-status', label: 'สถานะเบิก-คืน', icon: 'clipboard', audit: true },
      { to: '/admin/asset-moves', label: 'สถานะโอน-แจ้งเสีย', icon: 'history', audit: true },
      { to: '/admin/outstanding', label: 'ของค้างคืน', icon: 'clock', audit: true },
      { to: '/admin/assets-out', label: 'Asset ที่ยังไม่คืน', icon: 'device-clock', audit: true },
      { to: '/admin/approvals', label: 'คำขอเบิก', icon: 'inbox', badge: 'approvals' },
    ],
  },
  {
    title: 'ADMIN',
    links: [
      { to: '/admin/stock', label: 'สต็อกวัสดุ', icon: 'box' },
      { to: '/admin/approvals', label: 'คำขอเบิก', icon: 'inbox', badge: 'approvals' },
      { to: '/admin/evidence', label: 'หลักฐานการเบิก-คืน', icon: 'photo' },
      { to: '/admin/return-status', label: 'สถานะเบิก-คืน', icon: 'clipboard' },
      { to: '/admin/asset-moves', label: 'สถานะโอน-แจ้งเสีย', icon: 'history' },
      { to: '/admin/outstanding', label: 'ของค้างคืน', icon: 'clock' },
      { to: '/admin/by', label: 'บาร์โค้ดจาก BY', icon: 'barcode' },
      { to: '/admin/sacks', label: 'กระจายกระสอบ', icon: 'box' },
      { to: '/admin/report/supply', label: 'รายงานสิ้นเปลือง', icon: 'chart' },
      { to: '/admin/report/asset', label: 'รายงาน Asset', icon: 'pie', audit: true },
    ],
  },
  {
    /* ไม่ได้อยู่ในชุดที่เจ้าของระบบเรียงมา แต่ตัดทิ้งไม่ได้เพราะเป็นทางเดียวที่เข้าสองหน้านี้ */
    title: 'ASSET',
    links: [
      { to: '/admin/asset-board', label: 'กระดานเครื่อง', icon: 'device-clock' },
      { to: '/admin/assets', label: 'ทะเบียนเครื่อง', icon: 'device' },
    ],
  },
  {
    title: 'STANDARD',
    collapsible: true,
    links: [
      { to: '/admin/meetings', label: 'รายชื่อประชุม', icon: 'clipboard', audit: true, badge: 'meetings' },
      { to: '/admin/meeting-evidence', label: 'หลักฐานการเข้าประชุม', icon: 'photo', audit: true },
      { to: '/admin/report/meeting', label: 'แดชบอร์ดประชุม', icon: 'pie' },
      { to: '/admin/break/history', label: 'ประวัติเบรค', icon: 'history', audit: true },
      { to: '/admin/break/audit', label: 'ประวัติการแก้ไขเบรค', icon: 'clipboard', audit: true },
      { to: '/admin/os/scans', label: 'ประวัติการสแกน', icon: 'history', audit: true },
    ],
    subs: [
      {
        title: 'บัตร OS',
        links: [
          { to: '/guard', label: 'สแกนบัตร (หน้างาน)', icon: 'qr', audit: true },
          { to: '/admin/os', label: 'รายชื่อและบัตร', icon: 'users', audit: true, end: true },
          { to: '/admin/os/print', label: 'พิมพ์บัตร', icon: 'qr', audit: true },
        ],
      },
      {
        title: 'บัตรเบรค',
        links: [
          { to: '/admin/break/cards', label: 'จัดการบัตรเบรค', icon: 'qr', audit: true },
        ],
      },
      {
        title: 'สิ้นเปลือง',
        links: [{ to: '/admin/supply-history', label: 'ประวัติเบิกสิ้นเปลือง', icon: 'history', audit: true }],
      },
    ],
  },
  {
    title: 'OPERATION',
    links: [
      { to: '/outbox', label: 'ของค้างส่งออก', icon: 'box', adminOnly: true },
      { to: '/parcel24', label: 'พัสดุค้างเกิน 24 ชม', icon: 'n24', adminOnly: true },
      { to: '/admin/outbox-zones', label: 'โซน D0x ของสาขา', icon: 'lock', adminOnly: true },
    ],
    subs: [
      {
        title: 'กระดานปล่อยรถ',
        links: [
          { to: '/trucks', label: 'กระดานปล่อยรถ', icon: 'clipboard', audit: true },
          { to: '/admin/trucks', label: 'ส่งชีต สาขา แจ้งเตือน', icon: 'sheet', adminOnly: true, audit: true },
        ],
      },
      {
        title: 'กระดานรถรอลงงาน',
        links: [
          { to: '/wait', label: 'กระดานรถรอลงงาน', icon: 'clock', audit: true },
          { to: '/wait/stats', label: 'แดชบอร์ดรถรอลงงาน', icon: 'pie', audit: true },
          { to: '/admin/wait', label: 'ตั้งเกณฑ์เวลารถรอลงงาน', icon: 'clock', adminOnly: true },
        ],
      },
    ],
  },
  {
    /* งานหลังบ้าน · ตั้งชื่ออังกฤษว่า SYSTEM เพราะสั้นกว่า BACK OFFICE
       และสามกลุ่มบนเป็นคำเดียวหมด ยาวคำเดียวจะดูแปลกแถวเดียว */
    title: 'SYSTEM',
    links: [
      { to: '/admin/links', label: 'ลิงก์งาน', icon: 'sheet' },
      { to: '/admin/qr', label: 'พิมพ์ QR', icon: 'qr' },
      { to: '/admin/notices', label: 'ประกาศและแจ้งเตือน', icon: 'bell', audit: true },
      { to: '/admin/users', label: 'ผู้ใช้และสิทธิ์', icon: 'users' },
      { to: '/admin/access', label: 'สิทธิ์เข้าถึง', icon: 'lock' },
      { to: '/admin/export', label: 'ส่งออก Google Sheet', icon: 'sheet', badge: 'exports' },
      { to: '/admin/health', label: 'สถานะระบบ', icon: 'lock', ownerOnly: true },
    ],
  },
]

export default function AdminLayout() {
  const { profile, signOut, can } = useAuth()
  const isManager = can(...MANAGER_ROLES)
  /** ผู้ตรวจสอบล้วน · ไม่ใช่แอดมินที่ติดธงนี้มาด้วย */
  const isAudit = !isManager && Boolean(profile?.can_dispatch)
  const [menu, setMenu] = useState(false)
  // null = ยังไม่เคยกด ให้ตัดสินจากหน้าที่ยืนอยู่ · true/false = คนกดเลือกเอง
  const [openStd, setOpenStd] = useState<boolean | null>(null)
  const here = useLocation().pathname
  const pending = usePendingApprovals()
  const exports = usePendingExports()
  const meetings = usePendingMeetings()
  const badgeOf = { approvals: pending.count, exports: exports.count, meetings: meetings.count }

  /**
   * ผู้ตรวจสอบตัดสินด้วยธง audit ตัวเดียว ไม่ต้องผ่านด่าน adminOnly ก่อน
   *
   * เดิมกรองสองชั้นต่อกัน ซึ่งทำให้เขียน "เห็นเฉพาะเจ้าของระบบกับผู้ตรวจสอบ
   * แต่แอดมินไม่เห็น" ไม่ได้เลย — ซึ่งเป็นรูปที่เจ้าของระบบสั่งมาจริงสองหน้า
   * คือกระดานปล่อยรถกับรายชื่อสาขา
   *
   *   adminOnly  คุมเส้นแบ่งระหว่างผู้ดูแลระบบกับแอดมิน
   *   audit      คุมว่าผู้ตรวจสอบเห็นไหม เป็นรายการขาวล้วน ไม่ติดอะไรโดยบังเอิญ
   */
  const visible = (links: Link[]) =>
    links
      .filter((l) => !l.ownerOnly || isOwner(profile))
      .filter((l) => (isAudit ? Boolean(l.audit) : !l.adminOnly || can('admin')))

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
          const own = visible(g.links ?? [])
          const subs = (g.subs ?? [])
            .map((s) => ({ ...s, links: visible(s.links) }))
            .filter((s) => s.links.length > 0)
          if (subs.length === 0 && own.length === 0) return null
          const inside =
            own.some((l) => here.startsWith(l.to)) ||
            subs.some((s) => s.links.some((l) => here.startsWith(l.to)))
          // ยืนอยู่ในหน้าของกลุ่มนี้แล้วยังพับไว้ คนจะหาไม่เจอว่าตัวเองอยู่ตรงไหน
          const on = openStd ?? inside
          return (
            <div key={g.title} className="mt-3 rounded-card border border-dark-3 bg-dark-2/30 p-[6px]">
              <button
                type="button"
                className="flex min-h-tap w-full items-center gap-2 rounded-btn px-3 text-left font-mono text-xs uppercase tracking-widest text-dark-muted hover:bg-dark-2"
                onClick={() => setOpenStd(!on)}
                aria-expanded={on}
              >
                <span className="flex-1">{g.title}</span>
                <span aria-hidden>{on ? '▾' : '▸'}</span>
              </button>
              {on && own.map(item)}
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
        const plain = (g.subs ?? [])
          .map((s) => ({ ...s, links: visible(s.links) }))
          .filter((s) => s.links.length > 0)
        if (links.length === 0 && plain.length === 0) return null
        return (
          /* ทุกกลุ่มมีกรอบของตัวเอง · ก่อนหน้านี้มีแต่หัวข้อตัวจาง ๆ คั่น
             พอเมนูยาวขึ้นเรื่อย ๆ เส้นแบ่งแบบนั้นหายไปกับพื้นหลัง */
          <div
            key={g.title ?? 'top'}
            className={`rounded-card border border-dark-3 bg-dark-2/30 p-[6px] ${g.title ? 'mt-3' : ''}`}
          >
            {g.title && (
              <p className="mb-1 px-3 pt-1 font-mono text-xs uppercase tracking-widest text-dark-muted">
                {g.title}
              </p>
            )}
            {links.map(item)}
            {plain.map((s) => (
              <div key={s.title} className="mt-1">
                <p className="mb-1 px-3 pl-5 font-mono text-[11px] uppercase tracking-widest text-dark-muted">
                  {s.title}
                </p>
                {s.links.map(item)}
              </div>
            ))}
          </div>
        )
      })}
    </nav>
  )

  return (
    <div className="min-h-dvh bg-canvas lg:flex">
      {/* แถบข้างเดสก์ท็อป 244px */}
      <aside className="hidden w-[244px] shrink-0 flex-col bg-dark lg:sticky lg:top-0 lg:flex lg:h-dvh">
        {/* กดชื่อแอพกลับหน้าแรกของหลังบ้าน · ทำเป็นกรอบนูนให้รู้ว่ากดได้
            ของเดิมเป็นข้อความเฉย ๆ ซึ่งกดได้จริงแต่ไม่มีอะไรบอก */}
        <div className="shrink-0 px-4 pb-3 pt-4">
          <Link
            to="/admin"
            className="block rounded-card border border-dark-3 bg-dark-2 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,.08),0_6px_14px_-10px_#000] hover:bg-dark-3"
          >
            <span className="block font-mono text-xs tracking-widest text-dark-muted">FLASH EXPRESS</span>
            <span className="block font-display text-lg text-white">BPL SUPPLY</span>
          </Link>
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
